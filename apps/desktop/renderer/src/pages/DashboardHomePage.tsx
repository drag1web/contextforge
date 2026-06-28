import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Gauge,
  Layers3,
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

function getReadinessLabel(score: number | null) {
  if (score === null) {
    return "Not scanned yet";
  }

  if (score >= 80) {
    return "Agent-ready workspace";
  }

  if (score >= 50) {
    return "Context can be improved";
  }

  return "Needs project context";
}

function ValueCard({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="cf-card p-5">
      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
        {icon}
      </div>

      <h3 className="text-base font-semibold text-white">{title}</h3>

      <p className="mt-2 text-sm leading-6 text-neutral-500">
        {description}
      </p>
    </article>
  );
}

function WorkflowCard({
  step,
  icon,
  title,
  description,
  buttonLabel,
  onClick
}: {
  step: string;
  icon: ReactNode;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <motion.article
      whileHover={{ y: -3 }}
      transition={CARD_TRANSITION}
      className="cf-card flex min-h-[250px] flex-col p-5"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex size-11 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          {icon}
        </div>

        <span className="cf-tech-label rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-600">
          {step}
        </span>
      </div>

      <h3 className="text-lg font-semibold tracking-[-0.03em] text-white">
        {title}
      </h3>

      <p className="mt-2 text-sm leading-6 text-neutral-500">
        {description}
      </p>

      <button
        type="button"
        onClick={onClick}
        className="cf-invert-action mt-auto inline-flex h-9 w-fit items-center gap-2 rounded-full px-3.5 text-xs"
      >
        {buttonLabel}
        <ArrowRight size={13} />
      </button>
    </motion.article>
  );
}

function StatusRow({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
      <span className="text-sm text-neutral-500">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
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

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.014)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Sparkles size={13} />
                {appMeta.phase}
              </span>
              <span className="cf-badge">Local-first</span>
              <span className="cf-badge">AI workflow ready</span>
            </div>

            <h1 className="max-w-5xl text-[46px] font-semibold leading-[0.98] tracking-[-0.065em] text-white">
              Turn local projects into AI-ready workspaces.
            </h1>

            <p className="mt-5 max-w-3xl text-base leading-7 text-neutral-400">
              ContextForge scans your local repositories, builds clean project context,
              generates AGENTS.md, and prepares structured Task Packs for Codex,
              Claude Code, Cursor, or any other coding agent.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
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
                Open projects
              </Button>

              <Button variant="ghost" onClick={onOpenSettings}>
                <Settings2 size={15} />
                Settings
              </Button>
            </div>
          </div>

          <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/40 p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Workspace status
                </p>

                <h3 className="mt-2 text-base font-semibold text-white">
                  {getReadinessLabel(readinessScore)}
                </h3>
              </div>

              <div className="flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                <Gauge size={18} />
              </div>
            </div>

            <div className="space-y-3">
              <StatusRow label="Projects" value={projectsCount} />
              <StatusRow label="Task Packs" value={taskPacksCount} />
              <StatusRow
                label="Avg readiness"
                value={readinessScore === null ? "—" : `${readinessScore}/100`}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Current activity
              </p>

              <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-500">
                {statusMessage || "Ready to scan projects and generate context."}
              </p>
            </div>
          </aside>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <WorkflowCard
          step="01"
          icon={<FolderOpen size={19} />}
          title="Scan a local project"
          description="Add a repository and let ContextForge detect stack, scripts, package manager, and missing context signals."
          buttonLabel="Projects"
          onClick={onOpenProjects}
        />

        <WorkflowCard
          step="02"
          icon={<FileText size={19} />}
          title="Generate AGENTS.md"
          description="Create a clean project instruction file that helps coding agents understand conventions, structure, and safe boundaries."
          buttonLabel="Context Builder"
          onClick={onOpenContextBuilder}
        />

        <WorkflowCard
          step="03"
          icon={<WandSparkles size={19} />}
          title="Create a Task Pack"
          description="Turn a vague development request into a structured, validated prompt with project-aware context."
          buttonLabel="Task Packs"
          onClick={onOpenTaskPacks}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="grid gap-4 md:grid-cols-2">
          <ValueCard
            icon={<Lock size={18} />}
            title="Local-first by design"
            description="Project context stays on your machine. The app is built around local scanning, local files, and optional local model refinement."
          />

          <ValueCard
            icon={<Bot size={18} />}
            title="Agent-ready output"
            description="Generated prompts are formatted for real coding workflows, not just generic chat messages."
          />

          <ValueCard
            icon={<ShieldCheck size={18} />}
            title="Safer AI changes"
            description="Task Packs include boundaries, instructions, and project signals so the agent changes less random code."
          />

          <ValueCard
            icon={<Layers3 size={18} />}
            title="Project intelligence layer"
            description="ContextForge becomes a layer between your repositories and any AI coding assistant you choose."
          />
        </div>

        <aside className="cf-card p-5">
          <div className="mb-5 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
            <Route size={18} />
          </div>

          <p className="cf-tech-label text-xs uppercase text-neutral-500">
            Suggested next step
          </p>

          <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-white">
            {hasProjects ? "Build context for an existing project." : "Start with your first local repository."}
          </h3>

          <p className="mt-2 text-sm leading-6 text-neutral-500">
            {hasProjects
              ? "Open Context Builder, choose a project, review readiness, and generate AGENTS.md before creating a Task Pack."
              : "Add a project folder. ContextForge will scan it and unlock the rest of the workflow."}
          </p>

          <div className="mt-5 grid gap-3">
            <Button
              variant="primary"
              onClick={primaryAction}
              disabled={isLoading}
              className="justify-center"
            >
              {hasProjects ? <Zap size={15} /> : <FolderOpen size={15} />}
              {hasProjects ? "Open Context Builder" : "Add project"}
            </Button>

            <Button
              variant="secondary"
              onClick={onOpenTaskPacks}
              className="justify-center"
            >
              <Archive size={15} />
              View Task Pack archive
            </Button>
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-300" />
              <p className="text-sm font-medium text-white">MVP direction</p>
            </div>

            <p className="text-sm leading-6 text-neutral-500">
              Keep Dashboard simple. Move analytics, reports, and health breakdowns
              into a dedicated Reports module.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}