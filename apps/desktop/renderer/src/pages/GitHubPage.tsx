import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Github,
  KeyRound,
  Link2,
  ListChecks,
  MessageSquareText,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  createTaskPack,
  getGitHubIntegrationStatus,
  getProjectGitHubIssues,
  getProjectGitHubRepositoryLink,
  getProjects,
  initializeProjectGitRepository,
  linkProjectGitHubRepository,
  pollGitHubDeviceAuth,
  setProjectGitHubOriginRemote,
  signOutGitHub,
  startGitHubDeviceAuth,
  unlinkProjectGitHubRepository,
} from "../api/client";
import { Button } from "../components/ui/Button";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";
import type {
  GitHubDeviceAuthStart,
  GitHubIntegrationStatus,
  GitHubIssueReference,
  GitHubIssuesListResult,
  GitHubIssueTaskPackSource,
  GitHubRepositoryLinkCandidate,
  Project,
  TaskPack,
} from "../types";

function slugifyRepositoryName(value: string | null | undefined) {
  const fallback = "repository";
  const normalized = (value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  return normalized || fallback;
}

function buildRemoteCommands(input: {
  projectPath: string | null;
  owner: string;
  repo: string;
  hasRemote: boolean;
  isGitRepo: boolean;
}) {
  const projectPath = input.projectPath?.trim();
  const owner = input.owner.trim();
  const repo = input.repo.trim();

  if (!projectPath || !owner || !repo) {
    return "";
  }

  const quotedPath = projectPath.includes('"')
    ? projectPath
    : `"${projectPath}"`;
  const remoteUrl = `https://github.com/${owner}/${repo}.git`;
  const lines = [`cd ${quotedPath}`];

  if (!input.isGitRepo) {
    lines.push("git init");
  }

  lines.push(
    input.hasRemote
      ? `git remote set-url origin ${remoteUrl}`
      : `git remote add origin ${remoteUrl}`,
  );

  return lines.join("\n");
}

function inferTaskTypeFromIssue(issue: GitHubIssueReference) {
  const searchable = [
    issue.title,
    issue.body ?? "",
    issue.labels.map((label) => label.name).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (/bug|fix|error|crash|broken|ошиб|баг|фикс/.test(searchable)) {
    return "bugfix";
  }

  if (
    /ui|ux|design|layout|style|css|front|visual|дизайн|интерфейс/.test(
      searchable,
    )
  ) {
    return "ui";
  }

  if (/api|backend|server|database|db|auth|route|endpoint/.test(searchable)) {
    return "backend";
  }

  if (/test|coverage|spec|unit|e2e/.test(searchable)) {
    return "tests";
  }

  if (/docs|readme|documentation|doc/.test(searchable)) {
    return "docs";
  }

  return "general";
}

function buildIssueTaskText(input: {
  issue: GitHubIssueReference;
  repositoryFullName: string;
  repositoryUrl: string;
}) {
  const labels =
    input.issue.labels.map((label) => label.name).join(", ") || "none";
  const assignees =
    input.issue.assignees.map((assignee) => assignee.login).join(", ") ||
    "none";
  const body = input.issue.body?.trim() || "No issue body provided.";

  return `Implement GitHub issue #${input.issue.number}: ${input.issue.title}

Source:
- Repository: ${input.repositoryFullName}
- Issue: #${input.issue.number}
- Issue URL: ${input.issue.htmlUrl}
- State: ${input.issue.state}
- Author: ${input.issue.author?.login ?? "unknown"}
- Labels: ${labels}
- Assignees: ${assignees}

Issue body:
${body}

ContextForge instructions:
- Use this GitHub issue as the task source.
- Keep project source local; do not assume GitHub has the full working tree context.
- Select only files that are relevant to the issue.
- Preserve existing behavior unless the issue explicitly asks for a behavior change.
- Add/describe verification steps that prove the issue is solved.`;
}

function buildIssueSource(input: {
  issue: GitHubIssueReference;
  repositoryFullName: string;
  repositoryUrl: string;
}): GitHubIssueTaskPackSource {
  const [owner = "", repo = ""] = input.repositoryFullName.split("/");

  return {
    type: "github-issue",
    owner,
    repo,
    fullName: input.repositoryFullName,
    issueNumber: input.issue.number,
    issueTitle: input.issue.title,
    issueUrl: input.issue.htmlUrl,
    issueState: input.issue.state,
    labels: input.issue.labels.map((label) => label.name),
    authorLogin: input.issue.author?.login ?? null,
    repositoryUrl: input.repositoryUrl,
    linkedAt: new Date().toISOString(),
  };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not checked yet";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function GitHubStateBadge({
  configured,
  connected,
  pairing,
}: {
  configured: boolean;
  connected: boolean;
  pairing: boolean;
}) {
  const label = !configured
    ? "Setup required"
    : connected
      ? "Connected"
      : pairing
        ? "Pairing"
        : "Ready";

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        connected
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : pairing
            ? "border-sky-400/25 bg-sky-400/10 text-sky-200"
            : configured
              ? "border-white/10 bg-white/[0.055] text-neutral-300"
              : "border-amber-400/25 bg-amber-400/10 text-amber-200",
      ].join(" ")}
    >
      {connected ? (
        <CheckCircle2 size={13} />
      ) : pairing ? (
        <Clock3 size={13} />
      ) : configured ? (
        <Github size={13} />
      ) : (
        <AlertTriangle size={13} />
      )}
      {label}
    </span>
  );
}

function SmallMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-medium text-neutral-200">
        {value}
      </p>
    </div>
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded-full bg-white/[0.075] ${className}`}
    />
  );
}

function GitHubWorkspaceSkeleton() {
  return (
    <section className="space-y-5 p-6">
      <article className="cf-card relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(52,211,153,0.12),transparent_34%)]" />
        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
          <div>
            <div className="mb-5 flex gap-2">
              <SkeletonLine className="h-7 w-24" />
              <SkeletonLine className="h-7 w-28" />
              <SkeletonLine className="h-7 w-32" />
            </div>
            <SkeletonLine className="h-10 w-[min(540px,80%)]" />
            <SkeletonLine className="mt-3 h-10 w-[min(420px,62%)]" />
            <SkeletonLine className="mt-5 h-4 w-[min(620px,92%)]" />
            <SkeletonLine className="mt-2 h-4 w-[min(480px,74%)]" />
            <div className="mt-6 flex gap-2">
              <SkeletonLine className="h-11 w-36 rounded-2xl" />
              <SkeletonLine className="h-11 w-36 rounded-2xl" />
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-black/45 p-5">
            <div className="flex items-center gap-4">
              <SkeletonLine className="size-14 rounded-2xl" />
              <div className="flex-1">
                <SkeletonLine className="h-5 w-40" />
                <SkeletonLine className="mt-3 h-3 w-56" />
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SkeletonLine className="h-20 rounded-2xl" />
              <SkeletonLine className="h-20 rounded-2xl" />
            </div>
          </div>
        </div>
      </article>

      <article className="cf-card p-5">
        <SkeletonLine className="h-6 w-48" />
        <SkeletonLine className="mt-4 h-8 w-[min(520px,82%)]" />
        <SkeletonLine className="mt-3 h-4 w-[min(680px,90%)]" />
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <SkeletonLine className="h-52 rounded-[1.35rem]" />
          <SkeletonLine className="h-52 rounded-[1.35rem]" />
        </div>
      </article>
    </section>
  );
}

interface GitHubPageProps {
  onTaskPackCreated?: (taskPack: TaskPack) => void;
}

export function GitHubPage({ onTaskPackCreated }: GitHubPageProps) {
  const [status, setStatus] = useState<GitHubIntegrationStatus | null>(null);
  const [pairing, setPairing] = useState<GitHubDeviceAuthStart | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [repoCandidate, setRepoCandidate] =
    useState<GitHubRepositoryLinkCandidate | null>(null);
  const [manualOwner, setManualOwner] = useState("");
  const [manualRepo, setManualRepo] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [repoMessage, setRepoMessage] = useState<string | null>(null);
  const [issueState, setIssueState] = useState<"open" | "closed" | "all">(
    "open",
  );
  const [issueSearch, setIssueSearch] = useState("");
  const [issueLabels, setIssueLabels] = useState("");
  const [issuesResult, setIssuesResult] =
    useState<GitHubIssuesListResult | null>(null);
  const [selectedIssue, setSelectedIssue] =
    useState<GitHubIssueReference | null>(null);
  const [issueMessage, setIssueMessage] = useState<string | null>(null);
  const [createdIssueTaskPack, setCreatedIssueTaskPack] =
    useState<TaskPack | null>(null);
  const [action, setAction] = useState<
    | "refresh"
    | "connect"
    | "poll"
    | "sign-out"
    | "projects"
    | "detect"
    | "git-init"
    | "set-remote"
    | "link"
    | "manual-link"
    | "unlink"
    | "issues"
    | "issue-task-pack"
    | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);

  const configured = Boolean(status?.configured);
  const connected = Boolean(status?.connected);
  const isPairing = Boolean(pairing) && !connected;
  const expiresAtLabel = pairing ? formatDateTime(pairing.expiresAt) : null;
  const scopesLabel = status?.scopes.length
    ? status.scopes.join(", ")
    : "No scopes reported yet";
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const linkedRepository = repoCandidate?.linked ?? null;
  const projectOptions = useMemo<Array<SelectOption<string>>>(() => {
    if (projects.length === 0) {
      return [
        {
          value: "",
          label: "No projects yet",
          description: "Add a local project before repository linking.",
          icon: <GitBranch size={15} />,
          disabled: true,
        },
      ];
    }

    return projects.map((project) => ({
      value: String(project.id),
      label: project.name,
      description: project.localPath,
      icon: <GitBranch size={15} />,
    }));
  }, [projects]);
  const suggestedOwner =
    manualOwner.trim() || repoCandidate?.detectedOwner || status?.login || "";
  const suggestedRepo =
    manualRepo.trim() ||
    repoCandidate?.detectedRepo ||
    slugifyRepositoryName(selectedProject?.name);
  const hasAnyRemote = Boolean(repoCandidate?.remoteUrl);
  const canSetupRemote = Boolean(
    selectedProjectId && suggestedOwner && suggestedRepo,
  );
  const remoteCommands = buildRemoteCommands({
    projectPath:
      repoCandidate?.projectPath ?? selectedProject?.localPath ?? null,
    owner: suggestedOwner,
    repo: suggestedRepo,
    hasRemote: hasAnyRemote,
    isGitRepo: Boolean(repoCandidate?.isGitRepo),
  });
  const createRepositoryUrl = suggestedRepo
    ? `https://github.com/new?name=${encodeURIComponent(suggestedRepo)}`
    : null;
  const showQuickGitSetup = Boolean(
    !repoCandidate?.linked &&
    (!repoCandidate?.detectedFullName || !repoCandidate?.canLink),
  );

  async function refreshGitHubStatus(showLoading = true) {
    try {
      if (showLoading) {
        setAction("refresh");
      }
      const nextStatus = await getGitHubIntegrationStatus();
      setStatus(nextStatus);
      setAuthMessage(nextStatus.message);
      if (nextStatus.connected) {
        setPairing(null);
      }
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to check GitHub status.",
      );
    } finally {
      if (showLoading) {
        setAction(null);
      }
      setIsLoading(false);
    }
  }

  async function loadProjectsAndCandidate(
    projectId?: number | null,
    refresh = false,
  ) {
    try {
      setAction(refresh ? "detect" : "projects");
      const nextProjects = await getProjects();
      setProjects(nextProjects);
      const nextProjectId =
        projectId ?? selectedProjectId ?? nextProjects[0]?.id ?? null;
      setSelectedProjectId(nextProjectId);

      if (nextProjectId) {
        const candidate = await getProjectGitHubRepositoryLink(nextProjectId, {
          refresh,
        });
        const selectedProject =
          nextProjects.find((project) => project.id === nextProjectId) ?? null;
        setRepoCandidate(candidate);
        setRepoMessage(candidate.message);
        setManualOwner(candidate.detectedOwner ?? status?.login ?? "");
        setManualRepo(
          candidate.detectedRepo ??
            slugifyRepositoryName(selectedProject?.name),
        );
      } else {
        setRepoCandidate(null);
        setRepoMessage(
          "Add a local project first, then link it to a GitHub repository.",
        );
      }
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load repository linking state.",
      );
    } finally {
      setAction(null);
    }
  }

  async function connectGitHub() {
    try {
      setAction("connect");
      setAuthMessage(null);
      const auth = await startGitHubDeviceAuth();
      setPairing(auth);
      setAuthMessage(
        "GitHub pairing code created. Open GitHub, paste the code, then return here.",
      );
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to start GitHub pairing.",
      );
    } finally {
      setAction(null);
    }
  }

  async function pollGitHubAuth(sessionId = pairing?.sessionId) {
    if (!sessionId) {
      return;
    }

    try {
      setAction("poll");
      const result = await pollGitHubDeviceAuth(sessionId);

      if (result.state === "connected") {
        setStatus(result.status);
        setPairing(null);
        setAuthMessage(result.message ?? "GitHub account connected.");
        void loadProjectsAndCandidate(selectedProjectId, false);
        return;
      }

      if (result.state === "pending") {
        setAuthMessage(result.message ?? "Waiting for GitHub confirmation.");
        return;
      }

      if (result.state === "slow_down") {
        setPairing((current) =>
          current
            ? {
                ...current,
                interval: result.interval ?? current.interval + 5,
              }
            : current,
        );
        setAuthMessage(
          result.message ?? "GitHub asked ContextForge to slow down polling.",
        );
        return;
      }

      if (result.state === "expired") {
        setPairing(null);
        setAuthMessage(
          result.message ?? "GitHub pairing code expired. Start again.",
        );
        return;
      }

      if (result.state === "denied") {
        setPairing(null);
        setAuthMessage(result.message ?? "GitHub authorization was denied.");
        return;
      }

      setAuthMessage(result.message ?? "GitHub pairing failed.");
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to poll GitHub pairing.",
      );
    } finally {
      setAction(null);
    }
  }

  async function openGitHubUrl(url: string | null | undefined) {
    if (!url) {
      return;
    }

    const didOpen = await window.contextforge?.openExternalUrl?.(url);

    if (didOpen === false) {
      setAuthMessage("ContextForge blocked this external URL for safety.");
    }
  }

  async function copyGitHubCode() {
    if (!pairing?.userCode) {
      return;
    }

    await navigator.clipboard.writeText(pairing.userCode);
    setAuthMessage("GitHub pairing code copied.");
  }

  async function signOutFromGitHub() {
    try {
      setAction("sign-out");
      const nextStatus = await signOutGitHub();
      setStatus(nextStatus);
      setPairing(null);
      setAuthMessage("GitHub account disconnected.");
      void loadProjectsAndCandidate(selectedProjectId, false);
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to sign out from GitHub.",
      );
    } finally {
      setAction(null);
    }
  }

  async function initializeSelectedProjectGit() {
    if (!selectedProjectId) {
      return;
    }

    try {
      setAction("git-init");
      const candidate = await initializeProjectGitRepository(selectedProjectId);
      setRepoCandidate(candidate);
      setRepoMessage(
        candidate.isGitRepo
          ? "Initialized local Git repository."
          : candidate.message,
      );
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to initialize local Git repository.",
      );
    } finally {
      setAction(null);
    }
  }

  async function setupSelectedProjectRemote() {
    if (!selectedProjectId || !canSetupRemote) {
      return;
    }

    try {
      setAction("set-remote");
      const candidate = await setProjectGitHubOriginRemote(selectedProjectId, {
        owner: suggestedOwner,
        repo: suggestedRepo,
        overwrite: hasAnyRemote,
        initIfMissing: true,
      });
      setRepoCandidate(candidate);
      setRepoMessage(
        candidate.detectedFullName
          ? `Local Git remote is set to ${candidate.detectedFullName}.`
          : "Local Git remote was updated.",
      );
      if (candidate.detectedOwner) {
        setManualOwner(candidate.detectedOwner);
      }
      if (candidate.detectedRepo) {
        setManualRepo(candidate.detectedRepo);
      }
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to set GitHub origin remote.",
      );
    } finally {
      setAction(null);
    }
  }

  async function copyRemoteCommands() {
    if (!remoteCommands) {
      return;
    }

    await navigator.clipboard.writeText(remoteCommands);
    setRepoMessage("Git setup commands copied.");
  }

  async function linkDetectedRepository() {
    if (!selectedProjectId) {
      return;
    }

    try {
      setAction("link");
      const result = await linkProjectGitHubRepository(selectedProjectId, {
        source: "remote-origin",
      });
      setRepoCandidate(result.candidate);
      setRepoMessage(`Linked ${result.link.fullName}.`);
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to link GitHub repository.",
      );
    } finally {
      setAction(null);
    }
  }

  async function linkManualRepository() {
    if (!selectedProjectId) {
      return;
    }

    try {
      setAction("manual-link");
      const result = await linkProjectGitHubRepository(selectedProjectId, {
        owner: manualOwner,
        repo: manualRepo,
        source: "manual",
      });
      setRepoCandidate(result.candidate);
      setRepoMessage(`Linked ${result.link.fullName}.`);
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to link GitHub repository manually.",
      );
    } finally {
      setAction(null);
    }
  }

  async function unlinkRepository() {
    if (!selectedProjectId) {
      return;
    }

    try {
      setAction("unlink");
      const candidate = await unlinkProjectGitHubRepository(selectedProjectId);
      setRepoCandidate(candidate);
      setRepoMessage("GitHub repository link removed.");
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to unlink GitHub repository.",
      );
    } finally {
      setAction(null);
    }
  }

  async function loadGitHubIssues() {
    if (!selectedProjectId || !linkedRepository) {
      setIssuesResult(null);
      setSelectedIssue(null);
      setIssueMessage("Link a repository before loading issues.");
      return;
    }

    try {
      setAction("issues");
      setIssueMessage(null);
      const result = await getProjectGitHubIssues(selectedProjectId, {
        state: issueState,
        search: issueSearch,
        labels: issueLabels,
        perPage: 30,
      });
      setIssuesResult(result);
      setIssueMessage(result.message);
      setSelectedIssue((currentIssue) => {
        if (
          currentIssue &&
          result.issues.some((issue) => issue.number === currentIssue.number)
        ) {
          return currentIssue;
        }

        return result.issues[0] ?? null;
      });
    } catch (requestError) {
      setIssuesResult(null);
      setSelectedIssue(null);
      setIssueMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load GitHub issues.",
      );
    } finally {
      setAction(null);
    }
  }

  async function createTaskPackFromSelectedIssue() {
    if (
      !selectedProjectId ||
      !selectedProject ||
      !linkedRepository ||
      !selectedIssue
    ) {
      setIssueMessage("Select a linked project and GitHub issue first.");
      return;
    }

    try {
      setAction("issue-task-pack");
      setIssueMessage(
        `Creating Task Pack from issue #${selectedIssue.number}...`,
      );

      const rawTask = buildIssueTaskText({
        issue: selectedIssue,
        repositoryFullName: linkedRepository.fullName,
        repositoryUrl: linkedRepository.htmlUrl,
      });

      const taskPack = await createTaskPack({
        projectId: selectedProjectId,
        rawTask,
        taskType: inferTaskTypeFromIssue(selectedIssue),
        targetTool: "codex",
        githubIssueSource: buildIssueSource({
          issue: selectedIssue,
          repositoryFullName: linkedRepository.fullName,
          repositoryUrl: linkedRepository.htmlUrl,
        }),
      });

      setCreatedIssueTaskPack(taskPack);
      onTaskPackCreated?.(taskPack);
      setIssueMessage(
        `Created Task Pack #${taskPack.id} from GitHub issue #${selectedIssue.number}.`,
      );
    } catch (requestError) {
      setIssueMessage(
        requestError instanceof Error
          ? requestError.message
          : "Failed to create Task Pack from GitHub issue.",
      );
    } finally {
      setAction(null);
    }
  }

  function handleProjectChange(value: string) {
    const nextProjectId = Number(value);
    setSelectedProjectId(
      Number.isInteger(nextProjectId) ? nextProjectId : null,
    );
    void loadProjectsAndCandidate(
      Number.isInteger(nextProjectId) ? nextProjectId : null,
      false,
    );
  }

  useEffect(() => {
    void refreshGitHubStatus(false);
    void loadProjectsAndCandidate(null, false);
  }, []);

  useEffect(() => {
    if (!connected || !selectedProjectId || !linkedRepository) {
      setIssuesResult(null);
      setSelectedIssue(null);
      return;
    }

    void loadGitHubIssues();
  }, [connected, selectedProjectId, linkedRepository?.fullName, issueState]);

  useEffect(() => {
    if (!pairing || connected) {
      return;
    }

    const expiresAt = new Date(pairing.expiresAt).getTime();
    if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
      setPairing(null);
      setAuthMessage("GitHub pairing code expired. Start pairing again.");
      return;
    }

    const timer = window.setTimeout(
      () => {
        void pollGitHubAuth(pairing.sessionId);
      },
      Math.max(pairing.interval, 1) * 1000,
    );

    return () => window.clearTimeout(timer);
  }, [pairing, connected]);

  if (isLoading && status === null) {
    return <GitHubWorkspaceSkeleton />;
  }

  return (
    <section className="space-y-5 p-6">
      <article className="cf-card relative overflow-hidden p-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(52,211,153,0.15),transparent_34%),radial-gradient(circle_at_82%_20%,rgba(255,255,255,0.09),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />

        <div className="relative grid gap-7 p-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                <Github size={13} />
                GitHub
              </span>
              <span className="cf-badge">Stage 13.2</span>
              <GitHubStateBadge
                configured={configured}
                connected={connected}
                pairing={isPairing}
              />
              <span className="cf-badge">Local-first stays on</span>
            </div>

            <h1 className="max-w-3xl text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] text-white">
              GitHub workflow bridge for local projects.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">
              Connect GitHub through browser pairing, keep project files local,
              then link a local Git remote to safe GitHub repository metadata.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => refreshGitHubStatus(true)}
                disabled={Boolean(action)}
              >
                {action === "refresh" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                GitHub status
              </Button>

              {!connected && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={connectGitHub}
                  disabled={Boolean(action) || !configured}
                  className="disabled:pointer-events-none disabled:opacity-45"
                >
                  {action === "connect" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <GitBranch size={15} />
                  )}
                  Connect GitHub
                </Button>
              )}

              {connected && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={signOutFromGitHub}
                  disabled={Boolean(action)}
                >
                  {action === "sign-out" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <LockKeyhole size={15} />
                  )}
                  Sign out
                </Button>
              )}
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/45 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(52,211,153,0.14),transparent_34%)]" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-neutral-950 text-neutral-300">
                  {connected && status?.avatarUrl ? (
                    <img
                      src={status.avatarUrl}
                      alt="GitHub avatar"
                      className="size-full rounded-2xl object-cover"
                    />
                  ) : (
                    <Github size={22} />
                  )}
                </span>
                <span className="cf-tech-label text-[10px] uppercase text-neutral-700">
                  Account
                </span>
              </div>

              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-white">
                {connected
                  ? (status?.login ?? "GitHub connected")
                  : configured
                    ? "Ready to connect"
                    : "Setup required"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                {connected
                  ? `Connected ${formatDateTime(status?.connectedAt ?? null)} · checked ${formatDateTime(status?.lastCheckedAt ?? null)}`
                  : configured
                    ? "Pair through the browser and keep local projects working without cloud sync."
                    : "Add a GitHub OAuth client id for developer preview pairing."}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    Token handling
                  </p>
                  <p className="mt-2 text-sm leading-6 text-neutral-400">
                    Server-side only. Never returned to the renderer or
                    workspace backups.
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    Source handling
                  </p>
                  <p className="mt-2 text-sm leading-6 text-neutral-400">
                    Repository metadata can sync. Project files stay local.
                  </p>
                </div>
              </div>

              {connected && status && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4">
                  <div className="min-w-0">
                    <p className="cf-tech-label text-[10px] uppercase text-emerald-200/80">
                      Scopes
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">
                      {scopesLabel}
                    </p>
                  </div>
                  {status.htmlUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openGitHubUrl(status.htmlUrl)}
                    >
                      <ExternalLink size={15} />
                      Profile
                    </Button>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </article>

      {authMessage && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4 text-sm leading-6 text-emerald-100">
          {authMessage}
        </div>
      )}

      {!configured && (
        <article className="rounded-[1.35rem] border border-amber-400/25 bg-amber-400/[0.07] p-5">
          <p className="text-sm font-semibold text-amber-100">
            GitHub OAuth client id is missing.
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-100/70">
            Developer preview still needs a local OAuth app client id. End users
            should not need this once ContextForge ships with an official GitHub
            app id.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-amber-300/15 bg-black/45 p-3 text-xs text-amber-100/80">
            GITHUB_OAUTH_CLIENT_ID=your_client_id
          </pre>
        </article>
      )}

      {isPairing && pairing && (
        <article className="rounded-[1.65rem] border border-white/10 bg-black/45 p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Browser pairing code
              </p>
              <p className="mt-3 font-mono text-3xl font-semibold tracking-[0.18em] text-white">
                {pairing.userCode}
              </p>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                Expires {expiresAtLabel}. ContextForge polls every{" "}
                {pairing.interval}s and respects GitHub slow-down responses.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={copyGitHubCode}
              >
                <KeyRound size={15} />
                Copy code
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => openGitHubUrl(pairing.verificationUri)}
              >
                <ExternalLink size={15} />
                Open GitHub
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => pollGitHubAuth(pairing.sessionId)}
                disabled={action === "poll"}
              >
                {action === "poll" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Check now
              </Button>
            </div>
          </div>
        </article>
      )}

      <article className="cf-card p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                <Link2 size={13} />
                Stage 13.2
              </span>
              <span className="cf-badge">Repository linking</span>
              <span className="cf-badge">Remote metadata only</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.045em] text-white">
              Link a local project to its GitHub repository.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
              ContextForge reads the selected project&apos;s local Git remote,
              validates the repository through your connected GitHub account,
              and stores safe repo metadata for future issue workflows.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadProjectsAndCandidate(selectedProjectId, false)}
              disabled={Boolean(action)}
            >
              {action === "projects" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Reload projects
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadProjectsAndCandidate(selectedProjectId, true)}
              disabled={Boolean(action) || !selectedProjectId}
            >
              {action === "detect" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <GitBranch size={15} />
              )}
              Detect remote
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Step 01
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              Pick a local workspace
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              ContextForge reads only local Git metadata from the selected
              project.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Step 02
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              Detect origin remote
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              HTTPS and SSH GitHub remotes are normalized into owner/repo.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.045] p-4">
            <p className="cf-tech-label text-[10px] uppercase text-emerald-200/80">
              Step 03
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              Link safe metadata
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              Save branch, visibility and repo URL for issue workflows.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.78fr)_minmax(360px,0.72fr)]">
          <div className="space-y-4">
            <div className="block rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Local project
              </span>
              <div className="mt-3">
                <CustomSelect
                  value={selectedProjectId ? String(selectedProjectId) : ""}
                  options={projectOptions}
                  onChange={handleProjectChange}
                  placeholder="Choose a local project"
                  disabled={projects.length === 0 || Boolean(action)}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-600">
                Stage 13.2 links one local workspace project at a time.
              </p>
            </div>

            {repoMessage && (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4 text-sm leading-6 text-emerald-100">
                {repoMessage}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <SmallMeta
                label="Current branch"
                value={repoCandidate?.currentBranch ?? "Unknown"}
              />
              <SmallMeta
                label="Origin remote"
                value={repoCandidate?.remoteUrl ?? "No GitHub remote detected"}
              />
            </div>

            {repoCandidate?.warnings.length ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.055] p-4 text-sm leading-6 text-amber-100/85">
                <p className="font-semibold text-amber-100">
                  Repository linking warnings
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {repoCandidate.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {showQuickGitSetup && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Quick local Git setup
                    </p>
                    <p className="mt-2 text-xs leading-5 text-neutral-500">
                      ContextForge can initialize Git locally and set an origin
                      remote from the owner/repo below. It does not create a
                      GitHub repository or upload source files.
                    </p>
                  </div>
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                    <GitBranch size={15} />
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {!repoCandidate?.isGitRepo && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={initializeSelectedProjectGit}
                      disabled={Boolean(action) || !selectedProjectId}
                    >
                      {action === "git-init" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <GitBranch size={15} />
                      )}
                      Init Git
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="primary"
                    onClick={setupSelectedProjectRemote}
                    disabled={Boolean(action) || !canSetupRemote}
                    className="disabled:pointer-events-none disabled:opacity-45"
                  >
                    {action === "set-remote" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Link2 size={15} />
                    )}
                    {hasAnyRemote
                      ? "Update GitHub remote"
                      : "Set GitHub remote"}
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={copyRemoteCommands}
                    disabled={!remoteCommands}
                  >
                    <KeyRound size={15} />
                    Copy commands
                  </Button>

                  {createRepositoryUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openGitHubUrl(createRepositoryUrl)}
                    >
                      <ExternalLink size={15} />
                      Create repo on GitHub
                    </Button>
                  )}
                </div>

                {remoteCommands && (
                  <pre className="mt-4 overflow-x-auto rounded-xl border border-neutral-900 bg-black/45 p-3 text-xs leading-5 text-neutral-400">
                    {remoteCommands}
                  </pre>
                )}
              </div>
            )}
          </div>

          <aside className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Detected repository
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              {repoCandidate?.linked?.fullName ??
                repoCandidate?.detectedFullName ??
                "No repo linked yet"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              {repoCandidate?.linked
                ? "This project is linked. Future issue workflows will use this repository metadata."
                : repoCandidate?.detectedFullName
                  ? "Remote origin was detected and can be linked after GitHub validates access."
                  : "Add a GitHub origin remote or use manual owner/repo linking."}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {!repoCandidate?.linked && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={linkDetectedRepository}
                  disabled={Boolean(action) || !repoCandidate?.canLink}
                  className="disabled:pointer-events-none disabled:opacity-45"
                >
                  {action === "link" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  Link detected repo
                </Button>
              )}

              {repoCandidate?.linked && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      loadProjectsAndCandidate(selectedProjectId, true)
                    }
                    disabled={Boolean(action)}
                  >
                    {action === "detect" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    Refresh metadata
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={unlinkRepository}
                    disabled={Boolean(action)}
                  >
                    {action === "unlink" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <LockKeyhole size={15} />
                    )}
                    Unlink
                  </Button>
                </>
              )}

              {(repoCandidate?.linked?.htmlUrl ??
                repoCandidate?.detectedHtmlUrl) && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    openGitHubUrl(
                      repoCandidate?.linked?.htmlUrl ??
                        repoCandidate?.detectedHtmlUrl,
                    )
                  }
                >
                  <ExternalLink size={15} />
                  Open repo
                </Button>
              )}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SmallMeta
                label="Default branch"
                value={repoCandidate?.linked?.defaultBranch ?? "Unknown"}
              />
              <SmallMeta
                label="Visibility"
                value={repoCandidate?.linked?.visibility ?? "Not linked"}
              />
              <SmallMeta
                label="Language"
                value={repoCandidate?.linked?.language ?? "Unknown"}
              />
              <SmallMeta
                label="Last checked"
                value={formatDateTime(
                  repoCandidate?.linked?.lastCheckedAt ?? null,
                )}
              />
            </div>

            {!repoCandidate?.linked && (
              <div className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Manual fallback
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    value={manualOwner}
                    onChange={(event) => setManualOwner(event.target.value)}
                    placeholder="owner"
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                  />
                  <input
                    value={manualRepo}
                    onChange={(event) => setManualRepo(event.target.value)}
                    placeholder="repo"
                    className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={linkManualRepository}
                  disabled={
                    Boolean(action) ||
                    !connected ||
                    !manualOwner.trim() ||
                    !manualRepo.trim()
                  }
                  className="mt-3 disabled:pointer-events-none disabled:opacity-45"
                >
                  {action === "manual-link" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  Link manually
                </Button>
              </div>
            )}
          </aside>
        </div>
      </article>

      <article className="cf-card p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                <MessageSquareText size={13} />
                Stage 13.3
              </span>
              <span className="cf-badge">Issue → Task Pack</span>
              <span className="cf-badge">Linked repo only</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.045em] text-white">
              Turn GitHub issues into local Task Packs.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
              ContextForge reads issue metadata from the linked repository,
              previews the issue body and labels, then creates a local Task Pack
              that still uses local project scanning for file context.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={loadGitHubIssues}
              disabled={Boolean(action) || !linkedRepository}
            >
              {action === "issues" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Refresh issues
            </Button>
          </div>
        </div>

        {linkedRepository && (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="text-sm font-semibold text-white">Issue inbox</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Load open, closed or filtered issues from{" "}
                {linkedRepository.fullName}.
              </p>
            </div>
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="text-sm font-semibold text-white">Preview source</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Inspect labels, body and suggested task type before generation.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.045] p-4">
              <p className="text-sm font-semibold text-white">Create locally</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Task Pack still uses local project scanning for file context.
              </p>
            </div>
          </div>
        )}

        {!linkedRepository ? (
          <div className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-5 text-sm leading-6 text-neutral-500">
            Link a repository in Stage 13.2 first. Issue import needs a known
            GitHub repository for the selected local project.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.78fr)_minmax(360px,0.72fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)_190px]">
                <CustomSelect
                  value={issueState}
                  options={[
                    {
                      value: "open",
                      label: "Open",
                      description: "Active issues",
                      icon: <MessageSquareText size={15} />,
                    },
                    {
                      value: "closed",
                      label: "Closed",
                      description: "Resolved issues",
                      icon: <CheckCircle2 size={15} />,
                    },
                    {
                      value: "all",
                      label: "All",
                      description: "Open and closed",
                      icon: <ListChecks size={15} />,
                    },
                  ]}
                  onChange={(value) =>
                    setIssueState(value as "open" | "closed" | "all")
                  }
                  disabled={Boolean(action)}
                />

                <label className="flex h-12 items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300 focus-within:border-white/20">
                  <Search size={15} className="text-neutral-600" />
                  <input
                    value={issueSearch}
                    onChange={(event) => setIssueSearch(event.target.value)}
                    placeholder="Search title, body, label or #number"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
                  />
                </label>

                <input
                  value={issueLabels}
                  onChange={(event) => setIssueLabels(event.target.value)}
                  placeholder="labels: bug,ui"
                  className="h-12 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={loadGitHubIssues}
                  disabled={Boolean(action)}
                >
                  {action === "issues" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Search size={15} />
                  )}
                  Apply filters
                </Button>

                {linkedRepository.htmlUrl && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      openGitHubUrl(`${linkedRepository.htmlUrl}/issues`)
                    }
                  >
                    <ExternalLink size={15} />
                    Open issues
                  </Button>
                )}
              </div>

              {issueMessage && (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4 text-sm leading-6 text-emerald-100">
                  {issueMessage}
                </div>
              )}

              {createdIssueTaskPack && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-neutral-300">
                  <p className="font-semibold text-white">
                    Task Pack #{createdIssueTaskPack.id} created
                  </p>
                  <p className="mt-1 text-neutral-500">
                    Open Task Packs archive to review/export it. The GitHub
                    issue link is stored in the generation recipe metadata.
                  </p>
                </div>
              )}

              <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1">
                {issuesResult?.issues.length ? (
                  issuesResult.issues.map((issue) => {
                    const isSelected = selectedIssue?.number === issue.number;

                    return (
                      <button
                        key={issue.number}
                        type="button"
                        onClick={() => setSelectedIssue(issue)}
                        className={[
                          "rounded-2xl border p-4 text-left transition",
                          isSelected
                            ? "border-emerald-400/30 bg-emerald-400/[0.065]"
                            : "border-neutral-900 bg-black/35 hover:border-white/15 hover:bg-white/[0.035]",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">
                              #{issue.number} · {issue.title}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                              {issue.state} · updated{" "}
                              {formatDateTime(issue.updatedAt)} ·{" "}
                              {issue.author?.login ?? "unknown"}
                            </p>
                          </div>
                          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                            {issue.commentsCount} comments
                          </span>
                        </div>

                        {issue.labels.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {issue.labels.slice(0, 6).map((label) => (
                              <span
                                key={label.name}
                                className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-400"
                              >
                                {label.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
                    <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                      <MessageSquareText size={17} />
                    </span>
                    <p className="mt-4 text-sm font-semibold text-white">
                      No issues in this view yet
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-500">
                      Refresh issues, switch the state filter to All, or open
                      GitHub to create a new issue for this repository.
                    </p>
                    {linkedRepository.htmlUrl && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="mt-4"
                        onClick={() =>
                          openGitHubUrl(`${linkedRepository.htmlUrl}/issues`)
                        }
                      >
                        <ExternalLink size={15} />
                        Open issues
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <aside className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Issue preview
              </p>

              {selectedIssue ? (
                <>
                  <h3 className="mt-2 text-xl font-semibold leading-7 text-white">
                    #{selectedIssue.number} · {selectedIssue.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">
                    {selectedIssue.state} ·{" "}
                    {selectedIssue.author?.login ?? "unknown"} · updated{" "}
                    {formatDateTime(selectedIssue.updatedAt)}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={createTaskPackFromSelectedIssue}
                      disabled={Boolean(action)}
                    >
                      {action === "issue-task-pack" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <ListChecks size={15} />
                      )}
                      Create Task Pack
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openGitHubUrl(selectedIssue.htmlUrl)}
                    >
                      <ExternalLink size={15} />
                      Open issue
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <SmallMeta
                      label="Labels"
                      value={
                        selectedIssue.labels
                          .map((label) => label.name)
                          .join(", ") || "none"
                      }
                    />
                    <SmallMeta
                      label="Suggested type"
                      value={inferTaskTypeFromIssue(selectedIssue)}
                    />
                    <SmallMeta
                      label="Comments"
                      value={String(selectedIssue.commentsCount)}
                    />
                    <SmallMeta
                      label="Created"
                      value={formatDateTime(selectedIssue.createdAt)}
                    />
                  </div>

                  <div className="mt-5 max-h-[300px] overflow-y-auto rounded-2xl border border-neutral-900 bg-black/45 p-4 text-sm leading-6 text-neutral-400 whitespace-pre-wrap">
                    {selectedIssue.body?.trim() || "No issue body provided."}
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-8 text-center text-sm leading-6 text-neutral-500">
                  Select an issue to preview the exact title, body, labels and
                  Task Pack source metadata.
                </div>
              )}
            </aside>
          </div>
        )}
      </article>

      <article className="cf-card border-emerald-400/10 bg-emerald-400/[0.025] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="cf-tech-label text-[10px] uppercase text-emerald-200/70">
              GitHub issue loop complete
            </p>
            <h2 className="mt-2 text-lg font-semibold text-white">
              Browser auth, repo linking and both issue directions are ready.
            </h2>
            <p className="mt-1 text-sm leading-6 text-neutral-500">
              Next milestone is v0.6.1: PR context, changed files and CI status.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
              13.1 Done
            </span>
            <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
              13.2 Done
            </span>
            <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
              13.3 Done
            </span>
            <span className="cf-badge border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
              13.4 Done
            </span>
          </div>
        </div>
      </article>

      {isLoading && (
        <div className="rounded-2xl border border-neutral-900 bg-black/40 p-5 text-sm text-neutral-500">
          Loading GitHub workspace...
        </div>
      )}
    </section>
  );
}
