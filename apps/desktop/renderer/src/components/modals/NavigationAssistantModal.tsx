import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  FileText,
  FolderOpen,
  Search,
  Settings,
  WandSparkles
} from "lucide-react";

import { Modal } from "../ui/Modal";
import {
  navigationSections,
  type AppPageId,
  type NavigationItem
} from "../layout/Sidebar";

interface NavigationAssistantModalProps {
  activePage: AppPageId;
  onNavigate: (page: AppPageId) => void;
  onClose: () => void;
  onAddProject?: () => void;
}

function getStatusKey(status?: NavigationItem["status"]) {
  if (status === "alpha") return "common.alpha";
  if (status === "soon") return "common.soon";
  if (status === "planned") return "common.planned";

  return "common.readyModule";
}

export function NavigationAssistantModal({
  activePage,
  onNavigate,
  onClose,
  onAddProject
}: NavigationAssistantModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return navigationSections;
    }

    return navigationSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const text = [
            item.label,
            item.description,
            t(item.labelKey),
            t(item.descriptionKey),
            t(section.titleKey),
            t(getStatusKey(item.status))
          ]
            .join(" ")
            .toLocaleLowerCase();

          return text.includes(normalizedQuery);
        })
      }))
      .filter((section) => section.items.length > 0);
  }, [query, t]);

  function handleNavigate(page: AppPageId) {
    onNavigate(page);
    onClose();
  }

  function handleAddProject() {
    onAddProject?.();
    onClose();
  }

  return (
    <Modal
      title={t("navigationAssistant.title")}
      eyebrow={t("navigationAssistant.eyebrow")}
      maxWidth="max-w-[920px]"
      scrollable={false}
      onClose={onClose}
    >
      <div className="p-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/45 px-4 py-2.5 transition focus-within:border-white/25 focus-within:bg-black/70 focus-within:ring-4 focus-within:ring-white/[0.035]">
          <Search size={15} className="shrink-0 text-neutral-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("navigationAssistant.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
          />
          <span className="shrink-0 rounded-lg border border-neutral-900 bg-neutral-950 px-2 py-1 font-mono text-[10px] text-neutral-600">
            Esc
          </span>
        </div>

        <section className="mt-3 rounded-2xl border border-neutral-900 bg-black/25 p-3">
          <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("navigationAssistant.quickActions")}
            </p>
            <p className="text-[11px] text-neutral-700">
              {t("navigationAssistant.quickActionsDescription")}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {onAddProject && (
              <button
                type="button"
                onClick={handleAddProject}
                className="cf-invert-action group flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm"
              >
                <FolderOpen size={14} className="text-neutral-600 transition group-hover:text-black" />
                <span className="truncate">{t("navigationAssistant.addProject")}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleNavigate("taskPacks")}
              className="cf-invert-action group flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm"
            >
              <FileText size={14} className="text-neutral-600 transition group-hover:text-black" />
              <span className="truncate">{t("nav.taskPacks")}</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("context")}
              className="cf-invert-action group flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm"
            >
              <WandSparkles size={14} className="text-neutral-600 transition group-hover:text-black" />
              <span className="truncate">{t("nav.context")}</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate("settings")}
              className="cf-invert-action group flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm"
            >
              <Settings size={14} className="text-neutral-600 transition group-hover:text-black" />
              <span className="truncate">{t("nav.settings")}</span>
            </button>
          </div>
        </section>

        {visibleSections.length > 0 ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {visibleSections.map((section) => (
              <section
                key={section.titleKey}
                className="min-w-0 rounded-2xl border border-neutral-900 bg-black/20 p-2.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                    {t(section.titleKey)}
                  </p>
                  <span className="text-[10px] text-neutral-700">
                    {section.items.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.id === activePage;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavigate(item.id)}
                        className={[
                          "group flex h-[48px] w-full items-center gap-2.5 rounded-xl border px-2.5 text-left transition duration-150",
                          isActive
                            ? "border-white bg-white text-black"
                            : "border-transparent bg-black/30 text-neutral-400 hover:border-neutral-800 hover:bg-neutral-950 hover:text-white"
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "grid size-8 shrink-0 place-items-center rounded-lg border transition",
                            isActive
                              ? "border-black/10 bg-black/[0.045] text-black"
                              : "border-neutral-900 bg-black text-neutral-600 group-hover:border-neutral-800 group-hover:text-neutral-300"
                          ].join(" ")}
                        >
                          <Icon size={14} />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={[
                                "truncate text-[13px] font-semibold",
                                isActive ? "text-black" : "text-neutral-200 group-hover:text-white"
                              ].join(" ")}
                            >
                              {t(item.labelKey)}
                            </span>
                            <span
                              className={[
                                "shrink-0 rounded-full px-1.5 py-0.5 text-[8px] uppercase tracking-[0.08em]",
                                isActive
                                  ? "bg-black/[0.07] text-black/50"
                                  : "border border-neutral-900 bg-black text-neutral-700"
                              ].join(" ")}
                            >
                              {t(getStatusKey(item.status))}
                            </span>
                          </span>
                          <span
                            className={[
                              "mt-0.5 block truncate text-[10px]",
                              isActive ? "text-black/50" : "text-neutral-700 group-hover:text-neutral-500"
                            ].join(" ")}
                          >
                            {t(item.descriptionKey)}
                          </span>
                        </span>

                        <ArrowRight
                          size={12}
                          className={[
                            "shrink-0 transition",
                            isActive
                              ? "text-black/40"
                              : "text-neutral-800 group-hover:translate-x-0.5 group-hover:text-neutral-500"
                          ].join(" ")}
                        />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-neutral-900 bg-black/30 px-5 py-8 text-center">
            <p className="text-sm font-medium text-white">
              {t("navigationAssistant.noResultsTitle")}
            </p>
            <p className="mt-1.5 text-sm text-neutral-600">
              {t("navigationAssistant.noResultsDescription")}
            </p>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-4 border-t border-neutral-900 px-1 pt-3">
          <p className="truncate text-[11px] text-neutral-700">
            {t("navigationAssistant.footerHint")}
          </p>
          <span className="shrink-0 text-[11px] text-neutral-600">
            {t("navigationAssistant.escCloses")}
          </span>
        </div>
      </div>
    </Modal>
  );
}
