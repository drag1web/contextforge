import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson2,
  FolderOpen,
  LoaderCircle,
  Play,
  ShieldCheck,
  Square,
  TestTube2,
  Upload,
  XCircle,
} from "lucide-react";

import {
  createContextComposerPreview,
  understandTaskPack,
} from "../../api/client";
import type {
  ContextComposerPreview,
  Project,
  TaskUnderstandingResponse,
} from "../../types";
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
import { CustomSelect, type SelectOption } from "../ui/CustomSelect";

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
      className:
        "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
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
    acceptReview: test.acceptReview ?? manifest.defaults.acceptReview ?? true,
  };
}

export function ValidationLab({ projects }: ValidationLabProps) {
  const { t } = useTranslation();
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
    () =>
      projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const enabledCaseCount =
    manifest?.tests.filter((test) => !test.disabled).length ?? 0;
  const displayedResults =
    liveResults.length > 0 ? liveResults : (lastRun?.results ?? []);
  const projectOptions = useMemo<SelectOption<string>[]>(
    () =>
      projects.map((project) => ({
        value: String(project.id),
        label: project.name,
        description: project.localPath,
        icon: <FolderOpen size={15} />,
      })),
    [projects],
  );

  async function handleManifestFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      if (file.size > MAX_VALIDATION_MANIFEST_BYTES) {
        throw new Error(t("reportsWorkspace.validation.errors.tooLarge"));
      }

      const nextManifest = parseValidationManifest(await file.text());
      setManifest(nextManifest);
      setSourceFileName(file.name);
      setLastRun(null);
      setLiveResults([]);
      setMessage(
        t("reportsWorkspace.validation.messages.loaded", {
          caseCount: nextManifest.tests.length,
          fileName: file.name,
        }),
      );
    } catch (loadError) {
      setManifest(null);
      setSourceFileName("");
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("reportsWorkspace.validation.errors.read"),
      );
    }
  }

  function handleDownloadTemplate() {
    const template = createValidationManifestTemplate();
    downloadTextFile(
      `${JSON.stringify(template, null, 2)}\n`,
      "contextforge-validation-manifest.example.json",
      "application/json;charset=utf-8",
    );
    setMessage(t("reportsWorkspace.validation.messages.templateDownloaded"));
  }

  function handleDownloadLastRun() {
    if (!lastRun) {
      return;
    }

    const fileName = exportValidationRunArchive(lastRun);
    setMessage(
      t("reportsWorkspace.validation.messages.archiveDownloaded", {
        fileName,
      }),
    );
  }

  async function handleRun() {
    if (!manifest || !selectedProject) {
      return;
    }

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
              ? t("reportsWorkspace.validation.messages.disabled")
              : t("reportsWorkspace.validation.messages.cancelledCase"),
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
              : t("reportsWorkspace.validation.errors.unexpected"),
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
        t(
          run.cancelled
            ? "reportsWorkspace.validation.messages.partialComplete"
            : "reportsWorkspace.validation.messages.complete",
          { fileName },
        ),
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? t("reportsWorkspace.validation.errors.archive", {
              message: exportError.message,
            })
          : t("reportsWorkspace.validation.errors.archiveUnknown"),
      );
    }
  }

  const progressPercent =
    progress.total === 0
      ? 0
      : Math.round((progress.completed / progress.total) * 100);

  return (
    <article className="cf-card overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
              <TestTube2 size={17} />
            </span>
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("reportsWorkspace.validation.eyebrow")}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-white">
                {t("reportsWorkspace.validation.title")}
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
                {t("reportsWorkspace.validation.description")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="cf-badge">
              {t("reportsWorkspace.validation.readOnly")}
            </span>
            <span className="cf-badge">
              {t("reportsWorkspace.validation.sequential")}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-[1.4rem] border border-neutral-900 bg-black/30 p-5">
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-neutral-200">
                <Upload size={15} />
                {t("reportsWorkspace.validation.upload")}
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
                {t("reportsWorkspace.validation.template")}
              </Button>
              {lastRun ? (
                <Button variant="secondary" onClick={handleDownloadLastRun}>
                  <Download size={15} />
                  {t("reportsWorkspace.validation.downloadLast")}
                </Button>
              ) : null}
            </div>

            {manifest ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    {t("reportsWorkspace.validation.suite")}
                  </p>
                  <p className="mt-2 truncate text-sm font-medium text-white">
                    {manifest.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-neutral-600">
                    {sourceFileName}
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    {t("reportsWorkspace.validation.cases")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {t("reportsWorkspace.validation.enabled", {
                      caseCount: enabledCaseCount,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {t("reportsWorkspace.validation.total", {
                      caseCount: manifest.tests.length,
                    })}
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    {t("reportsWorkspace.validation.mode")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {t("reportsWorkspace.validation.analyzeOnly")}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {t("reportsWorkspace.validation.noGeneration")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-5 text-sm leading-6 text-neutral-600">
                {t("reportsWorkspace.validation.emptyManifest")}
              </div>
            )}
          </div>

          <aside className="rounded-[1.4rem] border border-neutral-900 bg-black/30 p-5">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("reportsWorkspace.validation.project")}
            </p>
            <div className="mt-2">
              <CustomSelect
                value={
                  selectedProjectId === null ? "" : String(selectedProjectId)
                }
                options={projectOptions}
                onChange={(value) => setSelectedProjectId(Number(value))}
                placeholder={t("reportsWorkspace.validation.noProjects")}
                disabled={isRunning || projects.length === 0}
              />
            </div>

            <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    {t("reportsWorkspace.validation.runSummary")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {manifest
                      ? t("reportsWorkspace.validation.readyToRun")
                      : t("reportsWorkspace.validation.waitingManifest")}
                  </p>
                </div>
                <span className="grid size-9 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                  <TestTube2 size={16} />
                </span>
              </div>

              <div className="mt-4 grid gap-2">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5">
                  <span className="text-xs text-neutral-600">
                    {t("reportsWorkspace.validation.summaryProject")}
                  </span>
                  <span className="max-w-[180px] truncate text-xs font-medium text-neutral-300">
                    {selectedProject?.name ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5">
                  <span className="text-xs text-neutral-600">
                    {t("reportsWorkspace.validation.summaryCases")}
                  </span>
                  <span className="text-xs font-medium text-neutral-300">
                    {manifest ? enabledCaseCount : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5">
                  <span className="text-xs text-neutral-600">
                    {t("reportsWorkspace.validation.summaryMode")}
                  </span>
                  <span className="text-xs font-medium text-neutral-300">
                    {t("reportsWorkspace.validation.sequential")}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.045] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-100">
                <ShieldCheck size={15} />
                {t("reportsWorkspace.validation.safeTitle")}
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                {t("reportsWorkspace.validation.safeDescription")}
              </p>
            </div>

            {isRunning ? (
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => {
                  cancelRequested.current = true;
                  setMessage(
                    t("reportsWorkspace.validation.messages.cancelRequested"),
                  );
                }}
              >
                <Square size={14} />
                {t("reportsWorkspace.validation.stop")}
              </Button>
            ) : (
              <Button
                variant="primary"
                className="mt-4 w-full"
                disabled={!manifest || !selectedProject}
                onClick={handleRun}
              >
                <Play size={15} />
                {manifest
                  ? t("reportsWorkspace.validation.runCases", {
                      caseCount: enabledCaseCount,
                    })
                  : t("reportsWorkspace.validation.runSuite")}
              </Button>
            )}
          </aside>
        </div>
      </div>

      {isRunning || displayedResults.length > 0 || message || error ? (
        <div className="border-t border-neutral-900 bg-black/25 p-5">
          {isRunning ? (
            <div className="mb-4">
              <div className="flex items-center justify-between gap-4 text-xs text-neutral-500">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle size={14} className="animate-spin" />
                  {progress.currentId
                    ? t("reportsWorkspace.validation.running", {
                        id: progress.currentId,
                      })
                    : t("reportsWorkspace.validation.preparing")}
                </span>
                <span>
                  {progress.completed}/{progress.total} · {progressPercent}%
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-900">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          ) : null}

          {message ? (
            <p className="mb-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-100">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="mb-3 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
              {error}
            </p>
          ) : null}

          {displayedResults.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {displayedResults.map((result) => {
                const style = getStatusStyle(result.status);
                const failedChecks = result.checks.filter(
                  (check) => !check.passed,
                ).length;

                return (
                  <div
                    key={result.id}
                    className="rounded-2xl border border-neutral-900 bg-black/35 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {result.id}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-neutral-600">
                          {result.title}
                        </p>
                      </div>
                      <span
                        className={[
                          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]",
                          style.className,
                        ].join(" ")}
                      >
                        {style.icon}
                        {t(
                          `reportsWorkspace.validation.status.${result.status}`,
                        )}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                      <span>{result.durationMs} ms</span>
                      <span>
                        {t("reportsWorkspace.validation.files", {
                          fileCount: result.actual?.selectedPaths.length ?? 0,
                        })}
                      </span>
                      {failedChecks > 0 ? (
                        <span className="text-rose-300">
                          {t("reportsWorkspace.validation.failedChecks", {
                            checkCount: failedChecks,
                          })}
                        </span>
                      ) : null}
                      {result.error ? (
                        <span className="line-clamp-1 text-rose-300">
                          {result.error}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
