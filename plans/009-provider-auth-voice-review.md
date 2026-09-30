# DANI Dex login and voice plan

Review draft. September 30, 2026. No OAuth or voice implementation starts until this plan is reviewed.

## Product direction

Only Dani Free has a Download action. ChatGPT uses a browser sign-in when the account and app are eligible. Claude and Grok use supported in-app API connections unless their providers approve a separate OAuth route. Do not expose the Dani Free engine name, raw CLI version or internal model names in normal UI. Preserve existing user work and other provider choices.

Opening Voice call from a chat opens a voice setup sheet when voice is not configured. It must not start a paid session, download a model or turn on the microphone merely because the sheet opens. Text inference and voice are separate choices. A ChatGPT text connection does not mean voice is connected.

## ChatGPT authentication is the main milestone

The owner's latest priority is OpenAI/ChatGPT authentication. Spend the first implementation pass on this end-to-end path, not cosmetic provider parity. Other provider adapters follow after the ChatGPT text connection is reliable. Voice entitlement stays a separate gate.

Deliverable A: a real Connect ChatGPT action opens the official consent flow and returns to the same DANI Dex installation. New registration and returning-account sign-in must both work. The screen shows the verified account and actual plan grant, or a clear identity-only/ineligible state. Cancellation and denial leave existing accounts untouched.

Deliverable B: encrypted account-specific credentials survive app restart. Refresh rotation is race-safe. A revoked grant, changed workspace, expired refresh token or unavailable secure store has a clear recovery path. Disconnect removes only the selected DANI Dex registration locally, terminates affected sessions and does not sign the user out of unrelated OpenAI apps. Verify provider-side revocation support separately rather than claiming it happened.

Deliverable C: one real tool-backed text task runs on an eligible account using an actual listed model. Save the app's thread/workspace/history; complete a token refresh and controlled child restart; resume the same thread. Prove response.completed and reject partial/error streams. Keep Dani Free working before and after the account switch. Usage limits cannot trigger a silent paid API fallback.

Acceptance pack: actual browser consent and app state screenshots with private identifiers redacted, one task/result clip, restart readback, refresh/denial/revocation test evidence, and a clear eligibility caveat. No tokens, callback codes or private account history in the proof. The current 13-test OAuth foundation is preparation only, not these deliverables.

## Verified capabilities and limits

ChatGPT: OpenAI documents dynamic registration, PKCE, loopback callback, account-specific issued client IDs, protected credentials and plan-backed Responses. The preview excludes audio/video input and transcription. Its public Realtime guide uses API keys and short-lived client secrets. Therefore ChatGPT OAuth for text is a supported candidate; ChatGPT OAuth for full-duplex voice is not established by SIWC. The app's distribution/plan eligibility remains a gate. The product's PolyForm Noncommercial license must be checked against this program; do not change the license as a shortcut.

Claude: Anthropic's official policy explicitly says third-party developers must not offer Claude.ai login or route user requests through Free, Pro or Max credentials. Supported third-party authentication is Claude Console API key or a supported cloud provider. Do not implement the proposed Claude subscription OAuth button without written provider permission. A Claude Code executable or technically working token is not that permission.

Grok: xAI API accounts and Grok accounts may share identity, but billing is separate. Speech-to-speech supports streaming audio, tools and server-VAD interruption over WebSocket. Authentication is an API key, or an ephemeral client secret created with an API key. No supported third-party Grok subscription OAuth grant was found in the official sources reviewed. Label it Connect xAI API, not Sign in with Grok for free voice.

Local voice: current source has Whisper model download/transcription and an OpenAI API Realtime path. Whisper alone is speech recognition, not speech synthesis or full-duplex speech-to-speech. A local call option needs streaming recognition, local speech synthesis, echo cancellation, interruption and routing into Dani Free. Hardware, model size, licenses, offline behavior and latency need measurement before a full-duplex claim. No claim that the current local path already works.

Experimental Codex voice: previously reviewed Codex 0.153.4 source exposes an experimental V3/WebRTC route. This is not SIWC Realtime permission, not established free usage, and not product acceptance. Keep behind a development gate until provider permission, account admission, transport behavior and cost are resolved. No live voice test has been authorized.

## Proposed screens

Onboarding and Settings use the same provider state and actions:
- Dani Free: Download, downloading progress, cancel, reconnect, ready or useful retry. No account needed. Only this provider presents a Download button.
- ChatGPT: Connect ChatGPT, browser consent, waiting/cancel, connected account, reconnect, disconnect and usage-unavailable/limit states. State clearly that eligible plan usage is separate from API billing. Do not promise all accounts are eligible.
- Claude: Connect Claude API. Explain API billing. If permission later enables OAuth, add it as a separate supported capability, not a silent replacement.
- Grok: Connect xAI API. Explain separate API billing. No CLI install step in normal UI.
- Custom provider: preserve endpoint/model setup and removal. It must not gain a Download button.

Do not imply that ChatGPT/Claude/Grok service access is Included with Dani-Dex. Internal dependencies may be bundled when permitted, but that is separate from provider entitlement. Audit onboarding, settings, provider/model picker, first-agent setup, retry dialogs, empty states, toasts and diagnostics for engine-name leakage. Keep required license/NOTICE attribution unchanged.

Voice setup sheet, reached from the chat's call button:
- Local voice: Install local voice, with size, supported hardware, download/cancel and privacy information. Mark experimental until it passes call acceptance. Text reasoning stays with Dani Free.
- OpenAI voice: Connect OpenAI API for the verified Realtime path, clearly marked paid. Offer ChatGPT OAuth voice only if a supported voice grant is confirmed later. Do not silently spend via a saved API key.
- xAI voice: Connect xAI API, clearly marked paid. No OAuth claim without provider documentation or agreement.
- Cancel: returns to the same chat, no device or network effects.

If API voice is not approved as the alternative to the requested OAuth voice, ship only a truthful unavailable/local-experimental state, not a fake OAuth button. Missing mic permission, unsupported OS, offline state and unavailable model must have useful recovery. Remember a voice choice separately from the chat model. Never silently switch provider after quota/error.

## Implementation design

1. Introduce a small provider connection/capability interface shared by onboarding, Settings and the call sheet. Distinguish text auth, voice auth, runtime presence, account state, model catalog and billing. Avoid another condition tree in the large lifecycle file.
2. Keep all persistent credentials in main-process protected storage. Renderer receives account labels and states only. API keys never enter logs, files for sharing, URLs, browser local storage or global environment. Request secrets through a secure input flow, not chat.
3. ChatGPT lifecycle: persist stable host ID; start a 127.0.0.1 loopback listener before opening the browser; fresh state/nonce/S256 PKCE; exact callback scheme/host/path, random available port; one active cancellable attempt; reject duplicate parameters, stale state, missing issued ID and registration replacement. Exchange with the issued client ID. Verify JWKS signature, issuer, audience, expiration and nonce. Bind validated subject and selected registration; use actual granted scopes. Identity-only consent must never unlock plan inference.
4. Store each issued client ID/account independently, with encrypted atomic credential updates. Do not use plaintext fallback when encryption is unavailable. Coalesce rotating refresh, honor earliest_refresh_at, replace refresh/access/expiry/scopes together, survive restart, and cancel in-flight replacement on disconnect. Recover invalid_grant, revocation, denied consent, offline failures and workspace restrictions without OAuth loops.
5. Route ChatGPT plan text through the documented Responses route or documented Codex app-server configuration. Pass tokens only to the selected child/session, never process-wide. Coordinate refresh restart with active turns; preserve thread, workspace and history. Account catalog is live, no invented model or success state. Success requires response.completed, not initial streaming. Surface app-specific quota separately from API balance; do not invent reset times.
6. Claude/xAI API: use supported SDK/API or permitted bundled runtime internally. Validate real connection/catalog before Ready. xAI API transport must be separate from the current Grok CLI login. Preserve existing agents and pending work across the migration. Do not overwrite independent provider-owned credentials.
7. Voice provider adapters share call lifecycle states: off, setup-needed, preparing, awaiting permission, connecting, listening, speaking, interrupted, reconnecting, ended and failed. Use ephemeral secrets for browser transport, with minting in main/the selected host. Main owns long-lived keys. No permanent key in renderer or remote clients.
8. Local voice adapter uses bounded queues and one cancellable model preparation job. Verify pinned download/checksum/license, disk/memory budget, partial-download recovery and offline operation. Capture/playback coexist; cancel speech on barge-in and do not let speaker output become a new user turn. Route recognized requests through the existing permission/tool workflow. Do not bypass tool approval through voice.
9. Preserve host/chat identity during calls. A local-only voice path must not appear supported for a remote host without capability negotiation. Host/account/chat changes end or require confirmation for the call. On stop, close transport, microphone, playback, timers and ephemeral credentials; disconnect stops affected active calls. Keep non-secret usage/connection evidence, not raw audio or tokens.

## Order of work and evidence gates

Gate 0: approve the capability matrix and supported alternatives; confirm app eligibility and provider permission where needed. OAuth/voice product code is held until this review.

Gate 1: fix the shared provider labels/actions and secret-storage boundary with focused tests. Pixel-check onboarding and Settings in actual desktop windows and narrow layouts. Only Dani Free shows Download. Do not remove working alternatives before their replacement is ready.

Gate 2: complete ChatGPT text auth lifecycle first. Foundation currently has 13 unit tests only; no listener/store/live UI. Test denial, callback attacks, account mix-up, refresh race, interrupted writes, revocation, no encryption and thread continuation. Authorized live connection must show selected account, real catalog, tool-backed text result and restart persistence. No live paid call without separate approval.

Gate 3: add Claude and Grok supported API paths and truthful billing. Test connect/reconnect/disconnect, invalid key, limits, timeout, stream failure, selected-account isolation and provider switches with history intact.

Gate 4: implement the call-sheet entry before transport expansion. Clicking call with no voice setup shows choices and performs no spend/download/mic effect. Test cancel, install retry/cancel, key removal, remote incompatibility, and accessible keyboard focus.

Gate 5: test OpenAI/xAI supported Realtime adapters with explicit usage approval and a cost/time cap. Prove real mic input/output, simultaneous capture and playback, user interruption, mute, device change, permission denial, network loss/recovery, quota and deterministic stop. Measure input-to-first-audio latency and memory, not a staged animation.

Gate 6: local voice acceptance on named OS/hardware with actual downloaded models. Record model size/checksum/license, CPU/RAM and measured latency. Prove offline STT/TTS and local session plumbing; separate Dani Free's online text reasoning from offline audio. If it cannot meet full-duplex latency, label it turn-based/local voice and leave full-duplex pending.

Gate 7: installed builds, clean profile, real chat/job and database restart, second clean run, regression across all providers and an unedited real call clip. Broad CI and native platform acceptance remain required. No PR under the owner's current hold until the complete requested bar is met.

## M0 work that remains independent

Actual Linux production build, window, managed Dani Free engine download and larger Meet character are proved. The first-agent Suggestions overlap is fixed in actual pixels. Real agent/job/restart is not proved. With the SHA-pinned proxy supplied to preview, it reports ready, but the app's OpenCode ACP activation times out and the free model catalog stays empty. Investigate child startup, config/environment, handshake and ownership; no fake catalog, force-click, fixture-only completion or silent paid fallback. Keep this separate from OAuth entitlement work.

## Decisions needed before implementation

The owner selected officially allowed paths: plan for ChatGPT SIWC text where eligible, Claude API key, Grok/xAI API, and separately configured API voice. This design choice does not authorize paid test usage or prove that a connection exists. Subscription OAuth voice remains unavailable unless officially supported.

Still needed: the first desktop hardware/OS for local-voice acceptance, distribution eligibility, and explicit approval/caps for any live paid voice tests. Full-duplex claims must be tied to real measurements.

No changes to LICENSE/NOTICE, account state, provider billing or remote publication are authorized by this plan.

## Sources checked

OpenAI SIWC overview: https://developers.openai.com/siwc/token-sharing-open-source
OpenAI sign-in lifecycle: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
OpenAI preview limits: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
OpenAI tokens: https://developers.openai.com/siwc/token-sharing-open-source/token-reference
OpenAI failure recovery: https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
OpenAI Realtime WebRTC: https://developers.openai.com/api/docs/guides/realtime-webrtc
Anthropic authentication policy: https://code.claude.com/docs/en/legal-and-compliance
xAI account/billing distinction: https://docs.x.ai/developers/faq/accounts
xAI speech-to-speech: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
xAI ephemeral secrets: https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens

Official docs were read September 30. Documented support is not live DANI Dex proof. Re-check capabilities and terms before shipping. The pictured Meet character is current built UI evidence, not the proposed login/voice screen.
