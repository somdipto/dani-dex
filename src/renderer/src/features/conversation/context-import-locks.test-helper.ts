import { vi } from "vitest";

/** jsdom has no Web Locks. This stub implements the exclusive request queue used by imports. */
export function installImportLocksStub(): () => void {
  const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
  const queues = new Map<string, Promise<void>>();
  function request<Result>(name: string, operation: () => Result | PromiseLike<Result>): Promise<Result> {
    const result = (queues.get(name) ?? Promise.resolve()).then(operation);
    queues.set(
      name,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(request) } });
  return () => {
    if (previous) Object.defineProperty(navigator, "locks", previous);
    else Reflect.deleteProperty(navigator, "locks");
  };
}
