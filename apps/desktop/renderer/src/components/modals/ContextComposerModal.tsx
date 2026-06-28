import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  FileText,
  Gauge,
  Layers3,
  ListChecks,
  MousePointer2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  XCircle
} from "lucide-react";

import type { ContextComposerPreview } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface ContextComposerModalProps {
  preview: ContextComposerPreview;
  isLoading?: boolean;
  onClose: () => void;
  onGenerate: (selectedFilePaths: string[]) => void;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function getRiskTone(riskLevel: string) {
  const normalized = riskLevel.toLowerCase();

  if (normalized.includes("high")) {
    return "border-red-400/25 bg-red-400/10 text-red-300";
  }

  if (normalized.includes("medium")) {
    return "border-white/20 bg-white/10 text-white";
  }

  return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
}

function StatCard({
  icon,
  label,
  value,
  caption
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <article className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
        {icon}
      </div>

      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="cf-display-font mt-1 truncate text-2xl font-semibold text-white">
        {value}
      </p>

      <p className="mt-1 truncate text-xs text-neutral-600">
        {caption}
      </p>
    </article>
  );
}

export function ContextComposerModal({
  preview,
  isLoading = false,
  onClose,
  onGenerate
}: ContextComposerModalProps) {
  const recommendedPaths = useMemo(
    () => preview.selectedFiles.map((file) => file.path),
    [preview.selectedFiles]
  );

  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>(recommendedPaths);
  const [activeSnippetPath, setActiveSnippetPath] = useState<string | null>(
    preview.snippets[0]?.relativePath ?? null
  );

  useEffect(() => {
    setSelectedPaths(recommendedPaths);
    setActiveSnippetPath(preview.snippets[0]?.relativePath ?? null);
  }, [preview, recommendedPaths]);

  const selectedPathSet = useMemo(() => {
    return new Set(selectedPaths);
  }, [selectedPaths]);

  const selectedFiles = useMemo(() => {
    return preview.selectedFiles.filter((file) => selectedPathSet.has(file.path));
  }, [preview.selectedFiles, selectedPathSet]);

  const selectedSnippets = useMemo(() => {
    return preview.snippets.filter((snippet) =>
      selectedPathSet.has(snippet.relativePath)
    );
  }, [preview.snippets, selectedPathSet]);

  const activeSnippet =
    selectedSnippets.find((snippet) => snippet.relativePath === activeSnippetPath) ??
    selectedSnippets[0] ??
    null;

  useEffect(() => {
    if (selectedSnippets.length === 0) {
      setActiveSnippetPath(null);
      return;
    }

    if (
      !activeSnippetPath ||
      !selectedSnippets.some((snippet) => snippet.relativePath === activeSnippetPath)
    ) {
      setActiveSnippetPath(selectedSnippets[0].relativePath);
    }
  }, [activeSnippetPath, selectedSnippets]);

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      if (current.includes(path)) {
        return current.filter((item) => item !== path);
      }

      return [...current, path];
    });
  }

  async function copyPath(path: string) {
    await navigator.clipboard.writeText(path);
    setCopiedPath(path);

    window.setTimeout(() => {
      setCopiedPath(null);
    }, 1400);
  }

  return (
    <Modal
      title={`Context Composer — ${preview.project.name}`}
      eyebrow="Task context review"
      maxWidth="max-w-[1180px]"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-4">
          <p className="hidden text-xs leading-5 text-neutral-600 md:block">
            {selectedFiles.length} of {preview.selectedFiles.length} file candidate(s)
            will be sent into Task Pack generation.
          </p>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>

            <Button
              variant="primary"
              onClick={() => onGenerate(selectedPaths)}
              disabled={isLoading || selectedPaths.length === 0}
            >
              <WandSparkles size={15} />
              {isLoading ? "Generating..." : "Generate from selected"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex h-[calc(100vh-190px)] min-h-[560px] flex-col overflow-hidden p-5">
        <div className="mb-4 grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/40 p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Sparkles size={13} />
                Composer review
              </span>
              <span className="cf-badge">{preview.task.effectiveTaskArea}</span>
              <span className="cf-badge">{preview.task.targetTool}</span>
            </div>

            <h3 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-[-0.04em] text-white">
              {preview.task.rawTask}
            </h3>

            <p className="mt-3 line-clamp-2 max-w-4xl text-sm leading-6 text-neutral-500">
              Review the files ContextForge selected. Include only the files you want
              to send into the final Task Pack context.
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <StatCard
              icon={<MousePointer2 size={15} />}
              label="Included files"
              value={`${selectedFiles.length}/${preview.selectedFiles.length}`}
              caption="manual review"
            />

            <StatCard
              icon={<Code2 size={15} />}
              label="Snippets"
              value={selectedSnippets.length}
              caption="included previews"
            />

            <StatCard
              icon={<Layers3 size={15} />}
              label="Inventory"
              value={preview.inventorySummary.scannedFiles}
              caption={`${preview.inventorySummary.totalFiles} total files`}
            />

            <StatCard
              icon={<Gauge size={15} />}
              label="Confidence"
              value={formatPercent(preview.taskIntent.confidence)}
              caption={preview.taskIntent.source}
            />
          </section>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)_320px]">
          <aside className="min-h-0 overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  File candidates
                </p>

                <h3 className="mt-1 text-base font-semibold text-white">
                  Include / Exclude
                </h3>
              </div>

              <span className="cf-badge">
                {selectedFiles.length}/{preview.selectedFiles.length}
              </span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedPaths(recommendedPaths)}
                className="cf-invert-action inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs"
              >
                <RotateCcw size={13} />
                Recommended
              </button>

              <button
                type="button"
                onClick={() => setSelectedPaths(preview.selectedFiles.map((file) => file.path))}
                className="cf-invert-action inline-flex h-8 items-center rounded-full px-3 text-xs"
              >
                Select all
              </button>

              <button
                type="button"
                onClick={() => setSelectedPaths([])}
                className="cf-invert-action inline-flex h-8 items-center rounded-full px-3 text-xs"
              >
                Clear
              </button>
            </div>

            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              {preview.selectedFiles.length === 0 ? (
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5 text-sm text-neutral-500">
                  No files selected.
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {preview.selectedFiles.map((file) => {
                    const isCopied = copiedPath === file.path;
                    const isSelected = selectedPathSet.has(file.path);

                    return (
                      <motion.article
                        key={file.path}
                        layout={false}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16 }}
                        className={[
                          "rounded-2xl border p-3 transition duration-200",
                          isSelected
                            ? "border-white/20 bg-white/[0.035]"
                            : "border-neutral-900 bg-black/25 opacity-55 hover:opacity-100"
                        ].join(" ")}
                      >
                        <div className="mb-2 flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => togglePath(file.path)}
                            className={[
                              "grid size-8 shrink-0 place-items-center rounded-xl border transition",
                              isSelected
                                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                                : "border-neutral-800 bg-neutral-950 text-neutral-600 hover:border-white hover:bg-white hover:text-black"
                            ].join(" ")}
                            aria-label={isSelected ? "Exclude file" : "Include file"}
                          >
                            {isSelected ? <CheckCircle2 size={14} /> : <FileText size={14} />}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-white">
                              {file.path}
                            </p>

                            <p className="mt-0.5 truncate text-xs text-neutral-600">
                              {file.kind} · {file.usage} · {formatFileSize(file.sizeBytes)}
                            </p>
                          </div>
                        </div>

                        <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
                          {file.reason}
                        </p>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-500">
                            {formatPercent(file.confidence)}
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => togglePath(file.path)}
                              className={[
                                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition",
                                isSelected
                                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                                  : "border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-white hover:bg-white hover:text-black"
                              ].join(" ")}
                            >
                              {isSelected ? <Check size={12} /> : <FileText size={12} />}
                              {isSelected ? "Included" : "Include"}
                            </button>

                            <button
                              type="button"
                              onClick={() => copyPath(file.path)}
                              className="cf-invert-action inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px]"
                            >
                              {isCopied ? <Check size={12} /> : <Clipboard size={12} />}
                              {isCopied ? "Copied" : "Path"}
                            </button>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
            <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Snippet preview
                </p>

                <h3 className="mt-1 text-base font-semibold text-white">
                  Included context snippets
                </h3>
              </div>

              <span className="cf-badge">
                {activeSnippet?.language ?? "no snippet"}
              </span>
            </div>

            {selectedSnippets.length > 0 && (
              <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
                {selectedSnippets.map((snippet) => {
                  const isActive = snippet.relativePath === activeSnippet?.relativePath;

                  return (
                    <button
                      key={snippet.relativePath}
                      type="button"
                      onClick={() => setActiveSnippetPath(snippet.relativePath)}
                      className={[
                        "shrink-0 rounded-full border px-3 py-1.5 text-xs transition",
                        isActive
                          ? "border-white bg-white text-black"
                          : "border-neutral-900 bg-black/45 text-neutral-500 hover:border-white hover:bg-white hover:text-black"
                      ].join(" ")}
                    >
                      {snippet.relativePath}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/60 p-3">
              {activeSnippet ? (
                <pre className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-xl bg-neutral-950/55 p-4 text-xs leading-6 text-neutral-300">
                  {activeSnippet.content}
                  {activeSnippet.truncated
                    ? "\n\n/* Snippet truncated. Inspect the full file before editing. */"
                    : ""}
                </pre>
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl bg-neutral-950/55 p-8 text-center">
                  <div>
                    <XCircle size={22} className="mx-auto text-neutral-600" />
                    <p className="mt-3 text-sm font-medium text-white">
                      No snippets included
                    </p>
                    <p className="mt-1 text-sm text-neutral-500">
                      Include a readable text file to preview its snippet here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
            <article className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
              <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <Bot size={16} />
              </div>

              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Intent analysis
              </p>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/40 px-3 py-2.5">
                  <span className="text-xs text-neutral-500">Area</span>
                  <span className="text-sm font-medium text-white">
                    {preview.taskIntent.taskArea}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/40 px-3 py-2.5">
                  <span className="text-xs text-neutral-500">Risk</span>
                  <span
                    className={[
                      "rounded-full border px-2 py-0.5 text-[11px]",
                      getRiskTone(preview.taskIntent.riskLevel)
                    ].join(" ")}
                  >
                    {preview.taskIntent.riskLevel}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/40 px-3 py-2.5">
                  <span className="text-xs text-neutral-500">Source</span>
                  <span className="text-sm font-medium text-white">
                    {preview.taskIntent.source}
                  </span>
                </div>
              </div>

              {preview.taskIntent.intentTags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {preview.taskIntent.intentTags.map((tag) => (
                    <span key={tag} className="cf-badge">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
              <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <ShieldCheck size={16} />
              </div>

              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Safety notes
              </p>

              <div className="mt-4 space-y-2">
                {preview.notes.slice(0, 8).map((note) => (
                  <div
                    key={note}
                    className="flex items-start gap-2 rounded-2xl border border-neutral-900 bg-black/40 p-3"
                  >
                    <ListChecks size={14} className="mt-0.5 shrink-0 text-neutral-500" />

                    <p className="text-xs leading-5 text-neutral-500">
                      {note}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            {selectedPaths.length === 0 && (
              <article className="rounded-[1.5rem] border border-red-400/20 bg-red-400/5 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-red-300" />
                  <p className="text-sm font-medium text-red-200">
                    No files included
                  </p>
                </div>

                <p className="text-sm leading-6 text-red-200/70">
                  Include at least one file before generating the Task Pack.
                </p>
              </article>
            )}

            {preview.fileSelection.rejectedModelPaths.length > 0 && (
              <article className="rounded-[1.5rem] border border-red-400/20 bg-red-400/5 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-red-300" />
                  <p className="text-sm font-medium text-red-200">
                    Rejected paths
                  </p>
                </div>

                <div className="space-y-2">
                  {preview.fileSelection.rejectedModelPaths.map((item) => (
                    <p
                      key={item}
                      className="truncate rounded-xl border border-red-400/10 bg-black/30 px-3 py-2 text-xs text-red-200/80"
                    >
                      {item}
                    </p>
                  ))}
                </div>
              </article>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
}