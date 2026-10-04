# 06: Architecture and observability foundation

## Acceptance criteria

- Main owns process/device services; renderer owns UI/capture/playback; IPC validates bounded input and preserves all required output fields. No external content becomes authority.
- One lifecycle owner per capture, STT process, TTS worker/helper and playback route. Stop/quit cancels work, stale results cannot mutate new calls.
- Trace one attempt with a random diagnostic ID, stage timings and states. No transcript/audio/secret logging by default. Logs make permission/device/zero-input/timeout/model/engine failure distinguishable.
- No feature starts on merely opening a sheet. Explicit setup separates download, permission and call-start. No hidden paid usage.
- All native binaries/models/dependencies have pinned sources, integrity checks and offline-after-install admission. Packaging actually tested on Intel; platform help is not runtime capability proof.
- Speech performance has a supported-machine contract. Slow hardware is a reported limitation, not unbounded user waiting disguised as listening.

## Evidence checklist

Lifecycle/cancel concurrency tests, sandbox/IPC regression, offline restart, dependency/asset resolution, helper permissions and signing, exit cleanup, diagnostic redaction inspection.

Status: OPEN. No deployment or V2 scope added by this kit.
