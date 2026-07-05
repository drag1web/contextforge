import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  FileText,
  FilePlus2,
  RefreshCw,
  Save,
  Sparkles,
  TriangleAlert,
  Undo2
} from "lucide-react";

import type { AgentsPreview } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface AgentsPreviewModalProps {
  preview: AgentsPreview;
  isLoading: boolean;
  onClose: () => void;
  onSave: (markdown: string, fileName?: "AGENTS.md" | "AGENTS.generated.md") => void;
  onRegenerate: () => void;
}

type AgentsViewMode = "preview" | "edit" | "raw";

const VIEW_SWITCH_TRANSITION = {
  type: "spring",
  stiffness: 460,
  damping: 36,
  mass: 0.8
} as const;

const MARKDOWN_PREVIEW_STYLES = `
.cf-agents-markdown-preview {
  color: rgb(212 212 212);
  font-size: 0.875rem;
  line-height: 1.75;
}

.cf-agents-markdown-preview > :first-child {
  margin-top: 0;
}

.cf-agents-markdown-preview > :last-child {
  margin-bottom: 0;
}

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

.cf-agents-markdown-preview p {
  margin: 0.75rem 0;
  color: rgb(212 212 212);
}

.cf-agents-markdown-preview strong {
  color: white;
  font-weight: 650;
}

.cf-agents-markdown-preview ul,
.cf-agents-markdown-preview ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.cf-agents-markdown-preview ul {
  list-style: disc;
}

.cf-agents-markdown-preview ol {
  list-style: decimal;
}

.cf-agents-markdown-preview li {
  margin: 0.35rem 0;
  padding-left: 0.25rem;
}

.cf-agents-markdown-preview hr {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid rgb(23 23 23);
}

.cf-agents-markdown-preview blockquote {
  margin: 1rem 0;
  padding: 0.7rem 1rem;
  border-left: 2px solid rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.035);
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
  background: rgba(0, 0, 0, 0.72);
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
  background: rgba(10, 10, 10, 0.86);
  color: rgb(163 163 163);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-align: left;
  text-transform: uppercase;
}

.cf-agents-markdown-preview td {
  color: rgb(212 212 212);
}
`;

function formatDuration(durationMs?: number) {
  if (!durationMs) {
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

function getGenerationLabel(preview: AgentsPreview) {
  if (!preview.generation) {
    return "Template";
  }

  if (preview.generation.cached) {
    return "Cached";
  }

  if (preview.generation.mode === "ollama" && !preview.generation.usedFallback) {
    return "Ollama refined";
  }

  return "Safe Template";
}

function getGenerationDescription(preview: AgentsPreview) {
  if (!preview.generation) {
    return "ContextForge generated a stable AGENTS.md preview from project metadata.";
  }

  return preview.generation.message;
}

function InfoTile({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
        {icon}
      </div>

      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-medium text-white">
        {value}
      </p>
    </div>
  );
}

function ViewModeButton({
  mode,
  activeMode,
  label,
  caption,
  icon,
  onClick
}: {
  mode: AgentsViewMode;
  activeMode: AgentsViewMode;
  label: string;
  caption: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const isActive = activeMode === mode;

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group relative z-10 flex min-w-[154px] items-center gap-3 rounded-[1.05rem] px-4 py-2.5 text-left transition duration-200",
        isActive ? "text-black" : "text-neutral-500 hover:text-white"
      ].join(" ")}
    >
      {isActive && (
        <motion.span
          layoutId="agents-view-active-pill"
          className="absolute inset-0 rounded-[1.05rem] bg-white shadow-[0_14px_34px_rgba(255,255,255,0.16)]"
          transition={VIEW_SWITCH_TRANSITION}
        />
      )}

      <span
        className={[
          "relative z-10 grid size-8 shrink-0 place-items-center rounded-xl border transition",
          isActive
            ? "border-black/10 bg-black/5 text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/20 group-hover:text-white"
        ].join(" ")}
      >
        {icon}
      </span>

      <span className="relative z-10 min-w-0">
        <span
          className={[
            "block text-xs font-semibold transition",
            isActive ? "text-black" : "text-neutral-300 group-hover:text-white"
          ].join(" ")}
        >
          {label}
        </span>

        <span
          className={[
            "mt-0.5 block text-[10px] leading-none transition",
            isActive ? "text-black/55" : "text-neutral-700 group-hover:text-neutral-500"
          ].join(" ")}
        >
          {caption}
        </span>
      </span>
    </button>
  );
}

export function AgentsPreviewModal({
  preview,
  isLoading,
  onClose,
  onSave,
  onRegenerate
}: AgentsPreviewModalProps) {
  const [viewMode, setViewMode] = useState<AgentsViewMode>("preview");
  const [isCopied, setIsCopied] = useState(false);
  const [editedMarkdown, setEditedMarkdown] = useState(preview.markdown);

  useEffect(() => {
    setEditedMarkdown(preview.markdown);
    setViewMode("preview");
  }, [preview.projectId, preview.markdown]);

  const generationLabel = useMemo(() => getGenerationLabel(preview), [preview]);
  const generationDescription = useMemo(
    () => getGenerationDescription(preview),
    [preview]
  );

  const hasEdits = editedMarkdown !== preview.markdown;
  const canSave = editedMarkdown.trim().length > 0 && !isLoading;
  const targetExists = Boolean(preview.agentsFile?.exists);
  const targetPath = preview.agentsFile?.path ?? "AGENTS.md";

  async function handleCopy() {
    await navigator.clipboard.writeText(editedMarkdown);
    setIsCopied(true);

    window.setTimeout(() => {
      setIsCopied(false);
    }, 1400);
  }

  function handleResetEdits() {
    setEditedMarkdown(preview.markdown);
  }

  function handleSave(fileName: "AGENTS.md" | "AGENTS.generated.md" = "AGENTS.md") {
    onSave(editedMarkdown, fileName);
  }

  return (
    <Modal
      title={`AGENTS.md — ${preview.projectName}`}
      eyebrow="Context Builder"
      maxWidth="max-w-[1180px]"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-xs leading-5 text-neutral-600">
            {targetExists
              ? "AGENTS.md already exists. Review edits, then overwrite it or save a generated copy."
              : "Review and edit the generated instructions before saving AGENTS.md into the project."}
          </p>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {hasEdits && (
              <Button
                variant="secondary"
                onClick={handleResetEdits}
                disabled={isLoading}
              >
                <Undo2 size={15} />
                Reset edits
              </Button>
            )}

            <Button
              variant="secondary"
              onClick={handleCopy}
              disabled={isLoading}
            >
              {isCopied ? <Check size={15} /> : <Copy size={15} />}
              {isCopied ? "Copied" : "Copy edited"}
            </Button>

            <Button
              variant="secondary"
              onClick={onRegenerate}
              disabled={isLoading}
            >
              <RefreshCw size={15} />
              Regenerate
            </Button>

            {targetExists && (
              <Button
                variant="secondary"
                onClick={() => handleSave("AGENTS.generated.md")}
                disabled={!canSave}
              >
                <FilePlus2 size={15} />
                Save copy
              </Button>
            )}

            <Button
              variant="primary"
              onClick={() => handleSave("AGENTS.md")}
              disabled={!canSave}
            >
              <Save size={15} />
              {targetExists ? "Overwrite AGENTS.md" : "Save to project"}
            </Button>
          </div>
        </div>
      }
    >
      <style>{MARKDOWN_PREVIEW_STYLES}</style>

      <div className="flex h-[calc(100vh-190px)] min-h-[560px] flex-col overflow-hidden p-5">
        <div className="mb-4 grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/40 p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Sparkles size={13} />
                {generationLabel}
              </span>

              <span className="cf-badge">AGENTS.md</span>

              {hasEdits && <span className="cf-badge">Edited</span>}

              {preview.generation?.model && (
                <span className="cf-badge">{preview.generation.model}</span>
              )}
            </div>

            <h3 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-[-0.04em] text-white">
              AI instructions for {preview.projectName}
            </h3>

            <p className="mt-3 line-clamp-2 max-w-4xl text-sm leading-6 text-neutral-500">
              {generationDescription}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <InfoTile
              icon={<Bot size={15} />}
              label="Mode"
              value={preview.generation?.mode ?? "template"}
            />

            <InfoTile
              icon={<Clock3 size={15} />}
              label="Duration"
              value={formatDuration(preview.generation?.durationMs)}
            />

            <InfoTile
              icon={<FileText size={15} />}
              label="File"
              value={targetExists ? "AGENTS.md exists" : "AGENTS.md"}
            />

            <InfoTile
              icon={<Sparkles size={15} />}
              label="Cache"
              value={preview.generation?.cached ? "Cached" : "Fresh"}
            />
          </section>
        </div>

        {targetExists && (
          <div className="mb-4 flex shrink-0 items-start gap-3 rounded-[1.25rem] border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-amber-200" />
            <div className="min-w-0">
              <p className="font-medium text-amber-50">Existing AGENTS.md detected</p>
              <p className="mt-1 text-amber-100/75">
                Saving to AGENTS.md will overwrite the file at {targetPath}. Use Save copy to write AGENTS.generated.md instead.
              </p>
            </div>
          </div>
        )}

        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4">
          <div className="relative flex overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/70 p-1 shadow-[0_18px_52px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.055)]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.012)_45%,rgba(255,255,255,0.004))]" />

            <ViewModeButton
              mode="preview"
              activeMode={viewMode}
              label="Preview"
              caption="Rendered Markdown"
              icon={<Eye size={14} />}
              onClick={() => setViewMode("preview")}
            />

            <ViewModeButton
              mode="edit"
              activeMode={viewMode}
              label="Edit"
              caption="Editable source"
              icon={<Edit3 size={14} />}
              onClick={() => setViewMode("edit")}
            />

            <ViewModeButton
              mode="raw"
              activeMode={viewMode}
              label="Raw Markdown"
              caption="Read-only source"
              icon={<Code2 size={14} />}
              onClick={() => setViewMode("raw")}
            />
          </div>

          <p className="hidden max-w-md text-right text-xs leading-5 text-neutral-600 lg:block">
            Preview uses the edited markdown, so you can check formatting before writing the file.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/30 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <AnimatePresence mode="wait">
            {viewMode === "preview" && (
              <motion.article
                key="preview"
                className="h-full min-h-0 overflow-y-auto rounded-[1.1rem] bg-neutral-950/45 px-6 py-5 text-sm"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="cf-agents-markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editedMarkdown}
                  </ReactMarkdown>
                </div>
              </motion.article>
            )}

            {viewMode === "edit" && (
              <motion.div
                key="edit"
                className="h-full min-h-0 overflow-hidden rounded-[1.1rem] bg-black/75"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <textarea
                  value={editedMarkdown}
                  onChange={(event) => setEditedMarkdown(event.target.value)}
                  spellCheck={false}
                  className="h-full w-full resize-none rounded-[1.1rem] border border-transparent bg-transparent p-5 font-mono text-sm leading-6 text-neutral-200 outline-none transition placeholder:text-neutral-700 focus:border-white/10 focus:bg-black/40"
                  placeholder="Write AGENTS.md instructions here..."
                />
              </motion.div>
            )}

            {viewMode === "raw" && (
              <motion.pre
                key="raw"
                className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-[1.1rem] bg-black/75 p-5 text-sm leading-6 text-neutral-300"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {editedMarkdown}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  );
}
