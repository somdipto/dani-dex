import { ProviderLogo } from "@dani-dex/brand";
import { Show } from "solid-js";
import { OpenCodeKeyDialog } from "../features/settings/OpenCodeKeyDialog";
import { useProviders } from "../providers";
import { Button, Dialog } from "./ui";
export function ProviderConnectionDialogs() {
  const providers = useProviders();
  return (
    <>
      <Show when={providers.apiKeyProvider()}>
        {(provider) => <OpenCodeKeyDialog provider={provider()} api={window.danidex} onClose={providers.closeApiKey} />}
      </Show>
      <Dialog.Root
        open={providers.chatGptConnecting()}
        onOpenChange={(open) => {
          if (!open) providers.cancelChatGpt();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="provider-code-login-backdrop">
            <Dialog.Content class="provider-code-login-dialog">
              <Dialog.Title><span class="voice-auth-brand"><ProviderLogo provider="codex" /> Sign in with OpenAI / ChatGPT</span></Dialog.Title>
              <Dialog.Description>
                Finish signing in in your browser. Allow model access to use your ChatGPT plan. Dani-Dex does not need
                its own account.
              </Dialog.Description>
              <Button onClick={providers.cancelChatGpt}>Cancel sign-in</Button>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
