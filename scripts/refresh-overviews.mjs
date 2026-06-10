/**
 * Recomputes data/digest.json → section_overviews from existing items (no RSS fetch).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOverviews } from "./section-overviews.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const path = join(root, "data", "digest.json");

const d = JSON.parse(readFileSync(path, "utf8"));
d.section_overviews = buildOverviews(d.items || []);
writeFileSync(path, JSON.stringify(d, null, 2) + "\n", "utf8");
console.log(`Updated section_overviews in ${path} (${(d.items || []).length} items).`);
