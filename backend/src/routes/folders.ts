import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

async function assertMember(userId: string, workspaceId: string) {
  const result = await pool.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function assertFolderAccess(userId: string, folderId: string) {
  const result = await pool.query(
    `SELECT f.* FROM folders f
     JOIN workspace_members m ON m.workspace_id = f.workspace_id
     WHERE f.id = $1 AND m.user_id = $2`,
    [folderId, userId]
  );
  return result.rows[0] ?? null;
}

const createFolderSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
});

foldersRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { workspaceId, name } = parsed.data;

  if (!(await assertMember(req.userId!, workspaceId))) {
    return res.status(403).json({ error: "Not a member of this workspace" });
  }

  const result = await pool.query(
    "INSERT INTO folders (workspace_id, name) VALUES ($1, $2) RETURNING *",
    [workspaceId, name]
  );
  res.status(201).json({ folder: result.rows[0] });
});

foldersRouter.get("/", async (req: AuthedRequest, res) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  if (!(await assertMember(req.userId!, workspaceId))) {
    return res.status(403).json({ error: "Not a member of this workspace" });
  }
  const result = await pool.query(
    "SELECT * FROM folders WHERE workspace_id = $1 ORDER BY name ASC",
    [workspaceId]
  );
  res.json({ folders: result.rows });
});

const updateFolderSchema = z.object({ name: z.string().min(1) });

foldersRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const folder = await assertFolderAccess(req.userId!, req.params.id);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  const parsed = updateFolderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const result = await pool.query("UPDATE folders SET name = $1 WHERE id = $2 RETURNING *", [
    parsed.data.name,
    folder.id,
  ]);
  res.json({ folder: result.rows[0] });
});

foldersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const folder = await assertFolderAccess(req.userId!, req.params.id);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  // Guides inside are unfiled, not deleted -- ON DELETE SET NULL on guides.folder_id.
  await pool.query("DELETE FROM folders WHERE id = $1", [folder.id]);
  res.status(204).send();
});
