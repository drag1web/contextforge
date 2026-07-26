import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  Copy,
  FileCode2,
  Folder,
  Globe2,
  Layers3,
  ListChecks,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import {
  createAcceptanceCriteriaPreset,
  createRuleItem,
  createRuleProfile,
  createTemplate,
  deleteAcceptanceCriteriaPreset,
  deleteRuleItem,
  deleteRuleProfile,
  deleteTemplate,
  getRuleProfilesCatalog,
  getTemplates,
  updateAcceptanceCriteriaPreset,
  updateRuleItem,
  updateRuleProfile,
  updateTemplate,
} from "../api/client";
import { AiToolLogo } from "../components/ai/AiToolLogo";
import { Button } from "../components/ui/Button";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import type {
  AcceptanceCriteriaPreset,
  PromptTemplate,
  RuleCategory,
  RuleItem,
  RuleProfile,
  TargetTool,
  TemplateTaskType,
} from "../types";
import {
  TEMPLATES_STUDIO_COPY,
  type TemplatesStudioCopy,
} from "./templatesStudioCopy";

type StudioTab = "templates" | "profiles" | "rules" | "criteria";
type SourceFilter = "all" | "custom" | "builtin";
type EditorMode = "create" | "edit";
type EditorStep = "setup" | "structure" | "preview";
type CatalogEntity =
  | { kind: "template"; data: PromptTemplate }
  | { kind: "profile"; data: RuleProfile }
  | { kind: "rule"; data: RuleItem }
  | { kind: "criteria"; data: AcceptanceCriteriaPreset };

type EditorState =
  | { kind: "template"; mode: EditorMode; source?: PromptTemplate }
  | { kind: "profile"; mode: EditorMode; source?: RuleProfile }
  | { kind: "rule"; mode: EditorMode; source?: RuleItem }
  | { kind: "criteria"; mode: EditorMode; source?: AcceptanceCriteriaPreset }
  | null;

type ToastState = {
  tone: "success" | "warning" | "neutral";
  message: string;
} | null;

const TASK_TYPES: TemplateTaskType[] = [
  "general",
  "ui",
  "backend",
  "fullstack",
  "build",
  "bugfix",
  "refactor",
  "docs",
  "tests",
];

const RULE_CATEGORIES: RuleCategory[] = [
  "general",
  "ui",
  "backend",
  "bugfix",
  "refactor",
  "docs",
  "tests",
  "assets",
  "verification",
];

const TARGET_TOOLS: TargetTool[] = [
  "codex",
  "cursor",
  "claude",
  "gemini",
  "generic",
];

const TARGET_LABELS: Record<TargetTool, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude: "Claude Code",
  gemini: "Gemini",
  generic: "Generic",
};

const DEFAULT_TEMPLATE_CONTENT = `# AI Task Pack

## Target Tool

{{targetToolLabel}}

## Task

{{rawTask}}

## Project Context

- Project: {{projectName}}
- Detected stack: {{detectedStack}}
- Readiness score: {{readinessScore}}

## Constraints

{{rules}}

## Acceptance Criteria

{{acceptanceCriteria}}

## Verification

{{verification}}

## Expected Final Response

Return changed files, a concise summary, verification and remaining risks.`;

const DEFAULT_PROFILE_RULE_IDS = [
  "rule.general.no-invented-files",
  "rule.general.inspect-first",
  "rule.general.focused-scope",
  "rule.verification.no-fake-tests",
];

const PANEL_TRANSITION = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1],
} as const;

function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    copy,
  );
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueLines(value: string, limit = 30) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function getEntityName(entity: CatalogEntity) {
  return entity.kind === "rule" ? entity.data.title : entity.data.name;
}

function getEntityDescription(entity: CatalogEntity, c: TemplatesStudioCopy) {
  return entity.data.description || c.noDescription;
}

function isBuiltin(entity: CatalogEntity) {
  return entity.data.isBuiltin;
}

function tabForKind(kind: CatalogEntity["kind"]): StudioTab {
  if (kind === "template") return "templates";
  if (kind === "profile") return "profiles";
  if (kind === "rule") return "rules";
  return "criteria";
}

function kindForTab(tab: StudioTab): CatalogEntity["kind"] {
  if (tab === "templates") return "template";
  if (tab === "profiles") return "profile";
  if (tab === "rules") return "rule";
  return "criteria";
}

function entityMatchesSource(entity: CatalogEntity, source: SourceFilter) {
  if (source === "all") return true;
  return source === "builtin" ? entity.data.isBuiltin : !entity.data.isBuiltin;
}

function getTemplateVariables(content: string) {
  return Array.from(
    new Set(
      Array.from(content.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)).map(
        (match) => match[1],
      ),
    ),
  );
}

function getTemplateSections(content: string) {
  return Array.from(content.matchAll(/^#{1,3}\s+(.+)$/gm)).map((match) =>
    match[1].trim(),
  );
}

function getCopyName(name: string, isRussian: boolean) {
  const prefix = isRussian ? "Копия" : "Copy of";
  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name
    : `${prefix} ${name}`;
}

function getDateLabel(
  value: string | undefined,
  locale: string,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function targetIcon(
  tool: TargetTool,
  size: "sm" | "md" | "lg" = "md",
  contrast: "default" | "onLight" = "default",
) {
  return (
    <AiToolLogo
      tool={tool === "claude" ? "claudecode" : tool}
      size={size}
      contrast={contrast}
      tone="monochrome"
    />
  );
}

function SourceBadge({
  builtin,
  c,
}: {
  builtin: boolean;
  c: TemplatesStudioCopy;
}) {
  return (
    <span
      className={[
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
        builtin
          ? "border-white/10 bg-white/[0.035] text-neutral-500"
          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
      ].join(" ")}
    >
      {builtin ? <LockKeyhole size={11} /> : <CheckCircle2 size={11} />}
      {builtin ? c.builtIn : c.custom}
    </span>
  );
}

function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-neutral-900 bg-black/45 px-2.5 text-[10px] font-medium text-neutral-500">
      {children}
    </span>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[110px] border-l border-white/[0.07] px-4 first:border-l-0">
      <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function CatalogFilterPanel({
  icon,
  title,
  caption,
  children,
}: {
  icon: ReactNode;
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-[218px] flex-col rounded-[1.4rem] border border-neutral-900 bg-black/40 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.055] pb-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-xl border border-neutral-900 bg-black/55 text-neutral-500">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-xs font-semibold text-white">{title}</h2>
          <p className="cf-tech-label mt-0.5 truncate text-[8px] uppercase text-neutral-700">
            {caption}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1">{children}</div>
    </section>
  );
}

function CatalogFilterButton({
  active,
  label,
  count,
  icon,
  onClick,
  iconSurface = true,
}: {
  active: boolean;
  label: string;
  count: number;
  icon?: ReactNode;
  onClick: () => void;
  iconSurface?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex h-10 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left transition duration-150",
        active
          ? "border-white bg-white text-black shadow-[0_8px_24px_rgba(255,255,255,0.08)]"
          : "border-transparent text-neutral-500 hover:border-neutral-800 hover:bg-white/[0.025] hover:text-white",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          iconSurface ? (
            <span
              className={[
                "grid size-6 shrink-0 place-items-center rounded-lg border transition",
                active
                  ? "border-black/10 bg-black/[0.04] text-black"
                  : "border-neutral-900 bg-black/35 text-neutral-600 group-hover:text-neutral-300",
              ].join(" ")}
            >
              {icon}
            </span>
          ) : (
            <span className="grid size-6 shrink-0 place-items-center">{icon}</span>
          )
        ) : null}
        <span className="truncate text-xs font-semibold">{label}</span>
      </span>
      <span
        className={[
          "shrink-0 font-mono text-[10px] tabular-nums",
          active ? "text-black/55" : "text-neutral-700",
        ].join(" ")}
      >
        {count}
      </span>
    </button>
  );
}

function ActionMenu({
  entity,
  c,
  onOpen,
  onDuplicate,
  onEdit,
  onDelete,
  onCopyId,
  open,
  onOpenChange,
}: {
  entity: CatalogEntity;
  c: TemplatesStudioCopy;
  onOpen: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyId: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target)) onOpenChange(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <div ref={rootRef} className="relative z-20 shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        className={[
          "grid size-9 place-items-center rounded-xl border transition",
          open
            ? "border-white bg-white text-black"
            : "border-neutral-900 bg-black/45 text-neutral-500 hover:border-white/20 hover:text-white",
        ].join(" ")}
        aria-label={c.actions}
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-2xl border border-neutral-800 bg-black/98 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => run(onOpen)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs text-neutral-300 transition hover:bg-white hover:text-black"
            >
              <BookOpen size={14} />
              {c.open}
            </button>
            <button
              type="button"
              onClick={() => run(onDuplicate)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs text-neutral-300 transition hover:bg-white hover:text-black"
            >
              <Copy size={14} />
              {c.duplicate}
            </button>
            {!isBuiltin(entity) ? (
              <button
                type="button"
                onClick={() => run(onEdit)}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs text-neutral-300 transition hover:bg-white hover:text-black"
              >
                <Pencil size={14} />
                {c.edit}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => run(onCopyId)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs text-neutral-300 transition hover:bg-white hover:text-black"
            >
              <Clipboard size={14} />
              {c.copyId}
            </button>
            {!isBuiltin(entity) ? (
              <>
                <div className="my-1 border-t border-neutral-900" />
                <button
                  type="button"
                  onClick={() => run(onDelete)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs text-red-200 transition hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                  {c.delete}
                </button>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function EntityIcon({ entity }: { entity: CatalogEntity }) {
  if (entity.kind === "template") return targetIcon(entity.data.targetTool, "md");

  const commonClass =
    "grid size-7 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-neutral-300";

  if (entity.kind === "profile") {
    return (
      <span className={commonClass}>
        <ShieldCheck size={14} />
      </span>
    );
  }

  if (entity.kind === "rule") {
    return (
      <span className={commonClass}>
        <SlidersHorizontal size={14} />
      </span>
    );
  }

  return (
    <span className={commonClass}>
      <ListChecks size={14} />
    </span>
  );
}

function EntityMeta({
  entity,
  c,
}: {
  entity: CatalogEntity;
  c: TemplatesStudioCopy;
}) {
  if (entity.kind === "template") {
    return (
      <>
        <CountBadge>{TARGET_LABELS[entity.data.targetTool]}</CountBadge>
        <CountBadge>{c.taskTypes[entity.data.taskType]}</CountBadge>
      </>
    );
  }

  if (entity.kind === "profile") {
    return (
      <>
        <CountBadge>{c.taskTypes[entity.data.taskType]}</CountBadge>
        <CountBadge>
          {format(c.itemCount, { count: entity.data.enabledRuleIds.length })}
        </CountBadge>
      </>
    );
  }

  if (entity.kind === "rule") {
    return <CountBadge>{c.categories[entity.data.category]}</CountBadge>;
  }

  return (
    <>
      <CountBadge>{c.taskTypes[entity.data.taskType]}</CountBadge>
      <CountBadge>
        {format(c.itemCount, { count: entity.data.criteria.length })}
      </CountBadge>
    </>
  );
}

function CatalogRow({
  entity,
  selected,
  c,
  locale,
  onSelect,
  onDuplicate,
  onEdit,
  onDelete,
  onCopyId,
}: {
  entity: CatalogEntity;
  selected: boolean;
  c: TemplatesStudioCopy;
  locale: string;
  onSelect: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyId: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const timestamp = entity.data.updatedAt ?? entity.data.createdAt;

  return (
    <motion.article
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.16 }}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={[
        "group relative flex min-h-[92px] cursor-pointer items-start gap-3 overflow-visible rounded-2xl border p-3.5 outline-none transition duration-150",
        menuOpen ? "z-40" : "z-0",
        selected
          ? "border-white/22 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          : "border-neutral-900 bg-black/35 hover:border-white/14 hover:bg-white/[0.025]",
        "focus-visible:border-white/50 focus-visible:ring-4 focus-visible:ring-white/5",
      ].join(" ")}
    >
      {selected ? (
        <span className="absolute inset-y-3 left-0 w-px rounded-full bg-white/70" />
      ) : null}
      <EntityIcon entity={entity} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-white">
            {getEntityName(entity)}
          </h3>
          <SourceBadge builtin={entity.data.isBuiltin} c={c} />
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">
          {getEntityDescription(entity, c)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <EntityMeta entity={entity} c={c} />
          {timestamp ? (
            <span className="ml-auto text-[10px] text-neutral-700">
              {format(c.updated, {
                date: getDateLabel(timestamp, locale, "—"),
              })}
            </span>
          ) : null}
        </div>
      </div>

      <ActionMenu
        entity={entity}
        c={c}
        onOpen={onSelect}
        onDuplicate={onDuplicate}
        onEdit={onEdit}
        onDelete={onDelete}
        onCopyId={onCopyId}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      />
    </motion.article>
  );
}

function EmptyCatalog({
  c,
  custom,
  onCreate,
}: {
  c: TemplatesStudioCopy;
  custom: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-[1.4rem] border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-500">
          <Search size={18} />
        </span>
        <h3 className="mt-4 text-base font-semibold text-white">
          {custom ? c.emptyCustomTitle : c.emptyTitle}
        </h3>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          {custom ? c.emptyCustomDescription : c.emptyDescription}
        </p>
        <Button variant="primary" className="mt-5" onClick={onCreate}>
          <Plus size={15} />
          {c.create}
        </Button>
      </div>
    </div>
  );
}

function DetailCell({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
      <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
        {label}
      </p>
      <div className="mt-2 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function MarketplaceCard({
  c,
  onOpenWebsite,
}: {
  c: TemplatesStudioCopy;
  onOpenWebsite: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_58%,rgba(255,255,255,0.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-black/55 text-neutral-300">
          <Globe2 size={17} />
        </span>
        <CountBadge>{c.marketplace.planned}</CountBadge>
      </div>
      <p className="cf-tech-label mt-4 text-[9px] uppercase text-neutral-700">
        {c.marketplace.eyebrow}
      </p>
      <h3 className="mt-2 text-base font-semibold leading-6 text-white">
        {c.marketplace.title}
      </h3>
      <p className="mt-2 text-xs leading-5 text-neutral-600">
        {c.marketplace.description}
      </p>
      <div className="mt-4 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-[11px] text-neutral-500">
        {c.marketplace.localFirst}
      </div>
      <Button variant="secondary" className="mt-3 w-full" onClick={onOpenWebsite}>
        <ArrowUpRight size={14} />
        {c.marketplace.openWebsite}
      </Button>
    </section>
  );
}

function Inspector({
  entity,
  c,
  ruleItems,
  profiles,
  criteria,
  onDuplicate,
  onEdit,
  onDelete,
  onOpenWebsite,
}: {
  entity: CatalogEntity | null;
  c: TemplatesStudioCopy;
  ruleItems: RuleItem[];
  profiles: RuleProfile[];
  criteria: AcceptanceCriteriaPreset[];
  onDuplicate: (entity: CatalogEntity) => void;
  onEdit: (entity: CatalogEntity) => void;
  onDelete: (entity: CatalogEntity) => void;
  onOpenWebsite: () => void;
}) {
  if (!entity) {
    return (
      <aside className="space-y-4 xl:sticky xl:top-4">
        <div className="grid min-h-[360px] place-items-center rounded-[1.5rem] border border-neutral-900 bg-black/35 p-6 text-center">
          <div>
            <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-500">
              <BookOpen size={18} />
            </span>
            <h3 className="mt-4 text-base font-semibold text-white">
              {c.inspector.selectTitle}
            </h3>
            <p className="mt-2 text-xs leading-5 text-neutral-600">
              {c.inspector.selectDescription}
            </p>
          </div>
        </div>
        <MarketplaceCard c={c} onOpenWebsite={onOpenWebsite} />
      </aside>
    );
  }

  const entityName = getEntityName(entity);
  const entityDescription = getEntityDescription(entity, c);
  const usedByProfiles =
    entity.kind === "rule"
      ? profiles.filter((profile) => profile.enabledRuleIds.includes(entity.data.id))
      : entity.kind === "criteria"
        ? profiles.filter(
            (profile) =>
              profile.acceptanceCriteriaPresetId === entity.data.id,
          )
        : [];

  return (
    <aside className="space-y-4 xl:sticky xl:top-4">
      <motion.section
        key={`${entity.kind}:${entity.data.id}`}
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
        className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
      >
        <div className="border-b border-neutral-900 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <EntityIcon entity={entity} />
              <div className="min-w-0">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {entity.kind === "template"
                    ? c.inspector.selectedTemplate
                    : entity.kind === "profile"
                      ? c.inspector.selectedProfile
                      : entity.kind === "rule"
                        ? c.inspector.selectedRule
                        : c.inspector.selectedCriteria}
                </p>
                <h2 className="mt-1 truncate text-xl font-semibold tracking-[-0.04em] text-white">
                  {entityName}
                </h2>
              </div>
            </div>
            <SourceBadge builtin={entity.data.isBuiltin} c={c} />
          </div>
          <p className="mt-3 text-xs leading-5 text-neutral-600">
            {entityDescription}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onDuplicate(entity)}>
              <Copy size={14} />
              {c.duplicate}
            </Button>
            {!entity.data.isBuiltin ? (
              <Button variant="secondary" onClick={() => onEdit(entity)}>
                <Pencil size={14} />
                {c.edit}
              </Button>
            ) : null}
            {!entity.data.isBuiltin ? (
              <button
                type="button"
                onClick={() => onDelete(entity)}
                className="grid size-10 place-items-center rounded-xl border border-red-400/15 bg-red-500/[0.035] text-red-200 transition hover:border-red-300/35 hover:bg-red-500/10"
                aria-label={c.delete}
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[calc(100vh-390px)] space-y-3 overflow-y-auto p-4">
          {entity.kind === "template" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <DetailCell
                  label={c.inspector.target}
                  value={
                    <span className="flex items-center gap-2">
                      {targetIcon(entity.data.targetTool, "sm")}
                      {TARGET_LABELS[entity.data.targetTool]}
                    </span>
                  }
                />
                <DetailCell
                  label={c.inspector.taskType}
                  value={c.taskTypes[entity.data.taskType]}
                />
                <DetailCell
                  label={c.inspector.variables}
                  value={getTemplateVariables(entity.data.content).length}
                />
                <DetailCell
                  label={c.inspector.sections}
                  value={getTemplateSections(entity.data.content).length}
                />
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {c.inspector.structure}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {getTemplateSections(entity.data.content)
                    .slice(0, 8)
                    .map((section) => (
                      <CountBadge key={section}>{section}</CountBadge>
                    ))}
                  {getTemplateSections(entity.data.content).length === 0 ? (
                    <span className="text-xs text-neutral-600">
                      {c.inspector.none}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                    {c.inspector.content}
                  </p>
                  <CountBadge>{entity.data.content.length}</CountBadge>
                </div>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-900 bg-black/55 p-3 font-mono text-[11px] leading-5 text-neutral-400">
                  {entity.data.content}
                </pre>
              </div>
            </>
          ) : null}

          {entity.kind === "profile" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <DetailCell
                  label={c.inspector.taskType}
                  value={c.taskTypes[entity.data.taskType]}
                />
                <DetailCell
                  label={c.inspector.rules}
                  value={entity.data.enabledRuleIds.length}
                />
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {c.inspector.rules}
                </p>
                <div className="mt-3 space-y-2">
                  {entity.data.enabledRuleIds.map((ruleId) => {
                    const rule = ruleItems.find((item) => item.id === ruleId);
                    return (
                      <div
                        key={ruleId}
                        className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs text-neutral-400"
                      >
                        {rule?.title ?? ruleId}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {c.inspector.acceptancePreset}
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {criteria.find(
                    (item) => item.id === entity.data.acceptanceCriteriaPresetId,
                  )?.name ?? c.inspector.none}
                </p>
              </div>
              {entity.data.customRules.length > 0 ? (
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                    {c.inspector.customRules}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {entity.data.customRules.map((rule) => (
                      <li
                        key={rule}
                        className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs leading-5 text-neutral-400"
                      >
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}

          {entity.kind === "rule" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <DetailCell
                  label={c.editor.category}
                  value={c.categories[entity.data.category]}
                />
                <DetailCell
                  label={c.inspector.usedBy}
                  value={usedByProfiles.length}
                />
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {c.editor.ruleContent}
                </p>
                <p className="mt-3 text-xs leading-6 text-neutral-300">
                  {entity.data.content}
                </p>
              </div>
              {usedByProfiles.length > 0 ? (
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                    {c.inspector.usedBy}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {usedByProfiles.map((profile) => (
                      <CountBadge key={profile.id}>{profile.name}</CountBadge>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {entity.kind === "criteria" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <DetailCell
                  label={c.inspector.taskType}
                  value={c.taskTypes[entity.data.taskType]}
                />
                <DetailCell
                  label={c.inspector.usedBy}
                  value={usedByProfiles.length}
                />
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {c.inspector.criteria}
                </p>
                <ol className="mt-3 space-y-2">
                  {entity.data.criteria.map((criterion, index) => (
                    <li
                      key={`${criterion}:${index}`}
                      className="flex gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs leading-5 text-neutral-400"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-[10px] text-neutral-400">
                        {index + 1}
                      </span>
                      {criterion}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          ) : null}

          {entity.data.isBuiltin ? (
            <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-xs leading-5 text-neutral-500">
              <LockKeyhole size={15} className="mt-0.5 shrink-0" />
              {c.inspector.safeNotice}
            </div>
          ) : null}
        </div>
      </motion.section>

      {entity.kind === "template" ? (
        <MarketplaceCard c={c} onOpenWebsite={onOpenWebsite} />
      ) : null}
    </aside>
  );
}

function FieldLabel({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold text-neutral-300">{label}</p>
      {hint ? (
        <p className="mt-1 text-[11px] leading-4 text-neutral-700">{hint}</p>
      ) : null}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/55 px-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:ring-4 focus:ring-white/5"
    />
  );
}

function StudioEditor({
  editor,
  c,
  isRussian,
  ruleItems,
  acceptancePresets,
  onClose,
  onSaved,
}: {
  editor: Exclude<EditorState, null>;
  c: TemplatesStudioCopy;
  isRussian: boolean;
  ruleItems: RuleItem[];
  acceptancePresets: AcceptanceCriteriaPreset[];
  onClose: () => void;
  onSaved: (entity: CatalogEntity) => void;
}) {
  const reduceMotion = useReducedMotion();
  const sourceTemplate =
    editor.kind === "template" ? editor.source : undefined;
  const sourceProfile = editor.kind === "profile" ? editor.source : undefined;
  const sourceRule = editor.kind === "rule" ? editor.source : undefined;
  const sourceCriteria =
    editor.kind === "criteria" ? editor.source : undefined;
  const source =
    sourceTemplate ?? sourceProfile ?? sourceRule ?? sourceCriteria;
  const copyMode = editor.mode === "create" && Boolean(source);
  const editing = editor.mode === "edit";

  const sourceName =
    sourceRule?.title ??
    sourceTemplate?.name ??
    sourceProfile?.name ??
    sourceCriteria?.name ??
    "";
  const initialName = copyMode && sourceName
    ? getCopyName(sourceName, isRussian)
    : sourceName;

  const initialTaskType =
    sourceTemplate?.taskType ??
    sourceProfile?.taskType ??
    sourceCriteria?.taskType ??
    "general";
  const initialContent =
    sourceTemplate?.content ??
    sourceRule?.content ??
    (editor.kind === "template" ? DEFAULT_TEMPLATE_CONTENT : "");
  const defaultEnabledRuleIds = DEFAULT_PROFILE_RULE_IDS.filter((ruleId) =>
    ruleItems.some((rule) => rule.id === ruleId),
  );

  const [step, setStep] = useState<EditorStep>("setup");
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(source?.description ?? "");
  const [taskType, setTaskType] = useState<TemplateTaskType>(initialTaskType);
  const [targetTool, setTargetTool] = useState<TargetTool>(
    sourceTemplate?.targetTool ?? "codex",
  );
  const [category, setCategory] = useState<RuleCategory>(
    sourceRule?.category ?? "general",
  );
  const [content, setContent] = useState(initialContent);
  const [enabledRuleIds, setEnabledRuleIds] = useState<string[]>(
    sourceProfile?.enabledRuleIds ?? defaultEnabledRuleIds,
  );
  const [customRulesText, setCustomRulesText] = useState(
    sourceProfile?.customRules.join("\n") ?? "",
  );
  const [acceptancePresetId, setAcceptancePresetId] = useState(
    sourceProfile?.acceptanceCriteriaPresetId ?? "",
  );
  const [criteriaText, setCriteriaText] = useState(
    sourceCriteria?.criteria.join("\n") ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editorSteps = useMemo(
    () => [
      {
        id: "setup" as const,
        label: c.editor.steps.setup,
        caption: c.editor.steps.setupCaption,
      },
      {
        id: "structure" as const,
        label: c.editor.steps.structure,
        caption: c.editor.steps.structureCaption,
      },
      {
        id: "preview" as const,
        label: c.editor.steps.preview,
        caption: c.editor.steps.previewCaption,
      },
    ],
    [c],
  );

  const taskOptions = useMemo<SelectOption<TemplateTaskType>[]>(
    () =>
      TASK_TYPES.map((value) => ({
        value,
        label: c.taskTypes[value],
      })),
    [c],
  );

  const targetOptions = useMemo<SelectOption<TargetTool>[]>(
    () =>
      TARGET_TOOLS.map((value) => ({
        value,
        label: TARGET_LABELS[value],
        icon: targetIcon(value, "sm"),
      })),
    [],
  );

  const categoryOptions = useMemo<SelectOption<RuleCategory>[]>(
    () =>
      RULE_CATEGORIES.map((value) => ({
        value,
        label: c.categories[value],
      })),
    [c],
  );

  const criteriaOptions = useMemo<SelectOption<string>[]>(
    () => [
      {
        value: "",
        label: c.editor.noPreset,
        description: c.editor.noPresetDescription,
      },
      ...acceptancePresets.map((preset) => ({
        value: preset.id,
        label: preset.name,
        description: `${c.taskTypes[preset.taskType]} · ${preset.criteria.length}`,
      })),
    ],
    [acceptancePresets, c],
  );

  const reset = () => {
    setName(initialName);
    setDescription(source?.description ?? "");
    setTaskType(initialTaskType);
    setTargetTool(sourceTemplate?.targetTool ?? "codex");
    setCategory(sourceRule?.category ?? "general");
    setContent(initialContent);
    setEnabledRuleIds(sourceProfile?.enabledRuleIds ?? defaultEnabledRuleIds);
    setCustomRulesText(sourceProfile?.customRules.join("\n") ?? "");
    setAcceptancePresetId(
      sourceProfile?.acceptanceCriteriaPresetId ?? "",
    );
    setCriteriaText(sourceCriteria?.criteria.join("\n") ?? "");
    setError("");
  };

  const validationMessage = useMemo(() => {
    if (name.trim().length < 2) return c.editor.invalidName;
    if (editor.kind === "template" && content.trim().length < 20) {
      return c.editor.invalidTemplate;
    }
    if (editor.kind === "rule" && content.trim().length < 10) {
      return c.editor.invalidRule;
    }
    if (editor.kind === "criteria" && uniqueLines(criteriaText).length === 0) {
      return c.editor.invalidCriteria;
    }
    return "";
  }, [c, content, criteriaText, editor.kind, name]);

  const canSave = !validationMessage && !saving;

  const title =
    editor.kind === "template"
      ? editing
        ? c.editor.templateEdit
        : c.editor.templateCreate
      : editor.kind === "profile"
        ? editing
          ? c.editor.profileEdit
          : c.editor.profileCreate
        : editor.kind === "rule"
          ? editing
            ? c.editor.ruleEdit
            : c.editor.ruleCreate
          : editing
            ? c.editor.criteriaEdit
            : c.editor.criteriaCreate;

  const eyebrow = copyMode
    ? c.editor.copyEyebrow
    : editing
      ? c.editor.editEyebrow
      : c.editor.createEyebrow;

  async function handleSave() {
    if (!canSave) return;

    try {
      setSaving(true);
      setError("");
      let saved: CatalogEntity;

      if (editor.kind === "template") {
        const payload = {
          name: name.trim(),
          description: description.trim(),
          targetTool,
          taskType,
          content,
        };
        const data =
          editing && sourceTemplate
            ? await updateTemplate(sourceTemplate.id, payload)
            : await createTemplate(payload);
        saved = { kind: "template", data };
      } else if (editor.kind === "profile") {
        const payload = {
          name: name.trim(),
          description: description.trim(),
          taskType,
          enabledRuleIds,
          customRules: uniqueLines(customRulesText, 20),
          acceptanceCriteriaPresetId: acceptancePresetId || null,
        };
        const data =
          editing && sourceProfile
            ? await updateRuleProfile(sourceProfile.id, payload)
            : await createRuleProfile(payload);
        saved = { kind: "profile", data };
      } else if (editor.kind === "rule") {
        const payload = {
          title: name.trim(),
          description: description.trim(),
          category,
          content,
        };
        const data =
          editing && sourceRule
            ? await updateRuleItem(sourceRule.id, payload)
            : await createRuleItem(payload);
        saved = { kind: "rule", data };
      } else {
        const payload = {
          name: name.trim(),
          description: description.trim(),
          taskType,
          criteria: uniqueLines(criteriaText),
        };
        const data =
          editing && sourceCriteria
            ? await updateAcceptanceCriteriaPreset(sourceCriteria.id, payload)
            : await createAcceptanceCriteriaPreset(payload);
        saved = { kind: "criteria", data };
      }

      onSaved(saved);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : c.editor.saveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  const structureMetrics =
    editor.kind === "template"
      ? [
          format(c.editor.variableCount, {
            count: getTemplateVariables(content).length,
          }),
          format(c.editor.sectionCount, {
            count: getTemplateSections(content).length,
          }),
          format(c.editor.characters, { count: content.length }),
        ]
      : editor.kind === "profile"
        ? [
            format(c.itemCount, { count: enabledRuleIds.length }),
            format(c.editor.lines, {
              count: uniqueLines(customRulesText).length,
            }),
          ]
        : editor.kind === "rule"
          ? [format(c.editor.characters, { count: content.length })]
          : [
              format(c.editor.lines, {
                count: uniqueLines(criteriaText).length,
              }),
            ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-y-[42px] right-0 z-[78] w-full bg-black/58 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <motion.aside
        initial={reduceMotion ? false : { opacity: 0, x: 42 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 42 }}
        transition={PANEL_TRANSITION}
        className="fixed bottom-0 right-0 top-[42px] z-[80] w-[min(820px,calc(100vw-24px))] overflow-hidden border-l border-white/10 bg-black/98 shadow-[0_0_100px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="shrink-0 border-b border-neutral-900 bg-black/96 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {eyebrow}
                </p>
                <h2 className="mt-1 truncate text-xl font-semibold tracking-[-0.04em] text-white">
                  {title}
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  {copyMode ? c.editor.protectedSource : c.editor.localOnly}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
                aria-label={c.editor.close}
              >
                <X size={16} />
              </button>
            </div>
            <HorizontalSlidingSelector
              items={editorSteps}
              activeIndex={editorSteps.findIndex((item) => item.id === step)}
              getItemKey={(item) => item.id}
              onSelect={(item) => setStep(item.id)}
              renderItem={(item, active) => (
                <span className="flex min-h-12 items-center justify-center gap-2 px-2 text-left">
                  <span className="min-w-0">
                    <span
                      className={[
                        "block truncate text-xs font-semibold",
                        active ? "text-black" : "text-current",
                      ].join(" ")}
                    >
                      {item.label}
                    </span>
                    <span
                      className={[
                        "mt-0.5 block truncate text-[10px]",
                        active ? "text-black/55" : "text-neutral-700",
                      ].join(" ")}
                    >
                      {item.caption}
                    </span>
                  </span>
                </span>
              )}
              className="mt-4"
              ariaLabel={title}
            />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <AnimatePresence mode="wait" initial={false}>
              {step === "setup" ? (
                <motion.div
                  key="setup"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-5"
                >
                  <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <FieldLabel label={c.editor.name} />
                        <TextInput
                          value={name}
                          onChange={setName}
                          placeholder={
                            editor.kind === "template"
                              ? c.editor.nameTemplatePlaceholder
                              : editor.kind === "profile"
                                ? c.editor.nameProfilePlaceholder
                                : editor.kind === "rule"
                                  ? c.editor.nameRulePlaceholder
                                  : c.editor.nameCriteriaPlaceholder
                          }
                        />
                      </div>
                      {editor.kind === "rule" ? (
                        <div>
                          <FieldLabel label={c.editor.category} />
                          <CustomSelect
                            value={category}
                            onChange={(value) => setCategory(value as RuleCategory)}
                            options={categoryOptions}
                          />
                        </div>
                      ) : (
                        <div>
                          <FieldLabel label={c.editor.taskType} />
                          <CustomSelect
                            value={taskType}
                            onChange={(value) => setTaskType(value as TemplateTaskType)}
                            options={taskOptions}
                          />
                        </div>
                      )}
                    </div>
                    <div className="mt-4">
                      <FieldLabel label={c.editor.description} />
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder={c.editor.descriptionPlaceholder}
                        className="h-24 w-full resize-none rounded-2xl border border-neutral-900 bg-black/55 p-3.5 text-sm leading-6 text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:ring-4 focus:ring-white/5"
                      />
                    </div>
                    {editor.kind === "template" ? (
                      <div className="mt-4">
                        <FieldLabel label={c.editor.targetTool} />
                        <CustomSelect
                          value={targetTool}
                          onChange={(value) => setTargetTool(value as TargetTool)}
                          options={targetOptions}
                        />
                      </div>
                    ) : null}
                  </section>

                  <section className="grid gap-3 md:grid-cols-3">
                    {structureMetrics.map((metric) => (
                      <div
                        key={metric}
                        className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm font-semibold text-white"
                      >
                        {metric}
                      </div>
                    ))}
                  </section>
                </motion.div>
              ) : null}

              {step === "structure" ? (
                <motion.div
                  key="structure"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-4"
                >
                  {editor.kind === "template" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <FieldLabel
                        label={c.editor.templateContent}
                        hint={c.editor.templateHint}
                      />
                      <textarea
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        className="h-[500px] w-full resize-none rounded-2xl border border-neutral-900 bg-black/60 p-4 font-mono text-xs leading-6 text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/5"
                      />
                    </section>
                  ) : null}

                  {editor.kind === "profile" ? (
                    <>
                      <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                        <FieldLabel
                          label={c.editor.enabledRules}
                          hint={c.editor.enabledRulesHint}
                        />
                        <div className="grid max-h-[390px] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                          {ruleItems.map((rule) => {
                            const checked = enabledRuleIds.includes(rule.id);
                            return (
                              <button
                                key={rule.id}
                                type="button"
                                onClick={() =>
                                  setEnabledRuleIds((current) =>
                                    checked
                                      ? current.filter((id) => id !== rule.id)
                                      : [...current, rule.id],
                                  )
                                }
                                className={[
                                  "flex items-start gap-3 rounded-2xl border p-3 text-left transition",
                                  checked
                                    ? "border-white/20 bg-white/[0.055]"
                                    : "border-neutral-900 bg-black/35 hover:border-white/15",
                                ].join(" ")}
                              >
                                <span
                                  className={[
                                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                                    checked
                                      ? "border-white bg-white text-black"
                                      : "border-neutral-800 bg-neutral-950 text-neutral-700",
                                  ].join(" ")}
                                >
                                  {checked ? <Check size={12} /> : null}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-xs font-semibold text-white">
                                    {rule.title}
                                  </span>
                                  <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-neutral-600">
                                    {rule.description}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                      <section className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                          <FieldLabel label={c.editor.acceptancePreset} />
                          <CustomSelect
                            value={acceptancePresetId}
                            onChange={setAcceptancePresetId}
                            options={criteriaOptions}
                          />
                        </div>
                        <div className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                          <FieldLabel
                            label={c.editor.customRules}
                            hint={c.editor.customRulesHint}
                          />
                          <textarea
                            value={customRulesText}
                            onChange={(event) =>
                              setCustomRulesText(event.target.value)
                            }
                            className="h-40 w-full resize-none rounded-2xl border border-neutral-900 bg-black/55 p-3 font-mono text-xs leading-6 text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/5"
                          />
                        </div>
                      </section>
                    </>
                  ) : null}

                  {editor.kind === "rule" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <FieldLabel
                        label={c.editor.ruleContent}
                        hint={c.editor.ruleContentHint}
                      />
                      <textarea
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        className="h-[420px] w-full resize-none rounded-2xl border border-neutral-900 bg-black/60 p-4 text-sm leading-7 text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/5"
                      />
                    </section>
                  ) : null}

                  {editor.kind === "criteria" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <FieldLabel
                        label={c.editor.criteria}
                        hint={c.editor.criteriaHint}
                      />
                      <textarea
                        value={criteriaText}
                        onChange={(event) => setCriteriaText(event.target.value)}
                        className="h-[420px] w-full resize-none rounded-2xl border border-neutral-900 bg-black/60 p-4 text-sm leading-7 text-white outline-none transition focus:border-white/30 focus:ring-4 focus:ring-white/5"
                      />
                    </section>
                  ) : null}
                </motion.div>
              ) : null}

              {step === "preview" ? (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-4"
                >
                  <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                        <CheckCircle2 size={17} />
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          {c.editor.reviewTitle}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                          {c.editor.reviewDescription}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge builtin={false} c={c} />
                      {editor.kind === "template" ? (
                        <CountBadge>{TARGET_LABELS[targetTool]}</CountBadge>
                      ) : null}
                      {editor.kind !== "rule" ? (
                        <CountBadge>{c.taskTypes[taskType]}</CountBadge>
                      ) : (
                        <CountBadge>{c.categories[category]}</CountBadge>
                      )}
                    </div>
                    <h3 className="mt-4 text-xl font-semibold tracking-[-0.04em] text-white">
                      {name || "—"}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-neutral-600">
                      {description || c.noDescription}
                    </p>
                  </section>

                  {editor.kind === "template" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">
                          {c.inspector.structure}
                        </p>
                        <CountBadge>{content.length}</CountBadge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {getTemplateVariables(content).map((variable) => (
                          <CountBadge key={variable}>{`{{${variable}}}`}</CountBadge>
                        ))}
                      </div>
                      <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-2xl border border-neutral-900 bg-black/60 p-4 font-mono text-xs leading-6 text-neutral-400">
                        {content}
                      </pre>
                    </section>
                  ) : null}

                  {editor.kind === "profile" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <p className="text-sm font-semibold text-white">
                        {c.inspector.rules}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {enabledRuleIds.map((ruleId) => (
                          <CountBadge key={ruleId}>
                            {ruleItems.find((rule) => rule.id === ruleId)?.title ??
                              ruleId}
                          </CountBadge>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {editor.kind === "rule" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <p className="text-sm font-semibold text-white">
                        {c.editor.ruleContent}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-neutral-400">
                        {content || "—"}
                      </p>
                    </section>
                  ) : null}

                  {editor.kind === "criteria" ? (
                    <section className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                      <p className="text-sm font-semibold text-white">
                        {c.inspector.criteria}
                      </p>
                      <ol className="mt-3 space-y-2">
                        {uniqueLines(criteriaText).map((criterion, index) => (
                          <li
                            key={`${criterion}:${index}`}
                            className="flex gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs leading-5 text-neutral-400"
                          >
                            <span className="grid size-5 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-[10px]">
                              {index + 1}
                            </span>
                            {criterion}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <footer className="shrink-0 border-t border-neutral-900 bg-black/96 px-5 py-4">
            {error || validationMessage ? (
              <div className="mb-3 flex gap-2 rounded-xl border border-red-400/15 bg-red-500/[0.035] px-3 py-2 text-xs text-red-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {error || validationMessage}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" onClick={reset} disabled={saving}>
                <RefreshCcw size={14} />
                {c.editor.reset}
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={!canSave}>
                {saving ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Check size={15} />
                )}
                {saving ? c.editor.saving : c.editor.save}
              </Button>
            </div>
          </footer>
        </div>
      </motion.aside>
    </>
  );
}

function DeleteDialog({
  entity,
  c,
  onClose,
  onConfirm,
}: {
  entity: CatalogEntity;
  c: TemplatesStudioCopy;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    try {
      setDeleting(true);
      setError("");
      await onConfirm();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : c.deleteDialog.failed;
      setError(
        /used by|profile|reference|preset/i.test(message)
          ? `${c.deleteDialog.dependency} ${message}`
          : message,
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/72 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={PANEL_TRANSITION}
        className="w-full max-w-md rounded-[1.5rem] border border-red-400/15 bg-black/98 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.85)]"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="grid size-10 place-items-center rounded-2xl border border-red-400/15 bg-red-500/[0.06] text-red-200">
          <Trash2 size={16} />
        </span>
        <p className="cf-tech-label mt-4 text-[9px] uppercase text-red-300/70">
          {c.deleteDialog.eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-white">
          {format(c.deleteDialog.title, { name: getEntityName(entity) })}
        </h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          {c.deleteDialog.description}
        </p>
        {error ? (
          <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/[0.05] px-3 py-2 text-xs leading-5 text-red-200">
            {error}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            {c.deleteDialog.cancel}
          </Button>
          <button
            type="button"
            onClick={confirm}
            disabled={deleting}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-300/20 bg-red-500/10 px-4 text-sm font-semibold text-red-100 transition hover:border-red-200/40 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Trash2 size={15} />
            )}
            {deleting ? c.deleteDialog.deleting : c.deleteDialog.confirm}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function TemplatesPage() {
  const { i18n } = useTranslation();
  const isRussian = i18n.resolvedLanguage?.startsWith("ru") ?? false;
  const c = isRussian
    ? TEMPLATES_STUDIO_COPY.ru
    : TEMPLATES_STUDIO_COPY.en;
  const locale = isRussian ? "ru-RU" : "en-US";

  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [profiles, setProfiles] = useState<RuleProfile[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [criteria, setCriteria] = useState<AcceptanceCriteriaPreset[]>([]);
  const [activeTab, setActiveTab] = useState<StudioTab>("templates");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogEntity | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ToastState>({
    tone: "neutral",
    message: c.status.loading,
  });

  useEffect(() => {
    setStatus((current) =>
      current?.tone === "neutral"
        ? { tone: "neutral", message: c.status.loading }
        : current,
    );
  }, [c.status.loading]);

  async function loadCatalog() {
    try {
      setLoading(true);
      setStatus({ tone: "neutral", message: c.status.loading });
      const [templateData, catalog] = await Promise.all([
        getTemplates(),
        getRuleProfilesCatalog(),
      ]);
      setTemplates(templateData);
      setProfiles(catalog.ruleProfiles);
      setRules(catalog.ruleItems);
      setCriteria(catalog.acceptanceCriteriaPresets);
      setStatus({ tone: "success", message: c.status.ready });
    } catch (error) {
      setStatus({
        tone: "warning",
        message:
          error instanceof Error ? error.message : c.status.loadFailed,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  const entities = useMemo<CatalogEntity[]>(() => {
    if (activeTab === "templates") {
      return templates.map((data) => ({ kind: "template" as const, data }));
    }
    if (activeTab === "profiles") {
      return profiles.map((data) => ({ kind: "profile" as const, data }));
    }
    if (activeTab === "rules") {
      return rules.map((data) => ({ kind: "rule" as const, data }));
    }
    return criteria.map((data) => ({ kind: "criteria" as const, data }));
  }, [activeTab, criteria, profiles, rules, templates]);

  const filteredEntities = useMemo(() => {
    const normalizedQuery = normalize(query);
    return entities
      .filter((entity) => entityMatchesSource(entity, sourceFilter))
      .filter((entity) => {
        if (scopeFilter === "all") return true;
        if (entity.kind === "template") {
          return entity.data.targetTool === scopeFilter;
        }
        if (entity.kind === "rule") {
          return entity.data.category === scopeFilter;
        }
        return entity.data.taskType === scopeFilter;
      })
      .filter((entity) => {
        if (!normalizedQuery) return true;
        const haystack = [
          getEntityName(entity),
          getEntityDescription(entity, c),
          entity.data.id,
          entity.kind === "template" ? entity.data.content : "",
          entity.kind === "rule" ? entity.data.content : "",
          entity.kind === "criteria" ? entity.data.criteria.join(" ") : "",
          entity.kind === "profile" ? entity.data.customRules.join(" ") : "",
        ]
          .map(normalize)
          .join(" ");
        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (left.data.isBuiltin !== right.data.isBuiltin) {
          return left.data.isBuiltin ? 1 : -1;
        }
        return getEntityName(left).localeCompare(getEntityName(right));
      });
  }, [c, entities, query, scopeFilter, sourceFilter]);

  useEffect(() => {
    if (
      filteredEntities.length > 0 &&
      !filteredEntities.some((entity) => entity.data.id === selectedId)
    ) {
      setSelectedId(filteredEntities[0].data.id);
    }
    if (filteredEntities.length === 0 && selectedId) {
      setSelectedId("");
    }
  }, [filteredEntities, selectedId]);

  const selectedEntity =
    filteredEntities.find((entity) => entity.data.id === selectedId) ?? null;

  const customTemplateCount = templates.filter((item) => !item.isBuiltin).length;
  const protectedCount =
    templates.filter((item) => item.isBuiltin).length +
    profiles.filter((item) => item.isBuiltin).length +
    rules.filter((item) => item.isBuiltin).length +
    criteria.filter((item) => item.isBuiltin).length;

  const tabItems = useMemo(
    () => [
      {
        id: "templates" as const,
        label: c.tabs.templates,
        caption: c.tabs.templatesCaption,
        count: templates.length,
        icon: FileCode2,
      },
      {
        id: "profiles" as const,
        label: c.tabs.profiles,
        caption: c.tabs.profilesCaption,
        count: profiles.length,
        icon: ShieldCheck,
      },
      {
        id: "rules" as const,
        label: c.tabs.rules,
        caption: c.tabs.rulesCaption,
        count: rules.length,
        icon: SlidersHorizontal,
      },
      {
        id: "criteria" as const,
        label: c.tabs.criteria,
        caption: c.tabs.criteriaCaption,
        count: criteria.length,
        icon: ListChecks,
      },
    ],
    [c, criteria.length, profiles.length, rules.length, templates.length],
  );

  const sourceItems = useMemo(
    () => [
      {
        id: "all" as const,
        label: c.allItems,
        count: entities.length,
        icon: Layers3,
      },
      {
        id: "custom" as const,
        label: c.customItems,
        count: entities.filter((entity) => !entity.data.isBuiltin).length,
        icon: Sparkles,
      },
      {
        id: "builtin" as const,
        label: c.builtinItems,
        count: entities.filter((entity) => entity.data.isBuiltin).length,
        icon: LockKeyhole,
      },
    ],
    [c, entities],
  );

  const scopeItems = useMemo(() => {
    if (activeTab === "templates") {
      return TARGET_TOOLS.map((id) => ({
        id,
        label: TARGET_LABELS[id],
        count: templates.filter((item) => item.targetTool === id).length,
      }));
    }
    if (activeTab === "rules") {
      return RULE_CATEGORIES.map((id) => ({
        id,
        label: c.categories[id],
        count: rules.filter((item) => item.category === id).length,
      }));
    }
    const source = activeTab === "profiles" ? profiles : criteria;
    return TASK_TYPES.map((id) => ({
      id,
      label: c.taskTypes[id],
      count: source.filter((item) => item.taskType === id).length,
    })).filter((item) => item.count > 0);
  }, [activeTab, c, criteria, profiles, rules, templates]);

  const createLabel =
    activeTab === "templates"
      ? c.createTemplate
      : activeTab === "profiles"
        ? c.createProfile
        : activeTab === "rules"
          ? c.createRule
          : c.createCriteria;

  function openCreate(kind = kindForTab(activeTab)) {
    if (kind === "template") setEditor({ kind, mode: "create" });
    if (kind === "profile") setEditor({ kind, mode: "create" });
    if (kind === "rule") setEditor({ kind, mode: "create" });
    if (kind === "criteria") setEditor({ kind, mode: "create" });
  }

  function openDuplicate(entity: CatalogEntity) {
    if (entity.kind === "template") {
      setEditor({ kind: "template", mode: "create", source: entity.data });
    } else if (entity.kind === "profile") {
      setEditor({ kind: "profile", mode: "create", source: entity.data });
    } else if (entity.kind === "rule") {
      setEditor({ kind: "rule", mode: "create", source: entity.data });
    } else {
      setEditor({ kind: "criteria", mode: "create", source: entity.data });
    }
    setStatus({ tone: "neutral", message: c.status.copyReady });
  }

  function openEdit(entity: CatalogEntity) {
    if (entity.data.isBuiltin) return;
    if (entity.kind === "template") {
      setEditor({ kind: "template", mode: "edit", source: entity.data });
    } else if (entity.kind === "profile") {
      setEditor({ kind: "profile", mode: "edit", source: entity.data });
    } else if (entity.kind === "rule") {
      setEditor({ kind: "rule", mode: "edit", source: entity.data });
    } else {
      setEditor({ kind: "criteria", mode: "edit", source: entity.data });
    }
  }

  async function handleCopyId(entity: CatalogEntity) {
    try {
      await navigator.clipboard.writeText(entity.data.id);
      setStatus({ tone: "success", message: c.copied });
    } catch {
      setStatus({ tone: "warning", message: entity.data.id });
    }
  }

  async function handleSaved(entity: CatalogEntity) {
    setEditor(null);
    setActiveTab(tabForKind(entity.kind));
    setSourceFilter("all");
    setScopeFilter("all");
    setQuery("");
    await loadCatalog();
    setSelectedId(entity.data.id);
    setStatus({ tone: "success", message: c.status.saved });
  }

  async function handleDeleteConfirmed(entity: CatalogEntity) {
    if (entity.kind === "template") await deleteTemplate(entity.data.id);
    if (entity.kind === "profile") await deleteRuleProfile(entity.data.id);
    if (entity.kind === "rule") await deleteRuleItem(entity.data.id);
    if (entity.kind === "criteria") {
      await deleteAcceptanceCriteriaPreset(entity.data.id);
    }
    setDeleteTarget(null);
    setSelectedId("");
    await loadCatalog();
    setStatus({ tone: "success", message: c.status.deleted });
  }

  async function openWebsite() {
    const url = "https://contextforge.dev/templates";
    if (window.contextforge?.openExternalUrl) {
      await window.contextforge.openExternalUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="space-y-4 pb-8 text-render-crisp">
      <header className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.042),rgba(255,255,255,0.012))] p-5 shadow-[0_18px_58px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Layers3 size={17} />
            </span>
            <div className="min-w-0">
              <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                {c.eyebrow}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.045em] text-white">
                {c.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                {c.description}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex overflow-hidden rounded-2xl border border-neutral-900 bg-black/45 py-2">
              <SummaryCell label={c.summary.templates} value={templates.length} />
              <SummaryCell label={c.summary.custom} value={customTemplateCount} />
              <SummaryCell label={c.summary.profiles} value={profiles.length} />
              <SummaryCell label={c.summary.protected} value={protectedCount} />
            </div>
            <Button variant="secondary" onClick={loadCatalog} disabled={loading}>
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCcw size={15} />
              )}
              {loading ? c.refreshing : c.refresh}
            </Button>
            <Button variant="primary" onClick={() => openCreate()}>
              <Plus size={15} />
              {createLabel}
            </Button>
          </div>
        </div>
      </header>

      <HorizontalSlidingSelector
        items={tabItems}
        activeIndex={tabItems.findIndex((item) => item.id === activeTab)}
        getItemKey={(item) => item.id}
        onSelect={(item) => {
          setActiveTab(item.id);
          setSourceFilter("all");
          setScopeFilter("all");
          setQuery("");
          setSelectedId("");
        }}
        renderItem={(item, active) => {
          const Icon = item.icon;
          return (
            <span className="flex min-h-14 items-center justify-center gap-2.5 px-3 text-left">
              <Icon size={15} />
              <span className="min-w-0">
                <span
                  className={[
                    "block truncate text-xs font-semibold",
                    active ? "text-black" : "text-current",
                  ].join(" ")}
                >
                  {item.label}
                </span>
                <span
                  className={[
                    "mt-0.5 block truncate text-[10px]",
                    active ? "text-black/55" : "text-neutral-700",
                  ].join(" ")}
                >
                  {item.caption} · {item.count}
                </span>
              </span>
            </span>
          );
        }}
        ariaLabel={c.title}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[220px_minmax(0,1fr)_390px]">
        <aside className="space-y-4 xl:sticky xl:top-4">
          <CatalogFilterPanel
            icon={<Folder size={13} />}
            title={c.library}
            caption={c.collections}
          >
            {sourceItems.map((item) => {
              const Icon = item.icon;
              return (
                <CatalogFilterButton
                  key={item.id}
                  active={sourceFilter === item.id}
                  label={item.label}
                  count={item.count}
                  icon={<Icon size={12} />}
                  onClick={() => {
                    setSourceFilter(item.id);
                    setSelectedId("");
                  }}
                />
              );
            })}
          </CatalogFilterPanel>

          <CatalogFilterPanel
            icon={
              activeTab === "templates" ? (
                <Layers3 size={13} />
              ) : activeTab === "rules" ? (
                <SlidersHorizontal size={13} />
              ) : (
                <ListChecks size={13} />
              )
            }
            title={
              activeTab === "templates"
                ? c.agents
                : activeTab === "rules"
                  ? c.filterByCategory
                  : c.filterByTask
            }
            caption={tabItems.find((item) => item.id === activeTab)?.caption ?? ""}
          >
            <CatalogFilterButton
              active={scopeFilter === "all"}
              label={
                activeTab === "templates"
                  ? c.allAgents
                  : activeTab === "rules"
                    ? c.allCategories
                    : c.allTaskTypes
              }
              count={entities.length}
              icon={<Layers3 size={12} />}
              onClick={() => {
                setScopeFilter("all");
                setSelectedId("");
              }}
            />
            {scopeItems.map((item) => {
              const isActive = scopeFilter === item.id;

              return (
                <CatalogFilterButton
                  key={item.id}
                  active={isActive}
                  label={item.label}
                  count={item.count}
                  icon={
                    activeTab === "templates"
                      ? targetIcon(
                          item.id as TargetTool,
                          "sm",
                          isActive ? "onLight" : "default",
                        )
                      : undefined
                  }
                  iconSurface={activeTab !== "templates"}
                  onClick={() => {
                    setScopeFilter(item.id);
                    setSelectedId("");
                  }}
                />
              );
            })}
          </CatalogFilterPanel>
        </aside>

        <main className="min-w-0 rounded-[1.5rem] border border-neutral-900 bg-black/38 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-700"
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                }}
                placeholder={c.searchPlaceholder}
                className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/55 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:ring-4 focus:ring-white/5"
              />
            </div>
            <div className="flex items-center gap-2">
              <CountBadge>
                {format(c.itemCount, { count: filteredEntities.length })}
              </CountBadge>
              {status ? (
                <span
                  className={[
                    "inline-flex h-7 max-w-[250px] items-center gap-2 rounded-full border px-3 text-[10px] font-medium",
                    status.tone === "success"
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                      : status.tone === "warning"
                        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                        : "border-neutral-900 bg-black/45 text-neutral-600",
                  ].join(" ")}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-current" />
                  <span className="truncate">{status.message}</span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 max-h-[calc(100vh-310px)] min-h-[560px] space-y-2 overflow-y-auto overscroll-contain pr-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredEntities.length === 0 ? (
                <EmptyCatalog
                  key="empty"
                  c={c}
                  custom={sourceFilter === "custom"}
                  onCreate={() => openCreate()}
                />
              ) : (
                filteredEntities.map((entity) => (
                  <CatalogRow
                    key={`${entity.kind}:${entity.data.id}`}
                    entity={entity}
                    selected={selectedId === entity.data.id}
                    c={c}
                    locale={locale}
                    onSelect={() => setSelectedId(entity.data.id)}
                    onDuplicate={() => openDuplicate(entity)}
                    onEdit={() => openEdit(entity)}
                    onDelete={() => setDeleteTarget(entity)}
                    onCopyId={() => void handleCopyId(entity)}
                  />
                ))
              )}
            </AnimatePresence>
          </div>
        </main>

        <Inspector
          entity={selectedEntity}
          c={c}
          ruleItems={rules}
          profiles={profiles}
          criteria={criteria}
          onDuplicate={openDuplicate}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onOpenWebsite={() => void openWebsite()}
        />
      </div>

      <AnimatePresence>
        {editor ? (
          <StudioEditor
            key={`${editor.kind}:${editor.mode}:${editor.source?.id ?? "new"}`}
            editor={editor}
            c={c}
            isRussian={isRussian}
            ruleItems={rules}
            acceptancePresets={criteria}
            onClose={() => setEditor(null)}
            onSaved={(entity) => void handleSaved(entity)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget ? (
          <DeleteDialog
            key={`${deleteTarget.kind}:${deleteTarget.data.id}`}
            entity={deleteTarget}
            c={c}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => handleDeleteConfirmed(deleteTarget)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
