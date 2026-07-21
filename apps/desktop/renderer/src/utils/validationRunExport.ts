import type {
  ValidationCaseResult,
  ValidationRunResult,
} from "../validation/validationManifest";

interface ZipEntry {
  name: string;
  content: string;
}

const encoder = new TextEncoder();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? (value >>> 1) ^ 0xedb88320
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function getDosTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function localFileHeader(input: {
  name: Uint8Array;
  content: Uint8Array;
  checksum: number;
  time: number;
  day: number;
}) {
  const bytes = new Uint8Array(30 + input.name.length);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 0x0800);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, input.time);
  writeUint16(view, 12, input.day);
  writeUint32(view, 14, input.checksum);
  writeUint32(view, 18, input.content.length);
  writeUint32(view, 22, input.content.length);
  writeUint16(view, 26, input.name.length);
  writeUint16(view, 28, 0);
  bytes.set(input.name, 30);
  return bytes;
}

function centralDirectoryHeader(input: {
  name: Uint8Array;
  content: Uint8Array;
  checksum: number;
  time: number;
  day: number;
  localOffset: number;
}) {
  const bytes = new Uint8Array(46 + input.name.length);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, 0x0800);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, input.time);
  writeUint16(view, 14, input.day);
  writeUint32(view, 16, input.checksum);
  writeUint32(view, 20, input.content.length);
  writeUint32(view, 24, input.content.length);
  writeUint16(view, 28, input.name.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, input.localOffset);
  bytes.set(input.name, 46);
  return bytes;
}

function endOfCentralDirectory(input: {
  entryCount: number;
  centralSize: number;
  centralOffset: number;
}) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, input.entryCount);
  writeUint16(view, 10, input.entryCount);
  writeUint32(view, 12, input.centralSize);
  writeUint32(view, 16, input.centralOffset);
  writeUint16(view, 20, 0);
  return bytes;
}

export function buildStoredZipBytes(entries: ZipEntry[], date = new Date()) {
  if (entries.length === 0 || entries.length > 65_535) {
    throw new Error("ZIP export requires between 1 and 65,535 files.");
  }

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const timestamp = getDosTimestamp(date);
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, "/"));
    const content = encoder.encode(entry.content);
    const checksum = crc32(content);
    const local = localFileHeader({
      name,
      content,
      checksum,
      ...timestamp,
    });
    const central = centralDirectoryHeader({
      name,
      content,
      checksum,
      ...timestamp,
      localOffset,
    });

    localChunks.push(local, content);
    centralChunks.push(central);
    localOffset += local.length + content.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  const end = endOfCentralDirectory({
    entryCount: entries.length,
    centralSize: centralDirectory.length,
    centralOffset: localOffset,
  });

  return concatBytes([...localChunks, centralDirectory, end]);
}

function safeFileSegment(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function timestampForFile(value: string) {
  return value.replace(/[:.]/g, "-");
}

function formatCaseReport(result: ValidationCaseResult) {
  const lines = [
    `${result.id} — ${result.title}`,
    `Status: ${result.status.toUpperCase()}`,
    `Duration: ${result.durationMs} ms`,
  ];

  if (result.actual) {
    lines.push(
      `Understanding: ${result.actual.understandingReadiness} / ${result.actual.interactionAction}`,
      `Context quality: ${result.actual.qualityStatus ?? "not run"}${result.actual.qualityScore === null ? "" : ` (${result.actual.qualityScore}/100)`}`,
      `Execution mode: ${result.actual.executionMode ?? "not available"}`,
      `Selected files: ${result.actual.selectedPaths.length}`,
      `Authorized targets: ${result.actual.authorizedTargets.length}`,
      `Warnings: ${result.actual.warnings.length}`,
    );
  }

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  if (result.checks.length > 0) {
    lines.push("Checks:");
    for (const check of result.checks) {
      lines.push(`  [${check.passed ? "PASS" : "FAIL"}] ${check.message}`);
    }
  } else {
    lines.push("Checks: observation only (no expectations in the manifest).");
  }

  return lines.join("\n");
}

function buildTextReport(run: ValidationRunResult) {
  const { summary } = run;
  return [
    "CONTEXTFORGE VALIDATION RUN",
    "===========================",
    "",
    `Suite: ${run.manifest.name}`,
    `Project: ${run.project.name}`,
    `Project path: ${run.project.localPath}`,
    `Source manifest: ${run.sourceFileName}`,
    `Run ID: ${run.runId}`,
    `Started: ${run.startedAt}`,
    `Finished: ${run.finishedAt}`,
    `Duration: ${run.durationMs} ms`,
    `Cancelled: ${run.cancelled ? "yes" : "no"}`,
    "",
    "SUMMARY",
    "-------",
    `Total: ${summary.total}`,
    `Passed: ${summary.passed}`,
    `Failed: ${summary.failed}`,
    `Observed: ${summary.observed}`,
    `Errors: ${summary.errors}`,
    `Skipped: ${summary.skipped}`,
    "",
    "CASES",
    "-----",
    ...run.results.flatMap((result) => [formatCaseReport(result), ""]),
    "SAFETY",
    "------",
    "The runner used read-only Task Understanding and Context Composer preview APIs.",
    "It did not generate Task Packs and did not modify source files in the selected project.",
    "Snippet contents are excluded from diagnostic files; only snippet metadata is retained.",
    "",
  ].join("\n");
}

function buildArchiveEntries(run: ValidationRunResult): ZipEntry[] {
  const resultWithoutDiagnostics = {
    ...run,
    results: run.results.map(({ diagnostics: _diagnostics, ...result }) => result),
  };
  const entries: ZipEntry[] = [
    { name: "report.txt", content: buildTextReport(run) },
    {
      name: "results.json",
      content: `${JSON.stringify(resultWithoutDiagnostics, null, 2)}\n`,
    },
    {
      name: "input/manifest.json",
      content: `${JSON.stringify(run.manifest, null, 2)}\n`,
    },
    {
      name: "README.txt",
      content: [
        "ContextForge Validation Lab archive",
        "",
        "report.txt — readable run report",
        "results.json — machine-readable result summary",
        "input/manifest.json — normalized input manifest",
        "diagnostics/*.json — one diagnostic record per test case",
        "",
        "The run is read-only. Source snippets are intentionally omitted.",
        "",
      ].join("\n"),
    },
  ];

  for (const result of run.results) {
    const id = safeFileSegment(result.id, "case");
    entries.push({
      name: `diagnostics/${id}.json`,
      content: `${JSON.stringify(result.diagnostics, null, 2)}\n`,
    });
  }

  return entries;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType = "text/plain;charset=utf-8",
) {
  downloadBlob(new Blob([content], { type: mimeType }), fileName);
}

export function exportValidationRunArchive(run: ValidationRunResult) {
  const entries = buildArchiveEntries(run);
  const bytes = buildStoredZipBytes(entries, new Date(run.finishedAt));
  const suite = safeFileSegment(run.manifest.name, "validation");
  const fileName = `contextforge-validation-${suite}-${timestampForFile(run.finishedAt)}.zip`;
  downloadBlob(new Blob([bytes], { type: "application/zip" }), fileName);
  return fileName;
}
