import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type PerformanceOperation =
  "task_understanding_preflight" | "task_pack_generation";

export type PerformanceStageStatus = "success" | "error";
export type PerformanceCacheOutcome = "hit" | "miss" | "bypass" | "unavailable";
export type PerformanceModelState = "cold" | "warm" | "unknown";

export type PerformanceMetadataValue = string | number | boolean | null;

export interface PerformanceStageDiagnostics {
  id: string;
  name: string;
  label: string;
  startOffsetMs: number;
  durationMs: number;
  status: PerformanceStageStatus;
  metadata: Record<string, PerformanceMetadataValue>;
}

export interface PerformanceAiCallDiagnostics {
  id: string;
  purpose: string;
  provider: string;
  model: string | null;
  startOffsetMs: number;
  durationMs: number;
  promptChars: number;
  responseChars: number;
  responseFormat: "text" | "json";
  numPredict: number | null;
  success: boolean;
  httpStatus: number | null;
  modelState: PerformanceModelState;
  modelLoadMs: number | null;
  promptEvalMs: number | null;
  generationMs: number | null;
  promptTokens: number | null;
  responseTokens: number | null;
  errorCode: string | null;
}

export interface PerformanceCacheEventDiagnostics {
  id: string;
  layer: string;
  outcome: PerformanceCacheOutcome;
  offsetMs: number;
  durationMs: number | null;
}

export interface PerformanceRequestDiagnostics {
  id: string;
  operation: PerformanceOperation;
  startedAt: string;
  totalDurationMs: number;
  stages: PerformanceStageDiagnostics[];
  aiCalls: PerformanceAiCallDiagnostics[];
  cacheEvents: PerformanceCacheEventDiagnostics[];
  metadata: Record<string, PerformanceMetadataValue>;
  summary: {
    stageCount: number;
    aiCallCount: number;
    aiDurationMs: number;
    cacheHits: number;
    cacheMisses: number;
    coldAiCalls: number;
    warmAiCalls: number;
  };
}

export interface PerformanceSessionDiagnostics {
  version: 1;
  sessionId: string;
  startedAt: string;
  totalObservedDurationMs: number;
  requestCount: number;
  requests: PerformanceRequestDiagnostics[];
  summary: {
    stageCount: number;
    aiCallCount: number;
    aiDurationMs: number;
    inventoryScans: number;
    inventoryDurationMs: number;
    cacheHits: number;
    cacheMisses: number;
    coldAiCalls: number;
    warmAiCalls: number;
    totalPromptChars: number;
    totalResponseChars: number;
  };
  privacy: {
    rawPromptsStored: false;
    rawResponsesStored: false;
    sourceCodeStored: false;
    absolutePathsStored: false;
  };
}

interface MutablePerformanceTrace {
  id: string;
  sessionId: string;
  operation: PerformanceOperation;
  startedAtIso: string;
  startedAtMs: number;
  stages: PerformanceStageDiagnostics[];
  aiCalls: PerformanceAiCallDiagnostics[];
  cacheEvents: PerformanceCacheEventDiagnostics[];
  metadata: Record<string, PerformanceMetadataValue>;
}

interface BeginAiCallInput {
  purpose: string;
  provider: string;
  model: string | null;
  promptChars: number;
  responseFormat: "text" | "json";
  numPredict?: number;
}

interface FinishAiCallInput {
  responseChars?: number;
  success: boolean;
  httpStatus?: number | null;
  modelState?: PerformanceModelState;
  modelLoadMs?: number | null;
  promptEvalMs?: number | null;
  generationMs?: number | null;
  promptTokens?: number | null;
  responseTokens?: number | null;
  errorCode?: string | null;
}

const traceStorage = new AsyncLocalStorage<MutablePerformanceTrace>();
const sessionStore = new Map<
  string,
  { createdAt: number; requests: PerformanceRequestDiagnostics[] }
>();

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 80;
const MAX_REQUESTS_PER_SESSION = 12;

function roundDuration(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

function nowOffset(trace: MutablePerformanceTrace) {
  return roundDuration(performance.now() - trace.startedAtMs);
}

function sanitizeMetadata(
  metadata: Record<string, PerformanceMetadataValue> | undefined,
) {
  const safe: Record<string, PerformanceMetadataValue> = {};

  for (const [key, value] of Object.entries(metadata ?? {}).slice(0, 24)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key.slice(0, 80)] =
        typeof value === "string" ? value.slice(0, 240) : value;
    }
  }

  return safe;
}

function cleanupSessions() {
  const now = Date.now();

  for (const [sessionId, session] of sessionStore) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessionStore.delete(sessionId);
    }
  }

  while (sessionStore.size >= MAX_SESSIONS) {
    const oldestKey = sessionStore.keys().next().value;
    if (!oldestKey) break;
    sessionStore.delete(oldestKey);
  }
}

function summarizeRequest(
  trace: MutablePerformanceTrace,
  totalDurationMs: number,
): PerformanceRequestDiagnostics {
  const aiDurationMs = roundDuration(
    trace.aiCalls.reduce((sum, call) => sum + call.durationMs, 0),
  );

  return {
    id: trace.id,
    operation: trace.operation,
    startedAt: trace.startedAtIso,
    totalDurationMs: roundDuration(totalDurationMs),
    stages: [...trace.stages],
    aiCalls: [...trace.aiCalls],
    cacheEvents: [...trace.cacheEvents],
    metadata: { ...trace.metadata },
    summary: {
      stageCount: trace.stages.length,
      aiCallCount: trace.aiCalls.length,
      aiDurationMs,
      cacheHits: trace.cacheEvents.filter((event) => event.outcome === "hit")
        .length,
      cacheMisses: trace.cacheEvents.filter((event) => event.outcome === "miss")
        .length,
      coldAiCalls: trace.aiCalls.filter((call) => call.modelState === "cold")
        .length,
      warmAiCalls: trace.aiCalls.filter((call) => call.modelState === "warm")
        .length,
    },
  };
}

function buildSessionDiagnostics(
  sessionId: string,
): PerformanceSessionDiagnostics {
  const session = sessionStore.get(sessionId);
  const requests = session?.requests ?? [];
  const stages = requests.flatMap((request) => request.stages);
  const aiCalls = requests.flatMap((request) => request.aiCalls);
  const cacheEvents = requests.flatMap((request) => request.cacheEvents);
  const inventoryStages = stages.filter(
    (stage) => stage.name === "project_inventory",
  );

  return {
    version: 1,
    sessionId,
    startedAt: requests[0]?.startedAt ?? new Date().toISOString(),
    totalObservedDurationMs: roundDuration(
      requests.reduce((sum, request) => sum + request.totalDurationMs, 0),
    ),
    requestCount: requests.length,
    requests,
    summary: {
      stageCount: stages.length,
      aiCallCount: aiCalls.length,
      aiDurationMs: roundDuration(
        aiCalls.reduce((sum, call) => sum + call.durationMs, 0),
      ),
      inventoryScans: inventoryStages.length,
      inventoryDurationMs: roundDuration(
        inventoryStages.reduce((sum, stage) => sum + stage.durationMs, 0),
      ),
      cacheHits: cacheEvents.filter((event) => event.outcome === "hit").length,
      cacheMisses: cacheEvents.filter((event) => event.outcome === "miss")
        .length,
      coldAiCalls: aiCalls.filter((call) => call.modelState === "cold").length,
      warmAiCalls: aiCalls.filter((call) => call.modelState === "warm").length,
      totalPromptChars: aiCalls.reduce(
        (sum, call) => sum + call.promptChars,
        0,
      ),
      totalResponseChars: aiCalls.reduce(
        (sum, call) => sum + call.responseChars,
        0,
      ),
    },
    privacy: {
      rawPromptsStored: false,
      rawResponsesStored: false,
      sourceCodeStored: false,
      absolutePathsStored: false,
    },
  };
}

export function createPerformanceSessionId() {
  return crypto.randomUUID();
}

export async function runWithPerformanceTrace<T>(
  input: {
    operation: PerformanceOperation;
    sessionId?: string;
    metadata?: Record<string, PerformanceMetadataValue>;
  },
  callback: () => Promise<T>,
): Promise<{
  value: T;
  requestDiagnostics: PerformanceRequestDiagnostics;
  sessionDiagnostics: PerformanceSessionDiagnostics;
}> {
  cleanupSessions();

  const sessionId = input.sessionId?.trim() || createPerformanceSessionId();
  const trace: MutablePerformanceTrace = {
    id: crypto.randomUUID(),
    sessionId,
    operation: input.operation,
    startedAtIso: new Date().toISOString(),
    startedAtMs: performance.now(),
    stages: [],
    aiCalls: [],
    cacheEvents: [],
    metadata: sanitizeMetadata(input.metadata),
  };

  let value!: T;
  let thrown: unknown;

  await traceStorage.run(trace, async () => {
    try {
      value = await callback();
    } catch (error) {
      thrown = error;
    }
  });

  const requestDiagnostics = summarizeRequest(
    trace,
    performance.now() - trace.startedAtMs,
  );
  const session = sessionStore.get(sessionId) ?? {
    createdAt: Date.now(),
    requests: [],
  };

  session.requests.push(requestDiagnostics);
  session.requests = session.requests.slice(-MAX_REQUESTS_PER_SESSION);
  sessionStore.set(sessionId, session);
  const sessionDiagnostics = buildSessionDiagnostics(sessionId);

  if (thrown) {
    throw thrown;
  }

  return { value, requestDiagnostics, sessionDiagnostics };
}

export async function measurePerformanceStage<T>(
  name: string,
  label: string,
  callback: () => Promise<T> | T,
  metadata?: Record<string, PerformanceMetadataValue>,
): Promise<T> {
  const trace = traceStorage.getStore();

  if (!trace) {
    return await callback();
  }

  const startedAt = performance.now();
  const startOffsetMs = nowOffset(trace);

  try {
    const value = await callback();
    trace.stages.push({
      id: crypto.randomUUID(),
      name,
      label,
      startOffsetMs,
      durationMs: roundDuration(performance.now() - startedAt),
      status: "success",
      metadata: sanitizeMetadata(metadata),
    });
    return value;
  } catch (error) {
    trace.stages.push({
      id: crypto.randomUUID(),
      name,
      label,
      startOffsetMs,
      durationMs: roundDuration(performance.now() - startedAt),
      status: "error",
      metadata: sanitizeMetadata(metadata),
    });
    throw error;
  }
}

export function setPerformanceMetadata(
  metadata: Record<string, PerformanceMetadataValue>,
) {
  const trace = traceStorage.getStore();
  if (!trace) return;
  Object.assign(trace.metadata, sanitizeMetadata(metadata));
}

export function recordPerformanceCacheEvent(input: {
  layer: string;
  outcome: PerformanceCacheOutcome;
  durationMs?: number | null;
}) {
  const trace = traceStorage.getStore();
  if (!trace) return;

  trace.cacheEvents.push({
    id: crypto.randomUUID(),
    layer: input.layer.slice(0, 120),
    outcome: input.outcome,
    offsetMs: nowOffset(trace),
    durationMs:
      input.durationMs == null ? null : roundDuration(input.durationMs),
  });
}

export function beginPerformanceAiCall(input: BeginAiCallInput) {
  const trace = traceStorage.getStore();
  if (!trace) return null;

  return {
    trace,
    id: crypto.randomUUID(),
    startedAt: performance.now(),
    startOffsetMs: nowOffset(trace),
    input,
    finished: false,
  };
}

export function finishPerformanceAiCall(
  handle: ReturnType<typeof beginPerformanceAiCall>,
  input: FinishAiCallInput,
) {
  if (!handle || handle.finished) return;
  handle.finished = true;

  const modelLoadMs = input.modelLoadMs ?? null;
  const modelState =
    input.modelState ??
    (modelLoadMs == null ? "unknown" : modelLoadMs >= 1000 ? "cold" : "warm");

  handle.trace.aiCalls.push({
    id: handle.id,
    purpose: handle.input.purpose.slice(0, 120),
    provider: handle.input.provider.slice(0, 80),
    model: handle.input.model?.slice(0, 180) ?? null,
    startOffsetMs: handle.startOffsetMs,
    durationMs: roundDuration(performance.now() - handle.startedAt),
    promptChars: Math.max(0, handle.input.promptChars),
    responseChars: Math.max(0, input.responseChars ?? 0),
    responseFormat: handle.input.responseFormat,
    numPredict: handle.input.numPredict ?? null,
    success: input.success,
    httpStatus: input.httpStatus ?? null,
    modelState,
    modelLoadMs,
    promptEvalMs: input.promptEvalMs ?? null,
    generationMs: input.generationMs ?? null,
    promptTokens: input.promptTokens ?? null,
    responseTokens: input.responseTokens ?? null,
    errorCode: input.errorCode?.slice(0, 120) ?? null,
  });
}

export function getCurrentPerformanceSessionId() {
  return traceStorage.getStore()?.sessionId ?? null;
}
