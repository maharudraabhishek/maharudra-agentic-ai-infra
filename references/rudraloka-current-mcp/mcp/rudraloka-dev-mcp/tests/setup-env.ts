import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.RUDRALOKA_PROJECT_ROOT = path.resolve(__dirname, "../../..");
