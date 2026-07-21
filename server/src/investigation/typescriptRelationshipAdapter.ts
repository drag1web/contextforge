import ts from "typescript";

import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventorySemanticFacts,
} from "../scanner/projectInventoryScanner.js";
import { buildProjectSemanticGraph, type SemanticGraphEdge } from "../selection/projectSemanticGraph.js";

export type InvestigationEdgeType =
  | "imports"
  | "imported_by"
  | "defines_symbol"
  | "references_symbol"
  | "calls_function"
  | "renders_component"
  | "passes_prop"
  | "receives_prop"
  | "state_setter"
  | "route_registration"
  | "router_mount"
  | "api_request"
  | "type_field"
  | "translation_key_use"
  | "translation_entry";

export interface InvestigationFileFacts {
  file: ProjectInventoryFile;
  normalizedPath: string;
  imports: SemanticGraphEdge[];
  importedBy: SemanticGraphEdge[];
  declarations: Set<string>;
  references: Set<string>;
  assignments: Set<string>;
  objectProperties: Set<string>;
  stateSymbols: Set<string>;
  statePairs: Array<{ state: string; setter: string }>;
  callSymbols: Set<string>;
  jsxComponents: Set<string>;
  jsxProps: Set<string>;
  jsxPassedProps: Array<{ component: string; prop: string; value: string }>;
  receivedProps: Set<string>;
  translationKeys: Set<string>;
  translationEntries: Array<{ key: string; value: string }>;
  routePaths: Set<string>;
  apiRequests: Array<{ method: string; route: string }>;
  typeFields: Set<string>;
}

export interface InvestigationRelationshipIndex {
  files: InvestigationFileFacts[];
  byPath: Map<string, InvestigationFileFacts>;
  declarationsBySymbol: Map<string, InvestigationFileFacts[]>;
  referencesBySymbol: Map<string, InvestigationFileFacts[]>;
  jsxUsersByComponent: Map<string, InvestigationFileFacts[]>;
  propReceiversByProp: Map<string, InvestigationFileFacts[]>;
  propPassersByComponentProp: Map<string, Array<{ file: InvestigationFileFacts; value: string }>>;
  translationOwnersByValue: Map<string, Array<{ file: InvestigationFileFacts; key: string }>>;
  translationOwnersByKey: Map<string, InvestigationFileFacts[]>;
  translationUsersByKey: Map<string, InvestigationFileFacts[]>;
  buildDurationMs: number;
}

const INDEX_CACHE = new WeakMap<ProjectInventory, InvestigationRelationshipIndex>();

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeKey(value: string) {
  return normalizePath(value).toLowerCase();
}

function canonical(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 2)
    .join("");
}

function canonicalComponent(value: string) {
  return value
    .replace(/\.[^.]+$/u, "")
    .replace(/[^A-Za-z0-9_\p{L}]+/gu, "")
    .toLowerCase();
}

function addMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const normalized = canonical(key);
  if (!normalized) return;
  const current = map.get(normalized) ?? [];
  if (!current.includes(value)) current.push(value);
  map.set(normalized, current);
}

function toSet(values: string[]) {
  return new Set(values.map(canonical).filter((value) => value.length >= 3));
}

function emptySemanticFacts(): ProjectInventorySemanticFacts {
  return {
    declarations: [],
    references: [],
    assignments: [],
    objectProperties: [],
    typeFields: [],
    stateSymbols: [],
    translationKeys: [],
    translationEntries: [],
    stringLiterals: [],
    structuredEntries: [],
    routePaths: [],
  };
}

function sourceKindForExtension(extension: string) {
  const ext = extension.toLowerCase();
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function nodeNameText(name: ts.PropertyName | ts.BindingName | ts.Identifier | undefined) {
  if (!name) return "";
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return "";
}

function propertyAccessName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function propertyAccessRoot(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return propertyAccessRoot(expression.expression);
  if (ts.isElementAccessExpression(expression)) return propertyAccessRoot(expression.expression);
  return "";
}

function propertyAccessPath(expression: ts.Expression, source: ts.SourceFile): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = propertyAccessPath(expression.expression, source);
    return left ? `${left}.${expression.name.text}` : expression.name.text;
  }
  if (ts.isElementAccessExpression(expression)) {
    const left = propertyAccessPath(expression.expression, source);
    const argument = expression.argumentExpression?.getText(source) ?? "";
    return left && argument ? `${left}[${argument}]` : left;
  }
  return "";
}

function isStateHookInitializer(expression: ts.Expression | undefined) {
  if (!expression || !ts.isCallExpression(expression)) return false;
  const call = expression.expression;
  if (ts.isIdentifier(call)) return call.text === "useState" || call.text === "useReducer";
  if (ts.isPropertyAccessExpression(call)) {
    return propertyAccessRoot(call.expression) === "React" && (call.name.text === "useState" || call.name.text === "useReducer");
  }
  return false;
}

function isRouteLikeReceiver(receiver: string) {
  return /^(?:router|app|server|apiRouter|expressRouter)$/i.test(receiver) || /router$/i.test(receiver);
}

function hasHandlerArgument(args: ts.NodeArray<ts.Expression>) {
  return args.length >= 2 && args.slice(1).some((arg) =>
    ts.isArrowFunction(arg) ||
    ts.isFunctionExpression(arg) ||
    ts.isIdentifier(arg) ||
    ts.isCallExpression(arg)
  );
}

function literalRouteText(expression: ts.Expression | undefined) {
  if (!expression) return "";
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  return "";
}

function isComponentFunction(node: ts.Node) {
  if (ts.isFunctionDeclaration(node)) return Boolean(node.name && /^[A-Z]/.test(node.name.text));
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent)) {
      const name = nodeNameText(parent.name);
      return /^[A-Z]/.test(name);
    }
  }
  return false;
}

function extractAstFacts(file: ProjectInventoryFile) {
  const sourceText = file.contentPreview ?? "";
  const facts = {
    declarations: new Set<string>(),
    references: new Set<string>(),
    assignments: new Set<string>(),
    objectProperties: new Set<string>(),
    stateSymbols: new Set<string>(),
    statePairs: [] as Array<{ state: string; setter: string }>,
    callSymbols: new Set<string>(),
    jsxComponents: new Set<string>(),
    jsxProps: new Set<string>(),
    jsxPassedProps: [] as Array<{ component: string; prop: string; value: string }>,
    receivedProps: new Set<string>(),
    translationKeys: new Set<string>(),
    routePaths: new Set<string>(),
    apiRequests: [] as Array<{ method: string; route: string }>,
    typeFields: new Set<string>(),
  };
  if (!sourceText || !/\.[cm]?[jt]sx?$/i.test(file.name)) return facts;

  const source = ts.createSourceFile(
    file.path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceKindForExtension(file.extension),
  );

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const name = node.name?.text;
      if (name) facts.declarations.add(name);
    }

    if (ts.isVariableDeclaration(node)) {
      const name = nodeNameText(node.name);
      if (name) facts.declarations.add(name);
      if (ts.isArrayBindingPattern(node.name) && isStateHookInitializer(node.initializer)) {
        const elements = node.name.elements
          .filter(ts.isBindingElement)
          .map((element) => nodeNameText(element.name));
        const [stateName, setterName] = elements;
        if (stateName && setterName && /^set[A-Z]/.test(setterName)) {
          facts.stateSymbols.add(stateName);
          facts.stateSymbols.add(setterName);
          facts.statePairs.push({ state: stateName, setter: setterName });
        }
        for (const element of elements) {
          if (/^set[A-Z]/.test(element)) facts.stateSymbols.add(element);
        }
      }
      if (ts.isObjectBindingPattern(node.name) && node.initializer && isComponentFunction(node.initializer)) {
        for (const element of node.name.elements) {
          const propName = nodeNameText(element.propertyName ?? element.name);
          if (propName) facts.receivedProps.add(propName);
        }
      }
    }

    if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name) && node.parent && isComponentFunction(node.parent)) {
      for (const element of node.name.elements) {
        const propName = nodeNameText(element.propertyName ?? element.name);
        if (propName) facts.receivedProps.add(propName);
      }
    }

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = nodeNameText(node.name);
      if (name) facts.objectProperties.add(name);
    }

    if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
      const name = nodeNameText(node.name);
      if (name) facts.objectProperties.add(name);
      if (name && ts.isPropertySignature(node)) facts.typeFields.add(name);
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const assigned = propertyAccessName(node.left);
      if (assigned) facts.assignments.add(assigned);
    }

    if (ts.isCallExpression(node)) {
      const callName = propertyAccessName(node.expression);
      if (callName) facts.callSymbols.add(callName);
      if (ts.isPropertyAccessExpression(node.expression)) {
        const receiver = propertyAccessRoot(node.expression.expression);
        const route = literalRouteText(node.arguments[0]);
        if (
          /^(get|post|put|patch|delete)$/i.test(callName) &&
          isRouteLikeReceiver(receiver) &&
          route &&
          route.startsWith("/") &&
          hasHandlerArgument(node.arguments)
        ) {
          facts.routePaths.add(route);
        }
        if (
          callName === "use" &&
          /^(?:app|router|server)$/i.test(receiver) &&
          route &&
          route.startsWith("/") &&
          node.arguments.length >= 2
        ) {
          facts.apiRequests.push({ method: "use", route });
        }
      }
      if (/^(fetch|request|apiFetch|apiRequest)$/i.test(callName)) {
        const route = literalRouteText(node.arguments[0]);
        if (route) {
          facts.apiRequests.push({ method: callName, route });
        }
      }
      if (callName === "t") {
        const first = node.arguments[0];
        if (first && ts.isStringLiteralLike(first)) facts.translationKeys.add(first.text);
      }
    }

    if (ts.isJsxOpeningLikeElement(node)) {
      const tag = node.tagName.getText(source);
      if (/^[A-Z]/.test(tag)) facts.jsxComponents.add(tag);
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = ts.isIdentifier(attr.name)
          ? attr.name.text
          : attr.name.getText(source);
        if (name) facts.jsxProps.add(name);
        const initializer = attr.initializer;
        if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
          const expressionRoot = propertyAccessRoot(initializer.expression);
          const expressionPath = propertyAccessPath(initializer.expression, source);
          if (expressionRoot) facts.references.add(expressionRoot);
          if (expressionPath) {
          facts.jsxPassedProps.push({
            component: tag,
            prop: name,
            value: expressionPath,
          });
          }
        }
      }
    }

    if (ts.isIdentifier(node)) {
      facts.references.add(node.text);
    }

    if (ts.isStringLiteralLike(node)) {
      if (/^[a-z0-9_.:-]{2,80}$/i.test(node.text) && node.text.includes(".")) {
        facts.translationKeys.add(node.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return facts;
}

function mergeFacts(file: ProjectInventoryFile): InvestigationFileFacts {
  const semantic = file.semanticFacts ?? emptySemanticFacts();
  const ast = extractAstFacts(file);
  return {
    file,
    normalizedPath: normalizeKey(file.path),
    imports: [],
    importedBy: [],
    declarations: toSet([
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...semantic.declarations,
      ...semantic.assignments,
      ...ast.declarations,
      ...ast.assignments,
    ]),
    references: toSet([...semantic.references, ...ast.references, ...ast.callSymbols]),
    assignments: toSet([...semantic.assignments, ...ast.assignments]),
    objectProperties: toSet([...semantic.objectProperties, ...ast.objectProperties]),
    stateSymbols: toSet([...semantic.stateSymbols, ...ast.stateSymbols]),
    statePairs: ast.statePairs.map((pair) => ({
      state: canonical(pair.state),
      setter: canonical(pair.setter),
    })).filter((pair) => pair.state && pair.setter),
    callSymbols: toSet([...ast.callSymbols]),
    jsxComponents: new Set([...ast.jsxComponents].map(canonicalComponent).filter((value) => value.length >= 2)),
    jsxProps: toSet([...ast.jsxProps]),
    jsxPassedProps: ast.jsxPassedProps.map((item) => ({
      component: canonicalComponent(item.component),
      prop: canonical(item.prop),
      value: canonical(item.value),
    })).filter((item) => item.component && item.prop && item.value),
    receivedProps: toSet([...ast.receivedProps]),
    translationKeys: new Set([...semantic.translationKeys, ...ast.translationKeys].map((key) => key.toLowerCase())),
    translationEntries: semantic.translationEntries,
    routePaths: new Set([...semantic.routePaths, ...ast.routePaths].map((route) => route.toLowerCase())),
    apiRequests: ast.apiRequests,
    typeFields: toSet([...(semantic.typeFields ?? []), ...ast.typeFields]),
  };
}

export function buildInvestigationRelationshipIndex(inventory: ProjectInventory) {
  const cached = INDEX_CACHE.get(inventory);
  if (cached) return { index: cached, reused: true };

  const startedAt = performance.now();
  const graph = buildProjectSemanticGraph(inventory);
  const files = inventory.files
    .filter((file) => file.canReadText && !file.isLikelyGenerated)
    .map(mergeFacts);
  const byPath = new Map(files.map((file) => [file.normalizedPath, file]));

  for (const file of files) {
    const node = graph.getNode(file.file.path);
    file.imports = node?.imports ?? [];
    file.importedBy = node?.importedBy ?? [];
  }

  const declarationsBySymbol = new Map<string, InvestigationFileFacts[]>();
  const referencesBySymbol = new Map<string, InvestigationFileFacts[]>();
  const jsxUsersByComponent = new Map<string, InvestigationFileFacts[]>();
  const propReceiversByProp = new Map<string, InvestigationFileFacts[]>();
  const propPassersByComponentProp = new Map<string, Array<{ file: InvestigationFileFacts; value: string }>>();
  const translationOwnersByValue = new Map<string, Array<{ file: InvestigationFileFacts; key: string }>>();
  const translationOwnersByKey = new Map<string, InvestigationFileFacts[]>();
  const translationUsersByKey = new Map<string, InvestigationFileFacts[]>();

  for (const file of files) {
    for (const symbol of file.declarations) addMap(declarationsBySymbol, symbol, file);
    for (const symbol of [...file.references, ...file.objectProperties, ...file.assignments, ...file.stateSymbols]) {
      addMap(referencesBySymbol, symbol, file);
    }
    for (const component of file.jsxComponents) addMap(jsxUsersByComponent, component, file);
    for (const prop of file.receivedProps) addMap(propReceiversByProp, prop, file);
    for (const passed of file.jsxPassedProps) {
      const key = `${canonical(passed.component)}:${canonical(passed.prop)}`;
      if (!key) continue;
      const current = propPassersByComponentProp.get(key) ?? [];
      current.push({ file, value: passed.value });
      propPassersByComponentProp.set(key, current);
    }
    for (const key of file.translationKeys) addMap(translationUsersByKey, key, file);
    for (const entry of file.translationEntries) {
      const valueKey = canonical(entry.value);
      const current = translationOwnersByValue.get(valueKey) ?? [];
      current.push({ file, key: entry.key });
      translationOwnersByValue.set(valueKey, current);
      addMap(translationOwnersByKey, entry.key, file);
    }
  }

  const index: InvestigationRelationshipIndex = {
    files,
    byPath,
    declarationsBySymbol,
    referencesBySymbol,
    jsxUsersByComponent,
    propReceiversByProp,
    propPassersByComponentProp,
    translationOwnersByValue,
    translationOwnersByKey,
    translationUsersByKey,
    buildDurationMs: performance.now() - startedAt,
  };
  INDEX_CACHE.set(inventory, index);
  return { index, reused: false };
}

export function canonicalInvestigationSymbol(value: string) {
  return canonical(value);
}

export function canonicalInvestigationComponent(value: string) {
  return canonicalComponent(value);
}

export function normalizeInvestigationPath(value: string) {
  return normalizeKey(value);
}
