export interface SymbolRenameIntent {
  from: string;
  to: string;
}

const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;

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
      String.raw`\brename\s+(?:the\s+)?(?:(?:typescript|ts)\s*[- ]?\s*)?(?:(?:type|interface|class|enum|symbol)\s+)?(${IDENTIFIER})\s+(?:to|as)\s+(${IDENTIFIER})\b`,
      "iu",
    ),
    new RegExp(
      String.raw`(?:^|[^\p{L}\p{N}_])переимен(?:уй|овать)\s+(?:(?:typescript|ts)\s*[- ]?\s*)?(?:(?:тип|интерфейс|класс|enum|символ)\s+)?(${IDENTIFIER})\s+в\s+(${IDENTIFIER})\b`,
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
