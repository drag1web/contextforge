import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson2,
  LoaderCircle,
  Play,
  ShieldCheck,
  Square,
  TestTube2,
  Upload,
  XCircle,
} from "lucide-react";

import { createContextComposerPreview, understandTaskPack } from "../../api/client";
import type { ContextComposerPreview, Project, TaskUnderstandingResponse } from "../../types";
import {
  buildValidationActualSummary,
  createValidationManifestTemplate,
  evaluateValidationExpectation,
  MAX_VALIDATION_MANIFEST_BYTES,
  parseValidationManifest,
  sanitizeValidationPreview,
  summarizeValidationResults,
  type ValidationCaseResult,
  type ValidationManifest,
  type ValidationRunResult,
} from "../../validation/validationManifest";
import {
  downloadTextFile,
  exportValidationRunArchive,
} from "../../utils/validationRunExport";
import { Button } from "../ui/Button";

interface ValidationLabProps {
  projects: Project[];
}

interface RunProgress {
  completed: number;
  total: number;
  currentId: string | null;
}

function createRunId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `validation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStatusStyle(status: ValidationCaseResult["status"]) {
  if (status === "passed") {
    return {
      icon: <CheckCircle2 size={14} />,
      className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    };
  }
  if (status === "failed" || status === "error") {
    return {
      icon: <XCircle size={14} />,
      className: "border-rose-400/20 bg-rose-400/10 text-rose-200",
    };
  }
  return {
    icon: <AlertTriangle size={14} />,
    className: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  };
}

function skippedResult(input: {
  test: ValidationManifest["tests"][number];
  projectId: number;
  taskType: string;
  targetTool: string;
  acceptReview: boolean;
  reason: string;
}): ValidationCaseResult {
  return {
    id: input.test.id,
    title: input.test.title ?? input.test.id,
    status: "skipped",
    durationMs: 0,
    checks: [],
    actual: null,
    error: input.reason,
    diagnostics: {
      input: input.test,
      resolvedInput: {
        projectId: input.projectId,
        taskType: input.taskType,
        targetTool: input.targetTool,
        acceptReview: input.acceptReview,
      },
      understanding: null,
      preview: null,
    },
  };
}

function resolvedCaseSettings(
  manifest: ValidationManifest,
  test: ValidationManifest["tests"][number],
) {
  return {
    taskType: test.taskType ?? manifest.defaults.taskType ?? "general",
    targetTool: test.targetTool ?? manifest.defaults.targetTool ?? "codex",
    acceptReview:
      test.acceptReview ?? manifest.defaults.acceptReview ?? true,
  };
}

export function ValidationLab({ projects }: ValidationLabProps) {
  const [manifest, setManifest] = useState<ValidationManifest | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects[0]?.id ?? null,
  );
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress>({
    completed: 0,
    total: 0,
    currentId: null,
  });
  const [liveResults, setLiveResults] = useState<ValidationCaseResult[]>([]);
  const [lastRun, setLastRun] = useState<ValidationRunResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRequested = useRef(false);

  useEffect(() => {
    if (
      selectedProjectId === null ||
      !projects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(projects[0]?.id ?? null);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const enabledCaseCount =
    manifest?.tests.filter((test) => !test.disabled).length ?? 0;
  const displayedResults = liveResults.length > 0
    ? liveResults
    : lastRun?.results ?? [];

  const handleManifestFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setMessage(null);

    try {
      if (file.size > MAX_VALIDATION_MANIFEST_BYTES) {
        throw new Error("The manifest is larger than 1 MB.");
      }
      const nextManifest = parseValidationManifest(await file.text());
      setManifest(nextManifest);
      setSourceFileName(file.name);
      setLastRun(null);
      setLiveResults([]);
      setMessage(
        `Loaded ${nextManifest.tests.length} case${nextManifest.tests.length === 1 ? "" : "s"} from ${file.name}.`,
      );
    } catch (loadError) {
      setManifest(null);
      setSourceFileName("");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not read the validation manifest.",
      );
    }
  };

  const handleDownloadTemplate = () => {
    const template = createValidationManifestTemplate();
    downloadTextFile(
      `${JSON.stringify(template, null, 2)}\n`,
      "contextforge-validation-manifest.example.json",
      "application/json;charset=utf-8",
    );
    setMessage("Downloaded a project-neutral validation manifest template.");
  };

  const handleDownloadLastRun = () => {
    if (!lastRun) return;
    const fileName = exportValidationRunArchive(lastRun);
    setMessage(`Downloaded ${fileName}.`);
  };

  const handleRun = async () => {
    if (!manifest || !selectedProject) return;

    const runId = createRunId();
    const startedAtDate = new Date();
    const results: ValidationCaseResult[] = [];
    cancelRequested.current = false;
    setIsRunning(true);
    setError(null);
    setMessage(null);
    setLastRun(null);
    setLiveResults([]);
    setProgress({
      completed: 0,
      total: manifest.tests.length,
      currentId: null,
    });

    for (let index = 0; index < manifest.tests.length; index += 1) {
      const test = manifest.tests[index]!;
      const resolved = resolvedCaseSettings(manifest, test);

      if (test.disabled || cancelRequested.current) {
        results.push(
          skippedResult({
            test,
            projectId: selectedProject.id,
            ...resolved,
            reason: test.disabled
              ? "Disabled by the manifest."
              : "Skipped after cancellation was requested.",
          }),
        );
        setLiveResults([...results]);
        setProgress({
          completed: index + 1,
          total: manifest.tests.length,
          currentId: null,
        });
        continue;
      }

      setProgress({
        completed: index,
        total: manifest.tests.length,
        currentId: test.id,
      });
      const caseStartedAt = performance.now();
      let understanding: TaskUnderstandingResponse | null = null;
      let preview: ContextComposerPreview | null = null;

      try {
        understanding = await understandTaskPack({
          projectId: selectedProject.id,
          rawTask: test.task,
          taskType: resolved.taskType,
          targetTool: resolved.targetTool,
          clarifications: test.clarifications,
        });

        const clarificationStillRequired =
          understanding.interaction.action === "clarify";
        const reviewNotAccepted =
          understanding.interaction.action === "review" &&
          !resolved.acceptReview;
        const shouldBuildPreview =
          !test.stopAfterUnderstanding &&
          !clarificationStillRequired &&
          !reviewNotAccepted;

        if (shouldBuildPreview) {
          preview = await createContextComposerPreview({
            projectId: selectedProject.id,
            rawTask: test.task,
            taskType: resolved.taskType,
            targetTool: resolved.targetTool,
            clarifications: test.clarifications,
            understandingSnapshotId: understanding.understandingSnapshotId,
            reviewedUnderstandingSnapshotId:
              understanding.interaction.action === "review" &&
              resolved.acceptReview
                ? understanding.understandingSnapshotId
                : undefined,
          });
        }

        const durationMs = Math.round(performance.now() - caseStartedAt);
        const actual = buildValidationActualSummary({
          understanding,
          preview,
          durationMs,
        });
        const evaluation = evaluateValidationExpectation(test.expect, actual);
        const result: ValidationCaseResult = {
          id: test.id,
          title: test.title ?? test.id,
          status: evaluation.status,
          durationMs,
          checks: evaluation.checks,
          actual,
          error: null,
          diagnostics: {
            input: test,
            resolvedInput: {
              projectId: selectedProject.id,
              ...resolved,
            },
            understanding,
            preview: sanitizeValidationPreview(preview),
          },
        };
        results.push(result);
      } catch (caseError) {
        const durationMs = Math.round(performance.now() - caseStartedAt);
        results.push({
          id: test.id,
          title: test.title ?? test.id,
          status: "error",
          durationMs,
          checks: [],
          actual: null,
          error:
            caseError instanceof Error
              ? caseError.message
              : "Unexpected validation error.",
          diagnostics: {
            input: test,
            resolvedInput: {
              projectId: selectedProject.id,
              ...resolved,
            },
            understanding,
            preview: sanitizeValidationPreview(preview),
          },
        });
      }

      setLiveResults([...results]);
      setProgress({
        completed: index + 1,
        total: manifest.tests.length,
        currentId: null,
      });
    }

    const finishedAtDate = new Date();
    const run: ValidationRunResult = {
      format: "contextforge.validation-run",
      version: 1,
      runId,
      manifest,
      sourceFileName,
      project: {
        id: selectedProject.id,
        name: selectedProject.name,
        localPath: selectedProject.localPath,
      },
      startedAt: startedAtDate.toISOString(),
      finishedAt: finishedAtDate.toISOString(),
      durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
      cancelled: cancelRequested.current,
      results,
      summary: summarizeValidationResults(results),
    };

    setLastRun(run);
    setLiveResults([]);
    setIsRunning(false);
    setProgress({
      completed: results.length,
      total: manifest.tests.length,
      currentId: null,
    });

    try {
      const fileName = exportValidationRunArchive(run);
      setMessage(
        `${run.cancelled ? "Partial run" : "Run complete"}. Downloaded ${fileName}.`,
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? `Run completed, but archive export failed: ${exportError.message}`
          : "Run completed, but archive export failed.",
      );
    }
  };

  const progressPercent =
    progress.total === 0
      ? 0
      : Math.round((progress.completed / progress.total) * 100);

  return (
    <article className="cf-card overflow-hidden">
      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="cf-badge">
              <TestTube2 size={13} />
              Validation Lab
            </span>
            <span className="cf-badge">Read-only</span>
            <span className="cf-badge">Sequential runner</span>
          </div>

          <h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-white">
            Run a complete test manifest without retyping tasks.
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
            Upload a JSON text manifest, choose any scanned project and run every case through the real Task Understanding and Context Composer preview pipeline. Project-specific paths stay in the manifest; the runner contains no repository-specific rules.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-neutral-200">
              <Upload size={15} />
              Upload manifest
              <input
                type="file"
                accept=".json,.txt,application/json,text/plain"
                className="hidden"
                disabled={isRunning}
                onChange={handleManifestFile}
              />
            </label>
            <Button
              variant="secondary"
              onClick={handleDownloadTemplate}
              disabled={isRunning}
            >
              <FileJson2 size={15} />
              Manifest template
            </Button>
            {lastRun && (
              <Button variant="secondary" onClick={handleDownloadLastRun}>
                <Download size={15} />
                Download last archive
              </Button>
            )}
          </div>

          {manifest ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Suite</p>
                <p className="mt-2 truncate text-sm font-medium text-white">{manifest.name}</p>
                <p className="mt-1 truncate text-xs text-neutral-600">{sourceFileName}</p>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Cases</p>
                <p className="mt-2 text-sm font-medium text-white">{enabledCaseCount} enabled</p>
                <p className="mt-1 text-xs text-neutral-600">{manifest.tests.length} total · max 50</p>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Mode</p>
                <p className="mt-2 text-sm font-medium text-white">Analyze only</p>
                <p className="mt-1 text-xs text-neutral-600">No Task Pack generation</p>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-5 text-sm text-neutral-600">
              Upload a manifest or download the neutral template to define your test suite.
            </div>
          )}
        </div>

        <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/40 p-5">
          <label className="cf-tech-label text-[10px] uppercase text-neutral-600" htmlFor="validation-project">
            Project under test
          </label>
          <select
            id="validation-project"
            value={selectedProjectId ?? ""}
            disabled={isRunning || projects.length === 0}
            onChange={(event) => setSelectedProjectId(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-white/30"
          >
            {projects.length === 0 && <option value="">No scanned projects</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <div className="mt-4 rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.045] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-100">
              <ShieldCheck size={15} />
              Source-safe execution
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-500">
              The runner only analyzes inventory and preview context. It never writes to the selected project, creates Task Packs or executes generated code.
            </p>
          </div>

          {isRunning ? (
            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={() => {
                cancelRequested.current = true;
                setMessage("Cancellation requested. The current case will finish safely.");
              }}
            >
              <Square size={14} />
              Stop after current case
            </Button>
          ) : (
            <Button
              variant="primary"
              className="mt-4 w-full"
              disabled={!manifest || !selectedProject}
              onClick={handleRun}
            >
              <Play size={15} />
              Run {enabledCaseCount || "suite"} test{enabledCaseCount === 1 ? "" : "s"}
            </Button>
          )}
        </aside>
      </div>

      {(isRunning || displayedResults.length > 0 || message || error) && (
        <div className="border-t border-neutral-900 bg-black/25 p-5">
          {isRunning && (
            <div className="mb-4">
              <div className="flex items-center justify-between gap-4 text-xs text-neutral-500">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle size={14} className="animate-spin" />
                  {progress.currentId
                    ? `Running ${progress.currentId}`
                    : "Preparing next case"}
                </span>
                <span>{progress.completed}/{progress.total} · {progressPercent}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-900">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {message && (
            <p className="mb-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-100">
              {message}
            </p>
          )}
          {error && (
            <p className="mb-3 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
              {error}
            </p>
          )}

          {displayedResults.length > 0 && (
            <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {displayedResults.map((result) => {
                const style = getStatusStyle(result.status);
                const failedChecks = result.checks.filter((check) => !check.passed).length;
                return (
                  <div
                    key={result.id}
                    className="rounded-2xl border border-neutral-900 bg-black/35 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{result.id}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-neutral-600">{result.title}</p>
                      </div>
                      <span className={["inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]", style.className].join(" ")}>
                        {style.icon}
                        {result.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                      <span>{result.durationMs} ms</span>
                      <span>{result.actual?.selectedPaths.length ?? 0} files</span>
                      {failedChecks > 0 && <span className="text-rose-300">{failedChecks} failed checks</span>}
                      {result.error && <span className="line-clamp-1 text-rose-300">{result.error}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
