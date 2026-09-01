export type DesktopNotificationKind =
  | "task_pack_generated"
  | "validation_finished";

type DesktopNotificationsBridge = {
  show: (kind: DesktopNotificationKind) => Promise<boolean>;
};

type ContextForgeDesktopBridge = {
  desktopNotifications?: DesktopNotificationsBridge;
};

export async function showDesktopNotification(
  kind: DesktopNotificationKind,
): Promise<void> {
  const desktopBridge = (
    window as Window & { contextforge?: ContextForgeDesktopBridge }
  ).contextforge;

  try {
    await desktopBridge?.desktopNotifications?.show(kind);
  } catch {
    // Native notifications are optional and must never affect app workflows.
  }
}
