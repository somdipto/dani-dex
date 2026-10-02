import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { type AgentProfileDraft, AVATAR_HUES } from "@dani-dex/contracts/ipc";
import { expect, it, vi } from "vitest";
import type { AgentClient } from "../agent-client";
import { getString, type RequestId, type ResponseDecoder, type RpcError } from "../protocol";
import {
  generateGatewayProfile,
  generateGatewayTextWithoutTools,
  generateProfile,
  generateTextWithoutTools,
  profilePrompt,
} from "./profile-generation";

const draft: AgentProfileDraft = {
  name: "Researcher",
  title: "Research assistant",
  description: "Compare primary sources.",
  avatarSeed: "profile:research",
  avatarHue: 215,
  sectionId: null,
};
const model = {
  id: "gpt-5.6-luna",
  provider: "codex",
  name: "Luna",
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
} as const;
class ProfileClient extends EventEmitter implements AgentClient {
  readonly provider = "codex";
  running = false;
  cwd = "";
  denied = false;
  constructor(
    readonly output: string,
    readonly toolRequest = false,
  ) {
    super();
  }
  starts = 0;
  start() {
    this.starts += 1;
    this.running = true;
  }
  async stop() {
    this.running = false;
  }
  notify() {}
  respond(_id: RequestId, _result: unknown) {}
  respondError(_id: RequestId, _error: RpcError) {
    this.denied = true;
  }
  async request<T>(method: string, params: unknown, decode: ResponseDecoder<T>): Promise<T> {
    if (method === "thread/start") {
      this.cwd = getString(params, "cwd") ?? "";
      return decode({ thread: { id: "draft-thread" } });
    }
    if (method === "turn/start") {
      if (this.toolRequest) this.emit("request", { id: 1, method: "item/tool/call", params: {} });
      else {
        this.emit("notification", { method: "item/agentMessage/delta", params: { delta: this.output } });
        this.emit("notification", { method: "turn/completed", params: { turn: { status: "completed" } } });
      }
      return decode({ turn: { id: "draft-turn" } });
    }
    return decode({});
  }
}

it("returns editable generated fields and removes the disposable workspace and provider process", async () => {
  const client = new ProfileClient(JSON.stringify(draft));
  expect(
    await generateProfile(
      client,
      { ...model, supportedReasoningEfforts: ["medium"] },
      { prompt: "Research assistant" },
      [],
    ),
  ).toEqual(draft);
  expect(client.running).toBe(false);
  await expect(access(client.cwd)).rejects.toThrow();
});

// An endpoint removed while the disposable workspace is made finds a client with no process, so
// stopping it reaches nothing. Only the generation itself can keep the old endpoint unspawned.
it("spawns no process for a generation cancelled while its workspace was made", async () => {
  const client = new ProfileClient(JSON.stringify(draft));
  await expect(
    generateProfile(
      client,
      { ...model, supportedReasoningEfforts: ["medium"] },
      { prompt: "Research assistant" },
      [],
      () => true,
    ),
  ).rejects.toThrow("The custom endpoints changed while this was generating. Try again.");
  expect(client.starts).toBe(0);
  // No session was opened either, so the removed endpoint was never asked for anything.
  expect(client.cwd).toBe("");
});

it.each([
  "not JSON",
  JSON.stringify({ ...draft, description: "x".repeat(2001) }),
  JSON.stringify({ ...draft, avatarHue: 20 }),
  JSON.stringify({ ...draft, sectionId: "missing" }),
])("rejects unusable generation without leaving its process running: %s", async (output) => {
  const client = new ProfileClient(output);
  await expect(
    generateProfile(client, { ...model, supportedReasoningEfforts: ["medium"] }, { prompt: "Research assistant" }, []),
  ).rejects.toThrow();
  expect(client.running).toBe(false);
  await expect(access(client.cwd)).rejects.toThrow();
});

it("denies provider tool requests instead of executing the setup prompt", async () => {
  const client = new ProfileClient("", true);
  await expect(
    generateProfile(client, { ...model, supportedReasoningEfforts: ["medium"] }, { prompt: "Run a command" }, []),
  ).rejects.toThrow("attempted to use a tool");
  expect(client.denied).toBe(true);
  expect(client.running).toBe(false);
});

it("revises from the current draft using the existing avatar palette", () => {
  const prompt = profilePrompt({ prompt: "Focus on science", draft }, []);
  expect(prompt).toContain(JSON.stringify(draft));
  expect(prompt).toContain(AVATAR_HUES.join(","));
});

it("preserves a redacted provider failure instead of mislabeling routing as profile failure", async () => {
  const client = new ProfileClient("");
  const request = client.request.bind(client);
  client.request = async (method, params, decode) => {
    if (method === "turn/start") {
      client.emit("notification", {
        method: "error",
        params: { message: "Provider refused request. Authorization: Bearer abcdef123456" },
      });
      client.emit("notification", { method: "turn/completed", params: { turn: { status: "failed" } } });
      return decode({});
    }
    return request(method, params, decode);
  };
  await expect(
    generateTextWithoutTools(client, { ...model, supportedReasoningEfforts: ["medium"] }, "Return JSON"),
  ).rejects.toThrow("Provider refused request.");
  expect(client.running).toBe(false);
});

import { validateGatewayRoute } from "./profile-generation";

const gatewayRoute = {
  endpoint: "https://api.kilo.ai/api/gateway/chat/completions",
  modelId: "stepfun/step-3.7-flash:free",
};
const catalog = {
  data: [
    {
      id: gatewayRoute.modelId,
      isFree: true,
      pricing: { prompt: "0", completion: "0", request: "0" },
      architecture: { output_modalities: ["text"] },
    },
  ],
};
const reply = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });
it("uses exact zero-cost gateway selection without tools or redirects", async () => {
  const request = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
    String(url).endsWith("/models")
      ? reply(catalog)
      : reply({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }] }),
  );
  vi.stubGlobal("fetch", request);
  try {
    expect(await generateGatewayProfile(gatewayRoute, { prompt: "Synthetic" }, [])).toEqual(draft);
    const init = request.mock.calls[1]?.[1];
    if (!init || typeof init.body !== "string") throw new Error("Gateway did not receive a JSON request");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(gatewayRoute.modelId);
    expect(body.tools).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
    expect(init.redirect).toBe("error");
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each(["length", "content_filter", "tool_calls"])(
  "rejects gateway finish %s with no fallback",
  async (finish_reason) => {
    const request = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/models")
        ? reply(catalog)
        : reply({ choices: [{ finish_reason, message: { content: "partial" } }] }),
    );
    vi.stubGlobal("fetch", request);
    try {
      await expect(generateGatewayTextWithoutTools(gatewayRoute, "Synthetic")).rejects.toThrow(
        "incomplete or filtered",
      );
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
it.each([
  { isFree: false },
  { isFree: "false" },
  { pricing: { prompt: null, completion: "0" } },
  { pricing: { prompt: "", completion: "0" } },
  { pricing: { prompt: false, completion: "0" } },
  { pricing: { request: "0" } },
  { pricing: { prompt: "0.1" } },
  { expires_at: "2020-01-01T00:00:00Z" },
  { architecture: { output_modalities: ["image"] } },
])("rejects unusable catalog %j before inference", async (change) => {
  const request = vi.fn(async () => reply({ data: [{ ...catalog.data[0], ...change }] }));
  vi.stubGlobal("fetch", request);
  try {
    await expect(generateGatewayTextWithoutTools(gatewayRoute, "Synthetic")).rejects.toThrow("expired, paid");
    expect(request).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("rejects endpoint/model mismatch without network", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  try {
    await expect(
      generateGatewayTextWithoutTools({ ...gatewayRoute, modelId: "kilo-auto/free" }, "Synthetic"),
    ).rejects.toThrow("not permitted");
    expect(request).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("bounds response bytes before parsing", async () => {
  const request = vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith("/models") ? reply(catalog) : new Response("x".repeat(256001)),
  );
  vi.stubGlobal("fetch", request);
  try {
    await expect(generateGatewayTextWithoutTools(gatewayRoute, "Synthetic")).rejects.toThrow("too large");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("aborts a generation during fetch", async () => {
  const controller = new AbortController();
  const request = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Gateway cancellation signal missing");
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  vi.stubGlobal("fetch", request);
  try {
    const result = generateGatewayTextWithoutTools(gatewayRoute, "Synthetic", () => false, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toThrow("aborted");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("rejects HTTP 200 error envelopes", async () => {
  const request = vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith("/models") ? reply(catalog) : reply({ error: { message: "blocked" } }),
  );
  vi.stubGlobal("fetch", request);
  try {
    await expect(generateGatewayTextWithoutTools(gatewayRoute, "Synthetic")).rejects.toThrow("rejected");
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([undefined, "tools", [], ["temperature"]])(
  "worker rejects missing/malformed tool capability %j",
  async (supported_parameters) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: [{ ...catalog.data[0], supported_parameters }] })),
    );
    try {
      await expect(validateGatewayRoute(gatewayRoute, AbortSignal.timeout(1000), true)).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
it("worker requires fresh catalog and tool capability each dispatch", async () => {
  const fetcher = vi.fn(async () => reply({ data: [{ ...catalog.data[0], supported_parameters: ["tools"] }] }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await validateGatewayRoute(gatewayRoute, AbortSignal.timeout(1000), true);
    await validateGatewayRoute(gatewayRoute, AbortSignal.timeout(1000), true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
