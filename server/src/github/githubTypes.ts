export interface GitHubUserProfile {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
}

export interface GitHubIntegrationStatus {
  configured: boolean;
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastCheckedAt: string | null;
  message: string;
}

export interface GitHubDeviceAuthStartResult {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  expiresAt: string;
}

export type GitHubAuthPollResult =
  | {
      state: "pending";
      interval: number;
      message: string;
    }
  | {
      state: "slow_down";
      interval: number;
      message: string;
    }
  | {
      state: "connected";
      status: GitHubIntegrationStatus;
      message: string;
    }
  | {
      state: "expired" | "denied" | "failed";
      message: string;
      code?: string;
    };

export interface GitHubRepositoryProfile {
  id: number | null;
  nodeId: string | null;
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string | null;
  private: boolean;
  visibility: string;
  description: string | null;
  fork: boolean;
  language: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  ownerAvatarUrl: string | null;
  ownerHtmlUrl: string | null;
}

export interface GitHubRepositoryLink {
  projectId: number;
  projectName: string;
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string | null;
  currentBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  private: boolean;
  visibility: string;
  description: string | null;
  language: string | null;
  fork: boolean;
  pushedAt: string | null;
  updatedAt: string | null;
  linkedAt: string;
  lastCheckedAt: string;
  source: "remote-origin" | "manual";
}

export interface GitHubRepositoryLinkCandidate {
  projectId: number;
  projectName: string;
  projectPath: string;
  connected: boolean;
  isGitRepo: boolean;
  currentBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  detectedOwner: string | null;
  detectedRepo: string | null;
  detectedFullName: string | null;
  detectedHtmlUrl: string | null;
  linked: GitHubRepositoryLink | null;
  canLink: boolean;
  message: string;
  warnings: string[];
}

export interface GitHubIssueLabel {
  id: number | null;
  name: string;
  color: string | null;
  description: string | null;
}

export interface GitHubIssueUser {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
}

export interface GitHubIssueReference {
  id: number;
  nodeId: string | null;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  htmlUrl: string;
  apiUrl: string | null;
  labels: GitHubIssueLabel[];
  author: GitHubIssueUser | null;
  assignees: GitHubIssueUser[];
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  locked: boolean;
}

export interface GitHubIssuesListResult {
  projectId: number;
  projectName: string;
  repository: GitHubRepositoryLink;
  issues: GitHubIssueReference[];
  state: "open" | "closed" | "all";
  search: string;
  labels: string[];
  total: number;
  message: string;
}

export interface GitHubIssueTaskPackSource {
  type: "github-issue";
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueState: "open" | "closed";
  labels: string[];
  authorLogin: string | null;
  repositoryUrl: string;
  linkedAt: string;
}

export interface GitHubCreatedIssueLink {
  type: "github-created-issue";
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueState: "open" | "closed";
  labels: string[];
  repositoryUrl: string;
  createdAt: string;
  createdFromTaskPackId: number;
}
