import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
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
import { Switch } from "../ui/Switch";

type PreferenceKey = keyof DesktopPreferences;

function DiscordMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19.73 4.87a17.4 17.4 0 0 0-4.33-1.35l-.53 1.08a16.2 16.2 0 0 0-5.73 0L8.6 3.52a17.5 17.5 0 0 0-4.34 1.36C1.52 8.97.78 12.96 1.15 16.9a17.4 17.4 0 0 0 5.32 2.67l1.3-1.78a10.9 10.9 0 0 1-2.03-.98l.5-.39c3.92 1.82 8.18 1.82 12.06 0l.52.39c-.65.38-1.33.71-2.04.98l1.3 1.78a17.4 17.4 0 0 0 5.32-2.67c.44-4.57-.75-8.52-3.67-12.03ZM8.68 14.49c-1.16 0-2.12-1.08-2.12-2.42 0-1.33.94-2.42 2.12-2.42 1.2 0 2.14 1.1 2.12 2.42 0 1.34-.94 2.42-2.12 2.42Zm6.64 0c-1.16 0-2.12-1.08-2.12-2.42 0-1.33.94-2.42 2.12-2.42 1.2 0 2.14 1.1 2.12 2.42 0 1.34-.92 2.42-2.12 2.42Z" />
    </svg>
  );
}

export function DesktopExperiencePanel() {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  const [savingKey, setSavingKey] = useState<PreferenceKey | null>(null);

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
          icon: DiscordMark,
          title: t("desktopExperience.discordTitle"),
          description: t("desktopExperience.discordDescription"),
        },
        {
          key: "windowsNotifications" as const,
          icon: Bell,
          title: t("desktopExperience.notificationsTitle"),
          description: t("desktopExperience.notificationsDescription"),
        },
        {
          key: "taskbarActivity" as const,
          icon: MonitorDot,
          title: t("desktopExperience.taskbarTitle"),
          description: t("desktopExperience.taskbarDescription"),
        },
        {
          key: "windowsJumpList" as const,
          icon: ListTree,
          title: t("desktopExperience.jumpListTitle"),
          description: t("desktopExperience.jumpListDescription"),
        },
      ]
    : [];

  return (
    <section className="overflow-hidden rounded-[1.65rem] border border-neutral-900 bg-black/25">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-900 px-5 py-5">
        <div className="max-w-3xl">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("desktopExperience.eyebrow")}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
            {t("desktopExperience.title")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            {t("desktopExperience.description")}
          </p>
        </div>

        <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500">
          {t("desktopExperience.localBadge")}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-6 text-sm text-neutral-600">
          {t("desktopExperience.loading")}
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

              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden min-w-10 text-right text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600 sm:block">
                  {checked
                    ? t("desktopExperience.enabled")
                    : t("desktopExperience.disabled")}
                </span>
                <Switch
                  checked={checked}
                  disabled={savingKey !== null}
                  label={t("desktopExperience.preferenceToggle", {
                    name: row.title,
                    state: checked
                      ? t("desktopExperience.enabled")
                      : t("desktopExperience.disabled"),
                  })}
                  onCheckedChange={(next) =>
                    void updatePreference(row.key, next)
                  }
                  className={savingKey !== null ? "cursor-wait" : ""}
                />
              </div>
            </motion.div>
          );
        })
      )}
    </section>
  );
}
