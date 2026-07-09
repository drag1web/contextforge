import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 5000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 512 * 1024;

export interface GitRemoteInfo {
  name: string;
  url: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface GitHubRemoteReference {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  remoteUrl: string;
}

async function runGit(projectRoot: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
      windowsHide: true
    });

    return {
      ok: true,
      stdout,
      stderr,
      errorMessage: null as string | null
    };
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string };

    return {
      ok: false,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      errorMessage: maybeError.message
    };
  }
}

function cleanRemoteUrl(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function stripGitSuffix(repo: string) {
  return repo.replace(/\.git$/i, "").replace(/\/+$/, "");
}

function normalizeOwnerRepo(owner: string, repo: string, remoteUrl: string): GitHubRemoteReference | null {
  const normalizedOwner = owner.trim();
  const normalizedRepo = stripGitSuffix(repo.trim());

  if (!/^[A-Za-z0-9_.-]+$/.test(normalizedOwner) || !/^[A-Za-z0-9_.-]+$/.test(normalizedRepo)) {
    return null;
  }

  return {
    owner: normalizedOwner,
    repo: normalizedRepo,
    fullName: `${normalizedOwner}/${normalizedRepo}`,
    htmlUrl: `https://github.com/${normalizedOwner}/${normalizedRepo}`,
    remoteUrl
  };
}

export function parseGitHubRemoteUrl(remoteUrl: string): GitHubRemoteReference | null {
  const cleaned = cleanRemoteUrl(remoteUrl);

  if (!cleaned) {
    return null;
  }

  const httpsMatch = cleaned.match(/^https?:\/\/github\.com\/([^\s\/]+)\/([^\s\/?#]+?)(?:\.git)?(?:[\/?#].*)?$/i);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return normalizeOwnerRepo(httpsMatch[1], httpsMatch[2], cleaned);
  }

  const sshShortMatch = cleaned.match(/^git@github\.com:([^\s\/]+)\/([^\s]+?)(?:\.git)?$/i);
  if (sshShortMatch?.[1] && sshShortMatch[2]) {
    return normalizeOwnerRepo(sshShortMatch[1], sshShortMatch[2], cleaned);
  }

  const sshUrlMatch = cleaned.match(/^ssh:\/\/git@github\.com\/([^\s\/]+)\/([^\s\/?#]+?)(?:\.git)?(?:[\/?#].*)?$/i);
  if (sshUrlMatch?.[1] && sshUrlMatch[2]) {
    return normalizeOwnerRepo(sshUrlMatch[1], sshUrlMatch[2], cleaned);
  }

  return null;
}

export async function getGitRemotes(projectRoot: string): Promise<{ remotes: GitRemoteInfo[]; warnings: string[] }> {
  const result = await runGit(projectRoot, ["remote", "-v"]);

  if (!result.ok) {
    return {
      remotes: [],
      warnings: [
        result.errorMessage?.toLowerCase().includes("enoent")
          ? "Git command is not available on this machine."
          : "Could not read Git remotes for this project."
      ]
    };
  }

  const byName = new Map<string, GitRemoteInfo>();

  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }

    const name = match[1];
    const url = cleanRemoteUrl(match[2]);
    const kind = match[3];
    const current = byName.get(name) ?? {
      name,
      url,
      fetchUrl: null,
      pushUrl: null
    };

    if (kind === "fetch") {
      current.fetchUrl = url;
      current.url = url;
    }

    if (kind === "push") {
      current.pushUrl = url;
    }

    byName.set(name, current);
  }

  return {
    remotes: Array.from(byName.values()),
    warnings: []
  };
}

export async function getOriginRemote(projectRoot: string) {
  const { remotes, warnings } = await getGitRemotes(projectRoot);
  const origin = remotes.find((remote) => remote.name === "origin") ?? remotes[0] ?? null;

  return {
    remote: origin,
    warnings
  };
}

export interface GitRemoteSetupResult {
  initialized: boolean;
  remoteChanged: boolean;
  remoteName: string;
  remoteUrl: string | null;
  warnings: string[];
}

function isValidGitHubOwnerRepoPart(value: string) {
  return /^[A-Za-z0-9_.-]+$/.test(value.trim());
}

export function buildGitHubHttpsRemoteUrl(owner: string, repo: string) {
  const normalizedOwner = owner.trim();
  const normalizedRepo = stripGitSuffix(repo.trim());

  if (!isValidGitHubOwnerRepoPart(normalizedOwner) || !isValidGitHubOwnerRepoPart(normalizedRepo)) {
    throw new Error("GitHub owner and repository can only contain letters, numbers, dots, underscores and hyphens.");
  }

  return `https://github.com/${normalizedOwner}/${normalizedRepo}.git`;
}

export async function initializeGitRepository(projectRoot: string): Promise<GitRemoteSetupResult> {
  const warnings: string[] = [];
  const insideWorkTree = await runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"]);

  if (insideWorkTree.ok && insideWorkTree.stdout.trim() === "true") {
    const originResult = await getOriginRemote(projectRoot);
    warnings.push("Project is already inside a Git repository.", ...originResult.warnings);

    return {
      initialized: false,
      remoteChanged: false,
      remoteName: originResult.remote?.name ?? "origin",
      remoteUrl: originResult.remote?.fetchUrl ?? originResult.remote?.url ?? null,
      warnings: Array.from(new Set(warnings)).filter(Boolean)
    };
  }

  const initResult = await runGit(projectRoot, ["init"]);

  if (!initResult.ok) {
    throw new Error(initResult.stderr.trim() || initResult.errorMessage || "Could not initialize Git repository.");
  }

  return {
    initialized: true,
    remoteChanged: false,
    remoteName: "origin",
    remoteUrl: null,
    warnings
  };
}

export async function setGitHubOriginRemote(
  projectRoot: string,
  input: {
    owner: string;
    repo: string;
    overwrite?: boolean;
    initIfMissing?: boolean;
  }
): Promise<GitRemoteSetupResult> {
  const warnings: string[] = [];
  let initialized = false;
  const remoteUrl = buildGitHubHttpsRemoteUrl(input.owner, input.repo);

  const insideWorkTree = await runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"]);

  if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== "true") {
    if (!input.initIfMissing) {
      throw new Error("Project is not inside a Git repository. Initialize Git first or enable initIfMissing.");
    }

    const initResult = await initializeGitRepository(projectRoot);
    initialized = initResult.initialized;
    warnings.push(...initResult.warnings);
  }

  const originResult = await getOriginRemote(projectRoot);
  warnings.push(...originResult.warnings);

  if (originResult.remote) {
    const currentRemoteUrl = originResult.remote.fetchUrl ?? originResult.remote.url;

    if (currentRemoteUrl === remoteUrl) {
      return {
        initialized,
        remoteChanged: false,
        remoteName: originResult.remote.name,
        remoteUrl,
        warnings: Array.from(new Set(warnings)).filter(Boolean)
      };
    }

    if (!input.overwrite) {
      throw new Error(
        `Origin remote already exists (${currentRemoteUrl}). Enable overwrite to replace it with ${remoteUrl}.`
      );
    }

    const setResult = await runGit(projectRoot, ["remote", "set-url", originResult.remote.name, remoteUrl]);

    if (!setResult.ok) {
      throw new Error(setResult.stderr.trim() || setResult.errorMessage || "Could not update Git origin remote.");
    }

    return {
      initialized,
      remoteChanged: true,
      remoteName: originResult.remote.name,
      remoteUrl,
      warnings: Array.from(new Set(warnings)).filter(Boolean)
    };
  }

  const addResult = await runGit(projectRoot, ["remote", "add", "origin", remoteUrl]);

  if (!addResult.ok) {
    throw new Error(addResult.stderr.trim() || addResult.errorMessage || "Could not add GitHub origin remote.");
  }

  return {
    initialized,
    remoteChanged: true,
    remoteName: "origin",
    remoteUrl,
    warnings: Array.from(new Set(warnings)).filter(Boolean)
  };
}
