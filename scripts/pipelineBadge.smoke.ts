import assert from "node:assert/strict";

import { getSelectorPipelineLabel } from "../apps/desktop/renderer/src/components/selector/selectorPipelinePresentation";

assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "legacy",
    effectivePipeline: "legacy",
    status: "success",
  }),
  "Legacy",
);
assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "shadow_compare",
    effectivePipeline: "legacy",
    status: "success",
  }),
  "Compare · Legacy output",
);
assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "shadow_primary",
    effectivePipeline: "shadow",
    status: "success",
  }),
  "Shadow",
);
assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "shadow_primary",
    effectivePipeline: "legacy",
    status: "fallback",
  }),
  "Legacy fallback",
);
assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "shadow_primary",
    effectivePipeline: "legacy",
    status: "manual-review",
    executionStatus: "fallback",
    fallback: { code: "shadow_exception", message: "failed" },
  }),
  "Legacy fallback",
);
assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "shadow_primary",
    effectivePipeline: "shadow",
    status: "success",
    selectionOrigin: "manual_override",
  }),
  "Manual selection · Shadow suggested",
);

assert.equal(
  getSelectorPipelineLabel({
    requestedMode: "shadow_primary",
    effectivePipeline: "shadow",
    status: "success",
    selectionOrigin: "explicit_target_fast_path",
  }),
  "Target fast path",
);

console.log("selector pipeline presentation smoke passed: 7 states");
