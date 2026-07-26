import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Box,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  Download,
  FileLock2,
  FolderLock,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  MonitorSmartphone,
  PackageCheck,
  Radio,
  RefreshCw,
  Rocket,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wifi,
  WifiOff,
  type LucideIcon
} from "lucide-react";

import { Button } from "../ui/Button";
import { CustomSelect, type SelectOption } from "../ui/CustomSelect";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";
import { showStatusToast } from "../ui/StatusBar";
import { getProjects } from "../../api/client";
import type {
  DesktopSyncPairInput,
  DesktopSyncStatus
} from "../../types/desktopSync";

type SyncAction =
  | "load"
  | "pair"
  | "sync"
  | "updates"
  | "inbox"
  | "unpair"
  | null;

type AccountWorkspaceView = "overview" | "link" | "updates" | "security";
type StatusTone = "success" | "warning" | "neutral";

interface AccountWorkspaceTab {
  id: AccountWorkspaceView;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface StatusPillProps {
  label: string;
  tone?: StatusTone;
}

interface SummaryTileProps {
  label: string;
  value: string;
  caption?: string;
  icon: LucideIcon;
}

interface RoadmapItem {
  icon: LucideIcon;
  title: string;
  description: string;
  status: string;
  tone: StatusTone;
}

function formatPairingCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-F0-9]/g, "");
  const body = compact.startsWith("CF") ? compact.slice(2) : compact;
  return body ? `CF-${body.slice(0, 6)}` : "";
}

function getInitials(status: DesktopSyncStatus) {
  const source = status.user?.name || status.user?.email || "CF";
  const parts = source.trim().split(/\s+/).filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function getFriendlyErrorKey(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/PAIRING_CODE|PAIRING_LAUNCH_TOKEN|pairing code is invalid|expired/i.test(message)) {
    return "settings.desktopAccountErrorCode";
  }

  if (/INSTALLATION_OWNERSHIP_CONFLICT|another active account|another account/i.test(message)) {
    return "settings.desktopAccountErrorOwnership";
  }

  if (/WEBSITE_URL|Invalid URL|unsafe/i.test(message)) {
    return "settings.desktopAccountErrorUrl";
  }

  if (/SECURE_STORAGE|secure token storage/i.test(message)) {
    return "settings.desktopAccountErrorSecureStorage";
  }

  if (/WEBSITE_TIMEOUT|did not respond/i.test(message)) {
    return "settings.desktopAccountErrorTimeout";
  }

  if (/WEBSITE_OFFLINE|Could not reach|fetch failed/i.test(message)) {
    return "settings.desktopAccountErrorOffline";
  }

  return "settings.desktopAccountErrorGeneric";
}

function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
        tone === "success"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : tone === "warning"
            ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
            : "border-white/10 bg-white/[0.04] text-neutral-500"
      ].join(" ")}
    >
      <span
        className={[
          "size-1.5 rounded-full",
          tone === "success"
            ? "bg-emerald-300"
            : tone === "warning"
              ? "bg-amber-300"
              : "bg-neutral-600"
        ].join(" ")}
      />
      {label}
    </span>
  );
}

function SummaryTile({ label, value, caption, icon: Icon }: SummaryTileProps) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-black/35 p-4">
      <div className="flex items-center gap-2 text-neutral-600">
        <Icon size={14} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em]">
          {label}
        </p>
      </div>
      <p className="mt-3 truncate text-lg font-semibold tracking-[-0.03em] text-white">
        {value}
      </p>
      {caption ? (
        <p className="mt-1 text-xs leading-5 text-neutral-600">{caption}</p>
      ) : null}
    </div>
  );
}

function RoadmapCard({ item }: { item: RoadmapItem }) {
  const Icon = item.icon;

  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          <Icon size={15} />
        </span>
        <StatusPill label={item.status} tone={item.tone} />
      </div>
      <p className="mt-4 text-sm font-semibold text-white">{item.title}</p>
      <p className="mt-1.5 text-xs leading-5 text-neutral-600">
        {item.description}
      </p>
    </div>
  );
}

export function DesktopAccountPanel() {
  const { t, i18n } = useTranslation();
  const bridge = window.contextforge?.desktopSync;
  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);
  const [action, setAction] = useState<SyncAction>("load");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [activeView, setActiveView] =
    useState<AccountWorkspaceView>("overview");
  const [siteUrl, setSiteUrl] = useState("https://contextforge.dev");
  const [deviceName, setDeviceName] = useState("ContextForge Desktop");
  const [channel, setChannel] =
    useState<DesktopSyncPairInput["channel"]>("alpha");
  const [pairingCode, setPairingCode] = useState("");
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [localProjectCount, setLocalProjectCount] = useState<number | null>(null);
  const processedLaunchTokenRef = useRef<string | null>(null);

  const locale = i18n.resolvedLanguage?.startsWith("ru") ? "ru-RU" : "en-US";

  const channelOptions = useMemo<SelectOption<DesktopSyncPairInput["channel"]>[]>(
    () => [
      {
        value: "alpha",
        label: t("settings.desktopAccountChannelAlpha"),
        description: t("settings.desktopAccountChannelAlphaDesc")
      },
      {
        value: "beta",
        label: t("settings.desktopAccountChannelBeta"),
        description: t("settings.desktopAccountChannelBetaDesc")
      },
      {
        value: "stable",
        label: t("settings.desktopAccountChannelStable"),
        description: t("settings.desktopAccountChannelStableDesc")
      }
    ],
    [t]
  );

  const workspaceTabs = useMemo<AccountWorkspaceTab[]>(
    () => [
      {
        id: "overview",
        label: t("settings.desktopAccountTabOverview"),
        description: t("settings.desktopAccountTabOverviewDesc"),
        icon: Activity
      },
      {
        id: "link",
        label: t("settings.desktopAccountTabLink"),
        description: t("settings.desktopAccountTabLinkDesc"),
        icon: Link2
      },
      {
        id: "updates",
        label: t("settings.desktopAccountTabUpdates"),
        description: t("settings.desktopAccountTabUpdatesDesc"),
        icon: Rocket
      },
      {
        id: "security",
        label: t("settings.desktopAccountTabSecurity"),
        description: t("settings.desktopAccountTabSecurityDesc"),
        icon: ShieldCheck
      }
    ],
    [t]
  );

  const activeViewIndex = Math.max(
    0,
    workspaceTabs.findIndex((tab) => tab.id === activeView)
  );

  const formatDate = useCallback(
    (value: string | null | undefined, fallbackKey = "settings.desktopAccountNever") => {
      if (!value) {
        return t(fallbackKey);
      }

      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    },
    [locale, t]
  );

  const formattedLastSeen = useMemo(
    () => formatDate(status?.lastSeenAt),
    [formatDate, status?.lastSeenAt]
  );
  const formattedPairedAt = useMemo(
    () => formatDate(status?.pairedAt),
    [formatDate, status?.pairedAt]
  );
  const formattedLastChecked = useMemo(
    () => formatDate(status?.lastCheckedAt, "settings.desktopAccountNotChecked"),
    [formatDate, status?.lastCheckedAt]
  );
  const formattedReleaseDate = useMemo(
    () =>
      formatDate(
        status?.latestRelease?.publishedAt,
        "settings.desktopAccountNoReleaseMetadata"
      ),
    [formatDate, status?.latestRelease?.publishedAt]
  );
  const displayedProjectCount = localProjectCount ?? status?.projectCount ?? null;
  const hasCompletedUpdateCheck = Boolean(status?.lastCheckedAt);

  const roadmapItems = useMemo<RoadmapItem[]>(
    () => [
      {
        icon: Radio,
        title: t("settings.desktopAccountCapabilityPresence"),
        description: t("settings.desktopAccountCapabilityPresenceDesc"),
        status: t("settings.desktopAccountCapabilityActive"),
        tone: "success"
      },
      {
        icon: PackageCheck,
        title: t("settings.desktopAccountCapabilityReleases"),
        description: t("settings.desktopAccountCapabilityReleasesDesc"),
        status: t("settings.desktopAccountAvailable"),
        tone: "success"
      },
      {
        icon: Send,
        title: t("settings.desktopAccountCapabilityHandoff"),
        description: t("settings.desktopAccountCapabilityHandoffDesc"),
        status: status?.online
          ? t("settings.desktopAccountAvailable")
          : t("settings.desktopAccountCapabilityReady"),
        tone: status?.online ? "success" : "neutral"
      },
      {
        icon: BadgeCheck,
        title: t("settings.desktopAccountCapabilityLicense"),
        description: t("settings.desktopAccountCapabilityLicenseDesc"),
        status: t("settings.desktopAccountCapabilityPreview"),
        tone: "neutral"
      },
      {
        icon: MonitorSmartphone,
        title: t("settings.desktopAccountRoadmapDevices"),
        description: t("settings.desktopAccountRoadmapDevicesDesc"),
        status: t("settings.desktopAccountCapabilityPlanned"),
        tone: "neutral"
      },
      {
        icon: Sparkles,
        title: t("settings.desktopAccountRoadmapSettings"),
        description: t("settings.desktopAccountRoadmapSettingsDesc"),
        status: t("settings.desktopAccountCapabilityPlanned"),
        tone: "neutral"
      },
      {
        icon: UserRound,
        title: t("settings.desktopAccountRoadmapWorkspaces"),
        description: t("settings.desktopAccountRoadmapWorkspacesDesc"),
        status: t("settings.desktopAccountCapabilityPlanned"),
        tone: "neutral"
      },
      {
        icon: FolderLock,
        title: t("settings.desktopAccountRoadmapBackups"),
        description: t("settings.desktopAccountRoadmapBackupsDesc"),
        status: t("settings.desktopAccountCapabilityPlanned"),
        tone: "neutral"
      }
    ],
    [status?.online, t]
  );

  const announce = useCallback((message: string) => {
    setFeedbackMessage("");
    window.setTimeout(() => setFeedbackMessage(message), 0);
  }, []);

  const loadInbox = useCallback(
    async (showFeedback = false) => {
      if (!bridge || !status?.connected) {
        setInboxCount(null);
        return;
      }

      setAction((current) => current ?? "inbox");

      try {
        const items = await bridge.getTaskPackInbox();
        setInboxCount(items.length);
        if (showFeedback) {
          announce(t("settings.desktopAccountInboxRefreshed", { count: items.length }));
        }
      } catch {
        setInboxCount(null);
        if (showFeedback) {
          setErrorKey("settings.desktopAccountErrorOffline");
        }
      } finally {
        setAction((current) => (current === "inbox" ? null : current));
      }
    },
    [announce, bridge, status?.connected, t]
  );

  useEffect(() => {
    let disposed = false;

    void getProjects()
      .then((projects) => {
        if (!disposed) {
          setLocalProjectCount(projects.length);
        }
      })
      .catch(() => {
        if (!disposed) {
          setLocalProjectCount(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!bridge) {
      setAction(null);
      return;
    }

    let disposed = false;
    const unsubscribe = bridge.onStatusChanged((nextStatus) => {
      if (!disposed) {
        setStatus(nextStatus);
      }
    });

    void bridge
      .getStatus({ refresh: true })
      .then((nextStatus) => {
        if (disposed) {
          return;
        }

        setStatus(nextStatus);
        setSiteUrl(nextStatus.siteUrl);
        setDeviceName(nextStatus.deviceName);
        setChannel(
          ["alpha", "beta", "stable"].includes(nextStatus.channel)
            ? (nextStatus.channel as DesktopSyncPairInput["channel"])
            : "alpha"
        );
      })
      .catch((error) => {
        if (!disposed) {
          setErrorKey(getFriendlyErrorKey(error));
        }
      })
      .finally(() => {
        if (!disposed) {
          setAction(null);
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return undefined;

    let disposed = false;

    const processLaunchRequest = async () => {
      try {
        const request = await bridge.consumeLaunchRequest();
        if (
          disposed ||
          !request ||
          processedLaunchTokenRef.current === request.launchToken
        ) {
          return;
        }

        processedLaunchTokenRef.current = request.launchToken;
        setActiveView("link");
        setSiteUrl(request.siteUrl);
        setErrorKey(null);

        const currentStatus = await bridge.getStatus();
        if (disposed) return;
        if (currentStatus.connected) {
          setStatus(currentStatus);
          return;
        }

        setAction("pair");
        const nextStatus = await bridge.pair({
          launchToken: request.launchToken,
          siteUrl: request.siteUrl,
          deviceName,
          channel
        });
        if (disposed) return;

        setStatus(nextStatus);
        if (nextStatus.connected) {
          setPairingCode("");
          announce(t("settings.desktopAccountConnectedSuccess"));
        }
      } catch (error) {
        if (!disposed) {
          processedLaunchTokenRef.current = null;
          setErrorKey(getFriendlyErrorKey(error));
        }
      } finally {
        if (!disposed) setAction((current) => (current === "pair" ? null : current));
      }
    };

    const unsubscribe = bridge.onLaunchRequest(() => {
      void processLaunchRequest();
    });
    void processLaunchRequest();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [announce, bridge, channel, deviceName, t]);

  useEffect(() => {
    if (status?.connected) {
      void loadInbox(false);
    } else {
      setInboxCount(null);
    }
  }, [loadInbox, status?.connected]);

  async function runAction(
    nextAction: Exclude<SyncAction, "load" | "inbox" | null>,
    operation: () => Promise<DesktopSyncStatus>
  ) {
    setAction(nextAction);
    setErrorKey(null);

    try {
      const nextStatus = await operation();
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      setErrorKey(getFriendlyErrorKey(error));
      return null;
    } finally {
      setAction(null);
    }
  }

  async function openPairingPage() {
    if (!bridge) {
      return;
    }

    setErrorKey(null);

    try {
      await bridge.openPairingPage(siteUrl);
    } catch (error) {
      setErrorKey(getFriendlyErrorKey(error));
    }
  }

  async function handlePair() {
    if (!bridge) {
      return;
    }

    const nextStatus = await runAction("pair", () =>
      bridge.pair({
        pairingCode,
        siteUrl,
        deviceName,
        channel
      })
    );

    if (nextStatus?.connected) {
      setPairingCode("");
      announce(t("settings.desktopAccountConnectedSuccess"));
    }
  }

  async function handleSync() {
    if (!bridge) {
      return;
    }

    const nextStatus = await runAction("sync", () => bridge.heartbeat());

    if (nextStatus) {
      announce(t("settings.desktopAccountSyncSuccess"));
      await loadInbox(false);
    }
  }

  async function handleCheckUpdates() {
    if (!bridge) {
      return;
    }

    const nextStatus = await runAction("updates", () => bridge.checkForUpdates());

    if (nextStatus) {
      announce(
        nextStatus.updateAvailable
          ? t("settings.desktopAccountUpdateFoundSuccess", {
              version:
                nextStatus.latestRelease?.version ||
                t("settings.desktopAccountNewVersion")
            })
          : t("settings.desktopAccountUpdateCheckSuccess")
      );
    }
  }

  async function handleUnpair() {
    if (!bridge) {
      return;
    }

    if (!confirmUnpair) {
      setConfirmUnpair(true);
      return;
    }

    const nextStatus = await runAction("unpair", () => bridge.unpair());

    if (nextStatus) {
      setConfirmUnpair(false);
      setActiveView("overview");
      announce(t("settings.desktopAccountDisconnectedSuccess"));
    }
  }

  function openRelease() {
    const url =
      status?.latestRelease?.downloadUrl || status?.latestRelease?.releaseUrl;

    if (url) {
      void window.contextforge?.openExternalUrl?.(url);
    }
  }

  async function copyInstallationId() {
    if (!status?.installationId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(status.installationId);
      setCopiedId(true);
      announce(t("settings.desktopAccountIdCopiedSuccess"));
    } catch {
      setCopiedId(false);
    }
  }

  useEffect(() => {
    if (feedbackMessage) {
      showStatusToast(feedbackMessage);
    }
  }, [feedbackMessage]);

  if (!bridge) {
    return (
      <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-neutral-800 bg-black p-3 text-neutral-400">
            <CloudOff size={20} />
          </div>
          <div>
            <p className="font-medium text-white">
              {t("settings.desktopAccountUnavailableTitle")}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              {t("settings.desktopAccountUnavailableDesc")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (action === "load" && !status) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-[2rem] border border-neutral-900 bg-neutral-950/60">
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <Loader2 size={17} className="animate-spin" />
          {t("settings.desktopAccountLoading")}
        </div>
      </div>
    );
  }

  const connectionRows = status
    ? [
        {
          label: t("settings.desktopAccountAccountState"),
          value: t("settings.desktopAccountConnected"),
          description: status.user?.email || status.siteUrl,
          icon: UserRound,
          tone: "success" as const
        },
        {
          label: t("settings.desktopAccountDesktopLinkState"),
          value: t("settings.desktopAccountActive"),
          description: status.deviceName,
          icon: Link2,
          tone: "success" as const
        },
        {
          label: t("settings.desktopAccountWebState"),
          value: status.online
            ? t("settings.desktopAccountOnline")
            : t("settings.desktopAccountWebUnavailable"),
          description: status.online
            ? t("settings.desktopAccountWebOnlineDesc")
            : t("settings.desktopAccountWebOfflineDesc"),
          icon: status.online ? Wifi : WifiOff,
          tone: status.online ? ("success" as const) : ("warning" as const)
        },
        {
          label: t("settings.desktopAccountLocalState"),
          value: t("settings.desktopAccountAvailable"),
          description: t("settings.desktopAccountLocalAvailableDesc"),
          icon: Laptop,
          tone: "success" as const
        }
      ]
    : [];

  return (
    <div className="space-y-5">
      {errorKey ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm leading-5 text-red-200"
        >
          {t(errorKey)}
        </motion.div>
      ) : null}

      {status && !status.secureStorageAvailable ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="text-sm leading-5 text-amber-100/80">
            {t("settings.desktopAccountSecureStorageUnavailable")}
          </p>
        </div>
      ) : null}

      {status?.connected ? (
        <>
          <div className="overflow-hidden rounded-[2rem] border border-neutral-800 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.09),transparent_34%),linear-gradient(145deg,#0d0d0d,#050505)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.26)]">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white text-base font-semibold text-black shadow-[0_12px_30px_rgba(255,255,255,0.08)]">
                  {getInitials(status)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-lg font-semibold tracking-[-0.03em] text-white">
                      {status.user?.name || t("settings.desktopAccountConnectedUser")}
                    </p>
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
                    <StatusPill
                      label={
                        status.online
                          ? t("settings.desktopAccountOnline")
                          : t("settings.desktopAccountWebUnavailable")
                      }
                      tone={status.online ? "success" : "warning"}
                    />
                  </div>
                  <p className="mt-1 truncate text-sm text-neutral-500">
                    {status.user?.email || status.siteUrl}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-neutral-600">
                    {t("settings.desktopAccountProfileSummary", {
                      device: status.deviceName,
                      version: status.appVersion
                    })}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={Boolean(action)}
                  onClick={() => void handleSync()}
                >
                  {action === "sync" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {t("settings.desktopAccountSyncNow")}
                </Button>
                <Button variant="ghost" onClick={() => void openPairingPage()}>
                  <ArrowUpRight size={15} />
                  {t("settings.desktopAccountOpenWebsite")}
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryTile
                icon={Laptop}
                label={t("settings.desktopAccountDevice")}
                value={status.deviceName}
                caption={`${status.platform} / ${status.arch}`}
              />
              <SummaryTile
                icon={Activity}
                label={t("settings.desktopAccountLastSignal")}
                value={formattedLastSeen}
                caption={
                  status.online
                    ? t("settings.desktopAccountHeartbeatActive")
                    : t("settings.desktopAccountHeartbeatPaused")
                }
              />
              <SummaryTile
                icon={Box}
                label={t("settings.desktopAccountIncomingPacks")}
                value={inboxCount === null ? "—" : String(inboxCount)}
                caption={
                  inboxCount === null
                    ? t("settings.desktopAccountInboxUnavailable")
                    : t("settings.desktopAccountIncomingPacksDesc")
                }
              />
              <SummaryTile
                icon={BadgeCheck}
                label={t("settings.desktopAccountLicense")}
                value={status.license || "alpha"}
                caption={t("settings.desktopAccountChannelValue", {
                  channel: status.channel
                })}
              />
            </div>
          </div>

          <HorizontalSlidingSelector
            items={workspaceTabs}
            activeIndex={activeViewIndex}
            getItemKey={(item) => item.id}
            onSelect={(item) => setActiveView(item.id)}
            ariaLabel={t("settings.desktopAccountWorkspaceNavigation")}
            className="rounded-[1.35rem]"
            itemClassName="min-h-[58px] px-3 py-2"
            indicatorClassName="rounded-[1.05rem]"
            renderItem={(item, isActive) => {
              const Icon = item.icon;

              return (
                <span className="flex min-w-0 items-center justify-center gap-2.5">
                  <Icon
                    size={15}
                    className={isActive ? "text-black" : "text-neutral-600"}
                  />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-xs font-semibold">
                      {item.label}
                    </span>
                    <span
                      className={[
                        "mt-0.5 hidden truncate text-[10px] xl:block",
                        isActive ? "text-black/55" : "text-neutral-700"
                      ].join(" ")}
                    >
                      {item.description}
                    </span>
                  </span>
                </span>
              );
            }}
          />

          <div className="min-h-[520px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeView}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeView === "overview" ? (
                  <div className="space-y-5">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
                      <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              {t("settings.desktopAccountConnectionSummary")}
                            </p>
                            <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                              {t("settings.desktopAccountOverviewTitle")}
                            </h3>
                            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                              {t("settings.desktopAccountOverviewDesc")}
                            </p>
                          </div>
                          <StatusPill
                            label={t("settings.desktopAccountConnected")}
                            tone="success"
                          />
                        </div>

                        <div className="mt-5 grid gap-2 sm:grid-cols-2">
                          {connectionRows.map((row) => {
                            const Icon = row.icon;

                            return (
                              <div
                                key={row.label}
                                className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                                    <Icon size={15} />
                                  </span>
                                  <StatusPill label={row.value} tone={row.tone} />
                                </div>
                                <p className="mt-4 text-sm font-semibold text-white">
                                  {row.label}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-neutral-600">
                                  {row.description}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </section>

                      <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 place-items-center rounded-xl border border-neutral-800 bg-black text-neutral-400">
                            <Cloud size={17} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {t("settings.desktopAccountWorkspaceSnapshot")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">
                              {t("settings.desktopAccountWorkspaceSnapshotDesc")}
                            </p>
                          </div>
                        </div>

                        <dl className="mt-5 divide-y divide-white/[0.06] rounded-2xl border border-neutral-900 bg-black/35 px-4">
                          {[
                            [t("settings.desktopAccountProjects"), displayedProjectCount === null ? "—" : String(displayedProjectCount)],
                            [t("settings.desktopAccountVersion"), `v${status.appVersion}`],
                            [t("settings.desktopAccountChannel"), status.channel],
                            [t("settings.desktopAccountLinkedSince"), formattedPairedAt]
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-4 py-3"
                            >
                              <dt className="text-xs text-neutral-600">{label}</dt>
                              <dd className="max-w-[65%] truncate text-right text-xs font-medium text-neutral-300">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    </div>

                    <section className="grid gap-5 xl:grid-cols-2">
                      <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 place-items-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300">
                            <Server size={17} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {t("settings.desktopAccountSentToWeb")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">
                              {t("settings.desktopAccountSentToWebDesc")}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {[
                            t("settings.desktopAccountSentDevice"),
                            t("settings.desktopAccountSentBuild"),
                            t("settings.desktopAccountSentProjectCount"),
                            t("settings.desktopAccountSentExplicitPack")
                          ].map((item) => (
                            <div
                              key={item}
                              className="flex items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs text-neutral-500"
                            >
                              <Check size={13} className="shrink-0 text-emerald-300" />
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 place-items-center rounded-xl border border-neutral-800 bg-black text-neutral-400">
                            <FolderLock size={17} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {t("settings.desktopAccountStaysLocal")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">
                              {t("settings.desktopAccountStaysLocalDesc")}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {[
                            t("settings.desktopAccountLocalSource"),
                            t("settings.desktopAccountLocalPaths"),
                            t("settings.desktopAccountLocalSecrets"),
                            t("settings.desktopAccountLocalContext")
                          ].map((item) => (
                            <div
                              key={item}
                              className="flex items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs text-neutral-500"
                            >
                              <LockKeyhole size={13} className="shrink-0 text-neutral-400" />
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeView === "link" ? (
                  <div className="space-y-5">
                    <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            {t("settings.desktopAccountDesktopLinkState")}
                          </p>
                          <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                            {t("settings.desktopAccountLinkTitle")}
                          </h3>
                          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                            {t("settings.desktopAccountLinkDesc")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            disabled={Boolean(action)}
                            onClick={() => void loadInbox(true)}
                          >
                            {action === "inbox" ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <RefreshCw size={15} />
                            )}
                            {t("settings.desktopAccountRefreshInbox")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => void openPairingPage()}
                          >
                            <ArrowUpRight size={15} />
                            {t("settings.desktopAccountOpenWebsite")}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-6 grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr] xl:items-center">
                        {[
                          {
                            icon: Laptop,
                            title: t("settings.desktopAccountRouteDesktop"),
                            description: status.deviceName,
                            tone: "success" as const
                          },
                          {
                            icon: Cloud,
                            title: t("settings.desktopAccountRouteWeb"),
                            description: status.online
                              ? status.siteUrl
                              : t("settings.desktopAccountWebUnavailable"),
                            tone: status.online ? ("success" as const) : ("warning" as const)
                          },
                          {
                            icon: MonitorSmartphone,
                            title: t("settings.desktopAccountRouteTrusted"),
                            description: t("settings.desktopAccountRouteTrustedDesc"),
                            tone: "neutral" as const
                          }
                        ].map((step, index) => {
                          const Icon = step.icon;

                          return (
                            <div key={step.title} className="contents">
                              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                                    <Icon size={15} />
                                  </span>
                                  <StatusPill
                                    label={
                                      step.tone === "success"
                                        ? t("settings.desktopAccountActive")
                                        : step.tone === "warning"
                                          ? t("settings.desktopAccountOffline")
                                          : t("settings.desktopAccountCapabilityPlanned")
                                    }
                                    tone={step.tone}
                                  />
                                </div>
                                <p className="mt-4 text-sm font-semibold text-white">
                                  {step.title}
                                </p>
                                <p className="mt-1 truncate text-xs text-neutral-600">
                                  {step.description}
                                </p>
                              </div>
                              {index < 2 ? (
                                <div className="hidden h-px w-10 bg-gradient-to-r from-neutral-800 via-neutral-500 to-neutral-800 xl:block" />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                      <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span className="grid size-10 place-items-center rounded-xl border border-neutral-800 bg-black text-neutral-400">
                              <Send size={17} />
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {t("settings.desktopAccountTransferTitle")}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-neutral-600">
                                {t("settings.desktopAccountTransferDesc")}
                              </p>
                            </div>
                          </div>
                          <StatusPill
                            label={
                              status.online
                                ? t("settings.desktopAccountAvailable")
                                : t("settings.desktopAccountTransferWaitingForWeb")
                            }
                            tone={status.online ? "success" : "warning"}
                          />
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-3">
                          <SummaryTile
                            icon={Box}
                            label={t("settings.desktopAccountIncomingPacks")}
                            value={inboxCount === null ? "—" : String(inboxCount)}
                            caption={
                              inboxCount === null
                                ? t("settings.desktopAccountInboxUnavailable")
                                : t("settings.desktopAccountIncomingPacksDesc")
                            }
                          />
                          <SummaryTile
                            icon={Activity}
                            label={t("settings.desktopAccountLastSignal")}
                            value={formattedLastSeen}
                            caption={
                              status.online
                                ? t("settings.desktopAccountHeartbeatActive")
                                : t("settings.desktopAccountHeartbeatPaused")
                            }
                          />
                          <SummaryTile
                            icon={Send}
                            label={t("settings.desktopAccountOutgoingPacks")}
                            value={t("settings.desktopAccountOnDemand")}
                            caption={t("settings.desktopAccountOutgoingPacksDesc")}
                          />
                        </div>

                        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                          <p className="text-xs font-semibold text-neutral-300">
                            {t("settings.desktopAccountTransferRule")}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-neutral-600">
                            {t("settings.desktopAccountTransferRuleDesc")}
                          </p>
                        </div>
                      </section>

                      <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 place-items-center rounded-xl border border-neutral-800 bg-black text-neutral-400">
                            <Activity size={17} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {t("settings.desktopAccountLinkActivity")}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                              {t("settings.desktopAccountLinkActivityDesc")}
                            </p>
                          </div>
                        </div>
                        <dl className="mt-5 divide-y divide-white/[0.06] rounded-2xl border border-neutral-900 bg-black/35 px-4">
                          {[
                            [t("settings.desktopAccountLastSignal"), formattedLastSeen],
                            [t("settings.desktopAccountLastChecked"), formattedLastChecked],
                            [t("settings.desktopAccountWebsiteOrigin"), status.siteUrl],
                            [
                              t("settings.desktopAccountStateLabel"),
                              status.online
                                ? t("settings.desktopAccountOnline")
                                : t("settings.desktopAccountOffline")
                            ]
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between gap-4 py-3">
                              <dt className="text-xs text-neutral-600">{label}</dt>
                              <dd className="max-w-[62%] truncate text-right text-xs font-medium text-neutral-300">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    </div>

                    <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                      <div>
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                          {t("settings.desktopAccountRoadmapEyebrow")}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                          {t("settings.desktopAccountRoadmapTitle")}
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                          {t("settings.desktopAccountRoadmapDesc")}
                        </p>
                      </div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                        {roadmapItems.map((item) => (
                          <RoadmapCard key={item.title} item={item} />
                        ))}
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeView === "updates" ? (
                  <div className="space-y-5">
                    <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            {t("settings.desktopAccountUpdatesTitle")}
                          </p>
                          <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                            {t("settings.desktopAccountUpdatesWorkspaceTitle")}
                          </h3>
                          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                            {t("settings.desktopAccountUpdatesWorkspaceDesc")}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          disabled={Boolean(action)}
                          onClick={() => void handleCheckUpdates()}
                        >
                          {action === "updates" ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          {t("settings.desktopAccountCheckUpdates")}
                        </Button>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <SummaryTile
                          icon={Rocket}
                          label={t("settings.desktopAccountCurrentVersion")}
                          value={`v${status.appVersion}`}
                          caption={`${status.platform} / ${status.arch}`}
                        />
                        <SummaryTile
                          icon={PackageCheck}
                          label={t("settings.desktopAccountChannel")}
                          value={status.channel}
                          caption={t("settings.desktopAccountReleaseChannelDesc")}
                        />
                        <SummaryTile
                          icon={Activity}
                          label={t("settings.desktopAccountLastChecked")}
                          value={formattedLastChecked}
                          caption={t("settings.desktopAccountReleaseCatalogDesc")}
                        />
                        <SummaryTile
                          icon={Download}
                          label={t("settings.desktopAccountLatestRelease")}
                          value={status.latestRelease?.version || "—"}
                          caption={formattedReleaseDate}
                        />
                      </div>
                    </section>

                    <section className="overflow-hidden rounded-[2rem] border border-neutral-800 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_35%),#080808] p-5">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-4">
                          <span
                            className={[
                              "grid size-12 shrink-0 place-items-center rounded-2xl border",
                              status.updateAvailable
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                : "border-neutral-800 bg-black text-neutral-400"
                            ].join(" ")}
                          >
                            {status.updateAvailable ? (
                              <Download size={19} />
                            ) : hasCompletedUpdateCheck ? (
                              <CheckCircle2 size={19} />
                            ) : (
                              <RefreshCw size={19} />
                            )}
                          </span>
                          <div>
                            <p className="text-lg font-semibold tracking-[-0.03em] text-white">
                              {status.updateAvailable
                                ? t("settings.desktopAccountUpdateReady", {
                                    version:
                                      status.latestRelease?.version ||
                                      t("settings.desktopAccountNewVersion")
                                  })
                                : hasCompletedUpdateCheck
                                  ? t("settings.desktopAccountUpToDate")
                                  : t("settings.desktopAccountUpdateUnknown")}
                            </p>
                            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                              {!hasCompletedUpdateCheck
                                ? t("settings.desktopAccountUpdateUnknownDesc")
                                : status.latestRelease?.notes ||
                                  t("settings.desktopAccountReleaseStatusDesc")}
                            </p>
                          </div>
                        </div>

                        {status.updateAvailable &&
                        (status.latestRelease?.downloadUrl ||
                          status.latestRelease?.releaseUrl) ? (
                          <Button variant="primary" onClick={openRelease}>
                            <Download size={15} />
                            {t("settings.desktopAccountDownload")}
                          </Button>
                        ) : null}
                      </div>
                    </section>

                    <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("settings.desktopAccountCapabilityPlanned")}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                        {t("settings.desktopAccountUpdateRoadmapTitle")}
                      </h3>
                      <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                        {t("settings.desktopAccountUpdateRoadmapDesc")}
                      </p>
                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        {[
                          {
                            icon: Activity,
                            title: t("settings.desktopAccountAutoChecks"),
                            description: t("settings.desktopAccountAutoChecksDesc")
                          },
                          {
                            icon: FileLock2,
                            title: t("settings.desktopAccountReleaseNotes"),
                            description: t("settings.desktopAccountReleaseNotesDesc")
                          },
                          {
                            icon: Rocket,
                            title: t("settings.desktopAccountSafeRestart"),
                            description: t("settings.desktopAccountSafeRestartDesc")
                          }
                        ].map((item) => (
                          <RoadmapCard
                            key={item.title}
                            item={{
                              ...item,
                              status: t("settings.desktopAccountCapabilityPlanned"),
                              tone: "neutral"
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeView === "security" ? (
                  <div className="space-y-5">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                      <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              {t("settings.desktopAccountSecurityTitle")}
                            </p>
                            <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                              {t("settings.desktopAccountSecurityWorkspaceTitle")}
                            </h3>
                            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                              {t("settings.desktopAccountSecurityWorkspaceDesc")}
                            </p>
                          </div>
                          <StatusPill
                            label={
                              status.secureStorageAvailable
                                ? t("settings.desktopAccountProtected")
                                : t("settings.desktopAccountUnavailable")
                            }
                            tone={status.secureStorageAvailable ? "success" : "warning"}
                          />
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          {[
                            {
                              icon: ShieldCheck,
                              label: t("settings.desktopAccountSecureStorage"),
                              value: status.secureStorageAvailable
                                ? t("settings.desktopAccountProtected")
                                : t("settings.desktopAccountUnavailable")
                            },
                            {
                              icon: UserRound,
                              label: t("settings.desktopAccountConnectedUser"),
                              value: status.user?.email || "—"
                            },
                            {
                              icon: Cloud,
                              label: t("settings.desktopAccountWebsiteOrigin"),
                              value: status.siteUrl
                            },
                            {
                              icon: Activity,
                              label: t("settings.desktopAccountLinkedSince"),
                              value: formattedPairedAt
                            }
                          ].map((item) => {
                            const Icon = item.icon;

                            return (
                              <div
                                key={item.label}
                                className="rounded-2xl border border-neutral-900 bg-black/35 p-4"
                              >
                                <div className="flex items-center gap-2 text-neutral-600">
                                  <Icon size={14} />
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                                    {item.label}
                                  </p>
                                </div>
                                <p className="mt-3 truncate text-sm font-medium text-neutral-200">
                                  {item.value}
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-neutral-300">
                                {t("settings.desktopAccountInstallationId")}
                              </p>
                              <p className="mt-1 max-w-2xl truncate font-mono text-xs text-neutral-600">
                                {status.installationId || "—"}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              disabled={!status.installationId}
                              onClick={() => void copyInstallationId()}
                            >
                              {copiedId ? <Check size={14} /> : <Copy size={14} />}
                              {copiedId
                                ? t("settings.desktopAccountCopied")
                                : t("settings.desktopAccountCopyId")}
                            </Button>
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[2rem] border border-red-400/15 bg-red-400/[0.035] p-5">
                        <span className="grid size-10 place-items-center rounded-xl border border-red-400/15 bg-red-400/[0.06] text-red-200">
                          <LogOut size={17} />
                        </span>
                        <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em] text-white">
                          {t("settings.desktopAccountDisconnectTitle")}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-neutral-500">
                          {t("settings.desktopAccountDisconnectDesc")}
                        </p>
                        <button
                          type="button"
                          disabled={action === "unpair"}
                          onClick={() => void handleUnpair()}
                          onBlur={() => setConfirmUnpair(false)}
                          className={[
                            "mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
                            confirmUnpair
                              ? "border-red-300/35 bg-red-300/10 text-red-100 hover:bg-red-300/15"
                              : "border-red-400/20 bg-black/35 text-red-200 hover:border-red-300/35",
                            action === "unpair" ? "cursor-wait opacity-60" : ""
                          ].join(" ")}
                        >
                          {action === "unpair" ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <LogOut size={15} />
                          )}
                          {confirmUnpair
                            ? t("settings.desktopAccountConfirmDisconnect")
                            : t("settings.desktopAccountDisconnect")}
                        </button>
                      </section>
                    </div>

                    <section className="grid gap-5 xl:grid-cols-2">
                      <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 place-items-center rounded-xl border border-neutral-800 bg-black text-neutral-400">
                            <FolderLock size={17} />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {t("settings.desktopAccountLocalFirstTitle")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">
                              {t("settings.desktopAccountLocalFirstDesc")}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          {[
                            t("settings.desktopAccountLocalSource"),
                            t("settings.desktopAccountLocalPaths"),
                            t("settings.desktopAccountLocalSecrets"),
                            t("settings.desktopAccountLocalContext")
                          ].map((item) => (
                            <div
                              key={item}
                              className="flex items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-xs text-neutral-500"
                            >
                              <Check size={13} className="text-emerald-300" />
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                          {t("settings.desktopAccountCapabilityPlanned")}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                          {t("settings.desktopAccountSecurityRoadmapTitle")}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-neutral-500">
                          {t("settings.desktopAccountSecurityRoadmapDesc")}
                        </p>
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          {[
                            t("settings.desktopAccountTrustedDevices"),
                            t("settings.desktopAccountSessionReview"),
                            t("settings.desktopAccountRemoteRevoke")
                          ].map((item) => (
                            <div
                              key={item}
                              className="rounded-xl border border-neutral-900 bg-black/35 p-3 text-xs font-medium text-neutral-500"
                            >
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-[2rem] border border-neutral-800 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.055),transparent_35%),#090909] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-neutral-800 bg-black p-3 text-white">
                  <Link2 size={19} />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-[-0.03em] text-white">
                    {t("settings.desktopAccountConnectTitle")}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {t("settings.desktopAccountConnectDesc")}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-xs font-medium text-neutral-500">
                    {t("settings.desktopAccountWebsite")}
                  </span>
                  <input
                    value={siteUrl}
                    onChange={(event) => setSiteUrl(event.target.value)}
                    spellCheck={false}
                    inputMode="url"
                    className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/40 px-3.5 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-700 focus:border-white/40 focus:ring-4 focus:ring-white/[0.06]"
                    placeholder="https://contextforge.dev"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-neutral-500">
                    {t("settings.desktopAccountDeviceName")}
                  </span>
                  <div className="relative">
                    <Laptop
                      size={15}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
                    />
                    <input
                      value={deviceName}
                      onChange={(event) => setDeviceName(event.target.value)}
                      maxLength={90}
                      className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/40 pl-10 pr-3.5 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-700 focus:border-white/40 focus:ring-4 focus:ring-white/[0.06]"
                      placeholder="ContextForge Desktop"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-neutral-500">
                    {t("settings.desktopAccountChannel")}
                  </span>
                  <CustomSelect<DesktopSyncPairInput["channel"]>
                    value={channel}
                    options={channelOptions}
                    onChange={setChannel}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-xs font-medium text-neutral-500">
                    {t("settings.desktopAccountPairingCode")}
                  </span>
                  <div className="relative">
                    <KeyRound
                      size={15}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
                    />
                    <input
                      value={pairingCode}
                      onChange={(event) =>
                        setPairingCode(formatPairingCode(event.target.value))
                      }
                      autoCapitalize="characters"
                      autoComplete="one-time-code"
                      spellCheck={false}
                      maxLength={9}
                      className="h-12 w-full rounded-2xl border border-neutral-800 bg-black pl-10 pr-3.5 font-mono text-base tracking-[0.18em] text-white outline-none transition placeholder:tracking-normal placeholder:text-neutral-700 hover:border-neutral-700 focus:border-white/50 focus:ring-4 focus:ring-white/[0.07]"
                      placeholder="CF-A1B2C3"
                    />
                  </div>
                </label>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={
                    action === "pair" ||
                    !/^CF-[A-F0-9]{6}$/.test(pairingCode) ||
                    !deviceName.trim() ||
                    !status?.secureStorageAvailable
                  }
                  onClick={() => void handlePair()}
                >
                  {action === "pair" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  {action === "pair"
                    ? t("settings.desktopAccountConnecting")
                    : t("settings.desktopAccountConnect")}
                </Button>
                <Button variant="secondary" onClick={() => void openPairingPage()}>
                  <ArrowUpRight size={15} />
                  {t("settings.desktopAccountCreateCode")}
                </Button>
              </div>
            </section>

            <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-600">
                <Sparkles size={14} />
                {t("settings.desktopAccountHowItWorks")}
              </div>

              <ol className="mt-5 space-y-4">
                {[
                  t("settings.desktopAccountStepOne"),
                  t("settings.desktopAccountStepTwo"),
                  t("settings.desktopAccountStepThree")
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-black text-[10px] font-semibold text-neutral-500">
                      {index + 1}
                    </span>
                    <p className="pt-1 text-sm leading-5 text-neutral-500">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>

              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <ShieldCheck
                  size={16}
                  className="mt-0.5 shrink-0 text-emerald-300"
                />
                <p className="text-xs leading-5 text-neutral-600">
                  {t("settings.desktopAccountPrivacy")}
                </p>
              </div>
            </section>
          </div>

          <section className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("settings.desktopAccountCapabilityPlanned")}
            </p>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
              {t("settings.desktopAccountConnectBenefitsTitle")}
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
              {t("settings.desktopAccountConnectBenefitsDesc")}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {roadmapItems.slice(0, 4).map((item) => (
                <RoadmapCard key={item.title} item={item} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
