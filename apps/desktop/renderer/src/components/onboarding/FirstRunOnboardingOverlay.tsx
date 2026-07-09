import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Code2,
  FolderPlus,
  Github,
  History,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  Rocket,
  Search,
  Settings,
  Sparkles,
  WandSparkles,
  type LucideIcon
} from "lucide-react";

import contextforgeMarkWhite from "../../assets/brand/contextforge-mark-white.png";
import { appMeta } from "../../config/appMeta";
import { Button } from "../ui/Button";

interface FirstRunOnboardingOverlayProps {
  projectsCount: number;
  onStartSetup: () => void;
  onSkip: () => void;
}

type OnboardingStepId = "intro" | "auth" | "tour" | "final";
type TourPreviewType =
  | "dashboard"
  | "projects"
  | "details"
  | "agents"
  | "builder"
  | "review"
  | "archive"
  | "localChanges"
  | "diff"
  | "settings";

type NavKey =
  | "Dashboard"
  | "Projects"
  | "Scanners"
  | "Context Builder"
  | "Task Packs"
  | "Agents"
  | "Templates"
  | "Settings";

interface TourStep {
  id: string;
  kicker: string;
  title: string;
  description: string;
  action: string;
  bullets: string[];
  preview: TourPreviewType;
  activeNav: NavKey;
}

const PHASE_ORDER: OnboardingStepId[] = ["intro", "auth", "tour", "final"];

const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard",
    kicker: "Workspace overview",
    title: "Start from the Dashboard.",
    description:
      "Dashboard shows the whole workspace: projects that need attention, recent Task Packs, quick actions and next priorities.",
    action: "Use it as your command center after opening ContextForge.",
    bullets: ["Check project health", "Jump into common actions", "Find recent generated Task Packs"],
    preview: "dashboard",
    activeNav: "Dashboard"
  },
  {
    id: "projects",
    kicker: "Local projects",
    title: "Add and manage local projects.",
    description:
      "Projects are folders on your computer. ContextForge scans them locally and keeps every workspace separate.",
    action: "Add a folder, rescan it when files change, or open project details.",
    bullets: ["Add local project folders", "Rescan project inventory", "Open Project Details"],
    preview: "projects",
    activeNav: "Projects"
  },
  {
    id: "details",
    kicker: "Project readiness",
    title: "Understand if a project is AI-ready.",
    description:
      "Project Details explains readiness, scripts, docs, tests, AGENTS.md and scanner signals before you ask an agent to work.",
    action: "Review missing pieces and fix the biggest readiness gaps first.",
    bullets: ["Readiness score", "Scanner snapshot", "Recommended improvements"],
    preview: "details",
    activeNav: "Projects"
  },
  {
    id: "agents",
    kicker: "Agents and templates",
    title: "Choose the workflow before writing the prompt.",
    description:
      "Agents describe the target coding tool. Templates describe the task type. Together they shape the Task Pack.",
    action: "Pick Codex, Cursor, Claude Code, Gemini or a generic agent, then choose a matching template.",
    bullets: ["Agent target", "Task template", "Rule profile"],
    preview: "agents",
    activeNav: "Agents"
  },
  {
    id: "builder",
    kicker: "Context Builder",
    title: "Write the real task and build the brief.",
    description:
      "Context Builder is where the user writes the task, reviews recipe/rules/acceptance checks and prepares context.",
    action: "Write the task first, then use presets only when they help the agent understand the work.",
    bullets: ["Task textarea", "Recipe and rules", "Quality score"],
    preview: "builder",
    activeNav: "Context Builder"
  },
  {
    id: "review",
    kicker: "Context review",
    title: "Review which files were selected and why.",
    description:
      "ContextForge does not blindly dump the project. It shows selected files, reasons, snippets and review warnings.",
    action: "Open Context review when the task is complex or selection looks suspicious.",
    bullets: ["Selected files", "Reasons and confidence", "Budget pressure"],
    preview: "review",
    activeNav: "Context Builder"
  },
  {
    id: "archive",
    kicker: "Task Pack archive",
    title: "Keep generated briefs reusable.",
    description:
      "Every generated Task Pack can be stored, opened later, copied, compared and reused for follow-up work.",
    action: "Use the archive when you continue work later or need to reuse a previous brief.",
    bullets: ["Recent Task Packs", "Generated prompt history", "Open or copy past packs"],
    preview: "archive",
    activeNav: "Task Packs"
  },
  {
    id: "localChanges",
    kicker: "Local changes",
    title: "See what is already changed locally.",
    description:
      "Local changes reads the Git working tree on your computer. It is not GitHub and it does not push or commit anything.",
    action: "Use Create from changes when you want an agent to review or continue current work.",
    bullets: ["Branch and changed files", "Staged/unstaged/untracked", "Awareness note for Task Packs"],
    preview: "localChanges",
    activeNav: "Projects"
  },
  {
    id: "diff",
    kicker: "Diff Review Lite",
    title: "Check the size and risk of local changes.",
    description:
      "Diff Review Lite shows metadata only: changed files, added/deleted line counts, risk signals and Task Pack alignment.",
    action: "Use it before asking AI to continue or before exporting context for review.",
    bullets: ["Diff summary", "Review signals", "Task Pack alignment"],
    preview: "diff",
    activeNav: "Projects"
  },
  {
    id: "settings",
    kicker: "Settings and storage",
    title: "Control local AI, safety and storage.",
    description:
      "Settings keeps provider configuration, generation behavior, context safety, language, storage audit and backups in one place.",
    action: "Configure Ollama/providers, safety mode and workspace backups before serious work.",
    bullets: ["AI engine", "Context safety", "SQLite storage and backups"],
    preview: "settings",
    activeNav: "Settings"
  }
];

const SOCIAL_PLACEHOLDERS: Array<{
  icon: "G" | LucideIcon;
  title: string;
  description: string;
}> = [
  {
    icon: "G",
    title: "Continue with Google",
    description: "Planned account option. Not required for local projects."
  },
  {
    icon: Github,
    title: "Continue with GitHub",
    description: "Coming with GitHub issues, PRs and CI workflow integrations."
  }
];

const NAV_ITEMS: Array<{ label: NavKey; icon: LucideIcon }> = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Projects", icon: FolderPlus },
  { label: "Scanners", icon: Search },
  { label: "Context Builder", icon: WandSparkles },
  { label: "Task Packs", icon: Archive },
  { label: "Agents", icon: Bot },
  { label: "Templates", icon: Layers3 },
  { label: "Settings", icon: Settings }
];

const FLOATING_DOTS = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: `${4 + ((index * 17) % 92)}%`,
  top: `${8 + ((index * 29) % 82)}%`,
  delay: 0.08 + index * 0.06,
  size: index % 5 === 0 ? "size-1.5" : index % 3 === 0 ? "size-1" : "size-0.5",
  opacity: index % 4 === 0 ? 0.52 : 0.34
}));

const AMBIENT_ORBS = [
  { id: "top-left", className: "left-[8%] top-[10%] size-[26rem] bg-white/[0.035]", duration: 8.4 },
  { id: "center", className: "left-[42%] top-[18%] size-[32rem] bg-emerald-300/[0.035]", duration: 10.2 },
  { id: "bottom-right", className: "right-[6%] bottom-[2%] size-[30rem] bg-white/[0.026]", duration: 9.1 }
];

function PhaseProgress({ stepId, tourStepIndex }: { stepId: OnboardingStepId; tourStepIndex: number }) {
  const phaseIndex = PHASE_ORDER.indexOf(stepId);
  const overallProgress =
    stepId === "intro"
      ? 1
      : stepId === "auth"
        ? 2
        : stepId === "tour"
          ? 2 + tourStepIndex + 1
          : 13;
  const progressPercent = Math.round((overallProgress / 13) * 100);

  return (
    <div className="flex items-center gap-4">
      <div className="hidden w-36 overflow-hidden rounded-full border border-white/10 bg-white/[0.04] p-0.5 sm:block">
        <motion.div
          className="h-1.5 rounded-full bg-white shadow-[0_0_22px_rgba(255,255,255,0.45)]"
          initial={false}
          animate={{ width: `${progressPercent}%` }}
          transition={{ type: "spring", stiffness: 190, damping: 24 }}
        />
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        {PHASE_ORDER.map((phase, index) => (
          <motion.span
            key={phase}
            layout
            className={`h-1.5 rounded-full ${
              index === phaseIndex ? "w-8 bg-white" : index < phaseIndex ? "w-4 bg-emerald-300/80" : "w-4 bg-white/15"
            }`}
          />
        ))}
      </div>
      <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-neutral-400">
        {overallProgress}/13
      </span>
    </div>
  );
}

function GoogleMark() {
  return (
    <span className="grid size-5 place-items-center rounded-full bg-white text-[13px] font-black text-neutral-950">
      G
    </span>
  );
}

function MiniNavItem({ label, active, icon: Icon }: { label: NavKey; active: boolean; icon: LucideIcon }) {
  return (
    <motion.div
      layout
      className={`relative flex items-center gap-2 overflow-hidden rounded-xl px-2.5 py-2 text-[9px] font-semibold transition ${
        active ? "text-neutral-950" : "bg-white/[0.025] text-neutral-500"
      }`}
    >
      {active && (
        <motion.span
          layoutId="onboarding-mini-active-nav"
          className="absolute inset-0 rounded-xl bg-white shadow-[0_10px_28px_rgba(255,255,255,0.14)]"
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
        />
      )}
      <Icon size={12} className="relative z-10" />
      <span className="relative z-10 truncate">{label}</span>
    </motion.div>
  );
}

function MiniMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <motion.div layout className="rounded-2xl border border-white/[0.075] bg-black/35 p-3">
      <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-neutral-600">{label}</p>
      <p
        className={`mt-1 text-base font-semibold ${
          tone === "good" ? "text-emerald-200" : tone === "warn" ? "text-amber-200" : "text-white"
        }`}
      >
        {value}
      </p>
    </motion.div>
  );
}

function MiniHeader({ title, action }: { title: string; action: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.075] bg-white/[0.025] px-4 py-3">
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-neutral-600">ContextForge</p>
        <h4 className="mt-1 text-sm font-semibold text-white">{title}</h4>
      </div>
      <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-semibold text-neutral-950">{action}</span>
    </div>
  );
}

function MiniFileRow({ path, tag, active }: { path: string; tag: string; active?: boolean }) {
  return (
    <motion.div
      layout
      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[10px] ${
        active ? "border-white/20 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "border-white/[0.075] bg-black/30"
      }`}
    >
      <span className="truncate text-neutral-300">{path}</span>
      <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {tag}
      </span>
    </motion.div>
  );
}

function MiniPreviewContent({ step }: { step: TourStep }) {
  switch (step.preview) {
    case "dashboard":
      return (
        <div className="space-y-3">
          <MiniHeader title="Workspace overview" action="Add project" />
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric label="Projects" value="5" />
            <MiniMetric label="Readiness" value="61/100" />
            <MiniMetric label="Task Packs" value="30" tone="good" />
          </div>
          <div className="rounded-2xl border border-white/[0.075] bg-black/35 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-white">Projects needing attention</span>
              <span className="text-[9px] text-neutral-500">View all</span>
            </div>
            {[
              ["practice-electron-ui", "46/100"],
              ["license-monitor", "66/100"],
              ["contextforge-website", "73/100"]
            ].map(([name, score], index) => (
              <motion.div
                key={name}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.04 }}
                className="mb-2 flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2"
              >
                <span className="truncate text-[10px] font-semibold text-neutral-300">{name}</span>
                <span className="text-[10px] font-semibold text-white">{score}</span>
              </motion.div>
            ))}
          </div>
        </div>
      );

    case "projects":
      return (
        <div className="space-y-3">
          <MiniHeader title="Projects" action="Project details" />
          {[
            ["license-monitor", "React · Electron · SQLite", "66/100"],
            ["roi-calculator", "React · Vite", "55/100"],
            ["metall-perm", "Next · Tailwind", "66/100"]
          ].map(([name, stack, score], index) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="rounded-2xl border border-white/[0.075] bg-black/35 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-white">{name}</span>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] text-neutral-400">{score}</span>
              </div>
              <p className="mt-1 text-[9px] text-neutral-600">{stack}</p>
            </motion.div>
          ))}
        </div>
      );

    case "details":
      return (
        <div className="space-y-3">
          <MiniHeader title="Project details" action="Create Task Pack" />
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric label="Readiness" value="66" />
            <MiniMetric label="Checks" value="6/10" />
            <MiniMetric label="Issues" value="3" tone="warn" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {["README", "AI instructions", "Build command", "Dev command", "Tests", "Environment"].map((item, index) => (
              <div
                key={item}
                className="rounded-xl border border-white/[0.075] bg-black/30 px-3 py-2 text-[10px] text-neutral-300"
              >
                <span className={index < 4 ? "text-emerald-200" : "text-neutral-600"}>●</span> {item}
              </div>
            ))}
          </div>
        </div>
      );

    case "agents":
      return (
        <div className="space-y-3">
          <MiniHeader title="Agents & Templates" action="Use preset" />
          <div className="grid grid-cols-2 gap-2">
            {["Codex", "Cursor", "Claude Code", "Gemini"].map((agent, index) => (
              <div
                key={agent}
                className={`rounded-2xl border p-3 ${index === 0 ? "border-white/70 bg-white text-neutral-950" : "border-white/[0.075] bg-black/35 text-white"}`}
              >
                <p className="text-[11px] font-semibold">{agent}</p>
                <p className={`mt-1 text-[9px] ${index === 0 ? "text-neutral-500" : "text-neutral-600"}`}>target agent</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-[10px] text-emerald-100">
            UI/UX redesign template · safe frontend rules · visual verification
          </div>
        </div>
      );

    case "builder":
      return (
        <div className="space-y-3">
          <MiniHeader title="Context Builder" action="Generate Task Pack" />
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="rounded-2xl border border-white/[0.075] bg-black/35 p-3">
              <div className="mb-2 flex gap-1.5">
                {[
                  "Task",
                  "Recipe",
                  "Rules",
                  "Context"
                ].map((tab, index) => (
                  <span
                    key={tab}
                    className={`rounded-full px-2 py-1 text-[8px] font-semibold ${index === 0 ? "bg-white text-neutral-950" : "bg-white/[0.04] text-neutral-500"}`}
                  >
                    {tab}
                  </span>
                ))}
              </div>
              <div className="h-24 rounded-xl border border-white/[0.075] bg-black/55 p-3 text-[10px] leading-5 text-neutral-300">
                Improve the selected page UI without changing backend behavior...
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-center">
              <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Quality</p>
              <p className="mt-3 text-3xl font-semibold text-emerald-100">88</p>
              <p className="mt-1 text-[9px] text-emerald-200/70">Strong</p>
            </div>
          </div>
        </div>
      );

    case "review":
      return (
        <div className="space-y-3">
          <MiniHeader title="Context review" action="Review files" />
          <div className="grid grid-cols-4 gap-2">
            <MiniMetric label="Files" value="3" />
            <MiniMetric label="Edit" value="2" />
            <MiniMetric label="Inspect" value="1" />
            <MiniMetric label="Budget" value="48%" tone="good" />
          </div>
          <MiniFileRow path="client/src/pages/Imports.tsx" tag="edit" active />
          <MiniFileRow path="client/src/components/Dropdown.tsx" tag="edit" />
          <MiniFileRow path="client/src/components/ViewerNotice.tsx" tag="inspect" />
        </div>
      );

    case "archive":
      return (
        <div className="space-y-3">
          <MiniHeader title="Task Packs" action="Open archive" />
          {["UI polish for imports page", "Backend validation update", "Review current local changes"].map((title, index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-2xl border border-white/[0.075] bg-black/35 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-[11px] font-semibold text-white">{title}</span>
                <History size={13} className="text-neutral-500" />
              </div>
              <p className="mt-1 text-[9px] text-neutral-600">generated Task Pack · local history</p>
            </motion.div>
          ))}
        </div>
      );

    case "localChanges":
      return (
        <div className="space-y-3">
          <MiniHeader title="Local changes" action="Create from changes" />
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric label="Staged" value="0" />
            <MiniMetric label="Unstaged" value="10" tone="warn" />
            <MiniMetric label="Untracked" value="1" tone="warn" />
          </div>
          <MiniFileRow path="client/src/api.ts" tag="modified" active />
          <MiniFileRow path="client/src/pages/Dictionaries.tsx" tag="modified" />
          <MiniFileRow path="AGENTS.md" tag="new" />
        </div>
      );

    case "diff":
      return (
        <div className="space-y-3">
          <MiniHeader title="Diff Review Lite" action="Review changes" />
          <div className="grid grid-cols-4 gap-2">
            <MiniMetric label="Files" value="11" />
            <MiniMetric label="Added" value="+2973" tone="good" />
            <MiniMetric label="Deleted" value="-1744" tone="warn" />
            <MiniMetric label="Binary" value="0" />
          </div>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.075] bg-black/35 p-3">
            {['Large diff', 'Core/API touched', 'No tests changed'].map((signal) => (
              <span key={signal} className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[9px] font-semibold text-amber-100">
                {signal}
              </span>
            ))}
          </div>
        </div>
      );

    case "settings":
      return (
        <div className="space-y-3">
          <MiniHeader title="Settings" action="Saved" />
          <div className="grid grid-cols-2 gap-2">
            {[
              ["AI Engine", "Ollama / providers"],
              ["Composer", "safety and limits"],
              ["Interface", "language and density"],
              ["Storage", "SQLite and backup"]
            ].map(([title, text], index) => (
              <div
                key={title}
                className={`rounded-2xl border p-3 ${index === 3 ? "border-emerald-300/25 bg-emerald-300/10" : "border-white/[0.075] bg-black/35"}`}
              >
                <p className="text-[11px] font-semibold text-white">{title}</p>
                <p className="mt-1 text-[9px] text-neutral-600">{text}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-white/[0.075] bg-black/35 p-3">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-neutral-500">Schema</span>
              <span className="text-emerald-200">v2 / ready</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]"><div className="h-full w-4/5 rounded-full bg-emerald-300/80" /></div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

function OnboardingMiniPreview({ step }: { step: TourStep }) {
  return (
    <motion.div
      layout
      className="pointer-events-none relative overflow-hidden rounded-[1.65rem] border border-white/[0.075] bg-neutral-950/90 p-3 shadow-[0_30px_90px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(circle_at_68%_10%,rgba(255,255,255,0.10),transparent_18rem)]"
        animate={{ opacity: [0.7, 1, 0.72] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-20 top-10 size-56 rounded-full bg-emerald-300/[0.055] blur-3xl"
        animate={{ x: [0, -12, 0], y: [0, 10, 0], opacity: [0.45, 0.75, 0.45] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative flex h-[430px] overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-black/45">
        <aside className="relative w-[134px] shrink-0 border-r border-white/[0.06] bg-black/35 p-3">
          <div className="mb-4 flex items-center gap-2">
            <img src={contextforgeMarkWhite} alt="" draggable={false} className="size-6 object-contain" />
            <span className="truncate text-[10px] font-semibold text-white">ContextForge</span>
          </div>
          <div className="space-y-1.5">
            {NAV_ITEMS.map((item) => (
              <MiniNavItem key={item.label} {...item} active={item.label === step.activeNav} />
            ))}
          </div>
          <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-2 text-[8px] leading-4 text-neutral-600">
            <span className="block font-semibold text-neutral-500">MVP status</span>
            v{appMeta.version}
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2">
            <span className="truncate text-[10px] font-semibold text-neutral-300">ContextForge › {step.activeNav}</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-8 rounded-full bg-white" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 14, scale: 0.982, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, scale: 0.99, filter: "blur(4px)" }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              <MiniPreviewContent step={step} />
            </motion.div>
          </AnimatePresence>

        </main>
      </div>
    </motion.div>
  );
}


function IntroPipelineStep({ icon: Icon, title, text, index }: { icon: LucideIcon; title: string; text: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 + index * 0.055, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="group relative overflow-hidden rounded-2xl border border-white/[0.075] bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
    >
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.08),transparent_12rem)]" />
      <div className="relative flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.035] text-neutral-300">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-neutral-500">{text}</p>
        </div>
      </div>
    </motion.div>
  );
}

function IntroHeroPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.08, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-[2rem] border border-white/[0.08] bg-neutral-950/85 p-4 shadow-[0_34px_120px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.055)]"
    >
      <motion.div
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-emerald-300/[0.065] blur-3xl"
        animate={{ opacity: [0.42, 0.78, 0.42], x: [0, -10, 0], y: [0, 12, 0] }}
        transition={{ duration: 6.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute left-8 top-10 h-px w-28 bg-gradient-to-r from-transparent via-white/40 to-transparent"
        animate={{ x: [-80, 360], opacity: [0, 0.72, 0] }}
        transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative rounded-[1.5rem] border border-white/[0.07] bg-black/45 p-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2">
          <div className="flex items-center gap-2">
            <img src={contextforgeMarkWhite} alt="" draggable={false} className="size-6 object-contain" />
            <span className="text-[11px] font-semibold text-white">ContextForge</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-7 rounded-full bg-white" />
            <span className="size-1.5 rounded-full bg-white/15" />
            <span className="size-1.5 rounded-full bg-white/15" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[112px_1fr] gap-4">
          <div className="rounded-2xl border border-white/[0.055] bg-black/40 p-3">
            {[
              ["Dashboard", true],
              ["Projects", false],
              ["Context Builder", false],
              ["Task Packs", false],
              ["Settings", false]
            ].map(([label, active]) => (
              <div
                key={String(label)}
                className={`mb-1.5 rounded-xl px-2.5 py-2 text-[9px] font-semibold ${active ? "bg-white text-neutral-950" : "bg-white/[0.025] text-neutral-600"}`}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-neutral-600">AI-ready workspace</p>
                  <h3 className="mt-2 max-w-[180px] text-2xl font-semibold leading-[0.98] tracking-[-0.065em] text-white">
                    Prepare context before the agent touches code.
                  </h3>
                </div>
                <motion.div
                  className="grid size-20 shrink-0 place-items-center rounded-3xl border border-emerald-300/20 bg-emerald-300/10 text-2xl font-semibold text-white shadow-[0_18px_50px_rgba(16,185,129,0.12)]"
                  animate={{ scale: [1, 1.035, 1], boxShadow: ["0 18px 50px rgba(16,185,129,0.12)", "0 22px 64px rgba(16,185,129,0.2)", "0 18px 50px rgba(16,185,129,0.12)"] }}
                  transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
                >
                  82
                </motion.div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {["Scan", "Review", "Task Pack"].map((item, index) => (
                <motion.div
                  key={item}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + index * 0.06, duration: 0.26 }}
                  className="rounded-2xl border border-white/[0.06] bg-black/35 p-3"
                >
                  <p className="text-[10px] font-semibold text-white">{item}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.055]">
                    <motion.div
                      className="h-full rounded-full bg-white"
                      initial={{ width: "18%" }}
                      animate={{ width: index === 0 ? "78%" : index === 1 ? "56%" : "66%" }}
                      transition={{ delay: 0.25 + index * 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-black/45 p-3 font-mono text-[9px] leading-5 text-neutral-500">
              <p><span className="text-emerald-300">ok</span> project inventory collected</p>
              <p><span className="text-emerald-300">ok</span> real files selected</p>
              <p><span className="text-white">task-pack.md</span> ready for agent</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function TourStepScreen({
  step,
  index,
  onBack,
  onNext,
  onSkip
}: {
  step: TourStep;
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <motion.div
      key={`tour-${step.id}`}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto grid w-full max-w-[1160px] items-center gap-8 rounded-[2rem] border border-white/[0.075] bg-neutral-950/72 p-7 shadow-[0_34px_120px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.055)] backdrop-blur-sm lg:grid-cols-[0.82fr_1.18fr] lg:p-8"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold text-emerald-100">
            Step {index + 1} / {TOUR_STEPS.length}
          </span>
          <span className="cf-badge">{step.kicker}</span>
        </div>

        <h2 className="mt-5 max-w-[520px] text-5xl font-semibold leading-[0.98] tracking-[-0.075em] text-white">
          {step.title}
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-neutral-400">{step.description}</p>

        <div className="mt-7 rounded-3xl border border-white/[0.075] bg-black/35 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-600">What you do here</p>
          <p className="mt-2 text-sm leading-6 text-neutral-300">{step.action}</p>
          <div className="mt-4 grid gap-2">
            {step.bullets.map((bullet, bulletIndex) => (
              <motion.div
                key={bullet}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + bulletIndex * 0.04, duration: 0.22 }}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-sm text-neutral-400"
              >
                <CheckCircle2 size={15} className="shrink-0 text-emerald-200" />
                {bullet}
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-7 flex flex-wrap justify-between gap-3">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onSkip}>Skip learning</Button>
            <Button variant="primary" onClick={onNext}>
              {index === TOUR_STEPS.length - 1 ? "Final welcome" : "Next module"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </div>

      <OnboardingMiniPreview step={step} />
    </motion.div>
  );
}

export function FirstRunOnboardingOverlay({
  projectsCount,
  onStartSetup,
  onSkip
}: FirstRunOnboardingOverlayProps) {
  const [stepId, setStepId] = useState<OnboardingStepId>("intro");
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [isLaunchingDashboard, setIsLaunchingDashboard] = useState(false);
  const activeTourStep = TOUR_STEPS[tourStepIndex];
  const safeProjectsCount = Number.isFinite(projectsCount) ? projectsCount : 0;

  const workspaceCaption = useMemo(() => {
    if (safeProjectsCount <= 0) {
      return "No projects yet. You can add your first local project from Dashboard.";
    }

    return `${safeProjectsCount} local project${safeProjectsCount === 1 ? "" : "s"} already detected. You can continue from Dashboard.`;
  }, [safeProjectsCount]);

  const goNextPhase = () => {
    const phaseIndex = PHASE_ORDER.indexOf(stepId);
    const nextStep = PHASE_ORDER[Math.min(PHASE_ORDER.length - 1, phaseIndex + 1)];
    setStepId(nextStep);
  };

  const goBackPhase = () => {
    const phaseIndex = PHASE_ORDER.indexOf(stepId);
    const prevStep = PHASE_ORDER[Math.max(0, phaseIndex - 1)];
    setStepId(prevStep);
  };

  const goNextTourStep = () => {
    if (tourStepIndex >= TOUR_STEPS.length - 1) {
      setStepId("final");
      return;
    }

    setTourStepIndex((current) => current + 1);
  };

  const goBackFromTour = () => {
    if (tourStepIndex <= 0) {
      setStepId("auth");
      return;
    }

    setTourStepIndex((current) => current - 1);
  };

  const skipToFinal = () => setStepId("final");

  const launchDashboard = () => {
    setIsLaunchingDashboard(true);
    window.setTimeout(() => {
      onStartSetup();
    }, 520);
  };

  return (
    <motion.div
      key="contextforge-first-run-onboarding"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[85] overflow-auto bg-black text-neutral-100"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:44px_44px] opacity-45" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(255,255,255,0.13),transparent_34rem)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-white/[0.035] to-transparent" />
      {AMBIENT_ORBS.map((orb) => (
        <motion.div
          key={orb.id}
          className={`pointer-events-none absolute rounded-full blur-3xl ${orb.className}`}
          animate={{ x: [0, 18, -10, 0], y: [0, -14, 16, 0], opacity: [0.65, 0.95, 0.72, 0.65] }}
          transition={{ duration: orb.duration, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      <div className="pointer-events-none absolute inset-0">
        {FLOATING_DOTS.map((dot) => (
          <motion.span
            key={dot.id}
            className={`absolute rounded-full bg-white/50 shadow-[0_0_18px_rgba(255,255,255,0.72)] ${dot.size}`}
            style={{ left: dot.left, top: dot.top }}
            initial={{ opacity: 0, y: 10, scale: 0.7 }}
            animate={{ opacity: [0, dot.opacity, 0], y: [10, -24], scale: [0.65, 1.08, 0.72] }}
            transition={{ delay: dot.delay, duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
      </div>

      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        className="relative mx-auto flex min-h-full w-full flex-col overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.006)_42%,rgba(255,255,255,0))]" />

        <div className="relative flex min-h-screen flex-1 flex-col">
          <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-4 px-6 py-5 lg:px-8">
            <div className="flex items-center gap-3">
              <motion.div
                className="grid size-10 place-items-center rounded-2xl border border-white/10 bg-black/55 shadow-[0_16px_44px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.06)]"
                animate={{ y: [0, -1.5, 0], opacity: [0.92, 1, 0.92] }}
                transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
              >
                <img
                  src={contextforgeMarkWhite}
                  alt="ContextForge"
                  draggable={false}
                  className="size-7 object-contain"
                />
              </motion.div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-[-0.045em] text-white">ContextForge</p>
                <p className="mt-0.5 hidden text-[11px] font-medium text-neutral-600 sm:block">First-run guide · local AI workflow</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <PhaseProgress stepId={stepId} tourStepIndex={tourStepIndex} />
              <button
                type="button"
                onClick={stepId === "final" ? launchDashboard : skipToFinal}
                disabled={isLaunchingDashboard}
                className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs font-semibold text-neutral-400 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-70"
              >
                {stepId === "final" ? (isLaunchingDashboard ? "Opening..." : "Enter Dashboard") : "Skip to welcome"}
              </button>
            </div>
          </header>

          <div className="mx-auto grid min-h-[calc(100vh-92px)] w-full max-w-[1240px] flex-1 place-items-center px-6 py-8 lg:px-8 lg:py-10">
            {stepId === "final" ? (
              <div className="grid min-h-[560px] place-items-center text-center">
                  <div className="w-[min(620px,100%)]">
                    <motion.div
                      initial={{ scale: 0.82, opacity: 0, rotate: -5 }}
                      animate={{ scale: 1, opacity: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 420, damping: 24 }}
                      className="mx-auto grid size-20 place-items-center rounded-[1.55rem] border border-white/10 bg-black/55 shadow-[0_18px_54px_rgba(255,255,255,0.10),inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                      <img
                        src={contextforgeMarkWhite}
                        alt="ContextForge"
                        draggable={false}
                        className="size-12 object-contain"
                      />
                    </motion.div>

                    <p className="mt-7 text-xs font-semibold uppercase tracking-[0.32em] text-neutral-600">
                      Workspace ready
                    </p>
                    <h2 className="mt-3 text-5xl font-semibold leading-[0.98] tracking-[-0.075em] text-white">
                      Welcome to ContextForge.
                    </h2>
                    <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-neutral-400">
                      {workspaceCaption} Open Dashboard to start scanning projects, building Task Packs and reviewing local changes.
                    </p>

                    <div className="mx-auto mt-7 grid max-w-lg gap-3 sm:grid-cols-3">
                      {[
                        ["Projects", safeProjectsCount.toString()],
                        ["Mode", "Local-first"],
                        ["Auth", "Optional"]
                      ].map(([label, value]) => (
                        <motion.div
                          key={label}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: label === "Projects" ? 0.06 : label === "Mode" ? 0.12 : 0.18, duration: 0.24 }}
                          className="rounded-2xl border border-white/[0.075] bg-black/35 p-4"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-600">{label}</p>
                          <p className="mt-2 text-sm font-semibold text-white">{value}</p>
                        </motion.div>
                      ))}
                    </div>

                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      <Button variant="secondary" onClick={() => setStepId("tour")}>
                        <ArrowLeft size={16} />
                        Back
                      </Button>
                      <Button variant="primary" onClick={launchDashboard} disabled={isLaunchingDashboard}>
                        {isLaunchingDashboard ? <Rocket size={16} /> : <Code2 size={16} />}
                        {isLaunchingDashboard ? "Opening Dashboard..." : "Enter Dashboard"}
                      </Button>
                    </div>

                    <AnimatePresence>
                      {isLaunchingDashboard && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="mx-auto mt-5 max-w-sm overflow-hidden rounded-full border border-white/10 bg-white/[0.04] p-1"
                        >
                          <motion.div
                            className="h-1.5 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.55)]"
                            initial={{ width: "12%" }}
                            animate={{ width: "100%" }}
                            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button
                      type="button"
                      onClick={onSkip}
                      className="mt-4 text-xs font-semibold text-neutral-600 transition hover:text-neutral-300"
                    >
                      Close for this session
                    </button>
                  </div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
              {stepId === "intro" && (
                <motion.div
                  key="intro-step"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="grid min-h-[640px] w-full items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]"
                >
                  <div className="relative">
                    <motion.div
                      className="absolute -left-16 -top-16 size-48 rounded-full bg-white/[0.025] blur-3xl"
                      animate={{ opacity: [0.35, 0.72, 0.35], scale: [0.96, 1.04, 0.96] }}
                      transition={{ duration: 6.4, repeat: Infinity, ease: "easeInOut" }}
                    />

                    <div className="relative flex flex-wrap gap-2">
                      <span className="cf-badge">
                        <Sparkles size={12} />
                        Local-first AI workflow
                      </span>
                      <span className="cf-badge">Desktop control center</span>
                    </div>

                    <h1 className="relative mt-5 max-w-[640px] text-6xl font-semibold leading-[0.9] tracking-[-0.085em] text-white md:text-7xl">
                      Give every coding agent the right context.
                    </h1>
                    <p className="relative mt-6 max-w-xl text-base leading-8 text-neutral-400">
                      ContextForge scans your local project, explains readiness, prepares safe Task Packs and keeps your files on this device.
                    </p>

                    <div className="relative mt-8 grid gap-3 sm:grid-cols-2">
                      <IntroPipelineStep
                        icon={Search}
                        title="Scan locally"
                        text="Read scripts, docs and project signals without uploading source files."
                        index={0}
                      />
                      <IntroPipelineStep
                        icon={WandSparkles}
                        title="Build the brief"
                        text="Turn a real task into a focused prompt for Codex, Cursor or Claude Code."
                        index={1}
                      />
                    </div>

                    <div className="relative mt-8 flex flex-wrap items-center gap-3">
                      <Button variant="primary" onClick={goNextPhase}>
                        Continue
                        <ArrowRight size={16} />
                      </Button>
                      <Button variant="secondary" onClick={skipToFinal}>
                        Skip tour
                      </Button>
                      <span className="text-xs font-medium text-neutral-600">
                        Sign-in stays optional during the alpha flow.
                      </span>
                    </div>
                  </div>

                  <IntroHeroPreview />
                </motion.div>
              )}

              {stepId === "auth" && (
                <motion.div
                  key="auth-step"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="grid min-h-[560px] place-items-center"
                >
                  <div className="w-[min(540px,100%)] overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950/95 p-7 shadow-[0_24px_90px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.07)]">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={contextforgeMarkWhite}
                          alt="ContextForge"
                          draggable={false}
                          className="size-9 object-contain"
                        />
                        <span className="text-lg font-semibold tracking-[-0.045em] text-white">ContextForge</span>
                      </div>
                      <span className="cf-badge">Account placeholder</span>
                    </div>

                    <h2 className="mt-7 text-4xl font-semibold tracking-[-0.07em] text-white">
                      Sign in to ContextForge.
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-neutral-500">
                      Accounts are planned for licenses, team profiles and future GitHub sync. Local projects work without sign-in today.
                    </p>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {SOCIAL_PLACEHOLDERS.map((item) => {
                        const Icon = item.icon;

                        return (
                          <button
                            key={item.title}
                            type="button"
                            className="group rounded-2xl border border-white/[0.075] bg-black/45 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.055] hover:shadow-[0_14px_42px_rgba(255,255,255,0.05)]"
                          >
                            <div className="flex items-center gap-3">
                              <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-neutral-200 transition group-hover:border-white/20 group-hover:bg-white/[0.08]">
                                {typeof Icon === "string" ? <GoogleMark /> : <Icon size={17} />}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-white">{item.title}</span>
                                <span className="mt-0.5 block text-[11px] text-neutral-600">Soon · placeholder</span>
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-700">
                      <span className="h-px flex-1 bg-white/[0.075]" />
                      Or use email later
                      <span className="h-px flex-1 bg-white/[0.075]" />
                    </div>

                    <label className="block text-xs font-semibold text-neutral-500">Work email</label>
                    <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/[0.075] bg-black/45 px-4 py-3 text-neutral-600">
                      <Mail size={16} />
                      <span>you@company.dev</span>
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4">
                      <div className="flex items-start gap-3">
                        <LockKeyhole size={17} className="mt-0.5 shrink-0 text-neutral-400" />
                        <p className="text-sm leading-6 text-neutral-500">
                          No data is submitted yet. These controls are visual placeholders for future auth.
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap justify-between gap-3">
                      <Button variant="secondary" onClick={goBackPhase}>
                        <ArrowLeft size={16} />
                        Back
                      </Button>
                      <Button variant="primary" onClick={goNextPhase}>
                        Continue without sign-in
                        <ArrowRight size={16} />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}

              {stepId === "tour" && activeTourStep && (
                <TourStepScreen
                  step={activeTourStep}
                  index={tourStepIndex}
                  onBack={goBackFromTour}
                  onNext={goNextTourStep}
                  onSkip={skipToFinal}
                />
              )}

              </AnimatePresence>
            )}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
