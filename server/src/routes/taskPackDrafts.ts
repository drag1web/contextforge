import { Router, type Response } from "express";
import { z } from "zod";

import { RulesServiceError } from "../rules/rulesService.js";
import {
  TaskPackDraftApplicationError,
  type TaskPackDraftApplicationService,
  type TaskPackDraftView,
} from "../taskPacks/taskPackDraftApplicationService.js";
import { normalizeTaskClarifications } from "../taskPacks/taskClarifications.js";
import type {
  CreateTaskPackRequest,
  PrepareTaskPackPipelineResult,
} from "./taskPacks.js";

const positiveSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const nonWhitespaceStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  "Expected a non-whitespace string.",
);
const nullableStringSchema = z.string().nullable();
const clarificationSchema = z.object({
  question: nonWhitespaceStringSchema,
  answer: z.string(),
}).strict();

export const taskPackDraftContentSchema = z.object({
  rawTask: nonWhitespaceStringSchema,
  taskType: nonWhitespaceStringSchema,
  targetTool: nonWhitespaceStringSchema,
  templateId: nullableStringSchema,
  ruleProfileId: nullableStringSchema,
  enabledRuleIds: z.array(z.string()),
  customRulesText: nullableStringSchema,
  acceptanceCriteriaPresetId: nullableStringSchema,
  acceptanceCriteriaText: nullableStringSchema,
  clarifications: z.array(clarificationSchema),
  performanceSessionId: nullableStringSchema,
  understandingSnapshotId: nullableStringSchema,
  reviewedUnderstandingSnapshotId: nullableStringSchema,
}).strict();

const createDraftSchema = z.object({
  projectId: positiveSafeIntegerSchema,
  taskPackId: positiveSafeIntegerSchema.nullable(),
  baseRevisionId: positiveSafeIntegerSchema.nullable(),
  content: taskPackDraftContentSchema,
}).strict();

const updateDraftSchema = z.object({
  expectedDraftVersion: positiveSafeIntegerSchema,
  content: taskPackDraftContentSchema,
}).strict();

const discardDraftSchema = z.object({
  expectedDraftVersion: positiveSafeIntegerSchema,
}).strict();

const materializeDraftSchema = discardDraftSchema;

const activeDraftQuerySchema = z.object({
  state: z.literal("active").optional(),
  projectId: z.string().regex(/^[1-9]\d*$/u).optional(),
}).strict();

const draftIdSchema = z.string()
  .max(200)
  .refine((value) => value.trim().length > 0)
  .refine((value) => !/[\u0000-\u001f]/u.test(value));

export const taskPackDraftsRouter = Router();

export type PrepareTaskPackForDraft = (
  input: CreateTaskPackRequest,
) => Promise<PrepareTaskPackPipelineResult>;

export type ValidateCreateTaskPackRequest = (input: unknown) =>
  | { readonly success: true; readonly data: CreateTaskPackRequest }
  | { readonly success: false };

export function registerTaskPackDraftRoutes(
  router: ReturnType<typeof Router>,
  service: TaskPackDraftApplicationService,
  prepareTaskPack: PrepareTaskPackForDraft,
  validateTaskPackRequest: ValidateCreateTaskPackRequest,
): void {
  router.get("/", async (req, res) => {
    const parsed = activeDraftQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return sendInvalid(res);
    const projectId = parsed.data.projectId === undefined
      ? undefined
      : Number(parsed.data.projectId);
    if (projectId !== undefined && !Number.isSafeInteger(projectId)) {
      return sendInvalid(res);
    }
    try {
      const drafts = await service.listActiveDrafts(projectId);
      res.json({ ok: true, drafts });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/", async (req, res) => {
    const parsed = createDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalid(res);
    try {
      const draft = await service.createDraft(parsed.data);
      res.status(201).json({ ok: true, draft });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:draftId", async (req, res) => {
    const parsedId = draftIdSchema.safeParse(req.params.draftId);
    if (!parsedId.success) return sendInvalid(res);
    try {
      const draft = await service.getDraft(parsedId.data);
      if (!draft) {
        res.status(404).json({
          ok: false,
          code: "TASK_PACK_DRAFT_NOT_FOUND",
          message: "Task Pack draft not found.",
        });
        return;
      }
      res.json({ ok: true, draft });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/:draftId", async (req, res) => {
    const parsedId = draftIdSchema.safeParse(req.params.draftId);
    if (!parsedId.success) return sendInvalid(res);
    if (!hasExpectedDraftVersion(req.body)) return sendVersionRequired(res);
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalid(res);
    try {
      const draft = await service.updateDraft({
        draftId: parsedId.data,
        ...parsed.data,
      });
      res.json({ ok: true, draft });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:draftId/discard", async (req, res) => {
    const parsedId = draftIdSchema.safeParse(req.params.draftId);
    if (!parsedId.success) return sendInvalid(res);
    if (!hasExpectedDraftVersion(req.body)) return sendVersionRequired(res);
    const parsed = discardDraftSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalid(res);
    try {
      const draft = await service.discardDraft({
        draftId: parsedId.data,
        expectedDraftVersion: parsed.data.expectedDraftVersion,
      });
      res.json({ ok: true, draft });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:draftId/materialize", async (req, res) => {
    const parsedId = draftIdSchema.safeParse(req.params.draftId);
    if (!parsedId.success) return sendInvalid(res);
    if (!hasExpectedDraftVersion(req.body)) return sendVersionRequired(res);
    const parsed = materializeDraftSchema.safeParse(req.body);
    if (!parsed.success) return sendInvalid(res);

    const draftId = parsedId.data;
    const expectedDraftVersion = parsed.data.expectedDraftVersion;
    try {
      const draft = await service.getDraft(draftId);
      if (!draft) {
        throw new TaskPackDraftApplicationError(
          "TASK_PACK_DRAFT_NOT_FOUND",
          draftId,
        );
      }
      assertDraftCanStartMaterialization(draft, expectedDraftVersion);

      const generationCandidate = buildDraftGenerationRequest(draft);
      const validated = validateTaskPackRequest(generationCandidate);
      if (!validated.success) return sendInvalid(res);

      const prepared = await prepareTaskPack(validated.data);
      if (prepared.kind === "project_not_found") {
        throw new TaskPackDraftApplicationError(
          "TASK_PACK_DRAFT_PROJECT_NOT_FOUND",
          draftId,
        );
      }
      if (
        prepared.kind === "blocked" ||
        prepared.kind === "clarification_required"
      ) {
        res.status(422).json({
          ok: false,
          code: "CONTEXT_SELECTION_BLOCKED",
          message: prepared.message,
          selectionQuality: prepared.selectionQuality,
          selectorDiagnostics: prepared.selectorDiagnostics,
          performanceDiagnostics: prepared.performanceDiagnostics,
        });
        return;
      }

      const result = await service.materializeDraft({
        draftId,
        expectedDraftVersion,
        title: prepared.title,
        generatedAt: prepared.generatedAt,
        revisionContent: prepared.revisionContent,
        generationRecipe: prepared.generationRecipe,
        selectorDiagnostics: prepared.selectorDiagnostics,
        generationDiagnostics: prepared.generationDiagnostics,
        performanceDiagnostics: prepared.performanceDiagnostics,
      });
      if (result.taskPack.currentRevisionId !== result.revision.id) {
        throw new TaskPackDraftApplicationError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          draftId,
        );
      }
      res.json({
        ok: true,
        taskPack: {
          ...result.taskPack,
          projectName: result.draft.projectName,
        },
        revision: {
          id: result.revision.id,
          taskPackId: result.revision.taskPackId,
          revisionNumber: result.revision.revisionNumber,
          contentHash: result.revision.contentHash,
          createdAt: result.revision.createdAt,
          generatedAt: result.revision.generatedAt,
        },
        draft: result.draft,
      });
    } catch (error) {
      sendMaterializationError(res, error);
    }
  });
}

function assertDraftCanStartMaterialization(
  draft: TaskPackDraftView,
  expectedDraftVersion: number,
): void {
  if (draft.draftVersion !== expectedDraftVersion) {
    throw new TaskPackDraftApplicationError(
      "TASK_PACK_DRAFT_CONFLICT",
      draft.id,
      expectedDraftVersion,
      draft.draftVersion,
    );
  }
  if (draft.lifecycle.state !== "active") {
    throw new TaskPackDraftApplicationError(
      "TASK_PACK_DRAFT_NOT_EDITABLE",
      draft.id,
      expectedDraftVersion,
      draft.draftVersion,
      draft.lifecycle.state,
    );
  }
  if (draft.draftVersion === Number.MAX_SAFE_INTEGER) {
    throw new TaskPackDraftApplicationError(
      "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
      draft.id,
    );
  }
  if (draft.taskPackId !== null || draft.baseRevisionId !== null) {
    throw new TaskPackDraftApplicationError(
      "TASK_PACK_DRAFT_ALREADY_BOUND",
      draft.id,
    );
  }
}

function buildDraftGenerationRequest(
  draft: TaskPackDraftView,
): Record<string, unknown> {
  const performanceSessionId = optionalReference(
    draft.content.performanceSessionId,
  );
  const understandingSnapshotId = optionalReference(
    draft.content.understandingSnapshotId,
  );
  const reviewedUnderstandingSnapshotId = optionalReference(
    draft.content.reviewedUnderstandingSnapshotId,
  );
  const templateId = optionalReference(draft.content.templateId);
  const ruleProfileId = optionalReference(draft.content.ruleProfileId);
  const acceptanceCriteriaPresetId = optionalReference(
    draft.content.acceptanceCriteriaPresetId,
  );
  return {
    projectId: draft.projectId,
    rawTask: draft.content.rawTask,
    taskType: draft.content.taskType,
    targetTool: draft.content.targetTool,
    clarifications: normalizeTaskClarifications(draft.content.clarifications),
    ...(performanceSessionId === undefined ? {} : { performanceSessionId }),
    ...(understandingSnapshotId === undefined
      ? {}
      : { understandingSnapshotId }),
    ...(reviewedUnderstandingSnapshotId === undefined
      ? {}
      : { reviewedUnderstandingSnapshotId }),
    ...(templateId === undefined ? {} : { templateId }),
    ...(ruleProfileId === undefined ? {} : { ruleProfileId }),
    enabledRuleIds: [...draft.content.enabledRuleIds],
    customRules: parseMultilineValues(draft.content.customRulesText),
    ...(acceptanceCriteriaPresetId === undefined
      ? {}
      : { acceptanceCriteriaPresetId }),
    acceptanceCriteria: parseMultilineValues(
      draft.content.acceptanceCriteriaText,
    ),
  };
}

function optionalReference(value: string | null): string | undefined {
  return value === null || value.trim().length === 0 ? undefined : value;
}

function parseMultilineValues(value: string | null): string[] {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

function hasExpectedDraftVersion(value: unknown): boolean {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "expectedDraftVersion");
}

function sendVersionRequired(res: Response): void {
  res.status(428).json({
    ok: false,
    code: "TASK_PACK_DRAFT_VERSION_REQUIRED",
    message: "The current draft version is required before saving.",
  });
}

function sendInvalid(res: Response): void {
  res.status(400).json({
    ok: false,
    code: "TASK_PACK_DRAFT_INVALID",
    message: "Task Pack draft input is invalid.",
  });
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof TaskPackDraftApplicationError) {
    const status = applicationErrorStatus(error.code);
    const body: Record<string, unknown> = {
      ok: false,
      code: error.code,
      message: error.message,
    };
    if (error.code === "TASK_PACK_DRAFT_CONFLICT") {
      body.draftId = error.draftId;
      body.expectedDraftVersion = error.expectedDraftVersion;
      body.actualDraftVersion = error.actualDraftVersion;
    }
    res.status(status).json(body);
    return;
  }
  console.error("Task Pack draft request failed:", error);
  res.status(500).json({
    ok: false,
    message: "Task Pack draft request failed.",
  });
}

function sendMaterializationError(res: Response, error: unknown): void {
  if (error instanceof RulesServiceError) {
    res.status(error.statusCode).json({
      ok: false,
      message: error.message,
    });
    return;
  }
  if (error instanceof TaskPackDraftApplicationError) {
    sendError(res, error);
    return;
  }
  console.error("Task Pack draft materialization failed:", error);
  res.status(500).json({
    ok: false,
    message: "Task Pack draft materialization failed.",
  });
}

function applicationErrorStatus(code: TaskPackDraftApplicationError["code"]): number {
  switch (code) {
    case "TASK_PACK_DRAFT_INVALID":
      return 400;
    case "TASK_PACK_DRAFT_NOT_FOUND":
    case "TASK_PACK_DRAFT_PROJECT_NOT_FOUND":
    case "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND":
      return 404;
    case "TASK_PACK_DRAFT_CONFLICT":
    case "TASK_PACK_DRAFT_NOT_EDITABLE":
    case "TASK_PACK_DRAFT_VERSION_EXHAUSTED":
    case "TASK_PACK_DRAFT_OWNERSHIP_INVALID":
    case "TASK_PACK_DRAFT_BASE_REVISION_INVALID":
    case "TASK_PACK_DRAFT_ALREADY_BOUND":
      return 409;
    case "TASK_PACK_DRAFT_STATE_INVALID":
      return 500;
  }
}
