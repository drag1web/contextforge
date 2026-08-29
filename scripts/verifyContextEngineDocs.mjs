import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(repositoryRoot, "docs", "context-engine-v2");
const sumsPath = path.join(packageRoot, "SHA256SUMS.txt");

function canonicalLf(value) {
  return value.replace(/\r\n?/gu, "\n");
}

function parseSums(value) {
  const records = [];
  const seen = new Set();
  for (const rawLine of canonicalLf(value).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/u.exec(line);
    if (!match || seen.has(match[2])) throw new Error("invalid_context_engine_checksum_manifest");
    seen.add(match[2]);
    records.push({ hash: match[1], file: match[2] });
  }
  if (records.length === 0) throw new Error("empty_context_engine_checksum_manifest");
  return records;
}

export async function verifyContextEngineDocumentationIntegrity() {
  const records = parseSums(await fs.readFile(sumsPath, "utf8"));
  const failures = [];
  for (const record of records) {
    const source = await fs.readFile(path.join(packageRoot, record.file), "utf8");
    const actual = createHash("sha256").update(canonicalLf(source), "utf8").digest("hex");
    if (actual !== record.hash) failures.push(record.file);
  }
  if (failures.length > 0) {
    throw new Error(`context_engine_documentation_integrity_failed:${failures.join(",")}`);
  }
  process.stdout.write(`Context Engine documentation integrity passed: ${records.length} canonical-LF files.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyContextEngineDocumentationIntegrity().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "context_engine_documentation_integrity_failed"}\n`);
    process.exitCode = 1;
  });
}
