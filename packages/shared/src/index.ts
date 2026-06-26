export type ProjectStack =
  | "react"
  | "typescript"
  | "electron"
  | "node"
  | "express"
  | "postgresql"
  | "unknown";

export interface ProjectSummary {
  name: string;
  localPath: string;
  stack: ProjectStack[];
}
