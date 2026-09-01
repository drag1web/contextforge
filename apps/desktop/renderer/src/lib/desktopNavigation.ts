export type DesktopNavigationPage =
  | "dashboard"
  | "projects"
  | "taskPacks"
  | "reports"
  | "settings";

type DesktopNavigationBridge = {
  consume: () => Promise<DesktopNavigationPage | null>;
  onRequest: (
    handler: (page: DesktopNavigationPage) => void,
  ) => () => void;
};

type ContextForgeDesktopBridge = {
  desktopNavigation?: DesktopNavigationBridge;
};

function getDesktopBridge(): DesktopNavigationBridge | undefined {
  return (
    window as Window & { contextforge?: ContextForgeDesktopBridge }
  ).contextforge?.desktopNavigation;
}

export async function consumeDesktopNavigationRequest(): Promise<
  DesktopNavigationPage | null
> {
  try {
    return (await getDesktopBridge()?.consume()) ?? null;
  } catch {
    return null;
  }
}

export function subscribeDesktopNavigationRequests(
  handler: (page: DesktopNavigationPage) => void,
): () => void {
  try {
    return getDesktopBridge()?.onRequest(handler) ?? (() => {});
  } catch {
    return () => {};
  }
}
