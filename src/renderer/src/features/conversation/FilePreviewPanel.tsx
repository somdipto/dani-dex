import type { FilePreview } from "@dani-dex/contracts/ipc";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { PanelResizer, readPanelWidth, savePanelWidth } from "../../components/PanelResizer";
import { Button, Download, ExternalLink, File, FolderOpen, X } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { MarkdownFilePreview } from "./MarkdownFilePreview";
import { SpreadsheetFilePreview } from "./SpreadsheetFilePreview";

const PANEL_STORAGE_KEY = "danidex:browser-panel-width";
const PANEL_MIN = 220;
const PANEL_MAX = 1600;
const TEXT_LIMIT = 1_000_000;
/** Kinds the panel hands to the browser as an object URL instead of decoding itself. */
const BLOB_PREVIEW_KINDS = new Set<FilePreview["previewKind"]>(["image", "pdf", "audio", "video"]);

interface FilePreviewPanelProps {
  preview: FilePreview;
  agents: AgentProfile[];
  defaultWidth: () => number;
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onOpenLink: (url: string) => void;
  onOpenSharedFile: (path: string) => void;
  onOpenWorkspaceFile: (path: string) => void;
  /** Set when the file already has a URL the panel can point at, as an attachment does. */
  sourceUrl?: string | null;
  onOpenExternally: () => void;
  /** Present for an attachment, which the user can also save or locate. A file already has a path. */
  onDownload?: () => void;
  onReveal?: () => void;
  onClose: () => void;
}

export default function FilePreviewPanel(props: FilePreviewPanelProps) {
  const defaultPanelWidth = () => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, props.defaultWidth())));
  const [panelWidth, setPanelWidth] = createSignal(
    readPanelWidth(PANEL_STORAGE_KEY, defaultPanelWidth(), PANEL_MIN, PANEL_MAX),
  );
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  // The panel mounts when a file opens, so it has to paint its closed state
  // first. Two frames guarantee that paint before the open state applies.
  const [revealed, setRevealed] = createSignal(false);
  let currentPreviewUrl: string | null = null;
  const [mediaFailure, setMediaFailure] = createSignal(false);
  createEffect(
    () => ({ preview: props.preview }),
    () => {
      setMediaFailure(false);
    },
  );
  const binaryFallback = createMemo(() => {
    const bytes = props.preview.bytes?.subarray(0, 4096);
    if (!bytes) return "No raw bytes were supplied; file metadata is shown above.";
    return Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => {
      const offset = row * 16;
      return `${offset.toString(16).padStart(8, "0")}  ${Array.from(bytes.subarray(offset, offset + 16), (value) => value.toString(16).padStart(2, "0")).join(" ")}`;
    }).join("\n");
  });
  const text = createMemo(() => {
    if (!props.preview.bytes || (props.preview.previewKind !== "text" && props.preview.previewKind !== "markdown")) {
      return { value: "", truncated: false };
    }
    const value = new TextDecoder().decode(props.preview.bytes);
    return { value: value.slice(0, TEXT_LIMIT), truncated: value.length > TEXT_LIMIT };
  });

  createEffect(
    () => panelWidth(),
    (width) => {
      props.onWidthChange(width);
    },
  );
  createEffect(
    () => ({ preview: props.preview, sourceUrl: props.sourceUrl }),
    ({ preview, sourceUrl }) => {
      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
      if (sourceUrl && BLOB_PREVIEW_KINDS.has(preview.previewKind)) {
        setPreviewUrl(sourceUrl);
        return;
      }
      if (!preview.bytes || !BLOB_PREVIEW_KINDS.has(preview.previewKind)) {
        setPreviewUrl(null);
        return;
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(preview.bytes).buffer], { type: preview.mimeType }));
      currentPreviewUrl = url;
      setPreviewUrl(url);
    },
  );
  onCleanup(() => {
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  });

  let revealFrame = 0;
  onCleanup(() => cancelAnimationFrame(revealFrame));
  const revealPanel = () => {
    revealFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        setRevealed(true);
      });
    });
  };

  const resizeDefaultPanel = () => {
    setPanelWidth(Math.round(Math.min(props.maxWidth(), Math.max(PANEL_MIN, defaultPanelWidth()))));
  };

  return (
    <aside
      ref={revealPanel}
      id="file-preview-panel"
      class="browser-panel file-preview-panel t-panel-slide"
      data-open={revealed() ? "true" : "false"}
      aria-label="File preview"
    >
      <PanelResizer
        class="right-panel-resizer"
        label="Resize file preview"
        controls="file-preview-panel"
        direction="right"
        value={panelWidth()}
        defaultValue={defaultPanelWidth()}
        min={PANEL_MIN}
        max={props.maxWidth}
        onResize={setPanelWidth}
        onResizeEnd={(width) => savePanelWidth(PANEL_STORAGE_KEY, width)}
        onParentResize={resizeDefaultPanel}
        onReset={() => {
          window.localStorage.removeItem(PANEL_STORAGE_KEY);
          setPanelWidth(defaultPanelWidth());
        }}
      />
      <header class="file-preview-header">
        <File class="file-preview-file-icon" />
        <h2 title={props.preview.name}>{props.preview.name}</h2>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button"
          aria-label="Open file externally"
          onClick={props.onOpenExternally}
        >
          <ExternalLink class="browser-toolbar-icon" />
        </Button>
        <Show when={props.onDownload}>
          {(download) => (
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label="Download file"
              onClick={() => download()()}
            >
              <Download class="browser-toolbar-icon" />
            </Button>
          )}
        </Show>
        <Show when={props.onReveal}>
          {(reveal) => (
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label="Show file in Finder"
              onClick={() => reveal()()}
            >
              <FolderOpen class="browser-toolbar-icon" />
            </Button>
          )}
        </Show>
        <Button
          variant="ghost"
          type="button"
          class="browser-toolbar-button"
          aria-label="Close file preview"
          onClick={props.onClose}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <div class="file-preview-content">
        <Show when={mediaFailure()}>
          <section aria-label="Media file inspection" style={{ padding: "16px" }}>
            <p>This media codec could not be decoded. Internal file inspection:</p>
            <p>
              {props.preview.mimeType} · {props.preview.size.toLocaleString()} bytes
            </p>
            <pre class="file-preview-text">{binaryFallback()}</pre>
          </section>
        </Show>
        <Show when={props.preview.directory}>
          {(directory) => (
            <section aria-label="Folder contents" style={{ padding: "16px" }}>
              <p style={{ "overflow-wrap": "anywhere" }}>{directory().path}</p>
              <Show when={directory().entries.length === 0}>
                <p>This folder is empty.</p>
              </Show>
              <ul style={{ "list-style": "none", padding: "0" }}>
                <For each={directory().entries}>
                  {(entry) => (
                    <li>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => props.onOpenWorkspaceFile(entry.path)}
                        aria-label={`Preview ${entry.isDirectory ? "folder" : "file"} ${entry.name}`}
                      >
                        <Show when={entry.isDirectory} fallback={<File />}>
                          <FolderOpen />
                        </Show>
                        {entry.name}
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={directory().truncated}>
                <p>Showing the first 500 entries.</p>
              </Show>
            </section>
          )}
        </Show>
        <Show when={props.preview.previewKind === "markdown"}>
          <MarkdownFilePreview
            class="file-preview-markdown"
            renderedClass="message-markdown"
            statusClass="file-preview-markdown-status"
            truncatedClass="file-preview-truncated"
            body={text().value}
            truncated={text().truncated}
            agents={props.agents}
            onSelectAgent={() => undefined}
            onOpenLink={props.onOpenLink}
            onOpenSharedFile={props.onOpenSharedFile}
            onOpenWorkspaceFile={props.onOpenWorkspaceFile}
          />
        </Show>
        <Show when={props.preview.previewKind === "text"}>
          <pre class="file-preview-text">{text().value}</pre>
          <Show when={text().truncated}>
            <p class="file-preview-truncated">Preview truncated after 1,000,000 characters.</p>
          </Show>
        </Show>
        <Show when={props.preview.previewKind === "image" && previewUrl()}>
          <div class="file-preview-image-wrap">
            <img
              class="file-preview-image"
              src={previewUrl() ?? ""}
              alt={props.preview.name}
              onError={() => setMediaFailure(true)}
            />
          </div>
        </Show>
        <Show when={props.preview.previewKind === "pdf" && previewUrl()}>
          <iframe class="file-preview-pdf" title={props.preview.name} src={previewUrl() ?? ""} />
        </Show>
        <Show when={props.preview.previewKind === "audio" && previewUrl()}>
          <audio class="file-preview-audio" controls onError={() => setMediaFailure(true)} src={previewUrl() ?? ""}>
            {/* A file on the user's computer carries no caption track. The empty element declares
                that, which browsers ignore, and keeps the media-caption rule satisfied. */}
            <track kind="captions" />
          </audio>
        </Show>
        <Show when={props.preview.previewKind === "video" && previewUrl()}>
          <video class="file-preview-video" controls onError={() => setMediaFailure(true)} src={previewUrl() ?? ""}>
            <track kind="captions" />
          </video>
        </Show>
        <Show when={props.preview.previewKind === "spreadsheet"}>
          <SpreadsheetFilePreview class="file-preview-spreadsheet" bytes={props.preview.bytes} />
        </Show>
        <Show when={props.preview.previewKind === "none" && !props.preview.directory}>
          <section aria-label="File inspection" style={{ padding: "16px" }}>
            <p>
              {props.preview.mimeType} · {props.preview.size.toLocaleString()} bytes
            </p>
            <pre class="file-preview-text">
              {props.preview.inspection ??
                "No file bytes are available. This panel still shows the file name, type and size."}
            </pre>
            <Show when={props.preview.truncated}>
              <p>Large file: showing a bounded preview of the first 8 MiB.</p>
            </Show>
          </section>
        </Show>
      </div>
    </aside>
  );
}
