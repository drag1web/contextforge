import { CheckCircle2, XCircle } from "lucide-react";
import type { ReadinessReport } from "../../types";

interface ProjectReadinessReportProps {
  report: ReadinessReport;
}

export function ProjectReadinessReport({ report }: ProjectReadinessReportProps) {
  const passedChecks = report.checks.filter((check) => check.passed).length;

  return (
    <div className="mt-5 overflow-hidden border-t border-neutral-900 pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="cf-tech-label mb-1 text-[10px] uppercase text-neutral-600">
            Readiness report
          </p>

          <p className="text-sm text-neutral-500">
            {passedChecks} of {report.checks.length} checks passed.
          </p>
        </div>

        <span className="cf-badge">
          {report.issues.length > 0
            ? `${report.issues.length} issues`
            : "No major issues"}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {report.checks.map((check) => (
          <div
            key={check.key}
            className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
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
                  {check.passed ? check.message : "Missing or not detected."}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {report.issues.length > 0 && (
        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
          <p className="cf-tech-label mb-3 text-[10px] uppercase text-neutral-600">
            Recommended improvements
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