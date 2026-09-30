/** Only a backend failure before any output/tool boundary permits a fresh attempt. */
export function fallbackFailure(error: unknown): "refusal" | "quota" | "outage" | "timeout" | null {
 const text=String(error);
 if (/cancel|denied by user|permission|safety|content.?filter|invalid.?prompt|context.?length|bad.?request/i.test(text)) return null;
 if (/FreeTierError|OpenCode's free tier can only be used from within OpenCode/i.test(text)) return "refusal";
 if (/\b403\b|forbidden/i.test(text)) return "refusal";
 if (/\b429\b|quota|rate.?limit/i.test(text)) return "quota";
 if (/\b504\b|upstream.*timed? out/i.test(text)) return "timeout";
 if (/\b50[023]\b|service unavailable|bad gateway|upstream.*unavailable|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(text)) return "outage";
 return null;
}
