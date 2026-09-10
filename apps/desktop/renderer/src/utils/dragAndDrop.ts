export const CONTEXTFORGE_DRAG_MIME =
  "application/x-contextforge-item+json";
export const CONTEXTFORGE_PROJECT_FILE_DRAG_MIME =
  "application/x-contextforge-project-file";

const DRAG_PAYLOAD_VERSION = 1 as const;
const MAX_DRAG_PAYLOAD_LENGTH = 4096;
const MAX_REPOSITORY_PATH_LENGTH = 2048;

export interface ContextForgeProjectFileDragPayload {
  version: typeof DRAG_PAYLOAD_VERSION;
  kind: "project-file";
  projectId: number;
  path: string;
}

export type ContextForgeDragPayload = ContextForgeProjectFileDragPayload;

export type ContextBasketDropClassification =
  | { status: "already-selected"; path: string }
  | { status: "known-file"; path: string }
  | { status: "requires-validation"; path: string }
  | { status: "wrong-project" };

type DragTransferReader = Pick<DataTransfer, "getData" | "types">;
type DragTransferWriter = Pick<
  DataTransfer,
  "effectAllowed" | "setData"
>;

function transferTypes(dataTransfer: Pick<DataTransfer, "types">) {
  return Array.from(dataTransfer.types ?? [], (type) => type.toLowerCase());
}

export function normalizeDroppedRepositoryPath(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_REPOSITORY_PATH_LENGTH) {
    return null;
  }

  const withSlashes = value.replaceAll("\\", "/");

  if (
    !withSlashes ||
    withSlashes.includes("\0") ||
    withSlashes.startsWith("/") ||
    /^[a-z]:\//iu.test(withSlashes)
  ) {
    return null;
  }

  const segments = withSlashes.split("/");
  if (segments.some((segment) => segment === "..")) {
    return null;
  }

  const normalized = segments
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

  return normalized || null;
}

export function createProjectFileDragPayload(input: {
  projectId: number;
  path: string;
}): ContextForgeProjectFileDragPayload | null {
  const path = normalizeDroppedRepositoryPath(input.path);

  if (!Number.isInteger(input.projectId) || input.projectId <= 0 || !path) {
    return null;
  }

  return {
    version: DRAG_PAYLOAD_VERSION,
    kind: "project-file",
    projectId: input.projectId,
    path,
  };
}

export function serializeContextForgeDragPayload(
  payload: ContextForgeDragPayload,
) {
  return JSON.stringify(payload);
}

export function parseContextForgeDragPayload(
  rawValue: unknown,
): ContextForgeDragPayload | null {
  if (
    typeof rawValue !== "string" ||
    rawValue.length === 0 ||
    rawValue.length > MAX_DRAG_PAYLOAD_LENGTH
  ) {
    return null;
  }

  try {
    const value = JSON.parse(rawValue) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const expectedKeys = ["kind", "path", "projectId", "version"];
    const actualKeys = Object.keys(record).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return null;
    }

    if (record.version !== DRAG_PAYLOAD_VERSION || record.kind !== "project-file") {
      return null;
    }

    if (typeof record.projectId !== "number") {
      return null;
    }

    return createProjectFileDragPayload({
      projectId: record.projectId,
      path: typeof record.path === "string" ? record.path : "",
    });
  } catch {
    return null;
  }
}

export function readContextForgeDragPayload(
  dataTransfer: DragTransferReader,
) {
  if (!hasContextForgeProjectFileDrag(dataTransfer)) {
    return null;
  }

  try {
    return parseContextForgeDragPayload(
      dataTransfer.getData(CONTEXTFORGE_DRAG_MIME),
    );
  } catch {
    return null;
  }
}

export function writeContextForgeDragPayload(
  dataTransfer: DragTransferWriter,
  payload: ContextForgeDragPayload,
) {
  const validated = createProjectFileDragPayload(payload);
  if (!validated) return false;

  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(
    CONTEXTFORGE_DRAG_MIME,
    serializeContextForgeDragPayload(validated),
  );
  dataTransfer.setData(CONTEXTFORGE_PROJECT_FILE_DRAG_MIME, "1");
  return true;
}

export function hasContextForgeProjectFileDrag(
  dataTransfer: Pick<DataTransfer, "types">,
) {
  return transferTypes(dataTransfer).includes(
    CONTEXTFORGE_PROJECT_FILE_DRAG_MIME,
  );
}

export function hasExternalFileDrag(
  dataTransfer: Pick<DataTransfer, "types">,
) {
  return transferTypes(dataTransfer).includes("files");
}

export function isProtectedFileDrop(
  dataTransfer: Pick<DataTransfer, "types">,
) {
  return (
    hasContextForgeProjectFileDrag(dataTransfer) ||
    hasExternalFileDrag(dataTransfer)
  );
}

export function classifyContextBasketDrop(input: {
  payload: ContextForgeProjectFileDragPayload;
  projectId: number;
  selectedPaths: readonly string[];
  knownPaths: readonly string[];
}): ContextBasketDropClassification {
  if (input.payload.projectId !== input.projectId) {
    return { status: "wrong-project" };
  }

  const selected = new Set(
    input.selectedPaths.map(normalizeDroppedRepositoryPath).filter(Boolean),
  );
  if (selected.has(input.payload.path)) {
    return { status: "already-selected", path: input.payload.path };
  }

  const knownPath = input.knownPaths.find(
    (path) => normalizeDroppedRepositoryPath(path) === input.payload.path,
  );

  return knownPath
    ? { status: "known-file", path: knownPath }
    : { status: "requires-validation", path: input.payload.path };
}
