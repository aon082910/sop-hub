import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { uploadDir } from "../services/storage.js";
import { assertGuideAccess } from "./guides.js";
import { generateText, generateVisionCaption, resolveProvider } from "../services/aiProvider.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function imageToBase64(imagePath: string): Promise<{ base64: string; mimeType: string }> {
  const full = path.join(uploadDir(), imagePath);
  const buffer = await readFile(full);
  const ext = path.extname(imagePath).toLowerCase();
  return { base64: buffer.toString("base64"), mimeType: MIME_BY_EXT[ext] ?? "image/png" };
}

// Suggest a title + instruction for one step from its screenshot.
const captionSchema = z.object({
  stepId: z.string().uuid(),
  provider: z.enum(["ollama", "anthropic", "openai", "custom"]).optional(),
});

aiRouter.post("/step-caption", async (req: AuthedRequest, res) => {
  const parsed = captionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { stepId, provider } = parsed.data;

  const stepResult = await pool.query("SELECT * FROM steps WHERE id = $1", [stepId]);
  const step = stepResult.rows[0];
  if (!step) return res.status(404).json({ error: "Step not found" });
  const guide = await assertGuideAccess(req.userId!, step.guide_id);
  if (!guide) return res.status(404).json({ error: "Step not found" });
  if (!step.image_path) return res.status(400).json({ error: "Step has no screenshot" });

  const { base64, mimeType } = await imageToBase64(step.image_path);
  const aiProvider = resolveProvider(provider);

  const raw = await generateVisionCaption(aiProvider, {
    imageBase64: base64,
    mimeType,
    system:
      "You are an assistant that writes clear, concise step-by-step software process documentation, " +
      "similar to Scribe. Given a screenshot of a UI, write ONE short imperative-style step title (max 8 words) " +
      "and one sentence of instruction describing what to do in that screen. Respond as JSON: " +
      '{"title": "...", "instruction": "..."}. Do not include markdown fences.',
    prompt: `This is step ${step.position + 1} of a process guide titled "${guide.title}". Describe this step.`,
  });

  let title = "";
  let instruction = "";
  try {
    const parsedJson = JSON.parse(extractJson(raw));
    title = parsedJson.title ?? "";
    instruction = parsedJson.instruction ?? "";
  } catch {
    instruction = raw.trim();
  }

  const updated = await pool.query(
    "UPDATE steps SET title = COALESCE(NULLIF($1, ''), title), instruction = COALESCE(NULLIF($2, ''), instruction) WHERE id = $3 RETURNING *",
    [title, instruction, stepId]
  );
  res.json({ step: updated.rows[0] });
});

// Suggest a title + description for the whole guide from its steps.
const summarySchema = z.object({
  guideId: z.string().uuid(),
  provider: z.enum(["ollama", "anthropic", "openai", "custom"]).optional(),
});

aiRouter.post("/guide-summary", async (req: AuthedRequest, res) => {
  const parsed = summarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { guideId, provider } = parsed.data;

  const guide = await assertGuideAccess(req.userId!, guideId);
  if (!guide) return res.status(404).json({ error: "Guide not found" });
  const steps = await pool.query<any>("SELECT position, title, instruction FROM steps WHERE guide_id = $1 ORDER BY position", [guideId]);

  const stepList = steps.rows.map((s) => `${s.position + 1}. ${s.title}: ${s.instruction}`).join("\n");
  const aiProvider = resolveProvider(provider);
  const raw = await generateText(aiProvider, {
    messages: [
      {
        role: "system",
        content:
          'You write short, clear titles and descriptions for how-to guides. Respond as JSON only: {"title": "...", "description": "..."}.',
      },
      { role: "user", content: `Steps:\n${stepList}\n\nWrite a title (max 8 words) and a one-sentence description for this guide.` },
    ],
  });

  let title = guide.title;
  let description = guide.description;
  try {
    const parsedJson = JSON.parse(extractJson(raw));
    title = parsedJson.title || title;
    description = parsedJson.description || description;
  } catch {
    description = raw.trim();
  }

  const updated = await pool.query(
    "UPDATE guides SET title = $1, description = $2, updated_at = now() WHERE id = $3 RETURNING *",
    [title, description, guideId]
  );
  res.json({ guide: updated.rows[0] });
});

// Rewrite/improve a single piece of step text (clarity, tone, brevity).
const rewriteSchema = z.object({
  text: z.string().min(1),
  instruction: z.string().default("Make this clearer and more concise."),
  provider: z.enum(["ollama", "anthropic", "openai", "custom"]).optional(),
});

aiRouter.post("/rewrite", async (req: AuthedRequest, res) => {
  const parsed = rewriteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { text, instruction, provider } = parsed.data;
  const aiProvider = resolveProvider(provider);

  const result = await generateText(aiProvider, {
    messages: [
      { role: "system", content: "You rewrite process-documentation text. Return only the rewritten text, no preamble." },
      { role: "user", content: `${instruction}\n\nText: ${text}` },
    ],
  });
  res.json({ text: result.trim() });
});

// Ask questions about a guide (RAG-lite: full guide content as context).
const chatSchema = z.object({
  guideId: z.string().uuid(),
  message: z.string().min(1),
  provider: z.enum(["ollama", "anthropic", "openai", "custom"]).optional(),
});

aiRouter.post("/chat", async (req: AuthedRequest, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { guideId, message, provider } = parsed.data;

  const guide = await assertGuideAccess(req.userId!, guideId);
  if (!guide) return res.status(404).json({ error: "Guide not found" });
  const steps = await pool.query<any>("SELECT position, title, instruction FROM steps WHERE guide_id = $1 ORDER BY position", [guideId]);
  const history = await pool.query<any>(
    "SELECT role, content FROM guide_chat_messages WHERE guide_id = $1 ORDER BY created_at ASC LIMIT 20",
    [guideId]
  );

  await pool.query(
    "INSERT INTO guide_chat_messages (guide_id, user_id, role, content) VALUES ($1, $2, 'user', $3)",
    [guideId, req.userId, message]
  );

  const stepList = steps.rows.map((s) => `${s.position + 1}. ${s.title}: ${s.instruction}`).join("\n");
  const aiProvider = resolveProvider(provider);
  const answer = await generateText(aiProvider, {
    messages: [
      {
        role: "system",
        content: `You answer questions about the following process guide titled "${guide.title}". Only use this content:\n${stepList}`,
      },
      ...history.rows.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user", content: message },
    ],
  });

  await pool.query(
    "INSERT INTO guide_chat_messages (guide_id, user_id, role, content) VALUES ($1, NULL, 'assistant', $2)",
    [guideId, answer]
  );

  res.json({ answer });
});

function extractJson(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : raw;
}
