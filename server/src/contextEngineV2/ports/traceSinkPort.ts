import type {
  InvestigationId,
  InvestigationRequestId,
  SnapshotId,
  StopReason,
} from "../contracts/index.js";

interface TraceEventBase {
  investigationId: InvestigationId;
  requestId: InvestigationRequestId;
  snapshotId: SnapshotId;
  occurredAt: string;
}

export interface InvestigationInitializedTraceEvent extends TraceEventBase {
  type: "investigation_initialized";
}

export interface InvestigationStoppedTraceEvent extends TraceEventBase {
  type: "investigation_stopped";
  stopReason: StopReason;
}

export type ContextEngineTraceEvent =
  | InvestigationInitializedTraceEvent
  | InvestigationStoppedTraceEvent;

export interface TraceSinkPort {
  record(event: ContextEngineTraceEvent): void | Promise<void>;
}
