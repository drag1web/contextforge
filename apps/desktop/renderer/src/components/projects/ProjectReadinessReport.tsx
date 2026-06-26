import { CheckCircle2, XCircle } from "lucide-react";
import type { ReadinessReport } from "../../types";

interface ProjectReadinessReportProps {
  report: ReadinessReport;
}

export function ProjectReadinessReport({ report }: ProjectReadinessReportProps) {
  return (
    <div className="mt-5 overflow-hidden border-t border-neutral-900 pt-5">
      <div className="grid gap-3 md:grid-cols-2">
        {report.checks.map((check) => (
          <div
            key={check.key}
            className="rounded-xl border border-neutral-900 bg-black/40 p-4"
          >
            <div className="flex items-start gap-3">
              {check.passed ? (
                <CheckCircle2 size={16} className="mt-0.5 text-emerald-400" />
              ) : (
                <XCircle size={16} className="mt-0.5 text-neutral-600" />
              )}

              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{check.label}</p>
                  <span className="text-xs text-neutral-600">
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
        <div className="mt-4 rounded-xl border border-neutral-900 bg-black/40 p-4">
          <p className="mb-3 text-sm font-medium text-white">
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