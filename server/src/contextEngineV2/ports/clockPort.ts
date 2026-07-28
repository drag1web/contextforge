export interface ClockPort {
  nowIso(): string;
  monotonicMs(): number;
}
