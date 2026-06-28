import { Clipboard, FileText } from "lucide-react";
import type { TaskPack } from "../../types";
import { Button } from "../ui/Button";

interface RecentTaskPacksProps {
  taskPacks: TaskPack[];
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getTaskPackBodyBadge(taskPack: TaskPack) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return "Ollama refined";
  }

  return "Safe Template";
}

export function RecentTaskPacks({
  taskPacks,
  onOpenTaskPack
}: RecentTaskPacksProps) {
  const recentTaskPacks = taskPacks.slice(0, 4);

  if (recentTaskPacks.length === 0) {
    return null;
  }

  return (
    <section className="mb-7">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            Recent
          </p>
          <h3 className="text-lg font-semibold tracking-tight text-white">
            Latest Task Packs
          </h3>
          <p className="mt-1 text-sm text-neutral-500">
            Recently generated prompts ready for Claude, Cursor, Codex, or another agent.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {recentTaskPacks.map((taskPack) => (
          <article key={taskPack.id} className="cf-card p-5">
            <div className="flex items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                    <FileText size={15} />
                  </div>

                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-white">
                      {taskPack.title}
                    </h4>

                    <p className="truncate text-xs text-neutral-600">
                      {taskPack.projectName ?? `Project #${taskPack.projectId}`}
                    </p>
                  </div>
                </div>

                <p className="line-clamp-2 text-sm leading-6 text-neutral-500">
                  {taskPack.rawTask}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="cf-badge">{taskPack.targetTool}</span>
                  <span className="cf-badge">{taskPack.taskType}</span>
                  <span className="cf-badge">{getTaskPackBodyBadge(taskPack)}</span>
                  <span className="cf-badge">{formatDate(taskPack.createdAt)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(taskPack.generatedPrompt)}
                >
                  <Clipboard size={15} />
                  Copy
                </Button>

                <Button variant="primary" onClick={() => onOpenTaskPack(taskPack)}>
                  Open
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}