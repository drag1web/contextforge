import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download, FileText } from "lucide-react";

import type { TaskPack } from "../../types";
import {
  exportTaskPack,
  type TaskPackExportFormat
} from "../../utils/taskPackExport";

type TaskPackExportActionsProps = {
  taskPack: TaskPack;
  compact?: boolean;
  className?: string;
};

const RESET_DELAY_MS = 1400;

export function TaskPackExportActions({
  taskPack,
  compact = false,
  className = ""
}: TaskPackExportActionsProps) {
  const { t } = useTranslation();
  const [exportedFormat, setExportedFormat] = useState<TaskPackExportFormat | null>(null);

  function handleExport(format: TaskPackExportFormat) {
    exportTaskPack(taskPack, format);
    setExportedFormat(format);

    window.setTimeout(() => {
      setExportedFormat((current) => (current === format ? null : current));
    }, RESET_DELAY_MS);
  }

  const actions: Array<{
    format: TaskPackExportFormat;
    label: string;
    doneLabel: string;
  }> = [
      {
        format: "md",
        label: compact ? ".md" : t("taskPackExport.markdown"),
        doneLabel: compact ? ".md" : t("taskPackExport.markdownDone")
      },
      {
        format: "txt",
        label: compact ? ".txt" : t("taskPackExport.text"),
        doneLabel: compact ? ".txt" : t("taskPackExport.textDone")
      }
    ];

  return (
    <div className={["flex shrink-0 flex-wrap items-center gap-2", className].join(" ")}> 
      {actions.map((action) => {
        const isDone = exportedFormat === action.format;

        return (
          <button
            key={action.format}
            type="button"
            onClick={() => handleExport(action.format)}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-full border transition",
              "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-white/20 hover:bg-white/10 hover:text-white",
              compact ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm"
            ].join(" ")}
            aria-label={action.label}
            title={action.label}
          >
            {isDone ? <Check size={14} /> : action.format === "md" ? <FileText size={14} /> : <Download size={14} />}
            <span>{isDone ? action.doneLabel : action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
