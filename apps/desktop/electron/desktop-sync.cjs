const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_WEBSITE_ORIGIN = "https://contextforge.dev";
const CONFIG_FILE_NAME = "desktop-sync.json";
const REQUEST_TIMEOUT_MS = 12_000;

function normalizeWebsiteOrigin(rawValue, { allowInsecureLocal = false } = {}) {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    throw new Error("WEBSITE_URL_REQUIRED");
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("WEBSITE_URL_INVALID");
  }

  const isLocalHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  const isAllowedProtocol =
    url.protocol === "https:" ||
    (allowInsecureLocal && isLocalHost && url.protocol === "http:");

  if (!isAllowedProtocol || url.username || url.password) {
    throw new Error("WEBSITE_URL_UNSAFE");
  }

  return url.origin;
}

function normalizePairingCode(rawValue) {
  const compact = String(rawValue ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const normalized = compact.startsWith("CF-")
    ? compact
    : compact.length === 6
      ? `CF-${compact}`
      : compact;

  if (!/^CF-[A-F0-9]{6}$/.test(normalized)) {
    throw new Error("PAIRING_CODE_INVALID");
  }

  return normalized;
}

function normalizeChannel(rawValue) {
  const value = String(rawValue ?? "alpha").trim().toLowerCase();
  return ["alpha", "beta", "stable"].includes(value) ? value : "alpha";
}

function normalizeDeviceName(rawValue) {
  const value = String(rawValue ?? "").trim().replace(/\s+/g, " ");

  if (!value) {
    return `ContextForge on ${os.hostname()}`.slice(0, 90);
  }

  return value.slice(0, 90);
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  return {
    id: typeof user.id === "string" ? user.id : null,
    email: typeof user.email === "string" ? user.email : null,
    name:
      typeof user.name === "string"
        ? user.name
        : typeof user.displayName === "string"
          ? user.displayName
          : null,
    avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : null
  };
}

function sanitizeInstallation(installation) {
  if (!installation || typeof installation !== "object") {
    return null;
  }

  return {
    installationId:
      typeof installation.installationId === "string"
        ? installation.installationId
        : null,
    deviceName:
      typeof installation.deviceName === "string"
        ? installation.deviceName
        : null,
    platform:
      typeof installation.platform === "string" ? installation.platform : null,
    arch: typeof installation.arch === "string" ? installation.arch : null,
    appVersion:
      typeof installation.appVersion === "string"
        ? installation.appVersion
        : null,
    channel:
      typeof installation.channel === "string"
        ? normalizeChannel(installation.channel)
        : null,
    status:
      typeof installation.status === "string" ? installation.status : null,
    lastSeenAt: toIsoString(installation.lastSeenAt),
    createdAt: toIsoString(installation.createdAt),
    updatedAt: toIsoString(installation.updatedAt)
  };
}

function sanitizeRelease(release) {
  if (!release || typeof release !== "object") {
    return null;
  }

  const readString = (key) =>
    typeof release[key] === "string" ? release[key] : null;

  return {
    id: readString("id"),
    version: readString("version"),
    channel: readString("channel"),
    platform: readString("platform"),
    arch: readString("arch"),
    fileName: readString("fileName"),
    downloadUrl: readString("downloadUrl"),
    releaseUrl: readString("releaseUrl"),
    notes: readString("notes"),
    publishedAt: toIsoString(release.publishedAt)
  };
}

function readTaskPackString(value, field, maxLength, { optional = false } = {}) {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

  if ((!optional && !normalized) || normalized.length > maxLength) {
    throw Object.assign(new Error(`Invalid Task Pack ${field}.`), {
      code: "TASK_PACK_INVALID"
    });
  }

  return normalized;
}

function sanitizeTaskPackUpload(input) {
  return {
    sourceTaskPackId: readTaskPackString(input?.sourceTaskPackId, "id", 120),
    title: readTaskPackString(input?.title, "title", 180),
    projectName: readTaskPackString(input?.projectName, "project name", 180, { optional: true }),
    rawTask: readTaskPackString(input?.rawTask, "task", 24_000),
    taskType: readTaskPackString(input?.taskType, "type", 80),
    targetTool: readTaskPackString(input?.targetTool, "target", 80),
    generatedPrompt: readTaskPackString(input?.generatedPrompt, "prompt", 160_000),
    sourceCreatedAt: toIsoString(input?.sourceCreatedAt)
  };
}

function computeTaskPackContentHash(taskPack) {
  const canonical = {
    sourceTaskPackId: taskPack.sourceTaskPackId,
    title: taskPack.title,
    projectName: taskPack.projectName,
    rawTask: taskPack.rawTask,
    taskType: taskPack.taskType,
    targetTool: taskPack.targetTool,
    generatedPrompt: taskPack.generatedPrompt,
    sourceCreatedAt: taskPack.sourceCreatedAt
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function sanitizeCloudTaskPack(taskPack) {
  if (!taskPack || typeof taskPack !== "object") return null;

  const sanitized = {
    id: readTaskPackString(taskPack.id, "cloud id", 120),
    originInstallationId: readTaskPackString(taskPack.originInstallationId, "origin", 120),
    sourceTaskPackId: readTaskPackString(taskPack.sourceTaskPackId, "source id", 120),
    title: readTaskPackString(taskPack.title, "title", 180),
    projectName: readTaskPackString(taskPack.projectName, "project name", 180, { optional: true }),
    rawTask: readTaskPackString(taskPack.rawTask, "task", 24_000),
    taskType: readTaskPackString(taskPack.taskType, "type", 80),
    targetTool: readTaskPackString(taskPack.targetTool, "target", 80),
    generatedPrompt: readTaskPackString(taskPack.generatedPrompt, "prompt", 160_000),
    contentHash: readTaskPackString(taskPack.contentHash, "content hash", 64),
    contentBytes: Number.isFinite(Number(taskPack.contentBytes)) ? Number(taskPack.contentBytes) : 0,
    sourceCreatedAt: toIsoString(taskPack.sourceCreatedAt),
    createdAt: toIsoString(taskPack.createdAt),
    updatedAt: toIsoString(taskPack.updatedAt)
  };
  const actualHash = computeTaskPackContentHash(sanitized);
  const integrityValid = /^[a-f0-9]{64}$/i.test(sanitized.contentHash) &&
    crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(sanitized.contentHash, "hex"));

  return integrityValid
    ? { ...sanitized, integrityValid: true }
    : { ...sanitized, rawTask: "", generatedPrompt: "", integrityValid: false };
}

function sanitizeTaskPackDelivery(delivery) {
  if (!delivery || typeof delivery !== "object") return null;
  const status = ["pending", "delivered", "imported", "dismissed", "failed", "cancelled", "expired"].includes(delivery.status)
    ? delivery.status
    : "delivered";

  return {
    id: readTaskPackString(delivery.id, "delivery id", 120),
    taskPackId: readTaskPackString(delivery.taskPackId, "delivery Task Pack id", 120),
    targetInstallationId: readTaskPackString(delivery.targetInstallationId, "delivery target", 120),
    status,
    attemptCount: Number.isFinite(Number(delivery.attemptCount)) ? Number(delivery.attemptCount) : 1,
    lastError: typeof delivery.lastError === "string" ? delivery.lastError.slice(0, 500) : null,
    createdAt: toIsoString(delivery.createdAt),
    updatedAt: toIsoString(delivery.updatedAt),
    deliveredAt: toIsoString(delivery.deliveredAt),
    resolvedAt: toIsoString(delivery.resolvedAt),
    expiresAt: toIsoString(delivery.expiresAt),
    cancelledAt: toIsoString(delivery.cancelledAt),
    integrityVerifiedAt: toIsoString(delivery.integrityVerifiedAt)
  };
}

function createApiError(status, payload) {
  const error = new Error(
    typeof payload?.error === "string"
      ? payload.error
      : `ContextForge website returned HTTP ${status}.`
  );
  error.code =
    typeof payload?.code === "string" ? payload.code : "WEBSITE_REQUEST_FAILED";
  error.status = status;
  return error;
}

function createDesktopSyncService({
  appVersion,
  platform = process.platform,
  arch = process.arch,
  isDev = false,
  defaultSiteUrl = DEFAULT_WEBSITE_ORIGIN,
  userDataPath,
  secureStorage,
  fetchImpl = globalThis.fetch,
  getProjectCount = async () => null,
  onStatusChanged = () => {}
}) {
  if (!userDataPath || !secureStorage || typeof fetchImpl !== "function") {
    throw new Error("Desktop sync service is missing required dependencies.");
  }

  const configPath = path.join(userDataPath, CONFIG_FILE_NAME);
  let config = null;
  let runtime = {
    state: "disconnected",
    online: false,
    lastCheckedAt: null,
    projectCount: null,
    updateAvailable: false,
    latestRelease: null,
    errorCode: null,
    errorMessage: null
  };

  function readConfigFile() {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  function defaultConfig() {
    let siteUrl = DEFAULT_WEBSITE_ORIGIN;

    try {
      siteUrl = normalizeWebsiteOrigin(defaultSiteUrl, {
        allowInsecureLocal: isDev
      });
    } catch {
      // Keep the production-safe default when an environment override is invalid.
    }

    return {
      version: 1,
      installationId: `cf-${crypto.randomUUID()}`,
      siteUrl,
      deviceName: normalizeDeviceName(),
      channel: "alpha",
      encryptedToken: null,
      user: null,
      installation: null,
      license: null,
      pairedAt: null
    };
  }

  function normalizeConfig(rawConfig) {
    const fallback = defaultConfig();
    let siteUrl = fallback.siteUrl;

    try {
      siteUrl = normalizeWebsiteOrigin(rawConfig?.siteUrl ?? fallback.siteUrl, {
        allowInsecureLocal: isDev
      });
    } catch {
      // Invalid persisted URLs never become request targets.
    }

    const installationId =
      typeof rawConfig?.installationId === "string" &&
      /^[a-zA-Z0-9._:-]{3,120}$/.test(rawConfig.installationId)
        ? rawConfig.installationId
        : fallback.installationId;

    return {
      ...fallback,
      installationId,
      siteUrl,
      deviceName: normalizeDeviceName(rawConfig?.deviceName),
      channel: normalizeChannel(rawConfig?.channel),
      encryptedToken:
        typeof rawConfig?.encryptedToken === "string"
          ? rawConfig.encryptedToken
          : null,
      user: sanitizeUser(rawConfig?.user),
      installation: sanitizeInstallation(rawConfig?.installation),
      license:
        typeof rawConfig?.license === "string" ? rawConfig.license : null,
      pairedAt: toIsoString(rawConfig?.pairedAt)
    };
  }

  function writeConfig() {
    fs.mkdirSync(userDataPath, { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(temporaryPath, configPath);
  }

  function isSecureStorageAvailable() {
    try {
      return Boolean(secureStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function hasToken() {
    return Boolean(config?.encryptedToken);
  }

  function getToken() {
    if (!hasToken()) {
      return null;
    }

    if (!isSecureStorageAvailable()) {
      throw Object.assign(new Error("Secure token storage is unavailable."), {
        code: "SECURE_STORAGE_UNAVAILABLE"
      });
    }

    try {
      return secureStorage.decryptString(
        Buffer.from(config.encryptedToken, "base64")
      );
    } catch {
      throw Object.assign(new Error("The stored device token cannot be read."), {
        code: "DEVICE_TOKEN_UNREADABLE"
      });
    }
  }

  function publicStatus() {
    const configured = hasToken();
    const installation = config?.installation ?? null;

    return {
      configured,
      connected: configured,
      online: configured && runtime.online,
      state: configured ? runtime.state : "disconnected",
      secureStorageAvailable: isSecureStorageAvailable(),
      siteUrl: config?.siteUrl ?? DEFAULT_WEBSITE_ORIGIN,
      installationId: config?.installationId ?? null,
      deviceName:
        installation?.deviceName ?? config?.deviceName ?? normalizeDeviceName(),
      channel: installation?.channel ?? config?.channel ?? "alpha",
      platform,
      arch,
      appVersion,
      user: config?.user ?? null,
      license: config?.license ?? null,
      lastSeenAt: installation?.lastSeenAt ?? null,
      pairedAt: config?.pairedAt ?? null,
      lastCheckedAt: runtime.lastCheckedAt,
      projectCount: runtime.projectCount,
      updateAvailable: runtime.updateAvailable,
      latestRelease: runtime.latestRelease,
      errorCode: runtime.errorCode,
      errorMessage: runtime.errorMessage
    };
  }

  function emitStatus() {
    const status = publicStatus();

    try {
      onStatusChanged(status);
    } catch {
      // Renderer notifications must never break the sync client.
    }

    return status;
  }

  function setRuntime(patch) {
    runtime = { ...runtime, ...patch };
    return emitStatus();
  }

  async function request(endpoint, { method = "GET", body, token } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(`${config.siteUrl}/api${endpoint}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: controller.signal
      });

      const raw = await response.text();
      let payload = {};

      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          throw createApiError(response.status, {
            code: "WEBSITE_RESPONSE_INVALID",
            error: "ContextForge website returned an invalid response."
          });
        }
      }

      if (!response.ok) {
        throw createApiError(response.status, payload);
      }

      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(
          new Error("ContextForge website did not respond in time."),
          { code: "WEBSITE_TIMEOUT" }
        );
      }

      if (error?.code) {
        throw error;
      }

      throw Object.assign(
        new Error("Could not reach the ContextForge website."),
        { code: "WEBSITE_OFFLINE" }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  function recordFailure(error) {
    return setRuntime({
      state: hasToken() ? "offline" : "disconnected",
      online: false,
      errorCode:
        typeof error?.code === "string" ? error.code : "SYNC_FAILED",
      errorMessage:
        error instanceof Error ? error.message : "Desktop sync failed."
    });
  }

  async function initialize() {
    config = normalizeConfig(readConfigFile());
    writeConfig();

    runtime = {
      ...runtime,
      state: hasToken() ? "offline" : "disconnected"
    };
    emitStatus();

    if (hasToken()) {
      try {
        await refreshAccount();
      } catch {
        // Offline startup is valid for a local-first application.
      }
    }

    return publicStatus();
  }

  async function refreshAccount() {
    const token = getToken();

    if (!token) {
      return publicStatus();
    }

    setRuntime({
      state: "connecting",
      errorCode: null,
      errorMessage: null
    });

    try {
      const payload = await request("/desktop/me", { token });
      config.user = sanitizeUser(payload.user);
      config.installation = sanitizeInstallation(payload.installation);
      config.license =
        typeof payload.license === "string" ? payload.license : null;
      writeConfig();

      return setRuntime({
        state: "online",
        online: true,
        lastCheckedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null
      });
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }

  async function pair(input = {}) {
    if (hasToken()) {
      throw Object.assign(new Error("This installation is already connected."), {
        code: "INSTALLATION_ALREADY_PAIRED"
      });
    }

    if (!isSecureStorageAvailable()) {
      throw Object.assign(new Error("Secure token storage is unavailable."), {
        code: "SECURE_STORAGE_UNAVAILABLE"
      });
    }

    const siteUrl = normalizeWebsiteOrigin(
      input.siteUrl ?? config.siteUrl ?? defaultSiteUrl,
      { allowInsecureLocal: isDev }
    );
    const pairingCode = normalizePairingCode(input.pairingCode);
    const deviceName = normalizeDeviceName(input.deviceName);
    const channel = normalizeChannel(input.channel);

    config.siteUrl = siteUrl;
    config.deviceName = deviceName;
    config.channel = channel;
    writeConfig();

    setRuntime({
      state: "connecting",
      online: false,
      errorCode: null,
      errorMessage: null
    });

    try {
      const payload = await request("/desktop/pair", {
        method: "POST",
        body: {
          pairingCode,
          installationId: config.installationId,
          deviceName,
          channel,
          platform,
          arch,
          appVersion
        }
      });

      if (typeof payload.token !== "string" || payload.token.length < 20) {
        throw Object.assign(
          new Error("ContextForge website did not return a device token."),
          { code: "DEVICE_TOKEN_MISSING" }
        );
      }

      config.encryptedToken = secureStorage
        .encryptString(payload.token)
        .toString("base64");
      config.user = sanitizeUser(payload.user);
      config.installation = sanitizeInstallation(payload.installation);
      config.license = null;
      config.pairedAt = new Date().toISOString();
      writeConfig();

      setRuntime({
        state: "online",
        online: true,
        lastCheckedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null
      });

      try {
        return await heartbeat();
      } catch {
        return publicStatus();
      }
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }

  async function heartbeat() {
    const token = getToken();

    if (!token) {
      return publicStatus();
    }

    setRuntime({
      state: "connecting",
      errorCode: null,
      errorMessage: null
    });

    let projectCount = null;

    try {
      const count = await getProjectCount();
      projectCount = Number.isInteger(count) && count >= 0 ? count : null;
    } catch {
      // Project telemetry is optional and contains only a count.
    }

    try {
      const payload = await request("/desktop/heartbeat", {
        method: "POST",
        token,
        body: {
          appVersion,
          channel: config.channel,
          platform,
          arch,
          projectCount
        }
      });

      if (config.installation) {
        config.installation = {
          ...config.installation,
          appVersion,
          channel: config.channel,
          platform,
          arch,
          status: "active",
          lastSeenAt: new Date().toISOString()
        };
        writeConfig();
      }

      return setRuntime({
        state: "online",
        online: true,
        lastCheckedAt: new Date().toISOString(),
        projectCount,
        updateAvailable: Boolean(payload.updateAvailable),
        latestRelease: sanitizeRelease(payload.latestRelease),
        errorCode: null,
        errorMessage: null
      });
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }

  async function checkForUpdates() {
    let token = null;

    try {
      token = getToken();
    } catch {
      // The update endpoint also supports unauthenticated checks.
    }

    setRuntime({
      state: hasToken() ? "connecting" : "disconnected",
      errorCode: null,
      errorMessage: null
    });

    try {
      const payload = await request("/desktop/update-check", {
        method: "POST",
        token,
        body: {
          currentVersion: appVersion,
          channel: config.channel,
          platform,
          arch,
          installationId: config.installationId
        }
      });
      const release = sanitizeRelease(payload.release);

      return setRuntime({
        state: hasToken() ? "online" : "disconnected",
        online: hasToken() ? runtime.online : false,
        lastCheckedAt: new Date().toISOString(),
        updateAvailable: Boolean(payload.updateAvailable),
        latestRelease: release,
        errorCode: null,
        errorMessage: null
      });
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  }

  function requireDeviceToken() {
    const token = getToken();

    if (!token) {
      throw Object.assign(new Error("Connect this installation to the ContextForge website first."), {
        code: "DEVICE_NOT_CONNECTED"
      });
    }

    return token;
  }

  async function publishTaskPack(input) {
    const token = requireDeviceToken();
    const taskPack = sanitizeTaskPackUpload(input);
    const payload = await request("/desktop/task-packs", {
      method: "POST",
      token,
      body: taskPack
    });

    return sanitizeCloudTaskPack(payload.taskPack);
  }

  async function getTaskPackInbox() {
    const token = requireDeviceToken();
    const payload = await request("/desktop/task-packs/inbox", { token });
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items.map((item) => ({
      delivery: sanitizeTaskPackDelivery(item?.delivery),
      taskPack: sanitizeCloudTaskPack(item?.taskPack)
    })).filter((item) => item.delivery && item.taskPack);
  }

  async function acknowledgeTaskPack(deliveryId, status, options = {}) {
    const token = requireDeviceToken();
    const normalizedDeliveryId = readTaskPackString(deliveryId, "delivery id", 120);

    if (!["imported", "dismissed", "failed"].includes(status)) {
      throw Object.assign(new Error("Invalid Task Pack acknowledgement."), {
        code: "TASK_PACK_ACK_INVALID"
      });
    }

    const payload = await request(
      `/desktop/task-packs/${encodeURIComponent(normalizedDeliveryId)}/ack`,
      {
        method: "POST",
        token,
        body: {
          status,
          error: typeof options.error === "string" ? options.error.slice(0, 500) : undefined,
          contentHash: typeof options.contentHash === "string" ? options.contentHash : undefined
        }
      }
    );

    return sanitizeTaskPackDelivery(payload.delivery);
  }

  async function unpair() {
    let token = null;

    try {
      token = getToken();
    } catch {
      // Local disconnect must remain possible when secure storage is unavailable.
    }

    if (token) {
      try {
        await request("/desktop/unpair", {
          method: "POST",
          token
        });
      } catch (error) {
        if (error?.status !== 401) {
          recordFailure(error);
          throw error;
        }
      }
    }

    config.encryptedToken = null;
    config.user = null;
    config.installation = null;
    config.license = null;
    config.pairedAt = null;
    writeConfig();

    runtime = {
      state: "disconnected",
      online: false,
      lastCheckedAt: new Date().toISOString(),
      projectCount: null,
      updateAvailable: false,
      latestRelease: null,
      errorCode: null,
      errorMessage: null
    };

    return emitStatus();
  }

  function isAllowedWebsiteUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);

      return url.protocol === "https:" && url.origin === config.siteUrl
        ? true
        : isDev &&
            url.protocol === "http:" &&
            url.origin === config.siteUrl &&
            ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  }

  return {
    initialize,
    getStatus: () => publicStatus(),
    refreshAccount,
    pair,
    heartbeat,
    checkForUpdates,
    publishTaskPack,
    getTaskPackInbox,
    acknowledgeTaskPack,
    unpair,
    isAllowedWebsiteUrl
  };
}

module.exports = {
  CONFIG_FILE_NAME,
  DEFAULT_WEBSITE_ORIGIN,
  createDesktopSyncService,
  normalizePairingCode,
  normalizeWebsiteOrigin
};
