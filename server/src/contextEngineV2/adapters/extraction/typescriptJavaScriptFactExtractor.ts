import ts from "typescript";

import type {
  EntityKind,
  FactRecord,
  RepositoryEntity,
} from "../../contracts/index.js";
import type {
  ClockPort,
  ExtractionLimitation,
  FactExtractorPort,
} from "../../ports/index.js";
import {
  createEntity,
  createRelationFact,
  limitation,
  type ExtractorContext,
  type SourceOffsets,
} from "./extractionSupport.js";

const EXTRACTOR_ID = "typescript-javascript-fact-extractor";
const EXTRACTOR_VERSION = "1";
const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ROUTE_RECEIVERS = new Set([
  "router",
  "app",
  "server",
  "apiRouter",
  "expressRouter",
]);
const TEST_CALLS = new Set(["test", "it"]);
const TEST_HELPERS = new Set(["describe", "expect", "assert", "test", "it"]);

function extensionFor(filePath: string): string {
  const match = filePath.toLowerCase().match(/\.[^.\/]+$/u);
  return match?.[0] ?? "";
}

function scriptKindFor(extension: string): ts.ScriptKind {
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function offsets(node: ts.Node, sourceFile: ts.SourceFile): SourceOffsets {
  return { start: node.getStart(sourceFile), end: node.getEnd() };
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function hasDefaultModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );
}

function isCallableScopeBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node)
  );
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (child !== node && isCallableScopeBoundary(child)) return;
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function declarationKind(
  name: string,
  node: ts.Node,
): EntityKind {
  if (
    /^[A-Z]/u.test(name) &&
    (ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)) &&
    containsJsx(node)
  ) {
    return "component";
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  ) {
    return "function";
  }
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  return "symbol";
}

function importedEntity(
  context: ExtractorContext,
  source: SourceOffsets,
  moduleSpecifier: string,
  importedName: string,
  localName: string,
  bindingKind: string,
  typeOnly: boolean,
): RepositoryEntity {
  return createEntity(context, {
    semanticKey: `import:${moduleSpecifier}:${importedName}:${localName}:${bindingKind}`,
    kind: importedName === "<module>" ? "module" : "symbol",
    displayName: localName,
    canonicalName: `${moduleSpecifier}#${importedName}`,
    source,
    fileBacked: false,
    attributes: {
      moduleSpecifier,
      importedName,
      localName,
      bindingKind,
      typeOnly,
    },
  });
}

function literalText(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  if (
    ts.isStringLiteralLike(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  return null;
}

function hasHandlerArgument(argumentsList: ts.NodeArray<ts.Expression>): boolean {
  return argumentsList.length >= 2 && argumentsList.slice(1).some((argument) =>
    ts.isIdentifier(argument) ||
    ts.isArrowFunction(argument) ||
    ts.isFunctionExpression(argument),
  );
}

export function createTypeScriptJavaScriptFactExtractor(
  clock: ClockPort,
): FactExtractorPort {
  return {
    id: EXTRACTOR_ID,
    version: EXTRACTOR_VERSION,

    supports(input) {
      return SUPPORTED_EXTENSIONS.has(extensionFor(input.path));
    },

    async extract(input) {
      const extension = extensionFor(input.path);
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        return {
          entities: [],
          facts: [],
          limitations: [
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "unsupported_language",
              "The file extension is not supported by this extractor.",
            ),
          ],
        };
      }

      const sourceFile = ts.createSourceFile(
        input.path,
        input.content,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(extension),
      );
      const parseDiagnostics = (
        sourceFile as ts.SourceFile & {
          parseDiagnostics?: readonly ts.Diagnostic[];
        }
      ).parseDiagnostics ?? [];
      if (parseDiagnostics.length > 0) {
        return {
          entities: [],
          facts: [],
          limitations: [
            limitation(
              EXTRACTOR_ID,
              EXTRACTOR_VERSION,
              "syntax_error",
              `TypeScript parser reported ${parseDiagnostics.length} syntax diagnostic(s).`,
            ),
          ],
        };
      }

      const context: ExtractorContext = {
        input,
        extractorId: EXTRACTOR_ID,
        extractorVersion: EXTRACTOR_VERSION,
        method: "compiler_api",
        observedAt: clock.nowIso(),
      };
      const entities = new Map<string, RepositoryEntity>();
      const facts: FactRecord[] = [];
      const limitations: ExtractionLimitation[] = [];
      const localEntities = new Map<string, RepositoryEntity>();
      const ownerNodes = new Map<ts.Node, RepositoryEntity>();
      const wholeFile = { start: 0, end: input.content.length };
      const moduleEntity = createEntity(context, {
        semanticKey: "module",
        kind: "module",
        displayName: input.path.split("/").at(-1) ?? input.path,
        canonicalName: input.path,
        source: wholeFile,
        attributes: { extension },
      });
      entities.set(moduleEntity.id, moduleEntity);

      const addEntity = (entity: RepositoryEntity): RepositoryEntity => {
        entities.set(entity.id, entity);
        return entity;
      };
      const limitationKeys = new Set<string>();
      const addUnsupportedLimitation = (key: string, message: string): void => {
        if (limitationKeys.has(key)) return;
        limitationKeys.add(key);
        limitations.push(
          limitation(
            EXTRACTOR_ID,
            EXTRACTOR_VERSION,
            "unsupported_construct",
            message,
          ),
        );
      };
      const addRelation = (
        subject: RepositoryEntity,
        predicate: string,
        object: RepositoryEntity,
        source: SourceOffsets,
        attributes: Record<string, string | boolean> = {},
      ): void => {
        facts.push(
          createRelationFact(context, {
            subject,
            predicate,
            object,
            source,
            attributes,
          }),
        );
      };
      const createDeclaration = (
        name: string,
        declarationNode: ts.Node,
        ownerNode: ts.Node,
        exported: boolean,
      ): RepositoryEntity => {
        const entity = addEntity(
          createEntity(context, {
            semanticKey: `declaration:${name}`,
            kind: declarationKind(name, ownerNode),
            displayName: name,
            canonicalName: `${input.path}#${name}`,
            source: offsets(declarationNode, sourceFile),
            attributes: {
              declarationSyntax: ts.SyntaxKind[ownerNode.kind] ?? "Unknown",
            },
          }),
        );
        localEntities.set(name, entity);
        ownerNodes.set(ownerNode, entity);
        addRelation(
          moduleEntity,
          "contains",
          entity,
          offsets(declarationNode, sourceFile),
        );
        if (exported) {
          addRelation(
            moduleEntity,
            "exports",
            entity,
            offsets(declarationNode, sourceFile),
          );
        }
        return entity;
      };

      for (const statement of sourceFile.statements) {
        if (
          (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement)) &&
          statement.name
        ) {
          createDeclaration(
            statement.name.text,
            statement.name,
            statement,
            hasExportModifier(statement),
          );
        } else if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          hasExportModifier(statement) &&
          hasDefaultModifier(statement) &&
          !statement.name
        ) {
          addUnsupportedLimitation(
            `anonymous-default-export:${statement.kind}`,
            "An anonymous default function or class export is not modeled by this extractor.",
          );
        } else if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            createDeclaration(
              declaration.name.text,
              declaration.name,
              declaration.initializer ?? declaration,
              hasExportModifier(statement),
            );
          }
        }
      }

      for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
          const moduleSpecifier = statement.moduleSpecifier.text;
          const importClause = statement.importClause;
          if (!importClause) {
            const entity = addEntity(
              importedEntity(
                context,
                offsets(statement.moduleSpecifier, sourceFile),
                moduleSpecifier,
                "<module>",
                moduleSpecifier,
                "side_effect",
                false,
              ),
            );
            addRelation(
              moduleEntity,
              "imports",
              entity,
              offsets(statement.moduleSpecifier, sourceFile),
              { bindingKind: "side_effect" },
            );
            continue;
          }
          if (importClause.name) {
            const entity = addEntity(
              importedEntity(
                context,
                offsets(importClause.name, sourceFile),
                moduleSpecifier,
                "default",
                importClause.name.text,
                "default",
                importClause.isTypeOnly,
              ),
            );
            localEntities.set(importClause.name.text, entity);
            addRelation(moduleEntity, "imports", entity, offsets(importClause.name, sourceFile), {
              bindingKind: "default",
              typeOnly: importClause.isTypeOnly,
            });
          }
          const namedBindings = importClause.namedBindings;
          if (namedBindings && ts.isNamespaceImport(namedBindings)) {
            const entity = addEntity(
              importedEntity(
                context,
                offsets(namedBindings, sourceFile),
                moduleSpecifier,
                "*",
                namedBindings.name.text,
                "namespace",
                importClause.isTypeOnly,
              ),
            );
            localEntities.set(namedBindings.name.text, entity);
            addRelation(moduleEntity, "imports", entity, offsets(namedBindings, sourceFile), {
              bindingKind: "namespace",
              typeOnly: importClause.isTypeOnly,
            });
          } else if (namedBindings && ts.isNamedImports(namedBindings)) {
            for (const element of namedBindings.elements) {
              const importedName = element.propertyName?.text ?? element.name.text;
              const localName = element.name.text;
              const typeOnly = importClause.isTypeOnly || element.isTypeOnly;
              const entity = addEntity(
                importedEntity(
                  context,
                  offsets(element, sourceFile),
                  moduleSpecifier,
                  importedName,
                  localName,
                  "named",
                  typeOnly,
                ),
              );
              localEntities.set(localName, entity);
              addRelation(moduleEntity, "imports", entity, offsets(element, sourceFile), {
                bindingKind: "named",
                typeOnly,
              });
            }
          }
        }

        if (ts.isExportDeclaration(statement)) {
          const moduleSpecifier =
            statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
              ? statement.moduleSpecifier.text
              : null;
          if (moduleSpecifier) {
            if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
              for (const element of statement.exportClause.elements) {
                const importedName = element.propertyName?.text ?? element.name.text;
                const entity = addEntity(
                  importedEntity(
                    context,
                    offsets(element, sourceFile),
                    moduleSpecifier,
                    importedName,
                    element.name.text,
                    "re_export",
                    element.isTypeOnly || statement.isTypeOnly,
                  ),
                );
                addRelation(moduleEntity, "re_exports", entity, offsets(element, sourceFile), {
                  typeOnly: element.isTypeOnly || statement.isTypeOnly,
                });
              }
            } else {
              const entity = addEntity(
                importedEntity(
                  context,
                  offsets(statement.moduleSpecifier!, sourceFile),
                  moduleSpecifier,
                  "*",
                  moduleSpecifier,
                  "re_export_all",
                  statement.isTypeOnly,
                ),
              );
              addRelation(
                moduleEntity,
                "re_exports",
                entity,
                offsets(statement.moduleSpecifier!, sourceFile),
                { typeOnly: statement.isTypeOnly },
              );
            }
          } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
              const localName = element.propertyName?.text ?? element.name.text;
              const entity =
                localEntities.get(localName) ??
                addEntity(
                  createEntity(context, {
                    semanticKey: `local-export-reference:${localName}`,
                    kind: "symbol",
                    displayName: element.name.text,
                    canonicalName: `${input.path}#${localName}`,
                    source: offsets(element, sourceFile),
                    attributes: { referenceKind: "local_export" },
                  }),
                );
              addRelation(moduleEntity, "exports", entity, offsets(element, sourceFile), {
                typeOnly: element.isTypeOnly || statement.isTypeOnly,
              });
            }
          }
        }
      }

      const referenceEntity = (
        name: string,
        node: ts.Node,
        kind: EntityKind = "symbol",
      ): RepositoryEntity => {
        const known = localEntities.get(name);
        if (known) return known;
        return addEntity(
          createEntity(context, {
            semanticKey: `reference:${kind}:${name}`,
            kind,
            displayName: name,
            canonicalName: name,
            source: offsets(node, sourceFile),
            fileBacked: false,
            attributes: { referenceKind: "unresolved_syntax_reference" },
          }),
        );
      };

      for (const statement of sourceFile.statements) {
        if (!ts.isExportAssignment(statement)) continue;
        if (statement.isExportEquals) {
          addUnsupportedLimitation(
            "export-equals",
            "TypeScript export assignment syntax is not modeled by this extractor.",
          );
        } else if (ts.isIdentifier(statement.expression)) {
          addRelation(
            moduleEntity,
            "exports",
            referenceEntity(statement.expression.text, statement.expression),
            offsets(statement, sourceFile),
            { bindingKind: "default" },
          );
        } else {
          addUnsupportedLimitation(
            "default-export-expression",
            "A default export expression used an unsupported non-identifier shape.",
          );
        }
      }

      const visit = (node: ts.Node, inheritedOwner?: RepositoryEntity): void => {
        const modeledOwner = ownerNodes.get(node);
        if (
          node !== sourceFile &&
          inheritedOwner !== undefined &&
          isCallableScopeBoundary(node) &&
          modeledOwner === undefined
        ) {
          addUnsupportedLimitation(
            "nested-callable-scope",
            "A nested callable scope was omitted because CE2-02 does not model that lexical owner.",
          );
          return;
        }
        const owner = modeledOwner ?? inheritedOwner;

        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const callName = node.expression.text;
          if (TEST_CALLS.has(callName)) {
            const title = literalText(node.arguments[0]);
            const callback = node.arguments[1];
            if (
              title !== null &&
              callback &&
              (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
            ) {
              const testEntity = addEntity(
                createEntity(context, {
                  semanticKey: `test:${title}`,
                  kind: "test_case",
                  displayName: title,
                  canonicalName: `${input.path}#test:${title}`,
                  source: offsets(node, sourceFile),
                  attributes: { registrationFunction: callName },
                }),
              );
              addRelation(moduleEntity, "contains", testEntity, offsets(node, sourceFile));
              ownerNodes.set(callback, testEntity);
              visit(callback, testEntity);
            } else {
              addUnsupportedLimitation(
                "test-registration",
                "A test registration used an unsupported non-literal title or callback shape.",
              );
            }
            return;
          }

          if (owner && !TEST_HELPERS.has(callName)) {
            const knownTarget = localEntities.get(callName);
            if (owner.kind === "test_case" && !knownTarget) {
              addUnsupportedLimitation(
                "test-target",
                "A test call target could not be resolved to a local or imported symbol.",
              );
            } else {
              const target = knownTarget ?? referenceEntity(callName, node.expression);
              addRelation(
                owner,
                owner.kind === "test_case" ? "tests" : "calls",
                target,
                offsets(node.expression, sourceFile),
              );
            }
          }
        }

        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression)
        ) {
          const receiver = node.expression.expression.text;
          const method = node.expression.name.text;
          if (ROUTE_RECEIVERS.has(receiver) && ROUTE_METHODS.has(method)) {
            const routePath = literalText(node.arguments[0]);
            if (routePath?.startsWith("/") && hasHandlerArgument(node.arguments)) {
              const endpoint = addEntity(
                createEntity(context, {
                  semanticKey: `endpoint:${method}:${routePath}`,
                  kind: "endpoint",
                  displayName: `${method.toUpperCase()} ${routePath}`,
                  canonicalName: `${method.toUpperCase()} ${routePath}`,
                  source: offsets(node, sourceFile),
                  attributes: { method: method.toUpperCase(), routePath },
                }),
              );
              addRelation(
                moduleEntity,
                "defines_endpoint",
                endpoint,
                offsets(node, sourceFile),
                { syntax: "router_method_literal_path" },
              );
            } else {
              addUnsupportedLimitation(
                "route-registration",
                "A route-like call used a non-literal path or unsupported handler shape.",
              );
            }
          }
        }

        if (
          owner &&
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ts.isIdentifier(node.tagName) &&
          /^[A-Z]/u.test(node.tagName.text)
        ) {
          const component =
            localEntities.get(node.tagName.text) ??
            referenceEntity(node.tagName.text, node.tagName, "component");
          addRelation(
            owner,
            "renders",
            component,
            offsets(node.tagName, sourceFile),
          );
        }

        ts.forEachChild(node, (child) => visit(child, owner));
      };
      visit(sourceFile);

      return {
        entities: [...entities.values()],
        facts,
        limitations,
      };
    },
  };
}
