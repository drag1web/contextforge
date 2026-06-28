import {
  Bot,
  ClipboardCheck,
  FolderSearch,
  GitPullRequestDraft,
  ShieldCheck
} from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Scan project",
    description:
      "ContextForge reads local project structure, package metadata, scripts, stack hints, and AI-readiness signals.",
    icon: FolderSearch
  },
  {
    number: "02",
    title: "Analyze task",
    description:
      "Ollama helps classify the task as UI, backend, fullstack, docs, build, assets, tests, or refactor.",
    icon: Bot
  },
  {
    number: "03",
    title: "Select files",
    description:
      "The selector chooses real inventory files and the backend rejects fake, unsafe, or semantically weak paths.",
    icon: ShieldCheck
  },
  {
    number: "04",
    title: "Generate Task Pack",
    description:
      "A validated Markdown prompt is created for Codex, Claude Code, Cursor, or another external coding agent.",
    icon: ClipboardCheck
  }
];

export function WorkflowSteps() {
  return (
    <section className="mb-7">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            Workflow
          </p>
          <h3 className="text-lg font-semibold tracking-tight text-white">
            From local project to agent-ready context
          </h3>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-neutral-500 md:flex">
          <GitPullRequestDraft size={14} />
          safe by default
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {steps.map((step) => {
          const Icon = step.icon;

          return (
            <article key={step.number} className="cf-card p-5">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                  <Icon size={18} />
                </div>

                <span className="cf-tech-label text-xs text-neutral-700">
                  {step.number}
                </span>
              </div>

              <h4 className="text-sm font-semibold text-white">{step.title}</h4>

              <p className="mt-2 text-sm leading-6 text-neutral-500">
                {step.description}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}