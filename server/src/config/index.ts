import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.SERVER_PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://contextforge:contextforge@127.0.0.1:5433/contextforge",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434"
};