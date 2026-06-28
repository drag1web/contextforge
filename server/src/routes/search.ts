import { Router } from "express";
import { z } from "zod";
import { searchWorkspace } from "../search/workspaceSearch.js";

export const searchRouter = Router();

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120)
});

searchRouter.get("/", async (req, res) => {
  const parsed = searchQuerySchema.safeParse({
    q: req.query.q
  });

  if (!parsed.success) {
    res.json({
      ok: true,
      query: "",
      results: []
    });
    return;
  }

  try {
    const results = await searchWorkspace(parsed.data.q);

    res.json({
      ok: true,
      query: parsed.data.q,
      results
    });
  } catch (error) {
    console.error("Workspace search failed:", error);

    res.status(500).json({
      ok: false,
      message: "Workspace search failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});