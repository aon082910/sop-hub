import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { foldersRouter } from "./routes/folders.js";
import { guidesRouter, publicGuidesRouter } from "./routes/guides.js";
import { stepsRouter } from "./routes/steps.js";
import { aiRouter } from "./routes/ai.js";
import { exportRouter } from "./routes/export.js";
import { captureRouter } from "./routes/capture.js";
import { uploadDir } from "./services/storage.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(uploadDir()));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/workspaces", workspacesRouter);
app.use("/folders", foldersRouter);
app.use("/guides", guidesRouter);
app.use("/public/guides", publicGuidesRouter);
app.use("/steps", stepsRouter);
app.use("/ai", aiRouter);
app.use("/export/guides", exportRouter);
app.use("/capture", captureRouter);

// Serve the built frontend (single-container production image) if present.
// Local `npm run dev` setups run the Vite dev server separately and never
// have this directory, so this is a no-op there.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "public");
app.use(express.static(frontendDist));
app.get(/^(?!\/(auth|workspaces|guides|public|steps|ai|export|capture|uploads|health)\b).*/, (req, res, next) => {
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) next();
  });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Internal server error" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`SOP-Hub backend listening on :${port}`));
