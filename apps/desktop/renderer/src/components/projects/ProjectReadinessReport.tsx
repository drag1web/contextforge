import {
  CheckCircle2,
  CircleDot,
  Code2,
  FileCode2,
  FileText,
  FolderGit2,
  GitBranch,
  KeyRound,
  Package,
  ShieldCheck,
  TerminalSquare,
  XCircle
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ReadinessReport, ScannerSignals } from "../../types";

interface ProjectReadinessReportProps {
  report: ReadinessReport;
}

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
  const { t } = useTranslation();
  const passedChecks = report.checks.filter((check) => check.passed).length;

  return (
    <div className="mt-5 overflow-hidden border-t border-neutral-900 pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="cf-tech-label mb-1 text-[10px] uppercase text-neutral-600">
            {t("projectsPage.report")}
          </p>

          <p className="text-sm text-neutral-500">
            {t("projectsPage.checksPassed", {
              passed: passedChecks,
              total: report.checks.length
            })}
          </p>
        </div>

        <span className="cf-badge">
          {report.issues.length > 0
            ? t("projectsPage.issuesCount", { count: report.issues.length })
            : t("projectsPage.noMajorIssues")}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {report.checks.map((check) => (
          <div
            key={check.key}
            className="rounded-2xl border border-neutral-900 bg-black/40 p-4 transition duration-200 hover:border-neutral-800 hover:bg-black/45"
          >
            <div className="flex items-start gap-3">
              {check.passed ? (
                <CheckCircle2 size={16} className="mt-0.5 text-emerald-300" />
              ) : (
                <XCircle size={16} className="mt-0.5 text-neutral-600" />
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-white">
                    {check.label}
                  </p>

                  <span className="shrink-0 text-xs text-neutral-600">
                    {check.passed ? `+${check.points}` : `0/${check.points}`}
                  </span>
                </div>

                <p className="mt-1 text-sm leading-5 text-neutral-500">
                  {check.message}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ProjectScannerSignalsPanel signals={report.signals} compact />

      {report.issues.length > 0 && (
        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
          <p className="cf-tech-label mb-3 text-[10px] uppercase text-neutral-600">
            {t("projectsPage.recommendedImprovements")}
          </p>

          <ul className="space-y-2">
            {report.issues.map((issue) => (
              <li key={issue} className="text-sm leading-5 text-neutral-500">
                • {issue}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
