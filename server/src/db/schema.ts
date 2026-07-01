import { storage } from "../storage/index.js";

export async function ensureDatabaseSchema() {
  await storage.ensureSchema();
}
