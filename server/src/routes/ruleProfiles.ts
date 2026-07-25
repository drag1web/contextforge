import { Router, type Response } from "express";
import { z } from "zod";

import {
  createAcceptanceCriteriaPreset,
  createRuleItem,
  createRuleProfile,
  deleteAcceptanceCriteriaPreset,
  deleteRuleItem,
  deleteRuleProfile,
  getRulesAndTemplatesCatalog,
  RulesServiceError,
  updateAcceptanceCriteriaPreset,
  updateRuleItem,
  updateRuleProfile
} from "../rules/rulesService.js";

export const ruleProfilesRouter = Router();

const taskTypeSchema = z.enum([
  "general",
  "ui",
  "backend",
  "fullstack",
  "build",
  "bugfix",
  "refactor",
  "docs",
  "tests"
]);

const ruleProfilePayloadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  taskType: taskTypeSchema,
  enabledRuleIds: z.array(z.string().trim().min(1).max(180)).max(80).optional(),
  customRules: z.array(z.string().trim().min(1).max(700)).max(20).optional(),
  acceptanceCriteriaPresetId: z.string().trim().min(1).max(180).nullable().optional()
});

const updateRuleProfilePayloadSchema = ruleProfilePayloadSchema.partial();

const ruleCategorySchema = z.enum([
  "general",
  "ui",
  "backend",
  "bugfix",
  "refactor",
  "docs",
  "tests",
  "assets",
  "verification"
]);

const ruleItemPayloadSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  category: ruleCategorySchema,
  content: z.string().trim().min(10).max(2_000)
});

const updateRuleItemPayloadSchema = ruleItemPayloadSchema.partial();

const acceptanceCriteriaPayloadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  taskType: taskTypeSchema,
  criteria: z
    .array(z.string().trim().min(2).max(700))
    .min(1)
    .max(30)
});

const updateAcceptanceCriteriaPayloadSchema =
  acceptanceCriteriaPayloadSchema.partial();

function handleRouteError(res: Response, error: unknown) {
  if (error instanceof RulesServiceError) {
    res.status(error.statusCode).json({
      ok: false,
      message: error.message
    });
    return;
  }

  res.status(500).json({
    ok: false,
    message: "Rule profiles request failed",
    error: error instanceof Error ? error.message : String(error)
  });
}

ruleProfilesRouter.get("/", async (_req, res) => {
  try {
    const catalog = await getRulesAndTemplatesCatalog();

    res.json({
      ok: true,
      ruleProfiles: catalog.ruleProfiles,
      ruleItems: catalog.ruleItems,
      acceptanceCriteriaPresets: catalog.acceptanceCriteriaPresets
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.post("/rules", async (req, res) => {
  const parsed = ruleItemPayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid rule payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const ruleItem = await createRuleItem(parsed.data);

    res.json({
      ok: true,
      ruleItem
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.put("/rules/:id", async (req, res) => {
  const parsed = updateRuleItemPayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid rule payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const ruleItem = await updateRuleItem(req.params.id, parsed.data);

    res.json({
      ok: true,
      ruleItem
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.delete("/rules/:id", async (req, res) => {
  try {
    await deleteRuleItem(req.params.id);

    res.json({ ok: true });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.post("/criteria", async (req, res) => {
  const parsed = acceptanceCriteriaPayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid acceptance criteria payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const acceptanceCriteriaPreset = await createAcceptanceCriteriaPreset(
      parsed.data
    );

    res.json({
      ok: true,
      acceptanceCriteriaPreset
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.put("/criteria/:id", async (req, res) => {
  const parsed = updateAcceptanceCriteriaPayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid acceptance criteria payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const acceptanceCriteriaPreset = await updateAcceptanceCriteriaPreset(
      req.params.id,
      parsed.data
    );

    res.json({
      ok: true,
      acceptanceCriteriaPreset
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.delete("/criteria/:id", async (req, res) => {
  try {
    await deleteAcceptanceCriteriaPreset(req.params.id);

    res.json({ ok: true });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.post("/", async (req, res) => {
  const parsed = ruleProfilePayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid rule profile payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const ruleProfile = await createRuleProfile(parsed.data);

    res.json({
      ok: true,
      ruleProfile
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.put("/:id", async (req, res) => {
  const parsed = updateRuleProfilePayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid rule profile payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const ruleProfile = await updateRuleProfile(req.params.id, parsed.data);

    res.json({
      ok: true,
      ruleProfile
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

ruleProfilesRouter.delete("/:id", async (req, res) => {
  try {
    await deleteRuleProfile(req.params.id);

    res.json({
      ok: true
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});
