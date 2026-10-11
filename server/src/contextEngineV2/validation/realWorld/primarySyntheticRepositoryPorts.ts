import { createHash } from "node:crypto";
import type { EntityId, SnapshotId } from "../../contracts/ids.js";
import type { FileDescriptor } from "../../contracts/repository.js";
import type { RepositoryReaderPort, ReadFileRequest, ReadRangeRequest, RepositoryReadResult, RepositoryReadFailure } from "../../ports/repositoryReaderPort.js";
import type { RepositorySearchPort } from "../../ports/repositorySearchPort.js";
import type { InvestigationCancellationPort } from "../../ports/investigationCancellationPort.js";
import { boundaryRecord, boundaryDigest, boundaryHash, boundaryPath, PrimaryBoundaryError } from "./primaryBoundaryData.js";
import { describeSyntheticSourceReadBasis } from "./primaryReadOnlyBoundary.js";
import type { createPrimaryReadOnlyBoundary, SyntheticSourceReadPermit } from "./primaryReadOnlyBoundary.js";

export const SYNTHETIC_REPOSITORY_PORT_PROFILE = "rw02b3-synthetic-repository-ports" as const;
export const PRODUCTION_SEARCH_STATUS = "NOT_CONNECTED — PRODUCTION_SEARCH_PARITY_UNPROVEN" as const;
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
}
export class ProductionSearchNotConnectedError extends Error {
  readonly code = "production_search_not_connected";
  constructor() { super("Production search is not connected."); this.name = "ProductionSearchNotConnectedError"; }
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
  const input = boundaryRecord(raw, ["boundary", "permit", "sourceDigest"]);
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
  // Throw rather than return an empty search result that could be misread as a
  // genuine production no-match. No alternate search/ranking algorithm exists.
  const search: RepositorySearchPort = Object.freeze({
    async searchPaths() { throw new ProductionSearchNotConnectedError(); },
    async searchText() { throw new ProductionSearchNotConnectedError(); },
    async searchSymbols() { throw new ProductionSearchNotConnectedError(); },
  });
  return Object.freeze({ profileId: SYNTHETIC_REPOSITORY_PORT_PROFILE, snapshot, reader, search,
    searchStatus: PRODUCTION_SEARCH_STATUS, cancellation, cancel() { cancelled = true; } });
}
