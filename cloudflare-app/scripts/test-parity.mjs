import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/consulting\//, "");
  const full = path.join(appRoot, "public", "consulting", rel);
  const text = fs.readFileSync(full, "utf-8");
  return { ok: true, json: async () => JSON.parse(text), text: async () => text };
};

const { loadLismoreDatasets, runLismoreModelJS, auditLismoreComplianceJS } = await import(
  "../public/consulting/app/lismore-engine.js"
);

const { rules, climate } = await loadLismoreDatasets();
const cases = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "parity_cases.json"), "utf-8"),
);

const results = {};
for (const c of cases) {
  const model = runLismoreModelJS(c.assessment, rules, climate);
  const audit = auditLismoreComplianceJS(c.assessment, c.spatial, model, rules);
  results[c.name] = { model, audit };
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(results));
} else {
  console.log(`[PASS] Evaluated ${cases.length} parity fixtures in browser JS engine.`);
}
