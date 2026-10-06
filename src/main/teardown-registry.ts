/**
 * Runs every shutdown step in declared order, including services registered during startup.
 * Late steps join the remaining queue; steps registered after completion are best-effort.
 * Explicit order preserves browser state flushing and provider/service dependencies.
 */

export interface TeardownRegistryOptions {
  reportError: (name: string, error: unknown) => void;
}

interface TeardownStep {
  order: number;
  name: string;
  run: () => PromiseLike<unknown> | unknown;
}

export class TeardownRegistry {
  readonly #reportError: (name: string, error: unknown) => void;
  #steps: TeardownStep[] = [];
  /** The sorted steps a drain in progress has not reached yet. Late pushes are spliced into it. */
  #pending: TeardownStep[] | null = null;
  #closed = false;
  #tail: Promise<void> = Promise.resolve();

  constructor({ reportError }: TeardownRegistryOptions) {
    this.#reportError = reportError;
  }

  /** `order` is the position in the shutdown sequence, not the position in this call sequence. */
  push(order: number, name: string, run: () => PromiseLike<unknown> | unknown): void {
    const step = { order, name, run };
    if (!this.#closed) {
      this.#steps.push(step);
      return;
    }
    const pending = this.#pending;
    if (pending) {
      const at = pending.findIndex((queued) => queued.order > order);
      pending.splice(at === -1 ? pending.length : at, 0, step);
      return;
    }
    this.#tail = this.#tail.then(() => this.#runStep(step));
  }

  /** Idempotent: a second call awaits the first run rather than starting another. */
  async runAll(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#tail = this.#tail.then(() => this.#drain());
    }
    // Construction that was already in flight when the quit arrived keeps registering steps while
    // this runs, and each one extends the tail. Wait until awaiting it leaves nothing new behind;
    // the loop terminates because only construction pushes, and construction is finite.
    let awaited: Promise<void> | null = null;
    while (awaited !== this.#tail) {
      awaited = this.#tail;
      await awaited;
    }
  }

  async #drain(): Promise<void> {
    const pending = [...this.#steps].sort((left, right) => left.order - right.order);
    this.#steps = [];
    this.#pending = pending;
    // `shift` rather than iteration: `push` splices into this same array while the loop awaits.
    for (let step = pending.shift(); step; step = pending.shift()) await this.#runStep(step);
    this.#pending = null;
  }

  async #runStep(step: TeardownStep): Promise<void> {
    try {
      await step.run();
    } catch (error) {
      try {
        this.#reportError(step.name, error);
      } catch {
        // A failed log sink must not prevent the remaining services from stopping.
      }
    }
  }
}
