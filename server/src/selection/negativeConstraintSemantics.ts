const FILE_SCOPE_PATTERN = /\b(?:backend|server|api|frontend|client|ui|database|storage)\b|(?:бэкенд|бекенд|сервер|апи|фронтенд|клиент|интерфейс|база|хранилищ)/iu;

const PRESERVATION_OBJECT_PATTERN = /\b(?:behavior|behaviour|logic|formula|result|results|output|outputs|contract|semantics)\b|(?:поведен|логик|формул|результат|вывод|контракт|семантик)/iu;

const PRESERVATION_ACTION_PATTERN = /\b(?:without\s+(?:changing|modifying)|keep|preserve|remain|stays?|unchanged)\b|(?:без\s+изменени|не\s+меня(?:й|ть)|сохран(?:и|ить)|остав(?:ь|ить)\s+без\s+изменени)/iu;

const EXPLICIT_FILE_PATTERN = /(?:^|[\s"'`(])(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+(?:\.[a-z0-9]+)?(?:$|[\s"'`),.;:])|\b[a-z0-9_.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|mdx?|css|scss|sql)\b/i;

const BACKEND_SCOPE_SOURCE = String.raw`(?:\b(?:backend|back[-\s]?end|server|api|endpoint|route|request|fetch|upload|database|db|storage|repository|auth|authorization|authentication|session|token|cookie)\b|(?:бэкенд|бекенд|сервер|апи|эндпоинт\p{L}*|маршрут\p{L}*|запрос\p{L}*|загруз\p{L}*|баз\p{L}*\s+данн\p{L}*|бд|хранилищ\p{L}*|репозитор\p{L}*|авторизац\p{L}*|аутентиф\p{L}*|сесси\p{L}*|токен\p{L}*|куки))`;
const FRONTEND_SCOPE_SOURCE = String.raw`(?:\b(?:frontend|front[-\s]?end|ui|ux|client|renderer|interface)\b|(?:фронтенд|фронт|интерфейс|клиент|рендерер))`;
const NEGATIVE_DIRECTIVE_SOURCE = String.raw`(?:\b(?:do\s+not|don't|dont|must\s+not|should\s+not)\s+(?:touch|change|edit|modify|alter|rewrite|create|add|introduce|register)\b|\bwithout(?:\s+(?:changing|touching|editing|modifying|altering|rewriting|creating|adding))?\b|\bavoid(?:\s+(?:changing|touching|editing|modifying|altering|rewriting))?\b|\bno\s+(?:(?:changes?|edits?|modifications?)\b|(?:new|separate|additional)\b)|не\s+(?:трог\p{L}*|мен\p{L}*|измен\p{L}*|редактир\p{L}*|перепис\p{L}*|созд\p{L}*|добав\p{L}*|затрагив\p{L}*)|без\s+(?:изменени\p{L}*|правок|нов\p{L}*|отдельн\p{L}*|дополнительн\p{L}*))`;
const CONTRAST_PATTERN = /\b(?:but|however)\b|(?:^|\s)(?:но|однако)(?=\s|$)/iu;

export interface ImplementationScopeConstraints {
  backendProtected: boolean;
  frontendProtected: boolean;
}

function scopeMentions(value: string) {
  return {
    backend: new RegExp(BACKEND_SCOPE_SOURCE, "iu").test(value),
    frontend: new RegExp(FRONTEND_SCOPE_SOURCE, "iu").test(value),
  };
}

function beforeFirstContrast(value: string) {
  const match = CONTRAST_PATTERN.exec(value);
  return match?.index === undefined ? value : value.slice(0, match.index);
}

function afterLastContrast(value: string) {
  let result = value;
  while (true) {
    const match = CONTRAST_PATTERN.exec(result);
    if (match?.index === undefined) return result;
    result = result.slice(match.index + match[0].length);
  }
}

function protectedScopesInClause(clause: string) {
  let backendProtected = false;
  let frontendProtected = false;
  const mark = (value: string) => {
    const mentions = scopeMentions(value);
    backendProtected ||= mentions.backend;
    frontendProtected ||= mentions.frontend;
  };

  const directives = Array.from(
    clause.matchAll(new RegExp(NEGATIVE_DIRECTIVE_SOURCE, "giu")),
  );
  for (const directive of directives) {
    const start = directive.index ?? 0;
    const end = start + directive[0].length;
    const after = beforeFirstContrast(clause.slice(end, end + 140));
    const afterMentions = scopeMentions(after);
    if (afterMentions.backend || afterMentions.frontend) {
      mark(after);
      continue;
    }

    // Natural suffix order, for example "backend не изменять". Only inspect
    // the nearest contrast-bounded prefix so a positive layer in an earlier
    // clause cannot be captured by a later prohibition.
    mark(afterLastContrast(clause.slice(Math.max(0, start - 100), start)));
  }

  const preservationPatterns = [
    new RegExp(
      String.raw`\b(?:keep|leave)\b([^;.!?\n]{0,100})\b(?:unchanged|untouched|intact)\b`,
      "giu",
    ),
    new RegExp(
      String.raw`((?:${BACKEND_SCOPE_SOURCE}|${FRONTEND_SCOPE_SOURCE})[^;.!?\n]{0,80})\b(?:must|should)?\s*(?:stay|remain)?\s*(?:unchanged|untouched|intact)\b`,
      "giu",
    ),
    new RegExp(
      String.raw`((?:${BACKEND_SCOPE_SOURCE}|${FRONTEND_SCOPE_SOURCE})[^;.!?\n]{0,100})(?:(?:create|add|introduce|register)(?:ing)?\s+(?:is\s+)?not\s+(?:needed|required)|(?:создавать|добавлять|регистрировать)\s+не\s+(?:нужно|требуется))`,
      "giu",
    ),
  ];
  for (const pattern of preservationPatterns) {
    for (const match of clause.matchAll(pattern)) mark(match[1] ?? match[0]);
  }

  const normalized = clause.trim();
  if (
    new RegExp(
      String.raw`(?:\bonly\s+(?:${FRONTEND_SCOPE_SOURCE}|visual\b)|(?:${FRONTEND_SCOPE_SOURCE}|\bvisual)\s+only\b|только\s+(?:${FRONTEND_SCOPE_SOURCE}|визуал\p{L}*))`,
      "iu",
    ).test(normalized)
  ) {
    backendProtected = true;
  }
  if (
    new RegExp(
      String.raw`(?:\bonly\s+${BACKEND_SCOPE_SOURCE}|${BACKEND_SCOPE_SOURCE}\s+only\b|только\s+${BACKEND_SCOPE_SOURCE})`,
      "iu",
    ).test(normalized)
  ) {
    frontendProtected = true;
  }

  return { backendProtected, frontendProtected };
}

/**
 * Separates negative implementation scope from positive routing evidence.
 * Clause boundaries are significant: a positive backend clause followed by a
 * frontend prohibition must not accidentally protect the backend (or vice
 * versa). The original task remains untouched for safety and authorization.
 */
export function getImplementationScopeConstraints(
  rawTask: string,
  protectedScopes: readonly string[] = [],
): ImplementationScopeConstraints {
  let backendProtected = false;
  let frontendProtected = false;
  for (const clause of String(rawTask ?? "").split(/[;!?\n]+|\.(?=\s|$)/u)) {
    const clauseConstraints = protectedScopesInClause(clause);
    backendProtected ||= clauseConstraints.backendProtected;
    frontendProtected ||= clauseConstraints.frontendProtected;
  }
  for (const protectedScope of protectedScopes) {
    const mentions = scopeMentions(protectedScope);
    backendProtected ||= mentions.backend;
    frontendProtected ||= mentions.frontend;
  }
  return { backendProtected, frontendProtected };
}

/**
 * Returns true when a negative clause can safely exclude repository files.
 * Preservation constraints such as "without changing the formula" constrain
 * behavior, not the ownership file that implements that behavior.
 */
export function isFileExclusionConstraint(constraint: string) {
  const normalized = constraint.replace(/\\/g, "/").trim();
  if (!normalized) return false;
  if (EXPLICIT_FILE_PATTERN.test(normalized)) return true;
  if (FILE_SCOPE_PATTERN.test(normalized)) return true;
  if (PRESERVATION_ACTION_PATTERN.test(normalized) && PRESERVATION_OBJECT_PATTERN.test(normalized)) {
    return false;
  }
  return true;
}
