import { useEffect } from "react";

import { isProtectedFileDrop } from "../utils/dragAndDrop";

const DROP_TARGET_SELECTOR = "[data-contextforge-drop-target]";

function isInsideSupportedDropTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(DROP_TARGET_SELECTOR));
}

export function useGlobalDropNavigationGuard(
  onUnsupportedDrop: () => void,
) {
  useEffect(() => {
    function handleDragOver(event: DragEvent) {
      if (!event.dataTransfer || !isProtectedFileDrop(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      if (!isInsideSupportedDropTarget(event.target)) {
        event.dataTransfer.dropEffect = "none";
      }
    }

    function handleDrop(event: DragEvent) {
      if (!event.dataTransfer || !isProtectedFileDrop(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      if (!isInsideSupportedDropTarget(event.target)) {
        onUnsupportedDrop();
      }
    }

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [onUnsupportedDrop]);
}
