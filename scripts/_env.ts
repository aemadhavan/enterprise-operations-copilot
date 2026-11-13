// Load local secrets for scripts (ingest, migrate, eval). Import this first.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
