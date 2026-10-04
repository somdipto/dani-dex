import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HarmlessEffectAppService } from "./harmless-effect-app-service";

it("requires stored owner review, consumes once, reconciles real response-loss receipt after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "dani-app-effect-"));
  let service = new HarmlessEffectAppService(root);
  try {
    const denied = service.prepare();
    await expect(service.dispatch(denied.id)).rejects.toThrow("denied");
    expect(readdirSync(root).filter((n) => n.endsWith(".receipt"))).toHaveLength(0);
    const approved = service.prepare();
    service.approve(approved.id);
    expect(await service.dispatch(approved.id)).toBe("succeeded");
    await expect(service.dispatch(approved.id)).rejects.toThrow("denied");
    const lost = service.prepare();
    service.approve(lost.id);
    expect(await service.dispatch(lost.id, undefined, true)).toBe("unknown");
    service.close();
    service = new HarmlessEffectAppService(root);
    await expect(service.dispatch(lost.id)).rejects.toThrow("denied");
    expect(service.reconcile(lost.id)).toBe("succeeded");
    expect(readdirSync(root).filter((n) => n.endsWith(".receipt"))).toHaveLength(2);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it("revocation at the barrier and stale approval cause zero effects", async () => {
  const root = mkdtempSync(join(tmpdir(), "dani-app-effect-"));
  const service = new HarmlessEffectAppService(root);
  try {
    const operation = service.prepare();
    service.approve(operation.id);
    await expect(service.dispatch(operation.id, async () => service.revoke())).rejects.toThrow("denied");
    expect(readdirSync(root).filter((n) => n.endsWith(".receipt"))).toHaveLength(0);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
