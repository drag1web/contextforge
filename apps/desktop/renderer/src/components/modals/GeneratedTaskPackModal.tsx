import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code2, Copy, Eye } from "lucide-react";

import type { TaskPack } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface GeneratedTaskPackModalProps {
  taskPack: TaskPack;
  onClose: () => void;
}

type PromptViewMode = "preview" | "raw";

const MARKDOWN_PREVIEW_STYLES = `
.cf-markdown-preview {
  color: rgb(212 212 212);
  font-size: 0.875rem;
  line-height: 1.75;
}

.cf-markdown-preview > :first-child {
  margin-top: 0;
}

.cf-markdown-preview > :last-child {
  margin-bottom: 0;
}

.cf-markdown-preview h1 {
  margin: 0 0 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(38 38 38);
  color: white;
  font-size: 1.5rem;
  line-height: 2rem;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.cf-markdown-preview h2 {
  margin: 2rem 0 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgb(23 23 23);
  color: white;
  font-size: 1.125rem;
  line-height: 1.75rem;
  font-weight: 650;
}

.cf-markdown-preview h3 {
  margin: 1.5rem 0 0.5rem;
  color: rgb(245 245 245);
  font-size: 1rem;
  line-height: 1.5rem;
  font-weight: 650;
}

.cf-markdown-preview h4,
.cf-markdown-preview h5,
.cf-markdown-preview h6 {
  margin: 1.25rem 0 0.5rem;
  color: rgb(163 163 163);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.cf-markdown-preview p {
  margin: 0.75rem 0;
  color: rgb(212 212 212);
}

.cf-markdown-preview strong {
  color: white;
  font-weight: 650;
}

.cf-markdown-preview em {
  color: rgb(229 229 229);
}

.cf-markdown-preview ul,
.cf-markdown-preview ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
  color: rgb(212 212 212);
}

.cf-markdown-preview ul {
  list-style: disc;
}

.cf-markdown-preview ol {
  list-style: decimal;
}

.cf-markdown-preview li {
  margin: 0.35rem 0;
  padding-left: 0.25rem;
}

.cf-markdown-preview hr {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid rgb(23 23 23);
}

.cf-markdown-preview blockquote {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border-left: 2px solid rgba(34, 211, 238, 0.55);
  background: rgba(34, 211, 238, 0.05);
  color: rgb(212 212 212);
}

.cf-markdown-preview a {
  color: rgb(103 232 249);
  text-decoration: underline;
  text-decoration-color: rgba(103, 232, 249, 0.35);
  text-underline-offset: 4px;
}

.cf-markdown-preview a:hover {
  color: rgb(165 243 252);
}

.cf-markdown-preview code {
  border: 1px solid rgb(38 38 38);
  border-radius: 0.375rem;
  background: rgb(10 10 10);
  color: rgb(165 243 252);
  padding: 0.12rem 0.35rem;
  font-size: 0.92em;
}

.cf-markdown-preview pre {
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

.cf-markdown-preview pre code {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

.cf-markdown-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  overflow: hidden;
  border: 1px solid rgb(23 23 23);
  border-radius: 1rem;
  font-size: 0.875rem;
}

.cf-markdown-preview th,
.cf-markdown-preview td {
  border: 1px solid rgb(23 23 23);
  padding: 0.75rem 1rem;
  vertical-align: top;
}

.cf-markdown-preview th {
  background: rgba(10, 10, 10, 0.86);
  color: rgb(163 163 163);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-align: left;
  text-transform: uppercase;
}

.cf-markdown-preview td {
  color: rgb(212 212 212);
}
`;

function formatDuration(durationMs?: number | null) {
  if (!durationMs) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

function getTaskPackBodyLabel(taskPack: TaskPack) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return "Ollama refined";
  }

  return "Safe Template";
}

function getTaskPackBodyDescription(taskPack: TaskPack) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return (
      taskPack.generationMessage ||
      "The final Task Pack body was refined by Ollama and validated by ContextForge."
    );
  }

  return taskPack.generationMessage
    ? `${taskPack.generationMessage} Intent analysis and file selection may still use Ollama; the final markdown body was kept stable by ContextForge.`
    : "The final markdown body was rendered with ContextForge's safe template. Intent analysis and file selection may still use Ollama.";
}

export function GeneratedTaskPackModal({
  taskPack,
  onClose
}: GeneratedTaskPackModalProps) {
  const [viewMode, setViewMode] = useState<PromptViewMode>("preview");

  const duration = formatDuration(taskPack.generationDurationMs);
  const bodyLabel = useMemo(() => getTaskPackBodyLabel(taskPack), [taskPack]);
  const bodyDescription = useMemo(() => getTaskPackBodyDescription(taskPack), [taskPack]);
  const generatedPrompt = taskPack.generatedPrompt ?? "";

  return (
    <Modal
      title={taskPack.title}
      eyebrow="Generated Task Pack"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() => navigator.clipboard.writeText(generatedPrompt)}
        >
          <Copy size={15} />
          Copy prompt
        </Button>
      }
    >
      <style>{MARKDOWN_PREVIEW_STYLES}</style>

      <div className="flex h-[calc(100vh-320px)] max-h-[680px] min-h-0 flex-col overflow-hidden px-5 pt-5 pb-5">
        <div className="mb-5 shrink-0 rounded-2xl border border-neutral-900 bg-neutral-950/70 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-600">
                Task Pack Body
              </p>

              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-300">
                {bodyDescription}
              </p>

              {duration && (
                <p className="mt-1 text-xs text-neutral-600">
                  Duration: {duration}
                </p>
              )}
            </div>

            <span
              className={[
                "shrink-0 rounded-full border px-3 py-1 text-xs",
                bodyLabel === "Ollama refined"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
              ].join(" ")}
            >
              {bodyLabel}
            </span>
          </div>
        </div>

        <div className="mb-5 flex shrink-0 flex-wrap items-center justify-between gap-4">
          <div className="flex rounded-2xl border border-neutral-900 bg-neutral-950/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={[
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs transition",
                viewMode === "preview"
                  ? "bg-white text-black shadow-sm"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
              ].join(" ")}
            >
              <Eye size={14} />
              Preview
            </button>

            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={[
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs transition",
                viewMode === "raw"
                  ? "bg-white text-black shadow-sm"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
              ].join(" ")}
            >
              <Code2 size={14} />
              Raw Markdown
            </button>
          </div>

          <p className="max-w-md text-right text-xs leading-5 text-neutral-600">
            Copy always uses the raw Markdown prompt for Claude, Cursor, Codex, or another agent.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/30 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          {viewMode === "preview" ? (
            <article className="h-full min-h-0 overflow-y-auto rounded-xl bg-neutral-950/40 px-6 py-5 text-sm">
              <div className="cf-markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {generatedPrompt}
                </ReactMarkdown>
              </div>
            </article>
          ) : (
            <pre className="h-full min-h-0 overflow-y-auto rounded-xl bg-black/70 p-5 text-sm leading-6 text-neutral-300">
              {generatedPrompt}
            </pre>
          )}
        </div>
      </div>
    </Modal>
  );
}