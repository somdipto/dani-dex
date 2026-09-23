import type { UpdateStatus } from "@dani-dex/contracts/ipc";
import { isUpdateActivePhase, isUpdateBusyPhase } from "@dani-dex/contracts/ipc";

export interface UpdateStatusPresentation {
  actionLabel: string;
  available: boolean;
  busy: boolean;
  detail: string;
  supported: boolean;
  /** The host installs updates for every tenant: status stays visible, actions stay disabled. */
  managed: boolean;
}

export function presentUpdateStatus(status: UpdateStatus): UpdateStatusPresentation {
  const available = isUpdateActivePhase(status.phase);
  const busy = isUpdateBusyPhase(status.phase);
  const managed = status.managedByHost === true;
  let actionLabel = "Check for updates";

  switch (status.phase) {
    case "checking":
      actionLabel = "Checking for updates…";
      break;
    case "available":
      actionLabel = "Download update";
      break;
    case "downloading":
      actionLabel = "Downloading update…";
      break;
    case "ready":
      actionLabel = "Restart to update";
      break;
    case "installing":
      actionLabel = "Restarting…";
      break;
    case "error":
      // A failed download is retried in place rather than sending the user back through a check. A
      // failed install is not retryable: shutdown preparation has already run, so the message asks
      // for a relaunch and the action falls back to checking.
      if (status.errorCode === "download_failed") actionLabel = "Retry download";
      break;
  }

  let detail = "";
  if (status.phase === "downloading" && status.progress !== null) detail = `${Math.round(status.progress)}%`;
  else if (status.availableVersion) {
    // A build that cannot replace itself sends the user to the download page, so it says so up front.
    detail =
      status.manualDownload && status.phase === "available"
        ? `v${status.availableVersion} - opens the download page`
        : `v${status.availableVersion}`;
  } else if (status.phase === "up-to-date") detail = "Up to date";
  else if (status.currentVersion) detail = `v${status.currentVersion}`;

  return {
    actionLabel: managed ? "Managed by host" : actionLabel,
    available,
    busy,
    detail,
    supported: status.phase !== "unsupported",
    managed,
  };
}
