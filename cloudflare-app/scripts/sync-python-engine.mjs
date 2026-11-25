import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const pyTarget = path.join(appRoot, "public", "consulting", "py");

const filesToCopy = [
  ["src/enviro_comply/__init__.py", "enviro_comply/__init__.py"],
  ["src/enviro_comply/data/alstonville_climate.json", "enviro_comply/data/alstonville_climate.json"],
  ["src/enviro_comply/data/lismore_rules.json", "enviro_comply/data/lismore_rules.json"],
  ["src/enviro_comply/schemas/__init__.py", "enviro_comply/schemas/__init__.py"],
  ["src/enviro_comply/schemas/ossm.py", "enviro_comply/schemas/ossm.py"],
  ["src/enviro_comply/schemas/see.py", "enviro_comply/schemas/see.py"],
  ["src/enviro_comply/engine/__init__.py", "enviro_comply/engine/__init__.py"],
  ["src/enviro_comply/engine/lismore_model.py", "enviro_comply/engine/lismore_model.py"],
  ["src/enviro_comply/engine/compliance_rules.py", "enviro_comply/engine/compliance_rules.py"],
  ["src/enviro_comply/engine/see_rules.py", "enviro_comply/engine/see_rules.py"],
  ["src/enviro_comply/cad/__init__.py", "enviro_comply/cad/__init__.py"],
  ["src/enviro_comply/cad/dxf_generator.py", "enviro_comply/cad/dxf_generator.py"],
  ["src/enviro_comply/report/__init__.py", "enviro_comply/report/__init__.py"],
  ["src/enviro_comply/report/docx_builder.py", "enviro_comply/report/docx_builder.py"],
  ["src/enviro_comply/report/see_docx_builder.py", "enviro_comply/report/see_docx_builder.py"],
];

let copied = 0;
for (const [srcRel, dstRel] of filesToCopy) {
  const src = path.join(repoRoot, srcRel);
  const dst = path.join(pyTarget, dstRel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source file: ${src}`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}

// Also expose rules & climate directly under /consulting/data/ for instant zero-Pyodide JS calculations
const dataTarget = path.join(appRoot, "public", "consulting", "data");
fs.mkdirSync(dataTarget, { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, "src/enviro_comply/data/lismore_rules.json"),
  path.join(dataTarget, "lismore_rules.json"),
);
fs.copyFileSync(
  path.join(repoRoot, "src/enviro_comply/data/alstonville_climate.json"),
  path.join(dataTarget, "alstonville_climate.json"),
);

console.log(`[sync-py] Synced ${copied} Python engine files + 2 JSON datasets into public/consulting/`);
