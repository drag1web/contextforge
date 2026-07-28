import path from "node:path";

function isRepositoryRelativePosixPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== "..",
    );
}

export function normalizeLegacyInventoryPath(
  legacyPath: string,
  repositoryRoot: string,
): string | null {
  if (/\p{Cc}/u.test(legacyPath)) {
    return null;
  }

  let relativePath = legacyPath;
  const usesWindowsAbsolutePath = path.win32.isAbsolute(legacyPath);
  const usesPosixAbsolutePath = path.posix.isAbsolute(legacyPath);
  if (usesWindowsAbsolutePath || usesPosixAbsolutePath) {
    const pathApi =
      usesWindowsAbsolutePath &&
      (/^[a-zA-Z]:[\\/]/.test(legacyPath) || legacyPath.startsWith("\\\\"))
        ? path.win32
        : path.posix;
    if (!pathApi.isAbsolute(repositoryRoot)) {
      return null;
    }
    relativePath = pathApi.relative(
      pathApi.resolve(repositoryRoot),
      pathApi.resolve(legacyPath),
    );
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relativePath)
    ) {
      return null;
    }
  }

  const normalizedPath = relativePath.replaceAll("\\", "/");
  return isRepositoryRelativePosixPath(normalizedPath)
    ? normalizedPath
    : null;
}
