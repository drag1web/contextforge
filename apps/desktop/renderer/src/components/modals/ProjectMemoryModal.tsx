import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleOff,
  Edit3,
  Save,
  Trash2,
  X
} from "lucide-react";

import type { Project, ProjectMemory, ProjectMemoryCategory, ProjectMemoryInput } from "../../types";
import { Button } from "../ui/Button";
import { CustomSelect, type SelectOption } from "../ui/CustomSelect";
import { Modal } from "../ui/Modal";

type ProjectMemoryModalProps = {
  project: Project;
  memories: ProjectMemory[];
  isLoading: boolean;
  onClose: () => void;
  onCreate: (input: ProjectMemoryInput) => Promise<void>;
  onUpdate: (memoryId: number, input: Partial<ProjectMemoryInput>) => Promise<void>;
  onDelete: (memoryId: number) => Promise<void>;
};

const MEMORY_CATEGORIES: Array<{
  value: ProjectMemoryCategory;
  label: string;
  description: string;
}> = [
  {
    value: "architecture",
    label: "Architecture",
    description: "Long-term architecture choices."
  },
  {
    value: "do_not_change",
    label: "Do not change",
    description: "Files, flows, or contracts agents must not change."
  },
  {
    value: "style",
    label: "Style",
    description: "UI, copy, naming, or design direction."
  },
  {
    value: "verification",
    label: "Verification",
    description: "Checks that should appear in Task Packs."
  },
  {
    value: "workflow",
    label: "Workflow",
    description: "How agents should approach this project."
  },
  {
    value: "custom",
    label: "Custom",
    description: "Any persistent project note."
  }
];


const MEMORY_CATEGORY_OPTIONS: SelectOption<ProjectMemoryCategory>[] = MEMORY_CATEGORIES.map(
  (category) => ({
    value: category.value,
    label: category.label,
    description: category.description
  })
);

const EMPTY_FORM: ProjectMemoryInput = {
  title: "",
  content: "",
  category: "custom",
  isEnabled: true
};

function getCategoryLabel(category: ProjectMemoryCategory) {
  return MEMORY_CATEGORIES.find((item) => item.value === category)?.label ?? "Custom";
}

function MemoryForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  isLoading
}: {
  value: ProjectMemoryInput;
  onChange: (value: ProjectMemoryInput) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  isLoading: boolean;
}) {
  const canSubmit = value.title.trim().length > 0 && value.content.trim().length > 0;

  return (
    <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <label className="block">
          <span className="cf-tech-label text-[10px] uppercase text-neutral-600">Title</span>
          <input
            value={value.title}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
            placeholder="Keep backend/API unchanged"
            className="mt-2 h-11 w-full rounded-2xl border border-neutral-900 bg-black/55 px-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:ring-4 focus:ring-white/5"
          />
        </label>

        <label className="block">
          <span className="cf-tech-label text-[10px] uppercase text-neutral-600">Category</span>
          <CustomSelect<ProjectMemoryCategory>
            value={value.category}
            options={MEMORY_CATEGORY_OPTIONS}
            onChange={(category) => onChange({ ...value, category })}
            className="mt-2"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="cf-tech-label text-[10px] uppercase text-neutral-600">Memory content</span>
        <textarea
          value={value.content}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
          rows={4}
          placeholder="Describe the stable project rule or decision that should be included in future Task Packs."
          className="mt-2 w-full resize-none rounded-2xl border border-neutral-900 bg-black/55 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:ring-4 focus:ring-white/5"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange({ ...value, isEnabled: !value.isEnabled })}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-900 bg-black/35 px-3 py-2 text-xs font-medium text-neutral-400 transition hover:border-neutral-800 hover:text-white"
        >
          {value.isEnabled ? (
            <CheckCircle2 size={14} className="text-emerald-300" />
          ) : (
            <CircleOff size={14} />
          )}
          {value.isEnabled ? "Included in Task Packs" : "Disabled"}
        </button>

        <div className="flex items-center gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
              <X size={14} />
              Cancel
            </Button>
          )}
          <Button type="button" variant="primary" onClick={onSubmit} disabled={!canSubmit || isLoading}>
            <Save size={14} />
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProjectMemoryModal({
  project,
  memories,
  isLoading,
  onClose,
  onCreate,
  onUpdate,
  onDelete
}: ProjectMemoryModalProps) {
  const [draft, setDraft] = useState<ProjectMemoryInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ProjectMemoryInput>(EMPTY_FORM);

  const sortedMemories = useMemo(
    () => [...memories].sort((a, b) => Number(b.isEnabled) - Number(a.isEnabled)),
    [memories]
  );

  useEffect(() => {
    setDraft(EMPTY_FORM);
    setEditingId(null);
    setEditDraft(EMPTY_FORM);
  }, [project.id]);

  async function handleCreate() {
    await onCreate({
      ...draft,
      title: draft.title.trim(),
      content: draft.content.trim()
    });
    setDraft(EMPTY_FORM);
  }

  async function handleSaveEdit(memoryId: number) {
    await onUpdate(memoryId, {
      ...editDraft,
      title: editDraft.title.trim(),
      content: editDraft.content.trim()
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
      isEnabled: memory.isEnabled
    });
  }

  return (
    <Modal
      title="Project Memory / Decision Log"
      eyebrow={project.name}
      maxWidth="max-w-6xl"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
          Close
        </Button>
      }
    >
      <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <section>
          <div className="mb-4 rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Persistent context</p>
            <h4 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
              Add a stable project decision
            </h4>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              Enabled memory items are automatically inserted into generated Task Packs as project rules and decisions.
            </p>
          </div>

          <MemoryForm
            value={draft}
            onChange={setDraft}
            onSubmit={handleCreate}
            submitLabel="Add memory"
            isLoading={isLoading}
          />

          <div className="mt-4 grid gap-2">
            {MEMORY_CATEGORIES.map((category) => (
              <div key={category.value} className="rounded-2xl border border-neutral-900 bg-black/25 p-3">
                <p className="text-sm font-medium text-white">{category.label}</p>
                <p className="mt-1 text-xs leading-5 text-neutral-600">{category.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Saved memories</p>
              <h4 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                {memories.length} project memor{memories.length === 1 ? "y" : "ies"}
              </h4>
            </div>
            <span className="cf-badge">
              {memories.filter((memory) => memory.isEnabled).length} active
            </span>
          </div>

          <div className="space-y-3">
            {sortedMemories.length === 0 && (
              <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5 text-center">
                <p className="text-sm font-medium text-white">No project memory yet</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Add stable project rules, decisions, and verification notes to make future Task Packs safer.
                </p>
              </div>
            )}

            {sortedMemories.map((memory) => {
              const isEditing = editingId === memory.id;

              if (isEditing) {
                return (
                  <MemoryForm
                    key={memory.id}
                    value={editDraft}
                    onChange={setEditDraft}
                    onSubmit={() => handleSaveEdit(memory.id)}
                    onCancel={() => {
                      setEditingId(null);
                      setEditDraft(EMPTY_FORM);
                    }}
                    submitLabel="Save memory"
                    isLoading={isLoading}
                  />
                );
              }

              return (
                <article
                  key={memory.id}
                  className={[
                    "rounded-[1.5rem] border p-4 transition",
                    memory.isEnabled
                      ? "border-neutral-800 bg-black/40"
                      : "border-neutral-900 bg-black/20 opacity-70"
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="cf-badge">{getCategoryLabel(memory.category)}</span>
                        <span className={memory.isEnabled ? "cf-badge border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "cf-badge"}>
                          {memory.isEnabled ? "Active" : "Disabled"}
                        </span>
                      </div>
                      <h5 className="text-sm font-semibold text-white">{memory.title}</h5>
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-neutral-500">
                        {memory.content}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isLoading}
                      onClick={() => onUpdate(memory.id, { isEnabled: !memory.isEnabled })}
                    >
                      {memory.isEnabled ? <CircleOff size={14} /> : <CheckCircle2 size={14} />}
                      {memory.isEnabled ? "Disable" : "Enable"}
                    </Button>
                    <Button type="button" variant="ghost" disabled={isLoading} onClick={() => startEdit(memory)}>
                      <Edit3 size={14} />
                      Edit
                    </Button>
                    <Button type="button" variant="ghost" disabled={isLoading} onClick={() => onDelete(memory.id)}>
                      <Trash2 size={14} />
                      Delete
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}
