// The local Whisper model, dictation, and Realtime call credentials.

import type {
  ProviderApiKeyStatus,
  RealtimeVoiceSession,
  VoiceModelStatus,
  VoiceTranscriptionResult,
} from "@dani-dex/contracts/ipc";
import { isString } from "@dani-dex/contracts/runtime-values";
import type { OpenAiRealtimeSessionService } from "../openai-realtime-session";
import { type ProviderCredentialStore, REALTIME_CREDENTIAL_ID } from "../provider-credential-store";
import type { VoiceTranscriptionService } from "../voice-transcription-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseVoiceTranscription } from "./voice-inputs";

/** Long enough for any OpenAI key, short enough that nothing large reaches the cipher. */
const MAX_REALTIME_API_KEY_LENGTH = 512;

export interface VoiceIpcDependencies {
  voice: VoiceTranscriptionService;
  realtime: Pick<OpenAiRealtimeSessionService, "create">;
  credentials: Pick<ProviderCredentialStore, "set" | "clear" | "status">;
}

export function voiceIpcHandlers({
  voice,
  realtime,
  credentials,
}: VoiceIpcDependencies): Pick<IpcGroupHandlers, "voice"> {
  return {
    voice: {
      getModelStatus: handler((): Promise<VoiceModelStatus> => voice.getModelStatus()),
      prepareModel: handler((): Promise<VoiceModelStatus> => voice.prepareModel()),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        (transcription): Promise<VoiceTranscriptionResult> => voice.transcribe(transcription.audio),
      ),
      createRealtimeSession: handler((): Promise<RealtimeVoiceSession> => realtime.create()),
      // A status, never the key, as with provider keys.
      setRealtimeApiKey: payloadHandler(parseRealtimeApiKey, async (key): Promise<ProviderApiKeyStatus> => {
        await credentials.set(REALTIME_CREDENTIAL_ID, key);
        return credentials.status(REALTIME_CREDENTIAL_ID);
      }),
      clearRealtimeApiKey: handler(async (): Promise<ProviderApiKeyStatus> => {
        await credentials.clear(REALTIME_CREDENTIAL_ID);
        return credentials.status(REALTIME_CREDENTIAL_ID);
      }),
      getRealtimeApiKeyStatus: handler(
        async (): Promise<ProviderApiKeyStatus> => credentials.status(REALTIME_CREDENTIAL_ID),
      ),
    },
  };
}

/** The one place the user's OpenAI key enters the main process from the renderer. */
export function parseRealtimeApiKey(value: unknown): string {
  if (!isString(value) || !value.trim()) throw new Error("An OpenAI API key is required.");
  if (value.length > MAX_REALTIME_API_KEY_LENGTH) throw new Error("The OpenAI API key is too long.");
  return value.trim();
}
