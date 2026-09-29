import type { Router, Response } from "express";
import { z } from "zod";
import {
  TaskPackCurrentStateError,
  TaskPackWorkflowApplicationError,
  taskPackLifecycleCommandSchema,
  taskPackRevisionReviewCommandSchema,
  type TaskPackApplicationService,
  type TaskPackWorkflowApplicationErrorCode,
} from "../taskPacks/taskPackApplicationService.js";

export type TaskPackWorkflowService = Pick<
  TaskPackApplicationService,
  | "getCurrentTaskPackWorkflowState"
  | "transitionTaskPackLifecycle"
  | "transitionTaskPackRevisionReview"
>;

const pathIdSchema = z.string().regex(/^[1-9]\d*$/u).transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value > 0);
const lifecycleBodySchema = taskPackLifecycleCommandSchema.omit({ taskPackId: true });
const reviewBodySchema = taskPackRevisionReviewCommandSchema.omit({ taskPackId: true, revisionId: true });

const workflowStatus: Record<TaskPackWorkflowApplicationErrorCode, number> = {
  TASK_PACK_WORKFLOW_INVALID: 400,
  TASK_PACK_LIFECYCLE_NOT_FOUND: 404,
  TASK_PACK_LIFECYCLE_CONFLICT: 409,
  TASK_PACK_LIFECYCLE_VERSION_EXHAUSTED: 409,
  TASK_PACK_LIFECYCLE_INVALID_TRANSITION: 409,
  TASK_PACK_LIFECYCLE_STATE_INVALID: 500,
  TASK_PACK_LIFECYCLE_EVENT_EXISTS: 409,
  TASK_PACK_REVIEW_NOT_FOUND: 404,
  TASK_PACK_REVIEW_REVISION_NOT_FOUND: 404,
  TASK_PACK_REVIEW_CONFLICT: 409,
  TASK_PACK_REVIEW_VERSION_EXHAUSTED: 409,
  TASK_PACK_REVIEW_INVALID_TRANSITION: 409,
  TASK_PACK_REVIEW_STATE_INVALID: 500,
  TASK_PACK_REVIEW_EVENT_EXISTS: 409,
};

function sendInvalid(res: Response) {
  return res.status(400).json({
    ok: false, code: "TASK_PACK_WORKFLOW_INVALID", message: "Task Pack workflow input is invalid.",
  });
}

function sendError(res: Response, error: unknown) {
  if (error instanceof TaskPackWorkflowApplicationError) {
    return res.status(workflowStatus[error.code]).json({
      ok: false, code: error.code, message: error.message, ...error.evidence,
    });
  }
  if (error instanceof TaskPackCurrentStateError) {
    return res.status(500).json({
      ok: false, code: error.code, message: "Task Pack current state is invalid.",
    });
  }
  return res.status(500).json({
    ok: false, code: "TASK_PACK_WORKFLOW_FAILED", message: "Task Pack workflow operation failed.",
  });
}

function missingPrecondition(body: unknown, keys: readonly string[]): boolean {
  return body !== null && typeof body === "object" && !Array.isArray(body) &&
    keys.some((key) => !Object.hasOwn(body, key));
}

/** HTTP parsing/envelopes only; application service owns all workflow calls. */
export function registerTaskPackWorkflowRoutes(
  router: Router,
  service: TaskPackWorkflowService,
): void {
  router.get("/:id/workflow", async (req, res) => {
    const id = pathIdSchema.safeParse(req.params.id);
    if (!id.success) return sendInvalid(res);
    try {
      const workflow = await service.getCurrentTaskPackWorkflowState(id.data);
      if (!workflow) {
        return res.status(404).json({ ok: false, code: "TASK_PACK_NOT_FOUND", message: "Task Pack not found." });
      }
      return res.json({ ok: true, workflow });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/:id/transitions", async (req, res) => {
    const id = pathIdSchema.safeParse(req.params.id);
    if (!id.success) return sendInvalid(res);
    if (missingPrecondition(req.body, ["expectedLifecycleVersion"])) {
      return res.status(428).json({
        ok: false, code: "TASK_PACK_LIFECYCLE_PRECONDITION_REQUIRED",
        message: "The current lifecycle version is required before changing Task Pack lifecycle.",
      });
    }
    const body = lifecycleBodySchema.safeParse(req.body);
    if (!body.success) return sendInvalid(res);
    try {
      const result = await service.transitionTaskPackLifecycle({ taskPackId: id.data, ...body.data });
      return res.json({ ok: true, aggregate: result.aggregate, event: result.event });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/:id/revisions/:revisionId/review-events", async (req, res) => {
    const id = pathIdSchema.safeParse(req.params.id);
    const revisionId = pathIdSchema.safeParse(req.params.revisionId);
    if (!id.success || !revisionId.success) return sendInvalid(res);
    if (missingPrecondition(req.body, ["expectedLifecycleVersion", "expectedReviewState"])) {
      return res.status(428).json({
        ok: false, code: "TASK_PACK_REVIEW_PRECONDITION_REQUIRED",
        message: "The current lifecycle version and review state are required before reviewing a revision.",
      });
    }
    const body = reviewBodySchema.safeParse(req.body);
    if (!body.success) return sendInvalid(res);
    try {
      const result = await service.transitionTaskPackRevisionReview({
        taskPackId: id.data, revisionId: revisionId.data, ...body.data,
      });
      return res.json({
        ok: true, aggregate: result.aggregate, revision: result.revision,
        reviewState: result.reviewState, event: result.event,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
