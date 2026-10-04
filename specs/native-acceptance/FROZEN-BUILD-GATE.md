# Single frozen-build acceptance gate

Run only when specs01-04 have candidate repairs. This is explicit integration acceptance, not a routine request for broad checks.

1. Identify canonical Mac repo, branch, source fingerprint, app bundle/profile/port, OS/CPU. Save SHA manifest of changed files and patch inventory. Check no missing/superseded hunk. No commits needed to fingerprint a dirty tree.
2. Stop only owned obsolete build/test processes. Freeze source writes and watcher changes for this run. Do not touch owner's other windows/apps. Verify user data preserved.
3. Run focused tests and relevant typecheck sequentially. Record failures; do not widen timeout/exclude. Build the exact snapshot, launch in GUI session with correct signed identity and purpose strings.
4. Fresh-profile onboarding: default Dani Free, optional provider error collapsed, no clipped identity, footer no overlap. Inspect actual screenshots.
5. Settings: choose supported STT/TTS, admit models/helper/permission explicitly, close/reopen/restart, verify unchanged choices and actual engine.
6. Voice: permission/capture non-zero with deliberate speech -> transcript -> ordinary Chief -> audible reply -> speaker-on interruption -> next utterance -> end-call/quit cleanup. Record stage timings and accuracy, no private speech storage by default.
7. Files: real local folder/child, text/CSV, image, PDF, XLSX, DOCX/PPTX, ZIP, binary. Verify pixels/content, large/corrupt bounded fallback; explicit external action optional only; remote containment regression.
8. Report PASS only when all required criteria/evidence match the same fingerprint. Any failure is BLOCKED/OPEN, with exact boundary and next single experiment. User retest confirms usability; it does not replace prior device proof.

Evidence record template:
Date/time | repo/profile | source fingerprint | specification/criterion | command or native action | result | observed artifact/log reference | caveat | next owner.

Do not call a trial full acceptance. Do not manufacture links or files that were not produced.
