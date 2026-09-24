/**
 * Fails when shipped Dani-Dex code or config still names the upstream project or its servers.
 *
 * "Shipped" is what reaches a user: the desktop app (src, packages, build, resources,
 * electron-builder.yml), the mobile app, and the issue-template links. Tests, stories, preview
 * fixtures and developer docs are out of scope. The inherited web Worker (apps/auth-api) and site
 * router are not deployed (see the deploy-production job) and are handled separately.
 *
 * A few upstream names are load-bearing and stay: the Grok referrer the CLI expects, the Sunshine
 * endpoint paths and patch file names the remote-desktop runtime is built from, and a stored
 * database seed. They are listed in ALLOWED and matched as exact substrings of the line.
 *
 * Run: bun scripts/check-upstream-references.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

export const SHIPPED_PATHS = [
  "src",
  "packages",
  "apps/mobile",
  "build",
  "resources",
  "electron-builder.yml",
  ".github/ISSUE_TEMPLATE",
  "PRIVACY.md",
] as const;

const EXCLUDED_FILE =
  /(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$|\/stories\/|\/preview\/|\/__tests__\/|app-test-harness|\.snap$)/u;
/** Markdown is developer documentation except where the app ships it: managed skills and the privacy policy. */
const SHIPPED_MARKDOWN = /^(?:resources\/.*\.md|PRIVACY\.md)$/u;
const BINARY_FILE = /\.(?:png|jpe?g|gif|webp|ico|icns|svg|ttf|otf|woff2?|mp3|mp4|wav|zip|gz|tgz|pdf|lock)$/iu;

export const FORBIDDEN = /openbot|nightly[- ]labs/iu;

export const ALLOWED = [
  'GROK_OAUTH2_REFERRER: "openbot"',
  '"/api/openbot/',
  "OPENBOT_REMOTE_SETUP",
  'z.literal("openbot-moonlight")',
  "openbot-avatar-seed-",
] as const;

export interface UpstreamReference {
  file: string;
  line: number;
  text: string;
}

export function shippedFiles(root = repositoryRoot): string[] {
  const output = execFileSync("git", ["ls-files", "--", ...SHIPPED_PATHS], { cwd: root, encoding: "utf8" });
  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => !EXCLUDED_FILE.test(file) && !BINARY_FILE.test(file))
    .filter((file) => !file.endsWith(".md") || SHIPPED_MARKDOWN.test(file));
}

export function findUpstreamReferences(file: string, content: string): UpstreamReference[] {
  const found: UpstreamReference[] = [];
  content.split("\n").forEach((text, index) => {
    if (FORBIDDEN.test(text) && !ALLOWED.some((allowed) => text.includes(allowed))) {
      found.push({ file, line: index + 1, text: text.trim() });
    }
  });
  return found;
}

export function scanShippedFiles(root = repositoryRoot): UpstreamReference[] {
  return shippedFiles(root).flatMap((file) => {
    let content: string;
    try {
      content = readFileSync(resolve(root, file), "utf8");
    } catch {
      return [];
    }
    return findUpstreamReferences(file, content);
  });
}

if (import.meta.main) {
  const references = scanShippedFiles();
  for (const reference of references) {
    process.stderr.write(`${reference.file}:${reference.line}: ${reference.text}\n`);
  }
  if (references.length > 0) {
    process.stderr.write(
      `\n${references.length} upstream reference(s) in shipped code. Dani-Dex must not name them.\n`,
    );
    process.exit(1);
  }
  process.stdout.write("No upstream references in shipped code.\n");
}
