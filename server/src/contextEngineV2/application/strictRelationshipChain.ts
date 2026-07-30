import type { FactRecord, RepositoryEntity } from "../contracts/index.js";
import { stableCompare, stableSerialize } from "../domain/investigationDomainSupport.js";

const MAX_RELATIONSHIP_CHAIN_FACTS = 16;

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
}): FactRecord[][] {
  const orderedFacts = [...input.facts]
    .filter((fact) =>
      fact.status === "active" && fact.snapshotId === input.candidateFact.snapshotId)
    .sort((left, right) => stableCompare(left.id, right.id));
  const chains: FactRecord[][] = [];
  const visit = (path: FactRecord[]): void => {
    const tail = path.at(-1)!;
    if (tail.id === input.candidateFact.id) {
      chains.push(path);
      return;
    }
    if (path.length >= MAX_RELATIONSHIP_CHAIN_FACTS) return;
    const seen = new Set(path.map((fact) => fact.id));
    for (const next of orderedFacts) {
      if (seen.has(next.id) || !areStrictRelationshipFactsAdjacent(tail, next)) continue;
      visit([...path, next]);
    }
  };
  [...input.origins]
    .filter((origin) =>
      origin.status === "active" && origin.snapshotId === input.candidateFact.snapshotId)
    .sort((left, right) => stableCompare(left.id, right.id))
    .filter((origin) => {
      if (origin.id === input.candidateFact.id) return true;
      const firstLinks = orderedFacts.filter((fact) =>
        fact.id !== origin.id && areStrictRelationshipFactsAdjacent(origin, fact));
      return firstLinks.length === 1;
    })
    .forEach((origin) => visit([origin]));
  const unique = new Map<string, FactRecord[]>();
  for (const chain of chains) {
    unique.set(chain.map((fact) => fact.id).join("\0"), chain);
  }
  return [...unique.values()].sort((left, right) =>
    stableCompare(
      left.map((fact) => fact.id).join("\0"),
      right.map((fact) => fact.id).join("\0"),
    ));
}
