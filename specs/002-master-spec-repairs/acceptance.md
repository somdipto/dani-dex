# Master acceptance ledger

Checked against main d018175, the October 7 issue 1 comments, issue 15 and remote prod-2.
This is a repair PR, not completion of the entire master specification. No gate below is lowered.
The Open Instinct plan added during this work has a separate [29-item ledger](open-instinct.md).

| Item | Current source / evidence | Remaining requirement |
| --- | --- | --- |
| R1-R3 context-import release blocker | Fixed local IPC, main account check, SQLite duplicate folding/readback, scoped retry, explicit legacy review; focused tests and three-OS CI pass | Native UI review |
| R4 voice lifetime | Preparation covered by finally; request cancellation; child-close cleanup; app-close and original-server send regression tests | Native microphone and process recovery proof |
| R5 Linux voice | Pinned CPU runtime compiled and --help executed locally and on four CI targets; packaging and verifier now include Whisper; model stays on demand | Packaged clean-machine microphone/codec test |
| V1 rebrand | Some legacy domains and compatibility names remain | Domain/deployment decision, compatibility manifest and tested sweep |
| V1 full duplex / Realtime | Renderer transport and coordinator already exist | Real spoken delegation, audible reply, barge-in and recovery on the same build |
| V1 harness picker | Picker and runtime state already exist | Persist/restart/run a real supported turn |
| V1 Hermes | Pinned install recipes and package smoke steps already exist | Clean-machine real turn on each supported architecture |
| V1 CI/CD | PR CI run 111 is green; imports/defaults pass on three OSes and runtime compile/start on both Mac architectures, Windows and Linux | Main package/release matrix, universal binary and signing/notarization proof |
| V1 updater | Feed and updater service already exist | Installed N to N+1 download/restart on the fleet |
| V1 self-hosted auth / live keys | Account service and Realtime minting code exist | Owner domain, deployment, email delivery, actual sign-in and Realtime credentials |
| V1 artwork gate | Current contentArtProblems() returns [] | Stale ledger item; this result does not certify the whole auth production build |
| V1 desktop auth / device fleet | No live owner session or physical audio device supplied | Sign-in, restart, sign-out; Intel/Apple Silicon/Windows/Linux native runs |
| V201 Telegram | Reviewed candidate 395efae is absent from all fetched refs | Publish candidate, bind intended bot/private sender/chat, reviewed reply and matching receipt, restart/replay |
| V202 credentials | V2 candidate absent; no bot credential supplied | Select protected credential path, bound worker, revoke and leakage proof |
| V203 zero-cost model | Dani Free defaults retained; no paid fallback added | Exact permitted route's current zero price, stop on expiry/unavailability/429, no provider switch |
| V204 lightweight client | V2 inbox/viewer candidate absent | Actual inbox/draft/review/send plus unauthenticated/CSRF/replay/wrong-scope tests |
| V205 CLI installation | Existing specs/001-v2-channels covers a smaller installer repair | Versioned checksum artifact and clean install/start/stop/update/rollback/uninstall with retained data |
| V206 Slack | Candidate and approved workspace/pilot absent | Minimal scopes, exact live thread, reviewed send/receipt, reconnect/retry |
| V207 team workflow | V2 roster/authority candidate absent | Role changes invalidate approvals; private scope and permitted finished pilot task |
| V208 WhatsApp | Eligibility was blocked in the source issue | Current official eligibility/rates for chosen market, dedicated number, approved budget; no workaround |
| V209 phone | Deferred at the stated $0 budget | Owner-approved eligibility/quote, consented call, spend/time caps; no number purchased |
| V210 meetings | Platform/account/host consent not supplied | Supported real capture; visible admission/identity; speaking proven separately |
| V211 scoped actions | V2 candidate and pilot authority absent | Exact owner scope, isolated tasks, receipts/audit, injection/revocation proof |
| V212 full duplex | Same V1 live gate | Nonzero speech, transcript, Chief, audible reply, interruption, next turn and cleanup with timings |
| PTT-T02/T04/T05 | New hold-to-talk feature remains unimplemented; R4/R5 repair its prerequisites | Two-option persistent talk-key onboarding, gesture/mode/scope controller, durable enqueue receipts and task outcomes |
| PTT-A01-A13 | No native speech/gesture/latency acceptance claimed | All binary acceptance, owner pilot files/tasks and four-platform evidence from one build |
| Bops wishlist / computer use pilot | A product wishlist, with no new live pilot or safety/cost acceptance | Prioritized reliability work, verified action readback, explicit pilot scopes and measured outcomes; no claims copied from another product |
| Open Instinct OI-01-OI-29 / OI-T01-OI-T15 | Additional source-grounded proposal in the master issue; context-import repair covers part of its privacy prerequisite | Identity/audience/grants/effects, channels/apps/peers, optional hosting/payment decisions and native/live evidence; see open-instinct.md |

Remote prod-2 ends at 0e374fa and contains release/changelog changes. It is not the unpublished
gateway/Telegram/outbox/review/client candidate 395efae described in issue 15. That integration
cannot be reviewed or repaired without its source. Do not mark missing modules as completed.

This environment blocks the actual development app's local IPC socket. Before/after screenshots
and physical speech tests are therefore not available here. Unit mocks and --help are supporting
checks, never substitutes for native acceptance. Broader lint, typechecks, builds and suites run in CI.

Issue 1 must stay open until every required engineering and live/device gate passes. This PR must
not use an auto-close keyword for issue 1. Publishing this branch does not publish a release.
