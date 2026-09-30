import type { ChatGptConnectionSummary } from "@dani-dex/contracts/ipc";
import { type ChatGptLoopback, startChatGptLoopback } from "./chatgpt-plan-listener";
import { hasChatGptPlanScope } from "./chatgpt-plan-oauth";
import type { ChatGptPlanStore, ChatGptRegistration } from "./chatgpt-plan-store";
import { exchangeChatGptTokens, loadChatGptSigningKeys, verifyChatGptIdentity } from "./chatgpt-plan-tokens";

export class ChatGptPlanService {
  #pending: ChatGptLoopback | null = null;
  #generation = 0;
  #connecting: Promise<ChatGptRegistration> | null = null;
  #disconnecting = new Set<string>();
  #refreshes = new Map<string, Promise<ChatGptRegistration>>();
  constructor(
    private readonly store: ChatGptPlanStore,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  connect(clientId?: string): Promise<ChatGptRegistration> {
    if (this.#connecting) return Promise.reject(new Error("A ChatGPT sign-in is already active."));
    const run = this.#connect(clientId).finally(() => {
      if (this.#connecting === run) this.#connecting = null;
    });
    this.#connecting = run;
    return run;
  }
  async #connect(clientId?: string): Promise<ChatGptRegistration> {
    const selected = clientId ? this.store.read(clientId) : null;
    if (clientId && !selected) throw new Error("The selected ChatGPT registration is unavailable.");
    const generation = ++this.#generation;
    const listener = await startChatGptLoopback({
      hostId: this.store.hostId(),
      appName: "Dani-Dex",
      ...(selected
        ? {
            clientId: selected.clientId,
            idTokenHint: selected.idToken,
            ...(selected.email ? { loginHint: selected.email } : {}),
          }
        : {}),
    });
    if (generation !== this.#generation) {
      await listener.cancel();
      throw new Error("ChatGPT sign-in ended.");
    }
    this.#pending = listener;
    try {
      await this.openBrowser(listener.attempt.authorizationUrl);
      const callback = await listener.result;
      if (callback.status === "denied") throw new Error("ChatGPT sign-in was not approved.");
      const tokens = await exchangeChatGptTokens(callback.tokenForm, this.fetchImpl);
      const identity = await verifyChatGptIdentity(tokens.id_token, await loadChatGptSigningKeys(this.fetchImpl), {
        clientId: callback.clientId,
        nonce: listener.attempt.nonce,
        ...(selected ? { subject: selected.subject } : {}),
      });
      const registration: ChatGptRegistration = {
        clientId: callback.clientId,
        subject: identity.subject,
        email: identity.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        scopes: tokens.scope.split(/\s+/u).filter(Boolean),
        expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
        ...(tokens.earliest_refresh_at === undefined ? {} : { earliestRefreshAt: tokens.earliest_refresh_at }),
      };
      if (generation !== this.#generation) throw new Error("ChatGPT sign-in ended.");
      await this.store.save(registration);
      return registration;
    } finally {
      await listener.cancel();
      if (this.#pending === listener) this.#pending = null;
    }
  }
  async cancel(): Promise<void> {
    this.#generation++;
    await this.#pending?.cancel();
  }
  async disconnect(clientId: string): Promise<void> {
    this.#disconnecting.add(clientId);
    try {
      await this.cancel();
      await this.#connecting?.catch(() => undefined);
      await this.#refreshes.get(clientId)?.catch(() => undefined);
      await this.store.remove(clientId);
    } finally {
      this.#disconnecting.delete(clientId);
    }
  }
  summaries(): ChatGptConnectionSummary[] {
    return this.store.list().map((r) => ({
      clientId: r.clientId,
      email: r.email,
      planEnabled: hasChatGptPlanScope(r.scopes.join(" ")),
      expiresAt: r.expiresAt,
    }));
  }
  selected(): ChatGptRegistration | null {
    return this.store.selected();
  }
  async select(clientId: string): Promise<void> {
    await this.store.select(clientId);
  }
  async ready(): Promise<ChatGptRegistration> {
    const selected = this.store.selected();
    if (!selected || !hasChatGptPlanScope(selected.scopes.join(" ")))
      throw new Error("Connect a ChatGPT plan with model access first.");
    return selected.expiresAt > Math.floor(Date.now() / 1000) + 60 ? selected : this.refresh(selected.clientId);
  }
  planEnabled(clientId: string): boolean {
    const r = this.store.read(clientId);
    return Boolean(r && hasChatGptPlanScope(r.scopes.join(" ")));
  }
  refresh(clientId: string): Promise<ChatGptRegistration> {
    if (this.#disconnecting.has(clientId)) return Promise.reject(new Error("ChatGPT disconnect is in progress."));
    const pending = this.#refreshes.get(clientId);
    if (pending) return pending;
    const run = this.#rotate(clientId).finally(() => {
      if (this.#refreshes.get(clientId) === run) this.#refreshes.delete(clientId);
    });
    this.#refreshes.set(clientId, run);
    return run;
  }
  async #rotate(clientId: string): Promise<ChatGptRegistration> {
    const old = this.store.read(clientId);
    if (!old) throw new Error("ChatGPT registration is unavailable.");
    const now = Math.floor(Date.now() / 1000);
    if (old.earliestRefreshAt !== undefined && now < old.earliestRefreshAt) {
      if (old.expiresAt > now) return old;
      throw new Error("ChatGPT token renewal is not available yet.");
    }
    const tokens = await exchangeChatGptTokens(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: old.clientId,
        refresh_token: old.refreshToken,
        resource: "https://api.openai.com/v1",
      }),
      this.fetchImpl,
    );
    const identity = await verifyChatGptIdentity(tokens.id_token, await loadChatGptSigningKeys(this.fetchImpl), {
      clientId,
      subject: old.subject,
    });
    const next: ChatGptRegistration = {
      ...old,
      email: identity.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      scopes: tokens.scope.split(/\s+/u).filter(Boolean),
      expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      earliestRefreshAt: tokens.earliest_refresh_at,
    };
    await this.store.save(next);
    return next;
  }
}
