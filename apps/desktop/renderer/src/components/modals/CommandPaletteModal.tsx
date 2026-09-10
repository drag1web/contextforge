import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Focus,
  FolderKanban,
  FolderPlus,
  Gauge,
  LayoutGrid,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { getEffectiveKeyboardShortcut } from "../../lib/keyboardShortcutPreferences";
import {
  executeCommandPaletteCommand,
  filterCommandPaletteCommands,
  type CommandPaletteCategory,
  type CommandPaletteCommand,
  type CommandPaletteIcon,
} from "../../utils/commandPalette";
import { Modal } from "../ui/Modal";

interface CommandPaletteModalProps {
  commands: readonly CommandPaletteCommand[];
  onClose: () => void;
}

interface CommandGroup {
  category: CommandPaletteCategory;
  commands: CommandPaletteCommand[];
}

const RESULT_LIST_ID = "contextforge-command-palette-results";

const COMMAND_ICONS: Record<CommandPaletteIcon, LucideIcon> = {
  add: FolderPlus,
  archive: Archive,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  focus: Focus,
  page: LayoutGrid,
  project: FolderKanban,
  rescan: RefreshCw,
  search: Search,
  settings: Settings,
  "task-pack": FileText,
  "zoom-in": Plus,
  "zoom-out": Minus,
  "zoom-reset": RotateCcw,
};

function groupCommands(commands: readonly CommandPaletteCommand[]) {
  const groups: CommandGroup[] = [];
  const groupByCategory = new Map<CommandPaletteCategory, CommandGroup>();

  for (const command of commands) {
    let group = groupByCategory.get(command.category);
    if (!group) {
      group = { category: command.category, commands: [] };
      groupByCategory.set(command.category, group);
      groups.push(group);
    }
    group.commands.push(command);
  }

  return groups;
}

function findEnabledIndex(
  commands: readonly CommandPaletteCommand[],
  startIndex: number,
  direction: 1 | -1,
) {
  if (commands.length === 0) return -1;
  const anchor = startIndex >= 0 ? startIndex : direction === 1 ? -1 : 0;

  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index = (anchor + direction * offset + commands.length) % commands.length;
    if (commands[index]?.enabled) return index;
  }

  return -1;
}

export function CommandPaletteModal({
  commands,
  onClose,
}: CommandPaletteModalProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState("");

  const filteredCommands = useMemo(
    () => filterCommandPaletteCommands(commands, query),
    [commands, query],
  );
  const groups = useMemo(
    () => groupCommands(filteredCommands),
    [filteredCommands],
  );
  const displayedCommands = useMemo(
    () => groups.flatMap((group) => group.commands),
    [groups],
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    displayedCommands.findIndex((command) => command.enabled),
  );
  const activeCommand = displayedCommands[activeIndex] ?? null;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    setActiveIndex(
      displayedCommands.findIndex((command) => command.enabled),
    );
  }, [displayedCommands]);

  useEffect(() => {
    if (!activeCommand) return;
    resultRefs.current.get(activeCommand.id)?.scrollIntoView({ block: "nearest" });
  }, [activeCommand]);

  const executeCommand = useCallback(
    (command: CommandPaletteCommand) => {
      if (!command.enabled) return;
      onClose();
      executeCommandPaletteCommand(command);
    },
    [onClose],
  );

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) =>
        findEnabledIndex(displayedCommands, current, direction),
      );
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const ordered = event.key === "Home"
        ? displayedCommands
        : [...displayedCommands].reverse();
      const command = ordered.find((item) => item.enabled);
      setActiveIndex(
        command
          ? displayedCommands.findIndex((item) => item.id === command.id)
          : -1,
      );
      return;
    }

    if (event.key === "Enter" && activeCommand) {
      event.preventDefault();
      executeCommand(activeCommand);
    }
  }

  return (
    <Modal
      title={t("commandPalette.title")}
      eyebrow={t("commandPalette.eyebrow")}
      closeLabel={t("commandPalette.close")}
      maxWidth="max-w-[760px]"
      scrollable={false}
      onClose={onClose}
    >
      <div className="flex h-full min-h-0 flex-col p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.1] bg-black/65 px-3.5 py-3 transition focus-within:border-white/30 focus-within:ring-4 focus-within:ring-white/[0.035] sm:px-4">
          <Search size={16} className="shrink-0 text-neutral-500" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label={t("commandPalette.inputLabel")}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={RESULT_LIST_ID}
            aria-activedescendant={
              activeCommand ? `command-palette-option-${activeCommand.id}` : undefined
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t("commandPalette.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-600"
          />
          <span className="hidden shrink-0 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-[10px] text-neutral-500 sm:inline-flex">
            {getEffectiveKeyboardShortcut("navigationAssistant")?.displayKeys ?? "Ctrl K"}
          </span>
        </div>

        <div className="mt-2 flex min-w-0 items-center justify-between gap-3 px-1 text-[10px] text-neutral-600">
          <span className="truncate">
            {query
              ? t("commandPalette.matchingResults", { count: displayedCommands.length })
              : t("commandPalette.suggestedCommands")}
          </span>
          <span className="shrink-0 font-mono">
            {t("commandPalette.resultLimit", { count: displayedCommands.length })}
          </span>
        </div>

        <div
          id={RESULT_LIST_ID}
          role="listbox"
          aria-label={t("commandPalette.resultsLabel")}
          className="mt-2 min-h-28 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-neutral-900 bg-black/30 p-1.5 sm:max-h-[min(56vh,520px)]"
        >
          {groups.length > 0 ? (
            <div className="space-y-2">
              {groups.map((group) => (
                <section key={group.category} className="min-w-0">
                  <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
                    <p className="cf-tech-label min-w-0 flex-1 truncate text-[9px] uppercase text-neutral-600">
                      {t(`commandPalette.categories.${group.category}`)}
                    </p>
                    <span className="shrink-0 text-[9px] tabular-nums text-neutral-700">
                      {group.commands.length}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    {group.commands.map((command) => {
                      const Icon = COMMAND_ICONS[command.icon] ?? Gauge;
                      const commandIndex = displayedCommands.findIndex(
                        (item) => item.id === command.id,
                      );
                      const isActive = commandIndex === activeIndex;
                      const shortcut = command.shortcutId
                        ? getEffectiveKeyboardShortcut(command.shortcutId)
                        : null;

                      return (
                        <button
                          key={command.id}
                          ref={(node) => {
                            if (node) resultRefs.current.set(command.id, node);
                            else resultRefs.current.delete(command.id);
                          }}
                          id={`command-palette-option-${command.id}`}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          aria-disabled={!command.enabled}
                          disabled={!command.enabled}
                          onMouseEnter={() => {
                            if (command.enabled) setActiveIndex(commandIndex);
                          }}
                          onClick={() => executeCommand(command)}
                          className={[
                            "group flex min-h-[52px] w-full min-w-0 items-center gap-3 rounded-xl border px-2.5 py-2 text-left outline-none transition duration-150 sm:px-3",
                            !command.enabled
                              ? "cursor-not-allowed border-transparent text-neutral-700 opacity-70"
                              : isActive
                                ? "border-white/15 bg-white/[0.08] text-white"
                                : "border-transparent text-neutral-400 hover:bg-white/[0.045] hover:text-neutral-200 focus-visible:border-white/20 focus-visible:bg-white/[0.07]",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "grid size-8 shrink-0 place-items-center rounded-lg border bg-black transition",
                              isActive && command.enabled
                                ? "border-white/15 text-white"
                                : "border-neutral-900 text-neutral-600 group-hover:border-neutral-800 group-hover:text-neutral-400",
                            ].join(" ")}
                          >
                            <Icon size={14} />
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-inherit">
                                {command.label}
                              </span>
                              {command.contextual ? (
                                <span className="shrink-0 rounded-full border border-neutral-800 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.08em] text-neutral-500">
                                  {t("commandPalette.contextual")}
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block min-w-0 truncate text-[10px] text-neutral-600 group-hover:text-neutral-500">
                              {command.enabled
                                ? command.description
                                : command.disabledReason ?? command.description}
                            </span>
                          </span>

                          {shortcut ? (
                            <span className="hidden shrink-0 rounded-lg border border-neutral-800 bg-black px-2 py-1 font-mono text-[9px] text-neutral-500 sm:inline-flex">
                              {shortcut.displayKeys}
                            </span>
                          ) : null}
                          {isActive && command.enabled ? (
                            <Check size={13} className="shrink-0 text-neutral-400" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid min-h-44 place-items-center px-5 py-8 text-center">
              <div>
                <Search size={18} className="mx-auto text-neutral-700" />
                <p className="mt-3 text-sm font-medium text-white">
                  {t("commandPalette.noResultsTitle")}
                </p>
                <p className="mt-1.5 text-sm text-neutral-600">
                  {t("commandPalette.noResultsDescription")}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-900 px-1 pt-3 text-[10px] text-neutral-600">
          <span className="min-w-0 flex-1 truncate">{t("commandPalette.footerHint")}</span>
          <span className="flex shrink-0 items-center gap-3 font-mono">
            <span>{t("commandPalette.keyboardNavigate")}</span>
            <span>{t("commandPalette.keyboardExecute")}</span>
            <span>{t("commandPalette.keyboardClose")}</span>
          </span>
        </div>
      </div>
    </Modal>
  );
}
