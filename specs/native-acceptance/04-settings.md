# 04: Stable settings and engine admission

Problem: choices reset across reload and trial engine did not match prepared selection.

## Acceptance criteria

- Explicit TTS/STT changes save immediately and survive sheet close, hot reload and full application restart.
- The selected values never change without user input. Auto is a distinct explicitly selected mode, not permission to alter System/Kokoro or English/multilingual/native selections.
- UI choice, persisted preference and active engine agree. Show actual engine and readiness. A persisted choice is not proof its model/helper/permission is ready.
- Install completion cannot overwrite a newer selection. Switching during install is disabled or generation-fenced. Failure leaves chosen value unchanged and Start disabled with reason.
- Permission revoked or missing helper cannot cause unexpected Apple server use. Other profiles remain isolated.

## Evidence checklist

Regression: restore choices, change, remount, failed installation and late completion. Native: selected settings before/after hot reload and GUI app restart, then inspect actual selected engine used by a synthetic fixture. Record screenshot and preference readback.

Status: QUEUED.0c80d50a persistence patch +ff37a367 regression sent;7dialog tests pass on supporting environment. Mac application deferred by parent during owner trial, not accepted.
