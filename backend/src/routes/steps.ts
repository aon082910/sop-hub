import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import { rename } from "node:fs/promises";
import sharp from "sharp";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { upload, uploadDir } from "../services/storage.js";
import { assertGuideAccess } from "./guides.js";

export const stepsRouter = Router();
stepsRouter.use(requireAuth);

// Create a step, optionally with an uploaded screenshot ("image" field).
stepsRouter.post("/", upload.single("image"), async (req: AuthedRequest, res) => {
  const bodySchema = z.object({
    guideId: z.string().uuid(),
    title: z.string().default(""),
    instruction: z.string().default(""),
    clickXPct: z.coerce.number().min(0).max(100).optional(),
    clickYPct: z.coerce.number().min(0).max(100).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { guideId, title, instruction, clickXPct, clickYPct } = parsed.data;

  const guide = await assertGuideAccess(req.userId!, guideId);
  if (!guide) return res.status(404).json({ error: "Guide not found" });

  const posResult = await pool.query(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM steps WHERE guide_id = $1",
    [guideId]
  );
  const position = posResult.rows[0].next;
  const imagePath = req.file ? req.file.filename : null;

  const result = await pool.query(
    `INSERT INTO steps (guide_id, position, title, instruction, image_path, click_x_pct, click_y_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [guideId, position, title, instruction, imagePath, clickXPct ?? null, clickYPct ?? null]
  );
  await pool.query("UPDATE guides SET updated_at = now() WHERE id = $1", [guideId]);
  res.status(201).json({ step: result.rows[0] });
});

const updateStepSchema = z.object({
  title: z.string().optional(),
  instruction: z.string().optional(),
  redacted: z.boolean().optional(),
});

stepsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const stepResult = await pool.query("SELECT * FROM steps WHERE id = $1", [req.params.id]);
  const step = stepResult.rows[0];
  if (!step) return res.status(404).json({ error: "Step not found" });
  const guide = await assertGuideAccess(req.userId!, step.guide_id);
  if (!guide) return res.status(404).json({ error: "Step not found" });

  const parsed = updateStepSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(parsed.data)) {
    setClauses.push(`${key} = $${i++}`);
    values.push(value);
  }
  if (!setClauses.length) return res.json({ step });
  values.push(step.id);

  const result = await pool.query(
    `UPDATE steps SET ${setClauses.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json({ step: result.rows[0] });
});

const rectSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  wPct: z.number().min(0).max(100),
  hPct: z.number().min(0).max(100),
});
const redactSchema = z.object({ rects: z.array(rectSchema).min(1) });

// Bakes opaque black boxes into the step's screenshot at the given rects
// (percentages of image dimensions, so they're resolution-independent) and
// overwrites the stored file in place -- this is destructive by design.
stepsRouter.post("/:id/redact", async (req: AuthedRequest, res) => {
  const stepResult = await pool.query("SELECT * FROM steps WHERE id = $1", [req.params.id]);
  const step = stepResult.rows[0];
  if (!step) return res.status(404).json({ error: "Step not found" });
  const guide = await assertGuideAccess(req.userId!, step.guide_id);
  if (!guide) return res.status(404).json({ error: "Step not found" });
  if (!step.image_path) return res.status(400).json({ error: "Step has no image" });

  const parsed = redactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const filePath = path.join(uploadDir(), step.image_path);
  const meta = await sharp(filePath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const rectsSvg = parsed.data.rects
    .map((r) => {
      const x = (r.xPct / 100) * width;
      const y = (r.yPct / 100) * height;
      const w = (r.wPct / 100) * width;
      const h = (r.hPct / 100) * height;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black" />`;
    })
    .join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}">${rectsSvg}</svg>`);

  const tmpPath = `${filePath}.redact-tmp`;
  await sharp(filePath).composite([{ input: overlay }]).toFile(tmpPath);
  await rename(tmpPath, filePath);

  const result = await pool.query(
    "UPDATE steps SET redacted = true, redaction_rects = $1 WHERE id = $2 RETURNING *",
    [JSON.stringify(parsed.data.rects), step.id]
  );
  res.json({ step: result.rows[0] });
});

stepsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const stepResult = await pool.query("SELECT * FROM steps WHERE id = $1", [req.params.id]);
  const step = stepResult.rows[0];
  if (!step) return res.status(404).json({ error: "Step not found" });
  const guide = await assertGuideAccess(req.userId!, step.guide_id);
  if (!guide) return res.status(404).json({ error: "Step not found" });

  await pool.query("DELETE FROM steps WHERE id = $1", [step.id]);
  res.status(204).send();
});

const reorderSchema = z.object({
  guideId: z.string().uuid(),
  orderedStepIds: z.array(z.string().uuid()),
});

stepsRouter.post("/reorder", async (req: AuthedRequest, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { guideId, orderedStepIds } = parsed.data;

  const guide = await assertGuideAccess(req.userId!, guideId);
  if (!guide) return res.status(404).json({ error: "Guide not found" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < orderedStepIds.length; i++) {
      await client.query("UPDATE steps SET position = $1 WHERE id = $2 AND guide_id = $3", [
        i,
        orderedStepIds[i],
        guideId,
      ]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.status(204).send();
});
