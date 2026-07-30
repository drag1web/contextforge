import type { FileKind } from "../../contracts/index.js";
import type { ProjectInventoryFileKind } from "../../../scanner/projectInventoryScanner.js";

const FILE_KIND_MAP: Readonly<Record<FileKind, ProjectInventoryFileKind>> = {
  source: "source",
  test: "test",
  configuration: "config",
  documentation: "docs",
  asset: "asset",
  generated: "runtime",
  data: "data",
  unknown: "unknown",
};

export function mapLegacyFileKind(kind: FileKind): ProjectInventoryFileKind {
  return FILE_KIND_MAP[kind];
}
