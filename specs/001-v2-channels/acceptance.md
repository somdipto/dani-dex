# Acceptance ledger

| Criterion | Evidence | Status |
| --- | --- | --- |
| A1/A2 manifest and byte verification | real Node/Bash installer subprocesses | passed locally |
| A3/A4 update/recovery and owner data | filesystem failures, lock and directory tests | passed locally |
| A5 cleanup/process failures | corrupt/partial download and simulated Windows exit | passed locally |
| A6 memory/output | streamed hash; bounded Node manifest; shorter output; no dependency change | source verified |
| native Mac/Windows installation | no device/PowerShell runtime available | pending |
| installer publication and lifecycle | no release produced | pending |
| V201–V204/V206–V212 | missing candidate or account/device/eligibility gates | pending |

V205 remains partially BUILT; issue 15 remains open. Local checks cannot replace native or live acceptance.
