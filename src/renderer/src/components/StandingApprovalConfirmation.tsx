import { AlertDialog, Button } from "./ui";

/** Explains the same standing grant from the approval card and the model picker. */
export function StandingApprovalConfirmation(props: {
  open: boolean;
  agentName?: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusTarget?: HTMLElement;
}) {
  let cancelButton: HTMLButtonElement | undefined;
  return (
    <AlertDialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="approval-confirm-backdrop">
          <AlertDialog.Content
            class="approval-confirm-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelButton?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              props.restoreFocusTarget?.focus({ preventScroll: true });
            }}
          >
            <AlertDialog.Title>Always allow {props.agentName ?? "this agent"}?</AlertDialog.Title>
            <AlertDialog.Description>
              {props.agentName ?? "This agent"} can read, change or delete accessible files, run commands and use apps
              and network on this computer without asking again. This includes access outside its workspace and can
              expose private data or damage files. OS permissions and provider restrictions still apply. Public-site
              changes require the global Allow all mode. Turn off Auto approve in this agent's model menu to revoke
              future access; actions already taken are not undone.
            </AlertDialog.Description>
            <div class="approval-confirm-actions">
              <Button ref={cancelButton} variant="outline" type="button" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button variant="default" type="button" onClick={props.onConfirm}>
                Always allow
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
