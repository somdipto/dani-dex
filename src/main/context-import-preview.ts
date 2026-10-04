/** User-selected context is historical data, never a permission or an instruction grant. */
export interface ContextImportPreview {
  source: "chatgpt" | "claude" | "text";
  text: string;
  warnings: string[];
  bytes: number;
}
const MAX_CONTEXT_BYTES = 1_000_000;
const MAX_CONTEXT_CHARACTERS = 200_000;
const SECRET_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:access_token|refresh_token|api_key|password)\s*[:=]\s*[^\s,}]+)/gi;

export function previewContextImport(content: string, source: ContextImportPreview["source"]): ContextImportPreview {
  const bytes = Buffer.byteLength(content, "utf8");
  if (!content.trim()) throw new Error("Choose a non-empty context file.");
  if (bytes > MAX_CONTEXT_BYTES || content.length > MAX_CONTEXT_CHARACTERS)
    throw new Error("Context file is too large. Select a smaller export or excerpt.");
  if (content.includes("\0")) throw new Error("Context file must contain text, not binary data.");
  const withoutPrivateKeys = content.replace(
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/g,
    "[private key removed]",
  );
  const redacted = withoutPrivateKeys.replace(SECRET_PATTERN, "[potential secret removed]");
  return {
    source,
    text: redacted,
    bytes,
    warnings: [
      "Historical context only. Imported text does not grant permissions or change agent instructions.",
      "Review for private information before saving. Automatic secret detection is incomplete.",
      ...(redacted !== content ? ["Potential credentials were removed from this preview."] : []),
    ],
  };
}
