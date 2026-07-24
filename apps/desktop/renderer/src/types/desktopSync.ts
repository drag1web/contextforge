export type DesktopSyncState =
  | "disconnected"
  | "connecting"
  | "online"
  | "offline"
  | "error";

export interface DesktopSyncUser {
  id: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface DesktopSyncRelease {
  id: string | null;
  version: string | null;
  channel: string | null;
  platform: string | null;
  arch: string | null;
  fileName: string | null;
  downloadUrl: string | null;
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
}

export interface DesktopSyncStatus {
  configured: boolean;
  connected: boolean;
  online: boolean;
  state: DesktopSyncState;
  secureStorageAvailable: boolean;
  siteUrl: string;
  installationId: string | null;
  deviceName: string;
  channel: string;
  platform: string;
  arch: string;
  appVersion: string;
  user: DesktopSyncUser | null;
  license: string | null;
  lastSeenAt: string | null;
  pairedAt: string | null;
  lastCheckedAt: string | null;
  projectCount: number | null;
  updateAvailable: boolean;
  latestRelease: DesktopSyncRelease | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DesktopSyncPairInput {
  pairingCode: string;
  siteUrl: string;
  deviceName: string;
  channel: "alpha" | "beta" | "stable";
}

export interface DesktopSyncTaskPackUpload {
  sourceTaskPackId: string;
  title: string;
  projectName?: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
  generatedPrompt: string;
  sourceCreatedAt?: string;
}

export interface DesktopSyncCloudTaskPack {
  id: string;
  originInstallationId: string;
  sourceTaskPackId: string;
  title: string;
  projectName: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
  generatedPrompt: string;
  contentHash: string;
  contentBytes: number;
  integrityValid: boolean;
  sourceCreatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DesktopSyncTaskPackDelivery {
  id: string;
  taskPackId: string;
  targetInstallationId: string;
  status: "pending" | "delivered" | "imported" | "dismissed" | "failed" | "cancelled" | "expired";
  attemptCount: number;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deliveredAt: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  integrityVerifiedAt: string | null;
}

export interface DesktopSyncTaskPackInboxItem {
  delivery: DesktopSyncTaskPackDelivery;
  taskPack: DesktopSyncCloudTaskPack;
}
