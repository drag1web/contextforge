import {
  prepareContextEngineShadowInput, isPreparedContextEngineShadowInput,
  assertContextEngineShadowInputEquivalent,
} from "../shadow/shadowInputPreparation.js";
import type { PrepareContextEngineShadowInput } from "../shadow/shadowInputPreparation.js";
import type { ContextEngineShadowCanonicalInput } from "../shadow/shadowTypes.js";
import type { EntityId, SnapshotId } from "../contracts/ids.js";
import { boundaryRecord, boundaryDigest, boundaryHash, boundaryPath, PrimaryBoundaryError } from "../validation/realWorld/primaryBoundaryData.js";
import { describeSyntheticSourceReadBasis } from "../validation/realWorld/primaryReadOnlyBoundary.js";
import type { createPrimaryReadOnlyBoundary, SyntheticSourceReadPermit } from "../validation/realWorld/primaryReadOnlyBoundary.js";
import { createPrimarySyntheticRepositoryPorts } from "../validation/realWorld/primarySyntheticRepositoryPorts.js";
import type { SyntheticReadSnapshot } from "../validation/realWorld/primarySyntheticRepositoryPorts.js";

export const SYNTHETIC_CANONICAL_BINDING_PROFILE = "rw02-s2-synthetic-canonical-binding" as const;
export type SyntheticCanonicalPreparationRequest = Required<Pick<PrepareContextEngineShadowInput,
  "normalizedTask" | "clarificationBasis" | "structuredTargets" | "protectedScopes" | "executionBasis" | "createdAt">>;
export interface SyntheticCanonicalSourceWitness {
  readonly profileId: typeof SYNTHETIC_CANONICAL_BINDING_PROFILE;
  readonly provenance: "authenticated_synthetic_bytes_to_owned_inventory";
  readonly executionAuthority: "none";
  readonly metadataIsByteSeal: false;
  readonly sourceDigest: string;
  readonly sourceSnapshotId: SnapshotId;
  readonly canonicalSnapshotId: SnapshotId;
  readonly canonicalStateDigest: string;
  readonly files: readonly Readonly<{
    path: string; bytes: number; byteDigest: string; metadataFingerprint: string;
    sourceFileId: EntityId; canonicalFileId: EntityId;
  }>[];
}
export class SyntheticCanonicalBindingError extends Error {
  constructor(readonly code: "canonical_not_issued" | "canonical_mismatch" | "canonical_changed" | "mapping_mismatch" | "provenance_unavailable" | "binding_closed") {
    super(code); this.name = "SyntheticCanonicalBindingError";
  }
}

// Capture only bounded plain DATA, never invoke toJSON/getters or copy callbacks.
// This is not a sandbox against hostile Proxies or modified realm built-ins.
function captureData(raw: unknown, depth = 0, budget = { nodes: 0, bytes: 0 }): unknown {
  if (++budget.nodes > 8192 || depth > 12) throw new PrimaryBoundaryError("invalid_input");
  if (typeof raw === "string") {
    budget.bytes += Buffer.byteLength(raw, "utf8");
    if (budget.bytes > 256 * 1024) throw new PrimaryBoundaryError("invalid_input");
    return raw;
  }
  if (raw === null || typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) return raw;
  if (typeof raw !== "object" || raw === null) throw new PrimaryBoundaryError("invalid_input");
  const array = Array.isArray(raw), prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new PrimaryBoundaryError("invalid_input");
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (array) {
    const length = fields.length.value as number;
    if (!Number.isSafeInteger(length) || length > 1024 || Reflect.ownKeys(fields).length !== length + 1) throw new PrimaryBoundaryError("invalid_input");
    return Array.from({ length }, (_, index) => {
      const field = fields[String(index)];
      if (!field || !("value" in field) || !field.enumerable) throw new PrimaryBoundaryError("invalid_input");
      return captureData(field.value, depth + 1, budget);
    });
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== "string" || !("value" in fields[key]) || !fields[key].enumerable) throw new PrimaryBoundaryError("invalid_input");
    result[key] = captureData(fields[key].value, depth + 1, budget);
  }
  return result;
}
function canonicalState(canonical: ContextEngineShadowCanonicalInput): string {
  if (!isPreparedContextEngineShadowInput(canonical)) throw new SyntheticCanonicalBindingError("canonical_not_issued");
  const state = boundaryHash(JSON.stringify(captureData(canonical)));
  try { assertContextEngineShadowInputEquivalent(canonical); }
  catch { throw new SyntheticCanonicalBindingError("canonical_mismatch"); }
  return state;
}

/** Request-local provenance custody, NOT a second canonical issuer or Primary session. */
export function createSyntheticCanonicalSourceBinding(raw: unknown) {
  const input = boundaryRecord(raw, ["boundary", "permit", "sourceDigest"]);
  const basis = describeSyntheticSourceReadBasis(input.boundary, input.permit);
  if (boundaryDigest(input.sourceDigest) !== basis.sourceDigest) throw new PrimaryBoundaryError("source_mismatch");
  const boundary = input.boundary as ReturnType<typeof createPrimaryReadOnlyBoundary>;
  const permit = input.permit as SyntheticSourceReadPermit;
  let closed = false;
  // Only association witnesses are registered here. The original production
  // preparedCanonicalInputs WeakSet remains the sole canonical identity issuer.
  const witnesses = new WeakMap<object, { canonical: ContextEngineShadowCanonicalInput; state: string; sourceSnapshot: SyntheticReadSnapshot }>();
  function sourceBasis() {
    if (closed) throw new SyntheticCanonicalBindingError("binding_closed");
    const current = describeSyntheticSourceReadBasis(boundary, permit);
    if (current.sourceDigest !== basis.sourceDigest ||
        boundaryHash(JSON.stringify(current.files.map(({ path, bytes: size, digest }) => ({ path, bytes: size, digest })))) !== basis.sourceDigest) {
      throw new PrimaryBoundaryError("source_mismatch");
    }
    return current;
  }
  function sourceFile(path: string, bytes: number, digest: string) {
    const file = boundary.readSource(permit, boundaryPath(path));
    if (!file || file.path !== path || file.bytes !== bytes || Buffer.byteLength(file.content, "utf8") !== bytes ||
        file.digest !== digest || boundaryHash(file.content) !== digest) throw new PrimaryBoundaryError("source_mismatch");
    return file;
  }
  function mapping(canonical: ContextEngineShadowCanonicalInput, snapshot: SyntheticReadSnapshot) {
    const current = sourceBasis(), inventory = canonical.inventory, metadata = canonical.snapshot;
    if (inventory.truncated || inventory.totalFiles !== current.files.length || inventory.scannedFiles !== current.files.length ||
        inventory.files.length !== current.files.length || metadata.files.length !== current.files.length ||
        snapshot.files.length !== current.files.length || snapshot.sourceDigest !== current.sourceDigest || metadata.truncation.truncated ||
        metadata.source !== "legacy_inventory_adapter" || metadata.metadata.fingerprintKind !== "metadata_derived") {
      throw new SyntheticCanonicalBindingError("mapping_mismatch");
    }
    const inventoryByPath = new Map(inventory.files.map((file) => [boundaryPath(file.path), file]));
    const metadataByPath = new Map(metadata.files.map((file) => [boundaryPath(file.normalizedPath), file]));
    const sourceByPath = new Map(snapshot.files.map((file) => [boundaryPath(file.path), file]));
    if ([inventoryByPath, metadataByPath, sourceByPath].some((index) => index.size !== current.files.length) ||
        new Set(inventory.files.map((file) => file.path.toLowerCase())).size !== current.files.length) {
      throw new SyntheticCanonicalBindingError("mapping_mismatch");
    }
    return Object.freeze(current.files.map((file) => {
      sourceFile(file.path, file.bytes, file.digest); // Actual authenticated UTF-8 bytes, not metadata inference.
      const row = inventoryByPath.get(file.path), canonicalFile = metadataByPath.get(file.path), source = sourceByPath.get(file.path);
      if (!row || !canonicalFile || !source || row.sizeBytes !== file.bytes || canonicalFile.sizeBytes !== file.bytes || source.sizeBytes !== file.bytes ||
          row.name !== file.path.split("/").at(-1) || canonicalFile.path !== file.path || canonicalFile.snapshotId !== metadata.id ||
          source.normalizedPath !== file.path || source.snapshotId !== snapshot.id || source.contentFingerprint !== file.digest ||
          !canonicalFile.contentFingerprint.startsWith("metadata-sha256:")) throw new SyntheticCanonicalBindingError("mapping_mismatch");
      return Object.freeze({ path: file.path, bytes: file.bytes, byteDigest: file.digest, metadataFingerprint: canonicalFile.contentFingerprint,
        sourceFileId: source.id, canonicalFileId: canonicalFile.id });
    }));
  }
  return Object.freeze({
    prepare(rawRequest: unknown): Readonly<{ canonical: ContextEngineShadowCanonicalInput; witness: SyntheticCanonicalSourceWitness }> {
      const request = captureData(boundaryRecord(rawRequest, ["normalizedTask", "clarificationBasis", "structuredTargets", "protectedScopes", "executionBasis", "createdAt"])) as SyntheticCanonicalPreparationRequest;
      const current = sourceBasis();
      // Lexical fixture root only: no path is opened, created or scanned. Neither
      // this inventory nor the production metadata snapshot is a scanner result.
      const root = `/__synthetic_canonical_only__/${current.sourceDigest.slice(7)}`;
      const inventory: PrepareContextEngineShadowInput["inventory"] = { rootPath: root, totalFiles: current.files.length, scannedFiles: current.files.length,
        truncated: false, notes: ["Synthetic source fixture; scanner metadata unavailable."],
        files: current.files.map((file) => ({ path: file.path, name: file.path.split("/").at(-1)!, extension: `.${file.path.split(".").at(-1)!}`,
          kind: "unknown", role: "unknown", imports: [], exports: [], symbols: [], textHints: [],
          sizeBytes: file.bytes, depth: file.path.split("/").length - 1, canReadText: true, isLikelyGenerated: false,
          contentPreview: sourceFile(file.path, file.bytes, file.digest).content,
        })),
      };
      const canonical = prepareContextEngineShadowInput({ ...request, projectId: `synthetic-${current.sourceDigest.slice(7)}`, projectRoot: root, inventory });
      const state = canonicalState(canonical);
      const sourceSnapshot = createPrimarySyntheticRepositoryPorts({ boundary, permit, sourceDigest: current.sourceDigest,
        negativeConstraints: canonical.negativeConstraints }).snapshot;
      const witness: SyntheticCanonicalSourceWitness = Object.freeze({ profileId: SYNTHETIC_CANONICAL_BINDING_PROFILE,
        provenance: "authenticated_synthetic_bytes_to_owned_inventory", executionAuthority: "none", metadataIsByteSeal: false,
        sourceDigest: current.sourceDigest, sourceSnapshotId: sourceSnapshot.id, canonicalSnapshotId: canonical.snapshot.id,
        canonicalStateDigest: state, files: mapping(canonical, sourceSnapshot),
      });
      witnesses.set(witness, { canonical, state, sourceSnapshot });
      return Object.freeze({ canonical, witness });
    },
    verify(rawVerification: unknown): SyntheticCanonicalSourceWitness {
      sourceBasis();
      const supplied = boundaryRecord(rawVerification, ["witness", "canonical", "boundary", "permit", "sourceDigest"]);
      const record = witnesses.get(supplied.witness as object);
      if (!record) throw new PrimaryBoundaryError("capability_rejected");
      if (supplied.boundary !== boundary || supplied.permit !== permit || boundaryDigest(supplied.sourceDigest) !== basis.sourceDigest) {
        throw new PrimaryBoundaryError("source_mismatch");
      }
      const state = canonicalState(supplied.canonical as ContextEngineShadowCanonicalInput);
      if (supplied.canonical !== record.canonical) throw new SyntheticCanonicalBindingError("provenance_unavailable");
      if (state !== record.state) throw new SyntheticCanonicalBindingError("canonical_changed");
      const witness = supplied.witness as SyntheticCanonicalSourceWitness;
      if (JSON.stringify(mapping(record.canonical, record.sourceSnapshot)) !== JSON.stringify(witness.files)) throw new SyntheticCanonicalBindingError("mapping_mismatch");
      return witness;
    },
    close() { closed = true; }, // Revokes association only, never B1 read authority.
  });
}
