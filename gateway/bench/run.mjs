// Computer-use bench: runs each task through the real worker, checks the
// outcome against the fixture (file or answer), logs pass/fail. Usage:
//   DANI_CUA_BASE_URL=http://127.0.0.1:4201 node bench/run.mjs [taskId ...]
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { ComputerUseWorker } from "../src/computer-use.js";
const tasks = JSON.parse(readFileSync(new URL("./tasks.json", import.meta.url)));
const only = process.argv.slice(2);
const w = new ComputerUseWorker({ baseUrl: process.env.DANI_CUA_BASE_URL });
if (!(await w.healthy())) { console.error("computer-use worker not reachable"); process.exit(2); }
const has = (s, x) => String(s ?? "").toLowerCase().includes(String(x).toLowerCase());
function check(e, answer) {
  if (e.answerHas) return has(answer, e.answerHas);
  if (e.answerHasAll) return e.answerHasAll.every((x) => has(answer, x));
  if (e.answerHasAll) return e.answerHasAll.every((x) => has(answer, x));
  if (e.answerHasAny) return e.answerHasAny.some((x) => has(answer, x));
  if (e.fileHas) return existsSync(e.fileHas[0]) && has(readFileSync(e.fileHas[0], "utf8"), e.fileHas[1]);
  return false;
}
const results = [];
for (const t of tasks) {
  if (only.length && !only.includes(t.id)) continue;
  for (const f of ["/tmp/bench/made.txt"]) rmSync(f, { force: true });
  if (t.expect.fileHas?.[0].endsWith("submissions.log")) writeFileSync("/tmp/bench/submissions.log", "");
  const t0 = Date.now(); let answer = "", err = null, tools = 0;
  try { const r = await Promise.race([w.run(t.task, { timeoutMs: 4 * 60 * 1000, onTool: () => tools++ }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout 5min')), 5 * 60 * 1000))]); answer = r.answer; } catch (e) { err = String(e.message ?? e); }
  const pass = !err && check(t.expect, answer);
  results.push({ id: t.id, pass, secs: Math.round((Date.now() - t0) / 1000), tools, err, answer: String(answer).slice(0, 160) });
  console.log(`${pass ? "PASS" : "FAIL"} ${t.id} ${results.at(-1).secs}s tools=${tools}${err ? " err=" + err : ""}`);
}
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
writeFileSync(process.env.BENCH_OUT ?? "/tmp/bench-result.json", JSON.stringify(results, null, 2));
