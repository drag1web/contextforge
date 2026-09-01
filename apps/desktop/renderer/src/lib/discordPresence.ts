export type DiscordPresenceActivity =
  | "dashboard"
  | "projects"
  | "project_details"
  | "scanners"
  | "context_builder"
  | "task_pack_archive"
  | "task_pack_builder"
  | "context_review"
  | "task_pack_result"
  | "agents"
  | "templates"
  | "integrations"
  | "github"
  | "reports"
  | "validation_lab"
  | "account_sync"
  | "settings";

type DiscordPresenceBridge = {
  setActivity: (activity: DiscordPresenceActivity) => Promise<boolean>;
};

type ContextForgeDesktopBridge = {
  discordPresence?: DiscordPresenceBridge;
};

const PAGE_ACTIVITY: Record<string, DiscordPresenceActivity> = {
  dashboard: "dashboard",
  projects: "projects",
  scanners: "scanners",
  context: "context_builder",
  taskPacks: "task_pack_archive",
  agents: "agents",
  templates: "templates",
  integrations: "integrations",
  github: "github",
  reports: "reports",
  accountSync: "account_sync",
  settings: "settings",
};

export function resolveDiscordPresenceActivity(input: {
  activePage: string;
  hasGeneratedTaskPack: boolean;
  hasContextComposerPreview: boolean;
  hasTaskPackDraft: boolean;
  hasSelectedProjectDetails: boolean;
  reportsActivity: "reports" | "validation_lab";
}): DiscordPresenceActivity {
  if (input.hasGeneratedTaskPack) {
    return "task_pack_result";
  }

  if (input.hasContextComposerPreview) {
    return "context_review";
  }

  if (input.hasTaskPackDraft) {
    return "task_pack_builder";
  }

  if (input.hasSelectedProjectDetails) {
    return "project_details";
  }

  if (input.activePage === "reports") {
    return input.reportsActivity;
  }

  return PAGE_ACTIVITY[input.activePage] ?? "dashboard";
}

export async function setDiscordPresenceActivity(
  activity: DiscordPresenceActivity,
): Promise<void> {
  const desktopBridge = (
    window as Window & { contextforge?: ContextForgeDesktopBridge }
  ).contextforge;

  try {
    await desktopBridge?.discordPresence?.setActivity(activity);
  } catch {
    // Discord Presence is optional and must never affect renderer behavior.
  }
}
