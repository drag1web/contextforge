import fs from "node:fs/promises";
import path from "node:path";

import { validateRepositorySnapshot } from "../domain/index.js";
import { cloneDomainValue } from "../domain/investigationDomainSupport.js";
import type {
  LoadedValidationProject,
  ValidationProjectDefinition,
  ValidationProjectLoader,
} from "./validationTypes.js";

export interface OfflineValidationProjectLoaderDependencies {
  syntheticFixtures: Readonly<Record<string, LoadedValidationProject>>;
  loadLocalProject?: (input: {
    project: ValidationProjectDefinition;
    root: string;
  }) => Promise<LoadedValidationProject>;
}

function validateLoadedProject(project: LoadedValidationProject, expectedProjectId: string): LoadedValidationProject {
  const cloned = cloneDomainValue({
    status: project.status,
    snapshot: project.snapshot,
    projectFingerprint: project.projectFingerprint,
  });
  const validation = validateRepositorySnapshot(cloned.snapshot);
  if (!validation.valid || cloned.projectFingerprint !== cloned.snapshot.rootFingerprint ||
    cloned.snapshot.projectId !== expectedProjectId) {
    throw new Error("Offline project snapshot failed validation.");
  }
  return {
    ...cloned,
    ...(project.verifyUnchanged === undefined ? {} : { verifyUnchanged: project.verifyUnchanged }),
  };
}

export function createOfflineValidationProjectLoader(
  dependencies: OfflineValidationProjectLoaderDependencies,
): ValidationProjectLoader {
  return {
    async load({ project, runtimeRoots }) {
      if (project.source.kind === "synthetic") {
        const fixture = dependencies.syntheticFixtures[project.source.fixtureId];
        if (!fixture) {
          return { status: "unavailable", reasonCode: "fixture_unavailable", message: "Synthetic fixture is unavailable." };
        }
        try {
          return validateLoadedProject(fixture, project.id);
        } catch {
          return { status: "unavailable", reasonCode: "fixture_unavailable", message: "Synthetic fixture is invalid." };
        }
      }
      const root = runtimeRoots[project.source.rootKey];
      if (!root || !path.isAbsolute(root)) {
        return { status: "unavailable", reasonCode: "project_unavailable", message: "Local project root is unavailable." };
      }
      try {
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) throw new Error("not_directory");
        await fs.access(root, fs.constants.R_OK);
      } catch {
        return { status: "unavailable", reasonCode: "project_unavailable", message: "Local project root is unavailable." };
      }
      if (!dependencies.loadLocalProject) {
        return { status: "unavailable", reasonCode: "execution_unavailable", message: "Local snapshot loader is unavailable." };
      }
      try {
        return validateLoadedProject(await dependencies.loadLocalProject({ project, root }), project.id);
      } catch {
        return { status: "unavailable", reasonCode: "execution_unavailable", message: "Local project could not be loaded." };
      }
    },
  };
}
