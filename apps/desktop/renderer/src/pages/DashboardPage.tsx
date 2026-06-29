import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";

import contextforgeMarkWhite from "../assets/brand/contextforge-mark-white.png";

import { getAppSettings } from "../api/client";
import type { AppSettings } from "../types";

import { AppTitleBar } from "../components/layout/AppTitleBar";
import { Sidebar, type AppPageId } from "../components/layout/Sidebar";

import { StatusBar } from "../components/ui/StatusBar";
import { ProjectsSection } from "../components/projects/ProjectsSection";

import { AgentsPreviewModal } from "../components/modals/AgentsPreviewModal";
import { TaskPackBuilderPage } from "./TaskPackBuilderPage";
import { TaskPackResultPage } from "./TaskPackResultPage";
import { TemplatesPage } from "./TemplatesPage";

import { DashboardHomePage } from "./DashboardHomePage";

import { useDashboardController } from "../hooks/useDashboardController";

import { TaskPacksPage } from "./TaskPacksPage";
import { ContextBuilderPage } from "./ContextBuilderPage";
import { SettingsPage } from "./SettingsPage";
import { PlaceholderPage } from "./PlaceholderPage";
import { ReportsPage } from "./ReportsPage";

import { ContextComposerPage } from "./ContextComposerPage";

import { LoadingOverlay } from "../components/ui/LoadingOverlay";

import { GlobalSearchModal } from "../components/modals/GlobalSearchModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { appMeta } from "../config/appMeta";
import i18n, { applyAppLanguage } from "../i18n";

const PAGE_ORDER: AppPageId[] = [
  "dashboard",
  "projects",
  "context",
  "taskPacks",
  "reports",
  "agents",
  "templates",
  "integrations",
  "settings"
];

const PAGE_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1]
} as const;

function getPageOrderIndex(page: AppPageId) {
  const index = PAGE_ORDER.indexOf(page);
  return index === -1 ? 0 : index;
}

const SPLASH_PARTICLES = Array.from({ length: 14 }, (_, index) => ({
  id: index,
  left: `${10 + ((index * 23) % 80)}%`,
  top: `${14 + ((index * 29) % 70)}%`,
  delay: 0.12 + index * 0.045
}));

function WelcomeSplashOverlay({
  progress,
  status
}: {
  progress: number;
  status: string;
}) {
  const { t } = useTranslation();
  const safeProgress = Math.max(8, Math.min(100, progress));

  return (
    <motion.div
      key="contextforge-welcome-splash"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.34,
        ease: [0.16, 1, 0.3, 1]
      }}
      className="fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-black"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.10),transparent_32rem)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.04] blur-3xl" />
      <div className="pointer-events-none absolute -left-20 top-24 size-72 rounded-full bg-white/[0.025] blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-20 size-72 rounded-full bg-white/[0.025] blur-3xl" />

      <div className="pointer-events-none absolute inset-0">
        {SPLASH_PARTICLES.map((particle) => (
          <motion.span
            key={particle.id}
            initial={{ opacity: 0, y: 12, scale: 0.65 }}
            animate={{
              opacity: [0, 0.55, 0],
              y: [8, -18],
              scale: [0.65, 1, 0.8]
            }}
            transition={{
              delay: particle.delay,
              duration: 2.2,
              ease: "easeInOut"
            }}
            className="absolute size-1 rounded-full bg-white/45 shadow-[0_0_16px_rgba(255,255,255,0.7)]"
            style={{
              left: particle.left,
              top: particle.top
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{
          opacity: 0,
          y: 22,
          scale: 0.965
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1
        }}
        exit={{
          opacity: 0,
          y: -14,
          scale: 0.985
        }}
        transition={{
          duration: 0.5,
          ease: [0.16, 1, 0.3, 1]
        }}
        className="relative w-[min(580px,calc(100vw-48px))] overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950/85 p-7 text-center shadow-[0_34px_110px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl"
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.014)_48%,rgba(255,255,255,0.004))]" />

        <motion.div
          aria-hidden="true"
          initial={{ x: "-140%", opacity: 0 }}
          animate={{ x: "140%", opacity: [0, 0.7, 0] }}
          transition={{
            delay: 0.28,
            duration: 1.35,
            ease: [0.16, 1, 0.3, 1]
          }}
          className="absolute inset-y-0 left-0 w-28 rotate-12 bg-white/15 blur-2xl"
        />

        <div className="relative z-10">
          <motion.div
            initial={{ scale: 0.76, opacity: 0, rotate: -7 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.86, opacity: 0, rotate: 6 }}
            transition={{
              delay: 0.08,
              type: "spring",
              stiffness: 480,
              damping: 26,
              mass: 0.75
            }}
            className="mx-auto mb-5 grid size-16 place-items-center rounded-[1.35rem] border border-white/10 bg-black/50 shadow-[0_18px_54px_rgba(255,255,255,0.10),inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <img
              src={contextforgeMarkWhite}
              alt="ContextForge"
              draggable={false}
              className="size-10 object-contain"
            />
          </motion.div>

          <div className="mb-4 flex flex-wrap justify-center gap-2">
            {[appMeta.phase, t("common.localFirst"), t("splash.composerReady")].map((badge, index) => (
              <motion.span
                key={badge}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{
                  delay: 0.16 + index * 0.08,
                  duration: 0.32,
                  ease: [0.16, 1, 0.3, 1]
                }}
                className="cf-badge"
              >
                {index === 0 && <Sparkles size={12} />}
                {badge}
              </motion.span>
            ))}
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{
              delay: 0.28,
              duration: 0.42,
              ease: [0.16, 1, 0.3, 1]
            }}
            className="text-[36px] font-semibold leading-[1.02] tracking-[-0.06em] text-white"
          >
            {t("splash.welcome")}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              delay: 0.38,
              duration: 0.42,
              ease: [0.16, 1, 0.3, 1]
            }}
            className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-500"
          >
            {t("splash.description")}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              delay: 0.5,
              duration: 0.36,
              ease: [0.16, 1, 0.3, 1]
            }}
            className="mx-auto mt-6 w-full max-w-[340px]"
          >
            <div className="mb-3 flex items-center justify-center gap-2 rounded-full border border-neutral-900 bg-black/45 px-4 py-2 text-xs text-neutral-400">
              <Loader2 size={14} className="animate-spin" />
              <motion.span
                key={status}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
              >
                {status}
              </motion.span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full border border-white/10 bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
              <motion.div
                initial={false}
                animate={{ width: `${safeProgress}%` }}
                transition={{
                  type: "spring",
                  stiffness: 170,
                  damping: 26,
                  mass: 0.8
                }}
                className="h-full rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.5)]"
              />
            </div>

            <p className="mt-2 text-center text-[11px] text-neutral-700">
              {Math.round(safeProgress)}%
            </p>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function DashboardPage() {
  const dashboard = useDashboardController();

  const [activePage, setActivePage] = useState<AppPageId>("dashboard");
  const [pageDirection, setPageDirection] = useState(1);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const [isWelcomeVisible, setIsWelcomeVisible] = useState(true);
  const [minimumSplashDone, setMinimumSplashDone] = useState(false);
  const [shellSettingsReady, setShellSettingsReady] = useState(false);
  const [bootProgress, setBootProgress] = useState(12);
  const [bootStatus, setBootStatus] = useState(() => i18n.t("splash.starting"));

  useKeyboardShortcuts({
    globalSearch: () => setIsGlobalSearchOpen(true)
  });

  const handleNavigate = useCallback(
    (nextPage: AppPageId) => {
      const currentIndex = getPageOrderIndex(activePage);
      const nextIndex = getPageOrderIndex(nextPage);

      dashboard.setTaskPackDraft(null);
      dashboard.setContextComposerPreview(null);
      dashboard.setGeneratedTaskPack(null);

      setPageDirection(nextIndex >= currentIndex ? 1 : -1);
      setActivePage(nextPage);
    },
    [activePage, dashboard]
  );

  useEffect(() => {
    let isMounted = true;

    async function loadShellSettings() {
      try {
        setBootProgress(24);
        setBootStatus(i18n.t("splash.loadingPrefs"));

        const settings = await getAppSettings();

        if (isMounted) {
          setAppSettings(settings);
          void applyAppLanguage(settings.language ?? "system");
          setShellSettingsReady(true);
          setBootProgress(48);
          setBootStatus(i18n.t("splash.restoringLayout"));
        }
      } catch {
        if (isMounted) {
          setAppSettings(null);
          setShellSettingsReady(true);
          setBootProgress(48);
          setBootStatus(i18n.t("splash.defaultPrefs"));
        }
      }
    }

    function handleSettingsUpdated(event: Event) {
      const customEvent = event as CustomEvent<AppSettings>;

      if (customEvent.detail) {
        setAppSettings(customEvent.detail);
        void applyAppLanguage(customEvent.detail.language ?? "system");
      }
    }

    loadShellSettings();

    window.addEventListener(
      "contextforge:settings-updated",
      handleSettingsUpdated
    );

    return () => {
      isMounted = false;
      window.removeEventListener(
        "contextforge:settings-updated",
        handleSettingsUpdated
      );
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setMinimumSplashDone(true);
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setBootProgress(100);
      setBootStatus(i18n.t("splash.openingWorkspace"));
      setIsWelcomeVisible(false);
    }, 5200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!isWelcomeVisible) {
      return;
    }

    if (!shellSettingsReady) {
      return;
    }

    if (dashboard.isLoading) {
      setBootProgress((current) => Math.max(current, 68));
      setBootStatus(dashboard.statusMessage || i18n.t("splash.loadingWorkspace"));
      return;
    }

    if (!minimumSplashDone) {
      setBootProgress((current) => Math.max(current, 86));
      setBootStatus(i18n.t("splash.preparingWorkspace"));
      return;
    }

    setBootProgress(100);
    setBootStatus(i18n.t("splash.workspaceReady"));

    const timeoutId = window.setTimeout(() => {
      setIsWelcomeVisible(false);
    }, 420);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    dashboard.isLoading,
    dashboard.statusMessage,
    isWelcomeVisible,
    minimumSplashDone,
    shellSettingsReady
  ]);

  const content = useMemo(() => {
    if (dashboard.generatedTaskPack) {
      return (
        <TaskPackResultPage
          taskPack={dashboard.generatedTaskPack}
          onClose={() => dashboard.setGeneratedTaskPack(null)}
          onOpenArchive={() => {
            dashboard.setGeneratedTaskPack(null);
            handleNavigate("taskPacks");
          }}
        />
      );
    }

    if (dashboard.contextComposerPreview) {
      return (
        <ContextComposerPage
          preview={dashboard.contextComposerPreview}
          isLoading={dashboard.isLoading}
          onClose={() => dashboard.setContextComposerPreview(null)}
          onGenerate={dashboard.handleCreateTaskPackFromComposer}
        />
      );
    }

    if (dashboard.taskPackDraft) {
      return (
        <TaskPackBuilderPage
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          onChange={dashboard.setTaskPackDraft}
          onClose={() => dashboard.setTaskPackDraft(null)}
          onAnalyzeContext={dashboard.handleAnalyzeTaskContext}
          onGenerate={dashboard.handleCreateTaskPack}
        />
      );
    }
    if (dashboard.generatedTaskPack) {
      return (
        <TaskPackResultPage
          taskPack={dashboard.generatedTaskPack}
          onClose={() => dashboard.setGeneratedTaskPack(null)}
          onOpenArchive={() => {
            dashboard.setGeneratedTaskPack(null);
            handleNavigate("taskPacks");
          }}
        />
      );
    }

    if (dashboard.taskPackDraft) {
      return (
        <TaskPackBuilderPage
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          onChange={dashboard.setTaskPackDraft}
          onClose={() => dashboard.setTaskPackDraft(null)}
          onAnalyzeContext={dashboard.handleAnalyzeTaskContext}
          onGenerate={dashboard.handleCreateTaskPack}
        />
      );
    }
    if (activePage === "dashboard") {
      return (
        <DashboardHomePage
          projects={dashboard.projects}
          taskPacks={dashboard.taskPacks}
          readinessScore={dashboard.readinessScore}
          statusMessage={dashboard.statusMessage}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onOpenProjects={() => handleNavigate("projects")}
          onOpenContextBuilder={() => handleNavigate("context")}
          onOpenTaskPacks={() => handleNavigate("taskPacks")}
          onOpenSettings={() => handleNavigate("settings")}
          onRescanProject={dashboard.handleRescanProject}
          onGenerateAgents={dashboard.handleGenerateAgentsPreview}
          onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
          onOpenTaskPack={dashboard.setGeneratedTaskPack}
        />
      );
    }

    if (activePage === "projects") {
      return (
        <>
          <div className="mb-6">
            <StatusBar message={dashboard.statusMessage} />
          </div>

          <ProjectsSection
            projects={dashboard.projects}
            expandedProjectId={dashboard.expandedProjectId}
            isLoading={dashboard.isLoading}
            onAddProject={dashboard.handleSelectProject}
            onToggleProject={dashboard.handleToggleProject}
            onRescanProject={dashboard.handleRescanProject}
            onGenerateAgents={dashboard.handleGenerateAgentsPreview}
            onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
          />
        </>
      );
    }

    if (activePage === "taskPacks") {
      return (
        <>
          <div className="mb-6">
            <StatusBar message={dashboard.statusMessage} />
          </div>

          <TaskPacksPage
            taskPacks={dashboard.taskPacks}
            onOpenTaskPack={dashboard.setGeneratedTaskPack}
          />
        </>
      );
    }

    if (activePage === "context") {
      return (
        <ContextBuilderPage
          projects={dashboard.projects}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onGenerateAgents={dashboard.handleGenerateAgentsPreview}
          onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
        />
      );
    }

    if (activePage === "reports") {
      return (
        <ReportsPage
          projects={dashboard.projects}
          taskPacks={dashboard.taskPacks}
          readinessScore={dashboard.readinessScore}
          statusMessage={dashboard.statusMessage}
          onOpenProjects={() => handleNavigate("projects")}
          onOpenTaskPacks={() => handleNavigate("taskPacks")}
          onOpenTaskPack={dashboard.setGeneratedTaskPack}
        />
      );
    }

    if (activePage === "templates") {
      return <TemplatesPage />;
    }

    if (activePage === "settings") {
      return <SettingsPage />;
    }

    return <PlaceholderPage pageId={activePage} />;
  }, [activePage, dashboard, handleNavigate]);

  return (
    <main className="relative h-screen min-h-0 w-screen overflow-hidden bg-black text-neutral-100">
      <div className="flex h-full min-h-0 w-full flex-col">
        <AppTitleBar
          activePage={activePage}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onNavigate={handleNavigate}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            activePage={activePage}
            showDescriptions={appSettings?.sidebarShowDescriptions ?? false}
            onNavigate={handleNavigate}
          />

          <section className="flex min-w-0 flex-1 flex-col bg-black">
            <div className="min-h-0 flex-1 overflow-auto p-7">
              <motion.div
                key={activePage}
                initial={{
                  opacity: 0,
                  x: pageDirection > 0 ? 14 : -14,
                  y: 6,
                  scale: 0.998
                }}
                animate={{
                  opacity: 1,
                  x: 0,
                  y: 0,
                  scale: 1
                }}
                transition={PAGE_TRANSITION}
                className="min-h-full"
                style={{ willChange: "transform, opacity" }}
              >
                {content}
              </motion.div>
            </div>
          </section>
        </div>

        {dashboard.agentsPreview && (
          <AgentsPreviewModal
            preview={dashboard.agentsPreview}
            isLoading={dashboard.isLoading}
            onClose={() => dashboard.setAgentsPreview(null)}
            onSave={dashboard.handleSaveAgentsFile}
            onRegenerate={dashboard.handleRegenerateAgentsPreview}
          />
        )}

        {isGlobalSearchOpen && (
          <GlobalSearchModal
            activePage={activePage}
            projects={dashboard.projects}
            taskPacks={dashboard.taskPacks}
            onNavigate={handleNavigate}
            onOpenTaskPack={dashboard.setGeneratedTaskPack}
            onAddProject={dashboard.handleSelectProject}
            onClose={() => setIsGlobalSearchOpen(false)}
          />
        )}

        <LoadingOverlay
          isVisible={dashboard.isLoading && !isWelcomeVisible}
          message={dashboard.statusMessage}
        />
      </div>

      <AnimatePresence>
        {isWelcomeVisible && (
          <WelcomeSplashOverlay progress={bootProgress} status={bootStatus} />
        )}
      </AnimatePresence>
    </main>
  );
}
