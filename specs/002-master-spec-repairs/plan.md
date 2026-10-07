# Plan

Use existing contracts, trusted IPC, AgentService, SQLite memory duplicate checks and Whisper pipeline.
No dependency, schema or release-version change. Core function remains account-optional.

File map: packages/contracts/src/context-import.ts and IPC declarations; src/main/context-import-service.ts;
src/main/ipc/memory-handlers.ts; src/preload/index.ts; renderer onboarding/conversation/preview;
VoiceTranscriptionService, voice-store, voice IPC; prepare-whisper, Linux package scripts/config/verifier;
CI platform repair checks; this spec's evidence ledger.

Constitution check: AGENTS.md is authoritative; the bundled .specify constitution is an unfilled template.
Keep that scaffold, license/NOTICE, user data, provider choices and renderer isolation.
No extension hooks are installed at root or in the bundled scaffold.
Local checks are one relevant file at a time and changed-file Biome. Broad checks run in CI.

Rollback: revert source commit. No database migration is added; never delete user profiles to roll back.
Imported memories already saved remain owner data. Legacy batches stay held until the owner reviews them.
