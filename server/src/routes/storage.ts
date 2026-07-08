import { Router } from "express";

import { getStorageAudit } from "../storage/storageAudit.js";
import { exportWorkspaceBackup } from "../storage/workspaceBackup.js";

export const storageRouter = Router();

storageRouter.get("/audit", async (_req, res) => {
  try {
    const audit = await getStorageAudit();

    res.json({
      ok: true,
      audit
    });
  } catch (error) {
    console.error("Storage audit failed:", error);

    res.status(500).json({
      ok: false,
      message: "Storage audit failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});


storageRouter.post("/backups/export", async (_req, res) => {
  try {
    const backup = await exportWorkspaceBackup();

    res.json({
      ok: true,
      backup
    });
  } catch (error) {
    console.error("Workspace backup export failed:", error);

    res.status(500).json({
      ok: false,
      message: "Workspace backup export failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
