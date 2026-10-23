// Distillation scoreboard: one row per target behavior, pass/fail/pending from its check. Usage: node scripts/scoreboard.mjs [--fast]
import { readFileSync } from "node:fs"; import { execSync } from "node:child_process";
const spec = JSON.parse(readFileSync(new URL("../docs/behavior-spec.json", import.meta.url), "utf8")); const fast = process.argv.includes("--fast");
let failed = 0; const rows = [];
for (const b of spec) {
  let st = "pending";
  if (b.check && !(fast && b.needs)) { try { execSync(b.check, { stdio: "ignore", timeout: 180000 }); st = "pass"; } catch { st = "FAIL"; failed++; } }
  else if (b.check) st = "skipped(needs desktop)";
  rows.push(`${b.id.padEnd(4)} ${st.padEnd(24)} ${b.behavior}`);
}
console.log(rows.join("\n")); const p = spec.filter((b) => !b.check).length; console.log(`\n${spec.length - p} of ${spec.length} behaviors have a check; ${p} pending; ${failed} failing`);
process.exit(failed ? 1 : 0);
