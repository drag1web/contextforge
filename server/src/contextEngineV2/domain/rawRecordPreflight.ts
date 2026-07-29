import type {
  FactRecord,
  RepositoryEntity,
} from "../contracts/index.js";

export class RawRecordPreflightError extends Error {
  constructor() {
    super("Raw knowledge record failed descriptor-safe preflight.");
    this.name = "RawRecordPreflightError";
  }
}

type DescriptorMap = Map<PropertyKey, PropertyDescriptor>;

const ENTITY_FIELDS = new Set([
  "id",
  "snapshotId",
  "kind",
  "displayName",
  "canonicalName",
  "fileId",
  "attributes",
]);
const ENTITY_REQUIRED_FIELDS = new Set([
  "id",
  "snapshotId",
  "kind",
  "displayName",
]);
const FACT_FIELDS = new Set([
  "kind",
  "id",
  "snapshotId",
  "subject",
  "predicate",
  "object",
  "source",
  "provenance",
  "strength",
  "status",
  "attributes",
]);
const SOURCE_SPAN_FIELDS = new Set([
  "kind",
  "snapshotId",
  "fileId",
  "path",
  "startLine",
  "startColumn",
  "endLine",
  "endColumn",
  "contentFingerprint",
  "excerptHash",
]);
const SOURCE_SPAN_REQUIRED_FIELDS = new Set([
  "kind",
  "snapshotId",
  "fileId",
  "path",
  "startLine",
  "startColumn",
  "endLine",
  "endColumn",
  "contentFingerprint",
]);
const METADATA_SOURCE_FIELDS = new Set([
  "kind",
  "snapshotId",
  "reference",
  "fingerprint",
]);
const PROVENANCE_FIELDS = new Set([
  "extractorId",
  "extractorVersion",
  "method",
  "observedAt",
  "parentFactIds",
  "operationId",
]);
const PROVENANCE_REQUIRED_FIELDS = new Set([
  "extractorId",
  "extractorVersion",
  "method",
  "observedAt",
]);
const LITERAL_FIELDS = new Set(["type", "value"]);

function fail(): never {
  throw new RawRecordPreflightError();
}

function dataValue(
  descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>,
  key: PropertyKey,
): unknown {
  const descriptor = descriptors.get(key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function assertEnumerableContractFields(
  descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>,
  contractFields: ReadonlySet<string>,
  requiredFields: ReadonlySet<string>,
): void {
  for (const field of requiredFields) {
    if (!descriptors.has(field)) fail();
  }
  for (const field of contractFields) {
    const descriptor = descriptors.get(field);
    if (descriptor && !descriptor.enumerable) fail();
  }
}

function inspectRecord(
  value: unknown,
  ancestors: WeakSet<object>,
  inspect: (descriptors: DescriptorMap) => void,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail();
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    if (ancestors.has(value)) fail();
    ancestors.add(value);
    const descriptors = new Map<PropertyKey, PropertyDescriptor>();
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) fail();
      if (typeof key === "symbol" && descriptor.enumerable) fail();
      descriptors.set(key, descriptor);
    }
    inspect(descriptors);
    ancestors.delete(value);
  } catch (error) {
    ancestors.delete(value);
    if (error instanceof RawRecordPreflightError) throw error;
    fail();
  }
}

function inspectJsonValue(value: unknown, ancestors: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail();
      if (ancestors.has(value)) fail();
      ancestors.add(value);
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === "symbol")) fail();
      for (const key of ownKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) fail();
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) fail();
        if (!descriptor.enumerable) fail();
        inspectJsonValue(descriptor.value, ancestors);
      }
      ancestors.delete(value);
      return;
    } catch (error) {
      ancestors.delete(value);
      if (error instanceof RawRecordPreflightError) throw error;
      fail();
    }
  }
  inspectRecord(value, ancestors, (descriptors) => {
    for (const [key, descriptor] of descriptors) {
      if (typeof key !== "string" || !descriptor.enumerable) fail();
      inspectJsonValue(descriptor.value, ancestors);
    }
  });
}

function inspectStringArray(value: unknown, ancestors: WeakSet<object>): void {
  if (!Array.isArray(value)) fail();
  inspectJsonValue(value, ancestors);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      fail();
    }
  }
}

function inspectEntity(value: unknown, ancestors: WeakSet<object>): void {
  inspectRecord(value, ancestors, (descriptors) => {
    assertEnumerableContractFields(
      descriptors,
      ENTITY_FIELDS,
      ENTITY_REQUIRED_FIELDS,
    );
    const attributes = dataValue(descriptors, "attributes");
    if (attributes !== undefined) inspectJsonValue(attributes, ancestors);
  });
}

function inspectSource(value: unknown, ancestors: WeakSet<object>): void {
  inspectRecord(value, ancestors, (descriptors) => {
    const kind = dataValue(descriptors, "kind");
    if (kind === "source_span") {
      assertEnumerableContractFields(
        descriptors,
        SOURCE_SPAN_FIELDS,
        SOURCE_SPAN_REQUIRED_FIELDS,
      );
    } else if (kind === "repository_metadata") {
      assertEnumerableContractFields(
        descriptors,
        METADATA_SOURCE_FIELDS,
        METADATA_SOURCE_FIELDS,
      );
    }
  });
}

function inspectProvenance(value: unknown, ancestors: WeakSet<object>): void {
  inspectRecord(value, ancestors, (descriptors) => {
    assertEnumerableContractFields(
      descriptors,
      PROVENANCE_FIELDS,
      PROVENANCE_REQUIRED_FIELDS,
    );
    const parentFactIds = dataValue(descriptors, "parentFactIds");
    if (parentFactIds !== undefined) {
      inspectStringArray(parentFactIds, ancestors);
    }
  });
}

function inspectLiteral(value: unknown, ancestors: WeakSet<object>): void {
  inspectRecord(value, ancestors, (descriptors) => {
    assertEnumerableContractFields(descriptors, LITERAL_FIELDS, LITERAL_FIELDS);
    if (dataValue(descriptors, "type") === "json") {
      inspectJsonValue(dataValue(descriptors, "value"), ancestors);
    }
  });
}

export function assertDescriptorSafeRepositoryEntityRecord(
  value: unknown,
): asserts value is RepositoryEntity {
  inspectEntity(value, new WeakSet<object>());
}

export function assertDescriptorSafeFactRecord(
  value: unknown,
): asserts value is FactRecord {
  const ancestors = new WeakSet<object>();
  inspectRecord(value, ancestors, (descriptors) => {
    assertEnumerableContractFields(descriptors, FACT_FIELDS, FACT_FIELDS);
    inspectEntity(dataValue(descriptors, "subject"), ancestors);
    const kind = dataValue(descriptors, "kind");
    if (kind === "relation") {
      inspectEntity(dataValue(descriptors, "object"), ancestors);
    } else if (kind === "fact") {
      inspectLiteral(dataValue(descriptors, "object"), ancestors);
    }
    inspectSource(dataValue(descriptors, "source"), ancestors);
    inspectProvenance(dataValue(descriptors, "provenance"), ancestors);
    inspectJsonValue(dataValue(descriptors, "attributes"), ancestors);
  });
}
