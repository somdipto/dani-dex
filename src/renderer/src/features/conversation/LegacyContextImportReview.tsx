import type { LocalContextImportScope } from "@dani-dex/contracts/context-import";
import { createStore, Show } from "solid-js";
import { Button, Textarea } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { adoptLegacyImport, legacyPendingImportTexts } from "./context-import-save";

/** Only a local owner's view mounts this review. Recovery never runs in a remote Chief panel. */
export function LegacyContextImportReview(props: { scope: LocalContextImportScope; onAdopt: () => void }) {
  const [state, setState] = createStore<{
    texts: string[];
    reviewing: LocalContextImportScope | null;
    error: string;
    adopting: boolean;
  }>({
    texts: legacyPendingImportTexts(),
    reviewing: null,
    error: "",
    adopting: false,
  });
  const scopeChanged = () => {
    const reviewed = state.reviewing;
    return (
      reviewed !== null &&
      (reviewed.accountId !== props.scope.accountId ||
        reviewed.serverId !== props.scope.serverId ||
        reviewed.agentId !== props.scope.agentId)
    );
  };
  return (
    <Show when={state.texts.length > 0}>
      <p role="status">Older imported memories have no saved account or destination. They are held on this computer.</p>
      <Button
        size="sm"
        variant="ghost"
        disabled={state.adopting}
        onClick={() =>
          setState((draft) => {
            draft.reviewing = state.reviewing ? null : { ...props.scope };
            draft.error = "";
          })
        }
      >
        Review older imports
      </Button>
      <Show when={state.reviewing}>
        <p>Destination: Chief on this computer, in the current account. Save only if these are your memories.</p>
        <Show when={scopeChanged()}>
          <p role="alert">The account or destination changed. Review the older import again.</p>
        </Show>
        <Textarea aria-label="Older imported memories" value={state.texts.join("\n\n")} readonly rows={6} />
        <Button
          size="sm"
          disabled={scopeChanged() || state.adopting}
          onClick={async () => {
            if (state.adopting) return;
            setState((draft) => {
              draft.adopting = true;
            });
            try {
              const reviewed = state.reviewing;
              if (
                !reviewed ||
                reviewed.accountId !== props.scope.accountId ||
                reviewed.serverId !== props.scope.serverId ||
                reviewed.agentId !== props.scope.agentId
              ) {
                throw new Error("The account or destination changed. Review the older import again.");
              }
              await adoptLegacyImport(reviewed, state.texts);
              setState((draft) => {
                draft.texts = [];
              });
              props.onAdopt();
            } catch (error) {
              setState((draft) => {
                draft.error = errorMessage(error, "The older import could not be moved. It is still held.");
              });
            } finally {
              setState((draft) => {
                draft.adopting = false;
              });
            }
          }}
        >
          Keep for this local Chief
        </Button>
        <Show when={state.error && !scopeChanged()}>
          <p role="alert">{state.error}</p>
        </Show>
      </Show>
    </Show>
  );
}
