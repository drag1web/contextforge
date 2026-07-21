export interface SymbolRenameIntent {
  from: string;
  to: string;
}

const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
const CODE_FILE_PATH = String.raw`(?:['"\x60]?(?:[A-Za-z]:)?(?:[A-Za-z0-9_.@()\[\]{}+~$!#%&=,'^-]+[\\/])*[A-Za-z0-9_.@()\[\]{}+~$!#%&=,'^-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)['"\x60]?)`;
const ENGLISH_OWNER_QUALIFIER = String.raw`(?:\s+(?:in|inside|within)\s+(?:the\s+)?(?:file\s+)?${CODE_FILE_PATH})?`;
const RUSSIAN_OWNER_QUALIFIER = String.raw`(?:\s+в\s+(?:файл(?:е|а)?\s+)?${CODE_FILE_PATH})?`;

/**
 * Extracts a literal code-symbol rename from user wording. The matcher is
 * intentionally limited to explicit rename verbs so ordinary text
 * replacements never become repository-wide identifier edits.
 */
export function extractSymbolRenameIntent(
  rawTask: string,
): SymbolRenameIntent | null {
  const patterns = [
    new RegExp(
      String.raw`\brename\s+(?:the\s+)?(?:(?:exported|public)\s+)?(?:(?:typescript|ts)\s*[- ]?\s*)?(?:(?:type|interface|class|enum|symbol)\s+)?(${IDENTIFIER})${ENGLISH_OWNER_QUALIFIER}\s+(?:to|as)\s+(${IDENTIFIER})\b`,
      "iu",
    ),
    new RegExp(
      String.raw`(?:^|[^\p{L}\p{N}_])переимен(?:уй|овать)\s+(?:(?:экспортируем\p{L}*|публичн\p{L}*)\s+)?(?:(?:typescript|ts)\s*[- ]?\s*)?(?:(?:тип|интерфейс|класс|enum|символ)\s+)?(${IDENTIFIER})${RUSSIAN_OWNER_QUALIFIER}\s+в\s+(${IDENTIFIER})\b`,
      "iu",
    ),
  ];

  for (const pattern of patterns) {
    const match = rawTask.match(pattern);
    const from = match?.[1]?.trim();
    const to = match?.[2]?.trim();
    if (!from || !to || from === to) continue;
    return { from, to };
  }

  return null;
}
