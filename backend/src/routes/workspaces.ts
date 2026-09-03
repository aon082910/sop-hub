import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

workspacesRouter.get("/", async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `SELECT w.id, w.name, w.created_at
     FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = $1
     ORDER BY w.created_at ASC`,
    [req.userId]
  );
  res.json({ workspaces: result.rows });
});
