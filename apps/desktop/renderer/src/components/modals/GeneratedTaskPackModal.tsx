import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Check,
  Clock3,
  Code2,
  Copy,
  Eye,
  FileText,
  Sparkles,
  Target,
  Wrench
} from "lucide-react";

import type { TaskPack } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface GeneratedTaskPackModalProps {
  taskPack: TaskPack;
  onClose: () => void;
}

type PromptViewMode = "preview" | "raw";

const VIEW_SWITCH_TRANSITION = {
  type: "spring",
  stiffness: 460,
  damping: 36,
  mass: 0.8
} as const;

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
  font-size: 0.75rem;
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

.cf-markdown-preview ul,
.cf-markdown-preview ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
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
  padding: 0.7rem 1rem;
  border-left: 2px solid rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.035);
  color: rgb(212 212 212);
}

.cf-markdown-preview a {
  color: white;
  text-decoration: underline;
  text-decoration-color: rgba(255, 255, 255, 0.35);
  text-underline-offset: 4px;
}

.cf-markdown-preview code {
  border: 1px solid rgb(38 38 38);
  border-radius: 0.45rem;
  background: rgb(10 10 10);
  color: rgb(245 245 245);
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
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
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

export function GeneratedTaskPackModal({
  taskPack,
  onClose
}: GeneratedTaskPackModalProps) {
  const [viewMode, setViewMode] = useState<PromptViewMode>("preview");
  const [isCopied, setIsCopied] = useState(false);

  const generatedPrompt = taskPack.generatedPrompt ?? "";
  const bodyLabel = useMemo(() => getTaskPackBodyLabel(taskPack), [taskPack]);
  const bodyDescription = useMemo(() => getTaskPackBodyDescription(taskPack), [taskPack]);

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(generatedPrompt);
    setIsCopied(true);

    window.setTimeout(() => {
      setIsCopied(false);
    }, 1400);
  }

  return (
    <Modal
      title={taskPack.title}
      eyebrow="Generated Task Pack"
      maxWidth="max-w-[1180px]"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-4">
          <p className="hidden text-xs leading-5 text-neutral-600 md:block">
            Copy uses raw Markdown, ready for Codex, Claude Code, Cursor or another AI agent.
          </p>

          <Button variant="primary" onClick={handleCopyPrompt}>
            {isCopied ? <Check size={15} /> : <Copy size={15} />}
            {isCopied ? "Copied" : "Copy prompt"}
          </Button>
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
                {bodyLabel}
              </span>

              <span className="cf-badge">
                {taskPack.generationCached ? "Cached" : "Fresh generation"}
              </span>

              {taskPack.generationModel && (
                <span className="cf-badge">{taskPack.generationModel}</span>
              )}
            </div>

            <h3 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-[-0.04em] text-white">
              {taskPack.title}
            </h3>

            <p className="mt-3 line-clamp-2 max-w-4xl text-sm leading-6 text-neutral-500">
              {bodyDescription}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <InfoTile
              icon={<Target size={15} />}
              label="Target"
              value={taskPack.targetTool}
            />

            <InfoTile
              icon={<Wrench size={15} />}
              label="Task type"
              value={taskPack.taskType}
            />

            <InfoTile
              icon={<Clock3 size={15} />}
              label="Duration"
              value={formatDuration(taskPack.generationDurationMs)}
            />

            <InfoTile
              icon={<Bot size={15} />}
              label="Mode"
              value={taskPack.generationMode ?? "template"}
            />
          </section>
        </div>

        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-4">
          <div className="relative flex overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/70 p-1 shadow-[0_18px_52px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.055)]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.012)_45%,rgba(255,255,255,0.004))]" />

            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={[
                "group relative z-10 flex min-w-[154px] items-center gap-3 rounded-[1.05rem] px-4 py-2.5 text-left transition duration-200",
                viewMode === "preview" ? "text-black" : "text-neutral-500 hover:text-white"
              ].join(" ")}
            >
              {viewMode === "preview" && (
                <motion.span
                  layoutId="task-pack-view-active-pill"
                  className="absolute inset-0 rounded-[1.05rem] bg-white shadow-[0_14px_34px_rgba(255,255,255,0.16)]"
                  transition={VIEW_SWITCH_TRANSITION}
                />
              )}

              <span
                className={[
                  "relative z-10 grid size-8 shrink-0 place-items-center rounded-xl border transition",
                  viewMode === "preview"
                    ? "border-black/10 bg-black/5 text-black"
                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/20 group-hover:text-white"
                ].join(" ")}
              >
                <Eye size={14} />
              </span>

              <span className="relative z-10 min-w-0">
                <span
                  className={[
                    "block text-xs font-semibold transition",
                    viewMode === "preview" ? "text-black" : "text-neutral-300 group-hover:text-white"
                  ].join(" ")}
                >
                  Preview
                </span>

                <span
                  className={[
                    "mt-0.5 block text-[10px] leading-none transition",
                    viewMode === "preview" ? "text-black/55" : "text-neutral-700 group-hover:text-neutral-500"
                  ].join(" ")}
                >
                  Rendered Markdown
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={[
                "group relative z-10 flex min-w-[178px] items-center gap-3 rounded-[1.05rem] px-4 py-2.5 text-left transition duration-200",
                viewMode === "raw" ? "text-black" : "text-neutral-500 hover:text-white"
              ].join(" ")}
            >
              {viewMode === "raw" && (
                <motion.span
                  layoutId="task-pack-view-active-pill"
                  className="absolute inset-0 rounded-[1.05rem] bg-white shadow-[0_14px_34px_rgba(255,255,255,0.16)]"
                  transition={VIEW_SWITCH_TRANSITION}
                />
              )}

              <span
                className={[
                  "relative z-10 grid size-8 shrink-0 place-items-center rounded-xl border transition",
                  viewMode === "raw"
                    ? "border-black/10 bg-black/5 text-black"
                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/20 group-hover:text-white"
                ].join(" ")}
              >
                <Code2 size={14} />
              </span>

              <span className="relative z-10 min-w-0">
                <span
                  className={[
                    "block text-xs font-semibold transition",
                    viewMode === "raw" ? "text-black" : "text-neutral-300 group-hover:text-white"
                  ].join(" ")}
                >
                  Raw Markdown
                </span>

                <span
                  className={[
                    "mt-0.5 block text-[10px] leading-none transition",
                    viewMode === "raw" ? "text-black/55" : "text-neutral-700 group-hover:text-neutral-500"
                  ].join(" ")}
                >
                  Agent-ready source
                </span>
              </span>
            </button>
          </div>

          <div className="hidden items-center gap-2 text-xs text-neutral-600 lg:flex">
            <FileText size={14} />
            Created: {formatDate(taskPack.createdAt)}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/30 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <AnimatePresence mode="wait">
            {viewMode === "preview" ? (
              <motion.article
                key="preview"
                className="h-full min-h-0 overflow-y-auto rounded-[1.1rem] bg-neutral-950/45 px-6 py-5 text-sm"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="cf-markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {generatedPrompt}
                  </ReactMarkdown>
                </div>
              </motion.article>
            ) : (
              <motion.pre
                key="raw"
                className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-[1.1rem] bg-black/75 p-5 text-sm leading-6 text-neutral-300"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {generatedPrompt}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  );
}