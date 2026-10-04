import { expect, it } from "vitest";
import { managedOpenCodeEnvironment } from "./managed-opencode-environment";

it("isolates global/plugin paths but preserves the app model overlay and auth data location", () => {
  const inherited = {
    XDG_CONFIG_HOME: "/user/config",
    XDG_DATA_HOME: "/user/data",
    OPENCODE_CONFIG: "/user/plugins.jsonc",
    OPENCODE_CONFIG_DIR: "/user/plugins",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "0",
    OPENCODE_CONFIG_CONTENT: '{"provider":{"dani":{}}}',
    HOME: "/user",
    PATH: "/bin",
  };
  const env = managedOpenCodeEnvironment(inherited, "/app/config");
  expect(env.XDG_CONFIG_HOME).toBe("/app/config");
  expect(env.OPENCODE_CONFIG).toBeUndefined();
  expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
  expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1");
  expect(env.OPENCODE_DISABLE_GLOBAL_CONFIG).toBe("1");
  expect(env.OPENCODE_CONFIG_CONTENT).toBe(inherited.OPENCODE_CONFIG_CONTENT);
  expect(env.XDG_DATA_HOME).toBe("/user/data");
  expect(env.HOME).toBe("/user");
  expect(env.PATH).toBe("/bin");
  expect(inherited.OPENCODE_CONFIG).toBe("/user/plugins.jsonc");
});
