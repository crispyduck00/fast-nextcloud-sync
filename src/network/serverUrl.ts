// Splits the configured Server URL at its Nextcloud DAV entry point (docs/spec.md §3).

/** What the Server URL says about the Nextcloud installation behind it. */
export interface ServerUrlParts {
  /**
   * The Server URL with the FIRST `/remote.php...` or `/public.php...` (and everything after it) removed, i.e. the
   * Nextcloud install root including any subfolder (`https://host/nextcloud`). Unchanged when neither occurs.
   * No other normalisation (trailing slash, encoding, trimming): probe URLs for every other Server URL must stay
   * byte-identical to before.
   */
  rootUrl: string;
  /** True when that first entry point is `/public.php` (a public link share), whose credentials are the share token and password. */
  isPublicShare: boolean;
}

const DAV_ENTRY = /\/(remote|public)\.php.*$/;

export function parseServerUrl(serverUrl: string): ServerUrlParts {
  const match = DAV_ENTRY.exec(serverUrl);
  if (!match) return { rootUrl: serverUrl, isPublicShare: false };
  return { rootUrl: serverUrl.slice(0, match.index), isPublicShare: match[1] === 'public' };
}
