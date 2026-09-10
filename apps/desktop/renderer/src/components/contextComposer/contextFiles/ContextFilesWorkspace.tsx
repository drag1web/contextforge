import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Clipboard,
  Eye,
  FileText,
  Plus,
  ScanSearch,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ContextComposerFileReference } from "../../../types";
import {
  formatContextFileKind,
  formatContextFileUsage,
} from "../../../utils/contextFileLabels";
import { CustomSelect, type SelectOption } from "../../ui/CustomSelect";
import { DropdownMenu } from "../../ui/DropdownMenu";
import { ProjectFileDragHandle } from "../../workspace/ProjectFileDragHandle";
import { getContextComposerFileReasonTranslationKey } from "../ContextComposerUiSemantics";

export type ContextFilesWorkspaceItem = {
  file: ContextComposerFileReference;
  selected: boolean;
  manual: boolean;
  suggested: boolean;
  recommended: boolean;
  reviewed: boolean;
  explicitTarget: boolean;
};

type ContextFilesFilter = "all" | "selected" | "proposed" | "manual";

interface ContextFilesWorkspaceProps {
  projectId: number;
  items: ContextFilesWorkspaceItem[];
  blocked: boolean;
  abstention: boolean;
  copiedPath: string | null;
  explicitTargetPaths: string[];
  onOpenSearch: (query?: string) => void;
  onToggleFile: (path: string) => void;
  onRemoveManualFile: (path: string) => void;
  onCopyPath: (path: string) => void;
  onQuickPeek: (path: string) => void;
  onInspect: (path: string) => void;
  onSelectRecommended: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function structuralPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function fileName(path: string) {
  const normalized = structuralPath(path);
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function ContextFileRow({
  projectId,
  item,
  copiedPath,
  onToggle,
  onRemove,
  onCopy,
  onQuickPeek,
  onInspect,
}: {
  projectId: number;
  item: ContextFilesWorkspaceItem;
  copiedPath: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onCopy: () => void;
  onQuickPeek: () => void;
  onInspect: () => void;
}) {
  const { t } = useTranslation();
  const { file } = item;
  const legacyConfidence =
    file.confidenceDisplay !== "unavailable" && typeof file.confidence === "number"
      ? file.confidence
      : null;
  const reasonKey = getContextComposerFileReasonTranslationKey(file);
  const reason = reasonKey ? t(reasonKey) : file.reason;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className={[
        "group relative rounded-2xl border px-4 py-3 transition-colors duration-200",
        item.selected
          ? "border-white/20 bg-white/[0.045]"
          : "border-neutral-900 bg-black/30 hover:border-neutral-800 hover:bg-white/[0.025]",
      ].join(" ")}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={onToggle}
          className={[
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border transition duration-200",
            item.selected
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-600 hover:border-white hover:bg-white hover:text-black",
          ].join(" ")}
          aria-label={
            item.selected
              ? t("contextComposerPage.fileCard.excludeAria")
              : t("contextComposerPage.fileCard.includeAria")
          }
        >
          {item.selected ? <CheckCircle2 size={15} /> : <FileText size={15} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all text-sm font-semibold text-white">
              {structuralPath(file.path)}
            </p>

            {item.explicitTarget && (
              <span className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200">
                {t("contextComposerPage.contextFiles.explicitTarget")}
              </span>
            )}

            {item.manual && (
              <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] text-neutral-300">
                {t("contextComposerPage.contextFiles.manual")}
              </span>
            )}

            {!item.manual && item.recommended && (
              <span className="shrink-0 rounded-full border border-emerald-400/15 bg-emerald-400/5 px-2 py-0.5 text-[10px] text-emerald-200/80">
                {t("contextComposerPage.contextFiles.recommended")}
              </span>
            )}

            {!item.manual && !item.recommended && item.suggested && (
              <span className="shrink-0 rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-500">
                {t("contextComposerPage.contextFiles.suggested")}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500">
            <span>{formatContextFileKind(file.kind, t)}</span>
            <span className="text-neutral-800">·</span>
            <span>{formatContextFileUsage(file.usage, t)}</span>
            <span className="text-neutral-800">·</span>
            <span>{formatFileSize(file.sizeBytes)}</span>
            <span className="text-neutral-800">·</span>
            <span>
              {item.reviewed && !item.manual
                ? t("contextComposerPage.fileCard.reviewed")
                : file.source
                  ? t(`settings.composerEngineSource_${file.source}`)
                  : t("contextComposerPage.contextFiles.inventoryFile")}
            </span>
            {legacyConfidence !== null && (
              <>
                <span className="text-neutral-800">·</span>
                <span>{formatPercent(legacyConfidence)}</span>
              </>
            )}
          </div>

          {reason && (
            <p className="mt-2 max-w-4xl text-xs leading-5 text-neutral-500">
              {reason}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ProjectFileDragHandle
            projectId={projectId}
            path={file.path}
            label={t("dragAndDrop.dragFileToBasket", { path: file.path })}
            className="size-8 shrink-0 rounded-lg border border-neutral-900 bg-black/40"
          />

          <button
            type="button"
            onClick={onQuickPeek}
            className="hidden h-8 items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] text-neutral-500 transition hover:border-white hover:bg-white hover:text-black lg:inline-flex"
          >
            <Eye size={12} />
            {t("quickPeek.title")}
          </button>

          <button
            type="button"
            onClick={onInspect}
            className="hidden h-8 items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] text-neutral-500 transition hover:border-white hover:bg-white hover:text-black xl:inline-flex"
          >
            <ScanSearch size={12} />
            {t("inspector.inspect")}
          </button>

          <button
            type="button"
            onClick={onToggle}
            className={[
              "inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition duration-200",
              item.selected
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300 hover:border-emerald-300/35"
                : "border-white/15 bg-white text-black hover:bg-neutral-200",
            ].join(" ")}
          >
            {item.selected ? <Check size={12} /> : <Plus size={12} />}
            {item.selected
              ? t("contextComposerPage.fileCard.included")
              : t("contextComposerPage.fileCard.include")}
          </button>

          <DropdownMenu
            ariaLabel={t("contextComposerPage.contextFiles.fileActions")}
            actions={[
              {
                label: t("quickPeek.title"),
                icon: <Eye size={13} />,
                onClick: onQuickPeek,
              },
              {
                label: t("inspector.inspect"),
                icon: <ScanSearch size={13} />,
                onClick: onInspect,
              },
              {
                label: t("contextComposerPage.fileCard.path"),
                icon: copiedPath === file.path ? <Check size={13} /> : <Clipboard size={13} />,
                onClick: onCopy,
              },
              ...(item.manual
                ? [{
                    label: t("contextComposerPage.fileCard.remove"),
                    icon: <Trash2 size={13} />,
                    onClick: onRemove,
                  }]
                : []),
            ]}
          />
        </div>
      </div>
    </motion.article>
  );
}

export function ContextFilesWorkspace({
  projectId,
  items,
  blocked,
  abstention,
  copiedPath,
  explicitTargetPaths,
  onOpenSearch,
  onToggleFile,
  onRemoveManualFile,
  onCopyPath,
  onQuickPeek,
  onInspect,
  onSelectRecommended,
  onSelectAll,
  onClearSelection,
}: ContextFilesWorkspaceProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ContextFilesFilter>("all");

  const selectedCount = items.filter((item) => item.selected).length;
  const proposedCount = items.filter((item) => item.recommended || item.suggested).length;
  const manualCount = items.filter((item) => item.manual).length;

  const filterOptions = useMemo<SelectOption<ContextFilesFilter>[]>(() => [
    {
      value: "all",
      label: t("contextComposerPage.contextFiles.filterAll"),
      description: t("contextComposerPage.contextFiles.filterCount", { count: items.length }),
      icon: <FileText size={14} />,
    },
    {
      value: "selected",
      label: t("contextComposerPage.contextFiles.filterSelected"),
      description: t("contextComposerPage.contextFiles.filterCount", { count: selectedCount }),
      icon: <CheckCircle2 size={14} />,
    },
    {
      value: "proposed",
      label: t("contextComposerPage.contextFiles.filterProposed"),
      description: t("contextComposerPage.contextFiles.filterCount", { count: proposedCount }),
      icon: <SlidersHorizontal size={14} />,
    },
    {
      value: "manual",
      label: t("contextComposerPage.contextFiles.filterManual"),
      description: t("contextComposerPage.contextFiles.filterCount", { count: manualCount }),
      icon: <Plus size={14} />,
    },
  ], [items.length, manualCount, proposedCount, selectedCount, t]);

  const filteredItems = useMemo(() => {
    if (filter === "selected") return items.filter((item) => item.selected);
    if (filter === "proposed") {
      return items.filter((item) => item.recommended || item.suggested);
    }
    if (filter === "manual") return items.filter((item) => item.manual);
    return items;
  }, [filter, items]);

  const itemByPath = useMemo(() => {
    return new Map(items.map((item) => [structuralPath(item.file.path), item]));
  }, [items]);

  const unresolvedExplicitTargets = useMemo(() => {
    return explicitTargetPaths
      .map(structuralPath)
      .filter((path, index, paths) => paths.indexOf(path) === index)
      .filter((path) => !itemByPath.get(path)?.selected);
  }, [explicitTargetPaths, itemByPath]);

  const firstTarget = unresolvedExplicitTargets[0] ?? null;
  const firstTargetItem = firstTarget ? itemByPath.get(firstTarget) ?? null : null;

  return (
    <div className="min-h-0">
      <div className="mb-4 flex flex-col gap-4 rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("contextComposerPage.contextFiles.kicker")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white">
              {t("contextComposerPage.contextFiles.title")}
            </h2>
            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-400">
              {t("contextComposerPage.contextFiles.selectedCount", {
                selected: selectedCount,
                total: items.length,
              })}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">
            {blocked
              ? t("contextComposerPage.contextFiles.blockedDescription")
              : t("contextComposerPage.contextFiles.description")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[220px] max-w-full">
            <CustomSelect<ContextFilesFilter>
              value={filter}
              options={filterOptions}
              onChange={setFilter}
              className="h-10 rounded-xl"
            />
          </div>

          <DropdownMenu
            ariaLabel={t("contextComposerPage.contextFiles.bulkActions")}
            actions={[
              {
                label: abstention
                  ? t("contextComposerPage.candidates.reviewHints")
                  : blocked
                    ? t("contextComposerPage.candidates.confirmAuto")
                    : t("contextComposerPage.candidates.recommended"),
                icon: <CheckCircle2 size={13} />,
                onClick: onSelectRecommended,
              },
              {
                label: abstention
                  ? t("contextComposerPage.candidates.reviewAll")
                  : blocked
                    ? t("contextComposerPage.candidates.confirmAll")
                    : t("contextComposerPage.candidates.selectAll"),
                icon: <Check size={13} />,
                onClick: onSelectAll,
              },
              {
                label: abstention
                  ? t("contextComposerPage.candidates.clearHints")
                  : blocked
                    ? t("contextComposerPage.candidates.clearWeak")
                    : t("contextComposerPage.candidates.clear"),
                icon: <XCircle size={13} />,
                onClick: onClearSelection,
              },
            ]}
          />

          <button
            type="button"
            onClick={() => onOpenSearch("")}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white px-4 text-xs font-semibold text-black transition hover:bg-neutral-200"
          >
            <Plus size={14} />
            {t("contextComposerPage.candidates.addFile")}
          </button>
        </div>
      </div>

      {blocked && firstTarget && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-100">
              {t("contextComposerPage.contextFiles.recoveryTitle")}
            </p>
            <p className="mt-1 break-all text-xs leading-5 text-neutral-400">
              {t("contextComposerPage.contextFiles.recoveryDescription", {
                path: firstTarget,
              })}
              {unresolvedExplicitTargets.length > 1
                ? ` ${t("contextComposerPage.contextFiles.moreTargets", {
                    count: unresolvedExplicitTargets.length - 1,
                  })}`
                : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (firstTargetItem) {
                onToggleFile(firstTargetItem.file.path);
              } else {
                onOpenSearch(firstTarget);
              }
            }}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-100/35 hover:bg-amber-200/15"
          >
            {firstTargetItem ? <CheckCircle2 size={13} /> : <Plus size={13} />}
            {firstTargetItem
              ? t("contextComposerPage.contextFiles.confirmTarget")
              : t("contextComposerPage.contextFiles.findTarget", {
                  name: fileName(firstTarget),
                })}
          </button>
        </motion.div>
      )}

      <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
          <p className="text-xs font-medium text-neutral-400">
            {t("contextComposerPage.contextFiles.visibleFiles", {
              count: filteredItems.length,
            })}
          </p>
          {filter !== "all" && (
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="text-[11px] text-neutral-500 transition hover:text-white"
            >
              {t("contextComposerPage.contextFiles.resetFilter")}
            </button>
          )}
        </div>

        <div className="p-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {filteredItems.length > 0 ? (
              <motion.div layout className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filteredItems.map((item) => (
                  <ContextFileRow
                    key={item.file.path}
                    projectId={projectId}
                    item={item}
                    copiedPath={copiedPath}
                    onToggle={() => onToggleFile(item.file.path)}
                    onRemove={() => onRemoveManualFile(item.file.path)}
                    onCopy={() => onCopyPath(item.file.path)}
                    onQuickPeek={() => onQuickPeek(item.file.path)}
                    onInspect={() => onInspect(item.file.path)}
                  />
                ))}
              </motion.div>
            ) : (
              <motion.div
                key={`empty-${filter}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex min-h-[190px] items-center justify-center px-6 py-8 text-center"
              >
                <div className="max-w-md">
                  <div className="mx-auto grid size-11 place-items-center rounded-2xl border border-neutral-900 bg-neutral-950 text-neutral-600">
                    <FileText size={18} />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-white">
                    {items.length === 0
                      ? t("contextComposerPage.contextFiles.emptyTitle")
                      : t("contextComposerPage.contextFiles.emptyFilterTitle")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-neutral-600">
                    {items.length === 0
                      ? t("contextComposerPage.contextFiles.emptyDescription")
                      : t("contextComposerPage.contextFiles.emptyFilterDescription")}
                  </p>

                  {items.length === 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenSearch(firstTarget ?? "")}
                      className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-white/15 bg-white px-4 text-xs font-semibold text-black transition hover:bg-neutral-200"
                    >
                      <Plus size={13} />
                      {firstTarget
                        ? t("contextComposerPage.contextFiles.findTarget", {
                            name: fileName(firstTarget),
                          })
                        : t("contextComposerPage.candidates.addFile")}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
