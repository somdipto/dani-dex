// The cloud account: email sign-in, profile, and the mobile devices connected to it.

import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { CENTRAL_AUTH_PROVIDERS, type CentralAuthProvider } from "@dani-dex/contracts/ipc";
import type { CentralAuthManager } from "../central-auth-manager";
import type { HostService } from "../host-service";
import { createHostedMobileConnect } from "../mobile-connect-host";
import { parseEmailCodeVerification, parseProfileName } from "./app-inputs";
import { parseAvatarImage } from "./avatar-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface AccountIpcDependencies {
  centralAuth: CentralAuthManager;
  host: Pick<HostService, "configure" | "getStatus" | "start" | "getMobileConnectHost">;
}

export function accountIpcHandlers({ centralAuth, host }: AccountIpcDependencies): Pick<IpcGroupHandlers, "auth"> {
  return {
    auth: {
      getState: handler(() => centralAuth.getState()),
      retry: handler(() => centralAuth.retry()),
      requestEmailCode: payloadHandler(stringPayload("email", INPUT_LIMITS.email), (email) =>
        centralAuth.requestEmailCode(email),
      ),
      verifyEmailCode: payloadHandler(parseEmailCodeVerification, (verification) =>
        centralAuth.verifyEmailCode(verification.challengeId, verification.code),
      ),
      getSignInOptions: handler(() => centralAuth.getSignInOptions()),
      signInWithProvider: payloadHandler(parseCentralAuthProvider, (provider) =>
        centralAuth.signInWithProvider(provider),
      ),
      cancelProviderSignIn: handler(() => centralAuth.cancelProviderSignIn()),
      updateName: payloadHandler(parseProfileName, (name) => centralAuth.updateName(name)),
      updateAvatar: payloadHandler(parseAvatarImage, (parsed) => centralAuth.updateAvatar(parsed)),
      createMobileConnect: handler(() => createHostedMobileConnect({ centralAuth, host })),
      listMobileConnectedDevices: handler(() => centralAuth.listMobileConnectedDevices()),
      listAccountSessions: handler(() => centralAuth.listAccountSessions()),
      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        centralAuth.revokeAccountSession(sessionId),
      ),
      revokeMobileConnectedDevice: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>
        centralAuth.revokeMobileConnectedDevice(sessionId),
      ),
      logout: handler(() => centralAuth.logout()),
    },
  };
}

function parseCentralAuthProvider(input: unknown): CentralAuthProvider {
  const provider = CENTRAL_AUTH_PROVIDERS.find((candidate) => candidate === input);
  if (!provider) throw new Error("provider must be github or google.");
  return provider;
}
