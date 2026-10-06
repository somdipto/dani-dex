# Plan

Use the existing zero-dependency installers. No new runtime, provider, database or UI module.

File map: onboard/bin/dani-dex-onboard.js; scripts/onboard.sh; scripts/onboard.ps1;
scripts/onboard-cli.test.ts; scripts/onboard.test.ts; scripts/onboard-install.test.ts; README.md.

Replace permissive checksum paths; stream hashing; stage updates beside the destination;
retain recovery state on failed restoration; wait for transport and process outcomes.
Tests use isolated directories and a loopback server, never owner profiles or live providers.

Constitution: $0 provider spend; no proxy changes, sends, releases, push or merge;
LICENSE/NOTICE and owner data preserved. No schema or released protocol change.
Rollback of this source patch: revert its commit. App-copy rollback cannot undo database migrations.
Root .specify is not initialized; the bundled scaffold and source pin are preserved.
