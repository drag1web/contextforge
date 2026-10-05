import { computeTaskPackRevisionContentHash } from "../taskPacks/taskPackLifecycle.js";
import { buildLegacyTaskPackRevisionContent } from "./taskPackLifecyclePersistence.js";
import {
  WorkspaceBackupReadError, type WorkspaceBackupLegacyBundle, type WorkspaceBackupReadResult,
  type WorkspaceBackupV1TaskPack,
} from "./workspaceBackupFormat.js";
import { validateWorkspaceBackup, WORKSPACE_BACKUP_MAX_DEPTH } from "./workspaceBackupValidation.js";

/** Bound pathological nesting before allocating parsed objects. This is not a
 * JSON parser or a content/privacy scanner; JSON.parse still owns syntax. */
function checkTextDepth(text: string): void {
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > WORKSPACE_BACKUP_MAX_DEPTH) throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_SAFETY_LIMIT");
    } else if (char === "}" || char === "]") depth--;
  }
}

function normalizeLegacy(pack: WorkspaceBackupV1TaskPack): WorkspaceBackupLegacyBundle {
  // Reuse TP-LC-02's exact prefix/nullable-content policy, not a second legacy migration.
  const content = buildLegacyTaskPackRevisionContent({ id: pack.id, raw_task: pack.rawTask,
    task_type: pack.taskType, target_tool: pack.targetTool, generated_prompt: pack.generatedPrompt,
    generation_mode: pack.generationMode, generation_model: pack.generationModel,
    generation_message: pack.generationMessage, generation_used_fallback: pack.generationUsedFallback,
    generation_duration_ms: pack.generationDurationMs, generation_recipe: pack.generationRecipe,
    created_at: pack.createdAt });
  return {
    sourceAggregateId: pack.id, sourceProjectId: pack.projectId, title: pack.title,
    lifecycle: { state: "active", archivedFromState: null }, lifecycleVersion: 1,
    currentRevisionIndex: 0, acceptedRevisionIndex: null, createdAt: pack.createdAt, updatedAt: pack.updatedAt,
    completedAt: null, archivedAt: null,
    revisions: [{ sourceRevisionId: null, revisionIndex: 0, revisionNumber: 1, baseRevisionIndex: null,
      content, contentHash: computeTaskPackRevisionContentHash(content), createdAt: pack.createdAt, generatedAt: null }],
    lifecycleEvents: [], reviewEvents: [],
  };
}

/** No I/O, storage, restore permission, destination IDs, redaction or integration materialization. */
export function parseWorkspaceBackup(text: string): WorkspaceBackupReadResult {
  if (typeof text !== "string") throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_JSON_INVALID");
  checkTextDepth(text);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_JSON_INVALID"); }
  const backup = validateWorkspaceBackup(value);
  if (backup.formatVersion === 2) return { formatVersion: 2, backup };
  try {
    return { formatVersion: 1, backup, compatibilityTaskPacks: backup.data.taskPacks.map(normalizeLegacy) };
  } catch { throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_INVALID"); }
}
