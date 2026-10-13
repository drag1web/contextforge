// Runtime names are an inventory, not proof that an arbitrary API is genuine.
// TypeScript type queries below are fully erased from the safe core's closure.
export const TYPESCRIPT_PARSER_FUNCTIONS = Object.freeze([
  "createSourceFile", "forEachChild", "canHaveModifiers", "getModifiers",
  "isArrowFunction", "isCallExpression", "isClassDeclaration", "isClassExpression",
  "isConstructorDeclaration", "isExportAssignment", "isExportDeclaration",
  "isFunctionDeclaration", "isFunctionExpression", "isGetAccessorDeclaration",
  "isIdentifier", "isImportDeclaration", "isInterfaceDeclaration",
  "isJsxElement", "isJsxFragment", "isJsxOpeningElement", "isJsxSelfClosingElement",
  "isMethodDeclaration", "isNamedExports", "isNamedImports", "isNamespaceImport",
  "isNoSubstitutionTemplateLiteral", "isPropertyAccessExpression",
  "isSetAccessorDeclaration", "isStringLiteralLike", "isTypeAliasDeclaration",
  "isVariableStatement",
] as const);

export type TypeScriptParserFunction = typeof TYPESCRIPT_PARSER_FUNCTIONS[number];

/** Narrow API shape only. Genuine admission is performed by the separate issuer. */
export type TypeScriptParserCapabilities = Readonly<Pick<
  typeof import("typescript"),
  TypeScriptParserFunction | "ScriptTarget" | "ScriptKind" | "SyntaxKind"
>>;
