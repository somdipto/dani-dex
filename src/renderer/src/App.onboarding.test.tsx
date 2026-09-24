import type { AgentStatus } from "@dani-dex/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { emitAgentEvent, emitAuth, emitInvite, installDanidexStub, trackAnalytics } from "./app-test-harness";
import { setSignInRequiredForTesting } from "./features/account/sign-in-gate";

// Sign-in is switched off in the product for now. These tests switch it back on so the sign-in screen
// stays covered until it returns. `App.sign-in-off.test.tsx` covers the app as shipped.

/** A model of a custom endpoint, which only the first-run flow can choose. */
const CUSTOM_ENDPOINT_MODEL = "opencode/local-studio/qwen3-coder";

describe("Dani-Dex connected desktop shell", () => {
  beforeEach(() => {
    installDanidexStub();
    setSignInRequiredForTesting(true);
  });

  afterEach(() => {
    setSignInRequiredForTesting(null);
  });

  it("shows the first-run onboarding before starting agents", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Meet Dani-Dex" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where will Dani-Dex run?" })).not.toBeInTheDocument();
    expect(screen.queryByText("Verified. Opening Dani-Dex…")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Chief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    const providers = screen.getByRole("radiogroup", { name: "Default provider" });
    const codex = within(providers).getByRole("radio", { name: /ChatGPT.*Connected/ });
    expect(codex).toBeChecked();
    await fireEvent.click(within(providers).getByRole("radio", { name: /Claude.*Connected/ }));
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await fireEvent.click(screen.getByRole("button", { name: "Open Dani-Dex" }));
    expect(window.danidex.saveSetup).toHaveBeenCalledWith({ preferredProvider: "claude", preferredModel: null });
    expect(await screen.findByRole("heading", { name: "Chief" })).toBeInTheDocument();
  });

  it("connects each bundled provider independently and Refresh re-verifies every connection", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    const disconnectedStatus: AgentStatus = {
      phase: "blocked",
      cliVersion: null,
      auth: { kind: "unknown" },
      providers: [
        { id: "codex", state: "sign-in-required", version: "0.149.1", message: null },
        { id: "claude", state: "sign-in-required", version: "2.1.246", message: null },
        { id: "grok", state: "sign-in-required", version: "1.0.5", message: null },
      ],
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: null,
      fullAccess: true,
    };
    vi.mocked(window.danidex.agent.getStatus).mockResolvedValueOnce(disconnectedStatus);
    // One channel for all three, so the mock has to remember which providers it has already been
    // asked for: each call marks its own provider connecting and leaves the earlier ones connecting.
    const connecting = new Set<string>();
    vi.mocked(window.danidex.connectProvider).mockImplementation(async (provider) => {
      connecting.add(provider);
      return {
        ...disconnectedStatus,
        providers: disconnectedStatus.providers?.map((entry) =>
          connecting.has(entry.id) ? { ...entry, connectionState: "connecting" as const } : entry,
        ),
      };
    });
    vi.mocked(window.danidex.refreshAgentProviders).mockResolvedValueOnce({
      ...disconnectedStatus,
      phase: "ready",
      providers: [
        {
          id: "codex",
          state: "available",
          version: "0.149.1",
          message: null,
          email: "norbert@example.com",
          checkError: "Could not verify ChatGPT. Keeping the existing connection.",
        },
        { id: "claude", state: "available", version: "2.1.246", message: null, email: "claude@example.com" },
      ],
    });
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Connect Grok" }));
    expect(window.danidex.connectProvider).toHaveBeenCalledWith("grok");
    expect(screen.getByRole("button", { name: "Restart Grok" })).toBeEnabled();
    await fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
    await fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
    expect(screen.getByRole("button", { name: "Restart ChatGPT" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restart Claude" })).toBeEnabled();
    expect(window.danidex.connectProvider).toHaveBeenCalledWith("codex");
    expect(window.danidex.connectProvider).toHaveBeenCalledWith("claude");
    expect(trackAnalytics).toHaveBeenCalledWith("provider_action", {
      provider: "codex",
      action: "connect_started",
      result: "succeeded",
    });
    expect(trackAnalytics).toHaveBeenCalledWith("provider_action", {
      provider: "claude",
      action: "connect_started",
      result: "succeeded",
    });

    await fireEvent.click(screen.getByRole("button", { name: "Restart ChatGPT" }));
    expect(window.danidex.connectProvider).toHaveBeenCalledTimes(4);
    emitAgentEvent?.({
      type: "status",
      status: {
        ...disconnectedStatus,
        phase: "ready",
        providers: [
          {
            id: "codex",
            state: "sign-in-required",
            version: "0.149.1",
            message: "ChatGPT connection was not completed. Try again.",
          },
          {
            id: "claude",
            state: "available",
            version: "2.1.246",
            message: null,
            email: "claude@example.com",
          },
        ],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("ChatGPT connection was not completed. Try again.");
    expect(trackAnalytics).toHaveBeenCalledWith("provider_action", {
      provider: "claude",
      action: "connect_completed",
      result: "succeeded",
    });
    await fireEvent.click(screen.getByRole("button", { name: "Refresh providers" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reconnect ChatGPT" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Reconnect Claude" })).toBeEnabled();
    expect(screen.queryByText("ChatGPT connection was not completed. Try again.")).not.toBeInTheDocument();
    expect(screen.getByText("Could not verify ChatGPT. Keeping the existing connection.")).toBeVisible();
  });

  it("refreshes provider detection and opens the matching sign-in guide", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    vi.mocked(window.danidex.agent.getStatus).mockResolvedValueOnce({
      phase: "blocked",
      cliVersion: null,
      auth: { kind: "unknown" },
      providers: [
        { id: "codex", state: "sign-in-required", version: "0.149.1", message: "Connect ChatGPT." },
        { id: "claude", state: "sign-in-required", version: "2.1.246", message: "Sign in to Claude." },
      ],
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Install a provider.",
      fullAccess: true,
    });
    let finishRefresh: ((status: AgentStatus) => void) | undefined;
    vi.mocked(window.danidex.refreshAgentProviders).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
    );
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Refresh providers" }));
    expect(screen.getByRole("button", { name: "Checking providers" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Install / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    expect(finishRefresh).toBeTypeOf("function");
    finishRefresh?.({
      phase: "ready",
      cliVersion: "2.1.231",
      auth: { kind: "claude", email: "claude@example.com" },
      providers: [
        { id: "codex", state: "sign-in-required", version: "0.144.1", message: "Sign in to ChatGPT." },
        {
          id: "claude",
          state: "available",
          version: "2.1.231",
          message: null,
          email: "claude@example.com",
        },
      ],
      capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
      message: null,
      fullAccess: true,
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeEnabled());
    expect(
      within(screen.getByRole("radiogroup", { name: "Default provider" })).getByRole("radio", { name: /Claude/ }),
    ).toBeChecked();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    const connectChatGPT = screen.getByRole("button", { name: "Connect ChatGPT" });
    await fireEvent.click(connectChatGPT);
    expect(window.danidex.connectProvider).toHaveBeenCalledWith("codex");
    expect(screen.getByRole("button", { name: "Restart ChatGPT" })).toBeEnabled();
  });

  it("shows a friendly inline error when a provider guide cannot open", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    vi.mocked(window.danidex.agent.getStatus).mockResolvedValueOnce({
      phase: "blocked",
      cliVersion: null,
      auth: { kind: "unknown" },
      providers: [
        { id: "codex", state: "sign-in-required", version: "0.149.1", message: "Connect ChatGPT." },
        { id: "claude", state: "sign-in-required", version: "2.1.246", message: "Sign in to Claude." },
      ],
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Install a provider.",
      fullAccess: true,
    });
    vi.mocked(window.danidex.connectProvider).mockRejectedValueOnce(new Error("Raw IPC failure"));
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Connect ChatGPT" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Dani-Dex could not connect ChatGPT. Try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Raw IPC failure");
    expect(trackAnalytics).toHaveBeenCalledWith("provider_action", {
      provider: "codex",
      action: "connect_started",
      result: "succeeded",
    });
    expect(trackAnalytics).toHaveBeenCalledWith("provider_action", {
      provider: "codex",
      action: "connect_completed",
      result: "failed",
      failure_code: "connect_failed",
    });
  });

  it("shows a native ChatGPT login failure reported after the browser opens", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    vi.mocked(window.danidex.agent.getStatus).mockResolvedValueOnce({
      phase: "blocked",
      cliVersion: null,
      auth: { kind: "unknown" },
      providers: [
        { id: "codex", state: "sign-in-required", version: "0.149.1", message: "Connect ChatGPT." },
        { id: "claude", state: "sign-in-required", version: "2.1.246", message: "Sign in to Claude." },
      ],
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Connect ChatGPT.",
      fullAccess: true,
    });
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Connect ChatGPT" }));
    expect(screen.getByRole("button", { name: "Restart ChatGPT" })).toBeEnabled();

    emitAgentEvent?.({
      type: "status",
      status: {
        phase: "blocked",
        cliVersion: null,
        auth: { kind: "unknown" },
        providers: [
          {
            id: "codex",
            state: "sign-in-required",
            version: "0.149.1",
            message: "ChatGPT connection timed out. Try again.",
          },
          { id: "claude", state: "sign-in-required", version: "2.1.246", message: "Sign in to Claude." },
        ],
        capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
        message: "ChatGPT connection timed out. Try again.",
        fullAccess: true,
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("ChatGPT connection timed out. Try again.");
    expect(screen.getByRole("button", { name: "Connect ChatGPT" })).toBeEnabled();
  });

  it("connects to a remote host after account sign-in", async () => {
    const inviteUrl = "https://dani-dex.example/join?invite=test";
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    vi.mocked(window.danidex.servers.takePendingInvite).mockResolvedValueOnce(inviteUrl);
    render(() => <App />);

    expect(await screen.findByRole("dialog", { name: "Connect to a host" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();

    expect(screen.getAllByText(/person@example.com/).length).toBeGreaterThan(0);
    expect(await screen.findByText("Studio Mac")).toBeInTheDocument();
    await waitFor(() => expect(window.danidex.servers.previewInvite).toHaveBeenCalledWith({ inviteUrl }));
    expect(window.danidex.servers.join).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Connect to host" }));

    await waitFor(() =>
      expect(window.danidex.servers.join).toHaveBeenCalledWith({
        inviteUrl,
      }),
    );
    await waitFor(() =>
      expect(window.danidex.saveSetup).toHaveBeenCalledWith({ preferredProvider: "codex", preferredModel: null }),
    );
    expect(trackAnalytics).toHaveBeenCalledWith("team_action", {
      action: "server_joined",
      result: "succeeded",
      entry_point: "invite_deep_link",
    });
    expect(trackAnalytics).not.toHaveBeenCalledWith(
      "team_action",
      expect.objectContaining({ action: "server_selected" }),
    );
  });

  it("opens a verified invitation received while the configured app is running", async () => {
    const inviteUrl = "https://dani-dex.example/join?invite=second-instance";
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    emitInvite?.(inviteUrl);

    expect(await screen.findByRole("dialog", { name: "Studio Mac" })).toBeInTheDocument();
    await waitFor(() => expect(window.danidex.servers.previewInvite).toHaveBeenCalledWith({ inviteUrl }));
    expect(window.danidex.servers.join).not.toHaveBeenCalled();
  });

  it("lets a user request an email code from the initial screen", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: false,
      preferredProvider: null,
      preferredModel: null,
    });
    vi.mocked(window.danidex.auth.getState).mockResolvedValueOnce({ status: "signed_out" });
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Sign in to Dani-Dex" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Default provider" })).not.toBeInTheDocument();
    expect(window.danidex.agent.listConversationReads).not.toHaveBeenCalled();

    // Read state belongs to this computer, not a Dani-Dex account, so it refreshes while signed out.
    emitAgentEvent?.({ type: "conversation-invalidated", agentId: "chief", revision: 1 });
    await waitFor(() => expect(window.danidex.agent.listConversationReads).toHaveBeenCalledTimes(1));

    await fireEvent.input(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "person@example.com" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(window.danidex.auth.requestEmailCode).toHaveBeenCalledWith("person@example.com");
    await fireEvent.input(await screen.findByRole("textbox", { name: "One-time code" }), {
      target: { value: "ABCD-EFGH" },
    });
    expect(window.danidex.auth.verifyEmailCode).toHaveBeenCalledWith("challenge-1", "ABCD-EFGH");
    expect(trackAnalytics).toHaveBeenCalledWith("account_sign_in_started", { result: "code_sent" });
    expect(trackAnalytics).toHaveBeenCalledWith("account_sign_in_completed", { result: "succeeded" });
    expect(await screen.findByText("Verified. Opening Dani-Dex…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where will Dani-Dex run?" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Meet Dani-Dex" })).toBeInTheDocument();
  });

  it("shows a soft loader until the account API becomes available", async () => {
    vi.mocked(window.danidex.auth.getState).mockResolvedValueOnce({ status: "loading" });
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Connecting to Dani-Dex" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting securely…");
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();

    emitAuth?.({ status: "signed_out" });
    expect(await screen.findByRole("heading", { name: "Sign in to Dani-Dex" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
  });

  it("keeps a cold-start invitation until a signed-out user signs in", async () => {
    const inviteUrl = "https://dani-dex.example/join?invite=after-sign-in";
    vi.mocked(window.danidex.auth.getState).mockResolvedValueOnce({ status: "signed_out" });
    vi.mocked(window.danidex.servers.takePendingInvite).mockResolvedValueOnce(inviteUrl);
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Sign in to Dani-Dex" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Chief" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Join a server" })).not.toBeInTheDocument();

    emitAuth?.({
      status: "signed_in",
      user: { id: "user-1", email: "person@example.com", name: null, avatarUrl: null },
    });

    expect(await screen.findByRole("dialog", { name: "Studio Mac" })).toBeInTheDocument();
    await waitFor(() => expect(window.danidex.servers.previewInvite).toHaveBeenCalledWith({ inviteUrl }));
  });

  it("saves a different default provider from the account menu and drops its model", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: true,
      preferredProvider: "codex",
      preferredModel: CUSTOM_ENDPOINT_MODEL,
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(await screen.findByRole("button", { name: "Open account actions" }));
    await fireEvent.click(screen.getByRole("button", { name: "Providers & permissions" }));

    await screen.findByRole("dialog", { name: "Providers & permissions" });
    const providers = screen.getByRole("radiogroup", { name: "Default provider" });
    await fireEvent.click(within(providers).getByRole("radio", { name: /Claude.*Connected/ }));
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    // The model belongs to the provider that was replaced, so this save must clear it.
    expect(window.danidex.saveSetup).toHaveBeenLastCalledWith({ preferredProvider: "claude", preferredModel: null });
    expect(screen.queryByRole("dialog", { name: "Providers & permissions" })).not.toBeInTheDocument();
  });

  it("keeps the chosen model when the account menu review leaves the provider alone", async () => {
    vi.mocked(window.danidex.getSetupState).mockResolvedValueOnce({
      completed: true,
      preferredProvider: "codex",
      preferredModel: CUSTOM_ENDPOINT_MODEL,
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(await screen.findByRole("button", { name: "Open account actions" }));
    await fireEvent.click(screen.getByRole("button", { name: "Providers & permissions" }));

    await screen.findByRole("dialog", { name: "Providers & permissions" });
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // The review screen names a provider alone. It must not send the agents to a hosted model when
    // the user chose a local endpoint during onboarding.
    expect(window.danidex.saveSetup).toHaveBeenLastCalledWith({
      preferredProvider: "codex",
      preferredModel: CUSTOM_ENDPOINT_MODEL,
    });
  });

  it("opens the required first-agent setup for a new user", async () => {
    vi.mocked(window.danidex.agent.listAgents).mockResolvedValueOnce([]);
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Create your first agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create agent" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(window.danidex.agent.createAgent).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await waitFor(() =>
      expect(window.danidex.agent.createAgent).toHaveBeenCalledWith({
        name: "New agent",
        description: "General-purpose assistant",
        initialMessage: "Greet me briefly.",
        avatarSeed: expect.any(String),
        avatarHue: null,
        provider: "codex",
        model: "gpt-5.6-luna",
      }),
    );
    expect(await screen.findByRole("heading", { name: "New agent" })).toBeInTheDocument();
  });

  it("blocks chat for signed-out users", async () => {
    vi.mocked(window.danidex.agent.getStatus).mockResolvedValueOnce({
      phase: "blocked",
      cliVersion: "0.144.1",
      auth: { kind: "signed-out" },
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Run `codex login`, then restart Dani-Dex.",
      fullAccess: true,
    });
    render(() => <App />);

    await waitFor(() => expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "false"));
    expect(screen.queryByRole("listbox", { name: /helping with most/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Agent CLI setup required")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setup guide" })).not.toBeInTheDocument();
  });
});
