import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

import {
  applyWorkspaceZoom,
  readStoredWorkspaceZoom,
  resetWorkspaceZoom,
  stepWorkspaceZoom,
  storeWorkspaceZoom,
  workspaceZoomPercent,
} from "../lib/workspaceZoom";

const ZOOM_ANIMATION_MS = 150;
const ZOOM_HUD_MS = 1_000;
const WHEEL_STEP_THRESHOLD = 48;
const WHEEL_STEP_INTERVAL_MS = 80;
const WHEEL_GESTURE_RESET_MS = 220;

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

export function useWorkspaceZoom() {
  const prefersReducedMotion = useReducedMotion();
  const initialFactorRef = useRef(readStoredWorkspaceZoom());
  const targetFactorRef = useRef(initialFactorRef.current);
  const appliedFactorRef = useRef(initialFactorRef.current);
  const animationFrameRef = useRef<number | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const wheelDirectionRef = useRef(0);
  const lastWheelEventRef = useRef(0);
  const lastWheelStepRef = useRef(0);
  const [factor, setFactor] = useState(initialFactorRef.current);
  const [isHudVisible, setIsHudVisible] = useState(false);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const showHud = useCallback(() => {
    setIsHudVisible(true);
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
    }
    hudTimerRef.current = window.setTimeout(() => {
      setIsHudVisible(false);
      hudTimerRef.current = null;
    }, ZOOM_HUD_MS);
  }, []);

  const setZoomTarget = useCallback(
    (nextFactor: number, showEvenWhenUnchanged = false) => {
      const safeFactor = storeWorkspaceZoom(nextFactor);
      const unchanged = safeFactor === targetFactorRef.current;

      if (unchanged && !showEvenWhenUnchanged) return;

      targetFactorRef.current = safeFactor;
      setFactor(safeFactor);
      showHud();

      cancelAnimation();
      if (prefersReducedMotion || unchanged) {
        appliedFactorRef.current = applyWorkspaceZoom(safeFactor);
        return;
      }

      const fromFactor = appliedFactorRef.current;
      const startedAt = window.performance.now();

      const animate = (timestamp: number) => {
        const progress = Math.min(
          1,
          Math.max(0, (timestamp - startedAt) / ZOOM_ANIMATION_MS),
        );
        const interpolated =
          fromFactor +
          (safeFactor - fromFactor) * easeOutCubic(progress);
        appliedFactorRef.current = applyWorkspaceZoom(interpolated);

        if (progress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(animate);
        } else {
          appliedFactorRef.current = applyWorkspaceZoom(safeFactor);
          animationFrameRef.current = null;
        }
      };

      animationFrameRef.current = window.requestAnimationFrame(animate);
    },
    [cancelAnimation, prefersReducedMotion, showHud],
  );

  const zoomIn = useCallback(() => {
    setZoomTarget(stepWorkspaceZoom(targetFactorRef.current, 1));
  }, [setZoomTarget]);

  const zoomOut = useCallback(() => {
    setZoomTarget(stepWorkspaceZoom(targetFactorRef.current, -1));
  }, [setZoomTarget]);

  const resetZoom = useCallback(() => {
    setZoomTarget(resetWorkspaceZoom(), true);
  }, [setZoomTarget]);

  useEffect(() => {
    const restoredFactor = initialFactorRef.current;
    targetFactorRef.current = restoredFactor;
    appliedFactorRef.current = applyWorkspaceZoom(restoredFactor);

    return () => {
      cancelAnimation();
      if (hudTimerRef.current !== null) {
        window.clearTimeout(hudTimerRef.current);
      }
    };
  }, [cancelAnimation]);

  useEffect(() => {
    if (!prefersReducedMotion) return;
    cancelAnimation();
    appliedFactorRef.current = applyWorkspaceZoom(targetFactorRef.current);
  }, [cancelAnimation, prefersReducedMotion]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      event.stopPropagation();

      const now = window.performance.now();
      const deltaMultiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? Math.max(window.innerHeight, 1)
            : 1;
      const delta = event.deltaY * deltaMultiplier;
      const direction = Math.sign(delta);
      if (direction === 0) return;

      if (
        now - lastWheelEventRef.current > WHEEL_GESTURE_RESET_MS ||
        wheelDirectionRef.current !== direction
      ) {
        wheelAccumulatorRef.current = 0;
      }

      lastWheelEventRef.current = now;
      wheelDirectionRef.current = direction;
      wheelAccumulatorRef.current += delta;

      if (
        Math.abs(wheelAccumulatorRef.current) < WHEEL_STEP_THRESHOLD ||
        now - lastWheelStepRef.current < WHEEL_STEP_INTERVAL_MS
      ) {
        return;
      }

      wheelAccumulatorRef.current = 0;
      lastWheelStepRef.current = now;
      if (direction < 0) zoomIn();
      else zoomOut();
    };

    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      window.removeEventListener("wheel", handleWheel, true);
    };
  }, [zoomIn, zoomOut]);

  return {
    factor,
    percent: workspaceZoomPercent(factor),
    isHudVisible,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
