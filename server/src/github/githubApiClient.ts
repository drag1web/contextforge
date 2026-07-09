import { config } from "../config/index.js";
import type {
  GitHubIssueReference,
  GitHubIssueUser,
  GitHubRepositoryProfile,
  GitHubUserProfile,
} from "./githubTypes.js";

interface GitHubUserResponse {
  login?: unknown;
  avatar_url?: unknown;
  html_url?: unknown;
}

interface GitHubRepositoryResponse {
  id?: unknown;
  node_id?: unknown;
  name?: unknown;
  full_name?: unknown;
  owner?: {
    login?: unknown;
    avatar_url?: unknown;
    html_url?: unknown;
  };
  private?: unknown;
  html_url?: unknown;
  description?: unknown;
  fork?: unknown;
  default_branch?: unknown;
  visibility?: unknown;
  language?: unknown;
  pushed_at?: unknown;
  updated_at?: unknown;
}

type GitHubIssueState = "open" | "closed" | "all";

interface GitHubIssueLabelResponse {
  id?: unknown;
  name?: unknown;
  color?: unknown;
  description?: unknown;
}

interface GitHubIssueUserResponse {
  login?: unknown;
  avatar_url?: unknown;
  html_url?: unknown;
}

interface GitHubIssueResponse {
  id?: unknown;
  node_id?: unknown;
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  html_url?: unknown;
  url?: unknown;
  labels?: unknown;
  user?: GitHubIssueUserResponse | null;
  assignees?: unknown;
  comments?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  closed_at?: unknown;
  locked?: unknown;
  pull_request?: unknown;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function normalizeApiBaseUrl() {
  return config.githubApiBaseUrl.replace(/\/+$/, "");
}

function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": config.githubApiVersion,
    "User-Agent": "ContextForge",
  };
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function fetchGitHubUser(
  accessToken: string,
): Promise<GitHubUserProfile> {
  const response = await fetch(`${normalizeApiBaseUrl()}/user`, {
    headers: githubHeaders(accessToken),
  });

  if (!response.ok) {
    throw new GitHubApiError("GitHub account check failed", response.status);
  }

  const data = (await response.json()) as GitHubUserResponse;

  if (typeof data.login !== "string" || !data.login.trim()) {
    throw new GitHubApiError(
      "GitHub account response did not include a login",
      response.status,
    );
  }

  return {
    login: data.login,
    avatarUrl: typeof data.avatar_url === "string" ? data.avatar_url : null,
    htmlUrl: typeof data.html_url === "string" ? data.html_url : null,
  };
}

export async function fetchGitHubRepository(
  accessToken: string,
  owner: string,
  repo: string,
): Promise<GitHubRepositoryProfile> {
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);
  const response = await fetch(
    `${normalizeApiBaseUrl()}/repos/${encodedOwner}/${encodedRepo}`,
    {
      headers: githubHeaders(accessToken),
    },
  );

  if (!response.ok) {
    const statusLabel =
      response.status === 404
        ? "GitHub repository was not found or the connected account cannot access it."
        : "GitHub repository check failed.";
    throw new GitHubApiError(statusLabel, response.status);
  }

  const data = (await response.json()) as GitHubRepositoryResponse;

  if (
    typeof data.full_name !== "string" ||
    !data.full_name.includes("/") ||
    typeof data.name !== "string" ||
    !data.name.trim()
  ) {
    throw new GitHubApiError(
      "GitHub repository response is incomplete.",
      response.status,
    );
  }

  const ownerLogin = normalizeNullableString(data.owner?.login) ?? owner;

  return {
    id: typeof data.id === "number" ? data.id : null,
    nodeId: normalizeNullableString(data.node_id),
    owner: ownerLogin,
    repo: data.name,
    fullName: data.full_name,
    htmlUrl:
      normalizeNullableString(data.html_url) ??
      `https://github.com/${data.full_name}`,
    defaultBranch: normalizeNullableString(data.default_branch),
    private: Boolean(data.private),
    visibility:
      normalizeNullableString(data.visibility) ??
      (data.private ? "private" : "public"),
    description: normalizeNullableString(data.description),
    fork: Boolean(data.fork),
    language: normalizeNullableString(data.language),
    pushedAt: normalizeNullableString(data.pushed_at),
    updatedAt: normalizeNullableString(data.updated_at),
    ownerAvatarUrl: normalizeNullableString(data.owner?.avatar_url),
    ownerHtmlUrl: normalizeNullableString(data.owner?.html_url),
  };
}

function mapGitHubIssueUser(
  value: GitHubIssueUserResponse | null | undefined,
): GitHubIssueUser | null {
  if (!value || typeof value.login !== "string" || !value.login.trim()) {
    return null;
  }

  return {
    login: value.login,
    avatarUrl: normalizeNullableString(value.avatar_url),
    htmlUrl: normalizeNullableString(value.html_url),
  };
}

function mapGitHubIssue(
  data: GitHubIssueResponse,
): GitHubIssueReference | null {
  if (
    typeof data.id !== "number" ||
    typeof data.number !== "number" ||
    typeof data.title !== "string" ||
    typeof data.html_url !== "string" ||
    typeof data.created_at !== "string" ||
    typeof data.updated_at !== "string"
  ) {
    return null;
  }

  const state = data.state === "closed" ? "closed" : "open";
  const labels = Array.isArray(data.labels)
    ? data.labels
        .map((label) => {
          if (!label || typeof label !== "object") {
            return null;
          }

          const item = label as GitHubIssueLabelResponse;
          const name = normalizeNullableString(item.name);

          if (!name) {
            return null;
          }

          return {
            id: typeof item.id === "number" ? item.id : null,
            name,
            color: normalizeNullableString(item.color),
            description: normalizeNullableString(item.description),
          };
        })
        .filter((label): label is NonNullable<typeof label> => Boolean(label))
    : [];

  const assignees = Array.isArray(data.assignees)
    ? data.assignees
        .map((assignee) =>
          mapGitHubIssueUser(assignee as GitHubIssueUserResponse),
        )
        .filter((user): user is GitHubIssueUser => Boolean(user))
    : [];

  return {
    id: data.id,
    nodeId: normalizeNullableString(data.node_id),
    number: data.number,
    title: data.title,
    body: normalizeNullableString(data.body),
    state,
    htmlUrl: data.html_url,
    apiUrl: normalizeNullableString(data.url),
    labels,
    author: mapGitHubIssueUser(data.user),
    assignees,
    commentsCount: typeof data.comments === "number" ? data.comments : 0,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    closedAt: normalizeNullableString(data.closed_at),
    locked: Boolean(data.locked),
  };
}

export async function fetchGitHubIssues(input: {
  accessToken: string;
  owner: string;
  repo: string;
  state?: GitHubIssueState;
  labels?: string[];
  search?: string;
  perPage?: number;
}): Promise<GitHubIssueReference[]> {
  const encodedOwner = encodeURIComponent(input.owner);
  const encodedRepo = encodeURIComponent(input.repo);
  const searchParams = new URLSearchParams();

  searchParams.set("state", input.state ?? "open");
  searchParams.set(
    "per_page",
    String(Math.max(1, Math.min(input.perPage ?? 30, 50))),
  );
  searchParams.set("sort", "updated");
  searchParams.set("direction", "desc");

  if (input.labels?.length) {
    searchParams.set("labels", input.labels.join(","));
  }

  const response = await fetch(
    `${normalizeApiBaseUrl()}/repos/${encodedOwner}/${encodedRepo}/issues?${searchParams.toString()}`,
    {
      headers: githubHeaders(input.accessToken),
    },
  );

  if (!response.ok) {
    const statusLabel =
      response.status === 404
        ? "GitHub issues were not found or the connected account cannot access this repository."
        : "GitHub issues check failed.";
    throw new GitHubApiError(statusLabel, response.status);
  }

  const data = (await response.json()) as GitHubIssueResponse[];
  const normalizedSearch = (input.search ?? "").trim().toLowerCase();

  return data
    .filter((issue) => !issue.pull_request)
    .map(mapGitHubIssue)
    .filter((issue): issue is GitHubIssueReference => Boolean(issue))
    .filter((issue) => {
      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        `#${issue.number}`,
        issue.title,
        issue.body ?? "",
        issue.labels.map((label) => label.name).join(" "),
        issue.author?.login ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
}

export async function fetchGitHubIssue(input: {
  accessToken: string;
  owner: string;
  repo: string;
  issueNumber: number;
}): Promise<GitHubIssueReference> {
  const encodedOwner = encodeURIComponent(input.owner);
  const encodedRepo = encodeURIComponent(input.repo);
  const response = await fetch(
    `${normalizeApiBaseUrl()}/repos/${encodedOwner}/${encodedRepo}/issues/${input.issueNumber}`,
    {
      headers: githubHeaders(input.accessToken),
    },
  );

  if (!response.ok) {
    const statusLabel =
      response.status === 404
        ? "GitHub issue was not found or the connected account cannot access it."
        : "GitHub issue check failed.";
    throw new GitHubApiError(statusLabel, response.status);
  }

  const issue = mapGitHubIssue((await response.json()) as GitHubIssueResponse);

  if (!issue) {
    throw new GitHubApiError(
      "GitHub issue response is incomplete.",
      response.status,
    );
  }

  return issue;
}


export async function createGitHubIssue(input: {
  accessToken: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}): Promise<GitHubIssueReference> {
  const encodedOwner = encodeURIComponent(input.owner);
  const encodedRepo = encodeURIComponent(input.repo);
  const response = await fetch(
    `${normalizeApiBaseUrl()}/repos/${encodedOwner}/${encodedRepo}/issues`,
    {
      method: "POST",
      headers: githubHeaders(input.accessToken),
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        labels: input.labels ?? [],
      }),
    },
  );

  if (!response.ok) {
    let details = "";

    try {
      const data = (await response.json()) as { message?: unknown };
      details = typeof data.message === "string" ? ` ${data.message}` : "";
    } catch {
      details = "";
    }

    const statusLabel =
      response.status === 404
        ? "GitHub repository was not found or the connected account cannot create issues there."
        : response.status === 403
          ? "GitHub refused issue creation. Check repository access and OAuth scopes."
          : "GitHub issue creation failed.";
    throw new GitHubApiError(`${statusLabel}${details}`, response.status);
  }

  const issue = mapGitHubIssue((await response.json()) as GitHubIssueResponse);

  if (!issue) {
    throw new GitHubApiError(
      "GitHub create issue response is incomplete.",
      response.status,
    );
  }

  return issue;
}
