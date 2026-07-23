import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Code2,
  FileCode2,
  FileText,
  FolderGit2,
  GitBranch,
  KeyRound,
  ListChecks,
  Package,
  ScanSearch,
  ShieldCheck,
  TerminalSquare,
  XCircle
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ReadinessReport, ScannerSignals } from "../../types";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";

interface ProjectReadinessReportProps {
  report: ReadinessReport;
}

type ReadinessView = "priorities" | "checks" | "scanner";

const READINESS_VIEWS = [
  {
    id: "priorities" as const,
    label: "Priorities",
    caption: "What needs attention first",
    icon: AlertTriangle
  },
  {
    id: "checks" as const,
    label: "Checks",
    caption: "All readiness criteria",
    icon: ListChecks
  },
  {
    id: "scanner" as const,
    label: "Scanner",
    caption: "Detected project evidence",
    icon: ScanSearch
  }
] as const;

type SignalTone = "success" | "warning" | "muted";

type SignalItem = {
  label: string;
  value?: string | null;
  passed?: boolean;
};

function limitedItems(items: string[], limit = 5) {
  return {
    visible: items.slice(0, limit),
    hiddenCount: Math.max(0, items.length - limit)
  };
}

function SignalBadge({ children, tone = "muted" }: { children: ReactNode; tone?: SignalTone }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "warning"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : "border-neutral-800 bg-black/35 text-neutral-400";

  return (
    <span className={["inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px]", toneClass].join(" ")}>
      {children}
    </span>
  );
}

function SignalCard({
  icon,
  title,
  description,
  children
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="group rounded-2xl border border-neutral-900 bg-black/35 p-4 transition duration-200 hover:border-neutral-800 hover:bg-black/45">
      <div className="mb-3 flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300 transition duration-200 group-hover:border-neutral-700 group-hover:text-white">
          {icon}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-neutral-600">{description}</p>
        </div>
      </div>

      {children}
    </div>
  );
}

function SignalList({
  items,
  emptyLabel,
  limit = 5
}: {
  items: string[];
  emptyLabel: string;
  limit?: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-600">{emptyLabel}</p>;
  }

  const { visible, hiddenCount } = limitedItems(items, limit);

  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((item) => (
        <SignalBadge key={item}>{item}</SignalBadge>
      ))}

      {hiddenCount > 0 && <SignalBadge>+{hiddenCount}</SignalBadge>}
    </div>
  );
}

function SignalRows({ items }: { items: SignalItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-neutral-300">{item.label}</p>
            {item.value && <p className="mt-0.5 truncate text-xs text-neutral-600">{item.value}</p>}
          </div>

          {typeof item.passed === "boolean" && (
            <span className="shrink-0 pt-0.5">
              {item.passed ? (
                <CheckCircle2 size={14} className="text-emerald-300" />
              ) : (
                <XCircle size={14} className="text-neutral-700" />
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProjectScannerSignalsPanel({
  signals,
  compact = false
}: {
  signals?: ScannerSignals;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (!signals) {
    return (
      <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-4">
        <p className="cf-tech-label mb-2 text-[10px] uppercase text-neutral-600">
          {t("projectsPage.detectedSignals")}
        </p>
        <p className="text-sm leading-5 text-neutral-500">
          {t("projectsPage.rescanForSignals")}
        </p>
      </div>
    );
  }

  const commands = signals.commands;
  const commandRows: SignalItem[] = [
    { label: t("projectsPage.signalDev"), value: commands.dev ?? t("projectsPage.notDetected"), passed: Boolean(commands.dev) },
    { label: t("projectsPage.signalBuild"), value: commands.build ?? t("projectsPage.notDetected"), passed: Boolean(commands.build) },
    { label: t("projectsPage.signalTest"), value: commands.test ?? t("projectsPage.notDetected"), passed: Boolean(commands.test) },
    { label: t("projectsPage.signalTypecheck"), value: commands.typecheck ?? t("projectsPage.notDetected"), passed: Boolean(commands.typecheck) },
    { label: t("projectsPage.signalLint"), value: commands.lint ?? t("projectsPage.notDetected"), passed: Boolean(commands.lint) }
  ];

  const testItems = [...signals.testConfigs, ...signals.testFiles];
  const inventoryLabel = t("projectsPage.inventorySummary", {
    files: signals.inventory.totalFiles,
    directories: signals.inventory.totalDirectories
  });

  if (compact) {
    const detectedCommandCount = commandRows.filter((item) => item.passed).length;
    const testEvidenceCount = signals.testFiles.length + signals.testConfigs.length;
    const compactSignals = [
      {
        label: "Packages",
        value: signals.packageFiles.length,
        hint: signals.packageFiles[0] ?? "No package manifest",
        tone: signals.packageFiles.length > 0 ? "success" : "muted"
      },
      {
        label: "Commands",
        value: `${detectedCommandCount}/5`,
        hint: commandRows.filter((item) => item.passed).map((item) => item.label).join(" · ") || "No commands detected",
        tone: detectedCommandCount >= 2 ? "success" : "warning"
      },
      {
        label: "Tests",
        value: testEvidenceCount,
        hint: signals.commands.test ? `Script: ${signals.commands.test}` : testEvidenceCount > 0 ? "Evidence found" : "Not detected",
        tone: signals.commands.test || testEvidenceCount > 0 ? "success" : "muted"
      },
      {
        label: "CI",
        value: signals.ciFiles.length,
        hint: signals.ciFiles[0] ?? "Optional for local MVP",
        tone: signals.ciFiles.length > 0 ? "success" : "muted"
      }
    ] as const;

    return (
      <div className="mt-4 rounded-[1.35rem] border border-neutral-900 bg-black/30 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="cf-tech-label mb-1 text-[10px] uppercase text-neutral-600">
              Scanner snapshot
            </p>
            <p className="text-sm leading-5 text-neutral-500">
              Compact scanner evidence. Open the Scanners page for the full signal breakdown.
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <SignalBadge tone={signals.inventory.truncated ? "warning" : "success"}>
              <ShieldCheck size={12} />
              {signals.inventory.truncated ? t("projectsPage.scanLimited") : t("projectsPage.scanComplete")}
            </SignalBadge>
            <SignalBadge>{inventoryLabel}</SignalBadge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {compactSignals.map((item) => (
            <div key={item.label} className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-neutral-300">{item.label}</p>
                <SignalBadge tone={item.tone as SignalTone}>{item.value}</SignalBadge>
              </div>
              <p className="truncate text-xs text-neutral-600">{item.hint}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-[1.35rem] border border-neutral-900 bg-black/30 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="cf-tech-label mb-1 text-[10px] uppercase text-neutral-600">
            {t("projectsPage.detectedSignals")}
          </p>
          <p className="text-sm leading-5 text-neutral-500">
            {t("projectsPage.detectedSignalsDescription")}
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <SignalBadge tone={signals.inventory.truncated ? "warning" : "success"}>
            <ShieldCheck size={12} />
            {signals.inventory.truncated ? t("projectsPage.scanLimited") : t("projectsPage.scanComplete")}
          </SignalBadge>
          <SignalBadge>{inventoryLabel}</SignalBadge>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SignalCard
          icon={<Package size={16} />}
          title={t("projectsPage.signalPackages")}
          description={t("projectsPage.signalPackagesDesc", { count: signals.packageFiles.length })}
        >
          <SignalList items={signals.packageFiles} emptyLabel={t("projectsPage.noPackagesDetected")} />
        </SignalCard>

        <SignalCard
          icon={<TerminalSquare size={16} />}
          title={t("projectsPage.signalCommands")}
          description={t("projectsPage.signalCommandsDesc")}
        >
          <SignalRows items={commandRows} />
        </SignalCard>

        <SignalCard
          icon={<FileText size={16} />}
          title={t("projectsPage.signalDocs")}
          description={t("projectsPage.signalDocsDesc", { count: signals.docs.length })}
        >
          <SignalList items={signals.docs} emptyLabel={t("projectsPage.noDocsDetected")} />
        </SignalCard>

        <SignalCard
          icon={<FileCode2 size={16} />}
          title={t("projectsPage.signalTests")}
          description={t("projectsPage.signalTestsDesc", {
            files: signals.testFiles.length,
            configs: signals.testConfigs.length
          })}
        >
          <SignalList items={testItems} emptyLabel={t("projectsPage.noTestsDetected")} />
        </SignalCard>

        <SignalCard
          icon={<KeyRound size={16} />}
          title={t("projectsPage.signalEnvironment")}
          description={t("projectsPage.signalEnvironmentDesc")}
        >
          <SignalList items={signals.envExamples} emptyLabel={t("projectsPage.noEnvDetected")} />
        </SignalCard>

        <SignalCard
          icon={<GitBranch size={16} />}
          title={t("projectsPage.signalCi")}
          description={t("projectsPage.signalCiDesc")}
        >
          <SignalList items={signals.ciFiles} emptyLabel={t("projectsPage.noCiDetected")} />
        </SignalCard>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-neutral-900 bg-black/25 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <Code2 size={15} />
            {t("projectsPage.signalConfigs")}
          </div>
          <SignalList items={[...signals.configs, ...signals.lockFiles]} emptyLabel={t("projectsPage.noConfigsDetected")} limit={6} />
        </div>

        <div className="rounded-2xl border border-neutral-900 bg-black/25 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <FolderGit2 size={15} />
            {t("projectsPage.signalStructure")}
          </div>
          <SignalList items={signals.directories} emptyLabel={t("projectsPage.noStructureDetected")} limit={6} />
        </div>
      </div>

      {signals.inventory.truncated && (
        <div className="mt-3 rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4 text-sm leading-5 text-amber-100/80">
          <div className="mb-1 flex items-center gap-2 font-medium text-amber-100">
            <CircleDot size={14} />
            {t("projectsPage.scanLimitedTitle")}
          </div>
          {t("projectsPage.scanLimitedDescription", {
            depth: signals.inventory.maxDepth,
            entries: signals.inventory.maxEntries
          })}
        </div>
      )}
    </div>
  );
}

export function ProjectReadinessReport({ report }: ProjectReadinessReportProps) {
  const [activeView, setActiveView] = useState<ReadinessView>("priorities");
  const passedChecks = report.checks.filter((check) => check.passed);
  const failedChecks = report.checks.filter((check) => !check.passed);
  const activeViewIndex = READINESS_VIEWS.findIndex((view) => view.id === activeView);

  useEffect(() => {
    setActiveView("priorities");
  }, [report.score, report.checks.length, report.issues.length]);

  const issueItems = report.issues.map((issue) => ({
    key: `issue-${issue}`,
    title: issue,
    caption: "Recommended improvement",
    points: null as number | null
  }));

  const failedCheckItems = failedChecks.map((check) => ({
    key: `check-${check.key}`,
    title: check.label,
    caption: check.message,
    points: check.points
  }));

  const priorityItems = [...issueItems, ...failedCheckItems].filter(
    (item, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.title.trim().toLowerCase() === item.title.trim().toLowerCase()
      ) === index
  );

  const renderCheckRows = (checks: ReadinessReport["checks"]) => (
    <div className="divide-y divide-neutral-900">
      {checks.map((check) => (
        <article key={check.key} className="flex min-w-0 items-start gap-3 px-4 py-3.5">
          <span className="mt-0.5 shrink-0">
            {check.passed ? (
              <CheckCircle2 size={15} className="text-emerald-300" />
            ) : (
              <XCircle size={15} className="text-neutral-600" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-neutral-200">{check.label}</p>
              <span className="shrink-0 text-xs text-neutral-600">
                {check.passed ? `+${check.points}` : `0/${check.points}`}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-neutral-600">{check.message}</p>
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div>
      <HorizontalSlidingSelector
        items={READINESS_VIEWS}
        activeIndex={activeViewIndex}
        getItemKey={(view) => view.id}
        onSelect={(view) => setActiveView(view.id)}
        ariaLabel="Readiness evidence view"
        className="rounded-[1.2rem]"
        itemClassName="min-h-[58px] px-4 py-2"
        renderItem={(view, isActive) => {
          const Icon = view.icon;

          return (
            <span className="flex min-w-0 items-center justify-center gap-3 text-left">
              <span
                className={[
                  "grid size-8 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                  isActive
                    ? "border-black/10 bg-black/[0.045] text-black"
                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:text-white"
                ].join(" ")}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{view.label}</span>
                <span className={isActive ? "block truncate text-xs text-black/50" : "block truncate text-xs text-neutral-700"}>
                  {view.caption}
                </span>
              </span>
            </span>
          );
        }}
      />

      {activeView === "priorities" && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label mb-1 text-[10px] uppercase text-neutral-600">
                Next priorities
              </p>
              <p className="text-sm text-neutral-500">
                {priorityItems.length > 0
                  ? "Focus on these gaps before broad implementation work."
                  : "No major readiness gaps were detected."}
              </p>
            </div>

            <span className="cf-badge">
              {priorityItems.length > 0
                ? `${priorityItems.length} attention item${priorityItems.length === 1 ? "" : "s"}`
                : "Ready for scoped work"}
            </span>
          </div>

          {priorityItems.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
              {priorityItems.map((item, index) => (
                <article
                  key={item.key}
                  className={[
                    "flex min-w-0 items-start gap-3 px-4 py-3.5",
                    index > 0 ? "border-t border-neutral-900" : ""
                  ].join(" ")}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-[11px] text-neutral-500">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-neutral-200">{item.title}</p>
                      {item.points !== null && (
                        <span className="shrink-0 text-xs text-neutral-600">0/{item.points}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">{item.caption}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4 text-sm leading-6 text-emerald-100/75">
              All readiness checks passed or no actionable gaps were reported. Continue with a focused Task Pack.
            </div>
          )}
        </div>
      )}

      {activeView === "checks" && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">Needs attention</p>
                <p className="mt-0.5 text-xs text-neutral-600">Failed readiness criteria</p>
              </div>
              <SignalBadge tone={failedChecks.length > 0 ? "warning" : "success"}>
                {failedChecks.length}
              </SignalBadge>
            </div>
            {failedChecks.length > 0 ? (
              renderCheckRows(failedChecks)
            ) : (
              <p className="px-4 py-5 text-sm text-neutral-600">No failed checks.</p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">Passed</p>
                <p className="mt-0.5 text-xs text-neutral-600">Verified project capabilities</p>
              </div>
              <SignalBadge tone="success">{passedChecks.length}</SignalBadge>
            </div>
            {passedChecks.length > 0 ? (
              renderCheckRows(passedChecks)
            ) : (
              <p className="px-4 py-5 text-sm text-neutral-600">No checks have passed yet.</p>
            )}
          </section>
        </div>
      )}

      {activeView === "scanner" && (
        <ProjectScannerSignalsPanel signals={report.signals} compact />
      )}
    </div>
  );
}
