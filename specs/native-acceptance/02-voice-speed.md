# 02: Voice speed, duplex and barge-in

Problem: parent-relayed settled live-app synthetic measurements:3.48s input took11.13s tiny transcription; system TTS10.57s for2.71s output. These override earlier optimistic standalone results. They are separate stages, not measured complete-turn latency.

## Acceptance criteria

- Timestamp endpoint, transcript, Chief dispatch/reply, first PCM, playback completion and barge-to-silence separately. Record cold/warm runs and competing load.
- Initial product targets: endpoint-to-transcript<=1.5s; reply-to-first-audio<=1s; TTS RTF<=0.7; barge-to-silence<=150ms. These are gates to meet, not numbers to promise. Budget changes require explicit documented product decision, never test edits alone.
- Capture remains active during reasoning/speech. Speaking over output interrupts stale STT/TTS and prevents old output resuming. At most one lookahead chunk; bounded capture/queue.
- On-device Apple STT guards availability and supportsOnDeviceRecognition and sets requiresOnDeviceRecognition=true. Permission requested only on explicit admission. No silent cloud fallback.
- Native/system voice and English tiny/multilingual base choices explicit. Never silently narrow language or weaken accuracy to win a speed benchmark. Auto modes show measured choice and retain provenance.
- Ten-second silence produces no submitted hallucination. At least three distinct sentences and one correction/interruption succeed. Speaker echo test passes on owner's Mac, not only headphones.
- If budgets fail, offer push-to-talk with honest limits; do not present as natural full duplex.

## Evidence checklist

Actual GUI app IPC path, same fixture across engines, stage timings and accuracy; native microphone journey; offline audio engine test after installation; worker/helper packaged resolution; cancellation and quit test. Software mocks only cover lifecycle contracts. Endpointed WAV STT is not partial streaming recognition. Final-answer TTS is not Chief token streaming.

Status: OPEN. Native helper compiled/admission and acoustic acceptance remain unverified in this ledger.
