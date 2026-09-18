import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  FileCheck2,
  FileText,
  Layers3,
  ListChecks,
  MousePointer2,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  XCircle,
} from "lucide-react";

import { AiToolLogo } from "../components/ai/AiToolLogo";
import { Button } from "../components/ui/Button";
import "./agentsWorkspace.css";

interface AgentsPageProps {
  onOpenContextBuilder?: () => void;
  onOpenTemplates?: () => void;
}

type AgentProfileId = "codex" | "cursor" | "claude" | "gemini" | "generic";
type DetailSectionId = "fit" | "prompt" | "verify" | "limits" | "boundary";

type AgentProfileDefinition = {
  id: AgentProfileId;
  readiness: "primary" | "ide" | "cli" | "experimental" | "fallback";
  bestForCount: number;
  promptCount: number;
  verificationCount: number;
  limitationCount: number;
  templateCount: number;
};

type DetailSection = {
  id: DetailSectionId;
  eyebrow: string;
  title: string;
  icon: ReactNode;
  count?: number;
  content: ReactNode;
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
  duration: 0.3,
  ease: [0.16, 1, 0.3, 1],
} as const;

const CONSOLE_SIGNALS = [
  { key: "context", icon: <Layers3 size={14} /> },
  { key: "instructions", icon: <Braces size={14} /> },
  { key: "response", icon: <FileCheck2 size={14} /> },
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

function usePageVisibility() {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return visible;
}

function MonoIcon({ children }: { children: ReactNode }) {
  return <span className="agents-v2-mono-icon">{children}</span>;
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
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = (index: number) => {
    const bounded = (index + AGENT_PROFILES.length) % AGENT_PROFILES.length;
    onSelect(AGENT_PROFILES[bounded]);
    window.requestAnimationFrame(() => buttonRefs.current[bounded]?.focus());
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectAt(index + 1);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectAt(index - 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      selectAt(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      selectAt(AGENT_PROFILES.length - 1);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t("agentsWorkspace.selector.ariaLabel")}
      className="agents-v2-profile-rail"
      style={{
        gridTemplateColumns: `repeat(${AGENT_PROFILES.length}, minmax(0, 1fr))`,
      }}
    >
      <motion.span
        aria-hidden="true"
        className="agents-v2-profile-pill"
        style={{ width: `calc((100% - 8px) / ${AGENT_PROFILES.length})` }}
        initial={false}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={PROFILE_TRANSITION}
      />

      {AGENT_PROFILES.map((profile, index) => {
        const isActive = index === activeIndex;

        return (
          <button
            key={profile.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => onSelect(profile)}
            className={`agents-v2-profile-tab ${isActive ? "is-active" : ""}`}
          >
            <AiToolLogo
              tool={profile.id}
              size="md"
              contrast={isActive ? "onLight" : "default"}
              tone="monochrome"
              className={isActive ? "agents-v2-profile-logo-active" : ""}
            />

            <span className="min-w-0">
              <span className="agents-v2-profile-name">
                {t(getProfileKey(profile, "name"))}
              </span>
              <span className="agents-v2-profile-role">
                {t(getProfileKey(profile, "role"))}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AgentCore3D({
  profile,
  name,
  reducedMotion,
  pageVisible,
  t,
}: {
  profile: AgentProfileDefinition;
  name: string;
  reducedMotion: boolean;
  pageVisible: boolean;
  t: TFunction;
}) {
  const rawRotateX = useMotionValue(0);
  const rawRotateY = useMotionValue(0);
  const rotateX = useSpring(rawRotateX, { stiffness: 160, damping: 24, mass: 0.65 });
  const rotateY = useSpring(rawRotateY, { stiffness: 160, damping: 24, mass: 0.65 });
  const motionEnabled = !reducedMotion && pageVisible;
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    setInspectorOpen(false);
  }, [profile.id]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!motionEnabled || event.pointerType === "touch") {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    rawRotateY.set(nx * 7.5);
    rawRotateX.set(ny * -5.5);
  };

  const resetTilt = () => {
    rawRotateX.set(0);
    rawRotateY.set(0);
  };

  const labels = [
    { key: "context", text: t("agentsWorkspace.showcase.orbitContext") },
    { key: "rules", text: t("agentsWorkspace.showcase.orbitRules") },
    { key: "checks", text: t("agentsWorkspace.showcase.orbitChecks") },
    { key: "package", text: t("agentsWorkspace.workflow.packageTitle") },
  ];

  const inspectorSignals = CONSOLE_SIGNALS.map((signal) => ({
    key: signal.key,
    label: t(`agentsWorkspace.signals.${signal.key}`),
    value: t(getProfileKey(profile, `signals.${signal.key}.value`)),
  }));

  const scenePulseTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 1.05, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <div
      className={`agents-v2-scene ${motionEnabled ? "" : "agents-v2-motion-off"} ${
        inspectorOpen ? "is-inspecting" : ""
      }`}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
    >
      <div className="agents-v2-scene-grid" aria-hidden="true" />
      <div className="agents-v2-scene-vignette" aria-hidden="true" />
      <div className="agents-v2-scene-scan" aria-hidden="true" />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={profile.id}
          aria-hidden="true"
          className="agents-v2-scene-switch-pulse"
          initial={reducedMotion ? false : { opacity: 0, scale: 0.76 }}
          animate={
            reducedMotion
              ? { opacity: 0.16, scale: 1 }
              : { opacity: [0, 0.32, 0], scale: [0.76, 1.02, 1.22] }
          }
          exit={{ opacity: 0 }}
          transition={scenePulseTransition}
        />
      </AnimatePresence>

      {labels.map((label, index) => (
        <div
          key={label.key}
          className={`agents-v2-orbit-label agents-v2-orbit-label-${index + 1}`}
        >
          <CircleDot size={10} />
          <span>{label.text}</span>
        </div>
      ))}

      <motion.div
        className="agents-v2-space"
        style={{ rotateX, rotateY }}
      >
        <div className="agents-v2-depth-halo agents-v2-depth-halo-outer" />
        <div className="agents-v2-depth-halo agents-v2-depth-halo-inner" />

        <div className="agents-v2-orbit-plane agents-v2-orbit-plane-a">
          <div className="agents-v2-orbit-track agents-v2-orbit-track-a">
            <span className="agents-v2-orbit-sweep agents-v2-orbit-sweep-a" />
            <span className="agents-v2-orbit-node agents-v2-node-a1" />
            <span className="agents-v2-orbit-node agents-v2-node-a2" />
          </div>
        </div>

        <div className="agents-v2-orbit-plane agents-v2-orbit-plane-b">
          <div className="agents-v2-orbit-track agents-v2-orbit-track-b">
            <span className="agents-v2-orbit-sweep agents-v2-orbit-sweep-b" />
            <span className="agents-v2-orbit-node agents-v2-node-b1" />
            <span className="agents-v2-orbit-node agents-v2-node-b2" />
          </div>
        </div>

        <div className="agents-v2-orbit-plane agents-v2-orbit-plane-c">
          <div className="agents-v2-orbit-track agents-v2-orbit-track-c">
            <span className="agents-v2-orbit-sweep agents-v2-orbit-sweep-c" />
            <span className="agents-v2-orbit-node agents-v2-node-c1" />
          </div>
        </div>

        <div className="agents-v2-ray agents-v2-ray-1">
          <span className="agents-v2-ray-pulse" />
        </div>
        <div className="agents-v2-ray agents-v2-ray-2">
          <span className="agents-v2-ray-pulse" />
        </div>
        <div className="agents-v2-ray agents-v2-ray-3">
          <span className="agents-v2-ray-pulse" />
        </div>
        <div className="agents-v2-ray agents-v2-ray-4">
          <span className="agents-v2-ray-pulse" />
        </div>

        <div className="agents-v2-core-shell agents-v2-core-shell-back" />
        <div className="agents-v2-core-shell agents-v2-core-shell-mid" />

        <button
          type="button"
          className="agents-v2-core"
          aria-expanded={inspectorOpen}
          aria-controls="agents-v2-core-inspector"
          aria-label={`${t("agentsWorkspace.showcase.profilePreview")}: ${name}`}
          onClick={() => setInspectorOpen((current) => !current)}
        >
          <div className="agents-v2-core-glass" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={profile.id}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.78, rotateZ: -7 }}
              animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
              exit={{ opacity: 0, scale: 0.84, rotateZ: 7 }}
              transition={PROFILE_TRANSITION}
              className="agents-v2-core-logo"
            >
              <AiToolLogo
                tool={profile.id}
                size="lg"
                tone="monochrome"
                className="agents-v2-core-logo-tile"
              />
            </motion.div>
          </AnimatePresence>
          <span className="agents-v2-core-ring agents-v2-core-ring-a" />
          <span className="agents-v2-core-ring agents-v2-core-ring-b" />
          <span className="agents-v2-core-corner agents-v2-core-corner-tl" />
          <span className="agents-v2-core-corner agents-v2-core-corner-tr" />
          <span className="agents-v2-core-corner agents-v2-core-corner-bl" />
          <span className="agents-v2-core-corner agents-v2-core-corner-br" />
          <span className="agents-v2-core-cue">
            <MousePointer2 size={10} />
            {t("agentsWorkspace.showcase.profilePreview")}
          </span>
        </button>
      </motion.div>

      <AnimatePresence initial={false}>
        {inspectorOpen && (
          <>
            <motion.div
              aria-hidden="true"
              initial={reducedMotion ? false : { opacity: 0, scaleX: 0.65 }}
              animate={{ opacity: 1, scaleX: 1 }}
              exit={{ opacity: 0, scaleX: 0.82 }}
              transition={SOFT_TRANSITION}
              className="agents-v2-core-inspector-bridge"
            />
            <motion.aside
              id="agents-v2-core-inspector"
              initial={reducedMotion ? false : { opacity: 0, x: 12, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 8, scale: 0.98 }}
              transition={SOFT_TRANSITION}
              className="agents-v2-core-inspector"
            >
              <div className="agents-v2-core-inspector-head">
              <div className="flex min-w-0 items-center gap-2.5">
                <AiToolLogo tool={profile.id} size="sm" tone="monochrome" />
                <div className="min-w-0">
                  <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                    {t("agentsWorkspace.showcase.profilePreview")}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-white">{name}</p>
                </div>
              </div>
            </div>

            <p className="agents-v2-core-inspector-role">
              {t(getProfileKey(profile, "role"))}
            </p>
            <p className="agents-v2-core-inspector-summary">
              {t(getProfileKey(profile, "summary"))}
            </p>

            <div className="agents-v2-core-inspector-signals">
              {inspectorSignals.map((signal) => (
                <div key={signal.key} className="agents-v2-core-inspector-signal">
                  <span>{signal.label}</span>
                  <strong>{signal.value}</strong>
                </div>
              ))}
            </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="agents-v2-core-hud">
        <div className="min-w-0">
          <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
            {t("agentsWorkspace.showcase.activeProfile")}
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={profile.id}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={SOFT_TRANSITION}
              className="mt-1 truncate text-base font-semibold tracking-[-0.03em] text-white"
            >
              {name}
            </motion.p>
          </AnimatePresence>
        </div>
        <span className="agents-v2-readiness-pill">
          {t(`agentsWorkspace.readiness.${profile.readiness}`)}
        </span>
      </div>
    </div>
  );
}

function SignalStrip({
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
    <div className="agents-v2-signal">
      <span className="agents-v2-signal-icon">{icon}</span>
      <div className="min-w-0">
        <p className="cf-tech-label text-[8px] uppercase text-neutral-600">{label}</p>
        <p className="mt-0.5 text-xs font-semibold text-neutral-100">{value}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-neutral-600">
          {caption}
        </p>
      </div>
    </div>
  );
}

function DetailList({
  items,
  numbered = false,
  negative = false,
}: {
  items: string[];
  numbered?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="agents-v2-detail-list">
      {items.map((item, index) => (
        <div key={item} className="agents-v2-detail-item">
          <span className="agents-v2-detail-index">
            {numbered ? (
              index + 1
            ) : negative ? (
              <XCircle size={12} />
            ) : (
              <Check size={12} />
            )}
          </span>
          <p>{item}</p>
        </div>
      ))}
    </div>
  );
}

function BoundaryDetail({ t }: { t: TFunction }) {
  const rows = [
    { icon: <Sparkles size={14} />, text: t("agentsWorkspace.boundary.provider") },
    { icon: <Target size={14} />, text: t("agentsWorkspace.boundary.agent") },
    { icon: <ShieldCheck size={14} />, text: t("agentsWorkspace.boundary.preview") },
  ];

  return (
    <div className="agents-v2-boundary-detail">
      <p className="agents-v2-boundary-copy">
        {t("agentsWorkspace.boundary.description")}
      </p>
      <div className="agents-v2-boundary-rows">
        {rows.map((row) => (
          <div key={row.text} className="agents-v2-boundary-row">
            <span>{row.icon}</span>
            <p>{row.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailDeck({
  sections,
  activeSection,
  onToggle,
  reducedMotion,
}: {
  sections: DetailSection[];
  activeSection: DetailSectionId | null;
  onToggle: (id: DetailSectionId) => void;
  reducedMotion: boolean;
}) {
  const selected = sections.find((section) => section.id === activeSection) ?? null;

  return (
    <section className="agents-v2-details">
      <div className="agents-v2-detail-tabs">
        {sections.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              aria-expanded={isActive}
              aria-controls="agents-v2-detail-panel"
              onClick={() => onToggle(section.id)}
              className={`agents-v2-detail-tab ${isActive ? "is-active" : ""}`}
            >
              <span className="agents-v2-detail-tab-icon">{section.icon}</span>
              <span className="min-w-0 flex-1 text-left">
                <span className="agents-v2-detail-tab-eyebrow">{section.eyebrow}</span>
                <span className="agents-v2-detail-tab-title">{section.title}</span>
              </span>
              {typeof section.count === "number" && (
                <span className="agents-v2-detail-count">{section.count}</span>
              )}
              <ChevronDown
                size={14}
                className={`agents-v2-detail-chevron ${isActive ? "is-active" : ""}`}
              />
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {selected && (
          <motion.div
            id="agents-v2-detail-panel"
            key={selected.id}
            initial={reducedMotion ? false : { opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={SOFT_TRANSITION}
            className="agents-v2-detail-panel"
          >
            <div className="agents-v2-detail-panel-inner">
              <div className="agents-v2-detail-panel-heading">
                <MonoIcon>{selected.icon}</MonoIcon>
                <div>
                  <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                    {selected.eyebrow}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-white">{selected.title}</h3>
                </div>
              </div>
              <div className="min-w-0 flex-1">{selected.content}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function WorkflowLane({
  profileName,
  t,
}: {
  profileName: string;
  t: TFunction;
}) {
  const steps = [
    {
      key: "context",
      icon: <Layers3 size={14} />,
      title: t("agentsWorkspace.workflow.contextTitle"),
      caption: t("agentsWorkspace.workflow.contextCaption"),
    },
    {
      key: "profile",
      icon: <Target size={14} />,
      title: profileName,
      caption: t("agentsWorkspace.workflow.profileCaption"),
    },
    {
      key: "package",
      icon: <FileText size={14} />,
      title: t("agentsWorkspace.workflow.packageTitle"),
      caption: t("agentsWorkspace.workflow.packageCaption"),
    },
  ];

  return (
    <section className="agents-v2-workflow">
      <div className="agents-v2-workflow-copy">
        <div className="flex items-center gap-2">
          <Route size={15} className="text-neutral-500" />
          <div>
            <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
              {t("agentsWorkspace.workflow.eyebrow")}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold text-white">
              {t("agentsWorkspace.workflow.title")}
            </h3>
          </div>
        </div>
        <p className="agents-v2-workflow-description">
          {t("agentsWorkspace.workflow.description")}
        </p>
      </div>

      <div className="agents-v2-workflow-lane">
        {steps.map((step, index) => (
          <div key={step.key} className="contents">
            <div className="agents-v2-workflow-step">
              <span className="agents-v2-workflow-icon">{step.icon}</span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-neutral-100">{step.title}</p>
                <p className="agents-v2-workflow-caption">{step.caption}</p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <ArrowRight size={14} className="agents-v2-workflow-arrow" />
            )}
          </div>
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
  const pageVisible = usePageVisibility();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentProfileId>("codex");
  const [activeDetail, setActiveDetail] = useState<DetailSectionId | null>(null);

  const selectedAgent = useMemo(
    () =>
      AGENT_PROFILES.find((profile) => profile.id === selectedAgentId) ??
      AGENT_PROFILES[0],
    [selectedAgentId],
  );

  useEffect(() => {
    setActiveDetail(null);
  }, [selectedAgentId]);

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

  const detailSections: DetailSection[] = [
    {
      id: "fit",
      eyebrow: t("agentsWorkspace.blueprint.fitEyebrow"),
      title: t("agentsWorkspace.blueprint.fitTitle"),
      icon: <Target size={15} />,
      count: bestFor.length,
      content: <DetailList items={bestFor} />,
    },
    {
      id: "prompt",
      eyebrow: t("agentsWorkspace.blueprint.promptEyebrow"),
      title: t("agentsWorkspace.blueprint.promptTitle"),
      icon: <Code2 size={15} />,
      count: promptStyle.length,
      content: <DetailList items={promptStyle} numbered />,
    },
    {
      id: "verify",
      eyebrow: t("agentsWorkspace.blueprint.verifyEyebrow"),
      title: t("agentsWorkspace.blueprint.verifyTitle"),
      icon: <ListChecks size={15} />,
      count: verification.length,
      content: <DetailList items={verification} numbered />,
    },
    {
      id: "limits",
      eyebrow: t("agentsWorkspace.limits.eyebrow"),
      title: t("agentsWorkspace.limits.title"),
      icon: <ShieldCheck size={15} />,
      count: limitations.length,
      content: <DetailList items={limitations} negative />,
    },
    {
      id: "boundary",
      eyebrow: t("agentsWorkspace.boundary.eyebrow"),
      title: t("agentsWorkspace.boundary.title"),
      icon: <Workflow size={15} />,
      content: <BoundaryDetail t={t} />,
    },
  ];

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={SOFT_TRANSITION}
      className="agents-v2-page"
    >
      <motion.header
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT_TRANSITION}
        className="agents-v2-header"
      >
        <div className="agents-v2-header-copy">
          <MonoIcon>
            <Sparkles size={16} />
          </MonoIcon>
          <div>
            <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
              {t("agentsWorkspace.header.eyebrow")}
            </p>
            <div className="agents-v2-title-row">
              <h2>{t("agentsWorkspace.header.title")}</h2>
              <span className="agents-v2-count-pill">
                {AGENT_PROFILES.length} {t("agentsWorkspace.header.profiles")}
              </span>
            </div>
            <p className="agents-v2-header-description">
              {t("agentsWorkspace.header.description")}
            </p>
          </div>
        </div>

        <div className="agents-v2-header-route" aria-label={t("agentsWorkspace.workflow.title")}>
          <span>{t("agentsWorkspace.footer.context")}</span>
          <ArrowRight size={12} />
          <span className="is-active">{selectedName}</span>
          <ArrowRight size={12} />
          <span>{t("agentsWorkspace.footer.taskPack")}</span>
        </div>
      </motion.header>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SOFT_TRANSITION, delay: reducedMotion ? 0 : 0.05 }}
      >
        <ProfileRail
          activeIndex={activeAgentIndex}
          onSelect={(profile) => setSelectedAgentId(profile.id)}
          t={t}
        />
      </motion.div>

      <section className="agents-v2-hero">
        <AnimatePresence mode="wait">
          <motion.div
            key={`core-${selectedAgent.id}`}
            initial={reducedMotion ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 9 }}
            transition={SOFT_TRANSITION}
            className="min-w-0"
          >
            <AgentCore3D
              profile={selectedAgent}
              name={selectedName}
              reducedMotion={reducedMotion}
              pageVisible={pageVisible}
              t={t}
            />
          </motion.div>
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.article
            key={`profile-${selectedAgent.id}`}
            initial={reducedMotion ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -9 }}
            transition={SOFT_TRANSITION}
            className="agents-v2-profile-card"
          >
            <div className="agents-v2-profile-card-top">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="agents-v2-kicker-pill">
                    {t("agentsWorkspace.showcase.profilePreview")}
                  </span>
                  <span className="agents-v2-readiness-pill">
                    {t(`agentsWorkspace.readiness.${selectedAgent.readiness}`)}
                  </span>
                </div>
                <h3 className="agents-v2-agent-name">{selectedName}</h3>
                <p className="mt-1.5 text-xs font-medium text-neutral-300">{selectedRole}</p>
                <p className="agents-v2-agent-summary">
                  {t(getProfileKey(selectedAgent, "summary"))}
                </p>
              </div>

              <div className="agents-v2-actions">
                {onOpenContextBuilder && (
                  <Button
                    variant="primary"
                    className="rounded-xl"
                    onClick={onOpenContextBuilder}
                  >
                    <Workflow size={14} />
                    {t("agentsWorkspace.actions.openContext")}
                  </Button>
                )}
                {onOpenTemplates && (
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    onClick={onOpenTemplates}
                  >
                    <Layers3 size={14} />
                    {t("agentsWorkspace.actions.openTemplates")}
                  </Button>
                )}
              </div>
            </div>

            <div className="agents-v2-signals">
              {CONSOLE_SIGNALS.map((signal) => (
                <SignalStrip
                  key={signal.key}
                  icon={signal.icon}
                  label={t(`agentsWorkspace.signals.${signal.key}`)}
                  value={t(getProfileKey(selectedAgent, `signals.${signal.key}.value`))}
                  caption={t(
                    getProfileKey(selectedAgent, `signals.${signal.key}.caption`),
                  )}
                />
              ))}
            </div>

            <div className="agents-v2-guidance">
              <div className="agents-v2-guidance-heading">
                <MonoIcon>
                  <Route size={15} />
                </MonoIcon>
                <div>
                  <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                    {t("agentsWorkspace.showcase.guidanceEyebrow")}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-white">
                    {t("agentsWorkspace.showcase.guidanceTitle")}
                  </p>
                </div>
              </div>
              <p className="agents-v2-guidance-copy">
                {t(getProfileKey(selectedAgent, "guidance"))}
              </p>
              <div className="agents-v2-template-row">
                {templates.map((template) => (
                  <span key={template}>{template}</span>
                ))}
              </div>
            </div>
          </motion.article>
        </AnimatePresence>
      </section>

      <DetailDeck
        sections={detailSections}
        activeSection={activeDetail}
        onToggle={(id) => setActiveDetail((current) => (current === id ? null : id))}
        reducedMotion={reducedMotion}
      />

      <WorkflowLane profileName={selectedName} t={t} />

      <footer className="agents-v2-footer">
        <div className="flex min-w-0 items-center gap-3">
          <MonoIcon>
            <CheckCircle2 size={15} />
          </MonoIcon>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">
              {t("agentsWorkspace.footer.title")}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-neutral-600">
              {t("agentsWorkspace.footer.description")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActiveDetail("boundary")}
          className="agents-v2-footer-link"
        >
          {t("agentsWorkspace.boundary.eyebrow")}
          <ChevronRight size={13} />
        </button>
      </footer>
    </motion.section>
  );
}
