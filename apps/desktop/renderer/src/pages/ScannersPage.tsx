import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Code2,
  FileCode2,
  FileSearch,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  KeyRound,
  Package,
  RefreshCw,
  ScanSearch,
  Search,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import type { Project, ScannerSignals } from "../types";
import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { Button } from "../components/ui/Button";
import {
  HorizontalSlidingSelector,
  VerticalSlidingSelector,
} from "../components/ui/SlidingSelectors";

type ScannerLens = "all" | "withSignals" | "missingTests" | "missingCi";
type ScannerView = "overview" | "structure" | "tools" | "signals";

type Translator = TFunction;

interface ScannersPageProps {
  projects: Project[];
  isLoading: boolean;
  onAddProject: () => void;
  onRescanProject: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
}

const PAGE_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
} as const;

const PANEL_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.58,
} as const;

const PROJECT_ITEM_HEIGHT = 78;
const PROJECT_ITEM_GAP = 8;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function formatRelativeDate(value: string | null, t: Translator) {
  if (!value) return t("scannersPage.neverScanned");

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t("scannersPage.neverScanned");

  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });

  const days = Math.floor(hours / 24);
  return t("time.daysAgo", { count: days });
}

function formatFullDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(locale.startsWith("ru") ? "ru-RU" : "en-US");
}

function hasTestEvidence(project: Project) {
  const signals = project.readinessReport.signals;
  return Boolean(
    signals?.commands.test || signals?.testConfigs.length || signals?.testFiles.length,
  );
}

function hasCiEvidence(project: Project) {
  return Boolean(project.readinessReport.signals?.ciFiles.length);
}

function getScannerCoverage(project: Project) {
  const signals = project.readinessReport.signals;
  if (!signals) return 0;

  const buckets = [
    signals.packageFiles.length > 0,
    Boolean(signals.commands.dev),
    Boolean(signals.commands.build),
    Boolean(signals.commands.test),
    signals.docs.length > 0,
    signals.envExamples.length > 0,
    signals.testFiles.length + signals.testConfigs.length > 0,
    signals.ciFiles.length > 0,
    signals.configs.length + signals.lockFiles.length > 0,
  ];

  return buckets.filter(Boolean).length;
}

function getDetectedCommandCount(signals?: ScannerSignals) {
  if (!signals) return 0;
  return Object.values(signals.commands).filter(Boolean).length;
}

function getScanStatus(signals: ScannerSignals | undefined, t: Translator) {
  if (!signals) {
    return {
      label: t("scannersPage.statusNoData"),
      description: t("scannersPage.statusNoDataDescription"),
      tone: "muted" as const,
    };
  }

  if (signals.inventory.truncated) {
    return {
      label: t("scannersPage.statusLimited"),
      description: t("scannersPage.statusLimitedDescription"),
      tone: "warning" as const,
    };
  }

  return {
    label: t("scannersPage.statusComplete"),
    description: t("scannersPage.statusCompleteDescription"),
    tone: "success" as const,
  };
}

function StatusDot({ tone }: { tone: "success" | "warning" | "muted" }) {
  const className =
    tone === "success"
      ? "bg-emerald-300"
      : tone === "warning"
        ? "bg-amber-300"
        : "bg-neutral-700";

  return <span className={["size-1.5 rounded-full", className].join(" ")} />;
}

function CompactMetric({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3">
      <p className="cf-tech-label truncate text-[9px] uppercase text-neutral-600">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-semibold tracking-[-0.03em] text-white">
        {value}
      </p>
      {caption && <p className="mt-0.5 truncate text-[11px] text-neutral-700">{caption}</p>}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="grid min-h-[360px] place-items-center rounded-[1.5rem] border border-dashed border-neutral-900 bg-black/20 p-8 text-center">
      <div>
        <div className="mx-auto grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </div>
        <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {description}
        </p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </section>
  );
}

function ProjectScanListItem({
  project,
  isSelected,
  t,
}: {
  project: Project;
  isSelected: boolean;
  t: Translator;
}) {
  const signals = project.readinessReport.signals;
  const coverage = getScannerCoverage(project);

  return (
    <span className="flex h-full items-center gap-3">
      <span
        className={[
          "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
          isSelected
            ? "border-black/10 bg-black/[0.06] text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-500",
        ].join(" ")}
      >
        <ScanSearch size={15} />
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span
          className={[
            "block truncate text-sm font-semibold",
            isSelected ? "text-black" : "text-white",
          ].join(" ")}
        >
          {project.name}
        </span>
        <span
          className={[
            "mt-1 block truncate text-[11px]",
            isSelected ? "text-black/55" : "text-neutral-600",
          ].join(" ")}
        >
          {formatRelativeDate(project.lastScanAt, t)} · {signals?.inventory.totalFiles ?? 0}{" "}
          {t("scannersPage.filesShort")}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span
          className={[
            "block text-sm font-semibold",
            isSelected ? "text-black" : "text-neutral-300",
          ].join(" ")}
        >
          {coverage}/9
        </span>
        <span
          className={[
            "mt-0.5 block text-[9px] uppercase tracking-[0.16em]",
            isSelected ? "text-black/45" : "text-neutral-700",
          ].join(" ")}
        >
          {t("scannersPage.signalsShort")}
        </span>
      </span>
    </span>
  );
}

function ScannerSkeleton() {
  return (
    <section className="space-y-4" aria-busy="true">
      <div className="h-28 animate-pulse rounded-[1.75rem] border border-neutral-900 bg-white/[0.025]" />
      <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <div className="h-[620px] animate-pulse rounded-[1.5rem] border border-neutral-900 bg-white/[0.025]" />
        <div className="space-y-4">
          <div className="h-44 animate-pulse rounded-[1.5rem] border border-neutral-900 bg-white/[0.025]" />
          <div className="h-12 animate-pulse rounded-2xl border border-neutral-900 bg-white/[0.025]" />
          <div className="h-80 animate-pulse rounded-[1.5rem] border border-neutral-900 bg-white/[0.025]" />
        </div>
      </div>
    </section>
  );
}

type EvidenceItem = {
  key: string;
  label: string;
  found: boolean;
  summary: string;
  details: string[];
  icon: ReactNode;
};

function buildEvidenceItems(signals: ScannerSignals | undefined, t: Translator): EvidenceItem[] {
  if (!signals) return [];

  const testEvidence = [...signals.testConfigs, ...signals.testFiles];
  const configEvidence = [...signals.configs, ...signals.lockFiles];

  return [
    {
      key: "packages",
      label: t("scannersPage.evidencePackages"),
      found: signals.packageFiles.length > 0,
      summary: t("scannersPage.itemsFound", { count: signals.packageFiles.length }),
      details: signals.packageFiles,
      icon: <Package size={15} />,
    },
    {
      key: "dev-command",
      label: t("scannersPage.evidenceDevCommand"),
      found: Boolean(signals.commands.dev),
      summary: signals.commands.dev ?? t("scannersPage.notDetected"),
      details: signals.commands.dev ? [signals.commands.dev] : [],
      icon: <TerminalSquare size={15} />,
    },
    {
      key: "build-command",
      label: t("scannersPage.evidenceBuildCommand"),
      found: Boolean(signals.commands.build),
      summary: signals.commands.build ?? t("scannersPage.notDetected"),
      details: signals.commands.build ? [signals.commands.build] : [],
      icon: <TerminalSquare size={15} />,
    },
    {
      key: "test-command",
      label: t("scannersPage.evidenceTestCommand"),
      found: Boolean(signals.commands.test),
      summary: signals.commands.test ?? t("scannersPage.notDetected"),
      details: signals.commands.test ? [signals.commands.test] : [],
      icon: <TerminalSquare size={15} />,
    },
    {
      key: "docs",
      label: t("scannersPage.evidenceDocumentation"),
      found: signals.docs.length > 0,
      summary: t("scannersPage.itemsFound", { count: signals.docs.length }),
      details: signals.docs,
      icon: <FileText size={15} />,
    },
    {
      key: "environment",
      label: t("scannersPage.evidenceEnvironment"),
      found: signals.envExamples.length > 0,
      summary: t("scannersPage.itemsFound", { count: signals.envExamples.length }),
      details: signals.envExamples,
      icon: <KeyRound size={15} />,
    },
    {
      key: "tests",
      label: t("scannersPage.evidenceTests"),
      found: testEvidence.length > 0,
      summary: t("scannersPage.itemsFound", { count: testEvidence.length }),
      details: testEvidence,
      icon: <FileCode2 size={15} />,
    },
    {
      key: "ci",
      label: t("scannersPage.evidenceCi"),
      found: signals.ciFiles.length > 0,
      summary: t("scannersPage.itemsFound", { count: signals.ciFiles.length }),
      details: signals.ciFiles,
      icon: <GitBranch size={15} />,
    },
    {
      key: "configs",
      label: t("scannersPage.evidenceConfigs"),
      found: configEvidence.length > 0,
      summary: t("scannersPage.itemsFound", { count: configEvidence.length }),
      details: configEvidence,
      icon: <Code2 size={15} />,
    },
  ];
}

function EvidenceAccordion({ item }: { item: EvidenceItem }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/30">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-white/[0.025]"
        aria-expanded={open}
      >
        <span
          className={[
            "grid size-8 shrink-0 place-items-center rounded-xl border",
            item.found
              ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-600",
          ].join(" ")}
        >
          {item.icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{item.label}</span>
          <span className="mt-0.5 block truncate text-xs text-neutral-600">{item.summary}</span>
        </span>

        {item.found ? (
          <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
        ) : (
          <XCircle size={15} className="shrink-0 text-neutral-700" />
        )}

        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={PANEL_TRANSITION}
          className="shrink-0 text-neutral-600"
        >
          <ChevronDown size={15} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={PAGE_TRANSITION}
            className="overflow-hidden"
          >
            <div className="border-t border-neutral-900 px-4 py-3">
              {item.details.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {item.details.map((detail) => (
                    <span
                      key={detail}
                      className="max-w-full truncate rounded-lg border border-neutral-900 bg-black/35 px-2.5 py-1.5 font-mono text-[11px] text-neutral-400"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-5 text-neutral-600">{item.summary}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function OverviewPanel({
  project,
  onRescanProject,
  isLoading,
  t,
}: {
  project: Project;
  onRescanProject: (project: Project) => void;
  isLoading: boolean;
  t: Translator;
}) {
  const signals = project.readinessReport.signals;
  const evidence = buildEvidenceItems(signals, t);
  const detected = evidence.filter((item) => item.found);
  const missing = evidence.filter((item) => !item.found);
  const status = getScanStatus(signals, t);

  return (
    <motion.div
      key={`scanner-overview-${project.id}`}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={PAGE_TRANSITION}
      className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("scannersPage.scanSummary")}
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">{status.label}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
              {status.description}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-neutral-900 bg-black/35 px-3 py-1.5 text-xs text-neutral-400">
            <StatusDot tone={status.tone} />
            {getScannerCoverage(project)}/9 {t("scannersPage.signalGroups")}
          </span>
        </div>

        {signals ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-300" />
                <h4 className="text-sm font-semibold text-white">{t("scannersPage.detected")}</h4>
              </div>
              <div className="space-y-2">
                {detected.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-neutral-400">{item.label}</span>
                    <span className="shrink-0 text-neutral-700">{item.summary}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={15} className="text-neutral-600" />
                <h4 className="text-sm font-semibold text-white">{t("scannersPage.needsReview")}</h4>
              </div>
              {missing.length > 0 ? (
                <div className="space-y-2">
                  {missing.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 text-xs text-neutral-500">
                      <XCircle size={13} className="shrink-0 text-neutral-700" />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-5 text-neutral-600">
                  {t("scannersPage.noMissingEvidence")}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-neutral-900 p-5 text-sm text-neutral-500">
            {t("scannersPage.noSignalsDescription")}
          </p>
        )}
      </section>

      <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
        <div className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          <RefreshCw size={15} />
        </div>
        <p className="cf-tech-label mt-4 text-[10px] uppercase text-neutral-600">
          {t("scannersPage.nextAction")}
        </p>
        <h3 className="mt-1 text-base font-semibold text-white">
          {t("scannersPage.keepScanCurrent")}
        </h3>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          {t("scannersPage.keepScanCurrentDescription")}
        </p>
        <Button
          variant="primary"
          disabled={isLoading}
          onClick={() => onRescanProject(project)}
          className="mt-5 w-full justify-center rounded-xl"
        >
          <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} />
          {isLoading ? t("common.scanning") : t("scannersPage.rescanProject")}
        </Button>
      </aside>
    </motion.div>
  );
}

function StructurePanel({ project, t }: { project: Project; t: Translator }) {
  const signals = project.readinessReport.signals;

  if (!signals) {
    return (
      <EmptyState
        icon={<FolderOpen size={20} />}
        title={t("scannersPage.noStructureTitle")}
        description={t("scannersPage.noSignalsDescription")}
      />
    );
  }

  const groups = [
    {
      label: t("scannersPage.structureSource"),
      count: signals.directories.filter((path) => /(^|\/)(src|app|server|client)(\/|$)/i.test(path)).length,
      items: signals.directories.filter((path) => /(^|\/)(src|app|server|client)(\/|$)/i.test(path)),
      icon: <FolderGit2 size={15} />,
    },
    {
      label: t("scannersPage.structureDocumentation"),
      count: signals.docs.length,
      items: signals.docs,
      icon: <FileText size={15} />,
    },
    {
      label: t("scannersPage.structureTests"),
      count: signals.testFiles.length + signals.testConfigs.length,
      items: [...signals.testConfigs, ...signals.testFiles],
      icon: <FileCode2 size={15} />,
    },
    {
      label: t("scannersPage.structureConfiguration"),
      count: signals.configs.length + signals.lockFiles.length,
      items: [...signals.configs, ...signals.lockFiles],
      icon: <Code2 size={15} />,
    },
  ];

  return (
    <motion.div
      key={`scanner-structure-${project.id}`}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={PAGE_TRANSITION}
      className="space-y-4"
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <CompactMetric
          label={t("scannersPage.filesScanned")}
          value={signals.inventory.totalFiles}
          caption={signals.inventory.truncated ? t("scannersPage.scanLimited") : t("scannersPage.scanComplete")}
        />
        <CompactMetric
          label={t("scannersPage.directoriesScanned")}
          value={signals.inventory.totalDirectories}
          caption={t("scannersPage.depth", { count: signals.inventory.maxDepth })}
        />
        <CompactMetric
          label={t("scannersPage.packageManifests")}
          value={signals.packageFiles.length}
          caption={signals.packageFiles[0] ?? t("scannersPage.notDetected")}
        />
        <CompactMetric
          label={t("scannersPage.configFiles")}
          value={signals.configs.length + signals.lockFiles.length}
          caption={t("scannersPage.configurationAndLocks")}
        />
      </section>

      <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
        <div className="mb-4">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("scannersPage.projectStructure")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">
            {t("scannersPage.detectedDirectories")}
          </h3>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((group) => (
            <article key={group.label} className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-white">
                  <span className="text-neutral-500">{group.icon}</span>
                  <span className="truncate">{group.label}</span>
                </div>
                <span className="cf-badge">{group.count}</span>
              </div>

              {group.items.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {group.items.slice(0, 8).map((item) => (
                    <span
                      key={item}
                      className="max-w-full truncate rounded-lg border border-neutral-900 px-2.5 py-1.5 font-mono text-[11px] text-neutral-500"
                    >
                      {item}
                    </span>
                  ))}
                  {group.items.length > 8 && <span className="cf-badge">+{group.items.length - 8}</span>}
                </div>
              ) : (
                <p className="text-xs text-neutral-700">{t("scannersPage.notDetected")}</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </motion.div>
  );
}

function ToolsPanel({ project, t }: { project: Project; t: Translator }) {
  const signals = project.readinessReport.signals;
  const commandRows = signals
    ? [
        [t("scannersPage.commandDev"), signals.commands.dev],
        [t("scannersPage.commandBuild"), signals.commands.build],
        [t("scannersPage.commandTest"), signals.commands.test],
        [t("scannersPage.commandTypecheck"), signals.commands.typecheck],
        [t("scannersPage.commandLint"), signals.commands.lint],
      ]
    : [];

  return (
    <motion.div
      key={`scanner-tools-${project.id}`}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={PAGE_TRANSITION}
      className="grid gap-4 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
    >
      <section className="space-y-4">
        <div className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("scannersPage.detectedStack")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">
            {t("scannersPage.frameworksAndLanguages")}
          </h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {project.detectedStack.length > 0 ? (
              project.detectedStack.map((item) => <span key={item} className="cf-badge">{item}</span>)
            ) : (
              <span className="text-sm text-neutral-600">{t("scannersPage.notDetected")}</span>
            )}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("scannersPage.packageManager")}
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {project.packageManager ?? t("scannersPage.notDetected")}
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            {signals?.packageFiles.join(" · ") || t("scannersPage.noPackageManifest")}
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("scannersPage.configuration")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...(signals?.configs ?? []), ...(signals?.lockFiles ?? [])].length > 0 ? (
              [...(signals?.configs ?? []), ...(signals?.lockFiles ?? [])]
                .slice(0, 10)
                .map((item) => <span key={item} className="cf-badge">{item}</span>)
            ) : (
              <span className="text-sm text-neutral-600">{t("scannersPage.notDetected")}</span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("scannersPage.projectCommands")}
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {t("scannersPage.commandsDetected", { count: getDetectedCommandCount(signals) })}
            </h3>
          </div>
          <TerminalSquare size={18} className="text-neutral-600" />
        </div>

        {signals ? (
          <div className="space-y-2">
            {commandRows.map(([label, command]) => (
              <div
                key={String(label)}
                className="flex items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3"
              >
                {command ? (
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
                ) : (
                  <XCircle size={15} className="shrink-0 text-neutral-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-neutral-300">{label}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-neutral-600">
                    {command ?? t("scannersPage.notDetected")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-600">{t("scannersPage.noSignalsDescription")}</p>
        )}
      </section>
    </motion.div>
  );
}

function SignalsPanel({ project, t }: { project: Project; t: Translator }) {
  const evidence = buildEvidenceItems(project.readinessReport.signals, t);

  if (evidence.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={20} />}
        title={t("scannersPage.noSignalsTitle")}
        description={t("scannersPage.noSignalsDescription")}
      />
    );
  }

  return (
    <motion.section
      key={`scanner-signals-${project.id}`}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={PAGE_TRANSITION}
      className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("scannersPage.scannerEvidence")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">
            {t("scannersPage.evidenceDescription")}
          </h3>
        </div>
        <span className="cf-badge">
          {evidence.filter((item) => item.found).length}/{evidence.length}{" "}
          {t("scannersPage.detectedShort")}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {evidence.map((item) => <EvidenceAccordion key={item.key} item={item} />)}
      </div>
    </motion.section>
  );
}

export function ScannersPage({
  projects,
  isLoading,
  onAddProject,
  onRescanProject,
}: ScannersPageProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<ScannerLens>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects[0]?.id ?? null,
  );
  const [view, setView] = useState<ScannerView>("overview");

  const lensOptions = useMemo(
    () => [
      {
        value: "all" as const,
        label: t("scannersPage.filterAll"),
        description: t("scannersPage.filterAllDescription"),
      },
      {
        value: "withSignals" as const,
        label: t("scannersPage.filterScanned"),
        description: t("scannersPage.filterScannedDescription"),
      },
      {
        value: "missingTests" as const,
        label: t("scannersPage.filterMissingTests"),
        description: t("scannersPage.filterMissingTestsDescription"),
      },
      {
        value: "missingCi" as const,
        label: t("scannersPage.filterMissingCi"),
        description: t("scannersPage.filterMissingCiDescription"),
      },
    ],
    [t],
  );

  const viewOptions = useMemo(
    () => [
      { value: "overview" as const, label: t("scannersPage.viewOverview"), icon: Boxes },
      { value: "structure" as const, label: t("scannersPage.viewStructure"), icon: FolderGit2 },
      { value: "tools" as const, label: t("scannersPage.viewTools"), icon: TerminalSquare },
      { value: "signals" as const, label: t("scannersPage.viewSignals"), icon: ShieldCheck },
    ],
    [t],
  );

  const filteredProjects = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    return projects.filter((project) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        normalize([project.name, project.localPath, ...project.detectedStack].join(" ")).includes(
          normalizedQuery,
        );

      const matchesLens =
        lens === "all" ||
        (lens === "withSignals" && Boolean(project.readinessReport.signals)) ||
        (lens === "missingTests" && !hasTestEvidence(project)) ||
        (lens === "missingCi" && !hasCiEvidence(project));

      return matchesQuery && matchesLens;
    });
  }, [lens, projects, query]);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null);
      return;
    }

    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (
      filteredProjects.length > 0 &&
      !filteredProjects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(filteredProjects[0].id);
    }
  }, [filteredProjects, selectedProjectId]);

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedSignals = selectedProject?.readinessReport.signals;

  const projectsWithSignals = projects.filter((project) => project.readinessReport.signals).length;
  const projectsMissingTests = projects.filter((project) => !hasTestEvidence(project)).length;

  if (isLoading && projects.length === 0) {
    return <ScannerSkeleton />;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<ScanSearch size={22} />}
        title={t("scannersPage.emptyTitle")}
        description={t("scannersPage.emptyDescription")}
        action={
          <Button variant="primary" onClick={onAddProject}>
            <FolderOpen size={15} />
            {t("common.addProject")}
          </Button>
        }
      />
    );
  }

  return (
    <section className="space-y-4 pb-4">
      <WorkspacePageHeader
        icon={<ScanSearch size={18} />}
        eyebrow={t("scannersPage.eyebrow")}
        title={t("scannersPage.title")}
        description={t("scannersPage.description")}
        aside={
          <div className="grid w-full grid-cols-3 gap-2 xl:min-w-[380px]">
            <CompactMetric
              label={t("scannersPage.projects")}
              value={projects.length}
              caption={t("scannersPage.localProjects")}
            />
            <CompactMetric
              label={t("scannersPage.scanned")}
              value={projectsWithSignals}
              caption={t("scannersPage.withEvidence")}
            />
            <CompactMetric
              label={t("scannersPage.missingTests")}
              value={projectsMissingTests}
              caption={t("scannersPage.verificationGap")}
            />
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("scannersPage.projectScans")}
              </p>
              <h3 className="mt-1 text-sm font-semibold text-white">
                {t("scannersPage.chooseProject")}
              </h3>
            </div>
            <span className="cf-badge">{filteredProjects.length}</span>
          </div>

          <label className="flex h-10 items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 text-neutral-500 focus-within:border-neutral-700 focus-within:text-white">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("scannersPage.searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
            />
          </label>

          <HorizontalSlidingSelector
            items={lensOptions}
            activeIndex={lensOptions.findIndex((option) => option.value === lens)}
            getItemKey={(option) => option.value}
            onSelect={(option) => setLens(option.value)}
            ariaLabel={t("scannersPage.filterAria")}
            className="mt-3"
            itemClassName="px-1.5 py-2.5"
            renderItem={(option) => (
              <span className="block min-w-0 text-center">
                <span className="block truncate text-[10px] font-medium">{option.label}</span>
              </span>
            )}
          />

          <div className="mt-4">
            {filteredProjects.length > 0 ? (
              <VerticalSlidingSelector
                items={filteredProjects}
                activeIndex={filteredProjects.findIndex(
                  (project) => project.id === selectedProject?.id,
                )}
                itemHeight={PROJECT_ITEM_HEIGHT}
                itemGap={PROJECT_ITEM_GAP}
                getItemKey={(project) => project.id}
                onSelect={(project) => setSelectedProjectId(project.id)}
                ariaLabel={t("scannersPage.projectsAria")}
                itemSurfaceClassName="rounded-2xl border border-neutral-900 bg-black/30"
                indicatorClassName="rounded-2xl border border-white shadow-[0_16px_40px_rgba(255,255,255,0.1)]"
                itemClassName="overflow-hidden rounded-2xl px-3 py-2.5"
                renderItem={(project, isSelected) => (
                  <ProjectScanListItem project={project} isSelected={isSelected} t={t} />
                )}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-neutral-900 p-4 text-sm leading-6 text-neutral-600">
                {t("scannersPage.noFilterResults")}
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {selectedProject ? (
            <>
              <section className="min-h-[188px] overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
                <motion.div
                  key={`scanner-project-content-${selectedProject.id}`}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={PAGE_TRANSITION}
                >
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                        <FileSearch size={17} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-semibold tracking-[-0.03em] text-white">
                          {selectedProject.name}
                        </h3>
                        <p className="mt-1 truncate text-xs text-neutral-600">
                          {selectedProject.localPath}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="cf-badge">
                            {getScanStatus(selectedSignals, t).label}
                          </span>
                          {selectedSignals?.inventory.truncated && (
                            <span className="cf-badge">
                              {t("scannersPage.scanLimited")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="primary"
                      disabled={isLoading}
                      onClick={() => onRescanProject(selectedProject)}
                      className="justify-center rounded-xl"
                    >
                      <RefreshCw
                        size={15}
                        className={isLoading ? "animate-spin" : ""}
                      />
                      {isLoading
                        ? t("common.scanning")
                        : t("scannersPage.rescanProject")}
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <CompactMetric
                      label={t("scannersPage.lastScan")}
                      value={formatRelativeDate(selectedProject.lastScanAt, t)}
                      caption={formatFullDate(
                        selectedProject.lastScanAt,
                        i18n.language,
                      )}
                    />
                    <CompactMetric
                      label={t("scannersPage.filesScanned")}
                      value={selectedSignals?.inventory.totalFiles ?? 0}
                      caption={t("scannersPage.scanInventory")}
                    />
                    <CompactMetric
                      label={t("scannersPage.directoriesScanned")}
                      value={selectedSignals?.inventory.totalDirectories ?? 0}
                      caption={t("scannersPage.detectedStructure")}
                    />
                    <CompactMetric
                      label={t("scannersPage.signalCoverage")}
                      value={`${getScannerCoverage(selectedProject)}/9`}
                      caption={t("scannersPage.evidenceGroups")}
                    />
                  </div>
                </motion.div>
              </section>

              <HorizontalSlidingSelector
                items={viewOptions}
                activeIndex={viewOptions.findIndex((option) => option.value === view)}
                getItemKey={(option) => option.value}
                onSelect={(option) => setView(option.value)}
                ariaLabel={t("scannersPage.viewsAria")}
                itemClassName="px-3 py-2.5"
                indicatorClassName="shadow-[0_14px_36px_rgba(255,255,255,0.18)]"
                renderItem={(option, isActive) => {
                  const Icon = option.icon;
                  return (
                    <motion.span
                      animate={{
                        scale: isActive ? 1 : 0.985,
                        y: isActive ? 0 : 1,
                      }}
                      transition={PANEL_TRANSITION}
                      className="flex items-center justify-center gap-2 text-xs font-medium"
                    >
                      <motion.span
                        animate={{
                          rotate: isActive ? 0 : -4,
                          scale: isActive ? 1.06 : 0.94,
                        }}
                        transition={PANEL_TRANSITION}
                        className="flex"
                      >
                        <Icon size={14} />
                      </motion.span>
                      <motion.span
                        animate={{ opacity: isActive ? 1 : 0.72 }}
                        transition={{ duration: 0.16 }}
                      >
                        {option.label}
                      </motion.span>
                    </motion.span>
                  );
                }}
              />

              <AnimatePresence mode="wait" initial={false}>
                {view === "overview" && (
                  <OverviewPanel
                    key="overview"
                    project={selectedProject}
                    onRescanProject={onRescanProject}
                    isLoading={isLoading}
                    t={t}
                  />
                )}
                {view === "structure" && (
                  <StructurePanel key="structure" project={selectedProject} t={t} />
                )}
                {view === "tools" && (
                  <ToolsPanel key="tools" project={selectedProject} t={t} />
                )}
                {view === "signals" && (
                  <SignalsPanel key="signals" project={selectedProject} t={t} />
                )}
              </AnimatePresence>
            </>
          ) : (
            <EmptyState
              icon={<CircleDot size={20} />}
              title={t("scannersPage.noProjectSelected")}
              description={t("scannersPage.noProjectSelectedDescription")}
            />
          )}
        </main>
      </div>
    </section>
  );
}
