import type { ContextEngineShadowComparison, ContextEngineShadowHistoryStore } from "./shadowTypes.js";
import { validateContextEngineShadowComparison } from "./shadowTypesInvariant.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createContextEngineShadowHistory(input: {
  read(): Promise<unknown>;
  write(value: ContextEngineShadowComparison[]): Promise<void>;
  limit?: number;
}): ContextEngineShadowHistoryStore {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  let queue: Promise<unknown> = Promise.resolve();
  const readValidated = async (): Promise<ContextEngineShadowComparison[]> => {
    const value = await input.read();
    if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
      throw new Error("Context Engine shadow history is malformed.");
    }
    return value.map(validateContextEngineShadowComparison)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.comparisonId.localeCompare(left.comparisonId))
      .slice(0, limit);
  };
  return {
    async get() {
      return freeze(structuredClone(await readValidated()));
    },
    async append(record) {
      const operation = queue.then(async () => {
        const nextRecord = validateContextEngineShadowComparison(record);
        const history = await readValidated();
        const next = [nextRecord, ...history.filter((item) => item.comparisonId !== nextRecord.comparisonId)]
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.comparisonId.localeCompare(left.comparisonId))
          .slice(0, limit);
        await input.write(structuredClone(next));
        return freeze(structuredClone(next));
      });
      queue = operation.catch(() => undefined);
      return operation;
    },
    async clear() {
      const operation = queue.then(() => input.write([]));
      queue = operation.catch(() => undefined);
      await operation;
    },
  };
}
