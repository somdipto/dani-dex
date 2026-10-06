import { describe, expect, it } from "vitest";
import { parseImport } from "./context-import";

const source = " | Source: this chat | Uncertainty: none known; coverage: partial";

describe("context import", () => {
  it("keeps provenance, removes duplicates and reports malformed lines", () => {
    const line = `- Builds Dani-Dex${source}`;
    const result = parseImport(
      `${line}\n${line}\n- Source: invented\n- Prefers short answers | Source: | Uncertainty: none`,
      "ChatGPT",
    );
    expect(result.entries.map((entry) => entry.text)).toEqual([
      `Imported from ChatGPT (historical): Builds Dani-Dex${source}`,
    ]);
    expect(result.rejected).toHaveLength(2);
  });

  it("redacts credential prose, card numbers and multiline keys before preview", () => {
    const result = parseImport(
      `- My password is demo-secret-value${source}\n- Card 4111 1111 1111 1111${source}\n-----BEGIN PRIVATE KEY-----\nsecret-key-bytes\n-----END PRIVATE KEY-----\n- Uses Linux${source}`,
      "Claude",
    );
    const preview = JSON.stringify(result);
    expect(preview).not.toContain("demo-secret-value");
    expect(preview).not.toContain("4111");
    expect(preview).not.toContain("secret-key-bytes");
    expect(result.entries.at(-1)?.text).toBe(`Imported from Claude (historical): Uses Linux${source}`);
  });
});
