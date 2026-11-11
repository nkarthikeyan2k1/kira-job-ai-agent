import { fileURLToPath } from "node:url";

// Node-only entry ("@kira/shared/db"), kept out of the main export so the web
// bundle never pulls in node:url.
export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
