import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const guidesRouter = Router();
guidesRouter.use(requireAuth);

async function assertMember(userId: string, workspaceId: string) {
  const result = await pool.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function assertGuideAccess(userId: string, guideId: string) {
  const result = await pool.query(
    `SELECT g.* FROM guides g
     JOIN workspace_members m ON m.workspace_id = g.workspace_id
     WHERE g.id = $1 AND m.user_id = $2`,
    [guideId, userId]
  );
  return result.rows[0] ?? null;
}

const createGuideSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().default("Untitled Guide"),
  description: z.string().default(""),
});

guidesRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createGuideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { workspaceId, title, description } = parsed.data;

  if (!(await assertMember(req.userId!, workspaceId))) {
    return res.status(403).json({ error: "Not a member of this workspace" });
  }

  const result = await pool.query(
    `INSERT INTO guides (workspace_id, author_id, title, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [workspaceId, req.userId, title, description]
  );
  res.status(201).json({ guide: result.rows[0] });
});

guidesRouter.get("/", async (req: AuthedRequest, res) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  if (!(await assertMember(req.userId!, workspaceId))) {
    return res.status(403).json({ error: "Not a member of this workspace" });
  }

  // folderId=<uuid> filters to that folder; folderId=unfiled filters to guides
  // with no folder; omitted returns every guide in the workspace.
  const folderId = req.query.folderId as string | undefined;
  const params: unknown[] = [workspaceId];
  let where = "workspace_id = $1";
  if (folderId === "unfiled") {
    where += " AND folder_id IS NULL";
  } else if (folderId) {
    params.push(folderId);
    where += ` AND folder_id = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT * FROM guides WHERE ${where} ORDER BY updated_at DESC`,
    params
  );
  res.json({ guides: result.rows });
});

guidesRouter.get("/:id", async (req: AuthedRequest, res) => {
  const guide = await assertGuideAccess(req.userId!, req.params.id);
  if (!guide) return res.status(404).json({ error: "Guide not found" });
  const steps = await pool.query("SELECT * FROM steps WHERE guide_id = $1 ORDER BY position ASC", [guide.id]);
  res.json({ guide, steps: steps.rows });
});

const updateGuideSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["draft", "published"]).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

const COLUMN_BY_FIELD: Record<string, string> = { folderId: "folder_id" };

guidesRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const guide = await assertGuideAccess(req.userId!, req.params.id);
  if (!guide) return res.status(404).json({ error: "Guide not found" });
  const parsed = updateGuideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.folderId) {
    const folderResult = await pool.query(
      "SELECT 1 FROM folders WHERE id = $1 AND workspace_id = $2",
      [parsed.data.folderId, guide.workspace_id]
    );
    if (!folderResult.rowCount) return res.status(404).json({ error: "Folder not found" });
  }

  const fields = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    setClauses.push(`${COLUMN_BY_FIELD[key] ?? key} = $${i++}`);
    values.push(value);
  }
  if (fields.status === "published" && !guide.share_slug) {
    setClauses.push(`share_slug = $${i++}`);
    values.push(nanoid(10));
  }
  setClauses.push(`updated_at = now()`);
  values.push(guide.id);

  const result = await pool.query(
    `UPDATE guides SET ${setClauses.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json({ guide: result.rows[0] });
});

guidesRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const guide = await assertGuideAccess(req.userId!, req.params.id);
  if (!guide) return res.status(404).json({ error: "Guide not found" });
  await pool.query("DELETE FROM guides WHERE id = $1", [guide.id]);
  res.status(204).send();
});

// Public, unauthenticated read of a published guide by its share slug.
export const publicGuidesRouter = Router();
publicGuidesRouter.get("/:slug", async (req, res) => {
  const guideResult = await pool.query(
    "SELECT * FROM guides WHERE share_slug = $1 AND status = 'published'",
    [req.params.slug]
  );
  const guide = guideResult.rows[0];
  if (!guide) return res.status(404).json({ error: "Guide not found" });
  const steps = await pool.query("SELECT * FROM steps WHERE guide_id = $1 ORDER BY position ASC", [guide.id]);
  res.json({ guide, steps: steps.rows });
});

export { assertGuideAccess };
