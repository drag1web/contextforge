import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  Github,
  Inbox,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Unlink2,
  UserRound,
} from "lucide-react";
import { siGithub } from "simple-icons/icons";

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
import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { Button } from "../components/ui/Button";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
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

type GitHubTab = "overview" | "repository" | "issues" | "security";
type NoticeTone = "neutral" | "success" | "warning" | "danger";

const CONTENT_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
} as const;

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

function formatDateTime(
  value: string | null,
  fallback: string,
  locale: string,
) {
  if (!value) {
    return fallback;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function GitHubBrandLogo({ contrast = false }: { contrast?: boolean }) {
  return (
    <span
      className={[
        "grid size-9 shrink-0 place-items-center rounded-2xl border",
        contrast
          ? "border-black/10 bg-black/5 text-black"
          : "border-neutral-800 bg-neutral-950 text-neutral-100",
      ].join(" ")}
      title={siGithub.title}
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path fill="currentColor" d={siGithub.path} />
      </svg>
    </span>
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
    <section className="space-y-4 p-6">
      <article className="rounded-[1.75rem] border border-neutral-900 bg-black/25 p-5">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex min-w-0 items-start gap-3">
            <SkeletonLine className="size-10 shrink-0 rounded-2xl" />
            <div className="min-w-0">
              <SkeletonLine className="h-3 w-36" />
              <SkeletonLine className="mt-3 h-7 w-64" />
              <SkeletonLine className="mt-3 h-4 w-[min(620px,74vw)]" />
            </div>
          </div>
          <div className="grid w-full grid-cols-3 overflow-hidden rounded-2xl border border-neutral-900 xl:w-[430px]">
            <SkeletonLine className="h-[66px] rounded-none" />
            <SkeletonLine className="h-[66px] rounded-none" />
            <SkeletonLine className="h-[66px] rounded-none" />
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-neutral-900 bg-black/35 p-1">
        <div className="grid grid-cols-4 gap-1">
          <SkeletonLine className="h-12 rounded-[0.95rem]" />
          <SkeletonLine className="h-12 rounded-[0.95rem]" />
          <SkeletonLine className="h-12 rounded-[0.95rem]" />
          <SkeletonLine className="h-12 rounded-[0.95rem]" />
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <div className="flex items-start gap-3">
            <SkeletonLine className="size-9 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <SkeletonLine className="h-3 w-32" />
              <SkeletonLine className="mt-3 h-7 w-52" />
            </div>
          </div>
          <SkeletonLine className="mt-4 h-4 w-[min(680px,90%)]" />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <SkeletonLine className="h-28 rounded-2xl" />
            <SkeletonLine className="h-28 rounded-2xl" />
            <SkeletonLine className="h-28 rounded-2xl" />
          </div>
        </article>
        <article className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <SkeletonLine className="h-10 w-10 rounded-2xl" />
          <SkeletonLine className="mt-5 h-6 w-44" />
          <SkeletonLine className="mt-3 h-4 w-full" />
          <SkeletonLine className="mt-2 h-4 w-4/5" />
          <SkeletonLine className="mt-5 h-11 rounded-xl" />
        </article>
      </div>

      <SkeletonLine className="h-12 rounded-2xl" />

      <article className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
        <SkeletonLine className="h-3 w-36" />
        <SkeletonLine className="mt-3 h-6 w-72" />
        <SkeletonLine className="mt-3 h-4 w-[min(760px,88%)]" />
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SkeletonLine className="h-24 rounded-2xl" />
          <SkeletonLine className="h-24 rounded-2xl" />
          <SkeletonLine className="h-24 rounded-2xl" />
        </div>
      </article>
    </section>
  );
}

function StatusPill({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: NoticeTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
        : tone === "danger"
          ? "border-red-400/25 bg-red-400/10 text-red-200"
          : "border-neutral-800 bg-neutral-950 text-neutral-400";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}
    >
      {icon}
      {children}
    </span>
  );
}

function Notice({
  tone = "neutral",
  icon,
  title,
  children,
}: {
  tone?: NoticeTone;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/[0.055] text-emerald-100"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/[0.055] text-amber-100/90"
        : tone === "danger"
          ? "border-red-400/20 bg-red-400/[0.055] text-red-100/90"
          : "border-neutral-900 bg-black/35 text-neutral-400";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-current/15 bg-black/20">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          {title ? <p className="text-sm font-semibold text-white">{title}</p> : null}
          <div className={title ? "mt-1 text-sm leading-6" : "text-sm leading-6"}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function SmallMeta({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-center gap-2">
        {icon ? <span className="text-neutral-600">{icon}</span> : null}
        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {label}
        </p>
      </div>
      <p className="mt-2 break-words text-sm font-medium text-neutral-200">
        {value}
      </p>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 border-l border-neutral-900 px-4 first:border-l-0">
      <p className="cf-tech-label truncate text-[9px] uppercase text-neutral-700">
        {label}
      </p>
      <p
        className="mt-1 truncate text-sm font-semibold text-white"
        title={title ?? value}
      >
        {value}
      </p>
    </div>
  );
}

function StepCard({
  complete,
  current,
  icon,
  label,
  description,
}: {
  complete: boolean;
  current: boolean;
  icon: ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div
      className={[
        "relative rounded-2xl border p-4 transition-colors",
        current
          ? "border-white/20 bg-white/[0.045]"
          : complete
            ? "border-emerald-400/15 bg-emerald-400/[0.035]"
            : "border-neutral-900 bg-black/35",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            complete
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
              : current
                ? "border-white/15 bg-white/[0.055] text-white"
                : "border-neutral-800 bg-neutral-950 text-neutral-600",
          ].join(" ")}
        >
          {complete ? <Check size={15} /> : icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

interface GitHubPageProps {
  onTaskPackCreated?: (taskPack: TaskPack) => void;
}

export function GitHubPage({ onTaskPackCreated }: GitHubPageProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<GitHubTab>("overview");
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
  const notChecked = t("githubWorkspace.common.notChecked");
  const dateLocale = i18n.resolvedLanguage?.startsWith("ru")
    ? "ru-RU"
    : "en-US";
  const expiresAtLabel = pairing
    ? formatDateTime(pairing.expiresAt, notChecked, dateLocale)
    : null;
  const scopesLabel = status?.scopes.length
    ? status.scopes.join(", ")
    : t("githubWorkspace.security.noScopes");
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
          label: t("githubWorkspace.repository.noProjects"),
          description: t("githubWorkspace.repository.noProjectsDescription"),
          icon: <FolderGit2 size={15} />,
          disabled: true,
        },
      ];
    }

    return projects.map((project) => ({
      value: String(project.id),
      label: project.name,
      description: project.localPath,
      icon: <FolderGit2 size={15} />,
    }));
  }, [projects, t]);
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

  const tabs = useMemo(
    () => [
      {
        id: "overview" as const,
        label: t("githubWorkspace.tabs.overview"),
        icon: <Github size={15} />,
      },
      {
        id: "repository" as const,
        label: t("githubWorkspace.tabs.repository"),
        icon: <FolderGit2 size={15} />,
      },
      {
        id: "issues" as const,
        label: t("githubWorkspace.tabs.issues"),
        icon: <CircleDot size={15} />,
      },
      {
        id: "security" as const,
        label: t("githubWorkspace.tabs.security"),
        icon: <ShieldCheck size={15} />,
      },
    ],
    [t],
  );
  const activeTabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTab),
  );

  async function refreshGitHubStatus(showLoading = true) {
    try {
      if (showLoading) {
        setAction("refresh");
      }
      const nextStatus = await getGitHubIntegrationStatus();
      setStatus(nextStatus);
      setAuthMessage(
        nextStatus.connected
          ? t("githubWorkspace.messages.statusConnected")
          : nextStatus.configured
            ? t("githubWorkspace.messages.statusReady")
            : t("githubWorkspace.messages.statusSetupRequired"),
      );
      if (nextStatus.connected) {
        setPairing(null);
      }
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.statusFailed"),
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
        const nextSelectedProject =
          nextProjects.find((project) => project.id === nextProjectId) ?? null;
        setRepoCandidate(candidate);
        setRepoMessage(
          candidate.linked
            ? t("githubWorkspace.messages.repositoryLinked", {
                name: candidate.linked.fullName,
              })
            : candidate.detectedFullName
              ? t("githubWorkspace.messages.repositoryDetected", {
                  name: candidate.detectedFullName,
                })
              : t("githubWorkspace.messages.repositoryNotDetected"),
        );
        setManualOwner(candidate.detectedOwner ?? status?.login ?? "");
        setManualRepo(
          candidate.detectedRepo ??
            slugifyRepositoryName(nextSelectedProject?.name),
        );
      } else {
        setRepoCandidate(null);
        setRepoMessage(t("githubWorkspace.messages.addProjectFirst"));
      }
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.repositoryLoadFailed"),
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
      setAuthMessage(t("githubWorkspace.messages.pairingCreated"));
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.pairingFailed"),
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
        setAuthMessage(t("githubWorkspace.messages.accountConnected"));
        void loadProjectsAndCandidate(selectedProjectId, false);
        return;
      }

      if (result.state === "pending") {
        setAuthMessage(t("githubWorkspace.messages.pairingPending"));
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
        setAuthMessage(t("githubWorkspace.messages.pairingSlowDown"));
        return;
      }

      if (result.state === "expired") {
        setPairing(null);
        setAuthMessage(t("githubWorkspace.messages.pairingExpired"));
        return;
      }

      if (result.state === "denied") {
        setPairing(null);
        setAuthMessage(t("githubWorkspace.messages.pairingDenied"));
        return;
      }

      setAuthMessage(t("githubWorkspace.messages.pairingFailed"));
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.pairingPollFailed"),
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
      setAuthMessage(t("githubWorkspace.messages.externalUrlBlocked"));
    }
  }

  async function copyGitHubCode() {
    if (!pairing?.userCode) {
      return;
    }

    await navigator.clipboard.writeText(pairing.userCode);
    setAuthMessage(t("githubWorkspace.messages.pairingCodeCopied"));
  }

  async function signOutFromGitHub() {
    try {
      setAction("sign-out");
      const nextStatus = await signOutGitHub();
      setStatus(nextStatus);
      setPairing(null);
      setAuthMessage(t("githubWorkspace.messages.accountDisconnected"));
      void loadProjectsAndCandidate(selectedProjectId, false);
    } catch (requestError) {
      setAuthMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.signOutFailed"),
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
          ? t("githubWorkspace.messages.gitInitialized")
          : candidate.message,
      );
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.gitInitializeFailed"),
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
          ? t("githubWorkspace.messages.remoteSet", {
              name: candidate.detectedFullName,
            })
          : t("githubWorkspace.messages.remoteUpdated"),
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
          : t("githubWorkspace.messages.remoteSetFailed"),
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
    setRepoMessage(t("githubWorkspace.messages.commandsCopied"));
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
      setRepoMessage(
        t("githubWorkspace.messages.repositoryLinked", {
          name: result.link.fullName,
        }),
      );
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.repositoryLinkFailed"),
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
      setRepoMessage(
        t("githubWorkspace.messages.repositoryLinked", {
          name: result.link.fullName,
        }),
      );
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.repositoryManualLinkFailed"),
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
      setRepoMessage(t("githubWorkspace.messages.repositoryUnlinked"));
    } catch (requestError) {
      setRepoMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.repositoryUnlinkFailed"),
      );
    } finally {
      setAction(null);
    }
  }

  async function loadGitHubIssues() {
    if (!selectedProjectId || !linkedRepository) {
      setIssuesResult(null);
      setSelectedIssue(null);
      setIssueMessage(t("githubWorkspace.messages.linkBeforeIssues"));
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
      setIssueMessage(
        t("githubWorkspace.messages.issuesLoaded", { count: result.total }),
      );
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
          : t("githubWorkspace.messages.issuesLoadFailed"),
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
      setIssueMessage(t("githubWorkspace.messages.selectIssueFirst"));
      return;
    }

    try {
      setAction("issue-task-pack");
      setIssueMessage(
        t("githubWorkspace.messages.packageCreating", {
          number: selectedIssue.number,
        }),
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
        t("githubWorkspace.messages.packageCreated", {
          id: taskPack.id,
          number: selectedIssue.number,
        }),
      );
    } catch (requestError) {
      setIssueMessage(
        requestError instanceof Error
          ? requestError.message
          : t("githubWorkspace.messages.packageCreateFailed"),
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
      setAuthMessage(t("githubWorkspace.messages.pairingExpired"));
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

  const accountValue = connected
    ? `@${status?.login ?? t("githubWorkspace.summary.connected")}`
    : configured
      ? t("githubWorkspace.summary.ready")
      : t("githubWorkspace.summary.setup");
  const repositoryFullValue =
    linkedRepository?.fullName ??
    repoCandidate?.detectedFullName ??
    selectedProject?.name ??
    t("githubWorkspace.summary.notSelected");
  const repositoryValue =
    linkedRepository?.repo ??
    repoCandidate?.detectedRepo ??
    selectedProject?.name ??
    t("githubWorkspace.summary.notSelected");
  const issueValue = linkedRepository
    ? String(issuesResult?.total ?? "—")
    : "—";

  const repositoryStepComplete = Boolean(selectedProjectId);
  const remoteStepComplete = Boolean(repoCandidate?.detectedFullName);
  const linkStepComplete = Boolean(linkedRepository);

  return (
    <section className="space-y-4 p-6">
      <WorkspacePageHeader
        headingLevel={1}
        icon={<GitHubBrandLogo />}
        eyebrow={t("githubWorkspace.eyebrow")}
        title={t("githubWorkspace.title")}
        description={t("githubWorkspace.description")}
        aside={
          <div className="grid w-full grid-cols-3 overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 xl:w-[430px]">
            <SummaryMetric
              label={t("githubWorkspace.summary.account")}
              value={accountValue}
            />
            <SummaryMetric
              label={t("githubWorkspace.summary.repository")}
              value={repositoryValue}
              title={repositoryFullValue}
            />
            <SummaryMetric
              label={t("githubWorkspace.summary.issues")}
              value={issueValue}
            />
          </div>
        }
      />

      <HorizontalSlidingSelector
        items={tabs}
        activeIndex={activeTabIndex}
        getItemKey={(tab) => tab.id}
        onSelect={(tab) => setActiveTab(tab.id)}
        ariaLabel={t("githubWorkspace.tabs.ariaLabel")}
        className="min-h-14"
        itemClassName="px-3 py-3"
        renderItem={(tab, isActive) => (
          <span className="flex items-center justify-center gap-2 text-sm font-medium">
            {tab.icon}
            <span>{tab.label}</span>
            {tab.id === "issues" && issuesResult?.total ? (
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-[10px]",
                  isActive
                    ? "bg-black/10 text-black/70"
                    : "bg-white/[0.055] text-neutral-500",
                ].join(" ")}
              >
                {issuesResult.total}
              </span>
            ) : null}
          </span>
        )}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={CONTENT_TRANSITION}
          className="min-h-[360px] space-y-4"
        >
          {activeTab === "overview" ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <article className="cf-card p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <GitHubBrandLogo />
                        <div>
                          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            {t("githubWorkspace.overview.accountEyebrow")}
                          </p>
                          <h2 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-white">
                            {connected
                              ? status?.login
                              : t("githubWorkspace.overview.connectTitle")}
                          </h2>
                        </div>
                      </div>
                      <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-500">
                        {connected
                          ? t("githubWorkspace.overview.connectedDescription")
                          : t("githubWorkspace.overview.connectDescription")}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
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
                        {t("githubWorkspace.common.refresh")}
                      </Button>

                      {!connected ? (
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
                            <Github size={15} />
                          )}
                          {t("githubWorkspace.common.connect")}
                        </Button>
                      ) : status?.htmlUrl ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => openGitHubUrl(status.htmlUrl)}
                        >
                          <ExternalLink size={15} />
                          {t("githubWorkspace.common.openProfile")}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                          <UserRound size={16} />
                        </span>
                        <StatusPill tone={connected ? "success" : "neutral"}>
                          {connected
                            ? t("githubWorkspace.status.connected")
                            : t("githubWorkspace.status.disconnected")}
                        </StatusPill>
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">
                        {t("githubWorkspace.overview.accountCard")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        {connected
                          ? status?.login
                          : t("githubWorkspace.overview.accountCardEmpty")}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                          <FolderGit2 size={16} />
                        </span>
                        <StatusPill tone={linkedRepository ? "success" : "neutral"}>
                          {linkedRepository
                            ? t("githubWorkspace.status.linked")
                            : t("githubWorkspace.status.notLinked")}
                        </StatusPill>
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">
                        {t("githubWorkspace.overview.repositoryCard")}
                      </p>
                      <p
                        className="mt-1 truncate text-xs leading-5 text-neutral-500"
                        title={repositoryFullValue}
                      >
                        {repositoryFullValue}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                          <CircleDot size={16} />
                        </span>
                        <StatusPill tone={linkedRepository ? "success" : "neutral"}>
                          {linkedRepository
                            ? t("githubWorkspace.status.available")
                            : t("githubWorkspace.status.waiting")}
                        </StatusPill>
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">
                        {t("githubWorkspace.overview.issuesCard")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        {linkedRepository
                          ? t("githubWorkspace.overview.issuesCardReady", {
                              count: issuesResult?.total ?? 0,
                            })
                          : t("githubWorkspace.overview.issuesCardEmpty")}
                      </p>
                    </div>
                  </div>
                </article>

                <aside className="cf-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      {connected ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <ChevronRight size={18} />
                      )}
                    </span>
                    <StatusPill
                      tone={
                        connected && linkedRepository
                          ? "success"
                          : configured
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {connected && linkedRepository
                        ? t("githubWorkspace.overview.ready")
                        : t("githubWorkspace.overview.nextAction")}
                    </StatusPill>
                  </div>
                  <h2 className="mt-5 text-xl font-semibold tracking-[-0.035em] text-white">
                    {!connected
                      ? t("githubWorkspace.overview.nextConnectTitle")
                      : !linkedRepository
                        ? t("githubWorkspace.overview.nextLinkTitle")
                        : t("githubWorkspace.overview.nextIssueTitle")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">
                    {!connected
                      ? t("githubWorkspace.overview.nextConnectDescription")
                      : !linkedRepository
                        ? t("githubWorkspace.overview.nextLinkDescription")
                        : t("githubWorkspace.overview.nextIssueDescription")}
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    className="mt-5 w-full"
                    onClick={() => {
                      if (!connected) {
                        void connectGitHub();
                        return;
                      }
                      setActiveTab(linkedRepository ? "issues" : "repository");
                    }}
                    disabled={!configured || Boolean(action)}
                  >
                    {!connected ? (
                      <Github size={15} />
                    ) : linkedRepository ? (
                      <CircleDot size={15} />
                    ) : (
                      <Link2 size={15} />
                    )}
                    {!connected
                      ? t("githubWorkspace.common.connect")
                      : linkedRepository
                        ? t("githubWorkspace.common.openIssues")
                        : t("githubWorkspace.common.openRepository")}
                  </Button>
                </aside>
              </div>

              <AnimatePresence initial={false}>
                {authMessage ? (
                  <motion.div
                    key={authMessage}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={CONTENT_TRANSITION}
                    className={[
                      "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                      connected
                        ? "border-emerald-400/15 bg-emerald-400/[0.035] text-emerald-100/80"
                        : configured
                          ? "border-neutral-900 bg-black/30 text-neutral-500"
                          : "border-amber-400/15 bg-amber-400/[0.035] text-amber-100/80",
                    ].join(" ")}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current/15 bg-black/20">
                      {connected ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <Github size={14} />
                      )}
                    </span>
                    <p className="min-w-0 truncate">{authMessage}</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {!configured ? (
                <Notice
                  tone="warning"
                  icon={<AlertTriangle size={15} />}
                  title={t("githubWorkspace.overview.oauthMissingTitle")}
                >
                  <p>{t("githubWorkspace.overview.oauthMissingDescription")}</p>
                  <pre className="mt-3 overflow-x-auto rounded-xl border border-amber-300/15 bg-black/45 p-3 text-xs text-amber-100/80">
                    GITHUB_OAUTH_CLIENT_ID=your_client_id
                  </pre>
                </Notice>
              ) : null}

              {isPairing && pairing ? (
                <article className="cf-card p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("githubWorkspace.overview.pairingEyebrow")}
                      </p>
                      <p className="mt-3 font-mono text-3xl font-semibold tracking-[0.18em] text-white">
                        {pairing.userCode}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">
                        {t("githubWorkspace.overview.pairingDescription", {
                          expires: expiresAtLabel,
                          interval: pairing.interval,
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={copyGitHubCode}>
                        <Copy size={15} />
                        {t("githubWorkspace.common.copyCode")}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => openGitHubUrl(pairing.verificationUri)}
                      >
                        <ExternalLink size={15} />
                        {t("githubWorkspace.common.openGitHub")}
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
                        {t("githubWorkspace.common.checkNow")}
                      </Button>
                    </div>
                  </div>
                </article>
              ) : null}

              <article className="cf-card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      {t("githubWorkspace.overview.localFirstEyebrow")}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      {t("githubWorkspace.overview.localFirstTitle")}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                      {t("githubWorkspace.overview.localFirstDescription")}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <SmallMeta
                    label={t("githubWorkspace.overview.tokenHandling")}
                    value={t("githubWorkspace.overview.tokenHandlingValue")}
                    icon={<KeyRound size={13} />}
                  />
                  <SmallMeta
                    label={t("githubWorkspace.overview.sourceHandling")}
                    value={t("githubWorkspace.overview.sourceHandlingValue")}
                    icon={<FolderGit2 size={13} />}
                  />
                  <SmallMeta
                    label={t("githubWorkspace.overview.scopes")}
                    value={scopesLabel}
                    icon={<ShieldCheck size={13} />}
                  />
                </div>
              </article>
            </>
          ) : null}

          {activeTab === "repository" ? (
            <>
              <article className="cf-card p-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <FolderGit2 size={18} />
                    </span>
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("githubWorkspace.repository.eyebrow")}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-white">
                        {t("githubWorkspace.repository.title")}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        {t("githubWorkspace.repository.description")}
                      </p>
                    </div>
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
                      {t("githubWorkspace.repository.reloadProjects")}
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
                      {t("githubWorkspace.repository.detectRemote")}
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <StepCard
                    complete={repositoryStepComplete}
                    current={!repositoryStepComplete}
                    icon={<FolderGit2 size={15} />}
                    label={t("githubWorkspace.repository.stepProject")}
                    description={t("githubWorkspace.repository.stepProjectDescription")}
                  />
                  <StepCard
                    complete={remoteStepComplete}
                    current={repositoryStepComplete && !remoteStepComplete}
                    icon={<GitBranch size={15} />}
                    label={t("githubWorkspace.repository.stepRemote")}
                    description={t("githubWorkspace.repository.stepRemoteDescription")}
                  />
                  <StepCard
                    complete={linkStepComplete}
                    current={remoteStepComplete && !linkStepComplete}
                    icon={<Link2 size={15} />}
                    label={t("githubWorkspace.repository.stepLink")}
                    description={t("githubWorkspace.repository.stepLinkDescription")}
                  />
                </div>
              </article>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.72fr)]">
                <div className="space-y-4">
                  <article className="cf-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                          {t("githubWorkspace.repository.localProject")}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-white">
                          {t("githubWorkspace.repository.chooseProject")}
                        </h3>
                      </div>
                      <StatusPill tone={selectedProject ? "success" : "neutral"}>
                        {selectedProject
                          ? selectedProject.name
                          : t("githubWorkspace.status.notSelected")}
                      </StatusPill>
                    </div>
                    <div className="mt-4">
                      <CustomSelect
                        value={selectedProjectId ? String(selectedProjectId) : ""}
                        options={projectOptions}
                        onChange={handleProjectChange}
                        placeholder={t("githubWorkspace.repository.chooseProjectPlaceholder")}
                        disabled={projects.length === 0 || Boolean(action)}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-neutral-600">
                      {t("githubWorkspace.repository.projectHint")}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <SmallMeta
                        label={t("githubWorkspace.repository.currentBranch")}
                        value={repoCandidate?.currentBranch ?? t("githubWorkspace.common.unknown")}
                        icon={<GitBranch size={13} />}
                      />
                      <SmallMeta
                        label={t("githubWorkspace.repository.originRemote")}
                        value={repoCandidate?.remoteUrl ?? t("githubWorkspace.repository.noRemote")}
                        icon={<Link2 size={13} />}
                      />
                    </div>
                  </article>

                  {repoMessage ? (
                    <Notice
                      tone={linkedRepository || repoCandidate?.detectedFullName ? "success" : "neutral"}
                      icon={linkedRepository ? <CheckCircle2 size={15} /> : <GitBranch size={15} />}
                    >
                      {repoMessage}
                    </Notice>
                  ) : null}

                  {repoCandidate?.warnings.length ? (
                    <Notice
                      tone="warning"
                      icon={<AlertTriangle size={15} />}
                      title={t("githubWorkspace.repository.warningsTitle")}
                    >
                      <ul className="list-disc space-y-1 pl-5">
                        {repoCandidate.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </Notice>
                  ) : null}

                  {showQuickGitSetup ? (
                    <article className="cf-card p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                            <TerminalSquare size={18} />
                          </span>
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              {t("githubWorkspace.repository.quickSetupEyebrow")}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-white">
                              {t("githubWorkspace.repository.quickSetupTitle")}
                            </h3>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                              {t("githubWorkspace.repository.quickSetupDescription")}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            {t("githubWorkspace.repository.owner")}
                          </span>
                          <input
                            value={manualOwner}
                            onChange={(event) => setManualOwner(event.target.value)}
                            placeholder="owner"
                            className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                          />
                        </label>
                        <label className="block">
                          <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            {t("githubWorkspace.repository.repositoryName")}
                          </span>
                          <input
                            value={manualRepo}
                            onChange={(event) => setManualRepo(event.target.value)}
                            placeholder="repository"
                            className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {!repoCandidate?.isGitRepo ? (
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
                            {t("githubWorkspace.repository.initGit")}
                          </Button>
                        ) : null}
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
                            ? t("githubWorkspace.repository.updateRemote")
                            : t("githubWorkspace.repository.setRemote")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={copyRemoteCommands}
                          disabled={!remoteCommands}
                        >
                          <Copy size={15} />
                          {t("githubWorkspace.repository.copyCommands")}
                        </Button>
                        {createRepositoryUrl ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => openGitHubUrl(createRepositoryUrl)}
                          >
                            <ExternalLink size={15} />
                            {t("githubWorkspace.repository.createOnGitHub")}
                          </Button>
                        ) : null}
                      </div>

                      {remoteCommands ? (
                        <pre className="mt-4 overflow-x-auto rounded-xl border border-neutral-900 bg-black/45 p-3 text-xs leading-5 text-neutral-400">
                          {remoteCommands}
                        </pre>
                      ) : null}
                    </article>
                  ) : null}
                </div>

                <aside className="cf-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <GitHubBrandLogo />
                    <StatusPill tone={linkedRepository ? "success" : "neutral"}>
                      {linkedRepository
                        ? t("githubWorkspace.status.linked")
                        : repoCandidate?.detectedFullName
                          ? t("githubWorkspace.status.detected")
                          : t("githubWorkspace.status.notLinked")}
                    </StatusPill>
                  </div>
                  <p className="cf-tech-label mt-5 text-[10px] uppercase text-neutral-600">
                    {t("githubWorkspace.repository.detectedRepository")}
                  </p>
                  <h3 className="mt-2 break-words text-xl font-semibold text-white">
                    {repoCandidate?.linked?.fullName ??
                      repoCandidate?.detectedFullName ??
                      t("githubWorkspace.repository.noRepository")}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">
                    {repoCandidate?.linked
                      ? t("githubWorkspace.repository.linkedDescription")
                      : repoCandidate?.detectedFullName
                        ? t("githubWorkspace.repository.detectedDescription")
                        : t("githubWorkspace.repository.emptyDescription")}
                  </p>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {!repoCandidate?.linked ? (
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
                        {t("githubWorkspace.repository.linkDetected")}
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => loadProjectsAndCandidate(selectedProjectId, true)}
                          disabled={Boolean(action)}
                        >
                          {action === "detect" ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          {t("githubWorkspace.repository.refreshMetadata")}
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
                            <Unlink2 size={15} />
                          )}
                          {t("githubWorkspace.repository.unlink")}
                        </Button>
                      </>
                    )}

                    {(repoCandidate?.linked?.htmlUrl ?? repoCandidate?.detectedHtmlUrl) ? (
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
                        {t("githubWorkspace.common.openRepository")}
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <SmallMeta
                      label={t("githubWorkspace.repository.defaultBranch")}
                      value={repoCandidate?.linked?.defaultBranch ?? t("githubWorkspace.common.unknown")}
                    />
                    <SmallMeta
                      label={t("githubWorkspace.repository.visibility")}
                      value={repoCandidate?.linked?.visibility ?? t("githubWorkspace.status.notLinked")}
                    />
                    <SmallMeta
                      label={t("githubWorkspace.repository.language")}
                      value={repoCandidate?.linked?.language ?? t("githubWorkspace.common.unknown")}
                    />
                    <SmallMeta
                      label={t("githubWorkspace.repository.lastChecked")}
                      value={formatDateTime(repoCandidate?.linked?.lastCheckedAt ?? null, notChecked, dateLocale)}
                    />
                  </div>

                  {!repoCandidate?.linked ? (
                    <div className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("githubWorkspace.repository.manualFallback")}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">
                        {t("githubWorkspace.repository.manualFallbackDescription")}
                      </p>
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
                        {t("githubWorkspace.repository.linkManually")}
                      </Button>
                    </div>
                  ) : null}
                </aside>
              </div>
            </>
          ) : null}

          {activeTab === "issues" ? (
            <>
              {!linkedRepository ? (
                <article className="cf-card p-8 text-center">
                  <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                    <CircleDot size={20} />
                  </span>
                  <h2 className="mt-5 text-xl font-semibold text-white">
                    {t("githubWorkspace.issues.linkRequiredTitle")}
                  </h2>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-500">
                    {t("githubWorkspace.issues.linkRequiredDescription")}
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    className="mt-5"
                    onClick={() => setActiveTab("repository")}
                  >
                    <Link2 size={15} />
                    {t("githubWorkspace.common.openRepository")}
                  </Button>
                </article>
              ) : (
                <>
                  <article className="cf-card p-5">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                          <CircleDot size={18} />
                        </span>
                        <div>
                          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            {linkedRepository.fullName}
                          </p>
                          <h2 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-white">
                            {t("githubWorkspace.issues.title")}
                          </h2>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                            {t("githubWorkspace.issues.description")}
                          </p>
                        </div>
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
                            <RefreshCw size={15} />
                          )}
                          {t("githubWorkspace.issues.refresh")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => openGitHubUrl(`${linkedRepository.htmlUrl}/issues`)}
                        >
                          <ExternalLink size={15} />
                          {t("githubWorkspace.common.openGitHub")}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_minmax(220px,0.42fr)_auto]">
                      <CustomSelect
                        value={issueState}
                        options={[
                          {
                            value: "open",
                            label: t("githubWorkspace.issues.open"),
                            description: t("githubWorkspace.issues.openDescription"),
                            icon: <CircleDot size={15} />,
                          },
                          {
                            value: "closed",
                            label: t("githubWorkspace.issues.closed"),
                            description: t("githubWorkspace.issues.closedDescription"),
                            icon: <CheckCircle2 size={15} />,
                          },
                          {
                            value: "all",
                            label: t("githubWorkspace.issues.all"),
                            description: t("githubWorkspace.issues.allDescription"),
                            icon: <Inbox size={15} />,
                          },
                        ]}
                        onChange={(value) => setIssueState(value as "open" | "closed" | "all")}
                      />
                      <label className="relative block">
                        <Search
                          size={15}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-700"
                        />
                        <input
                          value={issueSearch}
                          onChange={(event) => setIssueSearch(event.target.value)}
                          placeholder={t("githubWorkspace.issues.searchPlaceholder")}
                          className="h-full min-h-11 w-full rounded-xl border border-neutral-800 bg-neutral-950 py-2.5 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                        />
                      </label>
                      <input
                        value={issueLabels}
                        onChange={(event) => setIssueLabels(event.target.value)}
                        placeholder={t("githubWorkspace.issues.labelsPlaceholder")}
                        className="min-h-11 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        onClick={loadGitHubIssues}
                        disabled={Boolean(action)}
                      >
                        <Search size={15} />
                        {t("githubWorkspace.issues.apply")}
                      </Button>
                    </div>
                  </article>

                  {issueMessage ? (
                    <Notice
                      tone={createdIssueTaskPack ? "success" : "neutral"}
                      icon={createdIssueTaskPack ? <CheckCircle2 size={15} /> : <CircleDot size={15} />}
                    >
                      {issueMessage}
                    </Notice>
                  ) : null}

                  {issuesResult?.issues.length ? (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(380px,0.72fr)]">
                      <article className="cf-card overflow-hidden p-0">
                        <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-5 py-4">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {t("githubWorkspace.issues.listTitle")}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                              {t("githubWorkspace.issues.listCount", {
                                count: issuesResult?.total ?? 0,
                              })}
                            </p>
                          </div>
                          <StatusPill tone="neutral">
                            {linkedRepository.fullName}
                          </StatusPill>
                        </div>

                        <div className="max-h-[620px] overflow-y-auto">
                          {issuesResult.issues.map((issue) => {
                            const isSelected = selectedIssue?.number === issue.number;
                            const isOpen = issue.state === "open";

                            return (
                              <button
                                key={issue.number}
                                type="button"
                                onClick={() => setSelectedIssue(issue)}
                                className={[
                                  "group flex w-full items-start gap-3 border-b border-neutral-900 px-5 py-4 text-left transition last:border-b-0",
                                  isSelected
                                    ? "bg-white/[0.055]"
                                    : "bg-black/10 hover:bg-white/[0.03]",
                                ].join(" ")}
                              >
                                <span
                                  className={[
                                    "mt-0.5 shrink-0",
                                    isOpen ? "text-emerald-300" : "text-violet-300",
                                  ].join(" ")}
                                >
                                  {isOpen ? <CircleDot size={18} /> : <CheckCircle2 size={18} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold leading-6 text-white">
                                    {issue.title}
                                  </p>
                                  <p className="mt-1 text-xs leading-5 text-neutral-600">
                                    #{issue.number} · {t("githubWorkspace.issues.updated", {
                                      date: formatDateTime(issue.updatedAt, notChecked, dateLocale),
                                    })} · {issue.author?.login ?? t("githubWorkspace.common.unknown")}
                                  </p>
                                  {issue.labels.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {issue.labels.slice(0, 5).map((label) => (
                                        <span
                                          key={label.name}
                                          className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-500"
                                        >
                                          {label.name}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <span className="mt-0.5 shrink-0 text-[11px] text-neutral-700">
                                  {issue.commentsCount}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </article>

                      <aside className="cf-card p-5">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                          {t("githubWorkspace.issues.previewEyebrow")}
                        </p>

                        {selectedIssue ? (
                          <>
                            <div className="mt-4 flex items-start gap-3">
                              <span
                                className={[
                                  "mt-0.5 shrink-0",
                                  selectedIssue.state === "open"
                                    ? "text-emerald-300"
                                    : "text-violet-300",
                                ].join(" ")}
                              >
                                {selectedIssue.state === "open" ? (
                                  <CircleDot size={20} />
                                ) : (
                                  <CheckCircle2 size={20} />
                                )}
                              </span>
                              <div className="min-w-0">
                                <h3 className="text-xl font-semibold leading-7 text-white">
                                  {selectedIssue.title}
                                </h3>
                                <p className="mt-1 text-sm leading-6 text-neutral-500">
                                  #{selectedIssue.number} · {selectedIssue.author?.login ?? t("githubWorkspace.common.unknown")}
                                </p>
                              </div>
                            </div>

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
                                {t("githubWorkspace.issues.createPackage")}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => openGitHubUrl(selectedIssue.htmlUrl)}
                              >
                                <ExternalLink size={15} />
                                {t("githubWorkspace.issues.openIssue")}
                              </Button>
                            </div>

                            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                              <SmallMeta
                                label={t("githubWorkspace.issues.labels")}
                                value={selectedIssue.labels.map((label) => label.name).join(", ") || t("githubWorkspace.issues.none")}
                              />
                              <SmallMeta
                                label={t("githubWorkspace.issues.suggestedType")}
                                value={inferTaskTypeFromIssue(selectedIssue)}
                              />
                              <SmallMeta
                                label={t("githubWorkspace.issues.comments")}
                                value={String(selectedIssue.commentsCount)}
                              />
                              <SmallMeta
                                label={t("githubWorkspace.issues.created")}
                                value={formatDateTime(selectedIssue.createdAt, notChecked, dateLocale)}
                              />
                            </div>

                            <div className="mt-5 max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-neutral-900 bg-black/45 p-4 text-sm leading-6 text-neutral-400">
                              {selectedIssue.body?.trim() || t("githubWorkspace.issues.noBody")}
                            </div>

                            {createdIssueTaskPack ? (
                              <Notice
                                tone="success"
                                icon={<CheckCircle2 size={15} />}
                                title={t("githubWorkspace.issues.packageReadyTitle", {
                                  id: createdIssueTaskPack.id,
                                })}
                              >
                                {t("githubWorkspace.issues.packageReadyDescription")}
                              </Notice>
                            ) : null}
                          </>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-8 text-center text-sm leading-6 text-neutral-500">
                            {t("githubWorkspace.issues.previewEmpty")}
                          </div>
                        )}
                      </aside>
                    </div>
                  ) : (
                    <article className="cf-card p-10 text-center">
                      <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                        {action === "issues" && issuesResult === null ? (
                          <Loader2 size={19} className="animate-spin" />
                        ) : (
                          <MessageSquareText size={19} />
                        )}
                      </span>
                      <h2 className="mt-5 text-lg font-semibold text-white">
                        {action === "issues" && issuesResult === null
                          ? t("githubWorkspace.common.loading")
                          : t("githubWorkspace.issues.emptyTitle")}
                      </h2>
                      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-500">
                        {t("githubWorkspace.issues.emptyDescription")}
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        <Button
                          type="button"
                          variant="primary"
                          onClick={loadGitHubIssues}
                          disabled={Boolean(action)}
                        >
                          {action === "issues" ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          {t("githubWorkspace.issues.refresh")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            openGitHubUrl(`${linkedRepository.htmlUrl}/issues`)
                          }
                        >
                          <ExternalLink size={15} />
                          {t("githubWorkspace.common.openGitHub")}
                        </Button>
                      </div>
                    </article>
                  )}
                </>
              )}
            </>
          ) : null}

          {activeTab === "security" ? (
            <>
              <article className="cf-card p-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <ShieldCheck size={18} />
                    </span>
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("githubWorkspace.security.eyebrow")}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-white">
                        {t("githubWorkspace.security.title")}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        {t("githubWorkspace.security.description")}
                      </p>
                    </div>
                  </div>
                  <StatusPill tone={connected ? "success" : "neutral"} icon={<LockKeyhole size={13} />}>
                    {connected
                      ? t("githubWorkspace.security.protected")
                      : t("githubWorkspace.status.disconnected")}
                  </StatusPill>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                        <LockKeyhole size={16} />
                      </span>
                      <h3 className="text-base font-semibold text-white">
                        {t("githubWorkspace.security.staysLocal")}
                      </h3>
                    </div>
                    <div className="mt-4 space-y-2">
                      {[
                        t("githubWorkspace.security.local1"),
                        t("githubWorkspace.security.local2"),
                        t("githubWorkspace.security.local3"),
                        t("githubWorkspace.security.local4"),
                      ].map((item) => (
                        <div
                          key={item}
                          className="flex items-start gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs leading-5 text-neutral-500"
                        >
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-neutral-400" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                        <ExternalLink size={16} />
                      </span>
                      <h3 className="text-base font-semibold text-white">
                        {t("githubWorkspace.security.explicitOnly")}
                      </h3>
                    </div>
                    <div className="mt-4 space-y-2">
                      {[
                        t("githubWorkspace.security.external1"),
                        t("githubWorkspace.security.external2"),
                        t("githubWorkspace.security.external3"),
                        t("githubWorkspace.security.external4"),
                      ].map((item) => (
                        <div
                          key={item}
                          className="flex items-start gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs leading-5 text-neutral-500"
                        >
                          <ExternalLink size={14} className="mt-0.5 shrink-0 text-neutral-500" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <article className="cf-card p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <KeyRound size={18} />
                    </span>
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("githubWorkspace.security.credentialsEyebrow")}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold text-white">
                        {t("githubWorkspace.security.credentialsTitle")}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        {t("githubWorkspace.security.credentialsDescription")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <SmallMeta
                      label={t("githubWorkspace.security.account")}
                      value={status?.login ?? t("githubWorkspace.status.disconnected")}
                    />
                    <SmallMeta
                      label={t("githubWorkspace.security.scopes")}
                      value={scopesLabel}
                    />
                    <SmallMeta
                      label={t("githubWorkspace.security.lastChecked")}
                      value={formatDateTime(status?.lastCheckedAt ?? null, notChecked, dateLocale)}
                    />
                  </div>
                </article>

                <aside className="rounded-[1.5rem] border border-red-400/15 bg-red-400/[0.035] p-5">
                  <span className="grid size-10 place-items-center rounded-2xl border border-red-400/20 bg-red-400/[0.055] text-red-200">
                    <Unlink2 size={18} />
                  </span>
                  <h2 className="mt-5 text-lg font-semibold text-white">
                    {t("githubWorkspace.security.disconnectTitle")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">
                    {t("githubWorkspace.security.disconnectDescription")}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-5 w-full border-red-400/20 text-red-200 hover:bg-red-400/[0.06]"
                    onClick={signOutFromGitHub}
                    disabled={!connected || Boolean(action)}
                  >
                    {action === "sign-out" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Unlink2 size={15} />
                    )}
                    {t("githubWorkspace.common.signOut")}
                  </Button>
                </aside>
              </div>

              <article className="cf-card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                    <FileCode2 size={18} />
                  </span>
                  <div>
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      {t("githubWorkspace.security.outputEyebrow")}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      {t("githubWorkspace.security.outputTitle")}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                      {t("githubWorkspace.security.outputDescription")}
                    </p>
                  </div>
                </div>
              </article>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {isLoading ? (
        <Notice icon={<Loader2 size={15} className="animate-spin" />}>
          {t("githubWorkspace.common.loading")}
        </Notice>
      ) : null}
    </section>
  );
}
