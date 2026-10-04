# 01: Microphone input and truthful call state

Problem: owner reports voice does not listen. Executor probes reported getUserMedia/AudioContext/worklet live at48kHz but all frames zero, with processing on and off. OS volume45 and Chromium granted are not proof of audible capture. SSH versus GUI/TCC launch attribution is an unresolved hypothesis, not root cause.

## Acceptance criteria

- App launched in owner's GUI session with its correct bundle identity and microphone purpose string. Permissions inspected without resetting unrelated grants.
- Explicit call-start obtains the requested live input track. Device, sample rate, processing settings and permission error are visible in bounded diagnostics.
- Five-second test with owner speaking produces non-zero PCM and VAD onset. Quiet input does not produce speech events. Track mute/end/permission denial yields actionable state, not false 'Listening'.
- User utterance yields the intended transcript and ordinary Chief message; response is audible. No self-transcript from speaker output.
- Ending call stops every capture track and worklet, releases output peers and child processes. No retained audio or continuing capture.

## Tests/evidence

Unit: late permission completion after stop, worklet failure, track end, mute, silence, VAD onset, canceled transcript.
Native: raw analyser versus worklet, processing on/off, explicit built-in device, GUI versus SSH launch. Record levels/counts, not speech content. Change one variable at a time. Stop probe immediately.
Required evidence: launch provenance, permission/track settings, non-zero RMS while speaking, VAD/transcript events, native screenshot and end-call cleanup. Silence alone cannot distinguish quiet room from failed capture; request a deliberate spoken test.

Status: BLOCKED/INVESTIGATING. Do not treat TCC hypothesis as a confirmed repair.
