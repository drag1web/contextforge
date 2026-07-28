import type {
  ClockPort,
  ContextEngineTraceEvent,
  IdGeneratorPort,
  TraceSinkPort,
} from "../ports/index.js";

export class FixedClock implements ClockPort {
  constructor(
    private readonly isoTimestamp: string,
    private readonly monotonicTimestamp = 0,
  ) {}

  nowIso(): string {
    return this.isoTimestamp;
  }

  monotonicMs(): number {
    return this.monotonicTimestamp;
  }
}

export class SequenceIdGenerator implements IdGeneratorPort {
  private nextValue = 1;

  next(prefix: string): string {
    const value = `${prefix}-${this.nextValue}`;
    this.nextValue += 1;
    return value;
  }
}

export class CollectingTraceSink implements TraceSinkPort {
  readonly events: ContextEngineTraceEvent[] = [];

  record(event: ContextEngineTraceEvent): void {
    this.events.push(event);
  }
}
