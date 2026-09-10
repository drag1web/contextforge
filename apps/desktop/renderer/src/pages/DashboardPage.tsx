import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useIsPresent,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useTranslation } from "react-i18next";
import contextforgeLogoWhite from "../assets/brand/contextforge-logo-white.png";

import { getAppSettings, updateAppSettings } from "../api/client";
import type {
  AppSettings,
  TaskPack,
  TaskPackDraft,
} from "../types";
import type { QuickPeekTarget } from "../types/quickPeek";
import type { InspectorTarget } from "../types/inspector";

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
import { CommandPaletteModal } from "../components/modals/CommandPaletteModal";
import { QuickPeekPanel } from "../components/workspace/QuickPeekPanel";
import { PersistentInspectorPanel } from "../components/workspace/PersistentInspectorPanel";
import { ExplainabilityLensPanel } from "../components/workspace/ExplainabilityLensPanel";
import { ContextMapPanel } from "../components/workspace/ContextMapPanel";
import { WorkspaceZoomHud } from "../components/workspace/WorkspaceZoomHud";
import {
  advanceContextDiffSession,
  type ContextDiffSessionState,
} from "../components/workspace/contextDiff";
import {
  buildContextComposerReviewedSelection,
  taskContextDraftsMatch,
} from "../utils/contextComposerReviewedDraft";
import {
  getWorkspaceDensityPadding,
  resolveWorkspaceDensity,
} from "../utils/workspaceDensity";
import {
  buildTaskPackFreshnessIndex,
  deriveTaskPackFreshness,
} from "../utils/taskPackFreshness";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useWorkspaceZoom } from "../hooks/useWorkspaceZoom";
import { useGlobalDropNavigationGuard } from "../hooks/useGlobalDropNavigationGuard";
import { buildCommandPaletteCommands } from "../utils/commandPalette";
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationLocation,
} from "../hooks/useWorkspaceNavigationHistory";
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

const SPLASH_EASE = [0.16, 1, 0.3, 1] as const;

const SPLASH_ORBIT_NODES = [
  { id: "n01", x: 350, y: 54, radius: 1.7, opacity: 0.4, layer: "back" },
  { id: "n02", x: 202, y: 112, radius: 1.4, opacity: 0.28, layer: "back" },
  { id: "n03", x: 486, y: 116, radius: 2.1, opacity: 0.58, layer: "mid" },
  { id: "n04", x: 104, y: 246, radius: 1.5, opacity: 0.26, layer: "back" },
  { id: "n05", x: 278, y: 210, radius: 1.9, opacity: 0.48, layer: "front" },
  { id: "n06", x: 438, y: 218, radius: 1.4, opacity: 0.32, layer: "mid" },
  { id: "n07", x: 608, y: 266, radius: 2, opacity: 0.5, layer: "back" },
  { id: "n08", x: 70, y: 388, radius: 1.8, opacity: 0.3, layer: "back" },
  { id: "n09", x: 224, y: 354, radius: 1.3, opacity: 0.3, layer: "mid" },
  { id: "n10", x: 370, y: 350, radius: 2.4, opacity: 0.7, layer: "front" },
  { id: "n11", x: 528, y: 366, radius: 1.4, opacity: 0.32, layer: "mid" },
  { id: "n12", x: 650, y: 410, radius: 1.8, opacity: 0.34, layer: "back" },
  { id: "n13", x: 130, y: 532, radius: 1.4, opacity: 0.24, layer: "back" },
  { id: "n14", x: 302, y: 500, radius: 2, opacity: 0.5, layer: "front" },
  { id: "n15", x: 474, y: 516, radius: 1.4, opacity: 0.3, layer: "mid" },
  { id: "n16", x: 584, y: 584, radius: 2, opacity: 0.48, layer: "back" },
  { id: "n17", x: 244, y: 632, radius: 1.5, opacity: 0.28, layer: "mid" },
  { id: "n18", x: 414, y: 662, radius: 1.8, opacity: 0.36, layer: "back" },
  { id: "n19", x: 345, y: 145, radius: 1.3, opacity: 0.3, layer: "mid" },
  { id: "n20", x: 172, y: 270, radius: 1.8, opacity: 0.48, layer: "front" },
  { id: "n21", x: 360, y: 265, radius: 1.3, opacity: 0.25, layer: "back" },
  { id: "n22", x: 500, y: 295, radius: 1.9, opacity: 0.52, layer: "front" },
  { id: "n23", x: 154, y: 424, radius: 1.3, opacity: 0.3, layer: "mid" },
  { id: "n24", x: 300, y: 405, radius: 1.2, opacity: 0.24, layer: "back" },
  { id: "n25", x: 440, y: 420, radius: 1.9, opacity: 0.56, layer: "front" },
  { id: "n26", x: 565, y: 455, radius: 1.4, opacity: 0.32, layer: "mid" },
  { id: "n27", x: 220, y: 550, radius: 1.8, opacity: 0.45, layer: "front" },
  { id: "n28", x: 385, y: 570, radius: 1.4, opacity: 0.34, layer: "mid" },
  { id: "n29", x: 512, y: 602, radius: 1.8, opacity: 0.46, layer: "front" },
  { id: "n30", x: 340, y: 610, radius: 1.2, opacity: 0.24, layer: "back" },
] as const;

const SPLASH_MESH_LAYERS = [
  {
    id: "back",
    path: "M350 54L202 112L104 246L70 388L130 532L244 632 M414 662L584 584L650 410L608 266L486 116 M202 112L345 145L486 116 M104 246L360 265L608 266 M70 388L300 405L650 410 M130 532L340 610L584 584",
    pathOpacity: 0.22,
  },
  {
    id: "mid",
    path: "M345 145L278 210L360 265L224 354L154 424L302 500L220 550L244 632 M345 145L438 218L500 295L528 366L565 455L474 516L385 570L414 662 M224 354L370 350L528 366 M154 424L300 405L440 420L565 455",
    pathOpacity: 0.32,
  },
  {
    id: "front",
    path: "M278 210L172 270L224 354L370 350L500 295L438 218Z M172 270L154 424L302 500L440 420L370 350 M302 500L220 550L385 570L512 602L474 516L440 420",
    pathOpacity: 0.44,
  },
] as const;

const SPLASH_DATA_ROUTES = [
  { id: "route-west-east", path: "M172 270C300 135 475 145 608 266", from: 19, to: 6 },
  { id: "route-low-arc", path: "M70 388C210 300 425 420 584 584", from: 7, to: 15 },
  { id: "route-diagonal", path: "M202 112C480 190 215 460 512 602", from: 1, to: 28 },
  { id: "route-return", path: "M130 532C175 280 355 330 486 116", from: 12, to: 2 },
] as const;

const SPLASH_ORBITAL_PATHS = [
  "M40 440C118 124 540 42 690 318",
  "M88 566C268 710 598 636 684 384",
  "M164 92C462 28 690 220 650 512",
] as const;

const SplashOrbitalMesh = memo(function SplashOrbitalMesh({
  reducedMotion,
  isComplete,
  eventIndex,
  eventToken,
}: {
  reducedMotion: boolean;
  isComplete: boolean;
  eventIndex: number;
  eventToken: string;
}) {
  const activeRoute = SPLASH_DATA_ROUTES[eventIndex % SPLASH_DATA_ROUTES.length];
  const activeOrbit = SPLASH_ORBITAL_PATHS[eventIndex % SPLASH_ORBITAL_PATHS.length];
  const routeDuration = isComplete ? 0.74 : 1.9;
  const routeDelay = isComplete ? 0 : 0.55;
  const sourceNode = SPLASH_ORBIT_NODES[activeRoute.from];
  const destinationNode = SPLASH_ORBIT_NODES[activeRoute.to];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-[-8vw] top-[51%] aspect-square h-[min(76vh,820px)] -translate-y-1/2"
    >
      <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_42%_45%,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_38%,transparent_70%)]" />
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={
          reducedMotion
            ? { opacity: 0.76 }
            : isComplete
              ? { opacity: 0.9 }
              : { opacity: 0.76 }
        }
        transition={
          reducedMotion
            ? { duration: 0.4, ease: SPLASH_EASE }
            : isComplete
              ? { duration: 0.48, ease: SPLASH_EASE }
              : { duration: 0.9, ease: SPLASH_EASE }
        }
      >
        <svg
          viewBox="0 0 720 720"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <radialGradient id="splash-orbit-fade" cx="50%" cy="48%" r="52%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="70%" stopColor="white" stopOpacity="0.82" />
              <stop offset="94%" stopColor="white" stopOpacity="0.14" />
              <stop offset="100%" stopColor="black" stopOpacity="0" />
            </radialGradient>
            <mask id="splash-orbit-mask">
              <rect width="720" height="720" fill="url(#splash-orbit-fade)" />
            </mask>
          </defs>
          <g mask="url(#splash-orbit-mask)">
            <g fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.85">
              {SPLASH_ORBITAL_PATHS.map((path) => (
                <path key={path} d={path} opacity="0.28" />
              ))}
            </g>

            {SPLASH_MESH_LAYERS.map((layer) => {
              const layerMotion =
                layer.id === "back"
                  ? { x: [0, 5, 0], y: 0 }
                  : layer.id === "mid"
                    ? { x: 0, y: [0, -4, 0] }
                    : { x: [0, -6, 0], y: [0, 2, 0] };
              const layerDuration = layer.id === "back" ? 24 : layer.id === "mid" ? 20 : 28;

              return (
                <motion.g
                  key={layer.id}
                  style={{ willChange: "transform" }}
                  animate={reducedMotion ? { x: 0, y: 0 } : layerMotion}
                  transition={{
                    delay: reducedMotion ? 0 : 0.55,
                    duration: reducedMotion ? 0 : layerDuration,
                    repeat: reducedMotion ? 0 : Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <path
                    d={layer.path}
                    fill="none"
                    stroke="rgba(255,255,255,0.34)"
                    strokeWidth="0.85"
                    opacity={layer.pathOpacity}
                  />
                  {SPLASH_ORBIT_NODES.filter((node) => node.layer === layer.id).map((node) => (
                    <circle
                      key={node.id}
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill="white"
                      opacity={node.opacity}
                    />
                  ))}
                </motion.g>
              );
            })}

            <g fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.9">
              {SPLASH_DATA_ROUTES.map((route) => (
                <path key={route.id} d={route.path} opacity="0.2" />
              ))}
            </g>

            {!reducedMotion ? (
              <motion.g key={`route-event-${eventToken}`}>
                <motion.path
                  d={activeRoute.path}
                  fill="none"
                  stroke="rgba(255,255,255,0.82)"
                  strokeWidth="1.25"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: [0, 0.85, 0.42, 0.12] }}
                  transition={{
                    delay: routeDelay,
                    duration: routeDuration,
                    times: [0, 0.16, 0.74, 1],
                    ease: SPLASH_EASE,
                  }}
                />
                <motion.circle
                  cx={sourceNode.x}
                  cy={sourceNode.y}
                  r={sourceNode.radius + 2.2}
                  fill="white"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.86, 0.3] }}
                  transition={{
                    delay: routeDelay,
                    duration: routeDuration * 0.5,
                    times: [0, 0.3, 1],
                  }}
                />
                <motion.circle
                  cx={destinationNode.x}
                  cy={destinationNode.y}
                  r={destinationNode.radius + 2.4}
                  fill="white"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0, 0.92, 0.34] }}
                  transition={{
                    delay: routeDelay,
                    duration: routeDuration,
                    times: [0, 0.62, 0.84, 1],
                  }}
                />
                <motion.circle
                  r="2.2"
                  fill="white"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 1, 0] }}
                  transition={{
                    delay: routeDelay,
                    duration: routeDuration,
                    times: [0, 0.12, 0.82, 1],
                  }}
                >
                  <animateMotion
                    path={activeRoute.path}
                    dur={`${routeDuration}s`}
                      begin={`${routeDelay}s`}
                    fill="remove"
                  />
                </motion.circle>
                {isComplete ? (
                  <motion.circle
                    r="1.8"
                    fill="white"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.72, 0.72, 0] }}
                    transition={{
                      delay: routeDuration * 0.48,
                      duration: routeDuration * 0.48,
                      times: [0, 0.2, 0.76, 1],
                    }}
                  >
                    <animateMotion
                      path={activeOrbit}
                      dur={`${routeDuration * 0.48}s`}
                      begin={`${routeDuration * 0.48}s`}
                      fill="remove"
                    />
                  </motion.circle>
                ) : null}
              </motion.g>
            ) : null}

            {isComplete && !reducedMotion ? (
              <g>
                {[2, 9, 14, 17].map((nodeIndex, index) => {
                  const node = SPLASH_ORBIT_NODES[nodeIndex];
                  return (
                    <motion.circle
                      key={`completion-node-${node.id}`}
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 2.2}
                      fill="white"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 0.9, 0.35] }}
                      transition={{
                        delay: 0.24 + index * 0.1,
                        duration: 0.42,
                        times: [0, 0.45, 1],
                      }}
                    />
                  );
                })}
              </g>
            ) : null}
          </g>
        </svg>
      </motion.div>

    </div>
  );
});

function WelcomeSplashOverlay({
  progress,
  status,
}: {
  progress: number;
  status: string;
}) {
  const { t } = useTranslation();
  const isPresent = useIsPresent();
  const reducedMotion = Boolean(useReducedMotion());
  const safeProgress = Math.max(8, Math.min(100, progress));
  const isComplete = safeProgress >= 99;
  const visualEventIndex = isComplete
    ? SPLASH_DATA_ROUTES.length - 1
    : Math.min(
        SPLASH_DATA_ROUTES.length - 1,
        Math.floor(safeProgress / 24),
      );
  const visualEventToken = `${isComplete ? "complete" : "loading"}:${visualEventIndex}:${status}`;
  const progressMotion = useMotionValue(0);
  const smoothProgress = useSpring(progressMotion, {
    stiffness: reducedMotion ? 1000 : 52,
    damping: reducedMotion ? 100 : 20,
    mass: reducedMotion ? 0.1 : 0.95,
  });
  const progressWidth = useTransform(
    smoothProgress,
    (value) => `${Math.max(0, Math.min(100, value))}%`,
  );
  const [progressLabel, setProgressLabel] = useState(0);
  const progressLabelRef = useRef(0);
  const displayedProgressWidth = reducedMotion
    ? `${safeProgress}%`
    : progressWidth;
  const displayedProgressLabel = reducedMotion
    ? Math.round(safeProgress)
    : progressLabel;

  useMotionValueEvent(smoothProgress, "change", (latest) => {
    if (reducedMotion) return;

    const nextLabel = Math.round(Math.max(0, Math.min(100, latest)));
    if (nextLabel === progressLabelRef.current) return;

    progressLabelRef.current = nextLabel;
    setProgressLabel(nextLabel);
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
      exit={
        reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, y: -2, scale: 0.996 }
      }
      transition={{
        duration: reducedMotion ? 0.34 : 0.82,
        ease: SPLASH_EASE,
      }}
      className="fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-black"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.012),transparent_24%,transparent_76%,rgba(255,255,255,0.008))]"
      />

      <motion.div
        aria-hidden="true"
        style={{ willChange: "transform" }}
        className="pointer-events-none absolute -left-[20vw] top-[9vh] h-[30vh] w-[106vw] rounded-[50%] bg-[linear-gradient(104deg,transparent_12%,rgba(255,255,255,0.02)_30%,rgba(255,255,255,0.11)_45%,rgba(255,255,255,0.025)_66%,transparent_88%)] blur-[64px]"
        initial={{ opacity: 0, x: -28, y: -6, rotate: -14 }}
        animate={
          reducedMotion
            ? { opacity: 0.44, x: 0, y: 0, rotate: -14 }
            : isComplete
              ? {
                  opacity: 0.54,
                  x: 18,
                  y: 0,
                  rotate: -14,
                }
              : {
                  opacity: 0.44,
                  x: [-24, 18, -10],
                  y: [-5, 4, -2],
                  rotate: -14,
                }
        }
        transition={
          reducedMotion
            ? { duration: 0.4 }
            : isComplete
              ? { duration: 0.72, ease: SPLASH_EASE }
              : {
                  opacity: { duration: 0.9, ease: SPLASH_EASE },
                   x: {
                     delay: 0.55,
                     duration: 23,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  },
                   y: {
                     delay: 0.55,
                     duration: 27,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  },
                }
        }
      />

      {reducedMotion ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-[18vw] top-[59vh] h-[24vh] w-[102vw] -rotate-[12deg] rounded-[50%] bg-[linear-gradient(103deg,transparent_10%,rgba(255,255,255,0.018)_35%,rgba(255,255,255,0.085)_58%,transparent_88%)] opacity-35 blur-[64px]"
        />
      ) : !isComplete ? (
        <motion.div
          key={`splash-event-ribbon-${visualEventToken}`}
          aria-hidden="true"
          style={{ willChange: "transform, opacity" }}
          className="pointer-events-none absolute -left-[54vw] top-[66vh] h-[20vh] w-[82vw] -rotate-[13deg] rounded-[50%] bg-[linear-gradient(96deg,transparent_7%,rgba(255,255,255,0.014)_30%,rgba(255,255,255,0.09)_58%,transparent_90%)] blur-[64px]"
          initial={{ x: 0, y: 0, opacity: 0 }}
          animate={{
            x: "128vw",
            y: "-42vh",
            opacity: [0, 0.2, 0.16, 0],
          }}
          transition={{
            duration: 3.2,
            times: [0, 0.18, 0.7, 1],
            ease: SPLASH_EASE,
          }}
        />
      ) : null}

      <SplashOrbitalMesh
        reducedMotion={reducedMotion}
        isComplete={isComplete}
        eventIndex={visualEventIndex}
        eventToken={visualEventToken}
      />

      {isComplete && !reducedMotion ? (
        <motion.div
          key="splash-completion-ribbon"
          aria-hidden="true"
          style={{ willChange: "transform, opacity" }}
          className="pointer-events-none absolute -left-[46vw] top-[36%] h-28 w-[88vw] -rotate-[13deg] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.09),transparent)] blur-[48px]"
          initial={{ x: 0, opacity: 0 }}
          animate={{ x: "112vw", opacity: [0, 0.2, 0] }}
          transition={{ duration: 0.78, ease: SPLASH_EASE }}
        />
      ) : null}

      <motion.div
        style={{ x: "clamp(-80px, -4vw, -24px)" }}
        initial={
          reducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: 18 }
        }
        animate={{
          opacity: 1,
          y: 0,
          scale: isComplete && !reducedMotion ? 1.004 : 1,
        }}
        exit={
          reducedMotion
            ? { opacity: 0 }
            : { opacity: 0, y: -5, scale: 0.996 }
        }
        transition={{
          duration: isComplete ? 0.62 : reducedMotion ? 0.36 : 0.9,
          ease: SPLASH_EASE,
        }}
        className="relative z-10 flex w-[min(720px,calc(100vw-40px))] flex-col items-center text-center"
      >
        <motion.div
          initial={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 18, scale: 0.975 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -2 }
          }
          transition={{
            delay: reducedMotion ? 0.04 : 0.24,
            duration: reducedMotion ? 0.38 : 1.02,
            ease: SPLASH_EASE,
          }}
          className="relative flex h-[clamp(108px,17vh,150px)] w-full max-w-[520px] items-center justify-center overflow-hidden"
        >
          <motion.div
            aria-hidden="true"
            style={{ x: "-50%", y: "-50%" }}
            className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-[72%] rounded-full bg-white/10 blur-[48px]"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={
              reducedMotion
                ? { opacity: 0.16, scale: 1 }
                : { opacity: [0, 0.28, 0.16], scale: [0.82, 1.04, 1] }
            }
            transition={{
              delay: reducedMotion ? 0.04 : 0.58,
              duration: reducedMotion ? 0.35 : 1.35,
              ease: SPLASH_EASE,
            }}
          />
          {!reducedMotion ? (
            <motion.div
              aria-hidden="true"
              style={{ skewX: -12 }}
              className="pointer-events-none absolute inset-y-7 -left-24 z-20 w-16 bg-gradient-to-r from-transparent via-white/22 to-transparent blur-xl"
              initial={{ x: 0, opacity: 0 }}
              animate={{ x: "720px", opacity: [0, 0.36, 0] }}
              transition={{ delay: 0.82, duration: 0.92, ease: SPLASH_EASE }}
            />
          ) : null}
          <img
            src={contextforgeLogoWhite}
            alt="ContextForge"
            draggable={false}
            className="relative z-10 w-full max-w-[500px] select-none object-contain"
          />
        </motion.div>

        <motion.div
          aria-hidden="true"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 84, opacity: 1 }}
          transition={{
            delay: reducedMotion ? 0.08 : 0.7,
            duration: reducedMotion ? 0.32 : 0.68,
            ease: SPLASH_EASE,
          }}
          className="relative h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
        >
          <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/45 bg-black" />
        </motion.div>

        <motion.p
          initial={
            reducedMotion
              ? { opacity: 0, letterSpacing: "0.18em" }
              : {
                  opacity: 0.22,
                  letterSpacing: "0.68em",
                }
          }
          animate={{
            opacity: 1,
            letterSpacing: "0.18em",
          }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0 }
          }
          transition={{
            delay: reducedMotion ? 0.1 : 0.8,
            duration: reducedMotion ? 0.34 : 0.84,
            ease: SPLASH_EASE,
          }}
          className="mt-5 text-[clamp(13px,1.2vw,15px)] font-medium uppercase text-neutral-300"
        >
          {t("splash.welcomeWord")}
        </motion.p>

        <motion.div
          initial={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 10 }
          }
          animate={{ opacity: 1, y: 0 }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -2 }
          }
          transition={{
            delay: reducedMotion ? 0.12 : 1.12,
            duration: reducedMotion ? 0.34 : 0.68,
            ease: SPLASH_EASE,
          }}
          className="mt-[clamp(28px,5.5vh,44px)] w-full max-w-[430px]"
        >
          <div className="mb-3 flex items-center justify-between gap-4 px-0.5 text-[11px] font-medium text-neutral-500">
            <div className="relative h-4 min-w-0 flex-1 overflow-hidden text-left">
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={status}
                  initial={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: 4 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  exit={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: -3 }
                  }
                  transition={{
                    duration: reducedMotion ? 0.18 : 0.28,
                    ease: SPLASH_EASE,
                  }}
                  className="absolute inset-x-0 top-0 truncate"
                >
                  {status}
                </motion.span>
              </AnimatePresence>
            </div>
            <span className="shrink-0 font-mono text-neutral-400">
              {displayedProgressLabel}%
            </span>
          </div>

          <div className="relative h-[2px] overflow-visible bg-gradient-to-r from-transparent via-white/[0.12] to-transparent">
            <motion.div
              style={{ width: displayedProgressWidth }}
              className="relative h-full overflow-hidden bg-gradient-to-r from-white/55 via-white/90 to-white shadow-[0_0_14px_rgba(255,255,255,0.36)]"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-[-3px] right-0 w-24 bg-gradient-to-r from-transparent via-white/15 to-white/70 blur-[2px]"
              />
              {!reducedMotion ? (
                <motion.span
                  key={`progress-impulse-${safeProgress}`}
                  aria-hidden="true"
                  className="absolute inset-y-[-5px] w-20 bg-gradient-to-r from-transparent via-white/60 to-transparent blur-[2px]"
                  initial={{ left: "-22%", opacity: 0 }}
                  animate={{
                    left: "102%",
                    opacity: [0, isComplete ? 0.9 : 0.42, 0],
                  }}
                  transition={{
                    duration: isComplete ? 0.68 : 0.82,
                    ease: SPLASH_EASE,
                  }}
                />
              ) : null}
            </motion.div>

            {!reducedMotion ? (
              <motion.span
                aria-hidden="true"
                style={{ left: displayedProgressWidth, x: "-50%", y: "-50%" }}
                className="absolute top-1/2 size-4 rounded-full bg-white/10 opacity-45 blur-[5px]"
              />
            ) : null}
            <motion.span
              aria-hidden="true"
              style={{ left: displayedProgressWidth, x: "-50%", y: "-50%" }}
              className="absolute top-1/2 size-1.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.82)]"
            />
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const dashboard = useDashboardController();
  const workspaceZoom = useWorkspaceZoom();
  const taskPackFreshnessById = useMemo(
    () =>
      buildTaskPackFreshnessIndex(dashboard.taskPacks, dashboard.projects),
    [dashboard.projects, dashboard.taskPacks],
  );
  const resolveTaskPackFreshness = useCallback(
    (taskPack: TaskPack) =>
      taskPackFreshnessById.get(taskPack.id) ??
      deriveTaskPackFreshness(
        taskPack,
        dashboard.projects.find((project) => project.id === taskPack.projectId),
      ),
    [dashboard.projects, taskPackFreshnessById],
  );

  const {
    activeLocation,
    activePage,
    backLocation,
    forwardLocation,
    canGoBack,
    canGoForward,
    navigate: navigatePage,
    navigateToLocation,
    replaceCurrentLocation,
    updateCurrentContextComposerState,
    discardForwardHistory,
    goBack,
    goForward,
  } = useWorkspaceNavigationHistory("dashboard");
  const [reportsPresenceActivity, setReportsPresenceActivity] =
    useState<"reports" | "validation_lab">("reports");
  const [operationPresenceActivity, setOperationPresenceActivity] =
    useState<DiscordPresenceActivity | null>(null);
  const previousOperationForNotificationRef =
    useRef<DiscordPresenceActivity | null>(null);
  const [pageDirection, setPageDirection] = useState(1);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] =
    useState(false);
  const [isUnsupportedDropVisible, setIsUnsupportedDropVisible] =
    useState(false);
  const [quickPeekTarget, setQuickPeekTarget] =
    useState<QuickPeekTarget | null>(null);
  const [splitViewTarget, setSplitViewTarget] =
    useState<QuickPeekTarget | null>(null);
  const [inspectorTarget, setInspectorTarget] =
    useState<InspectorTarget | null>(null);
  const [isExplainabilityOpen, setIsExplainabilityOpen] = useState(false);
  const [isContextMapOpen, setIsContextMapOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [isFocusModeEnabled, setIsFocusModeEnabled] = useState(false);
  const [isAutomaticFocusSuppressed, setIsAutomaticFocusSuppressed] =
    useState(false);
  const previousFocusModeSurfaceRef = useRef(false);
  const previousFocusModeBehaviorRef =
    useRef<AppSettings["focusModeBehavior"]>("manual");
  const isFocusModeSurface =
    activeLocation.surface === "task-pack-builder" ||
    activeLocation.surface === "context-composer" ||
    activeLocation.surface === "task-pack-result";
  const focusModeBehavior = appSettings?.focusModeBehavior ?? "manual";
  const isAutomaticFocusMode = focusModeBehavior === "automatic";
  const isFocusModeActive =
    isFocusModeSurface &&
    (isAutomaticFocusMode ? !isAutomaticFocusSuppressed : isFocusModeEnabled);
  const workspaceDensityPreference =
    appSettings?.workspaceDensity ?? "adaptive";
  const hasAuxiliaryWorkspace = Boolean(
    splitViewTarget ||
      inspectorTarget ||
      isExplainabilityOpen ||
      isContextMapOpen
  );
  const resolvedWorkspaceDensity = resolveWorkspaceDensity({
    preference: workspaceDensityPreference,
    isWorkflowSurface: isFocusModeSurface,
    isFocusModeActive,
    hasAuxiliaryWorkspace
  });
  const workspaceContentPadding = getWorkspaceDensityPadding(
    resolvedWorkspaceDensity,
    isFocusModeActive
  );
  const [contextDiffSession, setContextDiffSession] =
    useState<ContextDiffSessionState | null>(null);
  const [onboardingDismissedThisSession, setOnboardingDismissedThisSession] =
    useState(false);
  const selectedProjectDetailsId =
    activeLocation.surface === "project-details"
      ? activeLocation.projectId
      : null;

  const reportUnsupportedDrop = useCallback(() => {
    setIsUnsupportedDropVisible(true);
  }, []);

  useGlobalDropNavigationGuard(reportUnsupportedDrop);

  useEffect(() => {
    if (!isUnsupportedDropVisible) return;

    const timeout = window.setTimeout(
      () => setIsUnsupportedDropVisible(false),
      2600,
    );
    return () => window.clearTimeout(timeout);
  }, [isUnsupportedDropVisible]);

  useEffect(() => {
    setIsExplainabilityOpen(false);
    setIsContextMapOpen(false);
  }, [activeLocation.surface]);

  useEffect(() => {
    if (!dashboard.contextComposerPreview?.contextEngine) {
      setIsExplainabilityOpen(false);
      setIsContextMapOpen(false);
    }
  }, [dashboard.contextComposerPreview?.contextEngine]);

  const [isWelcomeVisible, setIsWelcomeVisible] = useState(true);
  const [minimumSplashDone, setMinimumSplashDone] = useState(false);
  const [shellSettingsReady, setShellSettingsReady] = useState(false);
  const [bootProgress, setBootProgress] = useState(12);
  const [bootStatus, setBootStatus] = useState(() => i18n.t("splash.starting"));

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

  const openTaskPackBuilderLocation = useCallback(
    (draft: TaskPackDraft) => {
      setPageDirection(1);
      navigateToLocation({
        page: activePage,
        surface: "task-pack-builder",
        draft,
      });
    },
    [activePage, navigateToLocation],
  );

  const handleCreateTaskPackDraftWithNavigation = useCallback(
    async (...args: Parameters<typeof dashboard.handleCreateTaskPackDraft>) => {
      const draft = await dashboard.handleCreateTaskPackDraft(...args);
      if (draft) {
        openTaskPackBuilderLocation(draft);
      }
    },
    [dashboard.handleCreateTaskPackDraft, openTaskPackBuilderLocation],
  );

  const handleCreateTaskPackDraftFromChangesWithNavigation = useCallback(
    async (
      ...args: Parameters<typeof dashboard.handleCreateTaskPackDraftFromChanges>
    ) => {
      const draft =
        await dashboard.handleCreateTaskPackDraftFromChanges(...args);
      if (draft) {
        openTaskPackBuilderLocation(draft);
      }
    },
    [
      dashboard.handleCreateTaskPackDraftFromChanges,
      openTaskPackBuilderLocation,
    ],
  );

  const handleTaskPackDraftChange = useCallback(
    (draft: TaskPackDraft) => {
      dashboard.setTaskPackDraft(draft);

      if (activeLocation.surface === "task-pack-builder") {
        replaceCurrentLocation({
          ...activeLocation,
          draft,
        });
      }
    },
    [
      activeLocation,
      dashboard.setTaskPackDraft,
      replaceCurrentLocation,
    ],
  );

  const handleOpenTaskContextComposerWithNavigation = useCallback(async () => {
    const draft = dashboard.taskPackDraft;
    if (!draft) return;

    if (
      forwardLocation?.surface === "context-composer" &&
      taskContextDraftsMatch(draft, forwardLocation.draft)
    ) {
      dashboard.setTaskPackDraft(forwardLocation.draft);
      dashboard.setContextComposerPreview(forwardLocation.preview);
      setPageDirection(1);
      goForward();
      return;
    }

    const preview = await dashboard.handleOpenTaskContextComposer();
    if (!preview) return;

    setContextDiffSession((current) =>
      advanceContextDiffSession(current, preview),
    );
    setPageDirection(1);
    navigateToLocation({
      page: activePage,
      surface: "context-composer",
      draft,
      preview,
    });
  }, [
    activePage,
    dashboard.handleOpenTaskContextComposer,
    dashboard.setContextComposerPreview,
    dashboard.setTaskPackDraft,
    dashboard.taskPackDraft,
    forwardLocation,
    goForward,
    navigateToLocation,
  ]);

  const handleOpenTaskPackResult = useCallback(
    (taskPack: TaskPack) => {
      setQuickPeekTarget(null);
      dashboard.setTaskPackDraft(null);
      dashboard.setContextComposerPreview(null);
      dashboard.setGeneratedTaskPack(taskPack);

      setPageDirection(1);
      navigateToLocation({
        page: activePage,
        surface: "task-pack-result",
        taskPack,
      });
    },
    [
      activePage,
      dashboard.setContextComposerPreview,
      dashboard.setGeneratedTaskPack,
      dashboard.setTaskPackDraft,
      navigateToLocation,
    ],
  );

  const handleExternalTaskPackCreatedWithNavigation = useCallback(
    (taskPack: TaskPack) => {
      dashboard.handleExternalTaskPackCreated(taskPack);
      setPageDirection(1);
      navigateToLocation({
        page: activePage,
        surface: "task-pack-result",
        taskPack,
      });
    },
    [
      activePage,
      dashboard.handleExternalTaskPackCreated,
      navigateToLocation,
    ],
  );

  const handleTaskPackUpdatedWithNavigation = useCallback(
    (taskPack: TaskPack) => {
      dashboard.handleExternalTaskPackUpdated(taskPack);

      if (activeLocation.surface === "task-pack-result") {
        replaceCurrentLocation({
          ...activeLocation,
          taskPack,
        });
      }
    },
    [
      activeLocation,
      dashboard.handleExternalTaskPackUpdated,
      replaceCurrentLocation,
    ],
  );

  const handleOpenTaskPackInBuilderWithNavigation = useCallback(
    (taskPack: TaskPack) => {
      const draft = dashboard.handleOpenTaskPackInBuilder(taskPack);
      openTaskPackBuilderLocation(draft);
    },
    [
      dashboard.handleOpenTaskPackInBuilder,
      openTaskPackBuilderLocation,
    ],
  );

  const handleAnalyzeTaskContextWithPresence = useCallback(
    async (...args: Parameters<typeof dashboard.handleAnalyzeTaskContext>) => {
      setOperationPresenceActivity("analyzing_task_context");

      try {
        const preview = await dashboard.handleAnalyzeTaskContext(...args);

        if (preview) {
          discardForwardHistory();
        }

        return preview;
      } finally {
        setOperationPresenceActivity(null);
      }
    },
    [dashboard.handleAnalyzeTaskContext, discardForwardHistory],
  );

  const handleCreateTaskPackWithPresence = useCallback(
    async (...args: Parameters<typeof dashboard.handleCreateTaskPack>) => {
      const draft = args[0] ?? dashboard.taskPackDraft;
      setOperationPresenceActivity("generating_task_pack");

      try {
        const outcome = await dashboard.handleCreateTaskPack(...args);

        if (!outcome) {
          return;
        }

        if (outcome.kind === "generated") {
          handleOpenTaskPackResult(outcome.taskPack);
          return;
        }

        if (outcome.kind === "context-review" && draft) {
          setContextDiffSession((current) =>
            advanceContextDiffSession(current, outcome.preview),
          );
          setPageDirection(1);
          navigateToLocation({
            page: activePage,
            surface: "context-composer",
            draft,
            preview: outcome.preview,
          });
        }
      } finally {
        setOperationPresenceActivity(null);
      }
    },
    [
      activePage,
      dashboard.handleCreateTaskPack,
      dashboard.taskPackDraft,
      handleOpenTaskPackResult,
      navigateToLocation,
    ],
  );

  const handleCreateTaskPackFromComposerWithPresence = useCallback(
    async (
      ...args: Parameters<typeof dashboard.handleCreateTaskPackFromComposer>
    ) => {
      setOperationPresenceActivity("generating_task_pack");

      try {
        const outcome =
          await dashboard.handleCreateTaskPackFromComposer(...args);

        if (outcome?.kind === "generated") {
          handleOpenTaskPackResult(outcome.taskPack);
        }
      } finally {
        setOperationPresenceActivity(null);
      }
    },
    [
      dashboard.handleCreateTaskPackFromComposer,
      handleOpenTaskPackResult,
    ],
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
      setQuickPeekTarget(null);

      setPageDirection(nextIndex >= currentIndex ? 1 : -1);
      navigatePage(nextPage);
    },
    [activePage, dashboard, navigatePage],
  );

  const restoreNavigationLocation = useCallback(
    (location: WorkspaceNavigationLocation) => {
      if (location.surface === "task-pack-builder") {
        dashboard.setGeneratedTaskPack(null);
        dashboard.setContextComposerPreview(null);
        dashboard.setTaskPackDraft(location.draft);
        return;
      }

      if (location.surface === "context-composer") {
        dashboard.setGeneratedTaskPack(null);
        dashboard.setTaskPackDraft(location.draft);
        dashboard.setContextComposerPreview(location.preview);
        return;
      }

      dashboard.setTaskPackDraft(null);
      dashboard.setContextComposerPreview(null);

      if (location.surface === "task-pack-result") {
        dashboard.setGeneratedTaskPack(location.taskPack);
        return;
      }

      dashboard.setGeneratedTaskPack(null);
    },
    [
      dashboard.setContextComposerPreview,
      dashboard.setGeneratedTaskPack,
      dashboard.setTaskPackDraft,
    ],
  );

  const handleNavigateBack = useCallback(() => {
    if (!backLocation) return;

    setQuickPeekTarget(null);
    restoreNavigationLocation(backLocation);
    setPageDirection(-1);
    goBack();
  }, [backLocation, goBack, restoreNavigationLocation]);

  const handleNavigateForward = useCallback(() => {
    if (!forwardLocation) return;

    setQuickPeekTarget(null);
    restoreNavigationLocation(forwardLocation);
    setPageDirection(1);
    goForward();
  }, [forwardLocation, goForward, restoreNavigationLocation]);

  const toggleFocusMode = useCallback(() => {
    if (!isFocusModeSurface) {
      return;
    }

    if (isAutomaticFocusMode) {
      setIsAutomaticFocusSuppressed((current) => !current);
      return;
    }

    setIsFocusModeEnabled((current) => !current);
  }, [isAutomaticFocusMode, isFocusModeSurface]);

  useEffect(() => {
    const previousBehavior = previousFocusModeBehaviorRef.current;

    if (previousBehavior === focusModeBehavior) {
      return;
    }

    if (focusModeBehavior === "automatic") {
      setIsAutomaticFocusSuppressed(false);
    } else {
      setIsFocusModeEnabled(false);
    }

    previousFocusModeBehaviorRef.current = focusModeBehavior;
  }, [focusModeBehavior]);

  useEffect(() => {
    const wasFocusSurface = previousFocusModeSurfaceRef.current;

    if (wasFocusSurface && !isFocusModeSurface && isAutomaticFocusMode) {
      setIsAutomaticFocusSuppressed(false);
    }

    previousFocusModeSurfaceRef.current = isFocusModeSurface;
  }, [isAutomaticFocusMode, isFocusModeSurface]);

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

  const handleCloseTaskPackSurface = useCallback(() => {
    if (backLocation) {
      handleNavigateBack();
      return;
    }

    handleNavigate("taskPacks");
  }, [backLocation, handleNavigate, handleNavigateBack]);

  const handleOpenProjectDetails = useCallback(
    (projectId: number) => {
      setQuickPeekTarget(null);
      const currentIndex = getPageOrderIndex(activePage);
      const nextIndex = getPageOrderIndex("projects");

      dashboard.setTaskPackDraft(null);
      dashboard.setContextComposerPreview(null);
      dashboard.setGeneratedTaskPack(null);

      setPageDirection(nextIndex >= currentIndex ? 1 : -1);
      navigateToLocation({
        page: "projects",
        surface: "project-details",
        projectId,
      });
    },
    [activePage, dashboard, navigateToLocation],
  );

  const handleCloseProjectDetails = useCallback(() => {
    handleNavigate("projects");
  }, [handleNavigate]);

  const shouldShowFirstRunOnboarding = Boolean(
    !isWelcomeVisible &&
    shellSettingsReady &&
    appSettings &&
    !onboardingDismissedThisSession &&
    appSettings.onboardingEnabled !== false &&
    (appSettings.onboardingShowEveryLaunch !== false ||
      !appSettings.onboardingCompleted),
  );

  const currentCommandProjectId = useMemo(() => {
    if (activeLocation.surface === "project-details") {
      return activeLocation.projectId;
    }
    if (activeLocation.surface === "task-pack-builder") {
      return activeLocation.draft.projectId;
    }
    if (activeLocation.surface === "context-composer") {
      return activeLocation.preview.project.id;
    }
    if (activeLocation.surface === "task-pack-result") {
      return activeLocation.taskPack.projectId;
    }
    return null;
  }, [activeLocation]);

  const currentCommandProject = useMemo(
    () =>
      currentCommandProjectId === null
        ? null
        : dashboard.projects.find(
            (project) => project.id === currentCommandProjectId,
          ) ?? null,
    [currentCommandProjectId, dashboard.projects],
  );

  const openCommandPalette = useCallback(() => {
    if (
      isWelcomeVisible ||
      shouldShowFirstRunOnboarding ||
      isGlobalSearchOpen ||
      dashboard.agentsPreview ||
      document.querySelector('[role="dialog"][aria-modal="true"]')
    ) {
      return;
    }

    setIsCommandPaletteOpen(true);
  }, [
    dashboard.agentsPreview,
    isGlobalSearchOpen,
    isWelcomeVisible,
    shouldShowFirstRunOnboarding,
  ]);

  const openGlobalSearchFromShortcut = useCallback(() => {
    if (
      isWelcomeVisible ||
      shouldShowFirstRunOnboarding ||
      isCommandPaletteOpen ||
      dashboard.agentsPreview ||
      document.querySelector('[role="dialog"][aria-modal="true"]')
    ) {
      return;
    }

    setIsGlobalSearchOpen(true);
  }, [
    dashboard.agentsPreview,
    isCommandPaletteOpen,
    isWelcomeVisible,
    shouldShowFirstRunOnboarding,
  ]);

  const commandPaletteCommands = useMemo(
    () =>
      isCommandPaletteOpen
        ? buildCommandPaletteCommands({
            activePage,
            projects: dashboard.projects,
            taskPacks: dashboard.taskPacks,
            currentProject: currentCommandProject,
            taskPackFreshnessById,
            canGoBack,
            canGoForward,
            isWorkspaceBusy: dashboard.isLoading,
            isFocusModeAvailable: isFocusModeSurface,
            isFocusModeActive,
            t,
            onNavigate: handleNavigate,
            onOpenProject: handleOpenProjectDetails,
            onAddProject: () => void dashboard.handleSelectProject(),
            onRescanProject: (project) =>
              void dashboard.handleRescanProject(project),
            onCreateTaskPack: (project) =>
              void handleCreateTaskPackDraftWithNavigation(project),
            onOpenTaskPack: handleOpenTaskPackResult,
            onOpenGlobalSearch: () => setIsGlobalSearchOpen(true),
            onBack: handleNavigateBack,
            onForward: handleNavigateForward,
            onToggleFocusMode: toggleFocusMode,
            onZoomIn: workspaceZoom.zoomIn,
            onZoomOut: workspaceZoom.zoomOut,
            onZoomReset: workspaceZoom.resetZoom,
          })
        : [],
    [
      activePage,
      canGoBack,
      canGoForward,
      currentCommandProject,
      dashboard.handleRescanProject,
      dashboard.handleSelectProject,
      dashboard.isLoading,
      dashboard.projects,
      dashboard.taskPacks,
      handleCreateTaskPackDraftWithNavigation,
      handleNavigate,
      handleNavigateBack,
      handleNavigateForward,
      handleOpenProjectDetails,
      handleOpenTaskPackResult,
      isCommandPaletteOpen,
      isFocusModeActive,
      isFocusModeSurface,
      t,
      taskPackFreshnessById,
      toggleFocusMode,
      workspaceZoom.resetZoom,
      workspaceZoom.zoomIn,
      workspaceZoom.zoomOut,
    ],
  );

  useKeyboardShortcuts({
    navigationBack: handleNavigateBack,
    navigationForward: handleNavigateForward,
    toggleFocusMode,
    zoomIn: workspaceZoom.zoomIn,
    zoomOut: workspaceZoom.zoomOut,
    zoomReset: workspaceZoom.resetZoom,
    globalSearch: openGlobalSearchFromShortcut,
    navigationAssistant: openCommandPalette,
    addProject: () => {
      if (!dashboard.isLoading) {
        void dashboard.handleSelectProject();
      }
    },
    openTaskPacks: () => handleNavigate("taskPacks"),
    openSettings: () => handleNavigate("settings"),
  });

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

  const reviewedContextSelection = useMemo(() => {
    if (
      activeLocation.surface !== "task-pack-builder" ||
      forwardLocation?.surface !== "context-composer" ||
      !taskContextDraftsMatch(activeLocation.draft, forwardLocation.draft)
    ) {
      return null;
    }

    return buildContextComposerReviewedSelection(
      forwardLocation.preview,
      forwardLocation.state ?? null,
    );
  }, [activeLocation, forwardLocation]);

  const content = useMemo(() => {
    if (dashboard.generatedTaskPack) {
      return (
        <TaskPackResultPage
          taskPack={dashboard.generatedTaskPack}
          freshness={resolveTaskPackFreshness(dashboard.generatedTaskPack)}
          onReviewProject={handleOpenProjectDetails}
          onClose={handleCloseTaskPackSurface}
          onOpenArchive={() => {
            dashboard.setGeneratedTaskPack(null);
            handleNavigate("taskPacks");
          }}
          onInspectTaskPack={(taskPack) => {
            setQuickPeekTarget(null);
            setSplitViewTarget(null);
            setInspectorTarget({
              kind: "task-pack",
              taskPack,
            });
          }}
          onTaskPackUpdated={handleTaskPackUpdatedWithNavigation}
          onOpenInBuilder={handleOpenTaskPackInBuilderWithNavigation}
        />
      );
    }

    if (dashboard.contextComposerPreview) {
      return (
        <ContextComposerPage
          preview={dashboard.contextComposerPreview}
          isLoading={dashboard.isLoading}
          navigationState={
            activeLocation.surface === "context-composer"
              ? activeLocation.state ?? null
              : null
          }
          onNavigationStateChange={updateCurrentContextComposerState}
          onQuickPeekFile={setQuickPeekTarget}
          onInspectTarget={(target) => {
            setQuickPeekTarget(null);
            setSplitViewTarget(null);
            setIsExplainabilityOpen(false);
            setIsContextMapOpen(false);
            setInspectorTarget(target);
          }}
          onExplainContext={() => {
            setQuickPeekTarget(null);
            setSplitViewTarget(null);
            setInspectorTarget(null);
            setIsContextMapOpen(false);
            setIsExplainabilityOpen(true);
          }}
          onOpenContextMap={() => {
            setQuickPeekTarget(null);
            setSplitViewTarget(null);
            setInspectorTarget(null);
            setIsExplainabilityOpen(false);
            setIsContextMapOpen(true);
          }}
          onClose={() => {
            setIsExplainabilityOpen(false);
            setIsContextMapOpen(false);
            handleCloseTaskPackSurface();
          }}
          onGenerate={(selectedFilePaths) => {
            setIsExplainabilityOpen(false);
            setIsContextMapOpen(false);
            handleCreateTaskPackFromComposerWithPresence(selectedFilePaths);
          }}
        />
      );
    }

    if (dashboard.taskPackDraft) {
      return (
        <TaskPackBuilderPage
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          contextPreview={dashboard.taskPackContextPreview}
          reviewedContextSelection={reviewedContextSelection}
          onChange={handleTaskPackDraftChange}
          onClose={handleCloseTaskPackSurface}
          onAnalyzeContext={handleAnalyzeTaskContextWithPresence}
          onOpenContextComposer={handleOpenTaskContextComposerWithNavigation}
          onGenerate={handleCreateTaskPackWithPresence}
        />
      );
    }
    if (dashboard.generatedTaskPack) {
      return (
        <TaskPackResultPage
          taskPack={dashboard.generatedTaskPack}
          freshness={resolveTaskPackFreshness(dashboard.generatedTaskPack)}
          onReviewProject={handleOpenProjectDetails}
          onClose={handleCloseTaskPackSurface}
          onOpenArchive={() => {
            dashboard.setGeneratedTaskPack(null);
            handleNavigate("taskPacks");
          }}
          onInspectTaskPack={(taskPack) => {
            setQuickPeekTarget(null);
            setSplitViewTarget(null);
            setInspectorTarget({
              kind: "task-pack",
              taskPack,
            });
          }}
          onTaskPackUpdated={handleTaskPackUpdatedWithNavigation}
          onOpenInBuilder={handleOpenTaskPackInBuilderWithNavigation}
        />
      );
    }

    if (dashboard.taskPackDraft) {
      return (
        <TaskPackBuilderPage
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          contextPreview={dashboard.taskPackContextPreview}
          reviewedContextSelection={reviewedContextSelection}
          onChange={handleTaskPackDraftChange}
          onClose={handleCloseTaskPackSurface}
          onAnalyzeContext={handleAnalyzeTaskContextWithPresence}
          onOpenContextComposer={handleOpenTaskContextComposerWithNavigation}
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
            taskPacks={dashboard.taskPacks}
            freshnessByTaskPackId={taskPackFreshnessById}
            onOpenTaskPack={handleOpenTaskPackResult}
            isLoading={dashboard.isLoading}
            onBack={handleCloseProjectDetails}
            onRescan={dashboard.handleRescanProject}
            onGenerateAgents={dashboard.handleGenerateAgentsPreview}
            onCreateTaskPack={handleCreateTaskPackDraftWithNavigation}
            onCreateTaskPackFromChanges={
              handleCreateTaskPackDraftFromChangesWithNavigation
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
          freshnessByTaskPackId={taskPackFreshnessById}
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
          onCreateTaskPack={handleCreateTaskPackDraftWithNavigation}
          onOpenTaskPack={handleOpenTaskPackResult}
          onOpenProjectDetails={(project) =>
            handleOpenProjectDetails(project.id)
          }
          onQuickPeekProject={(project) =>
            setQuickPeekTarget({ kind: "project", project })
          }
        />
      );
    }

    if (activePage === "projects") {
      return (
        <ProjectsSection
          projects={dashboard.projects}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onDropProjectFolder={dashboard.handleDropProjectFolder}
          onRescanProject={dashboard.handleRescanProject}
          onGenerateAgents={dashboard.handleGenerateAgentsPreview}
          onCreateTaskPack={handleCreateTaskPackDraftWithNavigation}
          onOpenProjectDetails={(project) =>
            handleOpenProjectDetails(project.id)
          }
          onQuickPeekProject={(project) =>
            setQuickPeekTarget({
              kind: "project",
              project,
            })
          }
        />
      );
    }

    if (activePage === "taskPacks") {
      return (
        <TaskPacksPage
          taskPacks={dashboard.taskPacks}
          freshnessByTaskPackId={taskPackFreshnessById}
          onReviewProject={handleOpenProjectDetails}
          onOpenTaskPack={handleOpenTaskPackResult}
          onQuickPeekTaskPack={(taskPack) =>
            setQuickPeekTarget({
              kind: "task-pack",
              taskPack,
            })
          }
          onInspectTaskPack={(taskPack) => {
            setQuickPeekTarget(null);
            setSplitViewTarget(null);
            setInspectorTarget({
              kind: "task-pack",
              taskPack,
            });
          }}
          onImportedTaskPack={handleExternalTaskPackCreatedWithNavigation}
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
          onCreateTaskPack={handleCreateTaskPackDraftWithNavigation}
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
          onCreateTaskPack={handleCreateTaskPackDraftWithNavigation}
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
          onOpenTaskPack={handleOpenTaskPackResult}
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
          onTaskPackCreated={handleExternalTaskPackCreatedWithNavigation}
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
    activeLocation,
    activePage,
    dashboard,
    handleCloseProjectDetails,
    handleCloseTaskPackSurface,
    handleCreateTaskPackDraftFromChangesWithNavigation,
    handleCreateTaskPackDraftWithNavigation,
    handleExternalTaskPackCreatedWithNavigation,
    handleNavigate,
    handleOpenProjectDetails,
    handleOpenTaskContextComposerWithNavigation,
    handleOpenTaskPackInBuilderWithNavigation,
    handleOpenTaskPackResult,
    handleTaskPackDraftChange,
    handleTaskPackUpdatedWithNavigation,
    resolveTaskPackFreshness,
    reviewedContextSelection,
    selectedProjectDetailsId,
    taskPackFreshnessById,
    updateCurrentContextComposerState,
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

  return (
    <main
      className="relative h-screen min-h-0 w-screen overflow-hidden bg-black text-neutral-100"
      data-workspace-density={resolvedWorkspaceDensity}
      data-workspace-density-preference={workspaceDensityPreference}
    >
      <motion.div
        initial={false}
        animate={{
          opacity: isWelcomeVisible ? 0.42 : 1,
          scale: isWelcomeVisible ? 0.992 : 1,
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
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onAddProject={dashboard.handleSelectProject}
          onNavigate={handleNavigate}
          onNavigateBack={handleNavigateBack}
          onNavigateForward={handleNavigateForward}
          onOpenNavigationAssistant={openCommandPalette}
          isFocusModeAvailable={isFocusModeSurface}
          isFocusModeActive={isFocusModeActive}
          onToggleFocusMode={toggleFocusMode}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            activePage={activePage}
            showDescriptions={appSettings?.sidebarShowDescriptions ?? false}
            focusMode={isFocusModeActive}
            onNavigate={handleNavigate}
          />

          <div className="flex min-w-0 flex-1 overflow-hidden bg-black">
            <section className="flex min-w-0 flex-1 flex-col bg-black">
              <motion.div
                className="min-h-0 flex-1 overflow-auto"
                animate={{ padding: workspaceContentPadding }}
                transition={{
                  duration: 0.22,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <PageTransition
                  pageKey={contentTransitionKey}
                  direction={pageDirection}
                >
                  {content}
                </PageTransition>
              </motion.div>
            </section>

            <AnimatePresence initial={false} mode="wait">
              {splitViewTarget ? (
                <QuickPeekPanel
                  key={`split-${
                    splitViewTarget.kind === "project"
                      ? splitViewTarget.project.id
                      : splitViewTarget.kind === "task-pack"
                        ? splitViewTarget.taskPack.id
                        : splitViewTarget.displayPath
                  }`}
                  mode="split-view"
                  target={splitViewTarget}
                  taskPackFreshness={
                    splitViewTarget.kind === "task-pack"
                      ? resolveTaskPackFreshness(splitViewTarget.taskPack)
                      : undefined
                  }
                  onClose={() => setSplitViewTarget(null)}
                  onOpenProject={(projectId) => {
                    setSplitViewTarget(null);
                    handleOpenProjectDetails(projectId);
                  }}
                  onOpenTaskPack={(taskPack) => {
                    setSplitViewTarget(null);
                    handleOpenTaskPackResult(taskPack);
                  }}
                />
              ) : inspectorTarget ? (
                <PersistentInspectorPanel
                  key={`inspector-${
                    inspectorTarget.kind === "file"
                      ? inspectorTarget.file.displayPath
                      : inspectorTarget.kind === "task-pack"
                        ? inspectorTarget.taskPack.id
                        : inspectorTarget.kind === "context"
                          ? inspectorTarget.preview.project.id
                          : inspectorTarget.evidence.evidenceId
                  }`}
                  target={inspectorTarget}
                  onClose={() => setInspectorTarget(null)}
                  onOpenInSplitView={(target) => {
                    setInspectorTarget(null);
                    setSplitViewTarget(target);
                  }}
                  onOpenProject={(projectId) => {
                    setInspectorTarget(null);
                    handleOpenProjectDetails(projectId);
                  }}
                  onOpenTaskPack={(taskPack) => {
                    setInspectorTarget(null);
                    handleOpenTaskPackResult(taskPack);
                  }}
                />
              ) : isExplainabilityOpen &&
                dashboard.contextComposerPreview?.contextEngine ? (
                <ExplainabilityLensPanel
                  key="explainability-lens"
                  view={dashboard.contextComposerPreview.contextEngine}
                  projectName={dashboard.contextComposerPreview.project.name}
                  contextDiff={
                    contextDiffSession?.sourcePreview ===
                    dashboard.contextComposerPreview
                      ? {
                          previous: contextDiffSession.previous,
                          current: contextDiffSession.current,
                        }
                      : null
                  }
                  onClose={() => setIsExplainabilityOpen(false)}
                  onInspectFile={(file) => {
                    setIsExplainabilityOpen(false);
                    setInspectorTarget({
                      kind: "file",
                      file: {
                        kind: "file",
                        title:
                          file.path.split(/[\\/]/).filter(Boolean).pop() ??
                          file.path,
                        displayPath: file.path,
                        filePath: file.path,
                        projectId: dashboard.contextComposerPreview!.project.id,
                        projectName:
                          dashboard.contextComposerPreview!.project.name,
                      },
                      contextFile: file,
                    });
                  }}
                  onInspectEvidence={(contextFile, evidence) => {
                    setIsExplainabilityOpen(false);
                    setInspectorTarget({
                      kind: "evidence",
                      projectId: dashboard.contextComposerPreview!.project.id,
                      projectName:
                        dashboard.contextComposerPreview!.project.name,
                      evidence,
                      contextFile,
                    });
                  }}
                  onOpenSource={(path, line) => {
                    setIsExplainabilityOpen(false);
                    setSplitViewTarget({
                      kind: "file",
                      title:
                        path.split(/[\\/]/).filter(Boolean).pop() ?? path,
                      displayPath: path,
                      filePath: path,
                      projectId: dashboard.contextComposerPreview!.project.id,
                      projectName:
                        dashboard.contextComposerPreview!.project.name,
                      line,
                    });
                  }}
                />
              ) : isContextMapOpen &&
                dashboard.contextComposerPreview?.contextEngine ? (
                <ContextMapPanel
                  key="context-map"
                  view={dashboard.contextComposerPreview.contextEngine}
                  projectId={dashboard.contextComposerPreview.project.id}
                  projectName={dashboard.contextComposerPreview.project.name}
                  onClose={() => setIsContextMapOpen(false)}
                  onInspectFile={(file) => {
                    setIsContextMapOpen(false);
                    setInspectorTarget({
                      kind: "file",
                      file: {
                        kind: "file",
                        title:
                          file.path.split(/[\\/]/).filter(Boolean).pop() ??
                          file.path,
                        displayPath: file.path,
                        filePath: file.path,
                        projectId: dashboard.contextComposerPreview!.project.id,
                        projectName:
                          dashboard.contextComposerPreview!.project.name,
                      },
                      contextFile: file,
                    });
                  }}
                  onInspectEvidence={(contextFile, evidence) => {
                    setIsContextMapOpen(false);
                    setInspectorTarget({
                      kind: "evidence",
                      projectId: dashboard.contextComposerPreview!.project.id,
                      projectName:
                        dashboard.contextComposerPreview!.project.name,
                      evidence,
                      contextFile,
                    });
                  }}
                  onOpenSource={(path, line) => {
                    setIsContextMapOpen(false);
                    setSplitViewTarget({
                      kind: "file",
                      title:
                        path.split(/[\\/]/).filter(Boolean).pop() ?? path,
                      displayPath: path,
                      filePath: path,
                      projectId: dashboard.contextComposerPreview!.project.id,
                      projectName:
                        dashboard.contextComposerPreview!.project.name,
                      line,
                    });
                  }}
                />
              ) : null}
            </AnimatePresence>
          </div>
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

        {isCommandPaletteOpen && (
          <CommandPaletteModal
            commands={commandPaletteCommands}
            onClose={() => setIsCommandPaletteOpen(false)}
          />
        )}

        {isGlobalSearchOpen && (
          <GlobalSearchModal
            activePage={activePage}
            projects={dashboard.projects}
            taskPacks={dashboard.taskPacks}
            onNavigate={handleNavigate}
            onOpenTaskPack={handleOpenTaskPackResult}
            onQuickPeek={(target) => {
              setIsGlobalSearchOpen(false);
              setQuickPeekTarget(target);
            }}
            onAddProject={dashboard.handleSelectProject}
            onClose={() => setIsGlobalSearchOpen(false)}
          />
        )}

        <AnimatePresence>
          {quickPeekTarget ? (
            <QuickPeekPanel
              key={`${quickPeekTarget.kind}-${
                quickPeekTarget.kind === "project"
                  ? quickPeekTarget.project.id
                  : quickPeekTarget.kind === "task-pack"
                    ? quickPeekTarget.taskPack.id
                    : quickPeekTarget.displayPath
              }`}
              target={quickPeekTarget}
              taskPackFreshness={
                quickPeekTarget.kind === "task-pack"
                  ? resolveTaskPackFreshness(quickPeekTarget.taskPack)
                  : undefined
              }
              onClose={() => setQuickPeekTarget(null)}
              onInspect={(target) => {
                const nextInspectorTarget: InspectorTarget | null =
                  target.kind === "file"
                    ? {
                        kind: "file",
                        file: target,
                      }
                    : target.kind === "task-pack"
                      ? {
                          kind: "task-pack",
                          taskPack: target.taskPack,
                        }
                      : null;

                if (!nextInspectorTarget) {
                  return;
                }

                setSplitViewTarget(null);
                setInspectorTarget(nextInspectorTarget);
                setQuickPeekTarget(null);
              }}
              onOpenInSplitView={(target) => {
                setInspectorTarget(null);
                setSplitViewTarget(target);
                setQuickPeekTarget(null);
              }}
              onOpenProject={handleOpenProjectDetails}
              onOpenTaskPack={handleOpenTaskPackResult}
            />
          ) : null}
        </AnimatePresence>

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
          isUnsupportedDropVisible
            ? t("dragAndDrop.unsupportedDrop")
            : dashboard.statusMessage === i18n.t("common.statusReady")
            ? ""
            : dashboard.statusMessage
        }
      />

      <WorkspaceZoomHud
        visible={workspaceZoom.isHudVisible}
        percent={workspaceZoom.percent}
      />

      <AnimatePresence>
        {isWelcomeVisible && (
          <WelcomeSplashOverlay progress={bootProgress} status={bootStatus} />
        )}
      </AnimatePresence>
    </main>
  );
}
