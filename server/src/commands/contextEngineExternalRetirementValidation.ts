import path from "node:path";
import { fileURLToPath } from "node:url";

import { runExternalRetirementValidationFile } from "./contextEngineExternalRetirementHarness.js";

function parseArgs(values: readonly string[]): {
  manifestPath: string;
  outputDirectory: string;
  projectFilter: string[];
  caseFilter: string[];
} {
  let manifestPath = "";
  let outputDirectory = "";
  const projectFilter: string[] = [];
  const caseFilter: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];
    if ((value === "--manifest" || value === "--output" || value === "--project" || value === "--case") && !next) {
      throw new Error("invalid_external_validation_arguments");
    }
    if (value === "--manifest") { manifestPath = path.resolve(next!); index += 1; }
    else if (value === "--output") { outputDirectory = path.resolve(next!); index += 1; }
    else if (value === "--project") { projectFilter.push(next!); index += 1; }
    else if (value === "--case") { caseFilter.push(next!); index += 1; }
    else throw new Error("invalid_external_validation_arguments");
  }
  if (!manifestPath || !outputDirectory) throw new Error("invalid_external_validation_arguments");
  return { manifestPath, outputDirectory, projectFilter, caseFilter };
}

export async function runExternalRetirementValidationCli(args = process.argv.slice(2)): Promise<number> {
  try {
    const report = await runExternalRetirementValidationFile(parseArgs(args));
    process.stdout.write(`External retirement validation: ${report.readiness.hardSafetyGatesPassed ? "PASS" : "FAIL"}; ${report.metrics.executedCases}/${report.metrics.totalCases} cases executed.\n`);
    return report.readiness.hardSafetyGatesPassed ? 0 : 2;
  } catch {
    process.stderr.write("External retirement validation failed: invalid_manifest_or_execution_failure\n");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runExternalRetirementValidationCli();
}
