# Dani-Dex spec-driven repair kit

Owner: Somdipto Nandy. Scope: local V1 repair. Native acceptance environment: owner's Intel Mac. No deployment, commit or push is authorized by this kit. Branch decision remains open. The request is to fix the product, not to collect green tests.

## Operating order

1. Microphone input and truthful call state.
2. Voice speed and interruption.
3. Onboarding usability.
4. Settings persistence.
5. Reconcile all changes and run one frozen-build acceptance journey.

Read each spec before changing its domain. Reproduce the failure, make one bounded repair, run narrow tests, mirror the exact patch to the Mac, freeze a source snapshot, then prove the native behavior. A hypothesis is not a finding. A mocked API is not device evidence. Do not change a budget, remove a case or suppress a warning to make acceptance green.

## Done definition

A feature is done only when its acceptance criteria pass on the actual Mac and its evidence is recorded for the same frozen source snapshot. Compilation, test count, available button, displayed 'Listening', successful process launch and synthetic PCM each prove only their own layer. 'Ready for a trial' is not 'working'. A user trial that fails reopens the spec immediately.

No normal claim of 'ready', 'fixed', 'complete' or 'full duplex' before the relevant native gate. If hardware or permission blocks a criterion, name the blocker and offer an honest degraded mode. Do not ask the owner to discover unreported known failures.

## Evidence handling

Record time, exact source fingerprint, app port/profile, OS/CPU, test command and result, native screenshots, timings and failure logs. Keep credentials, account data, conversations and recorded speech out of shared logs. Use a synthetic fixture for screenshots whenever possible. Mic tests keep only levels/counts unless the owner approves retaining audio. Permission status is evidence, not consent to record indefinitely.

See FROZEN-BUILD-GATE.md and STATUS.md. Update status from actual results, never from intended next steps.

## Relationship to the existing recovery kit

`../001-product-recovery/spec.md` remains the inherited master recovery scope, with its tasks/issue-ledger/traceability. This folder is the October4 native-failure acceptance addendum, not a replacement backlog. Specs01/02 refine US3/FR004-006/T007-010, specs03/04 cover current onboarding/settings failures, and specs05/06 strengthen US1/US6/T001/T004/T016-018. Preserve all other inherited work, including offline Skills, actual3D/Arc and issue reconciliation. Do not mark the master task complete because this folder exists.

Conflicting old behavior: old text says the first voice icon starts installation. Current implemented safety rule opens choices without side effects; explicit installation/admission follows. The current owner wants a usable local duplex path, not an automatic provider sign-in. Record this boundary in master acceptance rather than silently restoring install/auth on opening a sheet.
