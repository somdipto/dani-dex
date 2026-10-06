# Evidence

Base source: 9e5d7027fbb1bbf65d1dd6b53be03475306ba648.
Toolchain: Node 24.19.0; Bun 1.4.2; Vitest 4.1.10; Biome 2.5.9. Frozen install completed.
Per-file hashes identify the installer sources under test. Local test logs accompany the patch.
Reported historical nine backend failures were not rechecked. Broad checks are reserved for CI by AGENTS.md.
No live messages, credentials, owner profiles or provider receipts were used.

Focused checks: 31 CLI/replacement tests, 20 Bash/source-entry tests and 21 subprocess tests passed (72 total).
Changed-file Biome, Node syntax, Bash syntax and git diff checks passed.
The 20-case subprocess matrix against unchanged main failed 16 cases and passed four.
Those expected baseline failures are retained in the downloadable evidence; they are not waived.
Broad pre-commit UI/type checks were not run, per AGENTS.md; focused checks above were used for the local commit.
