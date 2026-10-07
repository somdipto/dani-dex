# Evidence

Exact baseline d0181757a3d1d7f7b21470d49dec8832aefd52a6.
All test files below ran separately with the pinned Bun 1.4.0 and --maxWorkers=1.

| Focused test file | Passed |
| --- | --- |
| src/main/context-import-service.test.ts | 7 |
| src/renderer/src/features/conversation/context-import-save.dom.test.ts | 10 |
| src/renderer/src/features/conversation/AgentMemoriesModal.test.tsx | 6 |
| src/main/voice-transcription-service.test.ts | 4 |
| src/preload/context-import.test.ts | 2 |
| src/renderer/src/features/conversation/LegacyContextImportReview.test.tsx | 1 |
| src/renderer/src/features/conversation/ContextImportPanel.test.tsx | 3 |
| src/renderer/src/App.voice.test.tsx | 12 |
| src/renderer/src/features/onboarding/OnboardingFlow.test.tsx | 16 |
| scripts/dev-services.test.ts | 25 |
| src/main/ipc/input-parsers.test.ts | 52 |
| src/main/ipc/define-ipc-group.test.ts | 2 |

Total: 140 focused tests. The import service uses a real SQLite database; native child lifecycle,
microphones and browser locks have explicit test doubles. Those doubles do not certify physical devices.
Changed-file Biome and git diff --check pass. No broad local typecheck, suite or app build was run.
CI has contract tests on Linux, Mac and Windows plus actual Whisper compile/start on both Mac architectures,
Windows and Linux. Full package jobs continue on main/release; their result is not inferred here.

Native Linux command: bun run voice:prepare-runtime, with CMake 3.31.6 and the host C++ toolchain.
Pinned whisper.cpp: 86c40c3bd6fc86f1187fb751d111b49e0fc18e84. GGML_NATIVE and OpenMP disabled.
--help executed successfully. Linux x64 ELF: 2,933,896 bytes; SHA-256
41cd81ce8221bd5fa528a8fcda87b52dbf352e5294ee0c7b39847b5717310157.
This hash fingerprints this local test artifact, not a published multi-platform release.
Only normal system C/C++ libraries remain in ldd; no separate OpenMP dependency. No model bundled.

Auth artwork: contentArtProblems() returns []. The older ledger's stale-artwork claim no longer
reproduces on the baseline. This is not proof of the complete auth production build.

Actual dev UI was attempted with bun run dev --isolated. First it failed with getifaddrs; R7 repairs
that optional discovery path and has a focused regression test. Next the dev seed failed because
tsx could not create its local IPC socket (listen EPERM). No renderer window/automation instance was
created. dev:stop could not confirm the recorded supervisor identity and therefore signalled no PID.
Before/after native screenshots are blocked. No ad-hoc preview or production build replaces them.

CodeRabbit CLI 0.8.2 installed with checksum verification. auth status --agent reports not_authenticated;
auth login --agent reports environment_unsupported: browser login is unavailable in this environment.
No CodeRabbit review ran. It needs an Agentic API key or login from a user-controlled terminal/browser.

The PR's commit/tree identifies the final source. Review image assets are not committed here.

Initial PR CI found the old IPC group fixture missing the new cancellation endpoint and an ES2024
Promise helper in a Node test that targets ES2023. Both fixtures were repaired without changing the
target or suppressing checks. The runtime builds passed on Linux and Apple Silicon at the initial
source fingerprint; the remaining OS/CI results are recorded on PR 18.

CI at 7fea40c passes the full static checks/build, both desktop test shards, API, remote, sites,
Storybook, bundled skills and surfaces. Platform import/voice checks pass on Mac, Windows and Linux;
pinned Whisper compile/start passes on Linux, Windows, Intel Mac and Apple Silicon. The browser smoke
fails because its first click has no pointer events. The fixture now requires an actual displayed
native frame before input and exposes --scenario=native-input; its CI result is pending.
The frame probe at cf5d649 confirms the missing native surface with UnknownVizError. The fixture now
waits for ready-to-show and actual window focus, replacing its fixed startup delay. Native input and
capture assertions remain required; the next CI run must verify this startup correction.

The native dev retry was blocked by automatic approval review: setup contacted Cloudflare and the
review could not establish what data or credentials it might send. dev:stop reports no running stack.
There is also no local display server; package installation is unavailable in this execution environment.
No native UI, microphone or physical-device result is claimed from this retry.
