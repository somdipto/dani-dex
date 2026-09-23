import { AppLogo } from "@dani-dex/brand";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import type { AppVariant, CentralAuthIssue, CentralAuthProvider, CentralAuthState } from "@dani-dex/contracts/ipc";
import { normalizeEmailAddress, normalizeOneTimeCode } from "@dani-dex/contracts/validation";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowLeft, Button, Input, RefreshCw } from "../../components/ui";
import { OtpInput, type OtpInputStatus } from "../../components/ui/otp-input";

interface AccountLoginProps {
  variant: AppVariant;
  state: CentralAuthState;
  onRetry: () => Promise<void>;
  onRequestEmailCode: (email: string) => Promise<void>;
  onVerifyEmailCode: (challengeId: string, code: string) => Promise<void>;
  onReset: () => Promise<void>;
  /** Browser sign-ins that are switched on. None means the screen offers email only. */
  providers?: readonly CentralAuthProvider[];
  onSignInWithProvider?: (provider: CentralAuthProvider) => Promise<void>;
  onCancelProviderSignIn?: () => Promise<void>;
}

type PendingAction = "retry" | "send" | "check" | "verify" | "resend" | "reset" | "provider" | "cancel";

const PROVIDER_LABELS: Record<CentralAuthProvider, string> = { github: "GitHub", google: "Google" };
type LoginStep = "email" | "code";
type LoginTransition = "none" | "forward" | "back";

const FIELD_ISSUES = new Set([
  "invalid_email",
  "invalid_sign_in_code",
  "sign_in_code_expired",
  "too_many_code_attempts",
]);
const NEW_CODE_ISSUES = new Set(["sign_in_code_expired", "too_many_code_attempts"]);
const UNCERTAIN_EMAIL_DELIVERY_ISSUES = new Set([
  "email_delivery_pending",
  "email_delivery_timeout",
  "email_delivery_unknown",
]);

export function AccountLogin(props: AccountLoginProps) {
  const [email, setEmail] = createSignal("");
  const [code, setCode] = createSignal("");
  const [presentedEmailError, setPresentedEmailError] = createSignal<string | null>(null);
  const [emailErrorActive, setEmailErrorActive] = createSignal(false);
  const [emailShaking, setEmailShaking] = createSignal(false);
  const [codeError, setCodeError] = createSignal<string | null>(null);
  const [localError, setLocalError] = createSignal<string | null>(null);
  const [pendingAction, setPendingAction] = createSignal<PendingAction | null>(null);
  const [issueVisible, setIssueVisible] = createSignal(true);
  const [issueBlockedUntil, setIssueBlockedUntil] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [loginTransition, setLoginTransition] = createSignal<LoginTransition>("none");
  let emailInput: HTMLInputElement | undefined;
  let emailShakeTimer: number | undefined;
  let emailRevertTimer: number | undefined;
  let emailMessageTimer: number | undefined;

  onCleanup(clearEmailErrorTimers);

  // `now()` exists for the two countdowns below and nothing else, so the clock
  // runs only while one of them is on screen. Arming it at creation instead
  // woke the view once a second for its whole life, including the ordinary case
  // where there is nothing to count down.
  const countdownUntil = createMemo(() => {
    const resendAt = props.state.status === "code_sent" ? props.state.resendAvailableAt : 0;
    return Math.max(resendAt, issueBlockedUntil());
  });

  createEffect(
    () => countdownUntil(),
    (until) => {
      setNow(Date.now());
      if (until <= Date.now()) return;
      const clock = window.setInterval(() => {
        setNow(Date.now());
        // Stop at the deadline rather than wait for the next state change: the
        // label has reached zero and no later tick can change it.
        if (Date.now() >= until) window.clearInterval(clock);
      }, 1_000);
      return () => window.clearInterval(clock);
    },
  );

  const codeSent = () => props.state.status === "code_sent";
  const verified = () => props.state.status === "signed_in";
  const loginStep = (): LoginStep => (codeSent() || verified() ? "code" : "email");
  const challenge = () => (props.state.status === "code_sent" ? props.state : undefined);
  const connecting = () => props.state.status === "loading";
  const browserProvider = () =>
    props.state.status === "signing_in" && props.state.provider ? props.state.provider : undefined;
  /** Digits for a Supabase code; the account API's 8-character code otherwise. */
  const codeLength = () => challenge()?.codeLength;
  const currentIssue = (): CentralAuthIssue | undefined => {
    if (props.state.status === "error") return props.state.issue;
    return props.state.status === "code_sent" ? props.state.issue : undefined;
  };
  const displayedIssue = () => (issueVisible() ? currentIssue() : undefined);
  const unavailable = () => props.state.status === "error" && props.state.issue.code === "auth_api_unavailable";
  const unavailableIssue = () => (unavailable() && props.state.status === "error" ? props.state.issue : undefined);
  const codeNeedsReplacement = () => {
    const issue = currentIssue();
    return Boolean(issue && NEW_CODE_ISSUES.has(issue.code));
  };
  const resendAvailableIn = () => {
    if (props.state.status !== "code_sent") return 0;
    return secondsUntil(Math.max(props.state.resendAvailableAt, issueBlockedUntil()), now());
  };
  const emailRetryIn = () => {
    const issue = currentIssue();
    return issue?.retryAfterSeconds ? secondsUntil(issueBlockedUntil(), now()) : 0;
  };
  const emailDeliveryUncertain = () => {
    const issue = displayedIssue();
    return Boolean(issue && UNCERTAIN_EMAIL_DELIVERY_ISSUES.has(issue.code));
  };
  const emailSubmitLabel = () => {
    const retryIn = emailRetryIn();
    if (emailDeliveryUncertain()) return retryIn > 0 ? `Check again in ${formatTimer(retryIn)}` : "Check delivery";
    return retryIn > 0 ? `Try again in ${formatTimer(retryIn)}` : "Send sign-in code";
  };
  const emailBusy = () =>
    pendingAction() === "send" ||
    pendingAction() === "check" ||
    (props.state.status === "signing_in" && !browserProvider());
  const codeBusy = () => pendingAction() === "verify";
  const resendBusy = () => pendingAction() === "resend";
  const formIssue = createMemo(() => {
    const issue = displayedIssue();
    return issue && !FIELD_ISSUES.has(issue.code) ? issue : undefined;
  });
  const displayedCodeError = () => {
    const visibleIssue = displayedIssue();
    const issue = currentIssue();
    if (codeError()) return codeError();
    if (visibleIssue?.code === "invalid_sign_in_code") return visibleIssue.message;
    return issue && NEW_CODE_ISSUES.has(issue.code) ? issue.message : null;
  };
  const otpStatus = (): OtpInputStatus => {
    if (verified()) return "success";
    if (codeBusy()) return "verifying";
    if (displayedCodeError()) return "error";
    return "idle";
  };

  createEffect(
    () => loginStep(),
    (step, previousStep) => {
      if (!previousStep || step === previousStep) return;
      setLoginTransition(step === "code" ? "forward" : "back");
    },
  );

  createEffect(
    () => currentIssue(),
    (issue) => {
      setNow(Date.now());
      setIssueVisible(true);
      setIssueBlockedUntil(issue?.retryAfterSeconds ? Date.now() + issue.retryAfterSeconds * 1_000 : 0);
      if (issue?.code === "invalid_email") showEmailError(issue.message);
    },
  );

  createEffect(
    () => (props.state.status === "code_sent" ? props.state.challengeId : null),
    (challengeId, previousChallengeId) => {
      if (!challengeId) return;
      setNow(Date.now());
      if (!previousChallengeId || challengeId === previousChallengeId) return;
      setCode("");
      setCodeError(null);
    },
  );

  createEffect(
    () => props.state.status,
    (status, previousStatus) => {
      if (status === previousStatus) return;
      if (status === "signed_out" || (status === "error" && !unavailable())) {
        queueMicrotask(() => emailInput?.focus());
      }
    },
  );

  function validateEmail(value: string): string | null {
    if (!value.trim()) return "Enter your email address.";
    return normalizeEmailAddress(value) ? null : "Enter a valid email address.";
  }

  function clearEmailErrorTimers(): void {
    if (emailShakeTimer !== undefined) window.clearTimeout(emailShakeTimer);
    if (emailRevertTimer !== undefined) window.clearTimeout(emailRevertTimer);
    if (emailMessageTimer !== undefined) window.clearTimeout(emailMessageTimer);
    emailShakeTimer = undefined;
    emailRevertTimer = undefined;
    emailMessageTimer = undefined;
  }

  function motionDuration(name: string, fallback: number): number {
    const value = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function hideEmailError(): void {
    clearEmailErrorTimers();
    setEmailErrorActive(false);
    setEmailShaking(false);
    emailMessageTimer = window.setTimeout(
      () => {
        emailMessageTimer = undefined;
        setPresentedEmailError(null);
      },
      motionDuration("--revert-dur", 280),
    );
  }

  function showEmailError(message: string): void {
    clearEmailErrorTimers();
    setPresentedEmailError(message);
    setEmailErrorActive(true);

    setEmailShaking(false);
    if (emailInput) void emailInput.offsetWidth;
    setEmailShaking(true);

    const shakeDuration = motionDuration("--shake-dur-a", 80) * 2 + motionDuration("--shake-dur-b", 60) * 2;
    emailShakeTimer = window.setTimeout(() => {
      emailShakeTimer = undefined;
      setEmailShaking(false);
    }, shakeDuration + 20);

    emailRevertTimer = window.setTimeout(() => {
      emailRevertTimer = undefined;
      setEmailErrorActive(false);
      emailMessageTimer = window.setTimeout(
        () => {
          emailMessageTimer = undefined;
          setPresentedEmailError(null);
        },
        motionDuration("--revert-dur", 280),
      );
    }, shakeDuration + motionDuration("--revert-hold", 3_000));
  }

  function handleEmailInput(value: string): void {
    setEmail(value);
    setIssueVisible(false);
    setLocalError(null);
    hideEmailError();
  }

  function handleCodeInput(value: string): void {
    setCode(value);
    setIssueVisible(false);
    setLocalError(null);
    setCodeError(null);
  }

  async function submitEmail(): Promise<void> {
    if (pendingAction() || emailBusy() || emailRetryIn() > 0) return;
    const validationError = validateEmail(email());
    if (validationError) {
      showEmailError(validationError);
      emailInput?.focus();
      return;
    }
    const normalizedEmail = normalizeEmailAddress(email());
    if (!normalizedEmail) return;
    const action: PendingAction = emailDeliveryUncertain() ? "check" : "send";
    setEmail(normalizedEmail);
    setIssueVisible(false);
    setLocalError(null);
    setPendingAction(action);
    try {
      await props.onRequestEmailCode(normalizedEmail);
    } catch {
      setLocalError("Something went wrong while sending the code. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function submitCode(value = code()): Promise<void> {
    if (props.state.status !== "code_sent" || pendingAction() || codeBusy() || codeNeedsReplacement()) return;
    const digits = codeLength();
    const numericCode = value.replace(/\D/gu, "");
    const normalizedCode = digits ? (numericCode.length === digits ? numericCode : null) : normalizeOneTimeCode(value);
    if (!normalizedCode) {
      setCodeError(digits ? `Enter the full ${digits}-digit code.` : "Enter the full 8-character code.");
      return;
    }
    setCodeError(null);
    setIssueVisible(false);
    setLocalError(null);
    setPendingAction("verify");
    try {
      await props.onVerifyEmailCode(props.state.challengeId, digits ? normalizedCode : formatCode(normalizedCode));
    } catch {
      setLocalError("Something went wrong while verifying the code. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function resendCode(): Promise<void> {
    if (props.state.status !== "code_sent" || pendingAction() || resendBusy() || resendAvailableIn() > 0) return;
    setIssueVisible(false);
    setLocalError(null);
    setPendingAction("resend");
    try {
      await props.onRequestEmailCode(props.state.email);
    } catch {
      setLocalError("Something went wrong while sending a new code. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function startProviderSignIn(provider: CentralAuthProvider): Promise<void> {
    if (pendingAction() || !props.onSignInWithProvider) return;
    setIssueVisible(false);
    setLocalError(null);
    setPendingAction("provider");
    try {
      await props.onSignInWithProvider(provider);
    } catch {
      setLocalError(`Dani-Dex couldn’t start ${PROVIDER_LABELS[provider]} sign-in. Try again.`);
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelProviderSignIn(): Promise<void> {
    if (pendingAction() || !props.onCancelProviderSignIn) return;
    setPendingAction("cancel");
    try {
      await props.onCancelProviderSignIn();
    } catch {
      setLocalError("Dani-Dex couldn’t cancel sign in. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function retryConnection(): Promise<void> {
    if (pendingAction()) return;
    setPendingAction("retry");
    setLocalError(null);
    try {
      await props.onRetry();
    } catch {
      setLocalError("Dani-Dex still can’t reach the account service.");
    } finally {
      setPendingAction(null);
    }
  }

  async function resetEmail(): Promise<void> {
    if (pendingAction()) return;
    setPendingAction("reset");
    setLocalError(null);
    try {
      await props.onReset();
      setCode("");
      setCodeError(null);
      setIssueVisible(false);
    } catch {
      setLocalError("Dani-Dex couldn’t restart sign in. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main class="account-login-screen">
      <div class="account-login-shell">
        <header class="account-login-brand-lockup">
          <AppLogo variant={props.variant} animation="blink" interactive class="account-login-logo" />
          <span class="account-login-wordmark">Dani-Dex</span>
        </header>

        <section
          class="account-login"
          data-step={loginStep()}
          data-transition={loginTransition()}
          aria-labelledby="account-login-title"
          aria-describedby="account-login-description"
        >
          <h1 id="account-login-title" class="account-login-title">
            {connecting()
              ? "Connecting to Dani-Dex"
              : browserProvider()
                ? "Continue in your browser"
                : unavailable()
                  ? "Service unavailable"
                  : verified()
                    ? "You’re signed in"
                    : codeSent()
                      ? "Check your inbox"
                      : "Sign in to Dani-Dex"}
          </h1>
          <p id="account-login-description" class="account-login-description">
            <Show
              when={challenge() || verified()}
              fallback={
                connecting()
                  ? "Starting the account service. This usually takes a moment."
                  : browserProvider()
                    ? `Finish signing in with ${PROVIDER_LABELS[browserProvider() ?? "github"]} in your browser. Dani-Dex opens again when you’re done.`
                    : unavailable()
                      ? (currentIssue()?.message ?? "Dani-Dex can’t reach the account service right now.")
                      : "We’ll email you a one-time code."
              }
            >
              {verified() ? (
                "Your code was accepted."
              ) : (
                <>
                  We sent a code to <strong>{challenge()?.email}</strong>.
                </>
              )}
            </Show>
          </p>

          <Show when={connecting()}>
            <div class="account-login-loader" role="status" aria-live="polite">
              <span class="account-login-spinner" aria-hidden="true" />
              <span>Connecting securely…</span>
            </div>
          </Show>

          <Show when={unavailableIssue()}>
            <Show when={localError()}>
              {(message) => (
                <p class="account-login-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Button
              variant="default"
              type="button"
              class="account-login-primary"
              disabled={pendingAction() === "retry"}
              onClick={() => void retryConnection()}
            >
              <Show when={pendingAction() === "retry"} fallback="Try again">
                <span class="account-login-button-spinner" aria-hidden="true" />
                Connecting…
              </Show>
            </Button>
          </Show>

          <Show when={browserProvider()}>
            <div class="account-login-loader" role="status" aria-live="polite">
              <span class="account-login-spinner" aria-hidden="true" />
              <span>Waiting for {PROVIDER_LABELS[browserProvider() ?? "github"]}…</span>
            </div>
            <Show when={localError()}>
              {(message) => (
                <p class="account-login-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Button
              variant="ghost"
              type="button"
              class="account-login-primary"
              disabled={pendingAction() !== null}
              onClick={() => void cancelProviderSignIn()}
            >
              Cancel
            </Button>
          </Show>

          <Show when={!connecting() && !unavailable() && !browserProvider()}>
            <Show
              when={challenge() || verified()}
              fallback={
                <form
                  class="account-login-form"
                  data-auth-panel="email"
                  aria-busy={emailBusy() ? "true" : "false"}
                  novalidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitEmail();
                  }}
                >
                  <label class="sr-only" for="account-email">
                    Email
                  </label>
                  <div class={`account-login-email-field t-input-wrap${emailErrorActive() ? " is-error" : ""}`}>
                    <Input
                      ref={(element) => (emailInput = element)}
                      class={`t-input${emailErrorActive() ? " is-error" : ""}${emailShaking() ? " is-shaking" : ""}`}
                      id="account-email"
                      type="email"
                      autocomplete="email"
                      autocapitalize="none"
                      inputmode="email"
                      spellcheck={false}
                      placeholder="you@example.com"
                      maxlength={INPUT_LIMITS.email}
                      value={email()}
                      aria-invalid={emailErrorActive() ? "true" : undefined}
                      aria-describedby={emailErrorActive() ? "account-email-error" : undefined}
                      autofocus
                      onBlur={() => {
                        const validationError = validateEmail(email());
                        if (validationError) showEmailError(validationError);
                        else hideEmailError();
                      }}
                      onValueChange={handleEmailInput}
                    />
                    <p
                      id="account-email-error"
                      class="account-login-field-error t-error-msg"
                      role="alert"
                      aria-hidden={emailErrorActive() ? undefined : "true"}
                    >
                      {presentedEmailError()}
                    </p>
                  </div>

                  <Show when={formIssue()}>
                    {(issue) => (
                      <p class="account-login-error" role="alert">
                        {issue().message}
                      </p>
                    )}
                  </Show>
                  <Show when={localError()}>
                    {(message) => (
                      <p class="account-login-error" role="alert">
                        {message()}
                      </p>
                    )}
                  </Show>

                  <Button
                    variant="default"
                    type="submit"
                    class="account-login-primary"
                    disabled={emailBusy() || !email().trim() || emailRetryIn() > 0}
                  >
                    <Show when={emailBusy()} fallback={emailSubmitLabel()}>
                      <span class="account-login-button-spinner" aria-hidden="true" />
                      {pendingAction() === "check" ? "Checking delivery…" : "Sending code…"}
                    </Show>
                  </Button>

                  <Show when={(props.providers ?? []).length > 0 && props.onSignInWithProvider}>
                    <div class="account-login-divider" aria-hidden="true">
                      <span>or</span>
                    </div>
                    <For each={props.providers ?? []}>
                      {(provider) => (
                        <Button
                          variant="outline"
                          type="button"
                          class="account-login-provider"
                          data-provider={provider}
                          disabled={pendingAction() !== null || emailBusy()}
                          onClick={() => void startProviderSignIn(provider)}
                        >
                          Continue with {PROVIDER_LABELS[provider]}
                        </Button>
                      )}
                    </For>
                  </Show>
                </form>
              }
            >
              <div
                class="account-login-form"
                data-auth-panel="code"
                aria-busy={codeBusy() || resendBusy() ? "true" : "false"}
              >
                <OtpInput
                  value={code()}
                  length={codeLength()}
                  numeric={codeLength() !== undefined}
                  status={otpStatus()}
                  hint={
                    codeLength()
                      ? `Enter the ${codeLength()}-digit code, or open the link in the same email.`
                      : "Enter all 8 characters to continue."
                  }
                  errorMessage={displayedCodeError()}
                  successMessage="Verified. Opening Dani-Dex…"
                  disabled={codeNeedsReplacement() || resendBusy()}
                  autofocus
                  onChange={handleCodeInput}
                  onComplete={(value) => void submitCode(value)}
                />

                <Show when={challenge()?.developmentCode}>
                  {(developmentCode) => (
                    <p class="account-login-development-code">Development code: {developmentCode()}</p>
                  )}
                </Show>
                <Show when={formIssue()}>
                  {(issue) => (
                    <p class="account-login-error" role="alert">
                      {issue().message}
                    </p>
                  )}
                </Show>
                <Show when={localError()}>
                  {(message) => (
                    <p class="account-login-error" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>

                <Show when={!verified()}>
                  <Show when={codeNeedsReplacement()}>
                    <Button
                      variant="default"
                      type="button"
                      class="account-login-primary"
                      disabled={pendingAction() !== null || resendAvailableIn() > 0}
                      onClick={() => void resendCode()}
                    >
                      <Show
                        when={resendBusy()}
                        fallback={
                          resendAvailableIn() > 0
                            ? `Send a new code in ${formatTimer(resendAvailableIn())}`
                            : "Send a new code"
                        }
                      >
                        <span class="account-login-button-spinner" aria-hidden="true" />
                        Sending new code…
                      </Show>
                    </Button>
                  </Show>

                  <div class="account-login-code-actions">
                    <Button
                      type="button"
                      class="account-login-code-action account-login-code-action-change"
                      variant="ghost"
                      size="sm"
                      disabled={pendingAction() !== null}
                      onClick={() => void resetEmail()}
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                      Change email
                    </Button>
                    <Show when={!codeNeedsReplacement()}>
                      <Button
                        type="button"
                        class="account-login-code-action account-login-code-action-resend"
                        variant="ghost"
                        size="sm"
                        disabled={pendingAction() !== null || resendAvailableIn() > 0}
                        loading={resendBusy()}
                        loadingLabel="Sending…"
                        onClick={() => void resendCode()}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        {resendAvailableIn() > 0 ? `Resend in ${formatTimer(resendAvailableIn())}` : "Resend code"}
                      </Button>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
          </Show>
        </section>
      </div>
    </main>
  );
}

function formatCode(value: string): string {
  const compact = normalizeOneTimeCode(value) ?? value.replaceAll("-", "");
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function secondsUntil(timestamp: number, now: number): number {
  return Math.max(0, Math.ceil((timestamp - now) / 1_000));
}

function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
