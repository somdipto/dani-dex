import { VoiceSetupDialog } from "../src/features/voice-call/VoiceSetupDialog";
export default { title: "Voice/Setup", component: VoiceSetupDialog };
export const Linux = {
  render: () => (
    <VoiceSetupDialog
      open
      localSupported={false}
      onClose={() => {}}
      onLocalDictation={() => {}}
      onOpenAiCall={() => {}}
    />
  ),
};
