# Provider implementation audit

The scan covered dependency imports and module references across src, apps, packages and remote. The cuts below were checked in the provider diff. This is not a claim that every file was reviewed.

1. delete: Remove the unreachable device-code menu and its false condition. The new ChatGPT path opens a browser. src/renderer/src/components/ProviderPicker.tsx
2. shrink: Use the existing bounded JSON reader for ChatGPT model discovery. Delete the second response-stream reader. src/main/chatgpt-plan-models.ts
3. delete: Remove the forwarding-only team WebRTC module after changing both imports to the existing package. src/renderer/src/features/team/team-webrtc-framing.ts
4. shrink: Use requireString's length argument instead of repeating its checks. src/main/ipc/chatgpt-plan-handlers.ts
5. delete: Remove comment essays in the changed provider files. Keep comments that explain security or process behavior.

The checked chart, QR, WebSocket and archive dependencies have real callers. No dependency was removed. JSON round trips in the frozen protocol adapters strip undefined properties and preserve their released wire shapes. structuredClone is not an equivalent replacement there.

## Acceptance still missing

The actual built window and the Claude key dialog were inspected before the owner's later restore request. They are evidence for that revision only. Claude/Grok's restored runtime controls need another build and native screenshot. ChatGPT still needs owner sign-in, inference, account switch, renewal, disconnect and restart proof. The chat voice sheet has a consent test but no completed pixel inspection or live call. M0 has no actual agent/job/restart proof.
