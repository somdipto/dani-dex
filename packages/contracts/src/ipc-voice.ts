export const VOICE_AUDIO_LIMITS = {
  sampleRate: 16_000,
  channels: 1,
  bitsPerSample: 16,
  maximumSeconds: 120,
  maximumWavBytes: 3_840_044,
} as const;

export interface VoiceTranscriptionInput {
  audio: Uint8Array;
}

export interface VoiceTranscriptionResult {
  text: string;
}

/** A short-lived browser credential for one OpenAI Realtime call; never the user's API key. */
export interface RealtimeVoiceSession {
  clientSecret: string;
  expiresAt: number;
  model: string;
}

export type VoiceModelPhase = "missing" | "downloading" | "ready" | "error";

export interface VoiceModelStatus {
  phase: VoiceModelPhase;
  progress: number | null;
  message: string | null;
}
