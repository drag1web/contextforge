import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  FileCheck2,
  FileText,
  Gauge,
  Layers3,
  ListChecks,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  TerminalSquare,
  Workflow,
  XCircle,
} from "lucide-react";

import { AiToolLogo } from "../components/ai/AiToolLogo";
import { Button } from "../components/ui/Button";

interface AgentsPageProps {
  onOpenContextBuilder?: () => void;
  onOpenTemplates?: () => void;
}

type AgentProfileId = "codex" | "cursor" | "claude" | "gemini" | "generic";

type AgentProfileDefinition = {
  id: AgentProfileId;
  readiness: "primary" | "ide" | "cli" | "experimental" | "fallback";
  bestForCount: number;
  promptCount: number;
  verificationCount: number;
  limitationCount: number;
  templateCount: number;
};

const AGENT_PROFILES: readonly AgentProfileDefinition[] = [
  {
    id: "codex",
    readiness: "primary",
    bestForCount: 4,
    promptCount: 3,
    verificationCount: 3,
    limitationCount: 3,
    templateCount: 3,
  },
  {
    id: "cursor",
    readiness: "ide",
    bestForCount: 4,
    promptCount: 3,
    verificationCount: 3,
    limitationCount: 3,
    templateCount: 3,
  },
  {
    id: "claude",
    readiness: "cli",
    bestForCount: 4,
    promptCount: 3,
    verificationCount: 3,
    limitationCount: 3,
    templateCount: 3,
  },
  {
    id: "gemini",
    readiness: "experimental",
    bestForCount: 4,
    promptCount: 3,
    verificationCount: 3,
    limitationCount: 3,
    templateCount: 3,
  },
  {
    id: "generic",
    readiness: "fallback",
    bestForCount: 4,
    promptCount: 3,
    verificationCount: 3,
    limitationCount: 3,
    templateCount: 3,
  },
] as const;

const PROFILE_TRANSITION = {
  type: "spring",
  stiffness: 420,
  damping: 38,
  mass: 0.7,
} as const;

const SOFT_TRANSITION = {
  duration: 0.32,
  ease: [0.16, 1, 0.3, 1],
} as const;

const CONSOLE_SIGNALS = [
  { key: "context", icon: <Layers3 size={15} /> },
  { key: "instructions", icon: <Braces size={15} /> },
  { key: "response", icon: <FileCheck2 size={15} /> },
] as const;

function getProfileKey(profile: AgentProfileDefinition, field: string) {
  return `agentsWorkspace.profiles.${profile.id}.${field}`;
}

function getProfileList(
  t: TFunction,
  profile: AgentProfileDefinition,
  field: string,
  count: number,
) {
  return Array.from({ length: count }, (_, index) =>
    t(getProfileKey(profile, `${field}.${index + 1}`)),
  );
}

function MonoIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      {children}
    </span>
  );
}

function ProfileRail({
  activeIndex,
  onSelect,
  t,
}: {
  activeIndex: number;
  onSelect: (profile: AgentProfileDefinition) => void;
  t: TFunction;
}) {
  return (
    <div
      role="tablist"
      aria-label={t("agentsWorkspace.selector.ariaLabel")}
      className="relative grid overflow-hidden rounded-[1.45rem] border border-white/10 bg-black/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]"
      style={{
        gridTemplateColumns: `repeat(${AGENT_PROFILES.length}, minmax(0, 1fr))`,
      }}
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-1 top-1 z-0 rounded-[1.12rem] border border-white bg-white shadow-[0_16px_42px_rgba(255,255,255,0.12)]"
        style={{
          width: `calc((100% - 8px) / ${AGENT_PROFILES.length})`,
          willChange: "transform",
        }}
        initial={false}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={PROFILE_TRANSITION}
      />

      {AGENT_PROFILES.map((profile, index) => {
        const isActive = index === activeIndex;

        return (
          <button
            key={profile.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(profile)}
            className={[
              "group relative z-10 min-w-0 rounded-[1.12rem] px-3 py-3 text-left transition-colors duration-150",
              isActive ? "text-black" : "text-neutral-500 hover:text-white",
            ].join(" ")}
          >
            <div className="flex items-center gap-3">
              <AiToolLogo
                tool={profile.id}
                size="md"
                contrast={isActive ? "onLight" : "default"}
                tone="monochrome"
                className={isActive ? "border-black/10 bg-black/5" : ""}
              />

              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {t(getProfileKey(profile, "name"))}
                </p>
                <p
                  className={[
                    "mt-0.5 truncate text-[11px]",
                    isActive ? "text-black/55" : "text-neutral-600",
                  ].join(" ")}
                >
                  {t(getProfileKey(profile, "role"))}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AgentCore({
  profile,
  name,
  role,
  reducedMotion,
  t,
}: {
  profile: AgentProfileDefinition;
  name: string;
  role: string;
  reducedMotion: boolean;
  t: TFunction;
}) {
  const orbitLabels = [
    t("agentsWorkspace.showcase.orbitContext"),
    t("agentsWorkspace.showcase.orbitRules"),
    t("agentsWorkspace.showcase.orbitChecks"),
  ];

  return (
    <div className="relative min-h-[430px] overflow-hidden rounded-[1.65rem] border border-white/10 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.08),transparent_31%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(0,0,0,0.16))]">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage:
            "radial-gradient(circle at center, black 15%, transparent 74%)",
        }}
      />

      <motion.div
        aria-hidden="true"
        className="absolute left-[-25%] top-0 h-full w-[28%] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent)] blur-xl"
        animate={reducedMotion ? undefined : { x: ["0%", "560%"] }}
        transition={
          reducedMotion
            ? undefined
            : { duration: 6.8, repeat: Infinity, ease: "linear" }
        }
      />

      <div className="absolute inset-0 grid place-items-center">
        <motion.div
          aria-hidden="true"
          className="absolute size-[310px] rounded-full border border-white/10"
          animate={reducedMotion ? undefined : { rotate: 360 }}
          transition={
            reducedMotion
              ? undefined
              : { duration: 34, repeat: Infinity, ease: "linear" }
          }
        >
          <span className="absolute left-1/2 top-[-4px] size-2 -translate-x-1/2 rounded-full bg-white/75 shadow-[0_0_16px_rgba(255,255,255,0.7)]" />
          <span className="absolute bottom-[14%] right-[5%] size-1.5 rounded-full bg-white/40" />
        </motion.div>

        <motion.div
          aria-hidden="true"
          className="absolute size-[225px] rounded-full border border-dashed border-white/10"
          animate={reducedMotion ? undefined : { rotate: -360 }}
          transition={
            reducedMotion
              ? undefined
              : { duration: 26, repeat: Infinity, ease: "linear" }
          }
        />

        <motion.div
          key={profile.id}
          initial={{ opacity: 0, scale: 0.82, rotate: -5 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.9, rotate: 4 }}
          transition={PROFILE_TRANSITION}
          className="relative z-10 grid size-32 place-items-center rounded-[2.25rem] border border-white/15 bg-black/80 shadow-[0_28px_90px_rgba(0,0,0,0.65),0_0_58px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          <AiToolLogo
            tool={profile.id}
            size="lg"
            tone="monochrome"
            className="!size-20 !rounded-[1.65rem] [&_svg]:!size-10"
          />
          <motion.span
            aria-hidden="true"
            className="absolute inset-[-10px] rounded-[2.7rem] border border-white/10"
            animate={
              reducedMotion
                ? undefined
                : { opacity: [0.25, 0.75, 0.25], scale: [0.98, 1.04, 0.98] }
            }
            transition={
              reducedMotion
                ? undefined
                : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
        </motion.div>

        {orbitLabels.map((label, index) => {
          const positions = [
            "left-[7%] top-[24%]",
            "right-[6%] top-[28%]",
            "bottom-[13%] left-1/2 -translate-x-1/2",
          ];

          return (
            <motion.div
              key={label}
              className={[
                "absolute z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400 shadow-[0_12px_34px_rgba(0,0,0,0.45)] backdrop-blur-xl",
                positions[index],
              ].join(" ")}
              animate={
                reducedMotion
                  ? undefined
                  : { y: index === 2 ? [0, -4, 0] : [0, 5, 0] }
              }
              transition={
                reducedMotion
                  ? undefined
                  : {
                      duration: 3.6 + index * 0.7,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
            >
              <CircleDot size={11} />
              {label}
            </motion.div>
          );
        })}
      </div>

      <div className="absolute inset-x-5 bottom-5 z-30 rounded-[1.15rem] border border-white/10 bg-black/75 p-4 backdrop-blur-xl">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("agentsWorkspace.showcase.activeProfile")}
            </p>
            <AnimatePresence mode="wait">
              <motion.div
                key={profile.id}
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={SOFT_TRANSITION}
              >
                <p className="mt-1 truncate text-xl font-semibold tracking-[-0.035em] text-white">
                  {name}
                </p>
                <p className="mt-1 truncate text-xs text-neutral-500">{role}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400">
            {t(`agentsWorkspace.readiness.${profile.readiness}`)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SignalCard({
  icon,
  label,
  value,
  caption,
  index,
  reducedMotion,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <motion.article
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SOFT_TRANSITION, delay: reducedMotion ? 0 : index * 0.06 }}
      className="rounded-[1.2rem] border border-white/10 bg-black/35 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-neutral-500">{icon}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-neutral-700">
          0{index + 1}
        </span>
      </div>
      <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{caption}</p>
    </motion.article>
  );
}

function InformationList({
  items,
  icon,
  numbered = false,
  reducedMotion,
}: {
  items: string[];
  icon: ReactNode;
  numbered?: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className="grid gap-2.5">
      {items.map((item, index) => (
        <motion.div
          key={item}
          initial={reducedMotion ? false : { opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            ...SOFT_TRANSITION,
            delay: reducedMotion ? 0 : index * 0.055,
          }}
          className="flex items-start gap-3 rounded-[1.05rem] border border-white/[0.08] bg-black/30 p-3.5"
        >
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-[10px] font-semibold text-neutral-400">
            {numbered ? index + 1 : icon}
          </span>
          <p className="text-sm leading-6 text-neutral-400">{item}</p>
        </motion.div>
      ))}
    </div>
  );
}

function BlueprintCard({
  eyebrow,
  title,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.55rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(0,0,0,0.12))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="mb-4 flex items-center gap-3">
        <MonoIcon>{icon}</MonoIcon>
        <div>
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
        </div>
      </div>
      {children}
    </section>
  );
}

function WorkflowLane({
  profileName,
  t,
  reducedMotion,
}: {
  profileName: string;
  t: TFunction;
  reducedMotion: boolean;
}) {
  const steps = [
    {
      key: "context",
      icon: <Layers3 size={16} />,
      title: t("agentsWorkspace.workflow.contextTitle"),
      caption: t("agentsWorkspace.workflow.contextCaption"),
    },
    {
      key: "profile",
      icon: <Target size={16} />,
      title: profileName,
      caption: t("agentsWorkspace.workflow.profileCaption"),
    },
    {
      key: "package",
      icon: <FileText size={16} />,
      title: t("agentsWorkspace.workflow.packageTitle"),
      caption: t("agentsWorkspace.workflow.packageCaption"),
    },
  ];

  return (
    <section className="overflow-hidden rounded-[1.55rem] border border-white/10 bg-black/35 p-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {t("agentsWorkspace.workflow.eyebrow")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">
            {t("agentsWorkspace.workflow.title")}
          </h3>
        </div>
        <p className="max-w-xl text-right text-xs leading-5 text-neutral-600">
          {t("agentsWorkspace.workflow.description")}
        </p>
      </div>

      <div className="relative grid gap-3 md:grid-cols-3">
        <div
          aria-hidden="true"
          className="absolute left-[16.66%] right-[16.66%] top-7 hidden h-px bg-white/10 md:block"
        />
        <motion.span
          aria-hidden="true"
          className="absolute top-[25px] hidden size-1.5 rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.8)] md:block"
          animate={
            reducedMotion ? undefined : { left: ["16.66%", "83.33%"] }
          }
          transition={
            reducedMotion
              ? undefined
              : { duration: 4.2, repeat: Infinity, ease: "linear" }
          }
        />

        {steps.map((step, index) => (
          <motion.div
            key={step.key}
            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              ...SOFT_TRANSITION,
              delay: reducedMotion ? 0 : index * 0.08,
            }}
            className="relative rounded-[1.15rem] border border-white/[0.08] bg-black/55 p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-neutral-300">
                {step.icon}
              </span>
              <span className="font-mono text-[9px] text-neutral-700">0{index + 1}</span>
            </div>
            <p className="text-sm font-semibold text-white">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{step.caption}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function AgentsPage({
  onOpenContextBuilder,
  onOpenTemplates,
}: AgentsPageProps) {
  const { t } = useTranslation();
  const reducedMotion = Boolean(useReducedMotion());
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

  const selectedName = t(getProfileKey(selectedAgent, "name"));
  const selectedRole = t(getProfileKey(selectedAgent, "role"));
  const bestFor = getProfileList(
    t,
    selectedAgent,
    "bestFor",
    selectedAgent.bestForCount,
  );
  const promptStyle = getProfileList(
    t,
    selectedAgent,
    "promptStyle",
    selectedAgent.promptCount,
  );
  const verification = getProfileList(
    t,
    selectedAgent,
    "verification",
    selectedAgent.verificationCount,
  );
  const limitations = getProfileList(
    t,
    selectedAgent,
    "limitations",
    selectedAgent.limitationCount,
  );
  const templates = getProfileList(
    t,
    selectedAgent,
    "templates",
    selectedAgent.templateCount,
  );

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={SOFT_TRANSITION}
      className="space-y-4"
    >
      <motion.header
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT_TRANSITION}
        className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.008))] p-5 shadow-[0_18px_58px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]"
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_470px] xl:items-end">
          <div className="flex items-start gap-3">
            <MonoIcon>
              <Sparkles size={17} />
            </MonoIcon>
            <div>
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("agentsWorkspace.header.eyebrow")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">
                {t("agentsWorkspace.header.title")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                {t("agentsWorkspace.header.description")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 overflow-hidden rounded-[1.15rem] border border-white/10 bg-black/35">
            <div className="border-r border-white/[0.08] px-4 py-3">
              <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                {t("agentsWorkspace.header.profiles")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {AGENT_PROFILES.length}
              </p>
            </div>
            <div className="border-r border-white/[0.08] px-4 py-3">
              <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                {t("agentsWorkspace.header.selected")}
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-white">
                {selectedName}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                {t("agentsWorkspace.header.output")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {t("agentsWorkspace.header.taskPack")}
              </p>
            </div>
          </div>
        </div>
      </motion.header>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SOFT_TRANSITION, delay: reducedMotion ? 0 : 0.06 }}
      >
        <ProfileRail
          activeIndex={activeAgentIndex}
          onSelect={(profile) => setSelectedAgentId(profile.id)}
          t={t}
        />
      </motion.div>

      <section className="grid gap-4 xl:grid-cols-[minmax(430px,0.9fr)_minmax(0,1.1fr)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={`core-${selectedAgent.id}`}
            initial={reducedMotion ? false : { opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={SOFT_TRANSITION}
          >
            <AgentCore
              profile={selectedAgent}
              name={selectedName}
              role={selectedRole}
              reducedMotion={reducedMotion}
              t={t}
            />
          </motion.div>
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.article
            key={`profile-${selectedAgent.id}`}
            initial={reducedMotion ? false : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={SOFT_TRANSITION}
            className="rounded-[1.65rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.14))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-neutral-400">
                    {t("agentsWorkspace.showcase.profilePreview")}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] text-neutral-500">
                    {t(`agentsWorkspace.readiness.${selectedAgent.readiness}`)}
                  </span>
                </div>
                <h3 className="text-[30px] font-semibold leading-none tracking-[-0.05em] text-white">
                  {selectedName}
                </h3>
                <p className="mt-2 text-sm font-medium text-neutral-300">
                  {selectedRole}
                </p>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-500">
                  {t(getProfileKey(selectedAgent, "summary"))}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {onOpenContextBuilder && (
                  <Button
                    variant="primary"
                    className="rounded-xl"
                    onClick={onOpenContextBuilder}
                  >
                    <Workflow size={15} />
                    {t("agentsWorkspace.actions.openContext")}
                  </Button>
                )}
                {onOpenTemplates && (
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    onClick={onOpenTemplates}
                  >
                    <Layers3 size={15} />
                    {t("agentsWorkspace.actions.openTemplates")}
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {CONSOLE_SIGNALS.map((signal, index) => (
                <SignalCard
                  key={signal.key}
                  icon={signal.icon}
                  label={t(`agentsWorkspace.signals.${signal.key}`)}
                  value={t(getProfileKey(selectedAgent, `signals.${signal.key}.value`))}
                  caption={t(
                    getProfileKey(selectedAgent, `signals.${signal.key}.caption`),
                  )}
                  index={index}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>

            <div className="mt-4 rounded-[1.2rem] border border-white/[0.08] bg-black/35 p-4">
              <div className="flex items-start gap-3">
                <MonoIcon>
                  <Route size={16} />
                </MonoIcon>
                <div>
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                    {t("agentsWorkspace.showcase.guidanceEyebrow")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {t("agentsWorkspace.showcase.guidanceTitle")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">
                    {t(getProfileKey(selectedAgent, "guidance"))}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {templates.map((template) => (
                  <span
                    key={template}
                    className="rounded-full border border-white/10 bg-white/[0.025] px-2.5 py-1 text-[11px] text-neutral-400"
                  >
                    {template}
                  </span>
                ))}
              </div>
            </div>
          </motion.article>
        </AnimatePresence>
      </section>

      <AnimatePresence mode="wait">
        <motion.div
          key={`blueprint-${selectedAgent.id}`}
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={SOFT_TRANSITION}
          className="grid gap-4 xl:grid-cols-3"
        >
          <BlueprintCard
            eyebrow={t("agentsWorkspace.blueprint.fitEyebrow")}
            title={t("agentsWorkspace.blueprint.fitTitle")}
            icon={<Target size={17} />}
          >
            <InformationList
              items={bestFor}
              icon={<CheckCircle2 size={12} />}
              reducedMotion={reducedMotion}
            />
          </BlueprintCard>

          <BlueprintCard
            eyebrow={t("agentsWorkspace.blueprint.promptEyebrow")}
            title={t("agentsWorkspace.blueprint.promptTitle")}
            icon={<Code2 size={17} />}
          >
            <InformationList
              items={promptStyle}
              icon={<ChevronRight size={12} />}
              reducedMotion={reducedMotion}
            />
          </BlueprintCard>

          <BlueprintCard
            eyebrow={t("agentsWorkspace.blueprint.verifyEyebrow")}
            title={t("agentsWorkspace.blueprint.verifyTitle")}
            icon={<ListChecks size={17} />}
          >
            <InformationList
              items={verification}
              icon={<Check size={12} />}
              numbered
              reducedMotion={reducedMotion}
            />
          </BlueprintCard>
        </motion.div>
      </AnimatePresence>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
        <AnimatePresence mode="wait">
          <motion.section
            key={`limits-${selectedAgent.id}`}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SOFT_TRANSITION}
            className="rounded-[1.55rem] border border-white/10 bg-black/35 p-5"
          >
            <div className="mb-4 flex items-center gap-3">
              <MonoIcon>
                <ShieldCheck size={17} />
              </MonoIcon>
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("agentsWorkspace.limits.eyebrow")}
                </p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  {t("agentsWorkspace.limits.title")}
                </h3>
              </div>
            </div>

            <div className="grid gap-2.5 lg:grid-cols-3">
              {limitations.map((item, index) => (
                <motion.div
                  key={item}
                  initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    ...SOFT_TRANSITION,
                    delay: reducedMotion ? 0 : index * 0.06,
                  }}
                  className="rounded-[1.05rem] border border-white/[0.08] bg-black/45 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <XCircle size={15} className="text-neutral-500" />
                    <span className="font-mono text-[9px] text-neutral-700">
                      0{index + 1}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-neutral-400">{item}</p>
                </motion.div>
              ))}
            </div>
          </motion.section>
        </AnimatePresence>

        <section className="rounded-[1.55rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.006)_58%)] p-5">
          <div className="flex items-start gap-3">
            <MonoIcon>
              <BadgeCheck size={17} />
            </MonoIcon>
            <div>
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("agentsWorkspace.boundary.eyebrow")}
              </p>
              <h3 className="mt-1 text-base font-semibold text-white">
                {t("agentsWorkspace.boundary.title")}
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                {t("agentsWorkspace.boundary.description")}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <div className="flex items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-black/35 p-3 text-xs text-neutral-400">
              <TerminalSquare size={14} className="text-neutral-500" />
              {t("agentsWorkspace.boundary.provider")}
            </div>
            <div className="flex items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-black/35 p-3 text-xs text-neutral-400">
              <Boxes size={14} className="text-neutral-500" />
              {t("agentsWorkspace.boundary.agent")}
            </div>
            <div className="flex items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-black/35 p-3 text-xs text-neutral-400">
              <Gauge size={14} className="text-neutral-500" />
              {t("agentsWorkspace.boundary.preview")}
            </div>
          </div>
        </section>
      </section>

      <WorkflowLane
        profileName={selectedName}
        t={t}
        reducedMotion={reducedMotion}
      />

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-white/10 bg-black/35 px-5 py-4">
        <div className="flex items-center gap-3">
          <MonoIcon>
            <FileCheck2 size={17} />
          </MonoIcon>
          <div>
            <p className="text-sm font-semibold text-white">
              {t("agentsWorkspace.footer.title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              {t("agentsWorkspace.footer.description")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <span>{t("agentsWorkspace.footer.context")}</span>
          <ArrowRight size={13} />
          <span className="text-neutral-300">{selectedName}</span>
          <ArrowRight size={13} />
          <span>{t("agentsWorkspace.footer.taskPack")}</span>
        </div>
      </footer>
    </motion.section>
  );
}
