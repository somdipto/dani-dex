# 03: Lightweight onboarding

Problem: owner's screenshot showed Claude identity collapsed vertically, long Keychain warning and overlapping Next.

## Acceptance criteria

- Dani Free is the clear recommended default; other providers optional. Never expose hidden underlying model names or invent provider sign-in.
- One compact identity/status row and one primary action per provider. Secondary actions under disclosure. Long errors start as one short actionable line with expandable full details.
- Full provider names readable at owner's actual window size and small viewport. No horizontal overflow, one-letter wrapping or overlapping controls.
- Next remains in a separate footer layout row while content scrolls. Keyboard focus can reach every control and errors. Disabled Next has a reason.
- Provider sign-in/download/cancel/API-key flows remain accessible. No2D character fallback; preserve neutral unavailable state.

## Evidence checklist

Native fresh-profile screenshots at normal and small sizes with connected/default, missing provider, long error and in-progress download. Click every primary/secondary action. Run picker and onboarding tests without dropping failures. Supporting CSS reproduction is not app proof.

Status: QUEUED. ec1b0cfd +3f5e3db0 handed to parent, executor instructed to wait until owner trial ends. No native acceptance recorded here. Two pre-existing onboarding test failures remain open: old version expectation and code-signin menu absence. Both reproduced with pre-change picker; not excuses to exclude them.
