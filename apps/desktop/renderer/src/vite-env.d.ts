/// <reference types="vite/client" />

import type {
  DesktopSyncPairInput,
  DesktopSyncStatus,
  DesktopSyncTaskPackDelivery,
  DesktopSyncTaskPackInboxItem,
  DesktopSyncTaskPackUpload,
  DesktopSyncCloudTaskPack
} from "./types/desktopSync";

declare global {
  interface Window {
    contextforge?: {
      selectProjectFolder: () => Promise<string | null>;
      openExternalUrl?: (url: string) => Promise<boolean>;
      desktopSync?: {
        getStatus: (options?: {
          refresh?: boolean;
        }) => Promise<DesktopSyncStatus>;
        pair: (input: DesktopSyncPairInput) => Promise<DesktopSyncStatus>;
        heartbeat: () => Promise<DesktopSyncStatus>;
        checkForUpdates: () => Promise<DesktopSyncStatus>;
        publishTaskPack: (taskPack: DesktopSyncTaskPackUpload) => Promise<DesktopSyncCloudTaskPack>;
        getTaskPackInbox: () => Promise<DesktopSyncTaskPackInboxItem[]>;
        acknowledgeTaskPack: (
          deliveryId: string,
          status: "imported" | "dismissed" | "failed",
          options?: { error?: string; contentHash?: string }
        ) => Promise<DesktopSyncTaskPackDelivery>;
        unpair: () => Promise<DesktopSyncStatus>;
        openPairingPage: (siteUrl: string) => Promise<boolean>;
        onStatusChanged: (
          listener: (status: DesktopSyncStatus) => void
        ) => () => void;
      };
      windowControls?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
      };
    };
  }
}

export {};
