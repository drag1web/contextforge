import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Check,
  Clock3,
  Code2,
  Copy,
  Edit3,
  Eye,
  FilePlus2,
  FileText,
  RefreshCw,
  Save,
  Sparkles,
  TriangleAlert,
  Undo2,
} from "lucide-react";

import type { AgentsPreview } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";

interface AgentsPreviewModalProps {
  preview: AgentsPreview;
  isLoading: boolean;
  onClose: () => void;
  onSave: (
    markdown: string,
    fileName?: "AGENTS.md" | "AGENTS.generated.md",
  ) => void;
  onRegenerate: () => void;
}

type AgentsViewMode = "preview" | "edit" | "raw";

const PANEL_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
} as const;

const MARKDOWN_PREVIEW_STYLES = `
.cf-agents-markdown-preview {
  color: rgb(212 212 212);
  font-size: 0.875rem;
  line-height: 1.75;
}

.cf-agents-markdown-preview > :first-child { margin-top: 0; }
.cf-agents-markdown-preview > :last-child { margin-bottom: 0; }

.cf-agents-markdown-preview h1 {
  margin: 0 0 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(38 38 38);
  color: white;
  font-size: 1.5rem;
  line-height: 2rem;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.cf-agents-markdown-preview h2 {
  margin: 2rem 0 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgb(23 23 23);
  color: white;
  font-size: 1.125rem;
  line-height: 1.75rem;
  font-weight: 650;
}

.cf-agents-markdown-preview h3 {
  margin: 1.5rem 0 0.5rem;
  color: rgb(245 245 245);
  font-size: 1rem;
  line-height: 1.5rem;
  font-weight: 650;
}

.cf-agents-markdown-preview h4,
.cf-agents-markdown-preview h5,
.cf-agents-markdown-preview h6 {
  margin: 1.25rem 0 0.5rem;
  color: rgb(163 163 163);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.cf-agents-markdown-preview p { margin: 0.75rem 0; color: rgb(212 212 212); }
.cf-agents-markdown-preview strong { color: white; font-weight: 650; }
.cf-agents-markdown-preview ul,
.cf-agents-markdown-preview ol { margin: 0.75rem 0; padding-left: 1.5rem; }
.cf-agents-markdown-preview ul { list-style: disc; }
.cf-agents-markdown-preview ol { list-style: decimal; }
.cf-agents-markdown-preview li { margin: 0.35rem 0; padding-left: 0.25rem; }
.cf-agents-markdown-preview hr { margin: 2rem 0; border: 0; border-top: 1px solid rgb(23 23 23); }

.cf-agents-markdown-preview blockquote {
  margin: 1rem 0;
  padding: 0.7rem 1rem;
  border-left: 2px solid rgba(255,255,255,0.45);
  background: rgba(255,255,255,0.035);
  color: rgb(212 212 212);
}

.cf-agents-markdown-preview code {
  border: 1px solid rgb(38 38 38);
  border-radius: 0.45rem;
  background: rgb(10 10 10);
  color: rgb(245 245 245);
  padding: 0.12rem 0.35rem;
  font-size: 0.92em;
}

.cf-agents-markdown-preview pre {
  margin: 1rem 0;
  overflow: auto;
  border: 1px solid rgb(23 23 23);
  border-radius: 1rem;
  background: rgba(0,0,0,0.72);
  padding: 1rem;
  color: rgb(229 229 229);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.cf-agents-markdown-preview pre code {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

.cf-agents-markdown-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  overflow: hidden;
  border: 1px solid rgb(23 23 23);
  border-radius: 1rem;
  font-size: 0.875rem;
}

.cf-agents-markdown-preview th,
.cf-agents-markdown-preview td {
  border: 1px solid rgb(23 23 23);
  padding: 0.75rem 1rem;
  vertical-align: top;
}

.cf-agents-markdown-preview th {
  background: rgba(10,10,10,0.86);
  color: rgb(163 163 163);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-align: left;
  text-transform: uppercase;
}

.cf-agents-markdown-preview td { color: rgb(212 212 212); }
`;

function formatDuration(
  durationMs: number | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!durationMs) return "—";
  if (durationMs < 1000) {
    return t("agentsPreview.milliseconds", { value: durationMs });
  }
  return t("agentsPreview.seconds", {
    value: (durationMs / 1000).toFixed(1),
  });
}

function getGenerationLabel(
  preview: AgentsPreview,
  t: (key: string) => string,
) {
  if (!preview.generation) return t("agentsPreview.templateMode");
  if (preview.generation.cached) return t("agentsPreview.cached");
  if (preview.generation.mode === "ollama" && !preview.generation.usedFallback) {
    return t("agentsPreview.ollamaRefined");
  }
  return t("agentsPreview.safeTemplate");
}

export function AgentsPreviewModal({
  preview,
  isLoading,
  onClose,
  onSave,
  onRegenerate,
}: AgentsPreviewModalProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<AgentsViewMode>("preview");
  const [isCopied, setIsCopied] = useState(false);
  const [editedMarkdown, setEditedMarkdown] = useState(preview.markdown);

  useEffect(() => {
    setEditedMarkdown(preview.markdown);
    setViewMode("preview");
  }, [preview.projectId, preview.markdown]);

  const activeMemoryCount = (preview.projectMemories ?? []).filter(
    (memory) => memory.isEnabled,
  ).length;
  const hasEdits = editedMarkdown !== preview.markdown;
  const canSave = editedMarkdown.trim().length > 0 && !isLoading;
  const targetExists = Boolean(preview.agentsFile?.exists);
  const targetPath = preview.agentsFile?.path ?? "AGENTS.md";
  const generationLabel = getGenerationLabel(preview, t);

  const viewItems = useMemo(
    () => [
      {
        id: "preview" as const,
        label: t("agentsPreview.preview"),
        caption: t("agentsPreview.previewCaption"),
        icon: <Eye size={14} />,
      },
      {
        id: "edit" as const,
        label: t("agentsPreview.editor"),
        caption: t("agentsPreview.editorCaption"),
        icon: <Edit3 size={14} />,
      },
      {
        id: "raw" as const,
        label: t("agentsPreview.rawMarkdown"),
        caption: t("agentsPreview.rawCaption"),
        icon: <Code2 size={14} />,
      },
    ],
    [t],
  );

  async function handleCopy() {
    await navigator.clipboard.writeText(editedMarkdown);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1400);
  }

  function handleSave(
    fileName: "AGENTS.md" | "AGENTS.generated.md" = "AGENTS.md",
  ) {
    onSave(editedMarkdown, fileName);
  }

  return (
    <Modal
      title={`AGENTS.md — ${preview.projectName}`}
      eyebrow={t("agentsPreview.eyebrow")}
      maxWidth="max-w-[1180px]"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-neutral-300">
              {hasEdits
                ? t("agentsPreview.unsavedChanges")
                : targetExists
                  ? t("agentsPreview.existingFileReady")
                  : t("agentsPreview.newFileReady")}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-neutral-600">
              {targetExists ? targetPath : t("agentsPreview.localProjectFile")}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasEdits ? (
              <Button
                variant="secondary"
                onClick={() => setEditedMarkdown(preview.markdown)}
                disabled={isLoading}
              >
                <Undo2 size={15} />
                {t("agentsPreview.reset")}
              </Button>
            ) : null}

            <Button variant="secondary" onClick={handleCopy} disabled={isLoading}>
              {isCopied ? <Check size={15} /> : <Copy size={15} />}
              {isCopied ? t("agentsPreview.copied") : t("agentsPreview.copy")}
            </Button>

            <Button
              variant="secondary"
              onClick={onRegenerate}
              disabled={isLoading}
            >
              <RefreshCw size={15} />
              {t("agentsPreview.regenerate")}
            </Button>

            {targetExists ? (
              <Button
                variant="secondary"
                onClick={() => handleSave("AGENTS.generated.md")}
                disabled={!canSave}
              >
                <FilePlus2 size={15} />
                {t("agentsPreview.saveCopy")}
              </Button>
            ) : null}

            <Button
              variant="primary"
              onClick={() => handleSave("AGENTS.md")}
              disabled={!canSave}
            >
              <Save size={15} />
              {targetExists
                ? t("agentsPreview.overwrite")
                : t("agentsPreview.saveProject")}
            </Button>
          </div>
        </div>
      }
    >
      <style>{MARKDOWN_PREVIEW_STYLES}</style>

      <div className="flex h-[calc(100vh-190px)] min-h-[560px] flex-col overflow-hidden p-5">
        <section className="mb-4 shrink-0 rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                <FileText size={18} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                    {t("agentsPreview.workspace")}
                  </p>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300">
                    {generationLabel}
                  </span>
                  {hasEdits ? (
                    <span className="rounded-full border border-white/15 bg-white/[0.055] px-2 py-0.5 text-[9px] font-semibold text-white">
                      {t("agentsPreview.edited")}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-1 truncate text-xl font-semibold tracking-[-0.04em] text-white">
                  {t("agentsPreview.title", { project: preview.projectName })}
                </h3>
                <p className="mt-1 truncate text-xs text-neutral-600">
                  {t("agentsPreview.description")}
                </p>
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[540px]">
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5">
                <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                  {t("agentsPreview.mode")}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-white">
                  {preview.generation?.mode ?? "template"}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5">
                <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                  {t("agentsPreview.model")}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-white">
                  {preview.generation?.model ?? "—"}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5">
                <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                  {t("agentsPreview.duration")}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-white">
                  {formatDuration(preview.generation?.durationMs, t)}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5">
                <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
                  {t("agentsPreview.memory")}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-white">
                  {activeMemoryCount}
                </p>
              </div>
            </div>
          </div>

          {targetExists ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.055] px-3.5 py-3 text-xs leading-5 text-amber-100/80">
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-100">
                  {t("agentsPreview.fileExists")}
                </p>
                <p className="mt-0.5 truncate text-amber-100/65">
                  {t("agentsPreview.fileExistsDescription", { path: targetPath })}
                </p>
              </div>
            </div>
          ) : activeMemoryCount > 0 ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] px-3.5 py-3 text-xs leading-5 text-emerald-100/75">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-emerald-300" />
              <span>
                {t("agentsPreview.memoryIncluded", { count: activeMemoryCount })}
              </span>
            </div>
          ) : null}
        </section>

        <div className="mb-4 shrink-0">
          <HorizontalSlidingSelector
            items={viewItems}
            activeIndex={viewItems.findIndex((item) => item.id === viewMode)}
            getItemKey={(item) => item.id}
            onSelect={(item) => setViewMode(item.id)}
            renderItem={(item, active) => (
              <span className="flex min-h-11 items-center justify-center gap-2 px-3">
                <span
                  className={[
                    "grid size-7 shrink-0 place-items-center rounded-xl border",
                    active
                      ? "border-black/10 bg-black/5 text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-500",
                  ].join(" ")}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 text-left">
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
            ariaLabel={t("agentsPreview.viewMode")}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/30 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <AnimatePresence mode="wait" initial={false}>
            {viewMode === "preview" ? (
              <motion.article
                key="preview"
                className="h-full min-h-0 overflow-y-auto rounded-[1.05rem] bg-neutral-950/45 px-7 py-6 text-sm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={PANEL_TRANSITION}
              >
                <div className="cf-agents-markdown-preview mx-auto max-w-4xl">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editedMarkdown}
                  </ReactMarkdown>
                </div>
              </motion.article>
            ) : null}

            {viewMode === "edit" ? (
              <motion.div
                key="edit"
                className="h-full min-h-0 overflow-hidden rounded-[1.05rem] bg-black/75"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={PANEL_TRANSITION}
              >
                <textarea
                  value={editedMarkdown}
                  onChange={(event) => setEditedMarkdown(event.target.value)}
                  spellCheck={false}
                  className="h-full w-full resize-none rounded-[1.05rem] border border-transparent bg-transparent p-5 font-mono text-sm leading-6 text-neutral-200 outline-none transition placeholder:text-neutral-700 focus:border-white/10 focus:bg-black/40"
                  placeholder={t("agentsPreview.editorPlaceholder")}
                />
              </motion.div>
            ) : null}

            {viewMode === "raw" ? (
              <motion.pre
                key="raw"
                className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-[1.05rem] bg-black/75 p-5 font-mono text-sm leading-6 text-neutral-300"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={PANEL_TRANSITION}
              >
                {editedMarkdown}
              </motion.pre>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  );
}
