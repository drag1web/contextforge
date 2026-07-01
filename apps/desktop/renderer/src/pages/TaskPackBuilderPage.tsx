import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  Lightbulb,
  Loader2,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WandSparkles
} from "lucide-react";

import {
  getRuleProfilesCatalog,
  getTemplates
} from "../api/client";
import type {
  AcceptanceCriteriaPreset,
  PromptTemplate,
  RuleItem,
  RuleProfile,
  TaskPackDraft,
  TemplateTaskType
} from "../types";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { CustomSelect } from "../components/ui/CustomSelect";
import { TARGET_TOOL_OPTIONS } from "../components/ai/aiToolOptions";

interface TaskPackBuilderPageProps {
  draft: TaskPackDraft;
  isLoading: boolean;
  onChange: (draft: TaskPackDraft) => void;
  onClose: () => void;
  onAnalyzeContext: () => void;
  onGenerate: () => void;
}

const TASK_EXAMPLES = [
  {
    label: "UI polish",
    value:
      "Improve the selected page UI without changing backend behavior. Keep the current functionality, make the layout cleaner, add smooth interactions, and preserve the existing design system."
  },
  {
    label: "Bugfix",
    value:
      "Find and fix the issue described below. Keep the solution minimal, explain the root cause, and avoid unrelated refactoring."
  },
  {
    label: "Refactor",
    value:
      "Refactor this area to improve readability and maintainability without changing user-visible behavior. Preserve existing APIs and add notes about any risky assumptions."
  },
  {
    label: "Backend",
    value:
      "Implement the backend changes for this feature, including API behavior, validation, error handling, and any required persistence updates."
  }
];

const TASK_TYPE_OPTIONS: Array<{
  value: TemplateTaskType;
  label: string;
  description: string;
}> = [
    { value: "general", label: "General", description: "Universal task" },
    { value: "ui", label: "UI / UX", description: "Interface work" },
    { value: "backend", label: "Backend", description: "API / DB / server" },
    { value: "fullstack", label: "Fullstack", description: "UI + backend" },
    { value: "build", label: "Build", description: "Build / config" },
    { value: "bugfix", label: "Bugfix", description: "Minimal fix" },
    { value: "refactor", label: "Refactor", description: "No behavior change" },
    { value: "docs", label: "Docs", description: "Documentation" },
    { value: "tests", label: "Tests", description: "Verification" }
  ];

function getTaskQuality(rawTask: string, t: (key: string) => string) {
  const length = rawTask.trim().length;

  if (length >= 120) {
    return {
      label: t("taskPackBuilder.goodTask"),
      description: t("taskPackBuilder.goodTaskDesc"),
      tone: "text-emerald-300",
      icon: <CheckCircle2 size={15} />
    };
  }

  if (length >= 30) {
    return {
      label: t("taskPackBuilder.needsMoreDetail"),
      description: t("taskPackBuilder.needsMoreDetailDesc"),
      tone: "text-white",
      icon: <AlertTriangle size={15} />
    };
  }

  return {
    label: t("taskPackBuilder.tooShort"),
    description: t("taskPackBuilder.tooShortDesc"),
    tone: "text-red-400",
    icon: <AlertTriangle size={15} />
  };
}

function findDefaultTemplate(
  templates: PromptTemplate[],
  targetTool: string,
  taskType: string
) {
  return (
    templates.find(
      (template) =>
        template.targetTool === targetTool && template.taskType === taskType
    ) ??
    templates.find(
      (template) =>
        template.targetTool === targetTool && template.taskType === "general"
    ) ??
    templates.find(
      (template) =>
        template.targetTool === "generic" && template.taskType === taskType
    ) ??
    templates.find(
      (template) =>
        template.targetTool === "generic" && template.taskType === "general"
    ) ??
    templates[0]
  );
}

function findDefaultProfile(profiles: RuleProfile[], taskType: string) {
  const map: Record<string, string> = {
    general: "profile.safe-general",
    ui: "profile.safe-ui-task",
    backend: "profile.backend-safe-change",
    fullstack: "profile.backend-safe-change",
    build: "profile.backend-safe-change",
    bugfix: "profile.bugfix-minimal-change",
    refactor: "profile.refactor-no-behavior-change",
    docs: "profile.docs-update",
    tests: "profile.tests-verification"
  };

  return (
    profiles.find((profile) => profile.id === map[taskType]) ??
    profiles.find((profile) => profile.id === "profile.safe-general") ??
    profiles[0]
  );
}

function getLinesCount(value?: string) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function getTaskTypeLabel(value: string) {
  return TASK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getTargetToolLabel(value: string) {
  return TARGET_TOOL_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function Pill({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning";
}) {
  const className =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : "border-neutral-800 bg-neutral-950 text-neutral-400";

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

function CompactMetric({
  label,
  value,
  caption
}: {
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
      <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-semibold text-white">
        {value}
      </p>

      <p className="mt-0.5 truncate text-[10px] text-neutral-600">
        {caption}
      </p>
    </div>
  );
}

function RuleToggleRow({
  rule,
  checked,
  onToggle
}: {
  rule: RuleItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        "group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
        checked
          ? "border-white/20 bg-white/[0.055]"
          : "border-neutral-900 bg-black/25 hover:border-white/20 hover:bg-white/[0.035]"
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition",
          checked
            ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
            : "border-neutral-800 bg-neutral-950 text-neutral-700 group-hover:text-white"
        ].join(" ")}
      >
        {checked && <Check size={12} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-white">
            {rule.title}
          </span>

          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-500">
            {rule.category}
          </span>
        </span>

        <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-neutral-600">
          {rule.description}
        </span>
      </span>
    </button>
  );
}

function SelectedRulePreview({
  rule
}: {
  rule: RuleItem;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={13} className="shrink-0 text-emerald-300" />

        <p className="truncate text-xs font-medium text-white">
          {rule.title}
        </p>
      </div>

      <p className="mt-1 truncate text-[11px] text-neutral-600">
        {rule.category}
      </p>
    </div>
  );
}

function RulesManagerModal({
  visibleRuleItems,
  selectedRuleItems,
  enabledRuleIds,
  enabledRuleIdSet,
  selectedProfile,
  onToggle,
  onResetToProfile,
  onClose
}: {
  visibleRuleItems: RuleItem[];
  selectedRuleItems: RuleItem[];
  enabledRuleIds: string[];
  enabledRuleIdSet: Set<string>;
  selectedProfile: RuleProfile | undefined;
  onToggle: (ruleId: string) => void;
  onResetToProfile: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categories = useMemo(
    () => Array.from(new Set(visibleRuleItems.map((rule) => rule.category))),
    [visibleRuleItems]
  );

  const filteredRules = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return visibleRuleItems.filter((rule) => {
      const matchesQuery =
        !normalizedQuery ||
        [rule.title, rule.description, rule.content, rule.category]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      const matchesCategory =
        categoryFilter === "all" || rule.category === categoryFilter;

      return matchesQuery && matchesCategory;
    });
  }, [categoryFilter, query, visibleRuleItems]);

  return (
    <Modal
      title="Manage enabled rules"
      eyebrow="Rules & Templates"
      maxWidth="max-w-7xl"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="hidden min-w-0 md:block">
            <p className="text-xs font-medium text-white">
              {enabledRuleIds.length} rule(s) will be inserted into the Task Pack.
            </p>

            <p className="mt-0.5 text-[11px] text-neutral-600">
              Backend validates selected rule IDs before rendering the final prompt.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              onClick={onResetToProfile}
              disabled={!selectedProfile}
            >
              <RotateCcw size={15} />
              Profile defaults
            </Button>

            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid h-[min(760px,calc(100vh-190px))] min-h-0 gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
          <div className="shrink-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-emerald-300">
                <ShieldCheck size={19} />
              </span>

              <Pill tone="success">
                {enabledRuleIds.length} enabled
              </Pill>
            </div>

            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Current selection
            </p>

            <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-white">
              Selected constraints
            </h3>

            <p className="mt-2 text-xs leading-5 text-neutral-600">
              This list is exactly what the generated Task Pack will receive as toggle rules.
            </p>

            {selectedProfile && (
              <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-xs font-semibold text-white">
                  {selectedProfile.name}
                </p>

                <p className="mt-1 text-[11px] leading-4 text-neutral-600">
                  Current rule profile · {selectedProfile.enabledRuleIds.length} default rule(s)
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/25 p-2">
            <div className="h-full space-y-2 overflow-y-auto pr-1">
              {selectedRuleItems.length > 0 ? (
                selectedRuleItems.map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => onToggle(rule.id)}
                    className="group flex w-full items-start gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-left transition hover:border-red-400/25 hover:bg-red-400/[0.035]"
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 transition group-hover:border-red-400/25 group-hover:bg-red-400/10 group-hover:text-red-200">
                      <Check size={12} />
                    </span>

                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-white">
                        {rule.title}
                      </span>

                      <span className="mt-1 block truncate text-[11px] text-neutral-600">
                        {rule.category} · click to disable
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-neutral-800 p-5 text-center">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      No rules enabled
                    </p>

                    <p className="mt-2 text-xs leading-5 text-neutral-600">
                      Select rules from the right panel or restore profile defaults.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="shrink-0">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
              <div>
                <div className="mb-4 flex size-11 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                  <SlidersHorizontal size={19} />
                </div>

                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Available rules
                </p>

                <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-white">
                  Toggle workflow constraints
                </h3>

                <p className="mt-2 max-w-2xl text-xs leading-5 text-neutral-600">
                  Pick only the rules that matter for this task. Keep the enabled set focused to avoid prompt noise.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-neutral-900 bg-black/30 p-2">
                <CompactMetric
                  label="Visible"
                  value={filteredRules.length}
                  caption="rules"
                />

                <CompactMetric
                  label="Enabled"
                  value={enabledRuleIds.length}
                  caption="selected"
                />

                <CompactMetric
                  label="Profile"
                  value={selectedProfile?.enabledRuleIds.length ?? 0}
                  caption="defaults"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600"
                />

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search rules..."
                  className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
                />
              </div>

              <CustomSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  {
                    value: "all",
                    label: "All categories",
                    description: "Show all visible rules"
                  },
                  ...categories.map((category) => ({
                    value: category,
                    label: category,
                    description: "Rule category"
                  }))
                ]}
              />
            </div>
          </div>

          <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/20 p-3">
            <div className="h-full overflow-y-auto pr-1">
              {filteredRules.length > 0 ? (
                <div className="grid gap-3 2xl:grid-cols-2">
                  {filteredRules.map((rule) => (
                    <RuleToggleRow
                      key={rule.id}
                      rule={rule}
                      checked={enabledRuleIdSet.has(rule.id)}
                      onToggle={() => onToggle(rule.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-neutral-800 p-8 text-center">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      No rules found
                    </p>

                    <p className="mt-2 text-xs leading-5 text-neutral-600">
                      Try a different search query or category filter.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function TaskPackBuilderPage({
  draft,
  isLoading,
  onChange,
  onClose,
  onAnalyzeContext,
  onGenerate
}: TaskPackBuilderPageProps) {
  const { t } = useTranslation();

  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [ruleProfiles, setRuleProfiles] = useState<RuleProfile[]>([]);
  const [ruleItems, setRuleItems] = useState<RuleItem[]>([]);
  const [acceptancePresets, setAcceptancePresets] = useState<AcceptanceCriteriaPreset[]>([]);
  const [catalogStatus, setCatalogStatus] = useState("Loading rules and templates...");
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);

  const taskLength = draft.rawTask.trim().length;
  const taskQuality = useMemo(() => getTaskQuality(draft.rawTask, t), [draft.rawTask, t]);
  const canGenerate = taskLength >= 3 && !isLoading;

  const selectedTemplate = templates.find((template) => template.id === draft.templateId);
  const selectedProfile = ruleProfiles.find((profile) => profile.id === draft.ruleProfileId);
  const selectedPreset = acceptancePresets.find(
    (preset) => preset.id === draft.acceptanceCriteriaPresetId
  );

  const enabledRuleIds = draft.enabledRuleIds ?? [];
  const enabledRuleIdSet = useMemo(() => new Set(enabledRuleIds), [enabledRuleIds]);

  const customRulesCount = getLinesCount(draft.customRulesText);
  const customCriteriaCount = getLinesCount(draft.acceptanceCriteriaText);
  const presetCriteriaCount = selectedPreset?.criteria.length ?? 0;
  const totalCriteriaCount = presetCriteriaCount + customCriteriaCount;

  const selectedRuleItems = useMemo(
    () => ruleItems.filter((rule) => enabledRuleIdSet.has(rule.id)),
    [enabledRuleIdSet, ruleItems]
  );

  const visibleRuleItems = useMemo(() => {
    const taskType = draft.taskType;

    return ruleItems.filter((rule) => {
      if (
        rule.category === "general" ||
        rule.category === "verification" ||
        rule.category === "assets"
      ) {
        return true;
      }

      return rule.category === taskType;
    });
  }, [draft.taskType, ruleItems]);

  const taskExamples = useMemo(
    () =>
      TASK_EXAMPLES.map((example) => ({
        ...example,
        label:
          example.label === "UI polish"
            ? t("taskPackBuilder.exampleUi")
            : example.label === "Bugfix"
              ? t("taskPackBuilder.exampleBugfix")
              : example.label === "Refactor"
                ? t("taskPackBuilder.exampleRefactor")
                : t("taskPackBuilder.exampleBackend")
      })),
    [t]
  );

  const templateOptions = useMemo(
    () =>
      templates.map((template) => ({
        value: template.id,
        label: template.name,
        description: `${template.targetTool} · ${template.taskType}${template.isBuiltin ? " · built-in" : " · custom"}`
      })),
    [templates]
  );

  const profileOptions = useMemo(
    () =>
      ruleProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        description: `${profile.taskType}${profile.isBuiltin ? " · built-in" : " · custom"}`
      })),
    [ruleProfiles]
  );

  const presetOptions = useMemo(
    () => [
      {
        value: "",
        label: "No preset",
        description: "Only custom acceptance criteria"
      },
      ...acceptancePresets.map((preset) => ({
        value: preset.id,
        label: preset.name,
        description: `${preset.taskType}${preset.isBuiltin ? " · built-in" : " · custom"}`
      }))
    ],
    [acceptancePresets]
  );

  function updateDraft(patch: Partial<TaskPackDraft>) {
    onChange({
      ...draft,
      ...patch
    });
  }

  function applyGenerationDefaults(nextDraft: TaskPackDraft) {
    const template = findDefaultTemplate(
      templates,
      nextDraft.targetTool,
      nextDraft.taskType
    );

    const profile = findDefaultProfile(ruleProfiles, nextDraft.taskType);

    onChange({
      ...nextDraft,
      templateId: template?.id,
      ruleProfileId: profile?.id,
      enabledRuleIds: profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId: profile?.acceptanceCriteriaPresetId ?? ""
    });
  }

  function handleTaskTypeChange(taskType: string) {
    applyGenerationDefaults({
      ...draft,
      taskType
    });
  }

  function handleTargetToolChange(targetTool: string) {
    applyGenerationDefaults({
      ...draft,
      targetTool
    });
  }

  function handleRuleProfileChange(ruleProfileId: string) {
    const profile = ruleProfiles.find((item) => item.id === ruleProfileId);

    updateDraft({
      ruleProfileId,
      enabledRuleIds: profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId: profile?.acceptanceCriteriaPresetId ?? ""
    });
  }

  function toggleRule(ruleId: string) {
    const next = enabledRuleIdSet.has(ruleId)
      ? enabledRuleIds.filter((item) => item !== ruleId)
      : [...enabledRuleIds, ruleId];

    updateDraft({
      enabledRuleIds: next
    });
  }

  function resetRulesFromProfile() {
    updateDraft({
      enabledRuleIds: selectedProfile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId:
        selectedProfile?.acceptanceCriteriaPresetId ??
        draft.acceptanceCriteriaPresetId
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadCatalog() {
      try {
        setCatalogStatus("Loading rules and templates...");

        const [templatesData, ruleCatalog] = await Promise.all([
          getTemplates(),
          getRuleProfilesCatalog()
        ]);

        if (!isMounted) {
          return;
        }

        setTemplates(templatesData);
        setRuleProfiles(ruleCatalog.ruleProfiles);
        setRuleItems(ruleCatalog.ruleItems);
        setAcceptancePresets(ruleCatalog.acceptanceCriteriaPresets);
        setCatalogStatus("Rules and templates loaded.");
      } catch (error) {
        setCatalogStatus(
          error instanceof Error
            ? error.message
            : "Failed to load rules and templates."
        );
      }
    }

    loadCatalog();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (templates.length === 0 || ruleProfiles.length === 0) {
      return;
    }

    if (draft.templateId && draft.ruleProfileId) {
      return;
    }

    const template = findDefaultTemplate(templates, draft.targetTool, draft.taskType);
    const profile = findDefaultProfile(ruleProfiles, draft.taskType);

    onChange({
      ...draft,
      templateId: draft.templateId ?? template?.id,
      ruleProfileId: draft.ruleProfileId ?? profile?.id,
      enabledRuleIds:
        draft.enabledRuleIds && draft.enabledRuleIds.length > 0
          ? draft.enabledRuleIds
          : profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId:
        draft.acceptanceCriteriaPresetId ??
        profile?.acceptanceCriteriaPresetId ??
        ""
    });
  }, [templates, ruleProfiles]);

  return (
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <header className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <Pill>
                <Sparkles size={12} />
                v0.5 Rules & Templates
              </Pill>

              <Pill>{draft.projectName}</Pill>
              <Pill>{catalogStatus}</Pill>
            </div>

            <h1 className="text-[30px] font-semibold leading-[1.04] tracking-[-0.055em] text-white">
              Build an agent-ready Task Pack.
            </h1>

            <p className="mt-2 max-w-4xl text-sm leading-6 text-neutral-500">
              Describe the task, choose a template, apply a rule profile, add custom constraints, then generate or analyze context.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Button variant="secondary" onClick={onClose}>
              <ArrowLeft size={15} />
              {t("taskPackBuilder.back")}
            </Button>

            <Button
              variant="secondary"
              onClick={onAnalyzeContext}
              disabled={!canGenerate}
            >
              <Sparkles size={15} />
              {t("taskPackBuilder.analyzeContext")}
            </Button>

            <Button
              variant="primary"
              onClick={onGenerate}
              disabled={!canGenerate}
            >
              {isLoading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <WandSparkles size={15} />
              )}
              {isLoading ? t("taskPackBuilder.generating") : t("taskPackBuilder.generateTaskPack")}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Task
                </p>

                <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
                  Describe what the coding agent should do.
                </h2>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                  Be specific about scope, constraints, expected output, and what must not change.
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-neutral-900 bg-black/35 px-3 py-2">
                <span className={taskQuality.tone}>
                  {taskQuality.icon}
                </span>

                <div>
                  <p className="text-xs font-semibold text-white">
                    {taskQuality.label}
                  </p>

                  <p className="text-[11px] text-neutral-600">
                    {taskLength} chars
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {taskExamples.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => updateDraft({ rawTask: example.value })}
                  className="cf-invert-action inline-flex h-8 items-center rounded-full px-3 text-xs"
                >
                  {example.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
              <textarea
                value={draft.rawTask}
                onChange={(event) => updateDraft({ rawTask: event.target.value })}
                placeholder={t("taskPackBuilder.placeholder")}
                className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-xl border border-transparent bg-transparent p-4 text-sm leading-7 text-white outline-none placeholder:text-neutral-700 focus:border-white/10"
              />
            </div>
          </section>

          <section className="grid shrink-0 gap-4 lg:grid-cols-2">
            <article className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    Custom rules
                  </p>

                  <h3 className="mt-1 text-base font-semibold text-white">
                    One rule per line
                  </h3>
                </div>

                <Pill tone={customRulesCount > 0 ? "success" : "default"}>
                  {customRulesCount} custom
                </Pill>
              </div>

              <textarea
                value={draft.customRulesText ?? ""}
                onChange={(event) =>
                  updateDraft({ customRulesText: event.target.value })
                }
                placeholder={[
                  "Do not change backend/API behavior.",
                  "Do not add new dependencies.",
                  "Keep AppTitleBar untouched."
                ].join("\n")}
                className="h-32 w-full resize-none overflow-y-auto rounded-2xl border border-neutral-900 bg-black/55 p-4 text-sm leading-6 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
              />

              <p className="mt-3 text-xs leading-5 text-neutral-600">
                Backend trims, deduplicates and caps rules before generation.
              </p>
            </article>

            <article className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    Acceptance
                  </p>

                  <h3 className="mt-1 text-base font-semibold text-white">
                    Preset + custom checks
                  </h3>
                </div>

                <Pill tone={customCriteriaCount > 0 ? "success" : "default"}>
                  {totalCriteriaCount} checks
                </Pill>
              </div>

              <div className="mb-3">
                <CustomSelect
                  value={draft.acceptanceCriteriaPresetId ?? ""}
                  onChange={(value) =>
                    updateDraft({ acceptanceCriteriaPresetId: value || undefined })
                  }
                  options={presetOptions}
                />
              </div>

              <textarea
                value={draft.acceptanceCriteriaText ?? ""}
                onChange={(event) =>
                  updateDraft({ acceptanceCriteriaText: event.target.value })
                }
                placeholder={[
                  "Add extra acceptance criteria here.",
                  "Example: final response must list verification steps."
                ].join("\n")}
                className="h-24 w-full resize-none overflow-y-auto rounded-2xl border border-neutral-900 bg-black/55 p-3 text-sm leading-5 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
              />
            </article>
          </section>
        </main>

        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <Settings2 size={18} />
              </span>

              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Recipe setup
                </p>

                <h2 className="text-base font-semibold text-white">
                  Template and rule profile
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs text-neutral-500">
                  Task type
                </label>

                <CustomSelect
                  value={draft.taskType}
                  onChange={handleTaskTypeChange}
                  options={TASK_TYPE_OPTIONS}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs text-neutral-500">
                  Target AI tool
                </label>

                <CustomSelect
                  value={draft.targetTool}
                  onChange={handleTargetToolChange}
                  options={TARGET_TOOL_OPTIONS}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs text-neutral-500">
                  Prompt template
                </label>

                <CustomSelect
                  value={draft.templateId ?? ""}
                  onChange={(value) => updateDraft({ templateId: value })}
                  options={templateOptions}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs text-neutral-500">
                  Rule profile
                </label>

                <CustomSelect
                  value={draft.ruleProfileId ?? ""}
                  onChange={handleRuleProfileChange}
                  options={profileOptions}
                />
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-900 pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    Applied recipe
                  </p>

                  <p className="mt-1 text-sm font-semibold text-white">
                    What will be inserted
                  </p>
                </div>

                <Pill tone="success">
                  {enabledRuleIds.length} rules
                </Pill>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <CompactMetric
                  label="Task"
                  value={getTaskTypeLabel(draft.taskType)}
                  caption={getTargetToolLabel(draft.targetTool)}
                />

                <CompactMetric
                  label="Rules"
                  value={enabledRuleIds.length}
                  caption="toggle"
                />

                <CompactMetric
                  label="Custom"
                  value={customRulesCount}
                  caption="rules"
                />

                <CompactMetric
                  label="Checks"
                  value={totalCriteriaCount}
                  caption="criteria"
                />
              </div>

              <div className="mt-3 rounded-2xl border border-neutral-900 bg-black/35 p-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                    <FileText size={14} />
                  </span>

                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">
                      {selectedTemplate?.name ?? "No template selected"}
                    </p>

                    <p className="mt-1 truncate text-[11px] text-neutral-600">
                      {selectedProfile?.name ?? "No rule profile selected"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                  <Lightbulb size={18} />
                </div>

                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Enabled rules
                </p>

                <h2 className="mt-1 text-base font-semibold text-white">
                  Preview selected constraints
                </h2>

                <p className="mt-2 text-xs leading-5 text-neutral-600">
                  This preview is read-only. Open the manager to enable or disable rules.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsRulesModalOpen(true)}
                className="cf-invert-action inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-xs"
              >
                <SlidersHorizontal size={13} />
                Manage
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="h-full min-h-0 space-y-2 overflow-y-auto pr-1">
                {selectedRuleItems.length > 0 ? (
                  selectedRuleItems.map((rule) => (
                    <SelectedRulePreview
                      key={rule.id}
                      rule={rule}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-neutral-900 bg-black/35 p-3 text-xs leading-5 text-neutral-600">
                    No toggle rules enabled. Select a profile or open the rule manager.
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
      {isRulesModalOpen && (
        <RulesManagerModal
          visibleRuleItems={visibleRuleItems}
          selectedRuleItems={selectedRuleItems}
          enabledRuleIds={enabledRuleIds}
          enabledRuleIdSet={enabledRuleIdSet}
          selectedProfile={selectedProfile}
          onToggle={toggleRule}
          onResetToProfile={resetRulesFromProfile}
          onClose={() => setIsRulesModalOpen(false)}
        />
      )}
    </section>
  );
}