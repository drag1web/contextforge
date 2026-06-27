import { Clipboard, FileText } from "lucide-react";
import type { TaskPack } from "../types";
import { Button } from "../components/ui/Button";

interface TaskPacksPageProps {
  taskPacks: TaskPack[];
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export function TaskPacksPage({ taskPacks, onOpenTaskPack }: TaskPacksPageProps) {
  if (taskPacks.length === 0) {
    return (
      <section className="cf-card flex min-h-72 flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <FileText size={22} />
        </div>

        <h3 className="text-base font-medium text-white">No task packs yet</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          Create a task pack from any project card. ContextForge will generate a structured
          prompt for Codex, Cursor, Claude Code, or another AI agent.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-5">
        <h3 className="text-sm font-medium text-white">Task Packs</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Saved AI-ready prompts generated from your local projects.
        </p>
      </div>

      <div className="grid gap-4">
        {taskPacks.map((taskPack) => (
          <article key={taskPack.id} className="cf-card p-5">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  <FileText size={15} className="text-neutral-300" />

                  <h4 className="truncate text-sm font-medium text-white">
                    {taskPack.title}
                  </h4>
                </div>

                <p className="text-sm text-neutral-500">
                  {taskPack.projectName ?? `Project #${taskPack.projectId}`}
                </p>

                <p className="mt-3 line-clamp-2 max-w-4xl text-sm leading-6 text-neutral-400">
                  {taskPack.rawTask}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="cf-badge">{taskPack.targetTool}</span>
                  <span className="cf-badge">{taskPack.taskType}</span>
                  <span className="cf-badge">
                    {taskPack.generationMode === "ollama" ? "Ollama" : "Template"}
                  </span>
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