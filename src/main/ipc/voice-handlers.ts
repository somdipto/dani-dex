// The local Whisper model, dictation, and Realtime call credentials.

import type { RealtimeVoiceSession, VoiceModelStatus, VoiceTranscriptionResult } from "@dani-dex/contracts/ipc";
import type { OpenAiRealtimeSessionService } from "../openai-realtime-session";
import type { VoiceTranscriptionService } from "../voice-transcription-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseVoiceTranscription } from "./voice-inputs";

export interface VoiceIpcDependencies {
  voice: VoiceTranscriptionService;
  realtime: Pick<OpenAiRealtimeSessionService, "create">;
}

export function voiceIpcHandlers({ voice, realtime }: VoiceIpcDependencies): Pick<IpcGroupHandlers, "voice"> {
  return {
    voice: {
      getModelStatus: handler((): Promise<VoiceModelStatus> => voice.getModelStatus()),
      prepareModel: handler((): Promise<VoiceModelStatus> => voice.prepareModel()),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        (transcription): Promise<VoiceTranscriptionResult> => voice.transcribe(transcription.audio),
      ),
      createRealtimeSession: handler((): Promise<RealtimeVoiceSession> => realtime.create()),
    },
  };
}
