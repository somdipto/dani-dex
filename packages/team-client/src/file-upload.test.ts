import {
  decodeTeamProtocolV2FileChunk,
  decodeTeamProtocolV2FileControlFrame,
  encodeTeamProtocolV2Frame,
} from "@dani-dex/contracts/team-protocol/v2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteFileSender } from "./file-upload";

const transferId = "b6396068-3405-4e51-9b42-d97bfd1e2f33";
const input = { name: "note.txt", mimeType: "text/plain", base64: btoa("hello") };
afterEach(() => vi.useRealTimers());

describe("mobile file upload", () => {
  it("sends the existing file protocol with the exact bytes and digest before completing", async () => {
    const received: Array<string | ArrayBuffer> = [];
    const sender = createRemoteFileSender(
      async (data) => {
        received.push(data);
        if (typeof data === "string" && decodeTeamProtocolV2FileControlFrame(data).type === "file-open") {
          sender.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId, receivedThrough: 0 }));
        }
      },
      () => transferId,
    );
    await sender.upload(input);
    expect(
      received.map((data) =>
        typeof data === "string" ? decodeTeamProtocolV2FileControlFrame(data) : decodeTeamProtocolV2FileChunk(data),
      ),
    ).toEqual([
      {
        version: 2,
        type: "file-open",
        transferId,
        name: "note.txt",
        mimeType: "text/plain",
        size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
      { transferId, offset: 0, bytes: new TextEncoder().encode("hello") },
      { version: 2, type: "file-complete", transferId },
    ]);
  });
  it("stops before sending bytes when the host rejects the file", async () => {
    let frames = 0;
    const sender = createRemoteFileSender(
      async () => {
        frames++;
        sender.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-cancel", transferId, reason: "rejected" }));
      },
      () => transferId,
    );
    await expect(sender.upload(input)).rejects.toThrow("The host rejected the attachment.");
    expect(frames).toBe(1);
  });
  it("rejects a pending upload when its connection is replaced", async () => {
    const sender = createRemoteFileSender(
      async () => sender.cancel(),
      () => transferId,
    );
    await expect(sender.upload(input)).rejects.toThrow("The attachment connection closed.");
  });

  it.each(["disconnect", "rejection", "timeout"])("interrupts a blocked chunk send after %s", async (failure) => {
    if (failure === "timeout") vi.useFakeTimers();
    let arrived = () => {};
    let finish = () => {};
    const sending = new Promise<void>((done) => {
      arrived = done;
    });
    const blocked = new Promise<void>((done) => {
      finish = done;
    });
    const sender = createRemoteFileSender(
      async (data) => {
        if (typeof data === "string") {
          sender.receive(encodeTeamProtocolV2Frame({ version: 2, type: "file-ack", transferId, receivedThrough: 0 }));
        } else {
          arrived();
          await blocked;
        }
      },
      () => transferId,
    );
    const settled = vi.fn();
    const uploaded = sender.upload(input);
    void uploaded.then(settled, settled);
    try {
      await sending;
      if (failure === "disconnect") sender.cancel();
      else if (failure === "rejection")
        sender.receive(
          encodeTeamProtocolV2Frame({
            version: 2,
            type: "file-cancel",
            transferId,
            reason: "rejected",
          }),
        );
      else await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
      await expect(uploaded).rejects.toThrow(
        failure === "disconnect" ? "connection closed" : failure === "rejection" ? "rejected" : "timed out",
      );
    } finally {
      finish();
      sender.cancel();
      await uploaded.catch(() => undefined);
    }
  });
});
