# Source reconciliation

2026-10-07: fetched main d018175 and the current bodies/comments of issues 1 and 15.
Remote prod-2 ends at 0e374fa: it contains release/changelog changes, not the unpublished candidate 395efae.
The public tree has only the V2 installer repair slice at specs/001-v2-channels.
Gateway, Telegram reply/outbox and lightweight client candidate modules named in #15 are absent.
Do not replace those reviewed but unavailable modules with invented implementations.

Confirmed defect: onboarding/retry used mutable selectedServerId through listMemories/createMemory.
Decision: additive fixed-local IPC with main-owned account validation; never route a staged batch remotely.
The existing memory store already folds exact redacted duplicates before its capacity check.
Use that database boundary and readback rather than a second receipt table or renderer-only dedupe.

Confirmed defect: VoiceTranscriptionService prepared the model before its try/finally;
a thrown preparation permanently kept busy=true. Linux excluded Whisper preparation/resources by design.
Decision: include preparation in request lifetime and make Linux asset preparation/verification explicit.
Native microphone latency, speaker interruption and external-provider success require their own evidence.
