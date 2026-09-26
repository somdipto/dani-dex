import type { VoiceModelStatus } from "@dani-dex/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { emitAgentEvent, installDanidexStub, installVoiceRecordingMocks, testServer } from "./app-test-harness";

describe("Dani-Dex connected desktop shell", () => {
  beforeEach(() => {
    installDanidexStub();
  });

  it("explains blocked microphone access, then records and offers the send arrow", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(
      await screen.findByText("Microphone access is blocked. Allow Dani-Dex to use the microphone in system settings."),
    ).toBeInTheDocument();

    installVoiceRecordingMocks();
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: "turn-active",
        revision: 2,
        messages: [],
      },
    });
    await screen.findByRole("button", { name: "Stop agent" });

    await fireEvent.click(screen.getByRole("button", { name: "Create prompt with voice" }));

    const status = await screen.findByRole("group", { name: "Voice recording" });
    expect(within(status).getByText("0:00")).toBeVisible();
    expect(within(status).getByRole("button", { name: "Stop voice recording" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create prompt with voice" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send voice message" })).toBeInTheDocument();
  });

  it("downloads the voice model before it requests microphone access", async () => {
    let resolvePreparation: ((status: VoiceModelStatus) => void) | undefined;
    let reportModelStatus: ((status: VoiceModelStatus) => void) | undefined;
    vi.mocked(window.danidex.voice.prepareModel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    vi.mocked(window.danidex.voice.onModelStatus).mockImplementationOnce((listener) => {
      reportModelStatus = listener;
      return () => undefined;
    });
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    reportModelStatus?.({ phase: "downloading", progress: 47, message: null });
    await waitFor(() => {
      expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("47%"))).toBe(true);
    });

    resolvePreparation?.({ phase: "ready", progress: 100, message: null });
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
  });

  it("shows a deferred voice setup error in the original conversation", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolvePreparation: ((status: VoiceModelStatus) => void) | undefined;
    vi.mocked(window.danidex.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.danidex.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    vi.mocked(window.danidex.voice.prepareModel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    await waitFor(() => expect(window.danidex.voice.prepareModel).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );

    resolvePreparation?.({ phase: "error", progress: 0, message: "Local voice setup failed" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create prompt with voice" })).toBeEnabled());
    expect(screen.queryByText("Local voice setup failed")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Local server" }));
    expect(await screen.findByText("Local voice setup failed")).toBeInTheDocument();
  });

  it("does not open the microphone for a conversation the user has left", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolvePreparation: ((status: VoiceModelStatus) => void) | undefined;
    vi.mocked(window.danidex.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.danidex.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    vi.mocked(window.danidex.voice.prepareModel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    await waitFor(() => expect(window.danidex.voice.prepareModel).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );

    // The download the user walked away from is not the arriving conversation's
    // problem: it is not told about a model it never asked for, and it can
    // dictate straight away. The preparation is still unresolved at this point,
    // and it may never resolve.
    expect(screen.queryByRole("button", { name: "Downloading voice model" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create prompt with voice" })).toBeEnabled());

    resolvePreparation?.({ phase: "ready", progress: 100, message: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create prompt with voice" })).toBeEnabled());
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("stops offering a recording the user walked away from", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveTranscription: ((result: { text: string }) => void) | undefined;
    vi.mocked(window.danidex.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.danidex.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    vi.mocked(window.danidex.voice.transcribe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        }),
    );
    installVoiceRecordingMocks();
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    await screen.findByRole("group", { name: "Voice recording" });
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(window.danidex.voice.transcribe).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: "Local server" }));

    const composer = await screen.findByRole("textbox", { name: "Message Chief" });
    expect(composer).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Stop voice recording" })).not.toBeInTheDocument();

    resolveTranscription?.({ text: "Walked away" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create prompt with voice" })).toBeEnabled());
  });

  it("submits the accepted voice snapshot and preserves later draft changes", async () => {
    let resolveTranscription: ((result: { text: string }) => void) | undefined;
    vi.mocked(window.danidex.voice.transcribe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        }),
    );
    installVoiceRecordingMocks();
    render(() => <App />);

    const composer = await screen.findByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Existing draft";
    await fireEvent.input(composer);
    await fireEvent.click(screen.getByRole("button", { name: "Create prompt with voice" }));
    await screen.findByRole("group", { name: "Voice recording" });
    await fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(window.danidex.voice.transcribe).toHaveBeenCalledOnce());

    expect(composer).toHaveAttribute("aria-disabled", "true");
    await fireEvent.keyDown(composer, { key: "Enter" });
    expect(window.danidex.agent.sendMessage).not.toHaveBeenCalled();
    composer.textContent = "Later draft";
    await fireEvent.input(composer);

    resolveTranscription?.({ text: "Voice transcript" });
    await waitFor(() =>
      expect(window.danidex.agent.sendMessage).toHaveBeenCalledWith(
        { agentId: "chief", text: "Existing draft Voice transcript", attachmentDraftIds: [] },
        "local",
      ),
    );
    expect(window.danidex.agent.sendMessage).toHaveBeenCalledOnce();
    await waitFor(() => expect(composer).toHaveTextContent("Later draft"));
  });

  it("keeps a deferred transcript and its failure with the chat that started them", async () => {
    let resolveTranscription: ((result: { text: string }) => void) | undefined;
    let rejectTranscription: ((error: Error) => void) | undefined;
    vi.mocked(window.danidex.voice.transcribe)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTranscription = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectTranscription = reject;
          }),
      );
    installVoiceRecordingMocks();
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    const recording = await screen.findByRole("group", { name: "Voice recording" });
    await fireEvent.click(within(recording).getByRole("button", { name: "Stop voice recording" }));
    await waitFor(() => expect(window.danidex.voice.transcribe).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));

    resolveTranscription?.({ text: "Draft for Chief" });
    await screen.findByRole("button", { name: "Create prompt with voice" });
    expect(window.danidex.agent.sendMessage).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Message Chief" })).toHaveTextContent("Draft for Chief"),
    );

    await fireEvent.click(screen.getByRole("button", { name: "Create prompt with voice" }));
    await screen.findByRole("group", { name: "Voice recording" });
    await fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(window.danidex.voice.transcribe).toHaveBeenCalledTimes(2));
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));

    rejectTranscription?.(new Error("Transcription failed"));
    await screen.findByRole("button", { name: "Create prompt with voice" });
    expect(screen.queryByText("Transcription failed")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Transcription failed");
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.queryByText("Transcription failed")).not.toBeInTheDocument());
  });

  it("finishes an accepted voice send on the original server after the server changes", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveTranscription: ((result: { text: string }) => void) | undefined;
    vi.mocked(window.danidex.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.danidex.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    vi.mocked(window.danidex.voice.transcribe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        }),
    );
    installVoiceRecordingMocks();
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    await screen.findByRole("group", { name: "Voice recording" });
    await fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(window.danidex.voice.transcribe).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );

    resolveTranscription?.({ text: "Message for local Chief" });
    await waitFor(() =>
      expect(window.danidex.agent.sendMessage).toHaveBeenCalledWith(
        {
          agentId: "chief",
          text: "Message for local Chief",
          attachmentDraftIds: [],
        },
        "local",
      ),
    );
  });

  it("shows a deferred send error on the original server", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveTranscription: ((result: { text: string }) => void) | undefined;
    vi.mocked(window.danidex.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.danidex.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    vi.mocked(window.danidex.voice.transcribe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        }),
    );
    vi.mocked(window.danidex.agent.sendMessage).mockRejectedValueOnce(new Error("Local send failed"));
    installVoiceRecordingMocks();
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Create prompt with voice" }));
    await screen.findByRole("group", { name: "Voice recording" });
    await fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
    await waitFor(() => expect(window.danidex.voice.transcribe).toHaveBeenCalledOnce());
    const composer = screen.getByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Later local draft";
    await fireEvent.input(composer);
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );

    resolveTranscription?.({ text: "Message for local Chief" });
    await waitFor(() => expect(window.danidex.agent.sendMessage).toHaveBeenCalledOnce());
    expect(screen.queryByText("Local send failed")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Local server" }));
    expect(await screen.findByText("Local send failed")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toHaveTextContent(
      "Later local draft Message for local Chief",
    );
  });

  // The Linux package carries no whisper binary, so the composer must not offer a control that
  // always fails. Everything else about the window, the server rail included, stays the same.
  it("offers no microphone on Linux and still draws the server rail", async () => {
    vi.mocked(window.danidex.getAppInfo).mockResolvedValue({
      name: "Dani-Dex",
      version: "0.1.0",
      platform: "linux",
      variant: "production",
    });
    render(() => <App />);

    await screen.findByRole("heading", { name: "Chief" });

    expect(await screen.findByRole("complementary", { name: "Servers" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Message Chief" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create prompt with voice" })).not.toBeInTheDocument();
  });

  it("starts a voice call from the composer and shows why it could not connect", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(await screen.findByRole("button", { name: "Start voice call" }));

    await waitFor(() => expect(window.danidex.voice.createRealtimeSession).toHaveBeenCalledOnce());
    expect(await screen.findByText("Voice call unavailable")).toBeInTheDocument();
    expect(await screen.findByText("Add your OpenAI API key to start a voice call.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start voice call" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End voice call" })).not.toBeInTheDocument();
  });
});
