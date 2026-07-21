const FILE_SCOPE_PATTERN = /\b(?:backend|server|api|frontend|client|ui|database|storage)\b|(?:бэкенд|бекенд|сервер|апи|фронтенд|клиент|интерфейс|база|хранилищ)/iu;

const PRESERVATION_OBJECT_PATTERN = /\b(?:behavior|behaviour|logic|formula|result|results|output|outputs|contract|semantics)\b|(?:поведен|логик|формул|результат|вывод|контракт|семантик)/iu;

const PRESERVATION_ACTION_PATTERN = /\b(?:without\s+(?:changing|modifying)|keep|preserve|remain|stays?|unchanged)\b|(?:без\s+изменени|не\s+меня(?:й|ть)|сохран(?:и|ить)|остав(?:ь|ить)\s+без\s+изменени)/iu;

const EXPLICIT_FILE_PATTERN = /(?:^|[\s"'`(])(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+(?:\.[a-z0-9]+)?(?:$|[\s"'`),.;:])|\b[a-z0-9_.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|mdx?|css|scss|sql)\b/i;

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
