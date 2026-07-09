import crypto from "node:crypto";

import { config } from "../config/index.js";
import { storage } from "../storage/index.js";
import { fetchGitHubUser, GitHubApiError } from "./githubApiClient.js";
import type {
  GitHubAuthPollResult,
  GitHubDeviceAuthStartResult,
  GitHubIntegrationStatus,
  GitHubUserProfile
} from "./githubTypes.js";

const GITHUB_OAUTH_BASE_URL = "https://github.com";
const DEFAULT_DEVICE_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_SECONDS = 5;

const githubSettingKeys = {
  accessToken: "github_access_token",
  userLogin: "github_user_login",
  userAvatarUrl: "github_user_avatar_url",
  userHtmlUrl: "github_user_html_url",
  tokenScope: "github_token_scope",
  connectedAt: "github_connected_at",
  lastCheckedAt: "github_last_checked_at"
} as const;

interface DeviceSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAtMs: number;
  interval: number;
  nextPollAtMs: number;
}

interface DeviceCodeResponse {
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
  expires_in?: unknown;
  interval?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface AccessTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const deviceSessions = new Map<string, DeviceSession>();

function nowIso() {
  return new Date().toISOString();
}

function isConfigured() {
  return Boolean(config.githubOAuthClientId.trim());
}

function parseScopes(rawScopes: string | null) {
  if (!rawScopes) {
    return [];
  }

  return rawScopes
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function safeGitHubError(data: DeviceCodeResponse | AccessTokenResponse, fallback: string) {
  if (typeof data.error_description === "string" && data.error_description.trim()) {
    return data.error_description.trim();
  }

  if (typeof data.error === "string" && data.error.trim()) {
    return data.error.trim();
  }

  return fallback;
}

async function getSavedAccessToken() {
  return storage.getSettingValue<string | null>(githubSettingKeys.accessToken, null);
}

export async function getGitHubAccessTokenForInternalUse() {
  return getSavedAccessToken();
}

async function getSavedStatus(message?: string): Promise<GitHubIntegrationStatus> {
  const token = await getSavedAccessToken();
  const login = await storage.getSettingValue<string | null>(githubSettingKeys.userLogin, null);
  const avatarUrl = await storage.getSettingValue<string | null>(githubSettingKeys.userAvatarUrl, null);
  const htmlUrl = await storage.getSettingValue<string | null>(githubSettingKeys.userHtmlUrl, null);
  const rawScopes = await storage.getSettingValue<string | null>(githubSettingKeys.tokenScope, null);
  const connectedAt = await storage.getSettingValue<string | null>(githubSettingKeys.connectedAt, null);
  const lastCheckedAt = await storage.getSettingValue<string | null>(githubSettingKeys.lastCheckedAt, null);

  return {
    configured: isConfigured(),
    connected: Boolean(token),
    login,
    avatarUrl,
    htmlUrl,
    scopes: parseScopes(rawScopes),
    connectedAt,
    lastCheckedAt,
    message:
      message ??
      (token
        ? "GitHub account is connected."
        : isConfigured()
          ? "GitHub OAuth is configured, but no account is connected."
          : "GitHub OAuth client id is not configured.")
  };
}

async function saveUserProfile(profile: GitHubUserProfile, scope: string | null, connectedAt?: string) {
  const checkedAt = nowIso();

  await storage.setSettingValue(githubSettingKeys.userLogin, profile.login);
  await storage.setSettingValue(githubSettingKeys.userAvatarUrl, profile.avatarUrl);
  await storage.setSettingValue(githubSettingKeys.userHtmlUrl, profile.htmlUrl);
  await storage.setSettingValue(githubSettingKeys.tokenScope, scope ?? null);
  await storage.setSettingValue(githubSettingKeys.lastCheckedAt, checkedAt);

  if (connectedAt) {
    await storage.setSettingValue(githubSettingKeys.connectedAt, connectedAt);
  }
}

export async function clearGitHubConnection() {
  await Promise.all([
    storage.setSettingValue(githubSettingKeys.accessToken, null),
    storage.setSettingValue(githubSettingKeys.userLogin, null),
    storage.setSettingValue(githubSettingKeys.userAvatarUrl, null),
    storage.setSettingValue(githubSettingKeys.userHtmlUrl, null),
    storage.setSettingValue(githubSettingKeys.tokenScope, null),
    storage.setSettingValue(githubSettingKeys.connectedAt, null),
    storage.setSettingValue(githubSettingKeys.lastCheckedAt, null)
  ]);
}

export async function getGitHubIntegrationStatus(): Promise<GitHubIntegrationStatus> {
  if (!isConfigured()) {
    return getSavedStatus("GitHub OAuth client id is not configured yet.");
  }

  const token = await getSavedAccessToken();

  if (!token) {
    return getSavedStatus("GitHub OAuth is configured. Connect an account when you need GitHub workflows.");
  }

  try {
    const profile = await fetchGitHubUser(token);
    const rawScopes = await storage.getSettingValue<string | null>(githubSettingKeys.tokenScope, null);
    await saveUserProfile(profile, rawScopes);

    return getSavedStatus("GitHub account check passed.");
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) {
      await clearGitHubConnection();
      return getSavedStatus("Saved GitHub token was rejected and has been cleared.");
    }

    return getSavedStatus("Saved GitHub token exists, but GitHub could not be reached right now.");
  }
}

export async function startGitHubDeviceAuth(): Promise<GitHubDeviceAuthStartResult> {
  if (!isConfigured()) {
    throw new Error("GitHub OAuth client id is not configured. Set GITHUB_OAUTH_CLIENT_ID in .env.");
  }

  const body = new URLSearchParams({
    client_id: config.githubOAuthClientId,
    scope: config.githubOAuthScopes
  });

  const response = await fetch(`${GITHUB_OAUTH_BASE_URL}/login/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ContextForge"
    },
    body
  });

  const data = (await response.json()) as DeviceCodeResponse;

  if (!response.ok || data.error) {
    throw new Error(safeGitHubError(data, "Failed to start GitHub device authorization."));
  }

  if (
    typeof data.device_code !== "string" ||
    typeof data.user_code !== "string" ||
    typeof data.verification_uri !== "string" ||
    typeof data.expires_in !== "number"
  ) {
    throw new Error("GitHub device authorization response is incomplete.");
  }

  const interval =
    typeof data.interval === "number" && data.interval > 0
      ? data.interval
      : DEFAULT_DEVICE_INTERVAL_SECONDS;
  const sessionId = crypto.randomUUID();
  const expiresAtMs = Date.now() + data.expires_in * 1000;

  deviceSessions.set(sessionId, {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAtMs,
    interval,
    nextPollAtMs: Date.now() + interval * 1000
  });

  return {
    sessionId,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export async function pollGitHubDeviceAuth(sessionId: string): Promise<GitHubAuthPollResult> {
  if (!isConfigured()) {
    return {
      state: "failed",
      code: "github_not_configured",
      message: "GitHub OAuth client id is not configured."
    };
  }

  const session = deviceSessions.get(sessionId);

  if (!session) {
    return {
      state: "expired",
      code: "session_missing",
      message: "GitHub pairing session was not found. Start pairing again."
    };
  }

  if (Date.now() >= session.expiresAtMs) {
    deviceSessions.delete(sessionId);
    return {
      state: "expired",
      code: "expired_token",
      message: "GitHub pairing code expired. Start pairing again."
    };
  }

  if (Date.now() < session.nextPollAtMs) {
    return {
      state: "pending",
      interval: Math.max(1, Math.ceil((session.nextPollAtMs - Date.now()) / 1000)),
      message: "Waiting before the next GitHub token check."
    };
  }

  session.nextPollAtMs = Date.now() + session.interval * 1000;

  const body = new URLSearchParams({
    client_id: config.githubOAuthClientId,
    device_code: session.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code"
  });

  const response = await fetch(`${GITHUB_OAUTH_BASE_URL}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ContextForge"
    },
    body
  });

  const data = (await response.json()) as AccessTokenResponse;

  if (typeof data.error === "string") {
    if (data.error === "authorization_pending") {
      return {
        state: "pending",
        interval: session.interval,
        message: "Waiting for GitHub authorization in the browser."
      };
    }

    if (data.error === "slow_down") {
      session.interval += SLOW_DOWN_INCREMENT_SECONDS;
      session.nextPollAtMs = Date.now() + session.interval * 1000;

      return {
        state: "slow_down",
        interval: session.interval,
        message: "GitHub asked ContextForge to slow down polling."
      };
    }

    if (
      data.error === "expired_token" ||
      data.error === "token_expired" ||
      data.error === "incorrect_device_code"
    ) {
      deviceSessions.delete(sessionId);
      return {
        state: "expired",
        code: data.error,
        message: safeGitHubError(data, "GitHub pairing code expired. Start pairing again.")
      };
    }

    if (data.error === "access_denied") {
      deviceSessions.delete(sessionId);
      return {
        state: "denied",
        code: data.error,
        message: "GitHub authorization was denied."
      };
    }

    if (data.error === "device_flow_disabled") {
      deviceSessions.delete(sessionId);
      return {
        state: "failed",
        code: data.error,
        message: "Device flow is disabled for this GitHub OAuth app."
      };
    }

    return {
      state: "failed",
      code: data.error,
      message: safeGitHubError(data, "GitHub authorization failed.")
    };
  }

  if (!response.ok || typeof data.access_token !== "string" || !data.access_token.trim()) {
    return {
      state: "failed",
      message: "GitHub did not return an access token."
    };
  }

  const connectedAt = nowIso();
  const scope = typeof data.scope === "string" ? data.scope : null;
  const profile = await fetchGitHubUser(data.access_token);

  await storage.setSettingValue(githubSettingKeys.accessToken, data.access_token);
  await saveUserProfile(profile, scope, connectedAt);
  deviceSessions.delete(sessionId);

  return {
    state: "connected",
    status: await getSavedStatus("GitHub account connected."),
    message: "GitHub account connected."
  };
}
