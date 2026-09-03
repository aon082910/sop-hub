import { Router } from "express";
import path from "node:path";
import PDFDocument from "pdfkit";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { assertGuideAccess } from "./guides.js";
import { uploadDir } from "../services/storage.js";

export const exportRouter = Router();
exportRouter.use(requireAuth);

async function loadGuideWithSteps(userId: string, guideId: string) {
  const guide = await assertGuideAccess(userId, guideId);
  if (!guide) return null;
  const steps = await pool.query<any>("SELECT * FROM steps WHERE guide_id = $1 ORDER BY position ASC", [guideId]);
  return { guide, steps: steps.rows as any[] };
}

exportRouter.get("/:id/markdown", async (req: AuthedRequest, res) => {
  const data = await loadGuideWithSteps(req.userId!, req.params.id);
  if (!data) return res.status(404).json({ error: "Guide not found" });
  const { guide, steps } = data;

  let md = `# ${guide.title}\n\n${guide.description}\n\n`;
  steps.forEach((s, i) => {
    md += `## Step ${i + 1}: ${s.title}\n\n${s.instruction}\n\n`;
    if (s.image_path) md += `![Step ${i + 1} screenshot](${s.image_path})\n\n`;
  });

  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="${slugify(guide.title)}.md"`);
  res.send(md);
});

exportRouter.get("/:id/html", async (req: AuthedRequest, res) => {
  const data = await loadGuideWithSteps(req.userId!, req.params.id);
  if (!data) return res.status(404).json({ error: "Guide not found" });
  const { guide, steps } = data;

  const stepsHtml = steps
    .map(
      (s, i) => `
      <section class="step">
        <h2>Step ${i + 1}: ${escapeHtml(s.title)}</h2>
        <p>${escapeHtml(s.instruction)}</p>
        ${s.image_path ? `<img src="/uploads/${s.image_path}" alt="Step ${i + 1} screenshot" />` : ""}
      </section>`
    )
    .join("\n");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(guide.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 28px; } h2 { font-size: 20px; margin-top: 32px; }
  img { max-width: 100%; border: 1px solid #e2e2e2; border-radius: 8px; margin-top: 8px; }
  .step { padding-bottom: 16px; border-bottom: 1px solid #eee; }
</style></head>
<body>
  <h1>${escapeHtml(guide.title)}</h1>
  <p>${escapeHtml(guide.description)}</p>
  ${stepsHtml}
</body></html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

exportRouter.get("/:id/pdf", async (req: AuthedRequest, res) => {
  const data = await loadGuideWithSteps(req.userId!, req.params.id);
  if (!data) return res.status(404).json({ error: "Guide not found" });
  const { guide, steps } = data;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${slugify(guide.title)}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(24).text(guide.title, { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor("#444").text(guide.description);
  doc.moveDown();

  steps.forEach((s, i) => {
    doc.fillColor("#000").fontSize(16).text(`Step ${i + 1}: ${s.title}`);
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor("#333").text(s.instruction);
    if (s.image_path) {
      try {
        doc.moveDown(0.25);
        doc.image(path.join(uploadDir(), s.image_path), { width: 400 });
      } catch {
        // Skip images that fail to load (e.g. unsupported format).
      }
    }
    doc.moveDown();
  });

  doc.end();
});

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "guide";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
