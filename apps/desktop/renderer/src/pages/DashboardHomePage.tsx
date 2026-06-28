import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  FolderOpen,
  Gauge,
  Lock,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Zap
} from "lucide-react";

import { Button } from "../components/ui/Button";
import { appMeta } from "../config/appMeta";

interface DashboardHomePageProps {
  projectsCount: number;
  taskPacksCount: number;
  readinessScore: number | null;
  statusMessage: string;
  isLoading: boolean;
  onAddProject: () => void;
  onOpenProjects: () => void;
  onOpenContextBuilder: () => void;
  onOpenTaskPacks: () => void;
  onOpenSettings: () => void;
}

const CARD_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1]
} as const;

const workflowSteps = [
  {
    id: "01",
    title: "Add project",
    description: "Scan local files, scripts, stack and project signals."
  },
  {
    id: "02",
    title: "Build context",
    description: "Generate AGENTS.md and prepare project conventions."
  },
  {
    id: "03",
    title: "Compose task",
    description: "Review selected files in Context Composer."
  },
  {
    id: "04",
    title: "Send to AI",
    description: "Use the final Task Pack in your coding agent."
  }
];

function getReadinessLabel(score: number | null) {
  if (score === null) {
    return "Not scanned";
  }

  if (score >= 80) {
    return "Agent-ready";
  }

  if (score >= 50) {
    return "Almost ready";
  }

  return "Needs context";
}

function getReadinessCaption(score: number | null) {
  if (score === null) {
    return "Add a project to start collecting readiness signals.";
  }

  if (score >= 80) {
    return "Your workspace has strong context for AI-assisted coding.";
  }

  if (score >= 50) {
    return "Generate AGENTS.md and improve project signals.";
  }

  return "Open Context Builder to improve missing project context.";
}

function MiniMetric({
  label,
  value,
  caption
}: {
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
      <p className="cf-tech-label text-[10px] uppercase text-neutral-700">
        {label}
      </p>

      <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">
        {value}
      </p>

      <p className="mt-0.5 truncate text-xs text-neutral-600">
        {caption}
      </p>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
  primary = false
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={CARD_TRANSITION}
      className={[
        "group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border p-4 text-left transition",
        primary
          ? "border-white/15 bg-white/[0.06] hover:border-white hover:bg-white hover:text-black"
          : "border-neutral-900 bg-black/35 hover:border-white hover:bg-white hover:text-black"
      ].join(" ")}
    >
      <span className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
        <span className="absolute inset-y-0 -left-10 w-12 rotate-12 bg-white/40 blur-xl transition duration-700 group-hover:left-[115%]" />
      </span>

      <span
        className={[
          "relative z-10 grid size-10 shrink-0 place-items-center rounded-2xl border transition",
          primary
            ? "border-white/15 bg-black/35 text-white group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-300 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
        ].join(" ")}
      >
        {icon}
      </span>

      <span className="relative z-10 min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white transition group-hover:text-black">
          {title}
        </span>

        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-neutral-600 transition group-hover:text-black/55">
          {description}
        </span>
      </span>

      <ArrowRight
        size={14}
        className="relative z-10 shrink-0 text-neutral-700 transition group-hover:translate-x-0.5 group-hover:text-black"
      />
    </motion.button>
  );
}

function WorkflowStep({
  step,
  active
}: {
  step: {
    id: string;
    title: string;
    description: string;
  };
  active: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={CARD_TRANSITION}
      className={[
        "relative min-h-[126px] rounded-2xl border p-4 transition",
        active
          ? "border-white/20 bg-white/[0.06] shadow-[0_18px_44px_rgba(255,255,255,0.035)]"
          : "border-neutral-900 bg-black/30"
      ].join(" ")}
    >
      <div className="mb-3 flex items-center gap-3">
        <span
          className={[
            "cf-tech-label grid size-7 place-items-center rounded-full border text-[10px]",
            active
              ? "border-white bg-white text-black"
              : "border-neutral-800 bg-neutral-950 text-neutral-500"
          ].join(" ")}
        >
          {step.id}
        </span>

        <p className="truncate text-sm font-semibold text-white">
          {step.title}
        </p>
      </div>

      <p className="text-xs leading-5 text-neutral-500">
        {step.description}
      </p>

      {active && (
        <motion.span
          layoutId="dashboard-active-workflow-step"
          className="absolute right-3 top-3 size-2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.75)]"
        />
      )}
    </motion.div>
  );
}

function PrincipleCard({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <motion.article
      whileHover={{ y: -2 }}
      transition={CARD_TRANSITION}
      className="rounded-2xl border border-neutral-900 bg-black/30 p-4"
    >
      <div className="mb-3 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
        {icon}
      </div>

      <h3 className="text-sm font-semibold text-white">
        {title}
      </h3>

      <p className="mt-2 text-xs leading-5 text-neutral-500">
        {description}
      </p>
    </motion.article>
  );
}

export function DashboardHomePage({
  projectsCount,
  taskPacksCount,
  readinessScore,
  statusMessage,
  isLoading,
  onAddProject,
  onOpenProjects,
  onOpenContextBuilder,
  onOpenTaskPacks,
  onOpenSettings
}: DashboardHomePageProps) {
  const hasProjects = projectsCount > 0;
  const primaryAction = hasProjects ? onOpenContextBuilder : onAddProject;
  const activeWorkflowIndex = hasProjects ? 1 : 0;

  const readinessValue = readinessScore === null ? "—" : `${readinessScore}/100`;

  const nextTitle = hasProjects
    ? "Continue building project context"
    : "Start with your first local repository";

  const nextDescription = hasProjects
    ? "Open Context Builder, choose a project, review readiness signals, and generate AGENTS.md before creating your next Task Pack."
    : "Add a repository folder. ContextForge will scan it and unlock context building, Composer review, and Task Pack generation.";

  return (
    <section className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={CARD_TRANSITION}
          className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.09),transparent_30rem),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_54%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]"
        >
          <div className="pointer-events-none absolute -right-32 -top-32 size-80 rounded-full bg-white/[0.035] blur-3xl" />

          <div className="relative">
            <div className="mb-5 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Sparkles size={13} />
                {appMeta.phase}
              </span>
              <span className="cf-badge">Local-first</span>
              <span className="cf-badge">Composer v2 ready</span>
            </div>

            <h1 className="max-w-5xl text-[44px] font-semibold leading-[0.98] tracking-[-0.065em] text-white">
              Build AI-ready context before your agent edits code.
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-neutral-400">
              ContextForge scans local projects, validates real files, and turns
              development requests into structured Task Packs for Codex, Claude,
              Cursor, and other coding agents.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                variant="primary"
                onClick={primaryAction}
                disabled={isLoading}
              >
                {hasProjects ? <WandSparkles size={15} /> : <FolderOpen size={15} />}
                {hasProjects ? "Build context" : "Add first project"}
              </Button>

              <Button variant="secondary" onClick={onOpenProjects}>
                <FolderOpen size={15} />
                Projects
              </Button>

              <Button variant="ghost" onClick={onOpenSettings}>
                <Settings2 size={15} />
                Settings
              </Button>
            </div>
          </div>
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...CARD_TRANSITION, delay: 0.04 }}
          className="rounded-[2rem] border border-neutral-900 bg-black/40 p-5"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Workspace status
              </p>

              <h3 className="mt-2 text-base font-semibold text-white">
                {getReadinessLabel(readinessScore)}
              </h3>

              <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-600">
                {getReadinessCaption(readinessScore)}
              </p>
            </div>

            <div className="grid size-10 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <Gauge size={18} />
            </div>
          </div>

          <div className="grid gap-3">
            <MiniMetric label="Projects" value={projectsCount} caption="local workspaces" />
            <MiniMetric label="Task Packs" value={taskPacksCount} caption="generated prompts" />
            <MiniMetric label="Readiness" value={readinessValue} caption="average score" />
          </div>
        </motion.aside>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...CARD_TRANSITION, delay: 0.06 }}
          className="relative overflow-hidden rounded-[2rem] border border-neutral-900 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-5"
        >
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Suggested next step
              </p>

              <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
                {nextTitle}
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                {nextDescription}
              </p>
            </div>

            <Button
              variant="primary"
              onClick={primaryAction}
              disabled={isLoading}
              className="shrink-0"
            >
              {hasProjects ? <Zap size={15} /> : <FolderOpen size={15} />}
              {hasProjects ? "Open Context Builder" : "Add project"}
            </Button>
          </div>

          <div className="relative grid gap-3 md:grid-cols-4">
            <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[30px] hidden h-px bg-gradient-to-r from-transparent via-white/10 to-transparent md:block" />

            {workflowSteps.map((step, index) => (
              <WorkflowStep
                key={step.id}
                step={step}
                active={index === activeWorkflowIndex}
              />
            ))}
          </div>
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...CARD_TRANSITION, delay: 0.08 }}
          className="rounded-[2rem] border border-neutral-900 bg-black/35 p-5"
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Route size={18} />
            </div>

            <div>
              <p className="text-sm font-semibold text-white">
                Quick actions
              </p>
              <p className="text-xs text-neutral-600">
                Jump directly into the workflow.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <QuickAction
              icon={<WandSparkles size={17} />}
              title="Context Builder"
              description="Generate AGENTS.md and project context."
              onClick={onOpenContextBuilder}
              primary
            />

            <QuickAction
              icon={<Archive size={17} />}
              title="Task Packs"
              description="Open generated prompt archive."
              onClick={onOpenTaskPacks}
            />

            <QuickAction
              icon={<Settings2 size={17} />}
              title="Settings"
              description="Configure Ollama and Composer limits."
              onClick={onOpenSettings}
            />
          </div>
        </motion.aside>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...CARD_TRANSITION, delay: 0.1 }}
          className="grid gap-4 md:grid-cols-3"
        >
          <PrincipleCard
            icon={<Lock size={17} />}
            title="Local-first"
            description="Project context stays on your machine. Local scanning and optional local model refinement."
          />

          <PrincipleCard
            icon={<ShieldCheck size={17} />}
            title="Validated files"
            description="Composer uses real inventory paths, safe snippets, and explicit editing boundaries."
          />

          <PrincipleCard
            icon={<Bot size={17} />}
            title="Agent-ready output"
            description="Task Packs are structured for coding agents, not vague one-message prompts."
          />
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...CARD_TRANSITION, delay: 0.12 }}
          className="rounded-[2rem] border border-neutral-900 bg-black/35 p-5"
        >
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <CheckCircle2 size={16} />
            </div>

            <div>
              <p className="text-sm font-semibold text-white">
                Current activity
              </p>
              <p className="text-xs text-neutral-600">
                Last workflow state
              </p>
            </div>
          </div>

          <p className="line-clamp-3 text-sm leading-6 text-neutral-500">
            {statusMessage || "Ready to scan projects and generate context."}
          </p>

          <div className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <div className="mb-2 flex items-center gap-2">
              <CircleDot size={15} className="text-emerald-300" />
              <p className="text-sm font-medium text-white">
                Today’s focus
              </p>
            </div>

            <p className="text-xs leading-5 text-neutral-500">
              Composer v2 is ready. Next step is UI polish: Dashboard, Sidebar,
              Settings, and shared interaction patterns.
            </p>
          </div>
        </motion.aside>
      </div>
    </section>
  );
}