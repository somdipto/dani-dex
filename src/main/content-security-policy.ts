import { isMobileConnectDevelopmentHost } from "@dani-dex/contracts/mobile-connect";
import { DANI_DEX_ANALYTICS_API_URL, DANI_DEX_TEAM_HOST_SUFFIX } from "@dani-dex/contracts/online-services";

export function buildContentSecurityPolicy(packaged: boolean, developmentSignalUrl?: string): string {
  const developmentSources = packaged
    ? ""
    : ` http://localhost:* ws://localhost:*${developmentSignalSource(developmentSignalUrl)}`;
  const developmentImageSources = packaged ? "" : " http://127.0.0.1:* http://localhost:*";
  // Only services Dan Lab runs are allowed out. Each is empty while its origin is unset.
  const analyticsSource = DANI_DEX_ANALYTICS_API_URL === null ? "" : ` ${new URL(DANI_DEX_ANALYTICS_API_URL).origin}`;
  const teamHostSocketSource = DANI_DEX_TEAM_HOST_SUFFIX === null ? "" : ` wss://*${DANI_DEX_TEAM_HOST_SUFFIX}`;
  const teamHostFrameSource = DANI_DEX_TEAM_HOST_SUFFIX === null ? "" : ` https://*${DANI_DEX_TEAM_HOST_SUFFIX}`;

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: dani-dex-attachment: dani-dex-remote-attachment: dani-dex-avatar: dani-dex-remote-avatar: dani-dex-server-logo: dani-dex-remote-server-logo: https:${developmentImageSources}`,
    "font-src 'self' data:",
    // The lightbox plays a recording from the attachment scheme, and the preview panel plays one
    // from an object URL of the bytes that the main process sent. Neither matches `default-src`.
    "media-src 'self' blob: dani-dex-attachment: dani-dex-remote-attachment:",
    `connect-src 'self' dani-dex-attachment: dani-dex-remote-attachment:${analyticsSource} ws://127.0.0.1:*${teamHostSocketSource}${developmentSources}`,
    "object-src 'none'",
    // The remote desktop viewer uses a loopback proxy in packaged apps too.
    `frame-src 'self' dani-dex-attachment: dani-dex-remote-attachment:${teamHostFrameSource} http://127.0.0.1:* http://localhost:*`,
    "base-uri 'none'",
  ].join("; ");
}

function developmentSignalSource(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "ws:" ||
      !isMobileConnectDevelopmentHost(url.hostname) ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return "";
    }
    return ` ${url.origin}`;
  } catch {
    return "";
  }
}
