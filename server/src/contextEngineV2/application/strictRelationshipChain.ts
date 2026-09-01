import type { FactRecord, RepositoryEntity } from "../contracts/index.js";
import { stableCompare, stableSerialize } from "../domain/investigationDomainSupport.js";

const MAX_RELATIONSHIP_CHAIN_FACTS = 16;

export interface StrictRelationshipAdjacencyDiagnostics {
  relationshipAdjacencyPreparationStarted?(): void;
  relationshipAdjacencyPredicateEvaluated?(): void;
  relationshipPreparedChainBuildStarted?(): void;
}

export interface PreparedStrictRelationshipAdjacency {
  readonly snapshotId: FactRecord["snapshotId"];
}

class PreparedStrictRelationshipAdjacencyImpl
implements PreparedStrictRelationshipAdjacency {
  constructor(
    readonly snapshotId: FactRecord["snapshotId"],
    readonly orderedFacts: readonly FactRecord[],
    readonly orderedOrigins: readonly FactRecord[],
    readonly adjacentByLeft: ReadonlyMap<FactRecord, readonly FactRecord[]>,
  ) {}
}

function sameEntitySemanticShape(
  left: RepositoryEntity,
  right: RepositoryEntity,
): boolean {
  return left.id === right.id && stableSerialize({
    snapshotId: left.snapshotId,
    kind: left.kind,
    displayName: left.displayName,
    canonicalName: left.canonicalName,
    fileId: left.fileId,
    attributes: left.attributes,
  }) === stableSerialize({
    snapshotId: right.snapshotId,
    kind: right.kind,
    displayName: right.displayName,
    canonicalName: right.canonicalName,
    fileId: right.fileId,
    attributes: right.attributes,
  });
}

function pathWithoutSupportedExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?|json)$/u, "");
}

function resolveRelativeModuleTarget(fact: FactRecord): string | undefined {
  if (fact.kind !== "relation") return undefined;
  const moduleSpecifier = fact.object.attributes?.moduleSpecifier;
  if (
    typeof moduleSpecifier !== "string" ||
    (!moduleSpecifier.startsWith("./") && !moduleSpecifier.startsWith("../")) ||
    fact.source.kind !== "source_span"
  ) {
    return undefined;
  }
  const segments = fact.source.path.split("/").slice(0, -1);
  for (const segment of moduleSpecifier.replaceAll("\\", "/").split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return pathWithoutSupportedExtension(segments.join("/"));
}

function exactImportedSymbol(fact: FactRecord): string | undefined {
  if (fact.kind !== "relation") return undefined;
  const importedName = fact.object.attributes?.importedName;
  if (
    typeof importedName !== "string" ||
    importedName === "*" ||
    importedName === "default" ||
    importedName === "<module>"
  ) {
    return undefined;
  }
  return importedName;
}

function exactDefinitionNames(fact: FactRecord): Set<string> {
  if (fact.kind !== "relation") return new Set();
  if (fact.predicate === "contains") {
    return new Set([fact.object.displayName, fact.object.canonicalName]
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => [value, value.split("#").at(-1) ?? value]));
  }
  if (fact.predicate === "imports" || fact.predicate === "re_exports") {
    return new Set([
      fact.object.displayName,
      fact.object.canonicalName?.split("#").at(-1),
      fact.object.attributes?.localName,
    ].filter((value): value is string => typeof value === "string"));
  }
  return new Set();
}

function sourcePathMatchesModuleTarget(target: string, fact: FactRecord): boolean {
  if (fact.source.kind !== "source_span") return false;
  const sourcePath = pathWithoutSupportedExtension(fact.source.path);
  return sourcePath === target || sourcePath === `${target}/index`;
}

export function areStrictRelationshipFactsAdjacent(
  left: FactRecord,
  right: FactRecord,
): boolean {
  if (
    left.kind !== "relation" ||
    right.kind !== "relation" ||
    left.status !== "active" ||
    right.status !== "active" ||
    left.snapshotId !== right.snapshotId
  ) {
    return false;
  }
  if (
    sameEntitySemanticShape(left.object, right.subject) ||
    sameEntitySemanticShape(left.object, right.object) ||
    (sameEntitySemanticShape(left.subject, right.subject) &&
      (left.predicate === "defines_endpoint" || left.predicate === "defines_route"))
  ) {
    return true;
  }
  if (left.predicate !== "imports" && left.predicate !== "re_exports") return false;
  const target = resolveRelativeModuleTarget(left);
  const symbol = exactImportedSymbol(left);
  return target !== undefined &&
    symbol !== undefined &&
    sourcePathMatchesModuleTarget(target, right) &&
    exactDefinitionNames(right).has(symbol);
}

export function buildStrictBoundedRelationshipChains(input: {
  origins: readonly FactRecord[];
  facts: readonly FactRecord[];
  candidateFact: Extract<FactRecord, { kind: "relation" }>;
}, checkpoint?: () => void, diagnostics?: StrictRelationshipAdjacencyDiagnostics): FactRecord[][] {
  checkpoint?.();
  const orderedFacts = [...input.facts]
    .filter((fact) => {
      checkpoint?.();
      return fact.status === "active" && fact.snapshotId === input.candidateFact.snapshotId;
    })
    .sort((left, right) => stableCompare(left.id, right.id));
  const chains: FactRecord[][] = [];
  const visit = (path: FactRecord[]): void => {
    checkpoint?.();
    const tail = path.at(-1)!;
    if (tail.id === input.candidateFact.id) {
      chains.push(path);
      return;
    }
    if (path.length >= MAX_RELATIONSHIP_CHAIN_FACTS) return;
    const seen = new Set(path.map((fact) => fact.id));
    for (const next of orderedFacts) {
      checkpoint?.();
      if (seen.has(next.id)) continue;
      diagnostics?.relationshipAdjacencyPredicateEvaluated?.();
      if (!areStrictRelationshipFactsAdjacent(tail, next)) continue;
      visit([...path, next]);
    }
  };
  [...input.origins]
    .filter((origin) =>
      origin.status === "active" && origin.snapshotId === input.candidateFact.snapshotId)
    .sort((left, right) => stableCompare(left.id, right.id))
    .filter((origin) => {
      checkpoint?.();
      if (origin.id === input.candidateFact.id) return true;
      const firstLinks = orderedFacts.filter((fact) => {
        checkpoint?.();
        if (fact.id === origin.id) return false;
        diagnostics?.relationshipAdjacencyPredicateEvaluated?.();
        return areStrictRelationshipFactsAdjacent(origin, fact);
      });
      return firstLinks.length === 1;
    })
    .forEach((origin) => {
      checkpoint?.();
      visit([origin]);
    });
  const unique = new Map<string, FactRecord[]>();
  for (const chain of chains) {
    checkpoint?.();
    unique.set(chain.map((fact) => fact.id).join("\0"), chain);
  }
  return [...unique.values()].sort((left, right) => {
    checkpoint?.();
    return stableCompare(
      left.map((fact) => fact.id).join("\0"),
      right.map((fact) => fact.id).join("\0"),
    );
  });
}

export function prepareStrictRelationshipAdjacency(input: {
  origins: readonly FactRecord[];
  facts: readonly FactRecord[];
  snapshotId: FactRecord["snapshotId"];
}, checkpoint?: () => void, diagnostics?: StrictRelationshipAdjacencyDiagnostics): PreparedStrictRelationshipAdjacency {
  diagnostics?.relationshipAdjacencyPreparationStarted?.();
  checkpoint?.();
  const orderedFacts = [...input.facts]
    .filter((fact) => {
      checkpoint?.();
      return fact.status === "active" && fact.snapshotId === input.snapshotId;
    })
    .sort((left, right) => stableCompare(left.id, right.id));
  const orderedOrigins = [...input.origins]
    .filter((origin) => {
      checkpoint?.();
      return origin.status === "active" && origin.snapshotId === input.snapshotId;
    })
    .sort((left, right) => stableCompare(left.id, right.id));
  const possibleLeft: FactRecord[] = [];
  const seenLeft = new Set<FactRecord>();
  for (const fact of [...orderedOrigins, ...orderedFacts]) {
    checkpoint?.();
    if (seenLeft.has(fact)) continue;
    seenLeft.add(fact);
    possibleLeft.push(fact);
  }
  const adjacentByLeft = new Map<FactRecord, readonly FactRecord[]>();
  for (const left of possibleLeft) {
    checkpoint?.();
    const adjacent: FactRecord[] = [];
    for (const right of orderedFacts) {
      checkpoint?.();
      diagnostics?.relationshipAdjacencyPredicateEvaluated?.();
      if (areStrictRelationshipFactsAdjacent(left, right)) adjacent.push(right);
    }
    adjacentByLeft.set(left, Object.freeze(adjacent));
  }
  return new PreparedStrictRelationshipAdjacencyImpl(
    input.snapshotId,
    Object.freeze(orderedFacts),
    Object.freeze(orderedOrigins),
    adjacentByLeft,
  );
}

export function buildStrictBoundedRelationshipChainsFromPrepared(input: {
  prepared: PreparedStrictRelationshipAdjacency;
  candidateFact: Extract<FactRecord, { kind: "relation" }>;
}, checkpoint?: () => void, diagnostics?: StrictRelationshipAdjacencyDiagnostics): FactRecord[][] {
  diagnostics?.relationshipPreparedChainBuildStarted?.();
  checkpoint?.();
  if (!(input.prepared instanceof PreparedStrictRelationshipAdjacencyImpl)) {
    throw new TypeError("Prepared strict relationship adjacency is not authentic.");
  }
  const prepared = input.prepared;
  if (input.candidateFact.snapshotId !== prepared.snapshotId) return [];
  const chains: FactRecord[][] = [];
  const visit = (path: FactRecord[]): void => {
    checkpoint?.();
    const tail = path.at(-1)!;
    if (tail.id === input.candidateFact.id) {
      chains.push(path);
      return;
    }
    if (path.length >= MAX_RELATIONSHIP_CHAIN_FACTS) return;
    const seen = new Set(path.map((fact) => fact.id));
    for (const next of prepared.adjacentByLeft.get(tail) ?? []) {
      checkpoint?.();
      if (seen.has(next.id)) continue;
      visit([...path, next]);
    }
  };
  prepared.orderedOrigins
    .filter((origin) => {
      checkpoint?.();
      if (origin.id === input.candidateFact.id) return true;
      const firstLinks = (prepared.adjacentByLeft.get(origin) ?? []).filter(
        (fact) => fact.id !== origin.id,
      );
      return firstLinks.length === 1;
    })
    .forEach((origin) => {
      checkpoint?.();
      visit([origin]);
    });
  const unique = new Map<string, FactRecord[]>();
  for (const chain of chains) {
    checkpoint?.();
    unique.set(chain.map((fact) => fact.id).join("\0"), chain);
  }
  return [...unique.values()].sort((left, right) => {
    checkpoint?.();
    return stableCompare(
      left.map((fact) => fact.id).join("\0"),
      right.map((fact) => fact.id).join("\0"),
    );
  });
}
