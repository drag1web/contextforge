import { useEffect, useState } from "react";
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
import { Switch } from "../ui/Switch";

type PreferenceKey = keyof DesktopPreferences;

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
          icon: Gamepad2,
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
