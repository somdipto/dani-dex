import type { DaniDexModelSource } from "@dani-dex/contracts/online-services";
import { createDaniDexLogger } from "@dani-dex/logging";
import { setRuntimeModelSource } from "../backend/model-source";
import type { AgentInitializationGate } from "./agent-initialization";
import type { DaniFreeSupervisor } from "./dani-free";
import { appendDaniFreeDiagnostic } from "./dani-free-diagnostic";

const logger = createDaniDexLogger("dani-free-connection");
const MODEL_ID = "dani/dani-free-auto";

/** The small part of the agent service used to install and verify the live proxy. */
export interface DaniFreeService {
  saveCustomProvider(id: string, persist: () => Promise<void>): Promise<unknown>;
  reloadOpenCodeConfig(): Promise<"not-running" | "skipped-busy" | "restarted">;
  ensureProvider(provider: "opencode"): Promise<void>;
  listModels(): readonly { id: string }[];
}

/** Reconcile first launch and later proxy exits, instead of treating one early failure as permanent. */
export class DaniFreeConnection {
  #source: DaniDexModelSource | null = null;
  #stopped = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: Promise<void> | null = null;
  #generation = 0;
  #failures = 0;

  constructor(
    private readonly proxy: Pick<DaniFreeSupervisor, "start" | "stop" | "isRunning">,
    private readonly service: DaniFreeService,
    private readonly initialization: AgentInitializationGate,
    private readonly home: string,
    private readonly retryDelay: (failures: number) => number = (failures) =>
      failures === 0 ? 60_000 : Math.min(5_000 * 2 ** Math.min(failures - 1, 4), 60_000),
  ) {}

  start(): void {
    if (this.#stopped || this.#pending || this.#timer) return;
    const generation = ++this.#generation;
    this.#pending = this.#reconcile(generation)
      .catch(async (error: unknown) => {
        if (this.#stopped || generation !== this.#generation) return;
        logger.warn("Dani Free connection failed; will retry.", { error: String(error) });
        await appendDaniFreeDiagnostic(this.home, {
          stage: "connected",
          outcome: "failed",
          detail: String(error),
        }).catch(() => undefined);
        this.#failures += 1;
      })
      .finally(() => {
        this.#pending = null;
        if (this.#stopped || generation !== this.#generation) return;
        // Retry promptly on first failure, back off when offline, and keep checking for a dead proxy.
        const delay = this.retryDelay(this.#failures);
        this.#timer = setTimeout(() => {
          this.#timer = null;
          this.start();
        }, delay);
        this.#timer.unref?.();
      });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    // A handshake can be waiting on the proxy's own timeout, so do not hold app shutdown on it.
    await this.proxy.stop();
    if (this.#source) setRuntimeModelSource(null);
    this.#source = null;
  }

  async #reconcile(generation: number): Promise<void> {
    if (this.#source && !this.proxy.isRunning()) {
      // A stale local URL must not be reused by the next OpenCode process. Keep the
      // old id excluded until a fresh client confirms the replacement endpoint.
      await this.proxy.stop();
      await this.service.saveCustomProvider(this.#source.id, async () => setRuntimeModelSource(null));
      this.#source = null;
      if (this.#stopped || generation !== this.#generation) return;
    }
    if (!this.#source) {
      const source = await this.proxy.start();
      if (this.#stopped || generation !== this.#generation) return;
      if (!source) throw new Error("Dani Free proxy did not start.");
      // The exclusion and the new endpoint are atomic. A stale OpenCode process cannot answer as it.
      // Keep the source even if the save throws after mutating, so shutdown clears it.
      this.#source = source;
      await this.service.saveCustomProvider(source.id, async () => {
        if (!this.#stopped && generation === this.#generation) setRuntimeModelSource(source);
      });
    }
    if (this.#stopped || generation !== this.#generation) return;
    // Initialization can start after the proxy's ready line. Coalesce with the app's own start.
    await this.initialization.start();
    if (this.#stopped || generation !== this.#generation) return;
    if (this.service.listModels().some((model) => model.id === MODEL_ID)) {
      this.#failures = 0;
      return;
    }
    const restart = await this.service.reloadOpenCodeConfig();
    if (this.#stopped || generation !== this.#generation) return;
    if (restart === "not-running") await this.service.ensureProvider("opencode");
    if (this.#stopped || generation !== this.#generation) return;
    if (this.service.listModels().some((model) => model.id === MODEL_ID)) {
      this.#failures = 0;
      return;
    }
    // A busy or failed restart has not confirmed the endpoint: never bypass its exclusion.
    throw new Error(`Dani Free model was not listed after ${restart}.`);
  }
}
