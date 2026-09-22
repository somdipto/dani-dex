# [SPEC] Complete Dani-Dex: reliable auth, selectable harnesses, full-duplex voice, packaging, and real-world proof

## Status

Draft for owner review. Do not publish or push until Somdipto provides the target repository URL and explicitly asks for the hard push.

## Product statement

Dani-Dex is a separate product from Dani Bot / `dani-desktop`. It is a local-first multi-agent desktop workspace in which a user can choose an agent harness and model, speak naturally to a chief-of-staff agent, let that agent delegate work to other agents while the conversation continues, and hear the final response spoken back. It must preserve the visible transcript, delegated work, approvals, cancellation, and evidence in the normal conversation thread.

## Non-goals for this issue

- Do not merge or share state, branding, repository history, runtime directories, app identifiers, release channels, or update feeds with Dani Bot.
- Do not add Laya to the critical path. Laya is a later optional classifier/router experiment after real traces exist.
- Do not claim speech-to-speech or full duplex from a push-to-record dictation feature.
- Do not hard-code prompts, transcripts, agent replies, model lists, provider health, or successful auth states for demos.
- Do not remove `LICENSE`, `NOTICE`, or third-party attribution.
- Do not push until the owner provides the destination repository and asks for the hard push.

## Current verified baseline (2026-09-23)

- Local clean-history repository exists at one root commit, `90405ba24d60b1a45d03a018529eb4d25468f978`, authored and committed by Somdipto Nandy.
- No Git remote is configured.
- Product-facing standalone `OpenBot` branding was replaced with `Dani-Dex` across 469 tracked files. Legal notices are unchanged.
- Desktop app identity: `Dani-Dex`, `dev.danlab.danidex.desktop`, `dani-dex.desktop`.
- Mobile product name, slug, scheme, and bundle identifiers use Dani-Dex.
- Canonical deep links use `dani-dex://`. Old `openbot://` links remain readable for migration compatibility.
- Frozen dependency install, UI foundation check, five desktop typechecks, and production Electron build pass on the pinned toolchain.
- Focused deep-link/desktop tests pass 65/65. Focused auth tests pass 104/104 across account UI, email one-time codes, MCP OAuth callbacks/storage/provider flow, and deep-link routing.
- The built desktop app launches and renders Dani-Dex branding. Visual proof exists.
- Existing voice is dictation only: record a bounded clip, convert it to WAV, transcribe with local whisper.cpp medium q5_0, append the text to the normal draft, and submit. There is no TTS, streamed input, VAD, barge-in, call state, device picker, or voice model picker.
- Current providers are Codex, Claude, Grok, and OpenCode. There is no first-class harness abstraction and no Hermes or OMP/mypi adapter.

## Definition of “complete”

This issue is complete only when all of these are true on a clean supported machine:

1. Dani-Dex installs and starts without a developer shell.
2. The account flow, MCP OAuth, and each advertised provider auth route work with truthful failure states.
3. The user can choose a harness and a compatible model independently.
4. Hermes can run a general-purpose chief-of-staff conversation and delegate a real task to another agent.
5. The phone button opens a real call settings menu.
6. A real microphone utterance is streamed or segmented, transcribed, entered into the ordinary conversation, and dispatched to the selected bot.
7. Agent events and delegated work remain visible while the call continues.
8. The final user-facing reply is synthesized and played through the selected output device.
9. The user can interrupt speech playback, continue speaking, cancel, reconnect, and recover without losing the thread.
10. Local/private and hosted voice paths report their actual availability. No unavailable model appears selectable.
11. Full static checks, focused regressions, packaged smoke tests, and real hardware/audio tests pass.
12. A fresh, unedited proof recording shows install/start, auth, harness/model selection, a chief-of-staff delegation, spoken reply, barge-in, and recovery with no hidden errors.

---

# Architecture decisions

## A. Separate harness from model provider

Introduce a first-class `HarnessAdapter`. A harness owns session behavior and orchestration. A model provider supplies or identifies models. They are related but not the same setting.

```ts
interface HarnessAdapter {
  readonly id: HarnessId;
  capabilities(): HarnessCapabilities;
  authStatus(): Promise<HarnessAuthStatus>;
  listModels(): Promise<HarnessModel[]>;
  healthCheck(): Promise<HarnessHealth>;
  createSession(input: CreateHarnessSessionInput): Promise<HarnessSession>;
  resumeSession(input: ResumeHarnessSessionInput): Promise<HarnessSession>;
  cancel(sessionId: string, turnId?: string): Promise<void>;
}

interface HarnessSession {
  send(input: HarnessTurnInput): AsyncIterable<HarnessEvent>;
  close(): Promise<void>;
}
```

Required event vocabulary: session-created, transcript-accepted, turn-started, text-delta, tool-started, tool-finished, delegation-started, delegation-updated, approval-required, final-response, canceled, failed, and session-closed.

Phase-one harnesses:

- **Hermes**: general-purpose, long-horizon work, chief-of-staff delegation.
- **Coding harness**: OMP or mypi, only after Somdipto supplies the exact upstream repository. Do not guess which project or treat names as interchangeable.

Existing Codex/Claude/Grok/OpenCode drivers can remain provider/runtime integrations behind the adapter boundary during migration.

## B. Canonical voice path is chained and thread-preserving

The canonical path is:

`microphone -> capture/VAD -> STT -> ordinary conversation delivery -> selected harness/model -> final response -> TTS -> output device`

This preserves an exact transcript, normal thread history, tool/delegation visibility, approvals, cancellation, and replay. OpenAI Realtime is an optional hosted transport, not a replacement for the normal conversation ledger.

## C. Call state is explicit

Use a single owner for the call state machine:

- idle
- preparing
- connecting
- listening
- speech-detected
- finalizing-utterance
- transcribing
- dispatching
- waiting-for-agent
- speaking
- interrupted
- reconnecting
- ending
- failed

Every transition must be valid, observable, cancellable, and covered by tests. A stale async completion must not change a newer call generation.

## D. Voice provider boundary

```ts
interface SpeechToTextAdapter {
  readonly id: SttProviderId;
  capabilities(): SttCapabilities;
  prepare(): Promise<VoiceProviderStatus>;
  createStream(config: SttStreamConfig): Promise<SttStream>;
}

interface TextToSpeechAdapter {
  readonly id: TtsProviderId;
  capabilities(): TtsCapabilities;
  prepare(): Promise<VoiceProviderStatus>;
  synthesize(input: TtsInput): AsyncIterable<AudioChunk>;
  cancel(): Promise<void>;
}

interface RealtimeVoiceAdapter {
  readonly id: RealtimeProviderId;
  createSession(config: RealtimeSessionConfig): Promise<RealtimeVoiceSession>;
}
```

No renderer receives persistent provider secrets. Main owns secrets, ephemeral session negotiation, provider calls, redaction, and bounded IPC payloads.

## E. Initial provider policy

Defaults are selected from measured availability, latency, quality, hardware cost, privacy, and license compatibility. “Best” means best verified default for the machine and credentials, not a fixed marketing claim.

Initial candidates:

- Local STT baseline: existing whisper.cpp medium q5_0, converted to streaming chunks plus VAD.
- Hosted STT: `gpt-4o-mini-transcribe`, selectable only with supported credentials.
- Hosted TTS: `gpt-4o-mini-tts`, selectable only with supported credentials.
- Hosted low-latency mode: OpenAI Realtime, selectable only after supported API/OAuth session creation succeeds.
- Local TTS: choose only after a benchmark and license review on macOS Intel/Apple Silicon, Windows x64, and Linux x64.

A local Codex login does not automatically authorize OpenAI Realtime. Credential routes must be proven independently.

## F. Barge-in and echo handling

When speech is detected while TTS is playing:

1. Stop local playback immediately.
2. Cancel or drain provider synthesis safely.
3. Mark the assistant utterance interrupted at the exact played offset if available.
4. Keep the assistant text in the visible thread with an interrupted marker.
5. Start capturing the user’s next utterance.
6. Prevent the app’s own TTS audio from being treated as user speech through platform echo cancellation plus output-reference gating.

---

# Work plan

## Phase 0 - Reproducible baseline

### Tasks
- [x] Clone into an isolated Dani-Dex workspace.
- [x] Install pinned Bun and Node versions with checksum verification.
- [x] Install from the frozen lockfile.
- [x] Run UI foundation, lint, typechecks, production build, focused tests, browser smoke, and a real launch.
- [x] Record inherited warnings and timeout behavior without mislabeling them as regressions.
- [ ] Split the long desktop suite into stable bounded shards and record final totals.
- [ ] Investigate the browser smoke snapshot timeout after the local-tab/actions stage.

### Exit gate
A documented baseline identifies passing gates, inherited warnings, environmental requirements, and unresolved real failures.

## Phase 1 - Dani-Dex identity and clean history

### Tasks
- [x] Replace product-facing standalone OpenBot copy with Dani-Dex.
- [x] Set desktop/mobile names and identifiers.
- [x] Add canonical `dani-dex://` deep links.
- [x] Preserve compatibility parsing for legacy `openbot://` links.
- [x] Preserve LICENSE/NOTICE.
- [x] Build, typecheck, run focused link/identity tests, launch, and inspect pixels.
- [x] Replace source history with one local root commit authored by Somdipto Nandy.
- [x] Remove all remotes.
- [ ] Add an automated product-copy scan that permits legal notices and intentional migration vocabulary only.
- [ ] Add data-path migration tests before changing any existing user-data directory or database name.
- [ ] Replace old product artwork with approved Dani-Dex artwork. Do not merely recolor without owner review.

### Exit gate
One-root local history, clean worktree, no remote, build and focused tests green, visual identity verified, legal notices intact.

## Phase 2 - Authentication and account reliability

### Surfaces
1. Dani-Dex account email-code auth.
2. MCP OAuth with loopback callback and `dani-dex://mcp-auth` fallback.
3. Provider/harness auth.
4. OpenAI hosted audio/Realtime credentials.

### Tasks
- [x] Verify account UI and email-code service tests.
- [x] Verify MCP OAuth provider/store/callback tests.
- [x] Start local auth API and remote API.
- [ ] Make combined desktop + local auth startup deterministic and bounded.
- [ ] Remove unauthenticated background reads that create noisy 401 logs before sign-in, or handle them as expected state.
- [ ] Test email request, delivery ambiguity, resend, expiry, wrong code, successful verify, restart persistence, sign-out, and offline recovery in the live app.
- [ ] Test MCP OAuth success, denied consent, state mismatch, replay, timeout, refresh, revoked refresh token, disconnect, and restart persistence.
- [ ] Test each provider’s documented auth method in a clean profile.
- [ ] Add OpenAI audio/Realtime credential status and ephemeral-session negotiation without exposing long-lived keys to the renderer.
- [ ] Ensure every auth error names the affected provider and the user action that can fix it.

### Exit gate
Every advertised auth route succeeds live or is hidden/disabled with a truthful reason. Restart persistence and logout/disconnect behavior are proven.

## Phase 3 - Harness and model architecture

### Tasks
- [ ] Add `HarnessId`, descriptors, capabilities, health, auth, model discovery, session and event contracts.
- [ ] Migrate existing provider-driven sessions behind a compatibility harness adapter.
- [ ] Implement Hermes runtime install/verification and adapter.
- [ ] Create, resume, cancel, and recover Hermes sessions.
- [ ] Map Hermes tool/delegation/approval/final events to the canonical event stream.
- [ ] Make harness choice explicit in agent creation and settings.
- [ ] Put model choice inside the selected harness UI.
- [ ] Reject incompatible stored harness/model pairs with a repair path.
- [ ] Add health checks that distinguish missing runtime, bad auth, no models, startup failure, and protocol failure.
- [ ] After the exact OMP/mypi repository is supplied, perform license/security/API research and implement one coding-harness adapter.
- [ ] Keep Laya absent from execution. Capture trace points needed for later shadow evaluation.

### Exit gate
Hermes completes a real long-horizon task and delegates a real subtask. The chosen coding harness completes a real coding task. Cancellation and restart recovery work for both.

## Phase 4 - Phone UI and call settings

### Required UI
Clicking a telephone SVG opens a menu/sheet with:

- Start/stop call.
- Selected agent.
- Harness.
- Harness model.
- Voice mode: local chained, hosted chained, OpenAI Realtime.
- STT provider/model.
- TTS provider/model/voice.
- Microphone.
- Speaker/output device.
- Language/auto-detect.
- Push-to-talk vs automatic turn detection.
- Spoken reply toggle.
- Current download/auth/health state.

### Tasks
- [ ] Replace the one-action microphone control with the phone control without removing accessible keyboard behavior.
- [ ] Keep simple dictation as a separate fallback action.
- [ ] Persist preferences per device and optionally per agent, with clear precedence.
- [ ] Disable impossible combinations with specific reasons.
- [ ] Show privacy/network labels for local vs hosted processing.
- [ ] Add Storybook states for idle, downloading, auth-required, listening, thinking, speaking, interrupted, reconnecting, and failed.
- [ ] Add keyboard, screen-reader, contrast, reduced-motion, and focus-order tests.

### Exit gate
The menu is visually verified at supported sizes and every selectable option maps to a real available capability.

## Phase 5 - Full-duplex voice core

### Capture and STT
- [ ] Capture the chosen input device with browser/platform echo cancellation, noise suppression, and gain constraints where supported.
- [ ] Stream bounded PCM frames to main through backpressured IPC or a message port.
- [ ] Add VAD and end-of-turn detection with configurable silence threshold.
- [ ] Keep a rolling pre-speech buffer so initial phonemes are not clipped.
- [ ] Produce partial and final transcript events with utterance IDs and monotonic sequence numbers.
- [ ] Prevent duplicate finalization on stop, timeout, device loss, or reconnect races.
- [ ] Enforce memory, duration, and payload limits.

### Agent dispatch
- [ ] Write only final user utterances into the canonical conversation ledger.
- [ ] Dispatch through the selected harness/model to the selected bot.
- [ ] Keep tool calls, delegated work, approvals and progress visible.
- [ ] Do not synthesize internal tool chatter by default.
- [ ] Select one final user-facing response for speech.
- [ ] Preserve typed input and attachments during a call.

### TTS/playback
- [ ] Stream sentence-aware TTS chunks without waiting for the entire answer.
- [ ] Queue/decode/play chunks in order with bounded buffering.
- [ ] Track played ranges for interruption.
- [ ] Support playback rate and voice selection where the provider supports them.
- [ ] Route audio to the selected output device when the platform permits it.

### Barge-in, cancel, reconnect
- [ ] Detect user speech during playback and stop within the measured latency target.
- [ ] Cancel synthesis and, if requested, the active agent turn.
- [ ] Recover from microphone removal, speaker change, provider disconnect, sleep/resume, app focus changes, and network loss.
- [ ] Never submit partial noise as a user message.
- [ ] Never speak a stale response from an older call generation.

### Exit gate
A real microphone-to-agent-to-speaker loop works repeatedly, including barge-in and recovery, with the exact transcript and final response visible in the normal thread.

## Phase 6 - Chief-of-staff delegation proof

### Required scenario
1. Start a call with a Hermes chief-of-staff agent.
2. Ask for a nontrivial outcome that needs a second specialist agent.
3. Continue talking while delegation is in progress.
4. Observe the delegation in the thread/channel UI.
5. Receive and hear the final consolidated response.
6. Interrupt the spoken response, ask a follow-up, and hear the corrected answer.

### Test matrix
- [ ] Local STT + local TTS.
- [ ] Hosted STT + hosted TTS.
- [ ] OpenAI Realtime when authenticated.
- [ ] Long response.
- [ ] Short response.
- [ ] Tool approval during call.
- [ ] Delegated agent failure and retry.
- [ ] User cancel.
- [ ] Network disconnect/reconnect.
- [ ] Microphone permission denied/recovered.
- [ ] Speaker/microphone hot swap.
- [ ] App restart with thread recovery.

### Measurements
Record end-of-speech to final transcript, final transcript to harness dispatch, first agent text, first playable audio, barge-in stop latency, transcript word error on a fixed test set, peak memory, CPU, and dropped audio frames. Publish measured values by platform; do not invent universal promises.

### Exit gate
Ten consecutive successful chief-of-staff calls on each supported desktop target available to the team, with no hidden manual repair.

## Phase 7 - Packaging, release, and evidence

### Tasks
- [ ] Package voice runtimes and required notices for macOS Intel, macOS Apple Silicon, Windows x64, and Linux x64 as supported.
- [ ] Verify first-run permissions, runtime/model acquisition, checksums, resume, disk-space errors, and offline behavior.
- [ ] Verify app IDs, deep links, file associations, updater identity, and data migrations.
- [ ] Verify clean install, upgrade, and uninstall behavior.
- [ ] Ensure logs redact keys, tokens, transcript content where required, and private paths.
- [ ] Run complete CI/static/test/build/package gates.
- [ ] Inspect every release UI and installer visually.
- [ ] Record one fresh proof run from a clean profile with real models and no staged data.
- [ ] Publish only after owner review.

### Exit gate
Installers launch, authenticate, complete duplex calls, recover correctly, and pass the proof script. Downloads and checksums resolve from the final release location.

---

# Data model

Persist a versioned voice configuration that contains IDs, never secrets:

```ts
interface VoicePreferencesV1 {
  version: 1;
  mode: "local-chained" | "hosted-chained" | "openai-realtime";
  stt: { provider: string; model: string; language: string | "auto" };
  tts: { provider: string; model: string; voice: string; rate: number };
  devices: { inputDeviceId: string | null; outputDeviceId: string | null };
  turnDetection: { mode: "automatic" | "push-to-talk"; silenceMs: number };
  spokenReplies: boolean;
}
```

Persist call and utterance records only as needed for recovery/audit. Do not store raw microphone audio by default. Any optional retention must be explicit, bounded, visible, and separately deletable.

# Security and privacy requirements

- Persistent secrets stay in the existing encrypted credential boundary, never renderer storage or logs.
- Hosted voice calls show which provider receives audio/text.
- Audio capture has a persistent, unambiguous visual indicator.
- Only the selected conversation/agent receives final transcripts.
- IPC validates sender, payload size, session ID, sequence number, MIME/audio format, and current generation.
- Deep-link OAuth callbacks validate state and reject replay.
- Tool/agent approvals remain unchanged during calls. Voice does not grant permission.
- Cancellation stops capture, playback, synthesis, and active network streams.
- Diagnostics redact credentials and avoid raw transcript/audio by default.

# Failure behavior

Every failure must map to a user-actionable state:

- microphone permission denied
- microphone unavailable/disconnected
- output device unavailable
- local model missing/download/checksum/disk failure
- STT no speech / timeout / provider error
- harness missing / unhealthy / auth required / model unavailable
- TTS auth / quota / provider / decode / playback error
- Realtime session rejected / disconnected / expired
- OAuth denied / state mismatch / timeout / refresh revoked
- call superseded / canceled / app sleeping / app shutting down

A failure must not erase the transcript, duplicate a turn, speak stale content, or leave capture active.

# Test strategy

## Unit
State transitions, generation guards, VAD boundaries, rolling buffer, chunk ordering, transcript finalization, option compatibility, auth status mapping, event normalization, cancellation, retry, redaction.

## Contract
Renderer-main voice IPC, harness events, provider capabilities, settings migrations, deep-link migration, persisted call/utterance shapes.

## Integration
Synthetic PCM -> STT adapter -> transcript -> fake harness event stream -> TTS chunks -> playback queue, including delay/reorder/drop/error injection.

## Live
Real mic and speaker, local models, hosted models, OAuth callbacks, Hermes delegation, coding harness, device hot swap, suspend/resume, network loss.

## Packaging
Clean VM/device install, first launch, permissions, runtime download, checksums, offline restart, upgrade from the clean Dani-Dex root baseline.

## Visual
Phone menu, call state, transcript updates, delegation progress, approvals, errors, reduced motion, narrow windows, high DPI, dark/light modes where supported.

# Observability

Add structured, redacted events with call/session/utterance correlation IDs:

- call_started / call_ended
- input_device_opened / lost
- speech_started / speech_ended
- transcript_partial / final / failed
- harness_dispatched / first_event / final / failed
- tts_requested / first_chunk / playback_started / interrupted / finished / failed
- realtime_connected / reconnecting / disconnected

Record durations and reason codes. Never log access tokens, raw authorization codes, full transcript bodies, raw audio, or provider secret material.

# Required review checkpoints

1. Approve this issue/spec.
2. Approve the exact coding-harness upstream repository after Somdipto supplies it.
3. Approve Dani-Dex artwork and final product copy.
4. Review first real duplex call evidence.
5. Review packaged clean-machine proof.
6. Provide destination GitHub repository URL.
7. Explicitly authorize hard push and issue publication to that destination.

# Push/publication runbook - blocked until repository URL and explicit execution instruction

1. Validate the supplied repository owner/name and whether destructive overwrite is intended.
2. Confirm the local one-root history and clean worktree.
3. Add the destination remote only after validation.
4. Fetch remote refs and report what will be replaced.
5. Reconfirm the exact branch and hard-push instruction against the supplied destination.
6. Force-push with lease where possible; use plain force only if the user explicitly requires replacement and lease cannot apply to an empty/new destination.
7. Read back the remote commit and compare its tree and author.
8. Create this issue in the repository Issue tab with labels/milestones available there.
9. Return the verified repository and issue URLs.

# Final acceptance checklist

- [ ] Separate from Dani Bot in every identity/state/release dimension.
- [ ] One clean root history, author/committer Somdipto Nandy.
- [ ] No old product-facing name outside legal/migration compatibility contexts.
- [ ] Auth routes proven live.
- [ ] Hermes and the approved coding harness proven live.
- [ ] Harness and model independently selectable.
- [ ] Phone menu complete and accessible.
- [ ] Local chained voice proven.
- [ ] Hosted chained voice proven.
- [ ] OpenAI Realtime proven when authenticated.
- [ ] Chief-of-staff delegation works during a call.
- [ ] Spoken output, barge-in, cancellation, reconnect, and recovery work.
- [ ] Full tests/build/package gates pass.
- [ ] Real-device visual/audio evidence reviewed.
- [ ] No push or issue publication before final destination authorization.
