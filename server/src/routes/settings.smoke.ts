import assert from "node:assert/strict";

import { updateSettingsSchema } from "./settings.js";

let scenarios = 0;

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

for (const focusModeBehavior of ["manual", "automatic"] as const) {
  scenario(`settings PATCH accepts focusModeBehavior=${focusModeBehavior}`, () => {
    const result = updateSettingsSchema.safeParse({ focusModeBehavior });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.focusModeBehavior, focusModeBehavior);
  });
}

for (const workspaceDensity of ["adaptive", "comfortable", "compact"] as const) {
  scenario(`settings PATCH accepts workspaceDensity=${workspaceDensity}`, () => {
    const result = updateSettingsSchema.safeParse({ workspaceDensity });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.workspaceDensity, workspaceDensity);
  });
}

scenario("settings PATCH rejects unknown focus mode behavior", () => {
  assert.equal(updateSettingsSchema.safeParse({ focusModeBehavior: "scheduled" }).success, false);
});

scenario("settings PATCH rejects unknown workspace density", () => {
  assert.equal(updateSettingsSchema.safeParse({ workspaceDensity: "dense" }).success, false);
});

process.stdout.write(`Settings PATCH smoke passed: ${scenarios} scenarios.\n`);
