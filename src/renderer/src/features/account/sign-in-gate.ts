import type { CentralAuthUser } from "@dani-dex/contracts/ipc";

/**
 * Whether the window waits for a Dani-Dex account before showing anything else.
 *
 * Off for now: the app opens straight into onboarding or the workspace, and everything that runs
 * on this computer works without an account. The sign-in screen, email codes and the GitHub and
 * Google sign-ins are all still in the codebase; set this back to `true` to put them in front of
 * the app again.
 */
export const SIGN_IN_REQUIRED = false;

let signInRequiredOverride: boolean | null = null;

/** `SIGN_IN_REQUIRED`, unless a test has switched it for the sign-in screen's own coverage. */
export function signInRequired(): boolean {
  return signInRequiredOverride ?? SIGN_IN_REQUIRED;
}

/** Tests only: keeps the parked sign-in screen tested while it is switched off. `null` restores. */
export function setSignInRequiredForTesting(required: boolean | null): void {
  signInRequiredOverride = required;
}

/**
 * Who the workspace shows while nobody is signed in and sign-in is not required.
 *
 * It never reaches the account service or the main process: features that need a real account
 * keep checking `centralAuth()` themselves, so they stay unavailable until someone signs in.
 */
export const LOCAL_ACCOUNT: CentralAuthUser = Object.freeze({
  id: "local",
  email: "",
  name: "Local",
  avatarUrl: null,
});

/** The account the window opens with: the signed-in one, else the local one when sign-in is off. */
export function accountForWindow(signedIn: CentralAuthUser | null, signInRequired: boolean): CentralAuthUser | null {
  return signedIn ?? (signInRequired ? null : LOCAL_ACCOUNT);
}
