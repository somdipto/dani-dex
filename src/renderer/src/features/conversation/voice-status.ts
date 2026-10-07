import type { AppInfo } from "@dani-dex/contracts/ipc";
import { errorMessage } from "../../error-message";
import type { VoiceCallPhase } from "../voice-call/voice-call-store";
export type VoicePhase = "idle" | "preparing" | "requesting" | "recording" | "transcribing";

export function voiceButtonLabel(phase: VoicePhase) {
  if (phase === "recording") return "Stop voice recording";
  if (phase === "preparing") return "Downloading voice model";
  if (phase === "requesting") return "Requesting microphone access";
  if (phase === "transcribing") return "Transcribing voice prompt";
  return "Create prompt with voice";
}

/**
 * All three desktop packages carry a matching local runtime. A missing executable/model is still
 * checked by main before capture; an unknown platform never appears ready.
 */
export function voiceSupported(platform: AppInfo["platform"] | undefined): boolean {
  return platform === "darwin" || platform === "win32" || platform === "linux";
}

export function formatVoiceDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function voiceCaptureError(error: unknown) {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access is blocked. Allow Dani-Dex to use the microphone in system settings.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone is available.";
  return "Dani-Dex could not start voice recording.";
}

export function voiceTranscriptionError(error: unknown): string {
  return errorMessage(error, "Dani-Dex could not transcribe this recording.");
}

export function voiceCallStatusLabel(phase: VoiceCallPhase) {
  switch (phase) {
    case "connecting":
      return "Connecting...";
    case "listening":
      return "Listening";
    case "thinking":
      return "Working on it";
    case "speaking":
      return "Speaking";
    default:
      return "";
  }
}
