import { GripVertical } from "lucide-react";
import type { DragEvent } from "react";

import {
  createProjectFileDragPayload,
  writeContextForgeDragPayload,
} from "../../utils/dragAndDrop";

interface ProjectFileDragHandleProps {
  projectId: number;
  path: string;
  label: string;
  className?: string;
}

export function ProjectFileDragHandle({
  projectId,
  path,
  label,
  className = "",
}: ProjectFileDragHandleProps) {
  function handleDragStart(event: DragEvent<HTMLSpanElement>) {
    event.stopPropagation();
    const payload = createProjectFileDragPayload({ projectId, path });

    if (!payload || !writeContextForgeDragPayload(event.dataTransfer, payload)) {
      event.preventDefault();
    }
  }

  return (
    <span
      draggable
      role="img"
      aria-label={label}
      title={label}
      data-contextforge-drag-source="project-file"
      onClick={(event) => event.stopPropagation()}
      onDragStart={handleDragStart}
      className={[
        "inline-flex cursor-grab select-none items-center justify-center text-neutral-700 transition hover:text-neutral-300 active:cursor-grabbing",
        className,
      ].join(" ")}
    >
      <GripVertical size={14} aria-hidden="true" />
    </span>
  );
}
