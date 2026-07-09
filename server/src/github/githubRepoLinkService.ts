import { getGitStatus } from "../git/gitStatusService.js";
import { getOriginRemote, parseGitHubRemoteUrl } from "../git/gitRemoteService.js";
import { storage } from "../storage/index.js";
import type { ProjectRecord } from "../storage/types.js";
import { fetchGitHubRepository, GitHubApiError } from "./githubApiClient.js";
import { getGitHubAccessTokenForInternalUse } from "./githubAuthService.js";
import type {
  GitHubRepositoryLink,
  GitHubRepositoryLinkCandidate,
  GitHubRepositoryProfile
} from "./githubTypes.js";

const GITHUB_PROJECT_LINK_PREFIX = "github_project_link:";

function nowIso() {
  return new Date().toISOString();
}

function linkKey(projectId: number) {
  return `${GITHUB_PROJECT_LINK_PREFIX}${projectId}`;
}

function normalizeManualOwnerRepo(value: string) {
  return value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
}

function parseManualOwnerRepo(owner: string | null | undefined, repo: string | null | undefined) {
  const ownerValue = owner?.trim() ?? "";
  const repoValue = repo?.trim() ?? "";

  if (ownerValue.includes("/") && !repoValue) {
    const parts = normalizeManualOwnerRepo(ownerValue).split("/");
    return {
      owner: parts[0] ?? "",
      repo: parts[1] ?? ""
    };
  }

  return {
    owner: normalizeManualOwnerRepo(ownerValue),
    repo: normalizeManualOwnerRepo(repoValue)
  };
}

function isValidOwnerRepo(owner: string, repo: string) {
  return /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo);
}

function mapRepositoryToLink(input: {
  project: ProjectRecord;
  repository: GitHubRepositoryProfile;
  currentBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  source: "remote-origin" | "manual";
  linkedAt?: string;
}): GitHubRepositoryLink {
  const timestamp = nowIso();

  return {
    projectId: input.project.id,
    projectName: input.project.name,
    owner: input.repository.owner,
    repo: input.repository.repo,
    fullName: input.repository.fullName,
    htmlUrl: input.repository.htmlUrl,
    defaultBranch: input.repository.defaultBranch,
    currentBranch: input.currentBranch,
    remoteName: input.remoteName,
    remoteUrl: input.remoteUrl,
    private: input.repository.private,
    visibility: input.repository.visibility,
    description: input.repository.description,
    language: input.repository.language,
    fork: input.repository.fork,
    pushedAt: input.repository.pushedAt,
    updatedAt: input.repository.updatedAt,
    linkedAt: input.linkedAt ?? timestamp,
    lastCheckedAt: timestamp,
    source: input.source
  };
}

function isLinkRecord(value: unknown): value is GitHubRepositoryLink {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GitHubRepositoryLink>;
  return (
    typeof candidate.projectId === "number" &&
    typeof candidate.projectName === "string" &&
    typeof candidate.owner === "string" &&
    typeof candidate.repo === "string" &&
    typeof candidate.fullName === "string" &&
    typeof candidate.htmlUrl === "string" &&
    typeof candidate.linkedAt === "string" &&
    typeof candidate.lastCheckedAt === "string"
  );
}

export async function getSavedGitHubRepositoryLink(projectId: number) {
  const saved = await storage.getSettingValue<unknown>(linkKey(projectId), null);
  return isLinkRecord(saved) ? saved : null;
}

export async function clearGitHubRepositoryLink(projectId: number) {
  await storage.setSettingValue(linkKey(projectId), null);
}

export async function buildGitHubRepositoryLinkCandidate(
  project: ProjectRecord
): Promise<GitHubRepositoryLinkCandidate> {
  const warnings: string[] = [];
  const [token, linked, gitStatus, originResult] = await Promise.all([
    getGitHubAccessTokenForInternalUse(),
    getSavedGitHubRepositoryLink(project.id),
    getGitStatus(project.localPath),
    getOriginRemote(project.localPath)
  ]);

  warnings.push(...gitStatus.warnings, ...originResult.warnings);

  const remote = originResult.remote;
  const parsedRemote = remote ? parseGitHubRemoteUrl(remote.fetchUrl ?? remote.url) : null;

  if (remote && !parsedRemote) {
    warnings.push("Origin remote exists, but it is not a GitHub repository URL.");
  }

  const connected = Boolean(token);
  const isGitRepo = gitStatus.isGitRepo;
  const canLink = Boolean(connected && isGitRepo && parsedRemote);

  let message = "Select a local Git project to detect its GitHub origin remote.";

  if (!connected) {
    message = "Connect a GitHub account before linking repositories.";
  } else if (!isGitRepo) {
    message = "This project is not inside a Git repository yet.";
  } else if (!remote) {
    message = "No Git remote was found for this project.";
  } else if (!parsedRemote) {
    message = "The local Git remote does not point to github.com.";
  } else if (linked) {
    message = `Linked to ${linked.fullName}.`;
  } else {
    message = `Detected ${parsedRemote.fullName}. Ready to link.`;
  }

  return {
    projectId: project.id,
    projectName: project.name,
    projectPath: project.localPath,
    connected,
    isGitRepo,
    currentBranch: gitStatus.branch,
    remoteName: remote?.name ?? null,
    remoteUrl: remote?.fetchUrl ?? remote?.url ?? null,
    detectedOwner: parsedRemote?.owner ?? null,
    detectedRepo: parsedRemote?.repo ?? null,
    detectedFullName: parsedRemote?.fullName ?? null,
    detectedHtmlUrl: parsedRemote?.htmlUrl ?? null,
    linked,
    canLink,
    message,
    warnings: Array.from(new Set(warnings)).filter(Boolean)
  };
}

export async function saveGitHubRepositoryLink(
  project: ProjectRecord,
  input: {
    owner?: string | null;
    repo?: string | null;
    source?: "remote-origin" | "manual";
  } = {}
) {
  const token = await getGitHubAccessTokenForInternalUse();

  if (!token) {
    throw new Error("Connect GitHub before linking a repository.");
  }

  const gitStatus = await getGitStatus(project.localPath);
  const originResult = await getOriginRemote(project.localPath);
  const remote = originResult.remote;
  const parsedRemote = remote ? parseGitHubRemoteUrl(remote.fetchUrl ?? remote.url) : null;
  const source = input.source ?? (input.owner || input.repo ? "manual" : "remote-origin");
  const manual = parseManualOwnerRepo(input.owner, input.repo);
  const owner = source === "manual" ? manual.owner : parsedRemote?.owner ?? "";
  const repo = source === "manual" ? manual.repo : parsedRemote?.repo ?? "";

  if (!isValidOwnerRepo(owner, repo)) {
    throw new Error("Could not determine a valid GitHub owner/repository pair for this project.");
  }

  const existing = await getSavedGitHubRepositoryLink(project.id);
  const repository = await fetchGitHubRepository(token, owner, repo);
  const link = mapRepositoryToLink({
    project,
    repository,
    currentBranch: gitStatus.branch,
    remoteName: remote?.name ?? null,
    remoteUrl: remote?.fetchUrl ?? remote?.url ?? null,
    source,
    linkedAt: existing?.linkedAt
  });

  await storage.setSettingValue(linkKey(project.id), link);
  return link;
}

export async function refreshGitHubRepositoryLink(project: ProjectRecord) {
  const existing = await getSavedGitHubRepositoryLink(project.id);

  if (!existing) {
    return null;
  }

  const token = await getGitHubAccessTokenForInternalUse();

  if (!token) {
    throw new Error("Connect GitHub before refreshing repository metadata.");
  }

  try {
    const gitStatus = await getGitStatus(project.localPath);
    const repository = await fetchGitHubRepository(token, existing.owner, existing.repo);
    const link = mapRepositoryToLink({
      project,
      repository,
      currentBranch: gitStatus.branch,
      remoteName: existing.remoteName,
      remoteUrl: existing.remoteUrl,
      source: existing.source,
      linkedAt: existing.linkedAt
    });

    await storage.setSettingValue(linkKey(project.id), link);
    return link;
  } catch (error) {
    if (error instanceof GitHubApiError) {
      throw new Error(error.message);
    }

    throw error;
  }
}
