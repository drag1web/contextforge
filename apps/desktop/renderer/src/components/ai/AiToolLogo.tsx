import {
  siAnthropic,
  siClaude,
  siCursor
} from "simple-icons/icons";

export type AiToolId =
  | "codex"
  | "openai"
  | "cursor"
  | "claude"
  | "anthropic"
  | "generic"
  | string;

interface SimpleIconData {
  title: string;
  slug: string;
  hex: string;
  path: string;
}

interface AiToolLogoProps {
  tool: AiToolId;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const OPENAI_ICON: SimpleIconData = {
  title: "OpenAI",
  slug: "openai",
  hex: "FFFFFF",
  path:
    "M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"
};

function normalizeTool(tool: AiToolId) {
  return String(tool || "generic").toLowerCase().trim();
}

function getSimpleIcon(tool: AiToolId): SimpleIconData | null {
  const normalized = normalizeTool(tool);

  if (normalized === "codex" || normalized === "openai") {
    return OPENAI_ICON;
  }

  if (normalized === "claude") {
    return (siClaude ?? siAnthropic) as SimpleIconData;
  }

  if (normalized === "anthropic") {
    return (siAnthropic ?? siClaude) as SimpleIconData;
  }

  if (normalized === "cursor") {
    return siCursor as SimpleIconData;
  }

  return null;
}

function getSizeClasses(size: AiToolLogoProps["size"]) {
  if (size === "sm") {
    return {
      box: "size-6 rounded-lg",
      icon: "size-3.5"
    };
  }

  if (size === "lg") {
    return {
      box: "size-9 rounded-2xl",
      icon: "size-5"
    };
  }

  return {
    box: "size-7 rounded-xl",
    icon: "size-4"
  };
}

function getBrandColor(tool: AiToolId, icon?: SimpleIconData | null) {
  const normalized = normalizeTool(tool);

  if (normalized === "codex" || normalized === "openai") {
    return "#f5f5f5";
  }

  if (normalized === "claude" || normalized === "anthropic") {
    return "#d97757";
  }

  if (normalized === "cursor") {
    return "#ffffff";
  }

  const hex = String(icon?.hex || "").replace("#", "").toLowerCase();

  if (!hex || hex === "000000" || hex === "111111") {
    return "#f5f5f5";
  }

  return `#${hex}`;
}

function GenericAiLogo({
  className = "",
  size = "md"
}: Pick<AiToolLogoProps, "className" | "size">) {
  const sizeClasses = getSizeClasses(size);

  return (
    <span
      className={[
        "grid shrink-0 place-items-center border border-violet-400/25 bg-violet-400/10 text-violet-300",
        sizeClasses.box,
        className
      ].join(" ")}
      title="Generic AI agent"
    >
      <svg
        viewBox="0 0 24 24"
        className={sizeClasses.icon}
        aria-hidden="true"
      >
        <path
          d="M8 9.2h8A3.2 3.2 0 0 1 19.2 12v2.8A3.2 3.2 0 0 1 16 18H8a3.2 3.2 0 0 1-3.2-3.2V12A3.2 3.2 0 0 1 8 9.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M12 9.2V5.5M9.2 14h.1M14.7 14h.1M9 18v1.5M15 18v1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function AiToolLogo({
  tool,
  className = "",
  size = "md"
}: AiToolLogoProps) {
  const icon = getSimpleIcon(tool);
  const sizeClasses = getSizeClasses(size);

  if (!icon) {
    return (
      <GenericAiLogo
        size={size}
        className={className}
      />
    );
  }

  const color = getBrandColor(tool, icon);

  return (
    <span
      className={[
        "grid shrink-0 place-items-center border bg-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]",
        sizeClasses.box,
        className
      ].join(" ")}
      style={{
        color,
        borderColor: `${color}42`,
        backgroundColor: `${color}14`
      }}
      title={icon.title}
    >
      <svg
        viewBox={icon.slug === "openai" ? "0 0 16 16" : "0 0 24 24"}
        className={sizeClasses.icon}
        aria-hidden="true"
      >
        <path fill="currentColor" d={icon.path} />
      </svg>
    </span>
  );
}