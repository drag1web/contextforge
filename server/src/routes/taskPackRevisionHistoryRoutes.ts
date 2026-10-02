import type { Router, Response } from "express";
import { z } from "zod";
import {
  TaskPackRevisionHistoryApplicationError,
  type TaskPackRevisionHistoryApplicationService,
} from "../taskPacks/taskPackRevisionHistoryApplicationService.js";

// Same strict decimal/safe-integer convention as the existing workflow routes.
// Their schema is private; no unrelated route refactor is needed here.
const pathIdSchema = z.string().regex(/^[1-9]\d*$/u).transform(Number)
  .refine(value => Number.isSafeInteger(value) && value > 0);

function sendInvalid(res: Response) {
  return res.status(400).json({
    ok: false, code: "TASK_PACK_REVISION_HISTORY_INPUT_INVALID",
    message: "Task Pack revision history input is invalid.",
  });
}

function sendError(res: Response, error: unknown) {
  if (error instanceof TaskPackRevisionHistoryApplicationError) {
    if (error.code === "TASK_PACK_REVISION_HISTORY_INPUT_INVALID") return sendInvalid(res);
    if (error.code === "TASK_PACK_REVISION_HISTORY_STATE_INVALID") {
      return res.status(500).json({
        ok: false, code: error.code, message: "Task Pack revision history is invalid.",
      });
    }
  }
  // Never serialize an operational error, its message, evidence, stack or cause.
  return res.status(500).json({
    ok: false, code: "TASK_PACK_REVISION_HISTORY_FAILED", message: "Failed to read Task Pack revision history.",
  });
}

/** Read-only HTTP parsing/envelopes. The application service owns projection,
 * history validation, historical review replay and cross-pack scoping.
 */
export function registerTaskPackRevisionHistoryRoutes(
  router: Router,
  service: TaskPackRevisionHistoryApplicationService,
): void {
  router.get("/:id/revisions", async (req, res) => {
    const id = pathIdSchema.safeParse(req.params.id);
    if (!id.success) return sendInvalid(res);
    try {
      const history = await service.getTaskPackRevisionHistoryList(id.data);
      if (!history) {
        return res.status(404).json({ ok: false, code: "TASK_PACK_NOT_FOUND", message: "Task Pack not found." });
      }
      return res.json({ ok: true, history });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:id/revisions/:revisionId", async (req, res) => {
    const id = pathIdSchema.safeParse(req.params.id);
    const revisionId = pathIdSchema.safeParse(req.params.revisionId);
    if (!id.success || !revisionId.success) return sendInvalid(res);
    try {
      const revision = await service.getTaskPackRevisionDetail(id.data, revisionId.data);
      if (!revision) {
        // Identical for an absent pack, absent revision, or a foreign revision ID.
        return res.status(404).json({
          ok: false, code: "TASK_PACK_REVISION_NOT_FOUND", message: "Task Pack revision not found.",
        });
      }
      return res.json({ ok: true, revision });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
