import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { pool } from "./db/pool.js";
import { ensureDatabaseSchema } from "./db/schema.js";
import { projectsRouter } from "./routes/projects.js";
import { taskPacksRouter } from "./routes/taskPacks.js";
import { ollamaRouter } from "./routes/ollama.js";
import { settingsRouter } from "./routes/settings.js";
import { searchRouter } from "./routes/search.js";

const app = express();

app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"]
}));

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "contextforge-server",
    version: "0.1.0"
  });
});

app.get("/api/db/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT 1 AS ok");

    res.json({
      ok: true,
      database: result.rows[0]
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      ok: false,
      message: "Database connection failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use("/api/projects", projectsRouter);
app.use("/api/task-packs", taskPacksRouter);
app.use("/api/ollama", ollamaRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/search", searchRouter);

async function bootstrap() {
  await ensureDatabaseSchema();

  app.listen(config.port, () => {
    console.log(`ContextForge server started on http://localhost:${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start ContextForge server:", error);
  process.exit(1);
});