import { storage } from "../storage/index.js";
import type { ProjectRecord } from "../storage/types.js";
import {
  createGitHubIssue,
  fetchGitHubIssue,
  fetchGitHubIssues,
  GitHubApiError,
} from "./githubApiClient.js";
import { getGitHubAccessTokenForInternalUse } from "./githubAuthService.js";
import { getSavedGitHubRepositoryLink } from "./githubRepoLinkService.js";
import type {
  GitHubIssueReference,
  GitHubIssuesListResult,
} from "./githubTypes.js";

export type GitHubIssueStateFilter = "open" | "closed" | "all";

function normalizeLabels(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function normalizeIssueState(value: unknown): GitHubIssueStateFilter {
  return value === "closed" || value === "all" ? value : "open";
}

async function requireLinkedRepository(project: ProjectRecord) {
  const token = await getGitHubAccessTokenForInternalUse();

  if (!token) {
    throw new Error("Connect GitHub before reading repository issues.");
  }

  const repository = await getSavedGitHubRepositoryLink(project.id);

  if (!repository) {
    throw new Error(
      "Link this project to a GitHub repository before reading issues.",
    );
  }

  return { token, repository };
}

export async function listGitHubIssuesForProject(
  project: ProjectRecord,
  input: {
    state?: unknown;
    search?: unknown;
    labels?: string | string[] | null;
    perPage?: unknown;
  } = {},
): Promise<GitHubIssuesListResult> {
  const { token, repository } = await requireLinkedRepository(project);
  const state = normalizeIssueState(input.state);
  const search =
    typeof input.search === "string" ? input.search.trim().slice(0, 120) : "";
  const labels = normalizeLabels(input.labels);
  const perPage = Number(input.perPage);

  try {
    const issues = await fetchGitHubIssues({
      accessToken: token,
      owner: repository.owner,
      repo: repository.repo,
      state,
      labels,
      search,
      perPage: Number.isFinite(perPage) ? perPage : 30,
    });

    return {
      projectId: project.id,
      projectName: project.name,
      repository,
      issues,
      state,
      search,
      labels,
      total: issues.length,
      message: issues.length
        ? `Loaded ${issues.length} GitHub issue${issues.length === 1 ? "" : "s"} from ${repository.fullName}.`
        : `No matching GitHub issues found in ${repository.fullName}.`,
    };
  } catch (error) {
    if (error instanceof GitHubApiError) {
      throw new Error(error.message);
    }

    throw error;
  }
}

export async function getGitHubIssueForProject(
  project: ProjectRecord,
  issueNumber: number,
): Promise<{
  repository: NonNullable<
    Awaited<ReturnType<typeof getSavedGitHubRepositoryLink>>
  >;
  issue: GitHubIssueReference;
}> {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("Invalid GitHub issue number.");
  }

  const { token, repository } = await requireLinkedRepository(project);

  try {
    const issue = await fetchGitHubIssue({
      accessToken: token,
      owner: repository.owner,
      repo: repository.repo,
      issueNumber,
    });

    return { repository, issue };
  } catch (error) {
    if (error instanceof GitHubApiError) {
      throw new Error(error.message);
    }

    throw error;
  }
}

export async function getProjectOrThrow(projectId: number) {
  const project = await storage.getProjectById(projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}


export async function createGitHubIssueForProject(
  project: ProjectRecord,
  input: {
    title: string;
    body: string;
    labels?: string[];
  },
): Promise<{
  repository: NonNullable<
    Awaited<ReturnType<typeof getSavedGitHubRepositoryLink>>
  >;
  issue: GitHubIssueReference;
}> {
  const { token, repository } = await requireLinkedRepository(project);

  try {
    const issue = await createGitHubIssue({
      accessToken: token,
      owner: repository.owner,
      repo: repository.repo,
      title: input.title,
      body: input.body,
      labels: input.labels ?? [],
    });

    return { repository, issue };
  } catch (error) {
    if (error instanceof GitHubApiError) {
      throw new Error(error.message);
    }

    throw error;
  }
}
