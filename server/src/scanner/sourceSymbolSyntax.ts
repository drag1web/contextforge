export type SourceSymbolImportKind =
  | "named"
  | "default"
  | "namespace"
  | "reexport";

export interface SourceSymbolImportBinding {
  moduleSpecifier: string;
  importedName: string;
  localName: string;
  kind: SourceSymbolImportKind;
  typeOnly: boolean;
}

export interface SourceSymbolSyntaxFacts {
  parser: "js-ts-lexical-v1";
  declarations: string[];
  references: string[];
  imports: SourceSymbolImportBinding[];
  exports: string[];
  symbols: string[];
  moduleSpecifiers: string[];
}

export interface SourceSymbolSyntaxAnalysis {
  facts: SourceSymbolSyntaxFacts;
  code: string;
}

const JS_TS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const IDENTIFIER_PATTERN = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

const IDENTIFIER_STOP_WORDS = new Set([
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "keyof",
  "let",
  "module",
  "namespace",
  "new",
  "null",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "using",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function uniqueStrings(values: string[], limit = values.length) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function writeMasked(output: string[], index: number, sourceChar: string) {
  output[index] = sourceChar === "\n" || sourceChar === "\r" ? sourceChar : " ";
}

function previousCodeToken(output: string[], lastSignificantIndex: number) {
  if (lastSignificantIndex < 0) return { char: "", word: "" };
  let cursor = lastSignificantIndex;
  const char = output[cursor] ?? "";
  if (!/[A-Za-z0-9_$]/u.test(char)) return { char, word: "" };
  const end = cursor + 1;
  while (cursor >= 0 && /[A-Za-z0-9_$]/u.test(output[cursor] ?? "")) cursor -= 1;
  return {
    char,
    word: output.slice(cursor + 1, end).join(""),
  };
}

function canStartRegex(
  output: string[],
  lastSignificantIndex: number,
  lastTokenWasLiteral: boolean,
) {
  if (lastTokenWasLiteral) return false;
  const previous = previousCodeToken(output, lastSignificantIndex);
  if (!previous.char) return true;
  if (/[(\[{=,:;!?&|+\-*%^~<>]/u.test(previous.char)) return true;
  return REGEX_PREFIX_KEYWORDS.has(previous.word);
}

/**
 * Produces a position-preserving JavaScript/TypeScript code view. Comments,
 * quoted strings, template literals and regular-expression bodies are masked,
 * so later identifier extraction cannot mistake fixtures or prose for code.
 */
export function maskJavaScriptTypeScriptNonCode(source: string) {
  const output = Array.from(source);
  let index = 0;
  let lastSignificantIndex = -1;
  let lastTokenWasLiteral = false;

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (char === "/" && next === "/") {
      writeMasked(output, index, char);
      writeMasked(output, index + 1, next);
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        writeMasked(output, index, source[index] ?? "");
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      writeMasked(output, index, char);
      writeMasked(output, index + 1, next);
      index += 2;
      while (index < source.length) {
        const current = source[index] ?? "";
        const following = source[index + 1] ?? "";
        writeMasked(output, index, current);
        if (current === "*" && following === "/") {
          writeMasked(output, index + 1, following);
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      writeMasked(output, index, char);
      index += 1;
      while (index < source.length) {
        const current = source[index] ?? "";
        writeMasked(output, index, current);
        if (current === "\\") {
          index += 1;
          if (index < source.length) {
            writeMasked(output, index, source[index] ?? "");
          }
          index += 1;
          continue;
        }
        index += 1;
        if (current === quote) break;
      }
      lastSignificantIndex = -1;
      lastTokenWasLiteral = true;
      continue;
    }

    if (
      char === "/" &&
      next !== "/" &&
      next !== "*" &&
      canStartRegex(output, lastSignificantIndex, lastTokenWasLiteral)
    ) {
      writeMasked(output, index, char);
      index += 1;
      let inCharacterClass = false;
      while (index < source.length) {
        const current = source[index] ?? "";
        writeMasked(output, index, current);
        if (current === "\\") {
          index += 1;
          if (index < source.length) {
            writeMasked(output, index, source[index] ?? "");
          }
          index += 1;
          continue;
        }
        if (current === "[") inCharacterClass = true;
        if (current === "]") inCharacterClass = false;
        index += 1;
        if (current === "/" && !inCharacterClass) {
          while (index < source.length && /[A-Za-z]/u.test(source[index] ?? "")) {
            writeMasked(output, index, source[index] ?? "");
            index += 1;
          }
          break;
        }
        if (current === "\n" || current === "\r") break;
      }
      lastSignificantIndex = -1;
      lastTokenWasLiteral = true;
      continue;
    }

    if (!/\s/u.test(char)) {
      lastSignificantIndex = index;
      lastTokenWasLiteral = false;
    }
    index += 1;
  }

  return output.join("");
}

function maskJsxText(code: string) {
  const output = Array.from(code);
  for (const match of code.matchAll(/>([^<>{}]*)</g)) {
    const full = match[0] ?? "";
    const text = match[1] ?? "";
    if (!text.trim()) continue;
    const start = (match.index ?? 0) + full.indexOf(text);
    for (let index = start; index < start + text.length; index += 1) {
      writeMasked(output, index, code[index] ?? "");
    }
  }
  return output.join("");
}

function declarationNames(code: string) {
  const values: string[] = [];
  const patterns = [
    /\b(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\b(?:export\s+)?(?:declare\s+)?(?:const|let|var|using)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) values.push(match[1]);
    }
  }
  return uniqueStrings(values, 800);
}

function identifierReferences(code: string) {
  const values: string[] = [];
  for (const match of code.matchAll(IDENTIFIER_PATTERN)) {
    const value = match[1] ?? "";
    if (!value || IDENTIFIER_STOP_WORDS.has(value)) continue;
    values.push(value);
  }
  return uniqueStrings(values, 1600);
}

function findStatementSlice(source: string, code: string, start: number) {
  const maxEnd = Math.min(source.length, start + 6000);
  let braceDepth = 0;
  for (let index = start; index < maxEnd; index += 1) {
    const char = code[index] ?? "";
    if (char === "{" || char === "[" || char === "(") braceDepth += 1;
    if (char === "}" || char === "]" || char === ")") braceDepth = Math.max(0, braceDepth - 1);
    if (char === ";" && braceDepth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start, maxEnd);
}

function parseNamedBindings(
  raw: string,
  moduleSpecifier: string,
  kind: "named" | "reexport",
  enclosingTypeOnly: boolean,
) {
  const bindings: SourceSymbolImportBinding[] = [];
  const body = raw.replace(/^\s*\{/u, "").replace(/\}\s*$/u, "");
  for (const partRaw of body.split(",")) {
    let part = partRaw.trim();
    if (!part) continue;
    let typeOnly = enclosingTypeOnly;
    if (/^type\s+/u.test(part)) {
      typeOnly = true;
      part = part.replace(/^type\s+/u, "").trim();
    }
    const [importedRaw, localRaw] = part.split(/\s+as\s+/iu).map((value) => value.trim());
    const importedName = importedRaw ?? "";
    const localName = localRaw || importedName;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(importedName)) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(localName)) continue;
    bindings.push({
      moduleSpecifier,
      importedName,
      localName,
      kind,
      typeOnly,
    });
  }
  return bindings;
}

function parseImportStatement(statement: string) {
  const bindings: SourceSymbolImportBinding[] = [];
  const sideEffect = statement.match(/^\s*import\s*["']([^"']+)["']/u);
  if (sideEffect?.[1]) {
    return { bindings, moduleSpecifier: sideEffect[1] };
  }

  const match = statement.match(
    /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/u,
  );
  if (!match?.[2] || !match[3]) return null;
  const enclosingTypeOnly = Boolean(match[1]);
  const clause = match[2].trim();
  const moduleSpecifier = match[3];

  const named = clause.match(/\{([\s\S]*?)\}/u);
  if (named?.[0]) {
    bindings.push(
      ...parseNamedBindings(named[0], moduleSpecifier, "named", enclosingTypeOnly),
    );
  }

  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/u);
  if (namespace?.[1]) {
    bindings.push({
      moduleSpecifier,
      importedName: "*",
      localName: namespace[1],
      kind: "namespace",
      typeOnly: enclosingTypeOnly,
    });
  }

  const prefix = clause
    .replace(/\{[\s\S]*?\}/u, "")
    .replace(/\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*/u, "")
    .replace(/,$/u, "")
    .trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(prefix)) {
    bindings.push({
      moduleSpecifier,
      importedName: "default",
      localName: prefix,
      kind: "default",
      typeOnly: enclosingTypeOnly,
    });
  }

  return { bindings, moduleSpecifier };
}

function parseReexportStatement(statement: string) {
  const match = statement.match(
    /^\s*export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["']/u,
  );
  if (!match?.[2] || !match[3]) return null;
  const moduleSpecifier = match[3];
  return {
    bindings: parseNamedBindings(
      `{${match[2]}}`,
      moduleSpecifier,
      "reexport",
      Boolean(match[1]),
    ),
    moduleSpecifier,
  };
}

function extractModuleBindings(source: string, code: string) {
  const imports: SourceSymbolImportBinding[] = [];
  const moduleSpecifiers: string[] = [];

  for (const match of code.matchAll(/\bimport\b/g)) {
    const start = match.index ?? 0;
    const after = code.slice(start + "import".length).match(/^\s*/u)?.[0].length ?? 0;
    if (code[start + "import".length + after] === "(") continue;
    const parsed = parseImportStatement(findStatementSlice(source, code, start));
    if (!parsed) continue;
    imports.push(...parsed.bindings);
    moduleSpecifiers.push(parsed.moduleSpecifier);
  }

  for (const match of code.matchAll(/\bexport\b/g)) {
    const start = match.index ?? 0;
    const parsed = parseReexportStatement(findStatementSlice(source, code, start));
    if (!parsed) continue;
    imports.push(...parsed.bindings);
    moduleSpecifiers.push(parsed.moduleSpecifier);
  }

  return {
    imports,
    moduleSpecifiers: uniqueStrings(moduleSpecifiers, 160),
  };
}

function exportedNames(source: string, code: string, declarations: string[]) {
  const exports: string[] = [];
  for (const declaration of declarations) {
    const pattern = new RegExp(
      String.raw`\bexport\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|module|const|let|var|using)\s+${declaration}\b`,
      "u",
    );
    if (pattern.test(code)) exports.push(declaration);
  }

  for (const match of code.matchAll(/\bexport\s+(?:type\s+)?\{([\s\S]*?)\}(?!\s*from\b)/g)) {
    const raw = source.slice(
      (match.index ?? 0) + (match[0]?.indexOf("{") ?? 0),
      (match.index ?? 0) + (match[0]?.lastIndexOf("}") ?? 0) + 1,
    );
    for (const binding of parseNamedBindings(raw, "", "reexport", false)) {
      exports.push(binding.localName);
    }
  }

  for (const match of code.matchAll(/\bexport\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    if (match[1]) exports.push(match[1]);
  }
  return uniqueStrings(exports, 160);
}

export function analyzeJavaScriptTypeScriptSymbols(
  source: string,
  extension: string,
): SourceSymbolSyntaxAnalysis | null {
  if (!JS_TS_EXTENSIONS.has(extension.toLowerCase())) return null;

  const nonCodeMasked = maskJavaScriptTypeScriptNonCode(source);
  const code = /\.(?:tsx|jsx)$/iu.test(extension)
    ? maskJsxText(nonCodeMasked)
    : nonCodeMasked;
  const declarations = declarationNames(code);
  const references = identifierReferences(code);
  const moduleBindings = extractModuleBindings(source, code);
  const exports = exportedNames(source, code, declarations);

  return {
    code,
    facts: {
      parser: "js-ts-lexical-v1",
      declarations,
      references,
      imports: moduleBindings.imports,
      exports,
      symbols: uniqueStrings(declarations, 240),
      moduleSpecifiers: moduleBindings.moduleSpecifiers,
    },
  };
}
