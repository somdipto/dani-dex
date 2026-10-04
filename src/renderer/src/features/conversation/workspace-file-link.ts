/** A UI link filter, not an authorization boundary. The host still checks realpath containment. */
export function workspaceFileLinkAllowed(path: string, root: string | undefined): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || /[\0\r\n]/u.test(normalized) || normalized.startsWith("//")) return false;
  // Relative links resolve under the workspace. Never offer a traversal as a workspace link.
  if (!/^(?:\/|~\/|[A-Za-z]:\/)/u.test(normalized)) {
    let depth = 0;
    for (const part of normalized.split("/")) {
      if (part === "..") {
        if (--depth < 0) return false;
      } else if (part && part !== ".") depth += 1;
    }
    return true;
  }
  if (!root) return false;
  const base = root.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!normalized.startsWith(`${base}/`)) return false;
  return workspaceFileLinkAllowed(normalized.slice(base.length + 1), undefined);
}
