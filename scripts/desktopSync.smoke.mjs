import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CONFIG_FILE_NAME,
  createDesktopSyncService,
  normalizePairingCode,
  normalizePairingLaunchToken,
  normalizeWebsiteOrigin
} = require("../apps/desktop/electron/desktop-sync.cjs");
const {
  findDesktopConnectUrl,
  parseDesktopConnectUrl
} = require("../apps/desktop/electron/deep-link.cjs");

const launchToken = `cfl_${"a".repeat(64)}`;

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "contextforge-desktop-sync-")
);
const rawToken = "cfdt_0123456789abcdefghijklmnopqrstuvwxyz";
const requests = [];
const emittedStatuses = [];

function taskPackHash(taskPack) {
  return createHash("sha256").update(JSON.stringify({
    sourceTaskPackId: taskPack.sourceTaskPackId,
    title: taskPack.title,
    projectName: taskPack.projectName,
    rawTask: taskPack.rawTask,
    taskType: taskPack.taskType,
    targetTool: taskPack.targetTool,
    generatedPrompt: taskPack.generatedPrompt,
    sourceCreatedAt: taskPack.sourceCreatedAt
  })).digest("hex");
}

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) =>
    value.toString("utf8").replace(/^protected:/, "")
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function fetchImpl(url, options = {}) {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : null;
  requests.push({
    path: parsed.pathname,
    method: options.method ?? "GET",
    authorization: options.headers?.Authorization ?? null,
    body
  });

  if (parsed.pathname === "/api/desktop/pair") {
    if (body.launchToken) {
      assert.equal(body.launchToken, launchToken);
      assert.equal("pairingCode" in body, false);
    } else {
      assert.equal(body.pairingCode, "CF-A1B2C3");
    }
    assert.match(body.installationId, /^cf-/);
    return jsonResponse(
      {
        token: rawToken,
        user: {
          id: "user-1",
          email: "desktop@example.com",
          name: "Desktop User"
        },
        installation: {
          installationId: body.installationId,
          deviceName: body.deviceName,
          platform: body.platform,
          arch: body.arch,
          appVersion: body.appVersion,
          channel: body.channel,
          status: "active",
          lastSeenAt: new Date().toISOString()
        }
      },
      201
    );
  }

  assert.equal(options.headers?.Authorization, `Bearer ${rawToken}`);

  if (parsed.pathname === "/api/desktop/me") {
    return jsonResponse({
      user: {
        id: "user-1",
        email: "desktop@example.com",
        name: "Desktop User"
      },
      installation: {
        installationId: "cf-test",
        deviceName: "Workstation",
        platform: "win32",
        arch: "x64",
        appVersion: "0.6.7-alpha",
        channel: "alpha",
        status: "active",
        lastSeenAt: new Date().toISOString()
      },
      license: "alpha"
    });
  }

  if (parsed.pathname === "/api/desktop/heartbeat") {
    assert.equal(body.projectCount, 3);
    return jsonResponse({
      ok: true,
      updateAvailable: true,
      latestRelease: {
        version: "0.7.0-alpha",
        channel: "alpha",
        platform: "win32",
        arch: "x64",
        releaseUrl: "https://github.com/drag1web/contextforge/releases/tag/v0.7.0-alpha"
      }
    });
  }

  if (parsed.pathname === "/api/desktop/project-bridge/projects/sync") {
    assert.equal(body.projects.length, 3);
    assert.equal(body.projects[0].projectId, "local-1");
    assert.equal(body.projects[0].name, "ContextForge");
    assert.equal(JSON.stringify(body).includes("localPath"), false);
    assert.equal(JSON.stringify(body).includes("C:\\Users"), false);
    return jsonResponse({ ok: true, projectCount: body.projects.length });
  }

  if (parsed.pathname === "/api/desktop/update-check") {
    assert.equal(body.currentVersion, "0.6.7-alpha");
    return jsonResponse({
      updateAvailable: true,
      release: {
        version: "0.7.0-alpha",
        channel: "alpha",
        platform: "win32",
        arch: "x64",
        releaseUrl: "https://github.com/drag1web/contextforge/releases/tag/v0.7.0-alpha"
      }
    });
  }

  if (parsed.pathname === "/api/desktop/task-packs" && options.method === "POST") {
    assert.equal(body.sourceTaskPackId, "17");
    assert.equal(body.projectName, "ContextForge");
    assert.equal("localPath" in body, false);
    return jsonResponse({
      taskPack: {
        id: "11111111-1111-4111-8111-111111111111",
        originInstallationId: "cf-test",
        sourceTaskPackId: body.sourceTaskPackId,
        title: body.title,
        projectName: body.projectName,
        rawTask: body.rawTask,
        taskType: body.taskType,
        targetTool: body.targetTool,
        generatedPrompt: body.generatedPrompt,
        contentHash: taskPackHash(body),
        contentBytes: Buffer.byteLength(body.generatedPrompt, "utf8"),
        sourceCreatedAt: body.sourceCreatedAt,
        createdAt: "2026-07-24T08:00:00.000Z",
        updatedAt: "2026-07-24T08:00:00.000Z"
      }
    }, 201);
  }

  if (parsed.pathname === "/api/desktop/task-packs/inbox") {
    const taskPack = {
      sourceTaskPackId: "17",
      title: "Shared Task Pack",
      projectName: "ContextForge",
      rawTask: "Add the requested UI.",
      taskType: "ui",
      targetTool: "codex",
      generatedPrompt: "Implement and verify the requested UI.",
      sourceCreatedAt: "2026-07-24T08:00:00.000Z"
    };
    return jsonResponse({
      items: [{
        delivery: {
          id: "22222222-2222-4222-8222-222222222222",
          taskPackId: "11111111-1111-4111-8111-111111111111",
          targetInstallationId: "cf-test",
          status: "delivered",
          attemptCount: 2,
          lastError: null,
          createdAt: "2026-07-24T08:00:00.000Z",
          updatedAt: "2026-07-24T08:01:00.000Z",
          deliveredAt: "2026-07-24T08:01:00.000Z",
          resolvedAt: null
        },
        taskPack: {
          id: "11111111-1111-4111-8111-111111111111",
          originInstallationId: "cf-origin",
          ...taskPack,
          contentHash: taskPackHash(taskPack),
          contentBytes: Buffer.byteLength(taskPack.generatedPrompt, "utf8"),
          createdAt: "2026-07-24T08:00:00.000Z",
          updatedAt: "2026-07-24T08:01:00.000Z"
        }
      }]
    });
  }

  if (parsed.pathname === "/api/desktop/task-packs/22222222-2222-4222-8222-222222222222/ack") {
    assert.equal(body.status, "imported");
    assert.match(body.contentHash, /^[a-f0-9]{64}$/);
    return jsonResponse({
      delivery: {
        id: "22222222-2222-4222-8222-222222222222",
        taskPackId: "11111111-1111-4111-8111-111111111111",
        targetInstallationId: "cf-test",
        status: "imported",
        attemptCount: 2,
        lastError: null,
        createdAt: "2026-07-24T08:00:00.000Z",
        updatedAt: "2026-07-24T08:02:00.000Z",
        deliveredAt: "2026-07-24T08:01:00.000Z",
        resolvedAt: "2026-07-24T08:02:00.000Z"
      }
    });
  }

  if (parsed.pathname === "/api/desktop/unpair") {
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Not found", code: "NOT_FOUND" }, 404);
}

try {
  assert.equal(normalizePairingCode("a1b2c3"), "CF-A1B2C3");
  assert.equal(normalizePairingLaunchToken(launchToken), launchToken);
  assert.equal(
    normalizeWebsiteOrigin("https://contextforge.dev/devices"),
    "https://contextforge.dev"
  );
  assert.throws(
    () => normalizeWebsiteOrigin("http://contextforge.dev"),
    /WEBSITE_URL_UNSAFE/
  );
  assert.equal(
    normalizeWebsiteOrigin("http://127.0.0.1:5177", {
      allowInsecureLocal: true
    }),
    "http://127.0.0.1:5177"
  );
  const connectUrl = `contextforge://connect?token=${launchToken}&origin=${encodeURIComponent("http://127.0.0.1:5177")}`;
  assert.deepEqual(
    parseDesktopConnectUrl(connectUrl, {
      allowInsecureLocal: true,
      allowedOrigins: ["http://127.0.0.1:5177"]
    }),
    { launchToken, siteUrl: "http://127.0.0.1:5177" }
  );
  assert.equal(findDesktopConnectUrl(["electron", "main.cjs", connectUrl]), connectUrl);
  assert.throws(() => parseDesktopConnectUrl(connectUrl), /WEBSITE_URL_UNSAFE/);
  assert.throws(
    () => parseDesktopConnectUrl(
      `contextforge://connect?token=${launchToken}&origin=${encodeURIComponent("https://example.com")}`,
      { allowedOrigins: ["https://contextforge.dev"] }
    ),
    /not trusted/
  );
  assert.throws(
    () => parseDesktopConnectUrl("contextforge://remove?token=invalid&origin=https://contextforge.dev"),
    /not supported/
  );

  const service = createDesktopSyncService({
    appVersion: "0.6.7-alpha",
    platform: "win32",
    arch: "x64",
    isDev: true,
    defaultSiteUrl: "http://127.0.0.1:5177",
    userDataPath: temporaryDirectory,
    secureStorage,
    fetchImpl,
    getProjectCount: async () => 3,
    getProjectSnapshot: async () => [
      {
        projectId: "local-1",
        name: "ContextForge",
        stack: ["React", "TypeScript"],
        readinessScore: 86,
        gitBranch: null,
        gitDirty: null,
        hasTaskPack: false,
        status: "ready",
        lastScannedAt: "2026-07-26T08:00:00.000Z"
      },
      { projectId: "local-2", name: "Playground", stack: ["Node.js"], readinessScore: 64, status: "attention", hasTaskPack: false, lastScannedAt: null },
      { projectId: "local-3", name: "Docs", stack: [], readinessScore: null, status: "unknown", hasTaskPack: false, lastScannedAt: null }
    ],
    onStatusChanged: (status) => emittedStatuses.push(status)
  });

  const initialStatus = await service.initialize();
  assert.equal(initialStatus.connected, false);
  assert.equal(initialStatus.siteUrl, "http://127.0.0.1:5177");

  const pairedStatus = await service.pair({
    pairingCode: "CF-A1B2C3",
    siteUrl: "http://127.0.0.1:5177",
    deviceName: "Workstation",
    channel: "alpha"
  });
  assert.equal(pairedStatus.connected, true);
  assert.equal(pairedStatus.online, true);
  assert.equal(pairedStatus.user.email, "desktop@example.com");
  assert.equal(pairedStatus.projectCount, 3);
  assert.equal(pairedStatus.updateAvailable, true);
  assert.equal("token" in pairedStatus, false);

  const persisted = fs.readFileSync(
    path.join(temporaryDirectory, CONFIG_FILE_NAME),
    "utf8"
  );
  assert.equal(persisted.includes(rawToken), false);
  assert.equal(persisted.includes("protected:"), false);

  const accountStatus = await service.refreshAccount();
  assert.equal(accountStatus.license, "alpha");

  const updateStatus = await service.checkForUpdates();
  assert.equal(updateStatus.latestRelease.version, "0.7.0-alpha");

  const published = await service.publishTaskPack({
    sourceTaskPackId: "17",
    title: "Shared Task Pack",
    projectName: "ContextForge",
    rawTask: "Add the requested UI.",
    taskType: "ui",
    targetTool: "codex",
    generatedPrompt: "Implement and verify the requested UI.",
    sourceCreatedAt: "2026-07-24T08:00:00.000Z"
  });
  assert.equal(published.id, "11111111-1111-4111-8111-111111111111");

  const inbox = await service.getTaskPackInbox();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].delivery.status, "delivered");
  assert.equal(inbox[0].taskPack.generatedPrompt, "Implement and verify the requested UI.");
  assert.equal(inbox[0].taskPack.integrityValid, true);

  const acknowledged = await service.acknowledgeTaskPack(
    inbox[0].delivery.id,
    "imported",
    { contentHash: inbox[0].taskPack.contentHash }
  );
  assert.equal(acknowledged.status, "imported");

  const disconnectedStatus = await service.unpair();
  assert.equal(disconnectedStatus.connected, false);
  assert.equal(disconnectedStatus.user, null);

  const launchPairedStatus = await service.pair({
    launchToken,
    siteUrl: "http://127.0.0.1:5177",
    deviceName: "Workstation",
    channel: "alpha"
  });
  assert.equal(launchPairedStatus.connected, true);
  assert.equal(launchPairedStatus.online, true);
  await service.unpair();
  assert.ok(
    requests.some(
      (request) =>
        request.path === "/api/desktop/heartbeat" &&
        request.authorization === `Bearer ${rawToken}`
    )
  );
  assert.ok(
    requests.some(
      (request) =>
        request.path === "/api/desktop/project-bridge/projects/sync" &&
        request.authorization === `Bearer ${rawToken}`
    )
  );
  assert.ok(emittedStatuses.length >= 6);

  console.log("Desktop sync smoke test passed.");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
