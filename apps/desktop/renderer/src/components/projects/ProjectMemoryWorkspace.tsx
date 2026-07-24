import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  CheckCircle2,
  CircleOff,
  Edit3,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  Project,
  ProjectMemory,
  ProjectMemoryCategory,
  ProjectMemoryInput,
} from "../../types";
import { Button } from "../ui/Button";
import { CustomSelect, type SelectOption } from "../ui/CustomSelect";
import { DropdownMenu } from "../ui/DropdownMenu";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";

type MemoryFilter = "all" | "active" | "disabled";

type ProjectMemoryWorkspaceProps = {
  project: Project;
  memories: ProjectMemory[];
  isLoading: boolean;
  onCreate: (input: ProjectMemoryInput) => Promise<void>;
  onUpdate: (memoryId: number, input: Partial<ProjectMemoryInput>) => Promise<void>;
  onDelete: (memoryId: number) => Promise<void>;
};

const MEMORY_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
} as const;

const EMPTY_FORM: ProjectMemoryInput = {
  title: "",
  content: "",
  category: "custom",
  isEnabled: true,
};

const MEMORY_CATEGORIES: ProjectMemoryCategory[] = [
  "architecture",
  "do_not_change",
  "style",
  "verification",
  "workflow",
  "custom",
];

function MemoryForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  isLoading,
}: {
  value: ProjectMemoryInput;
  onChange: (value: ProjectMemoryInput) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const canSubmit = value.title.trim().length > 0 && value.content.trim().length > 0;

  const categoryOptions = useMemo<SelectOption<ProjectMemoryCategory>[]>(
    () =>
      MEMORY_CATEGORIES.map((category) => ({
        value: category,
        label: t(`contextBuilder.memoryCategory.${category}.label`),
        description: t(`contextBuilder.memoryCategory.${category}.description`),
      })),
    [t],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={MEMORY_TRANSITION}
      className="rounded-[1.5rem] border border-neutral-800 bg-black/45 p-4"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <label className="block">
          <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("contextBuilder.memoryTitleLabel")}
          </span>
          <input
            value={value.title}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
            placeholder={t("contextBuilder.memoryTitlePlaceholder")}
            className="mt-2 h-11 w-full rounded-2xl border border-neutral-900 bg-black/55 px-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:ring-4 focus:ring-white/5"
          />
        </label>

        <label className="block">
          <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("contextBuilder.memoryCategoryLabel")}
          </span>
          <CustomSelect<ProjectMemoryCategory>
            value={value.category}
            options={categoryOptions}
            onChange={(category) => onChange({ ...value, category })}
            className="mt-2"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {t("contextBuilder.memoryContentLabel")}
        </span>
        <textarea
          value={value.content}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
          rows={4}
          placeholder={t("contextBuilder.memoryContentPlaceholder")}
          className="mt-2 w-full resize-none rounded-2xl border border-neutral-900 bg-black/55 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:ring-4 focus:ring-white/5"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange({ ...value, isEnabled: !value.isEnabled })}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 text-xs font-medium text-neutral-400 transition hover:border-neutral-800 hover:text-white"
        >
          {value.isEnabled ? (
            <CheckCircle2 size={14} className="text-emerald-300" />
          ) : (
            <CircleOff size={14} />
          )}
          {value.isEnabled
            ? t("contextBuilder.memoryIncluded")
            : t("contextBuilder.memoryDisabled")}
        </button>

        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
              <X size={14} />
              {t("contextBuilder.memoryCancel")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            onClick={onSubmit}
            disabled={!canSubmit || isLoading}
          >
            <Save size={14} />
            {submitLabel}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function ProjectMemoryWorkspace({
  project,
  memories,
  isLoading,
  onCreate,
  onUpdate,
  onDelete,
}: ProjectMemoryWorkspaceProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectMemoryInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ProjectMemoryInput>(EMPTY_FORM);

  const activeCount = memories.filter((memory) => memory.isEnabled).length;
  const filteredMemories = useMemo(() => {
    const sorted = [...memories].sort((a, b) => {
      if (a.isEnabled !== b.isEnabled) return Number(b.isEnabled) - Number(a.isEnabled);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    if (filter === "active") return sorted.filter((memory) => memory.isEnabled);
    if (filter === "disabled") return sorted.filter((memory) => !memory.isEnabled);
    return sorted;
  }, [filter, memories]);

  const filters: Array<{ value: MemoryFilter; label: string; count: number }> = [
    { value: "all", label: t("contextBuilder.memoryFilterAll"), count: memories.length },
    { value: "active", label: t("contextBuilder.memoryFilterActive"), count: activeCount },
    {
      value: "disabled",
      label: t("contextBuilder.memoryFilterDisabled"),
      count: memories.length - activeCount,
    },
  ];

  async function handleCreate() {
    await onCreate({
      ...draft,
      title: draft.title.trim(),
      content: draft.content.trim(),
    });
    setDraft(EMPTY_FORM);
    setIsComposerOpen(false);
  }

  async function handleSave(memoryId: number) {
    await onUpdate(memoryId, {
      ...editDraft,
      title: editDraft.title.trim(),
      content: editDraft.content.trim(),
    });
    setEditingId(null);
    setEditDraft(EMPTY_FORM);
  }

  function startEdit(memory: ProjectMemory) {
    setEditingId(memory.id);
    setEditDraft({
      title: memory.title,
      content: memory.content,
      category: memory.category,
      isEnabled: memory.isEnabled,
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Brain size={19} />
            </span>
            <div className="min-w-0">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {project.name}
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-white">
                {t("contextBuilder.memoryWorkspaceTitle")}
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
                {t("contextBuilder.memoryWorkspaceDescription")}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant={isComposerOpen ? "secondary" : "primary"}
            onClick={() => setIsComposerOpen((current) => !current)}
            disabled={isLoading}
          >
            {isComposerOpen ? <X size={15} /> : <Plus size={15} />}
            {isComposerOpen
              ? t("contextBuilder.memoryCloseComposer")
              : t("contextBuilder.memoryAdd")}
          </Button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("contextBuilder.memoryTotal")}
            </p>
            <p className="mt-1 text-xl font-semibold text-white">{memories.length}</p>
          </div>
          <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("contextBuilder.memoryActive")}
            </p>
            <p className="mt-1 text-xl font-semibold text-white">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("contextBuilder.memoryUsage")}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {t("contextBuilder.memoryUsageValue")}
            </p>
          </div>
        </div>
      </section>

      <AnimatePresence initial={false}>
        {isComposerOpen ? (
          <MemoryForm
            value={draft}
            onChange={setDraft}
            onSubmit={() => void handleCreate()}
            onCancel={() => {
              setDraft(EMPTY_FORM);
              setIsComposerOpen(false);
            }}
            submitLabel={t("contextBuilder.memorySaveNew")}
            isLoading={isLoading}
          />
        ) : null}
      </AnimatePresence>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <HorizontalSlidingSelector
          items={filters}
          activeIndex={filters.findIndex((item) => item.value === filter)}
          getItemKey={(item) => item.value}
          onSelect={(item) => setFilter(item.value)}
          renderItem={(item, isActive) => (
            <span className="flex h-10 items-center justify-center gap-2 px-4 text-xs font-semibold">
              <span>{item.label}</span>
              <span className={isActive ? "text-black/55" : "text-neutral-700"}>{item.count}</span>
            </span>
          )}
          className="w-full lg:max-w-xl"
          ariaLabel={t("contextBuilder.memoryFilterLabel")}
        />

        <p className="text-xs text-neutral-600">
          {t("contextBuilder.memorySafeNote")}
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {filteredMemories.length === 0 ? (
          <div className="xl:col-span-2 rounded-[1.5rem] border border-dashed border-neutral-800 bg-black/20 p-8 text-center">
            <Brain size={22} className="mx-auto text-neutral-600" />
            <p className="mt-4 text-sm font-semibold text-white">
              {t("contextBuilder.memoryEmptyTitle")}
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-500">
              {t("contextBuilder.memoryEmptyDescription")}
            </p>
          </div>
        ) : (
          filteredMemories.map((memory) => {
            const isEditing = editingId === memory.id;

            if (isEditing) {
              return (
                <MemoryForm
                  key={memory.id}
                  value={editDraft}
                  onChange={setEditDraft}
                  onSubmit={() => void handleSave(memory.id)}
                  onCancel={() => {
                    setEditingId(null);
                    setEditDraft(EMPTY_FORM);
                  }}
                  submitLabel={t("contextBuilder.memorySaveChanges")}
                  isLoading={isLoading}
                />
              );
            }

            return (
              <motion.article
                layout
                key={memory.id}
                transition={MEMORY_TRANSITION}
                className={[
                  "rounded-[1.5rem] border p-4",
                  memory.isEnabled
                    ? "border-neutral-800 bg-black/40"
                    : "border-neutral-900 bg-black/20 opacity-70",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-neutral-600">
                      <span className="rounded-lg border border-neutral-900 bg-black/35 px-2 py-1">
                        {t(`contextBuilder.memoryCategory.${memory.category}.label`)}
                      </span>
                      <span>{memory.isEnabled ? t("contextBuilder.memoryActive") : t("contextBuilder.memoryDisabled")}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-white">{memory.title}</h4>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-neutral-500">
                      {memory.content}
                    </p>
                  </div>

                  <DropdownMenu
                    ariaLabel={t("contextBuilder.memoryActions")}
                    actions={[
                      {
                        label: memory.isEnabled
                          ? t("contextBuilder.memoryDisable")
                          : t("contextBuilder.memoryEnable"),
                        icon: memory.isEnabled ? <CircleOff size={14} /> : <CheckCircle2 size={14} />,
                        onClick: () => void onUpdate(memory.id, { isEnabled: !memory.isEnabled }),
                        disabled: isLoading,
                      },
                      {
                        label: t("contextBuilder.memoryEdit"),
                        icon: <Edit3 size={14} />,
                        onClick: () => startEdit(memory),
                        disabled: isLoading,
                      },
                      {
                        label: t("contextBuilder.memoryDelete"),
                        icon: <Trash2 size={14} />,
                        onClick: () => void onDelete(memory.id),
                        disabled: isLoading,
                      },
                    ]}
                  />
                </div>
              </motion.article>
            );
          })
        )}
      </div>
    </div>
  );
}
