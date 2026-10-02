import { useTranslation } from "react-i18next";
import type { TaskPack } from "../../types";
import { resolveTaskPackWorkflowSummary, type TaskPackWorkflowProjection } from "../../utils/taskPackWorkflowIndex";
import { TaskPackWorkflowBadges } from "./TaskPackWorkflowCard";

/** Presentation only: resolves against today's shared map, never a copied target snapshot. */
export function TaskPackWorkflowProjectionBadges({ taskPack, projection }: {
  taskPack: Pick<TaskPack, "id" | "currentRevisionId">;
  projection: TaskPackWorkflowProjection;
}) {
  const { t } = useTranslation();
  const summary = resolveTaskPackWorkflowSummary(taskPack, projection);
  if (summary) return <TaskPackWorkflowBadges workflow={summary} />;
  return <span role="status" aria-busy={projection.status === "loading"}
    className="inline-flex text-[11px] leading-5 text-neutral-500">
    {t(projection.status === "loading" ? "taskPackWorkflow.statusLoading" : "taskPackWorkflow.statusUnavailable")}
  </span>;
}
