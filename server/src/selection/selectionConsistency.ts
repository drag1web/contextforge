import type { SelectedTaskFile } from "../ollama/taskFileSelector.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import { buildProjectSemanticGraph } from "./projectSemanticGraph.js";

export interface SelectionSeedConsistencyResult {
  selectedFiles: SelectedTaskFile[];
  retainedSeeds: string[];
  omittedSeeds: Array<{ path: string; reason: string }>;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function isEditable(file: SelectedTaskFile) {
  return file.usage === "inspect-and-edit" || file.usage === "create-and-edit";
}

function hasRetainableSeedEvidence(file: SelectedTaskFile) {
  const evidence = file.selectionEvidence;
  if (!evidence) return file.evidenceLevel === "user_confirmed";
  if (evidence.actionConfidence === "confirmed_edit") return true;
  return (
    evidence.actionConfidence === "inspect_then_edit" &&
    ["symbol_exact", "route_graph", "state_graph"].includes(evidence.ownershipEvidence)
  );
}

export function retainGraphSeeds(input: {
  selectedFiles: SelectedTaskFile[];
  fallbackSeeds: SelectedTaskFile[];
  inventory: ProjectInventory;
  maxFiles: number;
}): SelectionSeedConsistencyResult {
  const selected = [...input.selectedFiles];
  const selectedPaths = new Set(selected.map((file) => normalizePath(file.path)));
  const graph = buildProjectSemanticGraph(input.inventory);
  const retainedSeeds: string[] = [];
  const omittedSeeds: Array<{ path: string; reason: string }> = [];

  for (const seed of input.fallbackSeeds.filter(isEditable).slice(0, 3)) {
    const seedKey = normalizePath(seed.path);
    if (selectedPaths.has(seedKey)) continue;
    if (!hasRetainableSeedEvidence(seed)) {
      omittedSeeds.push({
        path: seed.path,
        reason: "Fallback seed was not retained because it lacks confirmed ownership evidence.",
      });
      continue;
    }
    const relatedPaths = new Set(
      graph
        .getSupportFiles([seed.path], {
          includeImportedBy: true,
          includeRouteLocal: true,
          maxPerTarget: 20,
        })
        .map((item) => normalizePath(item.file.path)),
    );
    const selectedNeighbor = selected.some((file) => relatedPaths.has(normalizePath(file.path)));
    if (!selectedNeighbor) {
      omittedSeeds.push({
        path: seed.path,
        reason: "No selected file is graph-related to this fallback seed.",
      });
      continue;
    }

    if (selected.length >= input.maxFiles) {
      const removableIndex = selected.findIndex((file) =>
        !isEditable(file) &&
        file.selectionEvidence?.actionConfidence !== "confirmed_edit",
      );
      if (removableIndex >= 0) selected.splice(removableIndex, 1);
    }
    if (selected.length >= input.maxFiles) {
      omittedSeeds.push({
        path: seed.path,
        reason: "Selection limit was reached by stronger confirmed targets.",
      });
      continue;
    }

    selected.unshift({
      ...seed,
      reason: `Retained central graph seed because selected support files depend on its relationship chain. ${seed.reason}`,
    });
    selectedPaths.add(seedKey);
    retainedSeeds.push(seed.path);
  }

  return { selectedFiles: selected, retainedSeeds, omittedSeeds };
}
