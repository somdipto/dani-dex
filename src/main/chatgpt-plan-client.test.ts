import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decodeAccountReadResult, decodeModelListResponse, decodeRecordResponse } from "../backend/protocol";
import { ChatGptPlanClient } from "./chatgpt-plan-client";

it("runs a child with the selected token and uses the live account catalog, not CLI account files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-child-"));
  const path = join(dir, "codex");
  await writeFile(
    path,
    `#!/usr/bin/env node\nconst rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='test/token'?{token:process.env.ACCESS_TOKEN,args:process.argv}: {}})+'\\n');});`,
  );
  await chmod(path, 0o700);
  const registration = {
    clientId: "selected",
    subject: "sub",
    email: "account@example.com",
    idToken: "id",
    accessToken: "selected-secret",
    refreshToken: "refresh",
    scopes: ["chatgpt.tokens.use.direct"],
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  };
  const requested: string[] = [];
  const client = new ChatGptPlanClient(
    path,
    3000,
    async () => registration,
    async (url, init) => {
      requested.push(String(url));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-secret");
      return new Response(
        JSON.stringify({ models: [{ slug: "real-account-model", display_name: "Account Model", visibility: "list" }] }),
      );
    },
  );
  try {
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);
    expect((await client.request("account/read", {}, decodeAccountReadResult)).account?.email).toBe(
      "account@example.com",
    );
    expect((await client.request("model/list", {}, decodeModelListResponse)).data[0]?.model).toBe("real-account-model");
    const result = await client.request("test/token", {}, decodeRecordResponse);
    expect(result.token).toBe("selected-secret");
    expect(JSON.stringify(result.args)).not.toContain("selected-secret");
    expect(requested).toEqual(["https://api.openai.com/v1/models"]);
  } finally {
    await client.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
