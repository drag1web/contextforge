import type {
  ContextComposerEngineFileView,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
  ContextComposerFindingView,
} from "../../types";

export type ContextMapNodeKind = "finding" | "evidence" | "file";

export interface ContextMapFindingNode {
  kind: "finding";
  id: string;
  finding: ContextComposerFindingView;
  evidenceIds: string[];
  contextFilePaths: string[];
}

export interface ContextMapEvidenceNode {
  kind: "evidence";
  id: string;
  evidence: ContextComposerEvidenceView;
  hostContextFilePath: string;
}

export interface ContextMapFileNode {
  kind: "file";
  id: string;
  path: string;
  contextFile: ContextComposerEngineFileView | null;
  sourceOnly: boolean;
}

export type ContextMapNode =
  | ContextMapFindingNode
  | ContextMapEvidenceNode
  | ContextMapFileNode;

export type ContextMapEdgeKind =
  | "finding_evidence"
  | "finding_file"
  | "evidence_source";

export interface ContextMapEdge {
  id: string;
  kind: ContextMapEdgeKind;
  from: string;
  to: string;
  evidenceRole?: ContextComposerEvidenceView["role"];
}

export interface ContextMapGraph {
  findings: ContextMapFindingNode[];
  evidence: ContextMapEvidenceNode[];
  files: ContextMapFileNode[];
  edges: ContextMapEdge[];
  hiddenFindingIds: string[];
  hiddenEvidenceIds: string[];
}

export function contextMapPathIdentity(path: string) {
  return path.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "");
}

function sortedUnique(values: Iterable<string>) {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function findingSignature(finding: ContextComposerFindingView) {
  return JSON.stringify({
    type: finding.type,
    statement: finding.statement,
    status: finding.status,
    authorizationHint: finding.authorizationHint,
    limitations: finding.limitations,
  });
}

function evidenceSignature(evidence: ContextComposerEvidenceView) {
  return JSON.stringify({
    role: evidence.role,
    strength: evidence.strength,
    predicate: evidence.predicate ?? null,
    relationKind: evidence.relationKind ?? null,
    path: evidence.path ? contextMapPathIdentity(evidence.path) : null,
    startLine: evidence.startLine ?? null,
    endLine: evidence.endLine ?? null,
  });
}

export function buildContextMapGraph(
  view: ContextComposerEngineView,
): ContextMapGraph {
  const hiddenFindingIds = new Set<string>();
  const hiddenEvidenceIds = new Set<string>();

  const findingsById = new Map<
    string,
    {
      finding: ContextComposerFindingView;
      signature: string;
      evidenceIds: Set<string>;
      contextFilePaths: Set<string>;
    }
  >();

  const evidenceById = new Map<
    string,
    {
      evidence: ContextComposerEvidenceView;
      signature: string;
      hostContextFilePath: string;
    }
  >();

  const contextFilesByPath = new Map<string, ContextComposerEngineFileView>();

  for (const file of view.files) {
    const filePath = contextMapPathIdentity(file.path);
    if (!contextFilesByPath.has(filePath)) {
      contextFilesByPath.set(filePath, file);
    }

    for (const finding of file.findings) {
      const signature = findingSignature(finding);
      const existing = findingsById.get(finding.findingId);

      if (!existing) {
        findingsById.set(finding.findingId, {
          finding,
          signature,
          evidenceIds: new Set(finding.evidenceIds),
          contextFilePaths: new Set([filePath]),
        });
        continue;
      }

      if (existing.signature !== signature) {
        hiddenFindingIds.add(finding.findingId);
        findingsById.delete(finding.findingId);
        continue;
      }

      finding.evidenceIds.forEach((evidenceId) =>
        existing.evidenceIds.add(evidenceId),
      );
      existing.contextFilePaths.add(filePath);
    }

    for (const evidence of file.evidence) {
      const signature = evidenceSignature(evidence);
      const existing = evidenceById.get(evidence.evidenceId);

      if (!existing) {
        evidenceById.set(evidence.evidenceId, {
          evidence,
          signature,
          hostContextFilePath: filePath,
        });
        continue;
      }

      if (existing.signature !== signature) {
        hiddenEvidenceIds.add(evidence.evidenceId);
        evidenceById.delete(evidence.evidenceId);
      }
    }
  }

  for (const findingId of hiddenFindingIds) {
    findingsById.delete(findingId);
  }
  for (const evidenceId of hiddenEvidenceIds) {
    evidenceById.delete(evidenceId);
  }

  const findings = Array.from(findingsById.entries())
    .map(([findingId, value]): ContextMapFindingNode => ({
      kind: "finding",
      id: `finding:${findingId}`,
      finding: value.finding,
      evidenceIds: sortedUnique(
        Array.from(value.evidenceIds).filter((id) => evidenceById.has(id)),
      ),
      contextFilePaths: sortedUnique(value.contextFilePaths),
    }))
    .sort((left, right) =>
      left.finding.findingId.localeCompare(right.finding.findingId),
    );

  const evidence = Array.from(evidenceById.entries())
    .map(([evidenceId, value]): ContextMapEvidenceNode => ({
      kind: "evidence",
      id: `evidence:${evidenceId}`,
      evidence: value.evidence,
      hostContextFilePath: value.hostContextFilePath,
    }))
    .sort((left, right) =>
      left.evidence.evidenceId.localeCompare(right.evidence.evidenceId),
    );

  const sourceOnlyPaths = new Set<string>();
  for (const item of evidence) {
    if (!item.evidence.path) continue;
    const path = contextMapPathIdentity(item.evidence.path);
    if (!contextFilesByPath.has(path)) {
      sourceOnlyPaths.add(path);
    }
  }

  const files: ContextMapFileNode[] = [
    ...Array.from(contextFilesByPath.entries())
      .map(([path, contextFile]): ContextMapFileNode => ({
        kind: "file",
        id: `file:${path}`,
        path,
        contextFile,
        sourceOnly: false,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    ...Array.from(sourceOnlyPaths)
      .sort((left, right) => left.localeCompare(right))
      .map((path): ContextMapFileNode => ({
        kind: "file",
        id: `file:${path}`,
        path,
        contextFile: null,
        sourceOnly: true,
      })),
  ];

  const findingIds = new Set(
    findings.map((item) => item.finding.findingId),
  );
  const evidenceIds = new Set(
    evidence.map((item) => item.evidence.evidenceId),
  );
  const filePaths = new Set(files.map((item) => item.path));

  const edges: ContextMapEdge[] = [];

  for (const findingNode of findings) {
    const findingId = findingNode.finding.findingId;

    for (const evidenceId of findingNode.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) continue;
      const evidenceNode = evidenceById.get(evidenceId);
      edges.push({
        id: `finding-evidence:${findingId}:${evidenceId}`,
        kind: "finding_evidence",
        from: `finding:${findingId}`,
        to: `evidence:${evidenceId}`,
        evidenceRole: evidenceNode?.evidence.role,
      });
    }

    for (const filePath of findingNode.contextFilePaths) {
      if (!filePaths.has(filePath)) continue;
      edges.push({
        id: `finding-file:${findingId}:${filePath}`,
        kind: "finding_file",
        from: `finding:${findingId}`,
        to: `file:${filePath}`,
      });
    }
  }

  for (const file of view.files) {
    const filePath = contextMapPathIdentity(file.path);
    for (const findingId of file.findingIds) {
      if (!findingIds.has(findingId)) continue;
      const id = `finding-file:${findingId}:${filePath}`;
      if (edges.some((edge) => edge.id === id)) continue;
      edges.push({
        id,
        kind: "finding_file",
        from: `finding:${findingId}`,
        to: `file:${filePath}`,
      });
    }
  }

  for (const evidenceNode of evidence) {
    if (!evidenceNode.evidence.path) continue;
    const path = contextMapPathIdentity(evidenceNode.evidence.path);
    if (!filePaths.has(path)) continue;

    edges.push({
      id: `evidence-source:${evidenceNode.evidence.evidenceId}:${path}`,
      kind: "evidence_source",
      from: evidenceNode.id,
      to: `file:${path}`,
      evidenceRole: evidenceNode.evidence.role,
    });
  }

  return {
    findings,
    evidence,
    files,
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    hiddenFindingIds: sortedUnique(hiddenFindingIds),
    hiddenEvidenceIds: sortedUnique(hiddenEvidenceIds),
  };
}
