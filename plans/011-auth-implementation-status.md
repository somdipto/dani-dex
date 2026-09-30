# Provider implementation status

This is local work. No pull request, release, merge or live paid test exists.

## Source checks

ChatGPT has a real loopback callback, state and PKCE checks, signed identity verification, encrypted storage, selected-account persistence, refresh-token rotation and a driver that passes the selected token only to its child. Its model list comes from the account catalog. The renderer receives account summaries, not tokens.

The auth suite passed 38 tests. The child-process test passed. Narrow auth and provider type checks passed. Existing Claude, Grok and provider-input tests passed 72 tests before the latest restore edits. Those are source checks, not live provider acceptance.

## Actual app checks

A production build before the restore request passed. The native 1200x712 window showed the approved robot and the direct ChatGPT button. The Claude API-key button opened the actual key dialog. Both screenshots were inspected.

The owner then asked to restore Claude and Grok, with API keys optional. Their Download controls and included-runtime descriptions are restored locally. Grok uses its previous login when no API key is stored. A separate Optional API key button opens the key dialog. Picker tests for this revision pass. A later separated local production build exited 0 on September 30. The renderer build took 12.66 seconds. The actual Electron window at 1200x712 showed restored Claude/Grok Download controls and separate Optional API key actions. The Claude optional-key button opened its dialog. The screenshots were inspected.

Claude.ai subscription login requires Anthropic permission for third-party use. Restoring the runtime does not establish that permission. Its subscription login action remains blocked. The API key is optional in the UI but is currently the supported credential route.

## Open work

- Complete real owner ChatGPT sign-in and text inference.
- Prove account switching, renewal, disconnect and restart with existing threads.
- Wire running-process renewal and credential removal without disrupting an active turn.
- Add structured provider quota, revocation and recovery errors.
- Resolve Sign in with ChatGPT distribution eligibility without changing LICENSE or NOTICE.
- Finish xAI voice and local full-duplex support. The current sheet offers local dictation and paid OpenAI API calls, not subscription voice.
- Inspect the voice sheet and exercise it from a real chat. Its consent test passes, but the visual preview stalled.
- Complete M0 agent creation, job output and restart proof. No real agent/job proof exists.
- Run the full workspace checks. The broad typecheck did not finish on this host.

The host repeatedly stopped returning commands while concurrent preview or renderer processes ran. Owned previews were stopped and read back. No unrelated process was killed. The completion bar remains unmet.
