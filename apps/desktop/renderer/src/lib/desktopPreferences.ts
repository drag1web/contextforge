export type DesktopPreferences = {
  discordRichPresence: boolean;
  windowsNotifications: boolean;
  taskbarActivity: boolean;
  windowsJumpList: boolean;
};

export type DesktopPreferenceUpdate = Partial<DesktopPreferences>;

type DesktopPreferencesBridge = {
  get: () => Promise<DesktopPreferences>;
  update: (input: DesktopPreferenceUpdate) => Promise<DesktopPreferences>;
  onChanged: (
    handler: (preferences: DesktopPreferences) => void,
  ) => () => void;
};

type ContextForgeDesktopBridge = {
  desktopPreferences?: DesktopPreferencesBridge;
};

const DEFAULT_PREFERENCES: DesktopPreferences = {
  discordRichPresence: true,
  windowsNotifications: true,
  taskbarActivity: true,
  windowsJumpList: true,
};

function getBridge(): DesktopPreferencesBridge | undefined {
  return (
    window as Window & { contextforge?: ContextForgeDesktopBridge }
  ).contextforge?.desktopPreferences;
}

export async function getDesktopPreferences(): Promise<DesktopPreferences> {
  try {
    return (await getBridge()?.get()) ?? DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function updateDesktopPreferences(
  input: DesktopPreferenceUpdate,
): Promise<DesktopPreferences> {
  try {
    return (await getBridge()?.update(input)) ?? {
      ...DEFAULT_PREFERENCES,
      ...input,
    };
  } catch {
    return {
      ...DEFAULT_PREFERENCES,
      ...input,
    };
  }
}

export function subscribeDesktopPreferences(
  handler: (preferences: DesktopPreferences) => void,
): () => void {
  try {
    return getBridge()?.onChanged(handler) ?? (() => {});
  } catch {
    return () => {};
  }
}
