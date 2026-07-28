import type {
  EntityId,
  SnapshotId,
  SourceSpan,
} from "../contracts/index.js";

interface RepositorySearchQuery {
  snapshotId: SnapshotId;
  query: string;
  limit: number;
}

export interface PathSearchQuery extends RepositorySearchQuery {}

export interface TextSearchQuery extends RepositorySearchQuery {}

export interface SymbolSearchQuery extends RepositorySearchQuery {}

export interface SearchResult {
  kind: "lead";
  snapshotId: SnapshotId;
  path: string;
  entityId?: EntityId;
  source?: SourceSpan;
}

export interface RepositorySearchPort {
  searchPaths(query: PathSearchQuery): Promise<SearchResult[]>;
  searchText(query: TextSearchQuery): Promise<SearchResult[]>;
  searchSymbols(query: SymbolSearchQuery): Promise<SearchResult[]>;
}
