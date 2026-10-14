import { createHash } from "node:crypto";
import type { EntityId, SnapshotId } from "../../contracts/ids.js";
import type { FileDescriptor } from "../../contracts/repository.js";
import type { RepositoryReaderPort, ReadFileRequest, ReadRangeRequest, RepositoryReadResult, RepositoryReadFailure } from "../../ports/repositoryReaderPort.js";
import type { RepositorySearchPort } from "../../ports/repositorySearchPort.js";
import type { InvestigationCancellationPort } from "../../ports/investigationCancellationPort.js";
import type { NegativeConstraint } from "../../contracts/task.js";
import { createLiveRepositorySearch } from "../../adapters/liveShadow/liveRepositorySearch.js";
import type { LiveRepositorySearchInput } from "../../adapters/liveShadow/liveRepositorySearch.js";
import { boundaryRecord, boundaryDigest, boundaryHash, boundaryPath, PrimaryBoundaryError } from "./primaryBoundaryData.js";
import { describeSyntheticSourceReadBasis } from "./primaryReadOnlyBoundary.js";
import type { createPrimaryReadOnlyBoundary, SyntheticSourceReadPermit } from "./primaryReadOnlyBoundary.js";

export const SYNTHETIC_REPOSITORY_PORT_PROFILE = "rw02b3-synthetic-repository-ports" as const;
export const PRODUCTION_SEARCH_STATUS = "CONNECTED — SYNTHETIC_PATH_METADATA_ONLY" as const;
export const SYNTHETIC_SEARCH_COVERAGE = Object.freeze({
  searchPaths: "path_and_derived_name",
  searchText: "path_only",
  searchSymbols: "path_only",
  unavailableFields: Object.freeze(["textHints", "semanticFacts", "symbols", "exports", "imports"]),
  noMatchIsAbsenceEvidence: false,
} as const);
// Match the live reader's request ceiling, NOT a change to CE2 policy budgets.
const MAX_READ_REQUEST_BYTES = 16 * 1024 * 1024;
type ReadDescriptor = Readonly<Pick<FileDescriptor, "id" | "snapshotId" | "path" | "normalizedPath" | "sizeBytes" | "contentFingerprint">>;
export interface SyntheticReadSnapshot {
  readonly id: SnapshotId;
  readonly source: "test_fixture";
  readonly sourceDigest: string;
  readonly files: readonly ReadDescriptor[];
}
export interface SyntheticRepositoryPortsInput {
  boundary: ReturnType<typeof createPrimaryReadOnlyBoundary>;
  permit: SyntheticSourceReadPermit;
  sourceDigest: string;
  negativeConstraints?: readonly NegativeConstraint[];
}

function captureNegativeConstraints(raw: unknown): NegativeConstraint[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 16) throw new PrimaryBoundaryError("invalid_input");
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).length !== raw.length + 1) throw new PrimaryBoundaryError("invalid_input");
  const constraints = Array.from({ length: raw.length }, (_, index): NegativeConstraint => {
    const field = fields[String(index)];
    if (!field || !("value" in field) || !field.enumerable) throw new PrimaryBoundaryError("invalid_input");
    const kind = Object.getOwnPropertyDescriptor(field.value ?? {}, "kind")?.value;
    const value = boundaryRecord(field.value, kind === "path" ? ["kind", "pattern"] : ["kind", "description"]);
    if (value.kind === "path" && typeof value.pattern === "string" && value.pattern.length <= 160 &&
        /^[A-Za-z0-9_.*\/\\-]*$/u.test(value.pattern) && !/^[\/\\]|(?:^|[\/\\])\.{1,2}(?:[\/\\]|$)/u.test(value.pattern)) {
      return Object.freeze({ kind: "path", pattern: value.pattern });
    }
    if (value.kind === "semantic" && typeof value.description === "string" && value.description.length <= 160) {
      return Object.freeze({ kind: "semantic", description: value.description });
    }
    throw new PrimaryBoundaryError("invalid_input");
  });
  Object.freeze(constraints);
  return constraints;
}

function readRequest(raw: unknown, range: boolean): ReadFileRequest | ReadRangeRequest {
  const value = boundaryRecord(raw, range
    ? ["snapshotId", "fileId", "path", "expectedFingerprint", "maxBytes", "startLine", "endLine"]
    : ["snapshotId", "fileId", "path", "expectedFingerprint", "maxBytes"]);
  if (typeof value.snapshotId !== "string" || !/^synthetic_snapshot_[a-f0-9]{64}$/u.test(value.snapshotId) ||
      typeof value.fileId !== "string" || !/^synthetic_file_[a-f0-9]{64}$/u.test(value.fileId)) {
    throw new PrimaryBoundaryError("invalid_input");
  }
  // Reject malformed envelopes without calling getters or echoing unsafe paths.
  boundaryPath(value.path);
  boundaryDigest(value.expectedFingerprint);
  return value as unknown as ReadFileRequest | ReadRangeRequest;
}
function failure(request: ReadFileRequest, reason: RepositoryReadFailure["reason"]): RepositoryReadFailure {
  return Object.freeze({ status: "failure", snapshotId: request.snapshotId, fileId: request.fileId, path: request.path,
    reason, message: `Repository read failed: ${reason}.` });
}

/** Source-only mechanical ports. NOT a canonical input, scanner or executable session. */
export function createPrimarySyntheticRepositoryPorts(raw: unknown) {
  const hasConstraints = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "negativeConstraints");
  const input = boundaryRecord(raw, hasConstraints ? ["boundary", "permit", "sourceDigest", "negativeConstraints"] : ["boundary", "permit", "sourceDigest"]);
  // This authenticates the actual frozen issuer, not a structural/callback imitation.
  const basis = describeSyntheticSourceReadBasis(input.boundary, input.permit);
  if (boundaryDigest(input.sourceDigest) !== basis.sourceDigest) throw new PrimaryBoundaryError("source_mismatch");
  const boundary = input.boundary as SyntheticRepositoryPortsInput["boundary"];
  const permit = input.permit as SyntheticSourceReadPermit;
  const snapshotId = `synthetic_snapshot_${basis.sourceDigest.slice(7)}` as SnapshotId;
  const files = Object.freeze(basis.files.map((file): ReadDescriptor => Object.freeze({
    id: `synthetic_file_${boundaryHash(`${snapshotId}\0${file.path}`).slice(7)}` as EntityId,
    snapshotId, path: file.path, normalizedPath: file.path, sizeBytes: file.bytes, contentFingerprint: file.digest,
  })));
  const snapshot: SyntheticReadSnapshot = Object.freeze({ id: snapshotId, source: "test_fixture", sourceDigest: basis.sourceDigest, files });
  const byId = new Map(files.map((file) => [file.id, file]));
  let cancelled = false; // Owned per adapter; no caller-supplied cancellation callbacks.
  const cancellation: InvestigationCancellationPort = Object.freeze({ isCancellationRequested: () => cancelled });
  const negativeConstraints = captureNegativeConstraints(hasConstraints ? input.negativeConstraints : []);
  // These are NOT scanner results. Empty lists represent UNAVAILABLE metadata,
  // not proof that the source contains no hints/symbols/imports/exports.
  const inventory: LiveRepositorySearchInput["inventory"] = { files: files.map((file) => ({
    path: file.path, name: file.path.split("/").at(-1)!, textHints: [], symbols: [], imports: [], exports: [],
  })) };
  for (const file of inventory.files) {
    for (const list of [file.textHints, file.symbols, file.imports, file.exports]) Object.freeze(list);
    Object.freeze(file);
  }
  Object.freeze(inventory.files); Object.freeze(inventory);
  const searchSnapshot: LiveRepositorySearchInput["snapshot"] = { id: snapshotId, files: files.map((file) => Object.freeze({ ...file })) };
  Object.freeze(searchSnapshot.files); Object.freeze(searchSnapshot);
  const productionSearch = createLiveRepositorySearch({ inventory, snapshot: searchSnapshot, negativeConstraints, cancellation });

  async function searchAuthorized(rawQuery: unknown, operation: keyof RepositorySearchPort) {
    const query = boundaryRecord(rawQuery, ["snapshotId", "query", "limit"]);
    if (typeof query.snapshotId !== "string") throw new PrimaryBoundaryError("invalid_input");
    if (typeof query.query !== "string") throw new TypeError("Search query must be a string.");
    const admitted = describeSyntheticSourceReadBasis(boundary, permit);
    if (admitted.sourceDigest !== basis.sourceDigest || admitted.files.length !== files.length ||
        boundaryHash(JSON.stringify(admitted.files.map(({ path, bytes: size, digest }) => ({ path, bytes: size, digest })))) !== basis.sourceDigest ||
        admitted.files.some((file, index) => file.path !== files[index].path || file.bytes !== files[index].sizeBytes ||
          file.digest !== files[index].contentFingerprint || inventory.files[index].path !== file.path ||
          inventory.files[index].name !== file.path.split("/").at(-1) || searchSnapshot.files[index].id !== files[index].id)) {
      throw new PrimaryBoundaryError("source_mismatch");
    }
    const results = await productionSearch[operation](query as unknown as Parameters<RepositorySearchPort[typeof operation]>[0]);
    // Verify binding, never rerank/filter or invent leads returned by production.
    for (const result of results) {
      const file = result.entityId === undefined ? undefined : byId.get(result.entityId);
      if (result.snapshotId !== snapshotId || !file || result.path !== file.path) throw new PrimaryBoundaryError("source_mismatch");
    }
    return results;
  }

  function read(rawRequest: unknown, range: boolean): RepositoryReadResult {
    const request = readRequest(rawRequest, range);
    describeSyntheticSourceReadBasis(boundary, permit); // Recheck issuer/permit/source admission on EVERY read.
    if (cancelled) return failure(request, "restricted");
    const file = byId.get(request.fileId);
    if (request.snapshotId !== snapshotId || !file || file.path !== request.path || file.contentFingerprint !== request.expectedFingerprint) {
      return failure(request, file ? "fingerprint_mismatch" : "not_found");
    }
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || request.maxBytes > MAX_READ_REQUEST_BYTES || file.sizeBytes > request.maxBytes) {
      return failure(request, "byte_limit");
    }
    const captured = boundary.readSource(permit, request.path);
    if (!captured) return failure(request, "not_found");
    // Strings were defensively captured by B1. Re-encode and HASH actual bytes,
    // not inventory metadata or preview text; no mutable byte array is retained.
    const bytes = Buffer.from(captured.content, "utf8");
    if (bytes.byteLength !== file.sizeBytes || captured.path !== file.path ||
        `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== file.contentFingerprint || captured.digest !== file.contentFingerprint) {
      return failure(request, "fingerprint_mismatch");
    }
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const lines = content.split(/\r\n|\n|\r/u);
    if (range) {
      const { startLine, endLine } = request as ReadRangeRequest;
      if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
        return failure(request, "range_invalid");
      }
      const selected = lines.slice(startLine - 1, endLine).join("\n");
      const bytesRead = Buffer.byteLength(selected, "utf8");
      if (bytesRead > request.maxBytes) return failure(request, "byte_limit");
      return Object.freeze({ status: "success", snapshotId, fileId: file.id, path: file.path, content: selected,
        contentFingerprint: file.contentFingerprint, bytesRead, startLine, endLine });
    }
    return Object.freeze({ status: "success", snapshotId, fileId: file.id, path: file.path, content,
      contentFingerprint: file.contentFingerprint, bytesRead: bytes.byteLength, startLine: 1, endLine: lines.length });
  }

  const reader: RepositoryReaderPort = Object.freeze({
    async readFile(request: ReadFileRequest) { return read(request, false); },
    async readRange(request: ReadRangeRequest) { return read(request, true); },
  });
  const search: RepositorySearchPort = Object.freeze<RepositorySearchPort>({
    searchPaths(query) { return searchAuthorized(query, "searchPaths"); },
    searchText(query) { return searchAuthorized(query, "searchText"); },
    searchSymbols(query) { return searchAuthorized(query, "searchSymbols"); },
  });
  return Object.freeze({ profileId: SYNTHETIC_REPOSITORY_PORT_PROFILE, snapshot, reader, search,
    searchStatus: PRODUCTION_SEARCH_STATUS, searchCoverage: SYNTHETIC_SEARCH_COVERAGE, cancellation, cancel() { cancelled = true; } });
}
