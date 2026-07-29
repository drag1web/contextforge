import type {
  JsonValue,
  RepositoryEntity,
} from "../../contracts/index.js";
import type { ClockPort, FactExtractorPort } from "../../ports/index.js";
import {
  createEntity,
  createLiteralFact,
  createRelationFact,
  limitation,
  type ExtractorContext,
} from "./extractionSupport.js";
import {
  locateJsonSource,
  objectProperty,
  type LocatedJsonNode,
  type LocatedJsonProperty,
} from "./manifestJsonLocator.js";

const EXTRACTOR_ID = "package-manifest-fact-extractor";
const EXTRACTOR_VERSION = "1";

function isPackageManifest(filePath: string): boolean {
  return filePath.split("/").at(-1)?.toLowerCase() === "package.json";
}

function safeWorkspacePatterns(node: LocatedJsonNode): LocatedJsonNode[] | null {
  if (node.kind === "array") {
    return node.elements?.every((entry) => entry.kind === "string")
      ? [...(node.elements ?? [])]
      : null;
  }
  if (node.kind === "object") {
    const packages = objectProperty(node, "packages")?.value;
    if (packages?.kind === "array" && packages.elements?.every((entry) => entry.kind === "string")) {
      return [...packages.elements];
    }
  }
  return null;
}

function safeManifestString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 500 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function createManifestFactExtractor(clock: ClockPort): FactExtractorPort {
  return {
    id: EXTRACTOR_ID,
    version: EXTRACTOR_VERSION,

    supports(input) {
      return isPackageManifest(input.path);
    },

    async extract(input) {
      if (!isPackageManifest(input.path)) {
        return {
          entities: [],
          facts: [],
          limitations: [
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "unsupported_language",
              "Only package.json manifests are supported.",
            ),
          ],
        };
      }

      let root: LocatedJsonNode;
      try {
        root = locateJsonSource(input.content);
      } catch {
        return {
          entities: [],
          facts: [],
          limitations: [
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "malformed_manifest",
              "The package manifest is not valid JSON.",
            ),
          ],
        };
      }
      if (root.kind !== "object") {
        return {
          entities: [],
          facts: [],
          limitations: [
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "malformed_manifest",
              "The package manifest root must be a JSON object.",
            ),
          ],
        };
      }

      const context: ExtractorContext = {
        input,
        extractorId: EXTRACTOR_ID,
        extractorVersion: EXTRACTOR_VERSION,
        method: "manifest_parser",
        observedAt: clock.nowIso(),
      };
      const entities: RepositoryEntity[] = [];
      const facts = [];
      const limitations = [];
      const manifest = createEntity(context, {
        semanticKey: "package-manifest",
        kind: "file",
        displayName: "package.json",
        canonicalName: input.path,
        source: { start: root.start, end: root.end },
        attributes: { manifestKind: "package_json" },
      });
      entities.push(manifest);

      const addScalarFact = (property: LocatedJsonProperty, key: string): void => {
        if (
          property.value.kind !== "string" ||
          !safeManifestString(property.value.value)
        ) {
          limitations.push(
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "unsupported_construct",
              `The ${key} manifest field used an unsupported value shape.`,
            ),
          );
          return;
        }
        facts.push(
          createLiteralFact(context, {
            subject: manifest,
            predicate: "configures",
            object: { type: "string", value: property.value.value },
            source: { start: property.value.start, end: property.value.end },
            attributes: { key },
          }),
        );
      };

      for (const key of ["name", "version", "type", "module"] as const) {
        const property = objectProperty(root, key);
        if (property) addScalarFact(property, key);
      }

      const scripts = objectProperty(root, "scripts")?.value;
      if (scripts) {
        if (scripts.kind !== "object") {
          limitations.push(
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "unsupported_construct",
              "The scripts manifest field must be an object.",
            ),
          );
        } else {
          for (const property of scripts.properties ?? []) {
            if (
              !safeManifestString(property.key) ||
              property.value.kind !== "string" ||
              !safeManifestString(property.value.value)
            ) {
              limitations.push(
                limitation(
                  EXTRACTOR_ID,
                  EXTRACTOR_VERSION,
                  "unsupported_construct",
                  "A scripts entry used an unsupported key or non-string value.",
                ),
              );
              continue;
            }
            const scriptEntity = createEntity(context, {
              semanticKey: `script:${property.key}`,
              kind: "configuration_key",
              displayName: property.key,
              canonicalName: `scripts.${property.key}`,
              source: { start: property.keyStart, end: property.keyEnd },
              attributes: { section: "scripts" },
            });
            entities.push(scriptEntity);
            facts.push(
              createRelationFact(context, {
                subject: manifest,
                predicate: "contains",
                object: scriptEntity,
                source: { start: property.keyStart, end: property.keyEnd },
                attributes: { section: "scripts" },
              }),
            );
          }
        }
      }

      for (const section of ["dependencies", "devDependencies"] as const) {
        const dependencyObject = objectProperty(root, section)?.value;
        if (!dependencyObject) continue;
        if (dependencyObject.kind !== "object") {
          limitations.push(
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "unsupported_construct",
              `The ${section} manifest field must be an object.`,
            ),
          );
          continue;
        }
        for (const property of dependencyObject.properties ?? []) {
          if (
            !safeManifestString(property.key) ||
            property.value.kind !== "string" ||
            !safeManifestString(property.value.value)
          ) {
            limitations.push(
              limitation(
                EXTRACTOR_ID,
                EXTRACTOR_VERSION,
                "unsupported_construct",
                `A ${section} entry used an unsupported key or non-string value.`,
              ),
            );
            continue;
          }
          const dependency = createEntity(context, {
            semanticKey: `dependency:${section}:${property.key}`,
            kind: "external_dependency",
            displayName: property.key,
            canonicalName: property.key,
            source: { start: property.keyStart, end: property.keyEnd },
            fileBacked: false,
            attributes: { dependencyGroup: section },
          });
          entities.push(dependency);
          facts.push(
            createRelationFact(context, {
              subject: manifest,
              predicate: "configures",
              object: dependency,
              source: { start: property.keyStart, end: property.keyEnd },
              attributes: { key: section },
            }),
          );
        }
      }

      const workspaces = objectProperty(root, "workspaces")?.value;
      if (workspaces) {
        const patterns = safeWorkspacePatterns(workspaces);
        if (!patterns) {
          limitations.push(
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "unsupported_construct",
              "The workspaces manifest field used an unsupported value shape.",
            ),
          );
        } else {
          for (const patternNode of patterns) {
            if (!safeManifestString(patternNode.value)) continue;
            const workspace = createEntity(context, {
              semanticKey: `workspace:${patternNode.value}`,
              kind: "configuration_key",
              displayName: patternNode.value,
              canonicalName: `workspace:${patternNode.value}`,
              source: { start: patternNode.start, end: patternNode.end },
              attributes: {
                section: "workspaces",
                pattern: patternNode.value as JsonValue,
              },
            });
            entities.push(workspace);
            facts.push(
              createRelationFact(context, {
                subject: manifest,
                predicate: "configures",
                object: workspace,
                source: { start: patternNode.start, end: patternNode.end },
                attributes: { key: "workspaces" },
              }),
            );
          }
        }
      }

      return { entities, facts, limitations };
    },
  };
}
