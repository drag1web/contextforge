import type {
  EntityId,
  FactRecord,
  RepositoryEntity,
  SnapshotId,
} from "../contracts/index.js";

export interface ExtractorInput {
  snapshotId: SnapshotId;
  fileId: EntityId;
  path: string;
  content: string;
  contentFingerprint: string;
  language: string | null;
}

export interface ExtractionLimitation {
  code: string;
  message: string;
}

export interface ExtractionResult {
  entities: RepositoryEntity[];
  facts: FactRecord[];
  limitations: ExtractionLimitation[];
}

export interface FactExtractorPort {
  readonly id: string;
  readonly version: string;
  supports(input: ExtractorInput): boolean;
  extract(input: ExtractorInput): Promise<ExtractionResult>;
}
