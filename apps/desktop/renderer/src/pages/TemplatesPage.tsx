import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Copy,
  FileText,
  Layers3,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  WandSparkles,
  X
} from "lucide-react";

import {
  createRuleProfile,
  createTemplate,
  deleteRuleProfile,
  deleteTemplate,
  getRuleProfilesCatalog,
  getTemplates
} from "../api/client";
import type {
  AcceptanceCriteriaPreset,
  PromptTemplate,
  RuleItem,
  RuleProfile,
  TemplateTaskType
} from "../types";
import { Button } from "../components/ui/Button";
import { CustomSelect } from "../components/ui/CustomSelect";
import { TARGET_TOOL_OPTIONS } from "../components/ai/aiToolOptions";

import {
  SegmentedFilter,
  type SegmentedFilterOption
} from "../components/ui/SegmentedFilter";

type TemplatesTab = "templates" | "profiles" | "rules" | "criteria";
type CatalogTabOption = SegmentedFilterOption<TemplatesTab>;
type DraftKind = "template" | "profile" | null;

const TASK_TYPE_OPTIONS: Array<{
  value: TemplateTaskType;
  label: string;
  description: string;
}> = [
    { value: "general", label: "General", description: "Universal task" },
    { value: "ui", label: "UI / UX", description: "Interface changes" },
    { value: "backend", label: "Backend", description: "API / DB / server" },
    { value: "fullstack", label: "Fullstack", description: "UI + backend" },
    { value: "build", label: "Build", description: "Build / config" },
    { value: "bugfix", label: "Bugfix", description: "Minimal fix" },
    { value: "refactor", label: "Refactor", description: "No behavior change" },
    { value: "docs", label: "Docs", description: "Documentation" },
    { value: "tests", label: "Tests", description: "Verification" }
  ];

const EMPTY_TEMPLATE_CONTENT = `# AI Task Pack

## Target Tool

{{targetToolLabel}}

## Task Type

{{taskType}}

## Task

{{rawTask}}

## Project Context

- Project: {{projectName}}
- Package manager: {{packageManager}}
- Detected stack: {{detectedStack}}
- Readiness score: {{readinessScore}}

## Agent Instructions

Inspect selected ContextForge files before editing. Keep the work focused and safe.

## Constraints

{{rules}}

## Acceptance Criteria

{{acceptanceCriteria}}

## Verification

{{verification}}

## Expected Final Response

Return:
- files changed
- summary
- verification
- remaining risks
`;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function splitLines(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}

function countCustom<T extends { isBuiltin: boolean }>(items: T[]) {
  return items.filter((item) => !item.isBuiltin).length;
}

function getBadgeClass(isBuiltin: boolean) {
  return isBuiltin
    ? "border-white/12 bg-white/[0.075] text-white"
    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
}

function EmptyState({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid h-full min-h-[260px] place-items-center rounded-[1.5rem] border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
      <div>
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-500">
          <Search size={18} />
        </div>

        <p className="text-base font-semibold text-white">{title}</p>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {description}
        </p>
      </div>
    </div>
  );
}

function Pill({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "success" | "muted";
}) {
  const className =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : tone === "muted"
        ? "border-neutral-900 bg-black/40 text-neutral-600"
        : "border-neutral-800 bg-neutral-950 text-neutral-300";

  return (
    <span
      className={[
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
        className
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  caption
}: {
  icon: ReactNode;
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <article className="rounded-[1.25rem] border border-neutral-900 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {label}
          </p>

          <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
            {value}
          </p>
        </div>

        <div className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-600">{caption}</p>
    </article>
  );
}

function TemplateRow({
  template,
  onCopy,
  onDelete
}: {
  template: PromptTemplate;
  onCopy: (template: PromptTemplate) => void;
  onDelete: (template: PromptTemplate) => void;
}) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className="group rounded-[1.25rem] border border-neutral-900 bg-black/35 p-4 transition hover:border-white/15 hover:bg-white/[0.035]"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px_auto] xl:items-center">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <span
              className={[
                "rounded-full border px-2.5 py-1 text-[10px] font-medium",
                getBadgeClass(template.isBuiltin)
              ].join(" ")}
            >
              {template.isBuiltin ? "Built-in" : "Custom"}
            </span>

            <Pill>{template.targetTool}</Pill>
            <Pill>{template.taskType}</Pill>
          </div>

          <h3 className="truncate text-sm font-semibold text-white">
            {template.name}
          </h3>

          <p className="mt-1 line-clamp-1 text-xs leading-5 text-neutral-500">
            {template.description || "No description."}
          </p>

          <p className="mt-2 truncate text-[11px] text-neutral-700">
            {template.id}
          </p>
        </div>

        <div className="hidden min-w-0 rounded-2xl border border-neutral-900 bg-black/45 p-3 xl:block">
          <pre className="line-clamp-3 whitespace-pre-wrap font-mono text-[10px] leading-4 text-neutral-600">
            {template.content}
          </pre>
        </div>

        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="secondary" onClick={() => onCopy(template)}>
            <Copy size={14} />
            Copy
          </Button>

          {!template.isBuiltin && (
            <Button variant="secondary" onClick={() => onDelete(template)}>
              <Trash2 size={14} />
              Delete
            </Button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function ProfileRow({
  profile,
  ruleItems,
  preset,
  onCopy,
  onDelete
}: {
  profile: RuleProfile;
  ruleItems: RuleItem[];
  preset?: AcceptanceCriteriaPreset;
  onCopy: (profile: RuleProfile) => void;
  onDelete: (profile: RuleProfile) => void;
}) {
  const enabledRules = ruleItems.filter((rule) =>
    profile.enabledRuleIds.includes(rule.id)
  );

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className="rounded-[1.25rem] border border-neutral-900 bg-black/35 p-4 transition hover:border-white/15 hover:bg-white/[0.035]"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px_auto] xl:items-center">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <span
              className={[
                "rounded-full border px-2.5 py-1 text-[10px] font-medium",
                getBadgeClass(profile.isBuiltin)
              ].join(" ")}
            >
              {profile.isBuiltin ? "Built-in" : "Custom"}
            </span>

            <Pill>{profile.taskType}</Pill>
            <Pill>{profile.enabledRuleIds.length} rules</Pill>
            {preset && <Pill tone="success">{preset.name}</Pill>}
          </div>

          <h3 className="truncate text-sm font-semibold text-white">
            {profile.name}
          </h3>

          <p className="mt-1 line-clamp-1 text-xs leading-5 text-neutral-500">
            {profile.description || "No description."}
          </p>

          <p className="mt-2 truncate text-[11px] text-neutral-700">
            {profile.id}
          </p>
        </div>

        <div className="hidden min-w-0 xl:block">
          <div className="flex flex-wrap gap-1.5">
            {enabledRules.slice(0, 5).map((rule) => (
              <span
                key={rule.id}
                className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-500"
              >
                {rule.title}
              </span>
            ))}

            {enabledRules.length > 5 && (
              <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-600">
                +{enabledRules.length - 5}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="secondary" onClick={() => onCopy(profile)}>
            <Copy size={14} />
            Copy
          </Button>

          {!profile.isBuiltin && (
            <Button variant="secondary" onClick={() => onDelete(profile)}>
              <Trash2 size={14} />
              Delete
            </Button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function RuleCard({ rule }: { rule: RuleItem }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className="rounded-[1.25rem] border border-neutral-900 bg-black/35 p-4 transition hover:border-white/15 hover:bg-white/[0.035]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <span
              className={[
                "rounded-full border px-2.5 py-1 text-[10px] font-medium",
                getBadgeClass(rule.isBuiltin)
              ].join(" ")}
            >
              {rule.isBuiltin ? "Built-in" : "Custom"}
            </span>

            <Pill>{rule.category}</Pill>
          </div>

          <h3 className="line-clamp-1 text-sm font-semibold text-white">
            {rule.title}
          </h3>
        </div>

        <ShieldCheck size={16} className="shrink-0 text-neutral-600" />
      </div>

      <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
        {rule.description}
      </p>

      <div className="mt-3 rounded-2xl border border-neutral-900 bg-black/35 p-3">
        <p className="line-clamp-3 text-xs leading-5 text-neutral-400">
          {rule.content}
        </p>
      </div>
    </motion.article>
  );
}

function CriteriaCard({ preset }: { preset: AcceptanceCriteriaPreset }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className="rounded-[1.25rem] border border-neutral-900 bg-black/35 p-4 transition hover:border-white/15 hover:bg-white/[0.035]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <span
              className={[
                "rounded-full border px-2.5 py-1 text-[10px] font-medium",
                getBadgeClass(preset.isBuiltin)
              ].join(" ")}
            >
              {preset.isBuiltin ? "Built-in" : "Custom"}
            </span>

            <Pill>{preset.taskType}</Pill>
            <Pill>{preset.criteria.length} checks</Pill>
          </div>

          <h3 className="line-clamp-1 text-sm font-semibold text-white">
            {preset.name}
          </h3>
        </div>

        <Check size={16} className="shrink-0 text-neutral-600" />
      </div>

      <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
        {preset.description}
      </p>

      <ul className="mt-3 space-y-1.5">
        {preset.criteria.slice(0, 4).map((criterion) => (
          <li
            key={criterion}
            className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs leading-5 text-neutral-400"
          >
            {criterion}
          </li>
        ))}
      </ul>
    </motion.article>
  );
}

function CreatePanel({
  draftKind,
  onClose,
  ruleItems,
  acceptancePresets,
  onTemplateCreated,
  onProfileCreated
}: {
  draftKind: DraftKind;
  onClose: () => void;
  ruleItems: RuleItem[];
  acceptancePresets: AcceptanceCriteriaPreset[];
  onTemplateCreated: () => Promise<void> | void;
  onProfileCreated: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<TemplateTaskType>("general");
  const [targetTool, setTargetTool] = useState("codex");
  const [content, setContent] = useState(EMPTY_TEMPLATE_CONTENT);
  const [enabledRuleIds, setEnabledRuleIds] = useState<string[]>([
    "rule.general.no-invented-files",
    "rule.general.inspect-first",
    "rule.general.focused-scope",
    "rule.verification.no-fake-tests"
  ]);
  const [customRulesText, setCustomRulesText] = useState("");
  const [acceptanceCriteriaPresetId, setAcceptanceCriteriaPresetId] =
    useState<string | null>("criteria.general-done");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const canSave =
    name.trim().length >= 2 &&
    (draftKind === "profile" || content.trim().length >= 20);

  if (!draftKind) {
    return null;
  }

  function toggleRule(ruleId: string) {
    setEnabledRuleIds((current) =>
      current.includes(ruleId)
        ? current.filter((item) => item !== ruleId)
        : [...current, ruleId]
    );
  }

  async function handleSave() {
    if (!canSave || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setMessage("");

      if (draftKind === "template") {
        await createTemplate({
          name,
          description,
          targetTool,
          taskType,
          content
        });

        await onTemplateCreated();
      } else {
        await createRuleProfile({
          name,
          description,
          taskType,
          enabledRuleIds,
          customRules: splitLines(customRulesText),
          acceptanceCriteriaPresetId
        });

        await onProfileCreated();
      }

      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-y-[42px] right-0 z-[78] w-full bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <motion.aside
        initial={{ opacity: 0, x: 28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 28 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="fixed bottom-0 right-0 top-[42px] z-[80] w-[min(740px,calc(100vw-24px))] overflow-hidden border-l border-neutral-900 bg-black/98 shadow-[0_0_90px_rgba(0,0,0,0.82)] backdrop-blur-xl"
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-neutral-900 bg-black/95 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Create custom
                </p>

                <h2 className="mt-1 truncate text-xl font-semibold tracking-[-0.04em] text-white">
                  {draftKind === "template"
                    ? "New prompt template"
                    : "New rule profile"}
                </h2>

                <p className="mt-1 truncate text-xs text-neutral-600">
                  Saved locally. Built-in items remain protected.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={!canSave || isSaving}
                >
                  {isSaving ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Plus size={15} />
                  )}
                  Save
                </Button>

                <button
                  type="button"
                  onClick={onClose}
                  className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
                  aria-label="Close panel"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {message && (
              <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-200">
                {message}
              </div>
            )}
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-hidden p-5">
            <div className="shrink-0 space-y-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs text-neutral-500">
                    Name
                  </label>

                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/55 px-4 text-sm text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
                    placeholder={
                      draftKind === "template"
                        ? "My Codex UI template"
                        : "Safe UI profile"
                    }
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs text-neutral-500">
                    Task type
                  </label>

                  <CustomSelect
                    value={taskType}
                    onChange={(value) => setTaskType(value as TemplateTaskType)}
                    options={TASK_TYPE_OPTIONS}
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs text-neutral-500">
                  Description
                </label>

                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="h-16 w-full resize-none rounded-2xl border border-neutral-900 bg-black/55 p-3 text-sm leading-5 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
                  placeholder="Short note about when this item should be used."
                />
              </div>

              {draftKind === "template" && (
                <div>
                  <label className="mb-2 block text-xs text-neutral-500">
                    Target tool
                  </label>

                  <CustomSelect
                    value={targetTool}
                    onChange={setTargetTool}
                    options={TARGET_TOOL_OPTIONS}
                  />
                </div>
              )}
            </div>

            {draftKind === "template" ? (
              <div className="mt-4 flex min-h-0 flex-col overflow-hidden">
                <div className="mb-2 flex shrink-0 items-center justify-between gap-4">
                  <label className="block text-xs text-neutral-500">
                    Template content
                  </label>

                  <Pill tone="muted">{content.length} chars</Pill>
                </div>

                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="min-h-0 flex-1 resize-none rounded-2xl border border-neutral-900 bg-black/55 p-4 font-mono text-xs leading-6 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
                />
              </div>
            ) : (
              <div className="mt-4 grid min-h-0 grid-rows-[1fr_auto_auto] gap-4 overflow-hidden">
                <section className="min-h-0 overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Enabled toggle rules
                      </p>

                      <p className="mt-1 text-xs text-neutral-600">
                        Only this rules list scrolls.
                      </p>
                    </div>

                    <Pill tone="success">{enabledRuleIds.length} enabled</Pill>
                  </div>

                  <div className="h-[calc(100%-58px)] space-y-2 overflow-y-auto pr-1">
                    {ruleItems.map((rule) => {
                      const checked = enabledRuleIds.includes(rule.id);

                      return (
                        <button
                          key={rule.id}
                          type="button"
                          onClick={() => toggleRule(rule.id)}
                          className={[
                            "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
                            checked
                              ? "border-white/20 bg-white/[0.055]"
                              : "border-neutral-900 bg-black/25 hover:border-white/20"
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                              checked
                                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                                : "border-neutral-800 bg-neutral-950 text-neutral-700"
                            ].join(" ")}
                          >
                            {checked && <Check size={12} />}
                          </span>

                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-white">
                              {rule.title}
                            </span>

                            <span className="mt-1 block text-[11px] leading-4 text-neutral-600">
                              {rule.category} · {rule.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <div>
                  <label className="mb-2 block text-xs text-neutral-500">
                    Acceptance preset
                  </label>

                  <CustomSelect
                    value={acceptanceCriteriaPresetId ?? ""}
                    onChange={(value) =>
                      setAcceptanceCriteriaPresetId(value || null)
                    }
                    options={[
                      {
                        value: "",
                        label: "No preset",
                        description: "Custom rules only"
                      },
                      ...acceptancePresets.map((preset) => ({
                        value: preset.id,
                        label: preset.name,
                        description: `${preset.taskType} · ${preset.criteria.length} criteria`
                      }))
                    ]}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs text-neutral-500">
                    Profile custom rules
                  </label>

                  <textarea
                    value={customRulesText}
                    onChange={(event) => setCustomRulesText(event.target.value)}
                    className="h-28 w-full resize-none rounded-2xl border border-neutral-900 bg-black/55 p-3 text-sm leading-5 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
                    placeholder="One custom rule per line."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}

export function TemplatesPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [ruleProfiles, setRuleProfiles] = useState<RuleProfile[]>([]);
  const [ruleItems, setRuleItems] = useState<RuleItem[]>([]);
  const [acceptancePresets, setAcceptancePresets] = useState<
    AcceptanceCriteriaPreset[]
  >([]);
  const [activeTab, setActiveTab] = useState<TemplatesTab>("templates");
  const [query, setQuery] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState("all");
  const [draftKind, setDraftKind] = useState<DraftKind>(null);
  const [status, setStatus] = useState("Loading rules and templates...");
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState("");

  async function loadCatalog() {
    try {
      setIsLoading(true);
      setStatus("Loading rules and templates...");

      const [templatesData, ruleCatalog] = await Promise.all([
        getTemplates(),
        getRuleProfilesCatalog()
      ]);

      setTemplates(templatesData);
      setRuleProfiles(ruleCatalog.ruleProfiles);
      setRuleItems(ruleCatalog.ruleItems);
      setAcceptancePresets(ruleCatalog.acceptanceCriteriaPresets);
      setStatus("Rules and templates loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load catalog.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  const normalizedQuery = normalize(query).trim();

  const catalogTabOptions = useMemo<CatalogTabOption[]>(
    () => [
      {
        value: "templates",
        label: "Templates",
        description: `${templates.length} item(s)`
      },
      {
        value: "profiles",
        label: "Profiles",
        description: `${ruleProfiles.length} item(s)`
      },
      {
        value: "rules",
        label: "Rules",
        description: `${ruleItems.length} item(s)`
      },
      {
        value: "criteria",
        label: "Criteria",
        description: `${acceptancePresets.length} item(s)`
      }
    ],
    [acceptancePresets.length, ruleItems.length, ruleProfiles.length, templates.length]
  );

  const filteredTemplates = useMemo(
    () =>
      templates.filter((template) => {
        const matchesQuery =
          !normalizedQuery ||
          normalize(
            [
              template.name,
              template.description,
              template.targetTool,
              template.taskType,
              template.content
            ].join(" ")
          ).includes(normalizedQuery);

        const matchesTask =
          taskTypeFilter === "all" || template.taskType === taskTypeFilter;

        return matchesQuery && matchesTask;
      }),
    [normalizedQuery, taskTypeFilter, templates]
  );

  const filteredProfiles = useMemo(
    () =>
      ruleProfiles.filter((profile) => {
        const matchesQuery =
          !normalizedQuery ||
          normalize(
            [
              profile.name,
              profile.description,
              profile.taskType,
              profile.enabledRuleIds.join(" "),
              profile.customRules.join(" ")
            ].join(" ")
          ).includes(normalizedQuery);

        const matchesTask =
          taskTypeFilter === "all" || profile.taskType === taskTypeFilter;

        return matchesQuery && matchesTask;
      }),
    [normalizedQuery, ruleProfiles, taskTypeFilter]
  );

  const filteredRules = useMemo(
    () =>
      ruleItems.filter((rule) => {
        const matchesQuery =
          !normalizedQuery ||
          normalize(
            [rule.title, rule.description, rule.category, rule.content].join(" ")
          ).includes(normalizedQuery);

        const matchesTask =
          taskTypeFilter === "all" ||
          rule.category === taskTypeFilter ||
          rule.category === "general" ||
          rule.category === "verification" ||
          rule.category === "assets";

        return matchesQuery && matchesTask;
      }),
    [normalizedQuery, ruleItems, taskTypeFilter]
  );

  const filteredCriteria = useMemo(
    () =>
      acceptancePresets.filter((preset) => {
        const matchesQuery =
          !normalizedQuery ||
          normalize(
            [
              preset.name,
              preset.description,
              preset.taskType,
              preset.criteria.join(" ")
            ].join(" ")
          ).includes(normalizedQuery);

        const matchesTask =
          taskTypeFilter === "all" || preset.taskType === taskTypeFilter;

        return matchesQuery && matchesTask;
      }),
    [acceptancePresets, normalizedQuery, taskTypeFilter]
  );

  async function handleCopyTemplate(template: PromptTemplate) {
    try {
      await createTemplate({
        name: `${template.name} Copy`,
        description: template.description,
        targetTool: template.targetTool,
        taskType: template.taskType,
        content: template.content
      });

      setToast(`Copied template: ${template.name}`);
      await loadCatalog();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to copy template.");
    }
  }

  async function handleCopyProfile(profile: RuleProfile) {
    try {
      await createRuleProfile({
        name: `${profile.name} Copy`,
        description: profile.description,
        taskType: profile.taskType,
        enabledRuleIds: profile.enabledRuleIds,
        customRules: profile.customRules,
        acceptanceCriteriaPresetId: profile.acceptanceCriteriaPresetId ?? null
      });

      setToast(`Copied profile: ${profile.name}`);
      await loadCatalog();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to copy profile.");
    }
  }

  async function handleDeleteTemplate(template: PromptTemplate) {
    if (template.isBuiltin) {
      return;
    }

    try {
      await deleteTemplate(template.id);
      setToast(`Deleted template: ${template.name}`);
      await loadCatalog();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to delete template.");
    }
  }

  async function handleDeleteProfile(profile: RuleProfile) {
    if (profile.isBuiltin) {
      return;
    }

    try {
      await deleteRuleProfile(profile.id);
      setToast(`Deleted profile: ${profile.name}`);
      await loadCatalog();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to delete profile.");
    }
  }

  const visibleCount =
    activeTab === "templates"
      ? filteredTemplates.length
      : activeTab === "profiles"
        ? filteredProfiles.length
        : activeTab === "rules"
          ? filteredRules.length
          : filteredCriteria.length;

  return (
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <div className="grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill>
              <Layers3 size={12} />
              v0.5 Rules & Templates
            </Pill>

            <Pill>Local-first catalog</Pill>
            <Pill>Built-ins protected</Pill>
          </div>

          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <div>
              <h1 className="max-w-3xl text-[30px] font-semibold leading-[1.04] tracking-[-0.055em] text-white">
                Templates, profiles, toggle rules and acceptance criteria.
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-500">
                Build reusable Task Pack contracts for Codex, Cursor, Claude and
                generic coding agents.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="secondary" onClick={loadCatalog} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCcw size={15} />
                )}
                Refresh
              </Button>

              <Button variant="secondary" onClick={() => setDraftKind("profile")}>
                <ShieldCheck size={15} />
                New profile
              </Button>

              <Button variant="primary" onClick={() => setDraftKind("template")}>
                <Plus size={15} />
                New template
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            icon={<FileText size={15} />}
            label="Templates"
            value={templates.length}
            caption={`${countCustom(templates)} custom`}
          />

          <StatCard
            icon={<ShieldCheck size={15} />}
            label="Profiles"
            value={ruleProfiles.length}
            caption={`${countCustom(ruleProfiles)} custom`}
          />

          <StatCard
            icon={<WandSparkles size={15} />}
            label="Rules"
            value={ruleItems.length}
            caption="toggle rules"
          />

          <StatCard
            icon={<Check size={15} />}
            label="Criteria"
            value={acceptancePresets.length}
            caption="acceptance presets"
          />
        </div>
      </div>

      <div className="shrink-0 rounded-[1.5rem] border border-neutral-900 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
              <SlidersHorizontal size={15} />
            </span>

            <div>
              <p className="text-sm font-semibold text-white">
                Catalog console
              </p>

              <p className="mt-1 text-xs text-neutral-600">
                {status}
              </p>
            </div>
          </div>

          <motion.span
            key={`${activeTab}:${visibleCount}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="cf-badge"
          >
            {visibleCount} visible
          </motion.span>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600"
            />

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search catalog..."
              className="h-12 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <CustomSelect
            value={taskTypeFilter}
            onChange={setTaskTypeFilter}
            options={[
              {
                value: "all",
                label: "All task types",
                description: "Do not filter by task type"
              },
              ...TASK_TYPE_OPTIONS
            ]}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/30 p-3">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Catalog section
              </p>

              <p className="mt-1 text-xs text-neutral-600">
                Switch between templates, profiles, rules and criteria.
              </p>
            </div>

            {toast && (
              <button
                type="button"
                onClick={() => setToast("")}
                className="inline-flex h-8 max-w-[320px] items-center gap-2 rounded-full border border-neutral-900 bg-black/35 px-3 text-xs text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
              >
                <AlertTriangle size={13} />
                <span className="truncate">{toast}</span>
                <X size={13} />
              </button>
            )}
          </div>

          <SegmentedFilter
            value={activeTab}
            options={catalogTabOptions}
            onChange={(value) => setActiveTab(value as TemplatesTab)}
          />
        </div>
      </div>

      <div className="min-h-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === "templates" && (
            <motion.div
              key="templates"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
            >
              <div className="mb-3 shrink-0">
                <Pill>
                  <Sparkles size={12} />
                  Prompt templates
                </Pill>

                <h2 className="mt-3 text-xl font-semibold tracking-[-0.035em] text-white">
                  Base structure for generated Task Packs.
                </h2>
              </div>

              <div className="min-h-0 space-y-3 overflow-y-auto pr-2">
                {filteredTemplates.length === 0 ? (
                  <EmptyState
                    title="No templates found"
                    description="Try another search query or task type filter."
                  />
                ) : (
                  filteredTemplates.map((template) => (
                    <TemplateRow
                      key={template.id}
                      template={template}
                      onCopy={handleCopyTemplate}
                      onDelete={handleDeleteTemplate}
                    />
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "profiles" && (
            <motion.div
              key="profiles"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
            >
              <div className="mb-3 shrink-0">
                <Pill>
                  <ShieldCheck size={12} />
                  Rule profiles
                </Pill>

                <h2 className="mt-3 text-xl font-semibold tracking-[-0.035em] text-white">
                  Bundles of toggle rules and acceptance presets.
                </h2>
              </div>

              <div className="min-h-0 space-y-3 overflow-y-auto pr-2">
                {filteredProfiles.length === 0 ? (
                  <EmptyState
                    title="No profiles found"
                    description="Try another search query or task type filter."
                  />
                ) : (
                  filteredProfiles.map((profile) => (
                    <ProfileRow
                      key={profile.id}
                      profile={profile}
                      ruleItems={ruleItems}
                      preset={acceptancePresets.find(
                        (preset) => preset.id === profile.acceptanceCriteriaPresetId
                      )}
                      onCopy={handleCopyProfile}
                      onDelete={handleDeleteProfile}
                    />
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "rules" && (
            <motion.div
              key="rules"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
            >
              <div className="mb-3 shrink-0">
                <Pill>
                  <WandSparkles size={12} />
                  Toggle rules
                </Pill>

                <h2 className="mt-3 text-xl font-semibold tracking-[-0.035em] text-white">
                  Backend-validated instructions inserted into Task Packs.
                </h2>
              </div>

              <div className="min-h-0 overflow-y-auto pr-2">
                {filteredRules.length === 0 ? (
                  <EmptyState
                    title="No rules found"
                    description="Try another search query or task type filter."
                  />
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    {filteredRules.map((rule) => (
                      <RuleCard key={rule.id} rule={rule} />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "criteria" && (
            <motion.div
              key="criteria"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
            >
              <div className="mb-3 shrink-0">
                <Pill>
                  <Check size={12} />
                  Acceptance criteria
                </Pill>

                <h2 className="mt-3 text-xl font-semibold tracking-[-0.035em] text-white">
                  Presets for checking generated work.
                </h2>
              </div>

              <div className="min-h-0 overflow-y-auto pr-2">
                {filteredCriteria.length === 0 ? (
                  <EmptyState
                    title="No criteria found"
                    description="Try another search query or task type filter."
                  />
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    {filteredCriteria.map((preset) => (
                      <CriteriaCard key={preset.id} preset={preset} />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {draftKind && (
          <CreatePanel
            draftKind={draftKind}
            onClose={() => setDraftKind(null)}
            ruleItems={ruleItems}
            acceptancePresets={acceptancePresets}
            onTemplateCreated={loadCatalog}
            onProfileCreated={loadCatalog}
          />
        )}
      </AnimatePresence>
    </section>
  );
}