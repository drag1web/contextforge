import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Download,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  LogOut,
  PackageCheck,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles
} from "lucide-react";

import { Button } from "../ui/Button";
import { CustomSelect, type SelectOption } from "../ui/CustomSelect";
import type {
  DesktopSyncPairInput,
  DesktopSyncStatus
} from "../../types/desktopSync";

type SyncAction = "load" | "pair" | "sync" | "updates" | "unpair" | null;

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

  if (/PAIRING_CODE|pairing code is invalid|expired/i.test(message)) {
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

export function DesktopAccountPanel() {
  const { t, i18n } = useTranslation();
  const bridge = window.contextforge?.desktopSync;
  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);
  const [action, setAction] = useState<SyncAction>("load");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState("https://contextforge.dev");
  const [deviceName, setDeviceName] = useState("ContextForge Desktop");
  const [channel, setChannel] =
    useState<DesktopSyncPairInput["channel"]>("alpha");
  const [pairingCode, setPairingCode] = useState("");
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

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

  const formattedLastSeen = useMemo(() => {
    if (!status?.lastSeenAt) {
      return t("settings.desktopAccountNever");
    }

    return new Intl.DateTimeFormat(
      i18n.resolvedLanguage?.startsWith("ru") ? "ru-RU" : "en-US",
      {
        dateStyle: "medium",
        timeStyle: "short"
      }
    ).format(new Date(status.lastSeenAt));
  }, [i18n.resolvedLanguage, status?.lastSeenAt, t]);

  const capabilities = useMemo(
    () => [
      {
        icon: Radio,
        title: t("settings.desktopAccountCapabilityPresence"),
        description: t("settings.desktopAccountCapabilityPresenceDesc"),
        status: t("settings.desktopAccountCapabilityActive"),
        active: true
      },
      {
        icon: PackageCheck,
        title: t("settings.desktopAccountCapabilityReleases"),
        description: t("settings.desktopAccountCapabilityReleasesDesc"),
        status: t("settings.desktopAccountCapabilityActive"),
        active: true
      },
      {
        icon: BadgeCheck,
        title: t("settings.desktopAccountCapabilityLicense"),
        description: t("settings.desktopAccountCapabilityLicenseDesc"),
        status: t("settings.desktopAccountCapabilityPreview"),
        active: false
      },
      {
        icon: Send,
        title: t("settings.desktopAccountCapabilityHandoff"),
        description: t("settings.desktopAccountCapabilityHandoffDesc"),
        status: t("settings.desktopAccountCapabilityActive"),
        active: true
      }
    ],
    [t]
  );

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

  async function runAction(
    nextAction: Exclude<SyncAction, "load" | null>,
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
    } catch {
      setCopiedId(false);
    }
  }

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

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-600">
            <Cloud size={13} />
            {t("settings.desktopAccountEyebrow")}
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
            {t("settings.desktopAccountTitle")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
            {t("settings.desktopAccountDescription")}
          </p>
        </div>

        {status?.connected && (
          <div
            className={[
              "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
              status.online
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/20 bg-amber-400/10 text-amber-300"
            ].join(" ")}
          >
            <span
              className={[
                "h-1.5 w-1.5 rounded-full",
                status.online ? "bg-emerald-300" : "bg-amber-300"
              ].join(" ")}
            />
            {status.online
              ? t("settings.desktopAccountOnline")
              : t("settings.desktopAccountOffline")}
          </div>
        )}
      </div>

      {errorKey && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm leading-5 text-red-200"
        >
          {t(errorKey)}
        </motion.div>
      )}

      {status && !status.secureStorageAvailable && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="text-sm leading-5 text-amber-100/80">
            {t("settings.desktopAccountSecureStorageUnavailable")}
          </p>
        </div>
      )}

      {status?.connected ? (
        <>
          <div className="overflow-hidden rounded-[2rem] border border-neutral-800 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.09),transparent_34%),linear-gradient(145deg,#0d0d0d,#050505)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.26)]">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white text-base font-semibold text-black shadow-[0_12px_30px_rgba(255,255,255,0.08)]">
                  {getInitials(status)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-semibold text-white">
                      {status.user?.name ||
                        t("settings.desktopAccountConnectedUser")}
                    </p>
                    <Check
                      size={15}
                      className="shrink-0 text-emerald-300"
                    />
                  </div>
                  <p className="mt-1 truncate text-sm text-neutral-500">
                    {status.user?.email || status.siteUrl}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={Boolean(action)}
                  onClick={() =>
                    runAction("sync", () => bridge.heartbeat())
                  }
                >
                  {action === "sync" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {t("settings.desktopAccountSyncNow")}
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

            <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  label: t("settings.desktopAccountDevice"),
                  value: status.deviceName
                },
                {
                  label: t("settings.desktopAccountVersion"),
                  value: `v${status.appVersion}`
                },
                {
                  label: t("settings.desktopAccountChannel"),
                  value: status.channel
                },
                {
                  label: t("settings.desktopAccountLicense"),
                  value: status.license || "alpha"
                },
                {
                  label: t("settings.desktopAccountProjects"),
                  value:
                    status.projectCount === null
                      ? "—"
                      : String(status.projectCount)
                },
                {
                  label: t("settings.desktopAccountLastSignal"),
                  value: formattedLastSeen
                },
                {
                  label: t("settings.desktopAccountInstallationId"),
                  value: status.installationId,
                  copyable: true
                }
              ].map((item) => (
                <div
                  key={item.label}
                  className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/35 px-4 py-3"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-700">
                    {item.label}
                  </p>
                  <div className="mt-1.5 flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">
                      {item.value}
                    </p>
                    {item.copyable && item.value && (
                      <button
                        type="button"
                        onClick={() => void copyInstallationId()}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-neutral-500 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                      >
                        {copiedId ? <Check size={11} /> : <Copy size={11} />}
                        {copiedId
                          ? t("settings.desktopAccountCopied")
                          : t("settings.desktopAccountCopyId")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-neutral-800 bg-black p-2 text-neutral-400">
                  <RefreshCw size={16} />
                </div>
                <div>
                  <p className="font-medium text-white">
                    {t("settings.desktopAccountUpdatesTitle")}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {t("settings.desktopAccountUpdatesDesc")}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <div>
                  <p className="text-sm font-medium text-white">
                    {status.updateAvailable
                      ? t("settings.desktopAccountUpdateReady", {
                          version:
                            status.latestRelease?.version ||
                            t("settings.desktopAccountNewVersion")
                        })
                      : t("settings.desktopAccountUpToDate")}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {t("settings.desktopAccountCurrentBuild", {
                      version: status.appVersion,
                      platform: status.platform,
                      arch: status.arch
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={Boolean(action)}
                    onClick={() =>
                      runAction("updates", () => bridge.checkForUpdates())
                    }
                  >
                    {action === "updates" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {t("settings.desktopAccountCheckUpdates")}
                  </Button>

                  {status.updateAvailable &&
                    (status.latestRelease?.downloadUrl ||
                      status.latestRelease?.releaseUrl) && (
                      <Button variant="primary" onClick={openRelease}>
                        <Download size={15} />
                        {t("settings.desktopAccountDownload")}
                      </Button>
                    )}
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-neutral-800 bg-black p-2 text-neutral-400">
                  <ShieldCheck size={16} />
                </div>
                <div>
                  <p className="font-medium text-white">
                    {t("settings.desktopAccountSecurityTitle")}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {t("settings.desktopAccountSecurityDesc")}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={action === "unpair"}
                onClick={handleUnpair}
                onBlur={() => setConfirmUnpair(false)}
                className={[
                  "mt-5 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition",
                  confirmUnpair
                    ? "border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/15"
                    : "border-neutral-800 bg-black/40 text-neutral-400 hover:border-neutral-700 hover:text-white",
                  action === "unpair"
                    ? "cursor-wait opacity-60"
                    : ""
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
            </div>
          </div>
        </>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[2rem] border border-neutral-800 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.055),transparent_35%),#090909] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-neutral-800 bg-black p-3 text-white">
                <Link2 size={19} />
              </div>
              <div>
                <p className="font-medium text-white">
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
                onClick={handlePair}
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
              <Button
                variant="secondary"
                onClick={() => void openPairingPage()}
              >
                <ArrowUpRight size={15} />
                {t("settings.desktopAccountCreateCode")}
              </Button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
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
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-black text-[10px] font-semibold text-neutral-500">
                    {index + 1}
                  </span>
                  <p className="pt-0.5 text-sm leading-5 text-neutral-500">
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
          </div>
        </div>
      )}

      <div className="rounded-[2rem] border border-neutral-900 bg-neutral-950/60 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-600">
              <Sparkles size={14} />
              {t("settings.desktopAccountCapabilitiesTitle")}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              {t("settings.desktopAccountCapabilitiesDesc")}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {capabilities.map((capability) => {
            const Icon = capability.icon;

            return (
              <div
                key={capability.title}
                className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                    <Icon size={15} />
                  </span>
                  <span
                    className={[
                      "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      capability.active
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : "border-white/10 bg-white/[0.04] text-neutral-500"
                    ].join(" ")}
                  >
                    {capability.status}
                  </span>
                </div>
                <p className="mt-4 text-sm font-semibold text-white">
                  {capability.title}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-neutral-600">
                  {capability.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
