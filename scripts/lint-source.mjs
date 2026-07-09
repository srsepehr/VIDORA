import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scannedDirs = ["src", "supabase", "docs"];
const forbidden = [
  { pattern: /localStorage\.setItem\(["']vidora-viewer["']/, message: "mock auth localStorage flag must not be restored" },
  { pattern: /vidora-lib-saved/, message: "library saved state must not use localStorage" },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!never-commit-real-service-role-key)/, message: "service role key must not be committed" },
  { pattern: /AI_(TRANSCRIPTION|TRANSLATION)_PROVIDER_KEY\s*=\s*\S+/, message: "AI provider keys must not be committed" },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = scannedDirs
  .flatMap((dir) => {
    const full = path.join(root, dir);
    return fs.existsSync(full) ? walk(full) : [];
  })
  .filter((file) => /\.(jsx?|tsx?|sql|md|json)$/.test(file));

const failures = [];
for (const file of files) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) failures.push(`${rel}: ${rule.message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`lint-source passed (${files.length} files scanned)`);
