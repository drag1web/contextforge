import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Boxes,
  CheckCircle2,
  Code2,
  FileText,
  Gauge,
  Info,
  Layers3,
  ListChecks,
  Route,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Workflow,
  XCircle,
} from "lucide-react";

import { AiToolLogo } from "../components/ai/AiToolLogo";
import { Button } from "../components/ui/Button";
import { SlidingSelectionIndicator } from "../components/ui/SlidingSelectionIndicator";

interface AgentsPageProps {
  onOpenContextBuilder?: () => void;
  onOpenTemplates?: () => void;
}

type AgentProfileId = "codex" | "cursor" | "claude" | "gemini" | "generic";

interface AgentProfile {
  id: AgentProfileId;
  title: string;
  shortLabel: string;
  subtitle: string;
  bestFor: string[];
  promptStyle: string[];
  limitations: string[];
  recommendedContext: string;
  outputFormat: string;
  verification: string[];
  workflowFit: string;
  impact: Array<{ label: string; value: string; caption: string }>;
  recommendedTemplates: string[];
  guidance: string;
  readiness: "Primary" | "IDE" | "CLI" | "Experimental" | "Fallback";
}

const AGENT_ITEM_HEIGHT = 104;
const AGENT_ITEM_GAP = 12;

const AGENT_SWITCH_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.58,
} as const;

const PAGE_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
} as const;

const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "codex",
    title: "Codex",
    shortLabel: "OpenAI coding agent",
    subtitle:
      "Strong for focused implementation tasks, repo-aware fixes and clean verification output.",
    bestFor: [
      "Focused feature work",
      "Bug fixes with clear reproduction steps",
      "Small-to-medium refactors",
      "Task Packs with strict acceptance criteria",
    ],
    promptStyle: [
      "Give a precise goal first, then scope boundaries.",
      "Separate edit candidates from inspect-only context.",
      "Ask for a final response with files changed, verification and risks.",
    ],
    limitations: [
      "Too much unrelated context can weaken the edit plan.",
      "Broad product redesign tasks should be split into smaller packs.",
      "Verification commands should be explicit, not implied.",
    ],
    recommendedContext: "Standard · 6-14 files with clear edit candidates",
    outputFormat: "Summary, changed files, verification, risks",
    verification: [
      "Run build/test commands",
      "Mention skipped checks",
      "Keep patch focused",
    ],
    workflowFit:
      "Best default when ContextForge has a clean task, selected files and acceptance criteria.",
    impact: [
      {
        label: "Context",
        value: "Focused",
        caption: "Clear edit files first, supporting files second.",
      },
      {
        label: "Instructions",
        value: "Direct",
        caption: "Goal, boundaries and acceptance criteria stay visible.",
      },
      {
        label: "Response",
        value: "Patch report",
        caption: "Summary, changed files, checks and risks.",
      },
    ],
    recommendedTemplates: ["Bug fix", "UI/UX redesign", "Refactor component"],
    guidance:
      "Use Codex when the task is already narrow and ContextForge can provide exact files plus verification commands.",
    readiness: "Primary",
  },
  {
    id: "cursor",
    title: "Cursor",
    shortLabel: "IDE coding agent",
    subtitle:
      "Best when the developer stays inside the editor and wants interactive codebase edits.",
    bestFor: [
      "UI polish while inspecting live files",
      "Component-level refactors",
      "Fast iteration in an IDE",
      "Tasks that benefit from manual steering",
    ],
    promptStyle: [
      "Use compact instructions that fit the current editor context.",
      "Point to exact files and expected visual behavior.",
      "Keep constraints visible near the top of the prompt.",
    ],
    limitations: [
      "Can drift if the prompt does not lock the intended files.",
      "Large architectural tasks need stronger decomposition.",
      "Manual review is still important for UX details.",
    ],
    recommendedContext: "Compact · 3-10 files plus visual/UX notes",
    outputFormat: "Implementation notes, touched files, manual UI checks",
    verification: [
      "Check affected route",
      "Run renderer build",
      "Review visual states",
    ],
    workflowFit:
      "Great for visual changes where the user wants to steer and compare the result in the editor.",
    impact: [
      {
        label: "Context",
        value: "Compact",
        caption: "Prioritize open files, routes and visual notes.",
      },
      {
        label: "Instructions",
        value: "Interactive",
        caption: "Keep prompts short enough for IDE iteration.",
      },
      {
        label: "Response",
        value: "UI checks",
        caption: "Ask for touched files and manual screen states.",
      },
    ],
    recommendedTemplates: ["UI/UX redesign", "Refactor component", "Bug fix"],
    guidance:
      "Use Cursor when you expect to inspect the result visually and guide the edit from inside the code editor.",
    readiness: "IDE",
  },
  {
    id: "claude",
    title: "Claude Code",
    shortLabel: "Anthropic CLI coding agent",
    subtitle:
      "Strong for careful multi-file reasoning, code cleanup and structured execution plans.",
    bestFor: [
      "Multi-file changes with constraints",
      "Architecture cleanup",
      "Safety-sensitive edits",
      "Readable plans before code changes",
    ],
    promptStyle: [
      "State what must not be touched before implementation details.",
      "Ask for a short plan, then patch, then verification summary.",
      "Include project memory and decision log constraints.",
    ],
    limitations: [
      "Can over-plan if the task is too open-ended.",
      "Needs strong boundaries around generated sections.",
      "Long contexts should be organized into sections.",
    ],
    recommendedContext: "Detailed · 8-18 files with rules and memory",
    outputFormat: "Plan, changes made, checks run, remaining concerns",
    verification: [
      "Run focused checks",
      "Explain tradeoffs",
      "Flag untouched risky areas",
    ],
    workflowFit:
      "Best when ContextForge needs a disciplined agent with strong constraints and reviewable reasoning.",
    impact: [
      {
        label: "Context",
        value: "Detailed",
        caption: "Rules, memory and architecture notes become important.",
      },
      {
        label: "Instructions",
        value: "Structured",
        caption: "Plan, patch and verification should be separated.",
      },
      {
        label: "Response",
        value: "Reviewable",
        caption: "Expect tradeoffs, checks and remaining concerns.",
      },
    ],
    recommendedTemplates: ["Backend API change", "Security audit", "Add tests"],
    guidance:
      "Use Claude Code when the task has several moving parts, strict constraints or sensitive files that need careful handling.",
    readiness: "CLI",
  },
  {
    id: "gemini",
    title: "Gemini",
    shortLabel: "Google AI coding agent",
    subtitle:
      "Useful for broad code understanding, alternatives and task decomposition before execution.",
    bestFor: [
      "Explaining a project area",
      "Comparing implementation options",
      "Planning larger tasks",
      "Generating first-pass checklist structure",
    ],
    promptStyle: [
      "Ask for decomposition and risks before edits.",
      "Keep the final requested output concrete.",
      "Use scanner signals and reports to frame the task.",
    ],
    limitations: [
      "May need tighter edit instructions for exact patch work.",
      "Provider/model behavior can vary across setups.",
      "Treat broad suggestions as input, not final implementation.",
    ],
    recommendedContext: "Flexible · summaries first, files second",
    outputFormat: "Options, recommended path, checklist, implementation notes",
    verification: [
      "Validate chosen option",
      "Run relevant checks",
      "Review generated assumptions",
    ],
    workflowFit:
      "Good when the task needs exploration or a clean plan before handing off to an editing agent.",
    impact: [
      {
        label: "Context",
        value: "Exploratory",
        caption: "Summaries and scanner signals can come before files.",
      },
      {
        label: "Instructions",
        value: "Comparative",
        caption: "Ask for options, risks and a recommended path.",
      },
      {
        label: "Response",
        value: "Plan first",
        caption: "Use the output as planning input before edits.",
      },
    ],
    recommendedTemplates: [
      "Docs update",
      "Release checklist",
      "Security audit",
    ],
    guidance:
      "Use Gemini when you want broad understanding, decomposition or alternative approaches before implementation.",
    readiness: "Experimental",
  },
  {
    id: "generic",
    title: "Generic",
    shortLabel: "Universal AI agent",
    subtitle:
      "Safe fallback profile for any external coding assistant that accepts a structured prompt.",
    bestFor: [
      "Unknown coding tools",
      "Manual copy/paste workflows",
      "Basic docs or checklist tasks",
      "Conservative prompt exports",
    ],
    promptStyle: [
      "Avoid tool-specific assumptions.",
      "Use plain markdown sections and direct instructions.",
      "Make verification and final response format explicit.",
    ],
    limitations: [
      "No tool-specific behavior can be assumed.",
      "May require more manual file navigation.",
      "Best quality depends on the external assistant.",
    ],
    recommendedContext: "Portable · concise markdown with explicit file paths",
    outputFormat: "Markdown summary, files, checks, risks",
    verification: [
      "Manual review",
      "Run project commands",
      "Check scope boundaries",
    ],
    workflowFit:
      "Reliable fallback when ContextForge does not know the exact external agent capabilities yet.",
    impact: [
      {
        label: "Context",
        value: "Portable",
        caption: "Plain markdown and explicit paths are safest.",
      },
      {
        label: "Instructions",
        value: "Neutral",
        caption: "Avoid assumptions about tools, commands or UI.",
      },
      {
        label: "Response",
        value: "Manual",
        caption: "Human review and explicit checks matter more.",
      },
    ],
    recommendedTemplates: ["Docs update", "Bug fix", "Release checklist"],
    guidance:
      "Use Generic when copying a Task Pack into an unknown assistant or when tool-specific behavior would be risky.",
    readiness: "Fallback",
  },
];

const WORKFLOW_STEPS = [
  "Choose project",
  "Review scanner signals",
  "Pick agent profile",
  "Choose template",
  "Export Task Pack",
];

function getProfileIconTool(profile: AgentProfile) {
  return profile.id;
}

function StatCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <article className="cf-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {label}
          </p>
          <p className="mt-1 truncate text-xl font-semibold tracking-[-0.03em] text-white">
            {value}
          </p>
        </div>

        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </div>
      </div>

      <p className="mt-2 text-xs leading-5 text-neutral-600">{caption}</p>
    </article>
  );
}

function AgentListItem({
  profile,
  isSelected,
  onSelect,
}: {
  profile: AgentProfile;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "cf-pressable group relative z-10 w-full overflow-hidden rounded-[1.35rem] p-4 text-left transition-colors duration-150",
        isSelected
          ? "text-black"
          : "border border-neutral-900 bg-black/35 text-white hover:border-white/15 hover:bg-white/[0.035]",
      ].join(" ")}
      style={{ height: AGENT_ITEM_HEIGHT }}
    >
      <div className="flex items-start gap-3">
        <AiToolLogo
          tool={getProfileIconTool(profile)}
          size="lg"
          contrast={isSelected ? "onLight" : "default"}
          className={isSelected ? "border-black/10 bg-black/5" : ""}
        />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{profile.title}</p>
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                isSelected
                  ? "bg-black/10 text-black/60"
                  : "border border-neutral-900 bg-neutral-950 text-neutral-600 group-hover:border-white/15 group-hover:text-neutral-300",
              ].join(" ")}
            >
              {profile.readiness}
            </span>
          </div>

          <p
            className={
              isSelected
                ? "truncate text-xs text-black/55"
                : "truncate text-xs text-neutral-600 group-hover:text-neutral-500"
            }
          >
            {profile.shortLabel}
          </p>

          <p
            className={
              isSelected
                ? "mt-2 line-clamp-2 text-xs leading-5 text-black/60"
                : "mt-2 line-clamp-2 text-xs leading-5 text-neutral-500"
            }
          >
            {profile.subtitle}
          </p>
        </div>
      </div>
    </button>
  );
}

function BulletList({
  items,
  icon,
  tone = "default",
}: {
  items: string[];
  icon: ReactNode;
  tone?: "default" | "danger" | "success";
}) {
  const iconClass =
    tone === "danger"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
      : tone === "success"
        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
        : "border-neutral-800 bg-neutral-950 text-neutral-400";

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div
          key={item}
          className="flex gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-3 text-sm leading-6 text-neutral-400"
        >
          <span
            className={[
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
              iconClass,
            ].join(" ")}
          >
            {icon}
          </span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function ImpactGrid({ items }: { items: AgentProfile["impact"] }) {
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <div
          key={`${item.label}-${item.value}`}
          className="rounded-[1.15rem] border border-neutral-900 bg-black/30 p-3"
        >
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {item.label}
          </p>
          <p className="mt-1 text-sm font-semibold text-white">{item.value}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {item.caption}
          </p>
        </div>
      ))}
    </div>
  );
}

function TemplatePills({ templates }: { templates: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {templates.map((template) => (
        <span
          key={template}
          className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] font-medium text-neutral-400"
        >
          {template}
        </span>
      ))}
    </div>
  );
}

function SectionCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="cf-card p-5">
      <div className="mb-4">
        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {eyebrow}
        </p>
        <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function AgentsPage({
  onOpenContextBuilder,
  onOpenTemplates,
}: AgentsPageProps) {
  const [selectedAgentId, setSelectedAgentId] =
    useState<AgentProfileId>("codex");

  const selectedAgent = useMemo(
    () =>
      AGENT_PROFILES.find((profile) => profile.id === selectedAgentId) ??
      AGENT_PROFILES[0],
    [selectedAgentId],
  );

  const activeAgentIndex = AGENT_PROFILES.findIndex(
    (profile) => profile.id === selectedAgent.id,
  );
  const agentListHeight =
    AGENT_PROFILES.length * AGENT_ITEM_HEIGHT +
    (AGENT_PROFILES.length - 1) * AGENT_ITEM_GAP;

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-5 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">
            <Bot size={13} />
            Agents
          </span>
          <span className="cf-badge">Agent profiles</span>
          <span className="cf-badge">Stage 9.1</span>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <h2 className="max-w-4xl text-[32px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Choose the right coding agent profile before building a Task Pack.
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              ContextForge separates model providers from external coding
              agents. Providers refine or analyze context inside the app; agent
              profiles define how exported Task Packs should be written for
              Codex, Cursor, Claude Code, Gemini or a generic assistant.
            </p>
          </div>

          <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Workflow position
            </p>
            <p className="mt-2 text-base font-semibold text-white">
              Agents sit between Templates and Task Packs
            </p>
            <div className="mt-4 grid gap-2">
              <div className="flex items-center gap-2 rounded-2xl border border-neutral-900 bg-black/40 p-3 text-xs text-neutral-500">
                <ShieldCheck size={14} className="text-neutral-400" />
                Claude API is a provider. Claude Code is an agent target.
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-neutral-900 bg-black/40 p-3 text-xs text-neutral-500">
                <Route size={14} className="text-neutral-400" />
                Stage 9.3 will connect profile selection directly to Task Pack
                creation.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <StatCard
          icon={<Boxes size={18} />}
          label="Profiles"
          value={`${AGENT_PROFILES.length} agents`}
          caption="Codex, Cursor, Claude Code, Gemini and Generic."
        />
        <StatCard
          icon={<FileText size={18} />}
          label="Prompt style"
          value="Per target"
          caption="Each profile explains how the Task Pack should be shaped."
        />
        <StatCard
          icon={<ListChecks size={18} />}
          label="Verification"
          value="Checklist"
          caption="Recommended final checks and response behavior."
        />
        <StatCard
          icon={<ShieldCheck size={18} />}
          label="Safety"
          value="Scoped"
          caption="Agent guidance stays separate from provider configuration."
        />
      </div>

      <div className="grid min-h-[720px] gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="cf-card h-fit p-5 xl:sticky xl:top-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Agent profiles
              </p>
              <h3 className="mt-1 text-base font-semibold text-white">
                Choose a target
              </h3>
            </div>
            <span className="cf-badge">{AGENT_PROFILES.length} ready</span>
          </div>

          <div
            className="relative grid"
            style={{
              gap: AGENT_ITEM_GAP,
              height: agentListHeight,
            }}
          >
            <SlidingSelectionIndicator
              activeIndex={activeAgentIndex}
              itemHeight={AGENT_ITEM_HEIGHT}
              itemGap={AGENT_ITEM_GAP}
              className="agents-profile-active-pill"
              transition={AGENT_SWITCH_TRANSITION}
            />

            {AGENT_PROFILES.map((profile, index) => (
              <motion.div
                key={profile.id}
                initial={{ opacity: 0, y: 8, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  ...PAGE_TRANSITION,
                  delay: Math.min(index * 0.012, 0.06),
                }}
                style={{ height: AGENT_ITEM_HEIGHT }}
              >
                <AgentListItem
                  profile={profile}
                  isSelected={selectedAgent.id === profile.id}
                  onSelect={() => setSelectedAgentId(profile.id)}
                />
              </motion.div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedAgent.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={PAGE_TRANSITION}
              className="space-y-5"
            >
              <section className="cf-card p-5">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-w-0">
                    <div className="mb-4 flex items-start gap-3">
                      <AiToolLogo tool={selectedAgent.id} size="lg" />

                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <h3 className="text-2xl font-semibold tracking-[-0.04em] text-white">
                            {selectedAgent.title}
                          </h3>
                          <span className="cf-badge">
                            {selectedAgent.readiness}
                          </span>
                          <span className="cf-badge">Agent target</span>
                        </div>

                        <p className="max-w-3xl text-sm leading-6 text-neutral-400">
                          {selectedAgent.workflowFit}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="cf-badge">
                        <Gauge size={12} />
                        {selectedAgent.recommendedContext}
                      </span>
                      <span className="cf-badge">
                        <TerminalSquare size={12} />
                        {selectedAgent.outputFormat}
                      </span>
                    </div>

                    <ImpactGrid items={selectedAgent.impact} />
                  </div>

                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      What this profile changes
                    </p>
                    <p className="mt-2 text-sm leading-6 text-neutral-400">
                      {selectedAgent.guidance}
                    </p>

                    <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
                        <Info size={13} className="text-neutral-500" />
                        Recommended templates
                      </div>
                      <TemplatePills
                        templates={selectedAgent.recommendedTemplates}
                      />
                    </div>

                    <div className="mt-4 grid gap-2">
                      {onOpenContextBuilder && (
                        <Button
                          variant="primary"
                          className="justify-center rounded-xl"
                          onClick={onOpenContextBuilder}
                        >
                          <Workflow size={15} />
                          Open Context Builder
                        </Button>
                      )}
                      {onOpenTemplates && (
                        <Button
                          variant="secondary"
                          className="justify-center rounded-xl"
                          onClick={onOpenTemplates}
                        >
                          <Layers3 size={15} />
                          View Templates
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="grid gap-5 lg:grid-cols-2">
                  <SectionCard eyebrow="Best for" title="Where this agent fits">
                    <BulletList
                      items={selectedAgent.bestFor}
                      icon={<CheckCircle2 size={13} />}
                      tone="success"
                    />
                  </SectionCard>

                  <SectionCard
                    eyebrow="Prompt style"
                    title="How to write the Task Pack"
                  >
                    <BulletList
                      items={selectedAgent.promptStyle}
                      icon={<Code2 size={13} />}
                    />
                  </SectionCard>
                </div>

                <aside className="cf-card h-fit p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <BadgeCheck size={16} className="text-neutral-400" />
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Verification behavior
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-white">
                        What the agent should return
                      </h3>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {selectedAgent.verification.map((item, index) => (
                      <div
                        key={item}
                        className="flex gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm leading-6 text-neutral-500"
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-black">
                          {index + 1}
                        </span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </aside>
              </section>

              <SectionCard
                eyebrow="Limitations"
                title="Boundaries to keep the Task Pack safe"
              >
                <BulletList
                  items={selectedAgent.limitations}
                  icon={<XCircle size={13} />}
                  tone="danger"
                />
              </SectionCard>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <section className="cf-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Next workflow
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              Agent profiles become more useful when templates connect to Task
              Packs.
            </h3>
          </div>
          <span className="cf-badge">
            <Sparkles size={13} />
            Stage 9.2 / 9.3
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-5">
          {WORKFLOW_STEPS.map((step, index) => (
            <div
              key={step}
              className="rounded-[1.25rem] border border-neutral-900 bg-black/35 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-white text-xs font-semibold text-black">
                  {index + 1}
                </span>
                {index < WORKFLOW_STEPS.length - 1 && (
                  <ArrowRight size={14} className="text-neutral-700" />
                )}
              </div>
              <p className="text-sm font-medium text-white">{step}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
