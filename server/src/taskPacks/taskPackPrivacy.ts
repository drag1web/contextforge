export interface ExportSafeProjectMetadataInput {
  name: string;
  packageManager?: string | null;
  detectedStack?: string[];
  scripts?: Record<string, string>;
  readinessScore?: number;
}

/**
 * Builds project metadata safe to embed in a copied/exported Task Pack.
 * The real local root remains available to internal scanners and readers, but
 * is deliberately not exposed to external coding-agent prompts.
 */
export function buildExportSafeProjectMetadata(project: ExportSafeProjectMetadataInput) {
  return {
    name: project.name,
    projectRoot: "<local-project>",
    packageManager: project.packageManager ?? null,
    detectedStack: project.detectedStack ?? [],
    scripts: project.scripts ?? {},
    readinessScore: project.readinessScore ?? 0,
  };
}
