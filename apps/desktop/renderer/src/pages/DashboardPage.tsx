import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useIsPresent,
  useTransform,
} from "framer-motion";
import { useTranslation } from "react-i18next";
import contextforgeLogoWhite from "../assets/brand/contextforge-logo-white.png";

import { getAppSettings, updateAppSettings } from "../api/client";
import type { AppSettings } from "../types";

import { AppTitleBar } from "../components/layout/AppTitleBar";
import { PageTransition } from "../components/layout/PageTransition";
import { Sidebar, type AppPageId } from "../components/layout/Sidebar";
import {
  resolveDiscordPresenceActivity,
  setDiscordPresenceActivity,
  type DiscordPresenceActivity,
} from "../lib/discordPresence";
import { setDesktopTaskbarProgress } from "../lib/desktopTaskbarProgress";
import { showDesktopNotification } from "../lib/desktopNotifications";
import {
  consumeDesktopNavigationRequest,
  subscribeDesktopNavigationRequests,
  type DesktopNavigationPage,
} from "../lib/desktopNavigation";

import { StatusBar } from "../components/ui/StatusBar";
import { ProjectsSection } from "../components/projects/ProjectsSection";
import { ProjectDetailsPage } from "./ProjectDetailsPage";

import { AgentsPreviewModal } from "../components/modals/AgentsPreviewModal";
import { TaskPackBuilderPage } from "./TaskPackBuilderPage";
import { TaskPackResultPage } from "./TaskPackResultPage";
import { TemplatesPage } from "./TemplatesPage";

import { DashboardHomePage } from "./DashboardHomePage";

import { useDashboardController } from "../hooks/useDashboardController";

import { TaskPacksPage } from "./TaskPacksPage";
import { ContextBuilderPage } from "./ContextBuilderPage";
import { SettingsPage } from "./SettingsPage";
import { AccountSyncPage } from "./AccountSyncPage";
import { PlaceholderPage } from "./PlaceholderPage";
import { ReportsPage } from "./ReportsPage";
import { ScannersPage } from "./ScannersPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { GitHubPage } from "./GitHubPage";
import { AgentsPage } from "./AgentsPage";

import { ContextComposerPage } from "./ContextComposerPage";

import { LoadingOverlay } from "../components/ui/LoadingOverlay";
import { FirstRunOnboardingOverlay } from "../components/onboarding/FirstRunOnboardingOverlay";

import { GlobalSearchModal } from "../components/modals/GlobalSearchModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import i18n, { applyAppLanguage } from "../i18n";

const PAGE_ORDER: AppPageId[] = [
  "dashboard",
  "projects",
  "scanners",
  "context",
  "taskPacks",
  "reports",
  "agents",
  "templates",
  "integrations",
  "github",
  "accountSync",
  "settings",
];

function getPageOrderIndex(page: AppPageId) {
  const index = PAGE_ORDER.indexOf(page);
  return index === -1 ? 0 : index;
}

const SPLASH_PARTICLES = Array.from({ length: 14 }, (_, index) => ({
  id: index,
  left: `${10 + ((index * 23) % 80)}%`,
  top: `${14 + ((index * 29) % 70)}%`,
  delay: 0.12 + index * 0.045,
}));

function WelcomeSplashOverlay({
  progress,
  status,
}: {
  progress: number;
  status: string;
}) {
  const { t } = useTranslation();
  const isPresent = useIsPresent();
  const safeProgress = Math.max(8, Math.min(100, progress));
  const progressMotion = useMotionValue(0);
  const smoothProgress = useSpring(progressMotion, {
    stiffness: 52,
    damping: 20,
    mass: 0.95,
  });
  const progressWidth = useTransform(
    smoothProgress,
    (value) => `${Math.max(0, Math.min(100, value))}%`,
  );
  const [progressLabel, setProgressLabel] = useState(0);

  useMotionValueEvent(smoothProgress, "change", (latest) => {
    setProgressLabel(Math.round(Math.max(0, Math.min(100, latest))));
  });

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      progressMotion.set(safeProgress);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [progressMotion, safeProgress]);

  return (
    <motion.div
      key="contextforge-welcome-splash"
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.018, filter: "blur(10px)" }}
      transition={{
        duration: 0.82,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-black"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(255,255,255,0.075),transparent_28rem)]" />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[min(900px,82vw)] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-white/[0.055] to-transparent"
        initial={{ opacity: 0, scaleX: 0.45 }}
        animate={{ opacity: [0, 1, 0.62], scaleX: 1 }}
        transition={{ duration: 1.15, ease: [0.16, 1, 0.3, 1] }}
      />

      <div className="pointer-events-none absolute inset-0">
        {SPLASH_PARTICLES.slice(0, 10).map((particle) => (
          <motion.span
            key={particle.id}
            initial={{ opacity: 0, y: 8, scale: 0.7 }}
            animate={{
              opacity: [0, 0.34, 0],
              y: [8, -14],
              scale: [0.7, 1, 0.78],
            }}
            transition={{
              delay: particle.delay + 0.2,
              duration: 2.8,
              repeat: Infinity,
              repeatDelay: 1.2 + particle.id * 0.08,
              ease: "easeInOut",
            }}
            className="absolute size-0.5 rounded-full bg-white/55 shadow-[0_0_12px_rgba(255,255,255,0.65)]"
            style={{
              left: particle.left,
              top: particle.top,
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, filter: "blur(14px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -16, filter: "blur(9px)" }}
        transition={{
          duration: 0.9,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="relative flex w-[min(720px,calc(100vw-48px))] flex-col items-center text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 26, scale: 0.94, filter: "blur(12px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, scale: 0.985, filter: "blur(7px)" }}
          transition={{
            delay: 0.14,
            duration: 1.05,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="relative flex h-[150px] w-full max-w-[520px] items-center justify-center overflow-hidden"
        >
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-8 left-0 w-24 rotate-12 bg-white/12 blur-2xl"
            initial={{ x: "-180%", opacity: 0 }}
            animate={{ x: "620%", opacity: [0, 0.7, 0] }}
            transition={{ delay: 0.86, duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          />
          <img
            src={contextforgeLogoWhite}
            alt="ContextForge"
            draggable={false}
            className="w-full max-w-[500px] select-none object-contain"
          />
        </motion.div>

        <motion.div
          aria-hidden="true"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 72, opacity: 1 }}
          transition={{ delay: 0.72, duration: 0.68, ease: [0.16, 1, 0.3, 1] }}
          className="h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
        />

        <motion.p
          initial={{ opacity: 0, y: 14, letterSpacing: "0.62em", filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, letterSpacing: "0.18em", filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(5px)" }}
          transition={{
            delay: 0.78,
            duration: 0.82,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-5 text-[15px] font-medium uppercase text-neutral-300"
        >
          {t("splash.welcomeWord")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16, filter: "blur(7px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(5px)" }}
          transition={{
            delay: 1.18,
            duration: 0.68,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-11 w-full max-w-[410px]"
        >
          <div className="mb-3 flex items-center justify-between gap-4 px-0.5 text-[11px] font-medium text-neutral-600">
            <motion.span
              key={status}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
              className="truncate text-left"
            >
              {status}
            </motion.span>
            <span className="shrink-0 font-mono text-neutral-500">{progressLabel}%</span>
          </div>

          <div className="relative h-[3px] overflow-visible bg-gradient-to-r from-white/[0.035] via-white/[0.11] to-white/[0.035]">
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 bg-white/[0.07]"
              animate={{ opacity: [0.16, 0.5, 0.16] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />

            <motion.div
              style={{ width: progressWidth }}
              className="relative h-full overflow-hidden bg-white shadow-[0_0_18px_rgba(255,255,255,0.42)]"
            >
              <motion.span
                aria-hidden="true"
                className="absolute inset-y-[-4px] left-0 w-24 bg-gradient-to-r from-transparent via-black/20 to-transparent blur-[1px]"
                animate={{ x: ["-130%", "520%"] }}
                transition={{ duration: 1.9, repeat: Infinity, ease: "linear" }}
              />
              <motion.span
                aria-hidden="true"
                className="absolute inset-y-[-5px] left-0 w-16 bg-gradient-to-r from-transparent via-white/65 to-transparent blur-[2px]"
                animate={{ x: ["-150%", "650%"] }}
                transition={{ duration: 2.65, repeat: Infinity, ease: "linear", delay: 0.2 }}
              />
            </motion.div>

            <motion.span
              aria-hidden="true"
              style={{ left: progressWidth }}
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.9)]"
              animate={{
                scale: [0.82, 1.22, 0.82],
                opacity: [0.7, 1, 0.7],
                boxShadow: [
                  "0 0 10px rgba(255,255,255,0.55)",
                  "0 0 22px rgba(255,255,255,0.95)",
                  "0 0 10px rgba(255,255,255,0.55)",
                ],
              }}
              transition={{ duration: 1.45, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>

          <div className="mt-3 flex justify-center gap-1.5">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                className="size-1 rounded-full bg-white/20"
                animate={{ opacity: [0.18, 0.72, 0.18], scale: [0.85, 1.08, 0.85] }}
                transition={{
                  duration: 1.2,
                  delay: index * 0.16,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function DashboardPage() {
  const dashboard = useDashboardController();

  const [activePage, setActivePage] = useState<AppPageId>("dashboard");
  const [reportsPresenceActivity, setReportsPresenceActivity] =
    useState<"reports" | "validation_lab">("reports");
  const [operationPresenceActivity, setOperationPresenceActivity] =
    useState<DiscordPresenceActivity | null>(null);
  const previousOperationForNotificationRef =
    useRef<DiscordPresenceActivity | null>(null);
  const [pageDirection, setPageDirection] = useState(1);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [onboardingDismissedThisSession, setOnboardingDismissedThisSession] =
    useState(false);
  const [selectedProjectDetailsId, setSelectedProjectDetailsId] = useState<
    number | null
  >(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const [isWelcomeVisible, setIsWelcomeVisible] = useState(true);
  const [minimumSplashDone, setMinimumSplashDone] = useState(false);
  const [shellSettingsReady, setShellSettingsReady] = useState(false);
  const [bootProgress, setBootProgress] = useState(12);
  const [bootStatus, setBootStatus] = useState(() => i18n.t("splash.starting"));

  useKeyboardShortcuts({
    globalSearch: () => setIsGlobalSearchOpen(true),
  });

  const pageDiscordPresenceActivity = resolveDiscordPresenceActivity({
    activePage,
    hasGeneratedTaskPack: Boolean(dashboard.generatedTaskPack),
    hasContextComposerPreview: Boolean(dashboard.contextComposerPreview),
    hasTaskPackDraft: Boolean(dashboard.taskPackDraft),
    hasSelectedProjectDetails: selectedProjectDetailsId !== null,
    reportsActivity: reportsPresenceActivity,
  });
  const discordPresenceActivity =
    operationPresenceActivity ?? pageDiscordPresenceActivity;

  useEffect(() => {
    void setDiscordPresenceActivity(discordPresenceActivity);
  }, [discordPresenceActivity]);

  useEffect(() => {
    void setDesktopTaskbarProgress(operationPresenceActivity !== null);
  }, [operationPresenceActivity]);

  useEffect(
    () => () => {
      void setDesktopTaskbarProgress(false);
    },
    [],
  );

  useEffect(() => {
    const previousOperation = previousOperationForNotificationRef.current;
    previousOperationForNotificationRef.current = operationPresenceActivity;

    if (operationPresenceActivity !== null) {
      return;
    }

    if (
      previousOperation === "generating_task_pack" &&
      dashboard.generatedTaskPack
    ) {
      void showDesktopNotification("task_pack_generated");
      return;
    }

    if (previousOperation === "running_validation") {
      void showDesktopNotification("validation_finished");
    }
  }, [dashboard.generatedTaskPack, operationPresenceActivity]);

  const handleAnalyzeTaskContextWithPresence = useCallback(
    async (...args: Parameters<typeof dashboard.handleAnalyzeTaskContext>) => {
      setOperationPresenceActivity("analyzing_task_context");

      try {
        await dashboard.handleAnalyzeTaskContext(...args);
      } finally {
        setOperationPresenceActivity(null);
      }
    },
    [dashboard.handleAnalyzeTaskContext],
  );

  const handleCreateTaskPackWithPresence = useCallback(
    async (...args: Parameters<typeof dashboard.handleCreateTaskPack>) => {
      setOperationPresenceActivity("generating_task_pack");

      try {
        await dashboard.handleCreateTaskPack(...args);
      } finally {
        setOperationPresenceActivity(null);
      }
    },
    [dashboard.handleCreateTaskPack],
  );

  const handleCreateTaskPackFromComposerWithPresence = useCallback(
    async (
      ...args: Parameters<typeof dashboard.handleCreateTaskPackFromComposer>
    ) => {
      setOperationPresenceActivity("generating_task_pack");

      try {
        await dashboard.handleCreateTaskPackFromComposer(...args);
      } finally {
        setOperationPresenceActivity(null);
      }
    },
    [dashboard.handleCreateTaskPackFromComposer],
  );

  const handleValidationRunStateChange = useCallback((running: boolean) => {
    setOperationPresenceActivity(running ? "running_validation" : null);
  }, []);

  const handleNavigate = useCallback(
    (nextPage: AppPageId) => {
      const currentIndex = getPageOrderIndex(activePage);
      const nextIndex = getPageOrderIndex(nextPage);

      dashboard.setTaskPackDraft(null);
      dashboard.setContextComposerPreview(null);
      dashboard.setGeneratedTaskPack(null);
      setSelectedProjectDetailsId(null);

      setPageDirection(nextIndex >= currentIndex ? 1 : -1);
      setActivePage(nextPage);
    },
    [activePage, dashboard],
  );

  useEffect(() => {
    const bridge = window.contextforge?.desktopSync;
    if (!bridge) return undefined;

    let disposed = false;
    const openAccountSync = () => {
      if (!disposed) handleNavigate("accountSync");
    };
    const unsubscribe = bridge.onLaunchRequest(openAccountSync);

    void bridge.peekLaunchRequest().then((request) => {
      if (request) openAccountSync();
    }).catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [handleNavigate]);

  const handleDesktopNavigationRequest = useCallback(
    (page: DesktopNavigationPage) => {
      handleNavigate(page);
    },
    [handleNavigate],
  );

  useEffect(() => {
    let disposed = false;

    void consumeDesktopNavigationRequest().then((page) => {
      if (!disposed && page) {
        handleDesktopNavigationRequest(page);
      }
    });

    const unsubscribe = subscribeDesktopNavigationRequests(
      handleDesktopNavigationRequest,
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [handleDesktopNavigationRequest]);

  const handleOpenProjectDetails = useCallback(
    (projectId: number) => {
      const currentIndex = getPageOrderIndex(activePage);
      const nextIndex = getPageOrderIndex("projects");

      dashboard.setTaskPackDraft(null);
      dashboard.setContextComposerPreview(null);
      dashboard.setGeneratedTaskPack(null);

      setPageDirection(nextIndex >= currentIndex ? 1 : -1);
      setActivePage("projects");
      setSelectedProjectDetailsId(projectId);
    },
    [activePage, dashboard],
  );

  const completeFirstRunOnboarding = useCallback(async () => {
    setOnboardingDismissedThisSession(true);

    setAppSettings((currentSettings) =>
      currentSettings
        ? {
          ...currentSettings,
          onboardingCompleted: true,
        }
        : currentSettings,
    );

    try {
      const updatedSettings = await updateAppSettings({
        onboardingCompleted: true,
      });

      setAppSettings(updatedSettings);
      window.dispatchEvent(
        new CustomEvent("contextforge:settings-updated", {
          detail: updatedSettings,
        }),
      );
    } catch {
      // Keep the optimistic local close so onboarding never traps the user.
    }
  }, []);

  const handleStartFirstRunSetup = useCallback(async () => {
    await completeFirstRunOnboarding();
    handleNavigate("dashboard");
  }, [completeFirstRunOnboarding, handleNavigate]);

  const handleSkipFirstRunSetup = useCallback(async () => {
    await completeFirstRunOnboarding();
  }, [completeFirstRunOnboarding]);

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
      handleSettingsUpdated,
    );

    return () => {
      isMounted = false;
      window.removeEventListener(
        "contextforge:settings-updated",
        handleSettingsUpdated,
      );
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setMinimumSplashDone(true);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let closeTimeoutId: number | null = null;

    const timeoutId = window.setTimeout(() => {
      setBootProgress(100);
      setBootStatus(i18n.t("splash.openingWorkspace"));

      closeTimeoutId = window.setTimeout(() => {
        setIsWelcomeVisible(false);
      }, 900);
    }, 8000);

    return () => {
      window.clearTimeout(timeoutId);

      if (closeTimeoutId !== null) {
        window.clearTimeout(closeTimeoutId);
      }
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
      setBootStatus(
        dashboard.statusMessage || i18n.t("splash.loadingWorkspace"),
      );
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
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    dashboard.isLoading,
    dashboard.statusMessage,
    isWelcomeVisible,
    minimumSplashDone,
    shellSettingsReady,
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
          onTaskPackUpdated={dashboard.handleExternalTaskPackUpdated}
          onOpenInBuilder={dashboard.handleOpenTaskPackInBuilder}
        />
      );
    }

    if (dashboard.contextComposerPreview) {
      return (
        <ContextComposerPage
          preview={dashboard.contextComposerPreview}
          isLoading={dashboard.isLoading}
          onClose={() => dashboard.setContextComposerPreview(null)}
          onGenerate={handleCreateTaskPackFromComposerWithPresence}
        />
      );
    }

    if (dashboard.taskPackDraft) {
      return (
        <TaskPackBuilderPage
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          contextPreview={dashboard.taskPackContextPreview}
          onChange={dashboard.setTaskPackDraft}
          onClose={() => dashboard.setTaskPackDraft(null)}
          onAnalyzeContext={handleAnalyzeTaskContextWithPresence}
          onOpenContextComposer={dashboard.handleOpenTaskContextComposer}
          onGenerate={handleCreateTaskPackWithPresence}
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
          onTaskPackUpdated={dashboard.handleExternalTaskPackUpdated}
          onOpenInBuilder={dashboard.handleOpenTaskPackInBuilder}
        />
      );
    }

    if (dashboard.taskPackDraft) {
      return (
        <TaskPackBuilderPage
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          contextPreview={dashboard.taskPackContextPreview}
          onChange={dashboard.setTaskPackDraft}
          onClose={() => dashboard.setTaskPackDraft(null)}
          onAnalyzeContext={handleAnalyzeTaskContextWithPresence}
          onOpenContextComposer={dashboard.handleOpenTaskContextComposer}
          onGenerate={handleCreateTaskPackWithPresence}
        />
      );
    }
    if (selectedProjectDetailsId !== null) {
      const selectedProject = dashboard.projects.find(
        (project) => project.id === selectedProjectDetailsId,
      );

      if (selectedProject) {
        return (
          <ProjectDetailsPage
            project={selectedProject}
            isLoading={dashboard.isLoading}
            onBack={() => setSelectedProjectDetailsId(null)}
            onRescan={dashboard.handleRescanProject}
            onGenerateAgents={dashboard.handleGenerateAgentsPreview}
            onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
            onCreateTaskPackFromChanges={
              dashboard.handleCreateTaskPackDraftFromChanges
            }
          />
        );
      }
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
        <ProjectsSection
          projects={dashboard.projects}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onRescanProject={dashboard.handleRescanProject}
          onGenerateAgents={dashboard.handleGenerateAgentsPreview}
          onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
          onOpenProjectDetails={(project) =>
            handleOpenProjectDetails(project.id)
          }
        />
      );
    }

    if (activePage === "taskPacks") {
      return (
        <TaskPacksPage
          taskPacks={dashboard.taskPacks}
          onOpenTaskPack={dashboard.setGeneratedTaskPack}
          onImportedTaskPack={dashboard.handleExternalTaskPackCreated}
        />
      );
    }

    if (activePage === "scanners") {
      return (
        <ScannersPage
          projects={dashboard.projects}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onRescanProject={dashboard.handleRescanProject}
          onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
        />
      );
    }

    if (activePage === "context") {
      return (
        <ContextBuilderPage
          projects={dashboard.projects}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onGenerateAgents={dashboard.handleGenerateAgentsPreview}
          onOpenContextFile={dashboard.handleOpenProjectContextFile}
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
          onOpenProjects={() => handleNavigate("projects")}
          onOpenTaskPacks={() => handleNavigate("taskPacks")}
          onOpenTaskPack={dashboard.setGeneratedTaskPack}
          onPresenceActivityChange={setReportsPresenceActivity}
          onValidationRunStateChange={handleValidationRunStateChange}
        />
      );
    }

    if (activePage === "agents") {
      return (
        <AgentsPage
          onOpenContextBuilder={() => handleNavigate("context")}
          onOpenTemplates={() => handleNavigate("templates")}
        />
      );
    }

    if (activePage === "templates") {
      return <TemplatesPage />;
    }

    if (activePage === "integrations") {
      return (
        <IntegrationsPage
          onOpenGitHub={() => handleNavigate("github")}
          onOpenSettings={() => handleNavigate("settings")}
          onOpenAccountSync={() => handleNavigate("accountSync")}
        />
      );
    }

    if (activePage === "github") {
      return (
        <GitHubPage
          onTaskPackCreated={dashboard.handleExternalTaskPackCreated}
        />
      );
    }

    if (activePage === "accountSync") {
      return <AccountSyncPage />;
    }

    if (activePage === "settings") {
      return <SettingsPage />;
    }

    return <PlaceholderPage pageId={activePage} />;
  }, [
    activePage,
    dashboard,
    handleNavigate,
    handleOpenProjectDetails,
    selectedProjectDetailsId,
  ]);

  const contentTransitionKey = useMemo(() => {
    if (dashboard.generatedTaskPack) {
      return `task-pack-result-${dashboard.generatedTaskPack.id}`;
    }

    if (dashboard.contextComposerPreview) {
      return `context-composer-${dashboard.contextComposerPreview.project.id}-${dashboard.contextComposerPreview.task.rawTask}`;
    }

    if (dashboard.taskPackDraft) {
      return `task-pack-draft-${dashboard.taskPackDraft.projectId}`;
    }

    if (selectedProjectDetailsId !== null) {
      return `project-details-${selectedProjectDetailsId}`;
    }

    return activePage;
  }, [
    activePage,
    dashboard.contextComposerPreview,
    dashboard.generatedTaskPack,
    dashboard.taskPackDraft,
    selectedProjectDetailsId,
  ]);

  const shouldShowFirstRunOnboarding = Boolean(
    !isWelcomeVisible &&
    shellSettingsReady &&
    appSettings &&
    !onboardingDismissedThisSession &&
    appSettings.onboardingEnabled !== false &&
    (appSettings.onboardingShowEveryLaunch !== false ||
      !appSettings.onboardingCompleted),
  );

  return (
    <main className="relative h-screen min-h-0 w-screen overflow-hidden bg-black text-neutral-100">
      <motion.div
        initial={false}
        animate={{
          opacity: isWelcomeVisible ? 0.42 : 1,
          scale: isWelcomeVisible ? 0.992 : 1,
          filter: isWelcomeVisible ? "blur(10px)" : "blur(0px)",
        }}
        transition={{
          duration: 0.92,
          delay: isWelcomeVisible ? 0 : 0.08,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="flex h-full min-h-0 w-full flex-col"
      >
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
              <PageTransition
                pageKey={contentTransitionKey}
                direction={pageDirection}
              >
                {content}
              </PageTransition>
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

        <AnimatePresence>
          {shouldShowFirstRunOnboarding && (
            <FirstRunOnboardingOverlay
              projectsCount={dashboard.projects.length}
              onStartSetup={handleStartFirstRunSetup}
              onSkip={handleSkipFirstRunSetup}
            />
          )}
        </AnimatePresence>

        <LoadingOverlay
          isVisible={
            dashboard.isLoading &&
            !isWelcomeVisible &&
            !shouldShowFirstRunOnboarding
          }
          message={dashboard.statusMessage}
        />
      </motion.div>

      <StatusBar
        message={
          dashboard.statusMessage === i18n.t("common.statusReady")
            ? ""
            : dashboard.statusMessage
        }
      />

      <AnimatePresence>
        {isWelcomeVisible && (
          <WelcomeSplashOverlay progress={bootProgress} status={bootStatus} />
        )}
      </AnimatePresence>
    </main>
  );
}
