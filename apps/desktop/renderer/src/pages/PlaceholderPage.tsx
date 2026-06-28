import { Sparkles } from "lucide-react";
import type { AppPageId } from "../components/layout/Sidebar";
import { pageMetaMap } from "../components/layout/Sidebar";

interface PlaceholderPageProps {
  pageId: AppPageId;
}

export function PlaceholderPage({ pageId }: PlaceholderPageProps) {
  const page = pageMetaMap[pageId];

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.075),transparent_24rem),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.012))] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">
            <Sparkles size={13} />
            Future module
          </span>
          <span className="cf-badge">Navigation ready</span>
          <span className="cf-badge">Placeholder</span>
        </div>

        <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
          {page.label}
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
          {page.description}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="cf-card p-5">
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            Purpose
          </p>
          <h3 className="text-base font-semibold text-white">
            Planned workflow area
          </h3>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            This page is reserved for the next ContextForge modules. It is already
            connected to navigation so the application can grow without restructuring.
          </p>
        </article>

        <article className="cf-card p-5">
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            Status
          </p>
          <h3 className="text-base font-semibold text-white">
            UI placeholder
          </h3>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            The route is available, but the production feature will be implemented
            after the core AI workflow and project analytics are stabilized.
          </p>
        </article>

        <article className="cf-card p-5">
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            Next
          </p>
          <h3 className="text-base font-semibold text-white">
            Future implementation
          </h3>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Later this section can include real data, settings, agent profiles,
            reports, integrations, templates, or workflow automation.
          </p>
        </article>
      </div>
    </section>
  );
}