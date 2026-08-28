import type { TaskPackPrimaryDecision, TaskPackPrimaryHistoryStore } from "./retirementTypes.js";
import { validateTaskPackPrimaryDecision } from "./primaryInvariant.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createTaskPackPrimaryHistory(input: {
  read(): Promise<unknown>;
  write(value: TaskPackPrimaryDecision[]): Promise<void>;
  limit?: number;
}): TaskPackPrimaryHistoryStore {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  let serial: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<TaskPackPrimaryDecision[]> => {
    const value = await input.read();
    if (!Array.isArray(value) || Object.keys(value).length !== value.length) throw new Error("Malformed primary history.");
    return value.map(validateTaskPackPrimaryDecision)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.decisionId.localeCompare(left.decisionId))
      .slice(0, limit);
  };
  return {
    async get() { return freeze(structuredClone(await read())); },
    async append(record) {
      const operation = serial.then(async () => {
        const nextRecord = validateTaskPackPrimaryDecision(record);
        const current = await read();
        const next = [nextRecord, ...current.filter((item) => item.decisionId !== nextRecord.decisionId)]
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.decisionId.localeCompare(left.decisionId))
          .slice(0, limit);
        await input.write(structuredClone(next));
        return freeze(structuredClone(next));
      });
      serial = operation.catch(() => undefined);
      return operation;
    },
    async clear() {
      const operation = serial.then(() => input.write([]));
      serial = operation.catch(() => undefined);
      await operation;
    },
  };
}
