import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileSearch,
  FolderOpen,
  Gauge,
  PackageSearch,
  RefreshCw,
  ScanSearch,
  Search,
  ShieldCheck,
  WandSparkles,
  XCircle
} from "lucide-react";

import type { Project, ReadinessCheck } from "../types";
import { Button } from "../components/ui/Button";
import {
  HorizontalSlidingSelector,
  VerticalSlidingSelector
} from "../components/ui/SlidingSelectors";
import { ProjectScannerSignalsPanel } from "../components/projects/ProjectReadinessReport";

type ScannerLens = "all" | "withSignals" | "missingTests" | "missingCi";

interface ScannersPageProps {
  projects: Project[];
  isLoading: boolean;
  onAddProject: () => void;
  onRescanProject: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
}

const SCANNER_LENS_OPTIONS: Array<{
  value: ScannerLens;
  label: string;
  description: string;
}> = [
  {
    value: "all",
    label: "All scans",
    description: "Every project"
  },
  {
    value: "withSignals",
    label: "Has signals",
    description: "Fresh scanner data"
  },
  {
    value: "missingTests",
    label: "Missing tests",
    description: "No test evidence"
  },
  {
    value: "missingCi",
    label: "Missing CI",
    description: "Optional signal"
  }
];

const PAGE_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1]
} as const;

const SCANNER_SWITCH_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.58
} as const;

const SCANNER_PROJECT_ITEM_HEIGHT = 90;
const SCANNER_PROJECT_ITEM_GAP = 10;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function formatDate(value: string | null) {
  if (!value) return "Never scanned";
  return new Date(value).toLocaleString();
}

function getReadinessLabel(score: number) {
  if (score >= 80) return "Ready";
  if (score >= 50) return "Needs polish";
  return "Needs attention";
}

function getScoreFillClass(score: number, isSelected = false) {
  if (score >= 80) return "cf-health-fill-success";
  if (score >= 50) return isSelected ? "cf-health-fill-selected" : "cf-health-fill-warning";
  return "cf-health-fill-danger";
}

function getScoreWidth(score: number) {
  return `${Math.max(4, Math.min(100, score))}%`;
}

function hasTestEvidence(project: Project) {
  const signals = project.readinessReport.signals;
  return Boolean(
    project.readinessReport.checks.find((check) => check.key === "test-script")?.passed ||
      project.readinessReport.checks.find((check) => check.key === "tests")?.passed ||
      signals?.commands.test ||
      signals?.testConfigs.length ||
      signals?.testFiles.length
  );
}

function hasCiEvidence(project: Project) {
  return Boolean(project.readinessReport.signals?.ciFiles.length);
}

function hasScannerSignals(project: Project) {
  return Boolean(project.readinessReport.signals);
}

function getScannerCoverage(project: Project) {
  const signals = project.readinessReport.signals;

  if (!signals) {
    return 0;
  }

  const buckets = [
    signals.packageFiles.length > 0,
    Boolean(signals.commands.dev),
    Boolean(signals.commands.build),
    Boolean(signals.commands.test),
    signals.docs.length > 0,
    signals.envExamples.length > 0,
    signals.testFiles.length + signals.testConfigs.length > 0,
    signals.ciFiles.length > 0,
    signals.configs.length + signals.lockFiles.length > 0
  ];

  return buckets.filter(Boolean).length;
}

function getPassedChecks(project: Project) {
  return project.readinessReport.checks.filter((check) => check.passed).length;
}

function ScannerMetricTile({
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
    <article className="rounded-[1.15rem] border border-neutral-900 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="grid size-8 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </div>
        <p className="cf-display-font text-2xl font-semibold leading-none text-white">{value}</p>
      </div>
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{label}</p>
      <p className="mt-1 truncate text-xs text-neutral-500">{caption}</p>
    </article>
  );
}

function ScannerHealthSummary({
  projectCount,
  projectsWithSignals,
  missingTests,
  missingCi,
  avgCoverage
}: {
  projectCount: number;
  projectsWithSignals: number;
  missingTests: number;
  missingCi: number;
  avgCoverage: number;
}) {
  return (
    <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Scanner health</p>
          <p className="mt-1 text-base font-semibold text-white">Workspace signal summary</p>
        </div>
        <span className="cf-badge">avg {avgCoverage}/9</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ScannerMetricTile
          icon={<PackageSearch size={16} />}
          label="Projects"
          value={projectCount}
          caption="available scans"
        />
        <ScannerMetricTile
          icon={<ShieldCheck size={16} />}
          label="With signals"
          value={projectsWithSignals}
          caption="scanner data found"
        />
        <ScannerMetricTile
          icon={<AlertTriangle size={16} />}
          label="Missing tests"
          value={missingTests}
          caption="verification gap"
        />
        <ScannerMetricTile
          icon={<Gauge size={16} />}
          label="Missing CI"
          value={missingCi}
          caption="optional signal"
        />
      </div>
    </div>
  );
}

function ReadinessCheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-start gap-3">
        {check.passed ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
        ) : (
          <XCircle size={16} className="mt-0.5 shrink-0 text-neutral-600" />
        )}
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-white">{check.label}</p>
            <span className="text-xs text-neutral-600">
              {check.passed ? `+${check.points}` : `0/${check.points}`}
            </span>
          </div>
          <p className="text-sm leading-5 text-neutral-500">{check.message}</p>
        </div>
      </div>
    </div>
  );
}

function ScannerSkeleton() {
  return (
    <section className="space-y-5" aria-busy="true">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">Scanners</span>
          <span className="cf-badge">Loading evidence</span>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            <div className="h-9 max-w-3xl animate-pulse rounded-2xl bg-white/10" />
            <div className="mt-3 h-5 max-w-2xl animate-pulse rounded-full bg-white/5" />
            <div className="mt-2 h-5 max-w-xl animate-pulse rounded-full bg-white/5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-[1.15rem] border border-neutral-900 bg-white/[0.035]" />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="cf-card p-5">
          <div className="mb-4 h-16 animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="mb-4 h-11 animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="mb-4 h-14 animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-[1.35rem] border border-neutral-900 bg-white/[0.035]" />
            ))}
          </div>
        </aside>
        <main className="space-y-5">
          <div className="h-44 animate-pulse rounded-[1.35rem] border border-neutral-900 bg-white/[0.035]" />
          <div className="h-72 animate-pulse rounded-[1.35rem] border border-neutral-900 bg-white/[0.035]" />
        </main>
      </div>
    </section>
  );
}

function AnimatedHealthBar({ score, isSelected = false }: { score: number; isSelected?: boolean }) {
  return (
    <div className={isSelected ? "cf-health-track cf-health-track-selected" : "cf-health-track"}>
      <motion.div
        className={["cf-health-fill", getScoreFillClass(score, isSelected)].join(" ")}
        initial={false}
        animate={{ width: getScoreWidth(score) }}
        transition={SCANNER_SWITCH_TRANSITION}
      />
    </div>
  );
}

function ProjectScanListItem({
  project,
  isSelected
}: {
  project: Project;
  isSelected: boolean;
}) {
  const signals = project.readinessReport.signals;

  return (
    <>
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute inset-0 rounded-[1.35rem] border transition-colors duration-150",
          isSelected
            ? "border-transparent"
            : "border-transparent group-hover:border-neutral-800 group-hover:bg-black/15"
        ].join(" ")}
      />

      <span className="relative z-10 block">
        <span className="mb-2 flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="mb-1 flex items-center gap-2">
              <span
                className={[
                  "truncate text-sm font-semibold transition-colors duration-150",
                  isSelected ? "text-black" : "text-white group-hover:text-white"
                ].join(" ")}
              >
                {project.name}
              </span>
              {signals?.inventory.truncated && (
                <AlertTriangle
                  size={13}
                  className={isSelected ? "text-black/60" : "text-amber-200"}
                />
              )}
            </span>
            <span
              className={[
                "block truncate text-xs transition-colors duration-150",
                isSelected
                  ? "text-black/55"
                  : "text-neutral-600 group-hover:text-neutral-500"
              ].join(" ")}
            >
              {project.localPath}
            </span>
          </span>

          <span
            className={[
              "cf-display-font text-2xl font-semibold leading-none transition-colors duration-150",
              isSelected ? "text-black" : "text-white"
            ].join(" ")}
          >
            {project.readinessScore}
          </span>
        </span>

        <span
          className={[
            "block rounded-full p-1 transition-colors duration-150",
            isSelected
              ? "bg-black/10"
              : "border border-neutral-900 bg-black"
          ].join(" ")}
        >
          <AnimatedHealthBar score={project.readinessScore} isSelected={isSelected} />
        </span>

      </span>
    </>
  );
}

export function ScannersPage({
  projects,
  isLoading,
  onAddProject,
  onRescanProject,
  onCreateTaskPack
}: ScannersPageProps) {
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<ScannerLens>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null);
      return;
    }

    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    return [...projects]
      .filter((project) => {
        const searchText = [
          project.name,
          project.localPath,
          project.packageManager,
          project.detectedStack.join(" "),
          project.readinessReport.issues.join(" ")
        ].map(normalize).join(" ");

        const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery);
        const matchesLens =
          lens === "all" ||
          (lens === "withSignals" && hasScannerSignals(project)) ||
          (lens === "missingTests" && !hasTestEvidence(project)) ||
          (lens === "missingCi" && !hasCiEvidence(project));

        return matchesQuery && matchesLens;
      })
      .sort((a, b) => a.readinessScore - b.readinessScore);
  }, [lens, projects, query]);

  const selectedProject =
    filteredProjects.find((project) => project.id === selectedProjectId) ??
    projects.find((project) => project.id === selectedProjectId) ??
    filteredProjects[0] ??
    projects[0] ??
    null;

  const projectsWithSignals = projects.filter(hasScannerSignals).length;
  const missingTests = projects.filter((project) => !hasTestEvidence(project)).length;
  const missingCi = projects.filter((project) => !hasCiEvidence(project)).length;
  const avgCoverage = projects.length
    ? Math.round(projects.reduce((sum, project) => sum + getScannerCoverage(project), 0) / projects.length)
    : 0;

  if (isLoading && projects.length === 0) {
    return <ScannerSkeleton />;
  }

  if (projects.length === 0) {
    return (
      <section className="cf-card flex min-h-72 flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <ScanSearch size={22} />
        </div>
        <h2 className="text-base font-medium text-white">No scanner data yet</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          Add a project folder first. ContextForge will scan package manifests, scripts, docs, tests and safe environment examples.
        </p>
        <Button onClick={onAddProject} disabled={isLoading} variant="secondary" className="mt-6">
          <FolderOpen size={16} />
          Add project
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">
            <ScanSearch size={13} />
            Scanners
          </span>
          <span className="cf-badge">Readiness evidence</span>
          <span className="cf-badge">Local-only</span>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div>
            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Inspect scanner evidence without overloading the Projects page.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Projects stay compact. This page explains what the bounded scanner found: manifests, commands, docs, tests, environment examples, CI and structure signals.
            </p>
          </div>

          <ScannerHealthSummary
            projectCount={projects.length}
            projectsWithSignals={projectsWithSignals}
            missingTests={missingTests}
            missingCi={missingCi}
            avgCoverage={avgCoverage}
          />
        </div>
      </div>

      <div className="grid min-h-[720px] gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="cf-card h-fit p-5 xl:sticky xl:top-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Project scans</p>
              <h3 className="mt-1 text-base font-semibold text-white">Choose a project</h3>
            </div>
            <span className="cf-badge">{filteredProjects.length} results</span>
          </div>

          <div className="relative mb-4">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search scanner evidence..."
              className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <HorizontalSlidingSelector
            items={SCANNER_LENS_OPTIONS}
            activeIndex={Math.max(
              0,
              SCANNER_LENS_OPTIONS.findIndex((option) => option.value === lens)
            )}
            getItemKey={(option) => option.value}
            onSelect={(option) => setLens(option.value)}
            ariaLabel="Scanner filters"
            className="h-14"
            itemClassName="rounded-[0.95rem] px-3 text-left"
            renderItem={(option, isActive) => (
              <span className="relative z-10 flex min-w-0 items-center gap-2">
                <span className="min-w-0">
                  <span
                    className={[
                      "block truncate text-xs font-semibold transition-colors duration-150",
                      isActive ? "text-black" : "text-neutral-300 group-hover:text-white"
                    ].join(" ")}
                  >
                    {option.label}
                  </span>

                  <span
                    className={[
                      "mt-0.5 block truncate text-[10px] transition-colors duration-150",
                      isActive
                        ? "text-black/55"
                        : "text-neutral-700 group-hover:text-neutral-500"
                    ].join(" ")}
                  >
                    {option.description}
                  </span>
                </span>
              </span>
            )}
          />

          <div className="mt-4">
            {filteredProjects.length === 0 ? (
              <div className="rounded-[1.35rem] border border-dashed border-neutral-900 bg-black/25 p-5 text-sm leading-6 text-neutral-500">
                No projects match this scanner lens.
              </div>
            ) : (
              <VerticalSlidingSelector
                items={filteredProjects}
                activeIndex={filteredProjects.findIndex(
                  (project) => project.id === selectedProject?.id
                )}
                itemHeight={SCANNER_PROJECT_ITEM_HEIGHT}
                itemGap={SCANNER_PROJECT_ITEM_GAP}
                getItemKey={(project) => project.id}
                onSelect={(project) => setSelectedProjectId(project.id)}
                ariaLabel="Scanned projects"
                itemSurfaceClassName="rounded-[1.35rem] border border-neutral-900 bg-black/35 shadow-[0_12px_36px_rgba(0,0,0,0.18)]"
                indicatorClassName="rounded-[1.35rem] border border-white shadow-[0_20px_54px_rgba(255,255,255,0.12),0_18px_40px_rgba(0,0,0,0.42)]"
                itemClassName="overflow-hidden rounded-[1.35rem] px-4 py-3 text-left"
                renderItem={(project, isSelected) => (
                  <ProjectScanListItem project={project} isSelected={isSelected} />
                )}
              />
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {selectedProject ? (
            <div className="space-y-5">
              <section className="cf-card p-5">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    <div className="mb-4 flex items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                        <FileSearch size={19} />
                      </div>
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xl font-semibold tracking-[-0.03em] text-white">
                            {selectedProject.name}
                          </h3>
                          <span className="cf-badge">{getReadinessLabel(selectedProject.readinessScore)}</span>
                        </div>
                        <p className="truncate text-sm text-neutral-600">{selectedProject.localPath}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {selectedProject.detectedStack.map((item) => (
                        <span key={item} className="cf-badge">{item}</span>
                      ))}
                      <span className="cf-badge">Last scan: {formatDate(selectedProject.lastScanAt)}</span>
                    </div>
                  </div>

                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">AI readiness</p>
                        <motion.p
                          key={`scanner-readiness-label-${selectedProject.id}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={PAGE_TRANSITION}
                          className="mt-1 text-sm font-medium text-white"
                        >
                          {getReadinessLabel(selectedProject.readinessScore)}
                        </motion.p>
                      </div>
                      <motion.span
                        key={`scanner-readiness-score-${selectedProject.id}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={PAGE_TRANSITION}
                        className="cf-display-font text-4xl font-semibold leading-none text-white"
                      >
                        {selectedProject.readinessScore}
                      </motion.span>
                    </div>

                    <div className="mb-4 rounded-full border border-neutral-800/80 bg-black p-1">
                      <AnimatedHealthBar score={selectedProject.readinessScore} />
                    </div>

                    <div className="grid gap-2">
                      <Button
                        variant="primary"
                        disabled={isLoading}
                        onClick={() => onCreateTaskPack(selectedProject)}
                        className="justify-center rounded-xl"
                      >
                        <WandSparkles size={15} />
                        Create Task Pack
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={isLoading}
                        onClick={() => onRescanProject(selectedProject)}
                        className="justify-center rounded-xl"
                      >
                        <RefreshCw size={15} />
                        Rescan project
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.1fr)_420px]">
                <div className="cf-card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Readiness explanation</p>
                      <h3 className="mt-1 text-base font-semibold text-white">
                        {getPassedChecks(selectedProject)} of {selectedProject.readinessReport.checks.length} checks passed
                      </h3>
                    </div>
                    <span className="cf-badge">{selectedProject.readinessReport.issues.length} action items</span>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {selectedProject.readinessReport.checks.map((check) => (
                      <ReadinessCheckRow key={check.key} check={check} />
                    ))}
                  </div>
                </div>

                <aside className="cf-card h-fit p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <CircleDot size={15} className="text-neutral-500" />
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Next scanner actions</p>
                      <h3 className="mt-1 text-base font-semibold text-white">What to fix next</h3>
                    </div>
                  </div>

                  {selectedProject.readinessReport.issues.length === 0 ? (
                    <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-100/80">
                      No major scanner action items. Keep the project rescanned when scripts, docs or tests change.
                    </div>
                  ) : (
                    <ol className="space-y-3">
                      {selectedProject.readinessReport.issues.slice(0, 5).map((issue, index) => (
                        <li key={issue} className="flex gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm leading-6 text-neutral-500">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-black">
                            {index + 1}
                          </span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </aside>
              </section>

              <section className="cf-card p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Full scanner breakdown</p>
                    <h3 className="mt-1 text-base font-semibold text-white">Detected project signals</h3>
                  </div>
                  <span className="cf-badge">
                    {selectedProject.readinessReport.signals?.inventory.totalFiles ?? 0} files scanned
                  </span>
                </div>

                <ProjectScannerSignalsPanel signals={selectedProject.readinessReport.signals} />
              </section>
            </div>
          ) : (
            <section className="cf-card flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <ScanSearch size={26} className="text-neutral-500" />
              <h3 className="mt-4 text-base font-semibold text-white">No project selected</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
                Choose a project from the scanner list to inspect the latest evidence.
              </p>
            </section>
          )}
        </main>
      </div>
    </section>
  );
}
