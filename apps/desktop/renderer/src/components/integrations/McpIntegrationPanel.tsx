import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CheckCircle2,
  Clipboard,
  Database,
  FileKey2,
  Loader2,
  LockKeyhole,
  Puzzle,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import {
  getContextForgeMcpStatus,
  testContextForgeMcpConnection,
  updateContextForgeMcpSettings,
} from "../../api/client";
import type {
  ContextForgeMcpStatus,
  ContextForgeMcpTestResult,
} from "../../types";
import { Button } from "../ui/Button";

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-7 w-12 rounded-full border p-1 transition",
        checked
          ? "border-emerald-300/30 bg-emerald-300/20"
          : "border-neutral-800 bg-neutral-950",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "block size-4 rounded-full transition-transform",
          checked
            ? "translate-x-5 bg-emerald-300"
            : "translate-x-0 bg-neutral-600",
        ].join(" ")}
      />
    </button>
  );
}

function PanelCard({
  icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-[1.6rem] border border-neutral-900 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(0,0,0,0.15))] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
            {description}
          </p>
        </div>
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

function PermissionRow({
  title,
  description,
  enabled,
  locked,
  onChange,
}: {
  title: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
  onChange?: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-200">{title}</p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">{description}</p>
      </div>
      {locked ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 text-neutral-400">
          <Check size={13} />
        </span>
      ) : (
        <Toggle
          checked={enabled}
          disabled={!onChange}
          label={title}
          onChange={(next) => onChange?.(next)}
        />
      )}
    </div>
  );
}

export function McpIntegrationPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ContextForgeMcpStatus | null>(null);
  const [testResult, setTestResult] = useState<ContextForgeMcpTestResult | null>(
    null,
  );
  const [busy, setBusy] = useState<"load" | "settings" | "test" | null>(
    "load",
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"command" | "config" | null>(null);

  const readiness = useMemo(() => {
    if (!status) return "loading";
    if (!status.enabled) return "disabled";
    if (!status.databasePathConfigured || !status.entrypoint.sourceReady) {
      return "error";
    }
    return status.entrypoint.ready ? "ready" : "needs_setup";
  }, [status]);

  async function loadStatus() {
    try {
      setBusy("load");
      setError(null);
      const next = await getContextForgeMcpStatus();
      setStatus(next);
      setTestResult(next.lastTest);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("integrationsHub.mcp.errors.load"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function updateSettings(patch: {
    enabled?: boolean;
    allowCreateTaskPacks?: boolean;
  }) {
    try {
      setBusy("settings");
      setError(null);
      setStatus(await updateContextForgeMcpSettings(patch));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("integrationsHub.mcp.errors.settings"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    try {
      setBusy("test");
      setError(null);
      const result = await testContextForgeMcpConnection();
      setTestResult(result);
      setStatus((current) =>
        current ? { ...current, lastTest: result } : current,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("integrationsHub.mcp.errors.test"),
      );
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, kind: "command" | "config") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  if (!status && busy === "load") {
    return (
      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5 text-sm text-neutral-500">
        <Loader2 size={15} className="mr-2 inline animate-spin" />
        {t("integrationsHub.mcp.loading")}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-950/15 p-5 text-sm text-red-200">
        {error ?? t("integrationsHub.mcp.errors.load")}
      </div>
    );
  }

  const readinessLabel = t(`integrationsHub.mcp.readiness.${readiness}`);

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-950/15 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <PanelCard
        icon={<Puzzle size={17} />}
        eyebrow={t("integrationsHub.mcp.statusEyebrow")}
        title={t("integrationsHub.mcp.title")}
        description={t("integrationsHub.mcp.description")}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: t("integrationsHub.mcp.metrics.state"),
              value: readinessLabel,
              icon: readiness === "ready" ? <CheckCircle2 size={14} /> : <XCircle size={14} />,
            },
            {
              label: t("integrationsHub.mcp.metrics.transport"),
              value: status.transport.toUpperCase(),
              icon: <TerminalSquare size={14} />,
            },
            {
              label: t("integrationsHub.mcp.metrics.version"),
              value: status.version,
              icon: <Server size={14} />,
            },
            {
              label: t("integrationsHub.mcp.metrics.lastTest"),
              value: testResult?.testedAt
                ? new Date(testResult.testedAt).toLocaleString()
                : t("integrationsHub.mcp.neverTested"),
              icon: <RefreshCw size={14} />,
            },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-neutral-900 bg-black/30 p-4"
            >
              <div className="flex items-center gap-2 text-neutral-600">
                {metric.icon}
                <span className="cf-tech-label text-[9px] uppercase">
                  {metric.label}
                </span>
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-white">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-neutral-200">
              {t("integrationsHub.mcp.enableTitle")}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              {t("integrationsHub.mcp.enableDescription")}
            </p>
          </div>
          <Toggle
            checked={status.enabled}
            disabled={busy !== null}
            label={t("integrationsHub.mcp.enableTitle")}
            onChange={(enabled) => void updateSettings({ enabled })}
          />
        </div>
      </PanelCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <PanelCard
          icon={<ShieldCheck size={17} />}
          eyebrow={t("integrationsHub.mcp.permissionsEyebrow")}
          title={t("integrationsHub.mcp.permissionsTitle")}
          description={t("integrationsHub.mcp.permissionsDescription")}
        >
          <div className="space-y-2">
            <PermissionRow
              title={t("integrationsHub.mcp.permissions.projects")}
              description={t("integrationsHub.mcp.permissions.projectsDescription")}
              enabled
              locked
            />
            <PermissionRow
              title={t("integrationsHub.mcp.permissions.memory")}
              description={t("integrationsHub.mcp.permissions.memoryDescription")}
              enabled
              locked
            />
            <PermissionRow
              title={t("integrationsHub.mcp.permissions.taskPacks")}
              description={t("integrationsHub.mcp.permissions.taskPacksDescription")}
              enabled
              locked
            />
            <PermissionRow
              title={t("integrationsHub.mcp.permissions.create")}
              description={t("integrationsHub.mcp.permissions.createDescription")}
              enabled={status.allowCreateTaskPacks}
              onChange={
                busy === null
                  ? (allowCreateTaskPacks) =>
                      void updateSettings({ allowCreateTaskPacks })
                  : undefined
              }
            />
          </div>
          <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] p-4 text-xs leading-5 text-amber-100/70">
            <LockKeyhole size={15} className="mt-0.5 shrink-0" />
            {t("integrationsHub.mcp.permissions.writeBoundary")}
          </div>
        </PanelCard>

        <PanelCard
          icon={<Database size={17} />}
          eyebrow={t("integrationsHub.mcp.testEyebrow")}
          title={t("integrationsHub.mcp.testTitle")}
          description={t("integrationsHub.mcp.testDescription")}
        >
          <Button
            type="button"
            onClick={() => void testConnection()}
            disabled={!status.enabled || busy !== null}
          >
            {busy === "test" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {t("integrationsHub.mcp.testAction")}
          </Button>

          {testResult ? (
            <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                {testResult.ok ? (
                  <CheckCircle2 size={15} className="text-emerald-400" />
                ) : (
                  <XCircle size={15} className="text-red-400" />
                )}
                {testResult.message}
              </div>
              <div className="mt-3 grid gap-2 text-xs text-neutral-500 sm:grid-cols-3">
                <span>{t("integrationsHub.mcp.discovered.tools", { count: testResult.tools.length })}</span>
                <span>{t("integrationsHub.mcp.discovered.resources", { count: testResult.resources.length + testResult.resourceTemplates.length })}</span>
                <span>{t("integrationsHub.mcp.discovered.prompts", { count: testResult.prompts.length })}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  ...testResult.tools,
                  ...testResult.resources,
                  ...testResult.resourceTemplates,
                  ...testResult.prompts,
                ]
                  .slice(0, 20)
                  .map((item) => (
                    <span key={item} className="cf-badge max-w-full truncate">
                      {item}
                    </span>
                  ))}
              </div>
            </div>
          ) : null}
        </PanelCard>
      </div>

      <PanelCard
        icon={<TerminalSquare size={17} />}
        eyebrow={t("integrationsHub.mcp.codexEyebrow")}
        title={t("integrationsHub.mcp.codexTitle")}
        description={t("integrationsHub.mcp.codexDescription")}
      >
        {!status.entrypoint.ready ? (
          <div className="mb-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3 text-xs leading-5 text-amber-100/70">
            {t("integrationsHub.mcp.buildWarning")}
          </div>
        ) : null}
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-neutral-400">
                {t("integrationsHub.mcp.commandLabel")}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void copy(status.codexRegistrationCommand, "command")
                }
              >
                {copied === "command" ? <Check size={13} /> : <Clipboard size={13} />}
                {copied === "command"
                  ? t("integrationsHub.mcp.copied")
                  : t("integrationsHub.mcp.copyCommand")}
              </Button>
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-neutral-900 bg-black/50 p-4 text-xs leading-5 text-neutral-400">
              {status.codexRegistrationCommand}
            </pre>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-neutral-400">
                {t("integrationsHub.mcp.configLabel")}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void copy(status.codexConfigSnippet, "config")}
              >
                {copied === "config" ? <Check size={13} /> : <Clipboard size={13} />}
                {copied === "config"
                  ? t("integrationsHub.mcp.copied")
                  : t("integrationsHub.mcp.copyConfig")}
              </Button>
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-neutral-900 bg-black/50 p-4 text-xs leading-5 text-neutral-400">
              {status.codexConfigSnippet}
            </pre>
          </div>
        </div>
        <ol className="mt-4 grid gap-2 text-xs leading-5 text-neutral-500 md:grid-cols-4">
          {[1, 2, 3, 4].map((step) => (
            <li key={step} className="rounded-xl border border-neutral-900 bg-black/25 p-3">
              <span className="mr-2 text-neutral-300">{step}.</span>
              {t(`integrationsHub.mcp.steps.${step}`)}
            </li>
          ))}
        </ol>
      </PanelCard>

      <PanelCard
        icon={<FileKey2 size={17} />}
        eyebrow={t("integrationsHub.mcp.securityEyebrow")}
        title={t("integrationsHub.mcp.securityTitle")}
        description={t("integrationsHub.mcp.securityDescription")}
      >
        <div className="grid gap-2 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3 text-xs leading-5 text-neutral-500"
            >
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-neutral-300" />
              {t(`integrationsHub.mcp.securityItems.${item}`)}
            </div>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}
