import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  FileCode2,
  GitBranch,
  Minus,
  Network,
  PanelRightOpen,
  Plus,
  ScanSearch,
  ShieldCheck,
  X,
} from "lucide-react";

import type {
  ContextComposerEngineFileView,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
} from "../../types";
import { Button } from "../ui/Button";
import { ProjectFileDragHandle } from "./ProjectFileDragHandle";
import {
  buildContextMapGraph,
  type ContextMapEdge,
  type ContextMapFileNode,
  type ContextMapFindingNode,
  type ContextMapNode,
} from "./contextMap";

interface ContextMapPanelProps {
  view: ContextComposerEngineView;
  projectId: number;
  projectName: string;
  onClose: () => void;
  onInspectFile: (file: ContextComposerEngineFileView) => void;
  onInspectEvidence: (
    file: ContextComposerEngineFileView,
    evidence: ContextComposerEvidenceView,
  ) => void;
  onOpenSource: (path: string, line?: number) => void;
}

type PositionedNode = {
  node: ContextMapNode;
  x: number;
  y: number;
  height: number;
};

const NODE_WIDTH = 250;
const FINDING_HEIGHT = 112;
const EVIDENCE_HEIGHT = 108;
const FILE_HEIGHT = 100;
const NODE_GAP = 18;
const TOP = 72;
const COLUMN_X = {
  finding: 32,
  evidence: 356,
  file: 680,
} as const;

function lineLabel(start?: number, end?: number) {
  if (!start) return null;
  if (end && end !== start) return `L${start}–${end}`;
  return `L${start}`;
}

function edgeTone(edge: ContextMapEdge) {
  if (edge.kind === "finding_file") {
    return {
      stroke: "rgba(255,255,255,0.20)",
      dash: "5 6",
    };
  }

  if (edge.evidenceRole === "contradicts") {
    return {
      stroke: "rgba(248,113,113,0.62)",
      dash: undefined,
    };
  }

  if (edge.evidenceRole === "supports") {
    return {
      stroke: "rgba(110,231,183,0.56)",
      dash: undefined,
    };
  }

  return {
    stroke: "rgba(212,212,216,0.38)",
    dash: undefined,
  };
}

function MapBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "danger" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : tone === "danger"
        ? "border-red-400/20 bg-red-400/10 text-red-200"
        : tone === "warning"
          ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
          : "border-neutral-800 bg-black/45 text-neutral-500";

  return (
    <span
      className={[
        "inline-flex h-5 items-center rounded-full border px-2 text-[9px] font-medium",
        toneClass,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function ColumnTitle({
  icon,
  title,
  count,
  left,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  left: number;
}) {
  return (
    <div
      className="absolute top-5 flex items-center gap-2 text-neutral-600"
      style={{ left, width: NODE_WIDTH }}
    >
      {icon}
      <span className="cf-tech-label text-[9px] uppercase">{title}</span>
      <span className="ml-auto font-mono text-[9px] text-neutral-700">
        {count}
      </span>
    </div>
  );
}

function FindingNodeCard({
  item,
  selected,
  related,
  onSelect,
}: {
  item: ContextMapFindingNode;
  selected: boolean;
  related: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const dimmed = !selected && !related;

  return (
    <motion.div
      data-map-node
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      animate={{ opacity: dimmed ? 0.32 : 1 }}
      transition={{ duration: 0.14 }}
      className={[
        "absolute overflow-hidden rounded-2xl border bg-black/92 p-3.5 outline-none transition",
        selected
          ? "border-white/35 shadow-[0_16px_44px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)]"
          : "border-neutral-800/90 hover:border-neutral-700",
        "focus-visible:ring-4 focus-visible:ring-white/5",
      ].join(" ")}
      style={{ width: NODE_WIDTH, height: FINDING_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <GitBranch size={12} className="shrink-0 text-neutral-600" />
          <span className="truncate font-mono text-[9px] text-neutral-600">
            {item.finding.findingId}
          </span>
        </span>
        <MapBadge
          tone={
            item.finding.status === "confirmed"
              ? "positive"
              : item.finding.status === "unresolved"
                ? "warning"
                : "neutral"
          }
        >
          {t(`explainability.findingStatus_${item.finding.status}`)}
        </MapBadge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-neutral-100">
        {item.finding.statement}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <MapBadge>
          {t(`explainability.findingType_${item.finding.type}`)}
        </MapBadge>
        <MapBadge
          tone={
            item.finding.authorizationHint === "eligible"
              ? "positive"
              : item.finding.authorizationHint === "not_eligible"
                ? "danger"
                : "warning"
          }
        >
          {t(
            `explainability.authorizationHint_${item.finding.authorizationHint}`,
          )}
        </MapBadge>
      </div>
    </motion.div>
  );
}

function FileNodeCard({
  item,
  selected,
  related,
  onSelect,
  projectId,
  onInspectFile,
  onOpenSource,
}: {
  item: ContextMapFileNode;
  selected: boolean;
  related: boolean;
  onSelect: () => void;
  projectId: number;
  onInspectFile: ContextMapPanelProps["onInspectFile"];
  onOpenSource: ContextMapPanelProps["onOpenSource"];
}) {
  const { t } = useTranslation();
  const dimmed = !selected && !related;
  const fileName =
    item.path.split("/").filter(Boolean).pop() ?? item.path;

  return (
    <motion.div
      data-map-node
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      animate={{ opacity: dimmed ? 0.32 : 1 }}
      transition={{ duration: 0.14 }}
      className={[
        "absolute overflow-hidden rounded-2xl border bg-black/92 p-3.5 outline-none transition",
        selected
          ? "border-white/35 shadow-[0_16px_44px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)]"
          : "border-neutral-800/90 hover:border-neutral-700",
      ].join(" ")}
      style={{ width: NODE_WIDTH, height: FILE_HEIGHT }}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
          <FileCode2 size={13} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white" title={item.path}>
            {fileName}
          </p>
          <p
            className="mt-1 truncate font-mono text-[9px] text-neutral-600"
            title={item.path}
          >
            {item.path}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        {item.contextFile ? (
          <>
            <MapBadge>
              {t(`settings.composerEngineRole_${item.contextFile.role}`)}
            </MapBadge>
            <MapBadge>
              {t(`explainability.usage_${item.contextFile.usage}`)}
            </MapBadge>
            {item.contextFile.reviewRequired ? (
              <MapBadge tone="warning">
                {t("explainability.reviewRequired")}
              </MapBadge>
            ) : null}
          </>
        ) : (
          <MapBadge>{t("explainability.contextMapSourceOnly")}</MapBadge>
        )}

        <ProjectFileDragHandle
          projectId={projectId}
          path={item.path}
          label={t("dragAndDrop.dragFileToBasket", { path: item.path })}
          className="ml-auto size-7 shrink-0 rounded-lg border border-neutral-900 bg-black"
        />

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (item.contextFile) {
              onInspectFile(item.contextFile);
            } else {
              onOpenSource(item.path);
            }
          }}
          className="grid size-7 shrink-0 place-items-center rounded-lg border border-neutral-900 text-neutral-600 transition hover:border-neutral-700 hover:text-white"
          title={
            item.contextFile
              ? t("explainability.inspectFile")
              : t("explainability.contextMapOpenSource")
          }
          aria-label={
            item.contextFile
              ? t("explainability.inspectFile")
              : t("explainability.contextMapOpenSource")
          }
        >
          {item.contextFile ? (
            <ScanSearch size={12} />
          ) : (
            <PanelRightOpen size={12} />
          )}
        </button>
      </div>
    </motion.div>
  );
}

export function ContextMapPanel({
  view,
  projectId,
  projectName,
  onClose,
  onInspectFile,
  onInspectEvidence,
  onOpenSource,
}: ContextMapPanelProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const graph = useMemo(() => buildContextMapGraph(view), [view]);
  const [zoom, setZoom] = useState(0.9);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const allNodes = useMemo<ContextMapNode[]>(
    () => [...graph.findings, ...graph.evidence, ...graph.files],
    [graph],
  );

  const relatedNodeIds = useMemo(() => {
    if (!selectedNodeId) {
      return new Set(allNodes.map((node) => node.id));
    }

    const related = new Set<string>([selectedNodeId]);
    for (const edge of graph.edges) {
      if (edge.from === selectedNodeId) related.add(edge.to);
      if (edge.to === selectedNodeId) related.add(edge.from);
    }
    return related;
  }, [allNodes, graph.edges, selectedNodeId]);

  const positioned = useMemo(() => {
    const items: PositionedNode[] = [];

    graph.findings.forEach((node, index) => {
      items.push({
        node,
        x: COLUMN_X.finding,
        y: TOP + index * (FINDING_HEIGHT + NODE_GAP),
        height: FINDING_HEIGHT,
      });
    });

    graph.evidence.forEach((node, index) => {
      items.push({
        node,
        x: COLUMN_X.evidence,
        y: TOP + index * (EVIDENCE_HEIGHT + NODE_GAP),
        height: EVIDENCE_HEIGHT,
      });
    });

    graph.files.forEach((node, index) => {
      items.push({
        node,
        x: COLUMN_X.file,
        y: TOP + index * (FILE_HEIGHT + NODE_GAP),
        height: FILE_HEIGHT,
      });
    });

    return items;
  }, [graph]);

  const positionsById = useMemo(
    () => new Map(positioned.map((item) => [item.node.id, item])),
    [positioned],
  );

  const canvasHeight = Math.max(
    390,
    TOP +
      Math.max(
        graph.findings.length * (FINDING_HEIGHT + NODE_GAP),
        graph.evidence.length * (EVIDENCE_HEIGHT + NODE_GAP),
        graph.files.length * (FILE_HEIGHT + NODE_GAP),
      ) +
      36,
  );
  const canvasWidth = 962;

  const evidenceHostFiles = useMemo(
    () =>
      new Map(
        graph.evidence.map((item) => [
          item.evidence.evidenceId,
          view.files.find(
            (file) =>
              file.path.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "") ===
              item.hostContextFilePath,
          ) ?? null,
        ]),
      ),
    [graph.evidence, view.files],
  );

  function handlePanStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-map-node]")
    ) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;

    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function handlePanMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const pan = panRef.current;
    if (!viewport || !pan || pan.pointerId !== event.pointerId) return;

    viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    viewport.scrollTop = pan.top - (event.clientY - pan.y);
  }

  function handlePanEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
  }

  const graphAvailable =
    graph.findings.length > 0 ||
    graph.evidence.length > 0 ||
    graph.edges.length > 0;

  return (
    <motion.aside
      aria-label={t("explainability.contextMapTitle")}
      initial={prefersReducedMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 20 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 430, damping: 40, mass: 0.7 }
      }
      className="fixed bottom-[27px] right-0 top-[48px] z-[82] flex w-[min(820px,calc(100vw-18px))] flex-col overflow-hidden border-l border-white/[0.10] bg-black/98 shadow-[-24px_0_80px_rgba(0,0,0,0.58)] xl:relative xl:bottom-auto xl:right-auto xl:top-auto xl:z-10 xl:w-[clamp(360px,48vw,820px)] xl:shrink-0 xl:shadow-none"
    >
      <header className="shrink-0 border-b border-neutral-900 bg-black/96 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network size={13} className="text-neutral-500" />
              <span className="cf-tech-label text-[9px] uppercase text-neutral-500">
                {t("explainability.contextMapEyebrow")}
              </span>
              <span className="size-1 rounded-full bg-neutral-800" />
              <span className="truncate text-[9px] uppercase tracking-[0.1em] text-neutral-600">
                {projectName}
              </span>
            </div>

            <h2 className="mt-2 text-base font-semibold text-white">
              {t("explainability.contextMapTitle")}
            </h2>
            <p className="mt-1 max-w-2xl text-[10px] leading-4 text-neutral-500">
              {t("explainability.contextMapDescription")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-900 bg-black text-neutral-600 transition hover:border-neutral-700 hover:text-white"
            aria-label={t("explainability.contextMapClose")}
            title={t("explainability.contextMapClose")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MapBadge>
            {t("explainability.contextMapFindings")}: {graph.findings.length}
          </MapBadge>
          <MapBadge>
            {t("explainability.contextMapEvidence")}: {graph.evidence.length}
          </MapBadge>
          <MapBadge>
            {t("explainability.contextMapFiles")}: {graph.files.length}
          </MapBadge>
          <span className="mx-1 h-4 w-px bg-neutral-900" />
          <MapBadge tone="positive">
            {t("explainability.contextMapSupports")}
          </MapBadge>
          <MapBadge tone="danger">
            {t("explainability.contextMapContradicts")}
          </MapBadge>
          <MapBadge>
            {t("explainability.contextMapContextOnly")}
          </MapBadge>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}
              className="grid size-8 place-items-center rounded-xl border border-neutral-900 text-neutral-600 transition hover:border-neutral-700 hover:text-white"
              aria-label={t("explainability.contextMapZoomOut")}
              title={t("explainability.contextMapZoomOut")}
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              onClick={() => setZoom(0.9)}
              className="h-8 min-w-14 rounded-xl border border-neutral-900 px-2 font-mono text-[10px] text-neutral-500 transition hover:border-neutral-700 hover:text-white"
              aria-label={t("explainability.contextMapResetZoom")}
              title={t("explainability.contextMapResetZoom")}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((value) => Math.min(1.35, value + 0.1))}
              className="grid size-8 place-items-center rounded-xl border border-neutral-900 text-neutral-600 transition hover:border-neutral-700 hover:text-white"
              aria-label={t("explainability.contextMapZoomIn")}
              title={t("explainability.contextMapZoomIn")}
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      </header>

      {(graph.hiddenFindingIds.length > 0 ||
        graph.hiddenEvidenceIds.length > 0) && (
        <div className="shrink-0 border-b border-amber-300/15 bg-amber-300/[0.045] px-4 py-2 text-[10px] leading-4 text-amber-100/75">
          {t("explainability.contextMapInconsistent", {
            findings: graph.hiddenFindingIds.length,
            evidence: graph.hiddenEvidenceIds.length,
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 p-4">
        {graphAvailable ? (
          <div
            ref={viewportRef}
            onPointerDown={handlePanStart}
            onPointerMove={handlePanMove}
            onPointerUp={handlePanEnd}
            onPointerCancel={handlePanEnd}
            className={[
              "h-full min-h-[280px] overflow-auto rounded-2xl border border-neutral-900 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.055)_1px,transparent_0)] bg-[length:22px_22px]",
              isPanning ? "cursor-grabbing select-none" : "cursor-grab",
            ].join(" ")}
          >
            <div
              className="relative"
              style={{
                width: canvasWidth * zoom,
                height: canvasHeight * zoom,
              }}
            >
              <div
                className="absolute left-0 top-0"
                style={{
                  width: canvasWidth,
                  height: canvasHeight,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <ColumnTitle
                  icon={<GitBranch size={12} />}
                  title={t("explainability.contextMapFindings")}
                  count={graph.findings.length}
                  left={COLUMN_X.finding}
                />
                <ColumnTitle
                  icon={<ShieldCheck size={12} />}
                  title={t("explainability.contextMapEvidence")}
                  count={graph.evidence.length}
                  left={COLUMN_X.evidence}
                />
                <ColumnTitle
                  icon={<FileCode2 size={12} />}
                  title={t("explainability.contextMapFiles")}
                  count={graph.files.length}
                  left={COLUMN_X.file}
                />

                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  width={canvasWidth}
                  height={canvasHeight}
                >
                  {graph.edges.map((edge) => {
                    const from = positionsById.get(edge.from);
                    const to = positionsById.get(edge.to);
                    if (!from || !to) return null;

                    const x1 = from.x + NODE_WIDTH;
                    const y1 = from.y + from.height / 2;
                    const x2 = to.x;
                    const y2 = to.y + to.height / 2;
                    const delta = Math.max(50, Math.min(120, (x2 - x1) / 2));
                    const tone = edgeTone(edge);
                    const highlighted =
                      !selectedNodeId ||
                      edge.from === selectedNodeId ||
                      edge.to === selectedNodeId;

                    return (
                      <motion.path
                        key={edge.id}
                        d={`M ${x1} ${y1} C ${x1 + delta} ${y1}, ${x2 - delta} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={tone.stroke}
                        strokeWidth={edge.kind === "finding_file" ? 1 : 1.5}
                        strokeDasharray={tone.dash}
                        animate={{ opacity: highlighted ? 1 : 0.12 }}
                        transition={{ duration: 0.14 }}
                      />
                    );
                  })}
                </svg>

                {positioned.map((position) => {
                  const node = position.node;
                  const selected = selectedNodeId === node.id;
                  const related = relatedNodeIds.has(node.id);

                  if (node.kind === "finding") {
                    return (
                      <div
                        key={node.id}
                        className="absolute"
                        style={{ left: position.x, top: position.y }}
                      >
                        <FindingNodeCard
                          item={node}
                          selected={selected}
                          related={related}
                          onSelect={() =>
                            setSelectedNodeId((current) =>
                              current === node.id ? null : node.id,
                            )
                          }
                        />
                      </div>
                    );
                  }

                  if (node.kind === "evidence") {
                    const hostFile = evidenceHostFiles.get(
                      node.evidence.evidenceId,
                    );
                    const sourceLine = lineLabel(
                      node.evidence.startLine,
                      node.evidence.endLine,
                    );
                    const dimmed = !selected && !related;

                    return (
                      <motion.div
                        key={node.id}
                        data-map-node
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setSelectedNodeId((current) =>
                            current === node.id ? null : node.id,
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedNodeId((current) =>
                              current === node.id ? null : node.id,
                            );
                          }
                        }}
                        animate={{ opacity: dimmed ? 0.32 : 1 }}
                        transition={{ duration: 0.14 }}
                        className={[
                          "absolute overflow-hidden rounded-2xl border bg-black/92 p-3.5 outline-none transition",
                          selected
                            ? "border-white/35 shadow-[0_16px_44px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)]"
                            : "border-neutral-800/90 hover:border-neutral-700",
                        ].join(" ")}
                        style={{
                          left: position.x,
                          top: position.y,
                          width: NODE_WIDTH,
                          height: EVIDENCE_HEIGHT,
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <MapBadge
                            tone={
                              node.evidence.role === "supports"
                                ? "positive"
                                : node.evidence.role === "contradicts"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {t(
                              `explainability.contextMapRole_${node.evidence.role}`,
                            )}
                          </MapBadge>
                          <MapBadge>{node.evidence.strength}</MapBadge>

                          {hostFile ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onInspectEvidence(hostFile, node.evidence);
                              }}
                              className="ml-auto grid size-7 place-items-center rounded-lg border border-neutral-900 text-neutral-600 transition hover:border-neutral-700 hover:text-white"
                              aria-label={t("explainability.inspectEvidence")}
                              title={t("explainability.inspectEvidence")}
                            >
                              <ScanSearch size={12} />
                            </button>
                          ) : null}
                        </div>

                        <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-neutral-100">
                          {node.evidence.predicate ??
                            node.evidence.evidenceId}
                        </p>

                        <div className="mt-2 flex min-w-0 items-center gap-2">
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-[9px] text-neutral-600"
                            title={node.evidence.path}
                          >
                            {node.evidence.path ??
                              t("explainability.contextMapNoSource")}
                          </span>
                          {sourceLine ? (
                            <span className="shrink-0 font-mono text-[9px] text-neutral-700">
                              {sourceLine}
                            </span>
                          ) : null}
                        </div>
                      </motion.div>
                    );
                  }

                  return (
                    <div
                      key={node.id}
                      className="absolute"
                      style={{ left: position.x, top: position.y }}
                    >
                      <FileNodeCard
                        item={node}
                        selected={selected}
                        related={related}
                        projectId={projectId}
                        onSelect={() =>
                          setSelectedNodeId((current) =>
                            current === node.id ? null : node.id,
                          )
                        }
                        onInspectFile={onInspectFile}
                        onOpenSource={onOpenSource}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-[280px] place-items-center rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                <Network size={18} />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-white">
                {t("explainability.contextMapEmptyTitle")}
              </h3>
              <p className="mt-2 text-xs leading-5 text-neutral-600">
                {view.effectiveSource === "legacy"
                  ? t("explainability.contextMapLegacyEmpty")
                  : t("explainability.contextMapEmptyDescription")}
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-neutral-900 bg-black/96 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[9px] leading-4 text-neutral-700">
            {t("explainability.contextMapHistoryHint")}
          </p>
          <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setSelectedNodeId(null)}>
            {t("explainability.contextMapClearFocus")}
          </Button>
        </div>
      </footer>
    </motion.aside>
  );
}
