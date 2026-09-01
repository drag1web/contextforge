const { Client } = require("@xhayper/discord-rpc");

const DEFAULT_ACTIVITY = "dashboard";
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

const ACTIVITY_COPY = Object.freeze({
  dashboard: {
    details: "Exploring ContextForge",
    state: "Preparing AI-ready projects"
  },
  projects: {
    details: "Reviewing projects",
    state: "Checking repository readiness"
  },
  project_details: {
    details: "Reviewing a project",
    state: "Inspecting readiness and local changes"
  },
  scanners: {
    details: "Analyzing repositories",
    state: "Reviewing scanner signals"
  },
  context_builder: {
    details: "Building project context",
    state: "Preparing AI-ready instructions"
  },
  task_pack_archive: {
    details: "Reviewing Task Packs",
    state: "Browsing prepared context"
  },
  task_pack_builder: {
    details: "Building a Task Pack",
    state: "Preparing grounded context"
  },
  analyzing_task_context: {
    details: "Analyzing task context",
    state: "Finding grounded evidence"
  },
  generating_task_pack: {
    details: "Generating a Task Pack",
    state: "Building grounded context"
  },
  running_validation: {
    details: "Running Validation Lab",
    state: "Validating grounded context"
  },
  context_review: {
    details: "Reviewing grounded context",
    state: "Selecting relevant evidence"
  },
  task_pack_result: {
    details: "Reviewing a Task Pack",
    state: "Inspecting generated context"
  },
  agents: {
    details: "Configuring agents",
    state: "Preparing coding workflows"
  },
  templates: {
    details: "Working with templates",
    state: "Preparing reusable context"
  },
  integrations: {
    details: "Reviewing integrations",
    state: "Connecting developer workflows"
  },
  github: {
    details: "Working with GitHub",
    state: "Preparing repository workflows"
  },
  reports: {
    details: "Reviewing reports",
    state: "Inspecting workspace health"
  },
  validation_lab: {
    details: "Validation Lab",
    state: "Reviewing grounded evidence"
  },
  account_sync: {
    details: "Managing desktop sync",
    state: "Reviewing connected workspace"
  },
  settings: {
    details: "Configuring ContextForge",
    state: "Adjusting workspace settings"
  }
});

function isKnownActivity(activity) {
  return typeof activity === "string" &&
    Object.prototype.hasOwnProperty.call(ACTIVITY_COPY, activity);
}

function createDiscordPresenceService({ clientId }) {
  if (typeof clientId !== "string" || !/^\d{17,20}$/.test(clientId)) {
    throw new Error("DISCORD_PRESENCE_INVALID_CLIENT_ID");
  }

  let client = null;
  let connectInFlight = false;
  let reconnectTimer = null;
  let retryIndex = 0;
  let stopped = true;
  let desiredActivity = DEFAULT_ACTIVITY;
  let lastAppliedActivity = null;

  const sessionStartedAt = new Date();

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  async function retireClient(target, { clearActivity = false } = {}) {
    if (!target) return;

    try {
      target.removeAllListeners?.();
    } catch {
      // Listener cleanup must never affect the desktop application.
    }

    if (clearActivity && target.isConnected && target.user) {
      try {
        await target.user.clearActivity();
      } catch {
        // Discord may already be closed. Presence shutdown is best-effort.
      }
    }

    try {
      await target.destroy();
    } catch {
      // Discord IPC teardown is intentionally fail-silent.
    }
  }

  function buildActivity(activity) {
    const copy = ACTIVITY_COPY[activity] ?? ACTIVITY_COPY[DEFAULT_ACTIVITY];

    return {
      details: copy.details,
      state: copy.state,
      startTimestamp: sessionStartedAt
    };
  }

  async function applyDesiredActivity(target = client) {
    if (
      stopped ||
      !target ||
      target !== client ||
      !target.isConnected ||
      !target.user ||
      lastAppliedActivity === desiredActivity
    ) {
      return;
    }

    const activityToApply = desiredActivity;

    try {
      await target.user.setActivity(buildActivity(activityToApply));

      if (!stopped && target === client) {
        lastAppliedActivity = activityToApply;
      }
    } catch {
      if (target === client) {
        lastAppliedActivity = null;
      }
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer || connectInFlight || client) {
      return;
    }

    const delay =
      RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
    retryIndex += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);

    reconnectTimer.unref?.();
  }

  async function connect() {
    if (stopped || connectInFlight || client) {
      return;
    }

    connectInFlight = true;
    const nextClient = new Client({ clientId });
    client = nextClient;

    nextClient.on("disconnected", () => {
      if (client !== nextClient) {
        return;
      }

      client = null;
      connectInFlight = false;
      lastAppliedActivity = null;

      try {
        nextClient.removeAllListeners?.();
      } catch {
        // Ignore listener cleanup errors.
      }

      scheduleReconnect();
    });

    try {
      await nextClient.login();

      if (stopped || client !== nextClient) {
        await retireClient(nextClient);
        return;
      }

      connectInFlight = false;
      retryIndex = 0;
      lastAppliedActivity = null;
      await applyDesiredActivity(nextClient);
    } catch {
      if (client === nextClient) {
        client = null;
      }

      connectInFlight = false;
      lastAppliedActivity = null;

      await retireClient(nextClient);
      scheduleReconnect();
    }
  }

  function start() {
    if (!stopped) {
      return;
    }

    stopped = false;
    retryIndex = 0;
    clearReconnectTimer();
    void connect();
  }

  function setActivity(activity) {
    if (!isKnownActivity(activity)) {
      return false;
    }

    desiredActivity = activity;
    void applyDesiredActivity();
    return true;
  }

  function stop() {
    if (stopped) {
      return;
    }

    stopped = true;
    clearReconnectTimer();
    connectInFlight = false;
    lastAppliedActivity = null;

    const currentClient = client;
    client = null;

    if (currentClient) {
      void retireClient(currentClient, { clearActivity: true });
    }
  }

  function getStatus() {
    return {
      connected: Boolean(client?.isConnected),
      activity: desiredActivity
    };
  }

  return {
    start,
    stop,
    setActivity,
    getStatus
  };
}

module.exports = {
  ACTIVITY_COPY,
  createDiscordPresenceService,
  isKnownActivity
};
