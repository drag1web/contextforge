import type {
  EntityId,
  RepositorySnapshot,
  SnapshotId,
  SourceSpan,
} from "../contracts/index.js";
import type {
  PathSearchQuery,
  ReadFileRequest,
  ReadRangeRequest,
  RepositoryReaderPort,
  RepositoryReadResult,
  RepositorySearchPort,
  SearchResult,
  SymbolSearchQuery,
  TextSearchQuery,
} from "../ports/index.js";

export interface InMemoryRepositoryFile {
  fileId: EntityId;
  path: string;
  content: string;
  contentFingerprint: string;
}

export interface InMemoryRepositoryCallCounts {
  searchPaths: number;
  searchText: number;
  searchSymbols: number;
  readFile: number;
  readRange: number;
}

export class InMemoryRepositoryInvestigationAdapter
  implements RepositoryReaderPort, RepositorySearchPort
{
  readonly callCounts: InMemoryRepositoryCallCounts = {
    searchPaths: 0,
    searchText: 0,
    searchSymbols: 0,
    readFile: 0,
    readRange: 0,
  };

  private readonly files = new Map<EntityId, InMemoryRepositoryFile>();
  private readonly readFailures = new Map<
    EntityId,
    Array<{
      reason: Extract<RepositoryReadResult, { status: "failure" }>["reason"];
      retryable: boolean;
    }>
  >();

  constructor(
    private readonly snapshot: RepositorySnapshot,
    files: readonly InMemoryRepositoryFile[],
  ) {
    files.forEach((file) => this.files.set(file.fileId, structuredClone(file)));
  }

  setCurrentFingerprint(fileId: EntityId, fingerprint: string): void {
    const file = this.files.get(fileId);
    if (!file) throw new Error("Test repository file does not exist.");
    this.files.set(fileId, { ...file, contentFingerprint: fingerprint });
  }

  setContent(fileId: EntityId, content: string, fingerprint: string): void {
    const file = this.files.get(fileId);
    if (!file) throw new Error("Test repository file does not exist.");
    this.files.set(fileId, { ...file, content, contentFingerprint: fingerprint });
  }

  setReadFailure(
    fileId: EntityId,
    reason: Extract<RepositoryReadResult, { status: "failure" }>["reason"] | null,
    retryable = false,
  ): void {
    if (reason === null) this.readFailures.delete(fileId);
    else this.readFailures.set(fileId, [{ reason, retryable }]);
  }

  setReadFailureSequence(
    fileId: EntityId,
    failures: ReadonlyArray<{
      reason: Extract<RepositoryReadResult, { status: "failure" }>["reason"];
      retryable: boolean;
    }>,
  ): void {
    this.readFailures.set(fileId, structuredClone([...failures]));
  }

  private failure(
    request: ReadFileRequest,
    reason: Extract<RepositoryReadResult, { status: "failure" }>["reason"],
    retryable = false,
  ): RepositoryReadResult {
    return {
      status: "failure",
      snapshotId: request.snapshotId,
      fileId: request.fileId,
      path: request.path,
      reason,
      message: "The in-memory repository boundary rejected the read safely.",
      ...(retryable ? { retryable: true } : {}),
    };
  }

  private descriptor(request: ReadFileRequest) {
    return this.snapshot.files.find((file) => file.id === request.fileId);
  }

  private read(request: ReadFileRequest, range?: ReadRangeRequest): RepositoryReadResult {
    const descriptor = this.descriptor(request);
    const file = this.files.get(request.fileId);
    if (
      request.snapshotId !== this.snapshot.id ||
      !descriptor ||
      !file ||
      descriptor.normalizedPath !== request.path ||
      file.path !== request.path
    ) {
      return this.failure(request, "not_found");
    }
    const injected = this.readFailures.get(request.fileId);
    if (injected?.length) {
      const next = injected.shift()!;
      if (injected.length === 0) this.readFailures.delete(request.fileId);
      return this.failure(request, next.reason, next.retryable);
    }
    if (!descriptor.readable) return this.failure(request, "unreadable");
    if (descriptor.secretRisk === "known") return this.failure(request, "restricted");
    if (
      request.expectedFingerprint !== descriptor.contentFingerprint ||
      file.contentFingerprint !== descriptor.contentFingerprint
    ) {
      return this.failure(request, "fingerprint_mismatch");
    }
    const lines = file.content.split(/\r?\n/u);
    const startLine = range?.startLine ?? 1;
    const endLine = range?.endLine ?? Math.max(1, lines.length);
    if (startLine < 1 || endLine < startLine || endLine > Math.max(1, lines.length)) {
      return this.failure(request, "range_invalid");
    }
    const content = range
      ? lines.slice(startLine - 1, endLine).join("\n")
      : file.content;
    const bytesRead = new TextEncoder().encode(content).byteLength;
    if (bytesRead > request.maxBytes) return this.failure(request, "byte_limit");
    return {
      status: "success",
      snapshotId: this.snapshot.id,
      fileId: file.fileId,
      path: file.path,
      content,
      contentFingerprint: file.contentFingerprint,
      bytesRead,
      startLine,
      endLine,
    };
  }

  async readFile(request: ReadFileRequest): Promise<RepositoryReadResult> {
    this.callCounts.readFile += 1;
    return this.read(request);
  }

  async readRange(request: ReadRangeRequest): Promise<RepositoryReadResult> {
    this.callCounts.readRange += 1;
    return this.read(request, request);
  }

  private sourceFor(file: InMemoryRepositoryFile, query: string): SourceSpan | undefined {
    const index = file.content.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return undefined;
    const before = file.content.slice(0, index);
    const line = before.split(/\r?\n/u).length;
    const column = (before.split(/\r?\n/u).at(-1) ?? "").length + 1;
    return {
      kind: "source_span",
      snapshotId: this.snapshot.id,
      fileId: file.fileId,
      path: file.path,
      startLine: line,
      startColumn: column,
      endLine: line,
      endColumn: column + query.length,
      contentFingerprint: file.contentFingerprint,
    };
  }

  private results(
    snapshotId: SnapshotId,
    query: string,
    limit: number,
    mode: "path" | "text" | "symbol",
  ): SearchResult[] {
    if (snapshotId !== this.snapshot.id) return [];
    return [...this.files.values()]
      .filter((file) => {
        const descriptor = this.snapshot.files.find((item) => item.id === file.fileId);
        if (!descriptor || descriptor.secretRisk === "known") return false;
        return mode === "path"
          ? file.path.toLowerCase().includes(query.toLowerCase())
          : file.content.toLowerCase().includes(query.toLowerCase());
      })
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, limit)
      .map((file) => ({
        kind: "lead" as const,
        snapshotId: this.snapshot.id,
        path: file.path,
        entityId: file.fileId,
        ...(mode === "path" ? {} : { source: this.sourceFor(file, query) }),
      }));
  }

  async searchPaths(query: PathSearchQuery): Promise<SearchResult[]> {
    this.callCounts.searchPaths += 1;
    return this.results(query.snapshotId, query.query, query.limit, "path");
  }

  async searchText(query: TextSearchQuery): Promise<SearchResult[]> {
    this.callCounts.searchText += 1;
    return this.results(query.snapshotId, query.query, query.limit, "text");
  }

  async searchSymbols(query: SymbolSearchQuery): Promise<SearchResult[]> {
    this.callCounts.searchSymbols += 1;
    return this.results(query.snapshotId, query.query, query.limit, "symbol");
  }
}
