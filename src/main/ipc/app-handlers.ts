// App identity, first-run setup, the analytics preference, external links and the data and
// diagnostics exports.

import { access } from "node:fs/promises";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import type { AgentHarnessId, AppInfo, AppSetupState, AppVariant, ExternalDestination } from "@dani-dex/contracts/ipc";
import { app, type BrowserWindow, shell } from "electron";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import { bundledHermesExecutable } from "../../backend/hermes-cli";
import type { MailboxStore } from "../../backend/mailbox-store";
import { readAnalyticsPreference, writeAnalyticsPreference } from "../analytics-preference-store";
import type { ApprovalAutomation } from "../approval-automation-store";
import type { LanguageService } from "../language-service";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import { exportDaniDexData, exportDiagnostics } from "../maintenance-service";
import { readSetupState, withDefaultHarness, writeSetupState } from "../setup-store";
import type { UpdateService } from "../update-service";
import {
  parseAnalyticsPreference,
  parseAppLanguagePreference,
  parseApprovalAutomation,
  parseExternalDestination,
  parseSetup,
} from "./app-inputs";
import { stringPayload } from "./validation";

/**
 * Every destination `openExternal` may reach, as a closed table.
 *
 * Exported because the addresses are a product contract the checker cannot judge: a wrong one sends
 * a user who asked for an OpenCode Go key to some other site, and the type only says "a string".
 *
 * `mac-screen-recording` is the one entry that is not a web page. macOS opens a settings pane from a
 * URL, and the table is what keeps that address out of the renderer. It is the same pane the
 * Computer Use panel opens, so it is read from `mac-permission-urls.ts` rather than written twice.
 */
export const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "agent-setup": "https://github.com/somdipto/dani-dex/blob/main/docs/TROUBLESHOOTING.md",
  "opencode-install": "https://opencode.ai/docs/",
  "opencode-auth": "https://opencode.ai/auth",
  "claude-install": "https://code.claude.com/docs",
  feedback: "https://x.com/intent/post?text=Feedback%20for%20DaniDex%20%40norbertbodziony%3A%20",
  message: "https://x.com/norbertbodziony",
  "mac-screen-recording": MAC_PERMISSION_URLS["screen-recording"],
};

import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AppIpcDependencies {
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserHost;
  updater: UpdateService;
  setupFile: string;
  analyticsPreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  language: LanguageService;
  initializeAgent: () => Promise<void>;
  appVariant: AppVariant;
  getMainWindow: () => BrowserWindow | null;
  setAnalyticsTrackingEnabled: (enabled: boolean) => void;
  /** The harness the agent service was built with at launch. A saved change applies on relaunch. */
  activeHarness: AgentHarnessId | null;
  relaunch: () => void;
}

export function appIpcHandlers({
  service,
  mailbox,
  browser,
  updater,
  setupFile,
  analyticsPreferenceFile,
  approvalAutomation,
  language,
  initializeAgent,
  appVariant,
  getMainWindow,
  setAnalyticsTrackingEnabled,
  activeHarness,
  relaunch,
}: AppIpcDependencies): Pick<IpcGroupHandlers, "app" | "maintenance"> {
  return {
    app: {
      getAppInfo: handler((): AppInfo => {
        const platform = process.platform;
        if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
          throw new Error(`Unsupported desktop platform: ${platform}`);
        }
        return { name: app.getName(), version: app.getVersion(), platform, variant: appVariant };
      }),
      getSetupState: handler(
        async (): Promise<AppSetupState> => ({
          ...(await readSetupState(setupFile)),
          activeHarness,
        }),
      ),
      getAnalyticsPreference: handler(() => readAnalyticsPreference(analyticsPreferenceFile)),
      setAnalyticsPreference: payloadHandler(parseAnalyticsPreference, async (parsed) => {
        const preference = await writeAnalyticsPreference(analyticsPreferenceFile, parsed.enabled);
        setAnalyticsTrackingEnabled(preference.enabled);
        return preference;
      }),
      getApprovalAutomation: handler(() => approvalAutomation.current()),
      setApprovalAutomation: payloadHandler(parseApprovalAutomation, (parsed) => approvalAutomation.set(parsed)),
      getAppLanguagePreference: handler(() => language.preference),
      setAppLanguagePreference: payloadHandler(parseAppLanguagePreference, (parsed) => language.set(parsed)),
      saveSetup: payloadHandler(parseSetup, async (input): Promise<AppSetupState> => {
        const previous = await readSetupState(setupFile);
        const state = await writeSetupState(
          setupFile,
          withDefaultHarness(previous, input, await bundledHermesAvailable()),
        );
        await service.setPreferredProvider(input.preferredProvider, input.preferredModel);
        await initializeAgent();
        return { ...state, activeHarness };
      }),
      relaunchApp: handler(() => relaunch()),
      openExternal: payloadHandler(parseExternalDestination, (parsed) => {
        return shell.openExternal(EXTERNAL_DESTINATIONS[parsed]);
      }),
      openUrl: payloadHandler(stringPayload("URL", INPUT_LIMITS.browserUrl), (url) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("Only HTTP(S) links can open in the external browser.");
        }
        return shell.openExternal(parsed.toString());
      }),
    },
    maintenance: {
      exportData: handler(() => exportDaniDexData({ service, mailbox, parentWindow: getMainWindow() })),
      exportDiagnostics: handler(() => exportDiagnostics({ service, browser, updater, parentWindow: getMainWindow() })),
    },
  };
}

/** The bundled Hermes, which a packaged build always carries and a development checkout may not. */
async function bundledHermesAvailable(): Promise<boolean> {
  const executable = bundledHermesExecutable();
  if (!executable) return false;
  try {
    await access(executable);
    return true;
  } catch {
    return false;
  }
}
