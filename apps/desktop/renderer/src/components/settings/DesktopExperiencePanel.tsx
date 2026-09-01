import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  Gamepad2,
  ListTree,
  MonitorDot,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  getDesktopPreferences,
  subscribeDesktopPreferences,
  updateDesktopPreferences,
  type DesktopPreferences,
} from "../../lib/desktopPreferences";

type PreferenceKey = keyof DesktopPreferences;

function DesktopToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="hidden min-w-10 text-right text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600 sm:block">
        {label}
      </span>

      <motion.button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        whileTap={disabled ? undefined : { scale: 0.97 }}
        onClick={() => onChange(!checked)}
        className={[
          "relative h-6 w-11 shrink-0 overflow-hidden rounded-full border",
          "outline-none transition-[background-color,border-color,box-shadow] duration-150",
          "focus-visible:ring-2 focus-visible:ring-white/20",
          checked
            ? "border-neutral-300/70 bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]"
            : "border-neutral-800 bg-neutral-950 hover:border-neutral-700",
          disabled ? "cursor-wait opacity-50" : "cursor-pointer",
        ].join(" ")}
      >
        <motion.span
          aria-hidden="true"
          className={[
            "absolute left-[3px] top-[3px] h-4 w-4 rounded-full",
            "shadow-[0_1px_3px_rgba(0,0,0,0.35)]",
            checked
              ? "bg-neutral-950 ring-1 ring-black/80"
              : "bg-neutral-500 ring-1 ring-white/5",
          ].join(" ")}
          initial={false}
          animate={{ x: checked ? 22 : 0 }}
          transition={{
            type: "tween",
            duration: 0.16,
            ease: [0.22, 1, 0.36, 1],
          }}
        />
      </motion.button>
    </div>
  );
}

export function DesktopExperiencePanel() {
  const { i18n } = useTranslation();
  const isRussian = i18n.language.toLowerCase().startsWith("ru");
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  const [savingKey, setSavingKey] = useState<PreferenceKey | null>(null);

  const copy = useMemo(
    () =>
      isRussian
        ? {
            eyebrow: "ЛОКАЛЬНЫЕ ИНТЕГРАЦИИ",
            title: "Интеграции рабочего стола",
            description:
              "Системные функции ContextForge для этого компьютера. Настройки применяются сразу и не синхронизируются с аккаунтом.",
            localBadge: "Только это устройство",
            enabled: "Вкл.",
            disabled: "Выкл.",
            loading: "Загрузка локальных настроек...",
            discordTitle: "Активность в Discord",
            discordDescription:
              "Показывать в профиле Discord общий статус ContextForge и текущий тип активности без названий проектов, задач и путей.",
            notificationsTitle: "Уведомления Windows",
            notificationsDescription:
              "Сообщать о завершении Task Pack и Validation Lab, когда окно ContextForge находится в фоне.",
            taskbarTitle: "Индикатор на панели задач",
            taskbarDescription:
              "Показывать системную индикацию на иконке ContextForge во время анализа, генерации и валидации.",
            jumpListTitle: "Быстрые действия Windows",
            jumpListDescription:
              "Добавлять команды ContextForge в меню правого клика по иконке на панели задач: проекты, пакеты задач, отчёты и настройки.",
          }
        : {
            eyebrow: "LOCAL INTEGRATIONS",
            title: "Desktop integrations",
            description:
              "System-level ContextForge features for this computer. Changes apply immediately and are not synced with your account.",
            localBadge: "This device only",
            enabled: "On",
            disabled: "Off",
            loading: "Loading local preferences...",
            discordTitle: "Discord activity",
            discordDescription:
              "Show generic ContextForge status and activity type in Discord without project names, tasks or paths.",
            notificationsTitle: "Windows notifications",
            notificationsDescription:
              "Notify when a Task Pack or Validation Lab run finishes while ContextForge is in the background.",
            taskbarTitle: "Taskbar activity indicator",
            taskbarDescription:
              "Show native activity on the ContextForge taskbar icon while analyzing, generating or validating.",
            jumpListTitle: "Windows quick actions",
            jumpListDescription:
              "Add ContextForge shortcuts to the taskbar right-click menu for projects, Task Packs, reports and settings.",
          },
    [isRussian],
  );

  useEffect(() => {
    let disposed = false;

    void getDesktopPreferences().then((next) => {
      if (!disposed) setPreferences(next);
    });

    const unsubscribe = subscribeDesktopPreferences((next) => {
      if (!disposed) setPreferences(next);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const updatePreference = async (
    key: PreferenceKey,
    value: boolean,
  ) => {
    if (!preferences || savingKey) return;

    const previous = preferences;
    setSavingKey(key);
    setPreferences({ ...preferences, [key]: value });

    try {
      const next = await updateDesktopPreferences({ [key]: value });
      setPreferences(next);
    } catch {
      setPreferences(previous);
    } finally {
      setSavingKey(null);
    }
  };

  const rows = preferences
    ? [
        {
          key: "discordRichPresence" as const,
          icon: Gamepad2,
          title: copy.discordTitle,
          description: copy.discordDescription,
        },
        {
          key: "windowsNotifications" as const,
          icon: Bell,
          title: copy.notificationsTitle,
          description: copy.notificationsDescription,
        },
        {
          key: "taskbarActivity" as const,
          icon: MonitorDot,
          title: copy.taskbarTitle,
          description: copy.taskbarDescription,
        },
        {
          key: "windowsJumpList" as const,
          icon: ListTree,
          title: copy.jumpListTitle,
          description: copy.jumpListDescription,
        },
      ]
    : [];

  return (
    <section className="overflow-hidden rounded-[1.65rem] border border-neutral-900 bg-black/25">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 px-5 py-5">
        <div className="max-w-3xl">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {copy.eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
            {copy.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            {copy.description}
          </p>
        </div>

        <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500">
          {copy.localBadge}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-6 text-sm text-neutral-600">
          {copy.loading}
        </div>
      ) : (
        rows.map((row, index) => {
          const Icon = row.icon;
          const checked = preferences![row.key];

          return (
            <motion.div
              key={row.key}
              initial={false}
              animate={{ opacity: 1 }}
              className={[
                "flex min-h-[74px] items-center justify-between gap-5 px-5 py-4",
                index > 0 ? "border-t border-neutral-900" : "",
              ].join(" ")}
            >
              <div className="flex min-w-0 items-start gap-3.5">
                <span
                  className={[
                    "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border",
                    "transition-colors duration-200",
                    checked
                      ? "border-neutral-700 bg-neutral-900 text-neutral-200"
                      : "border-neutral-900 bg-black/35 text-neutral-600",
                  ].join(" ")}
                >
                  <Icon size={16} strokeWidth={1.8} />
                </span>

                <div className="min-w-0">
                  <p
                    className={[
                      "text-sm font-semibold transition-colors duration-200",
                      checked ? "text-white" : "text-neutral-400",
                    ].join(" ")}
                  >
                    {row.title}
                  </p>
                  <p className="mt-1 max-w-4xl text-xs leading-5 text-neutral-600">
                    {row.description}
                  </p>
                </div>
              </div>

              <DesktopToggle
                checked={checked}
                disabled={savingKey !== null}
                label={checked ? copy.enabled : copy.disabled}
                onChange={(next) => void updatePreference(row.key, next)}
              />
            </motion.div>
          );
        })
      )}
    </section>
  );
}
