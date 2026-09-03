import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { assertGuideAccess } from "./guides.js";
import { uploadDir } from "../services/storage.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

// Ingests a batch of steps recorded by the SOP-Hub browser extension:
// one entry per click, each with a base64 screenshot and the click position
// (as a percentage of the viewport, so it renders correctly at any zoom).
export const captureRouter = Router();
captureRouter.use(requireAuth);

const capturedStepSchema = z.object({
  title: z.string().default(""),
  instruction: z.string().default(""),
  screenshotBase64: z.string(), // no data: prefix
  clickXPct: z.number().min(0).max(100).optional(),
  clickYPct: z.number().min(0).max(100).optional(),
});

const batchSchema = z.object({
  guideId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  guideTitle: z.string().optional(),
  steps: z.array(capturedStepSchema).min(1),
});

captureRouter.post("/batch", async (req: AuthedRequest, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { steps } = parsed.data;
  let { guideId } = parsed.data;

  if (guideId) {
    const guide = await assertGuideAccess(req.userId!, guideId);
    if (!guide) return res.status(404).json({ error: "Guide not found" });
  } else {
    if (!parsed.data.workspaceId) return res.status(400).json({ error: "workspaceId is required to create a new guide" });
    const memberCheck = await pool.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [parsed.data.workspaceId, req.userId]
    );
    if (!memberCheck.rowCount) return res.status(403).json({ error: "Not a member of this workspace" });

    const created = await pool.query(
      "INSERT INTO guides (workspace_id, author_id, title) VALUES ($1, $2, $3) RETURNING *",
      [parsed.data.workspaceId, req.userId, parsed.data.guideTitle || "Captured Guide"]
    );
    guideId = created.rows[0].id;
  }

  const posResult = await pool.query(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM steps WHERE guide_id = $1",
    [guideId]
  );
  let position = posResult.rows[0].next;

  const created = [];
  for (const step of steps) {
    const filename = `${nanoid()}.png`;
    await writeFile(path.join(uploadDir(), filename), Buffer.from(step.screenshotBase64, "base64"));
    const result = await pool.query(
      `INSERT INTO steps (guide_id, position, title, instruction, image_path, click_x_pct, click_y_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [guideId, position++, step.title, step.instruction, filename, step.clickXPct ?? null, step.clickYPct ?? null]
    );
    created.push(result.rows[0]);
  }
  await pool.query("UPDATE guides SET updated_at = now() WHERE id = $1", [guideId]);

  res.status(201).json({ guideId, steps: created });
});
