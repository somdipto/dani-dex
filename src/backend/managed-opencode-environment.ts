import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Isolate managed application config without modifying the user's global configuration or auth. */
export function managedOpenCodeEnvironment(
  inherited: NodeJS.ProcessEnv,
  configHome = join(homedir(), ".dani-dex", "managed-opencode-config"),
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  // Inherited explicit files/directories can bypass XDG isolation. The application overlay is retained.
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_DIR;
  env.XDG_CONFIG_HOME = configHome;
  env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1";
  env.OPENCODE_DISABLE_GLOBAL_CONFIG = "1";
  env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  return env;
}
export function prepareManagedOpenCodeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const isolated = managedOpenCodeEnvironment(env);
  if (isolated.XDG_CONFIG_HOME) mkdirSync(isolated.XDG_CONFIG_HOME, { recursive: true, mode: 0o700 });
  return isolated;
}
