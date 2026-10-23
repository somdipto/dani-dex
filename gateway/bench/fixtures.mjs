import http from "node:http";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
mkdirSync("/tmp/bench/count", { recursive: true });
for (let i = 1; i <= 7; i++) writeFileSync(`/tmp/bench/count/f${i}`, "x");
const pages = {
  "/p1.html": "<title>Quartz Lantern</title><h1>Quartz Lantern</h1><p>Welcome.</p>",
  "/p2.html": "<title>Pricing</title><h1>Pricing</h1><ul><li>Free: $0</li><li>Pro plan: $37</li><li>Team: $99</li></ul>",
  "/p3.html": "<title>Start</title><h1>Start</h1><a href='/p4.html'>Next step</a>",
  "/p4.html": "<title>Landing</title><h1>Harbor Seven</h1>",
  "/long.html": "<title>Long</title>" + Array.from({ length: 80 }, (_, i) => `<p>Line ${i + 1} of filler text.</p>`).join("") + "<p>Code word: cobalt-ninety</p>",
  "/form.html": "<title>Form</title><form method=post action=/submit><input name=name placeholder=Name><input name=email placeholder=Email><button>Submit</button></form>",
  "/check.html": "<title>Check</title><form method=post action=/submit><label><input type=checkbox name=agree> I agree</label><button>Confirm</button></form>",
};
http.createServer((req, res) => {
  if (req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { appendFileSync("/tmp/bench/submissions.log", decodeURIComponent(b.replace(/\+/g, " ")) + "\n"); res.end("<h1>Thanks</h1>"); });
    return;
  }
  const p = pages[req.url.split("?")[0]];
  res.writeHead(p ? 200 : 404, { "content-type": "text/html" }); res.end(p ?? "<h1>Not Found</h1>");
}).listen(8899, "127.0.0.1", () => console.log("fixtures on 8899"));
