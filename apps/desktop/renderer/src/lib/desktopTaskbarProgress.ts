type DesktopTaskbarProgressBridge = {
  setActive: (active: boolean) => Promise<boolean>;
};

type ContextForgeDesktopBridge = {
  taskbarProgress?: DesktopTaskbarProgressBridge;
};

export async function setDesktopTaskbarProgress(
  active: boolean,
): Promise<void> {
  const desktopBridge = (
    window as Window & { contextforge?: ContextForgeDesktopBridge }
  ).contextforge;

  try {
    await desktopBridge?.taskbarProgress?.setActive(active);
  } catch {
    // Native taskbar polish is optional and must never affect app workflows.
  }
}
