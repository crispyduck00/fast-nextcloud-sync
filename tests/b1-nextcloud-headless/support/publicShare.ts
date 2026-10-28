// Public link share helper for the public-share detection tests: the admin creates a password-protected link share
// through the OCS Files Sharing API, and the tests connect through it in the legacy or the token URL form.
import { randomBytes } from 'node:crypto';
import { LiveEnv } from './env';
import { authHeaderOf } from './clientFactory';

export type PublicShareForm = 'legacy' | 'token';

export interface PublicShare {
  /** OCS share id, used to delete the share in teardown. */
  id: string;
  /** Share token: the Basic-auth username and the last segment of the token URL form. */
  token: string;
  /** Share password: the Basic-auth password. */
  password: string;
}

const SHARES_PATH = '/ocs/v2.php/apps/files_sharing/api/v1/shares';

function ocsHeaders(env: LiveEnv): Record<string, string> {
  return {
    'OCS-APIRequest': 'true',
    Authorization: authHeaderOf(env),
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

function parseShareData(text: string): { statuscode: unknown; id: unknown; token: unknown } {
  try {
    const parsed = JSON.parse(text) as { ocs?: { meta?: { statuscode?: unknown }; data?: { id?: unknown; token?: unknown } } };
    return { statuscode: parsed.ocs?.meta?.statuscode, id: parsed.ocs?.data?.id, token: parsed.ocs?.data?.token };
  } catch {
    // Non-JSON body: the caller reports it with the HTTP status and body excerpt.
    return { statuscode: undefined, id: undefined, token: undefined };
  }
}

/** Creates a password-protected public link share (shareType 3, permissions 15) of `ownerPath` as the admin in `env`; throws unless OCS statuscode is 200. */
export async function createPublicShare(env: LiveEnv, ownerPath: string): Promise<PublicShare> {
  const password = randomBytes(18).toString('base64url') + 'Aa1!';
  const body = new URLSearchParams({ path: `/${ownerPath}`, shareType: '3', permissions: '15', password });
  const res = await fetch(`${new URL(env.serverUrl).origin}${SHARES_PATH}`, {
    method: 'POST',
    headers: ocsHeaders(env),
    body: body.toString(),
  });
  const text = await res.text();
  const { statuscode, id, token } = parseShareData(text);
  const idOk = typeof id === 'number' || typeof id === 'string';
  if (statuscode !== 200 || !idOk || typeof token !== 'string') {
    throw new Error(
      `createPublicShare failed: HTTP ${res.status}, ocs statuscode ${String(statuscode)}: ${text.slice(0, 300)}`,
    );
  }
  return { id: String(id), token, password };
}

/** Deletes the share; never throws (teardown), warns on failure. */
export async function deletePublicShare(env: LiveEnv, share: PublicShare): Promise<void> {
  try {
    const res = await fetch(`${new URL(env.serverUrl).origin}${SHARES_PATH}/${share.id}`, {
      method: 'DELETE',
      headers: ocsHeaders(env),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console -- surface leftover share for manual cleanup
      console.warn(`[e2e] public share ${share.id} delete failed: HTTP ${res.status}; delete it manually.`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- surface leftover share for manual cleanup
    console.warn(`[e2e] public share ${share.id} delete failed; delete it manually. Cause:`, err);
  }
}

/** `<origin>/public.php/webdav/` (legacy) or `<origin>/public.php/dav/files/<token>/` (token). */
export function publicShareUrl(env: LiveEnv, share: PublicShare, form: PublicShareForm): string {
  const origin = new URL(env.serverUrl).origin;
  return form === 'legacy' ? `${origin}/public.php/webdav/` : `${origin}/public.php/dav/files/${share.token}/`;
}

/** A LiveEnv that connects through the share: serverUrl = publicShareUrl, username = token, appPassword = password, syncFolder = ''. */
export function publicShareEnv(env: LiveEnv, share: PublicShare, form: PublicShareForm): LiveEnv {
  return {
    ...env,
    serverUrl: publicShareUrl(env, share, form),
    username: share.token,
    appPassword: share.password,
    syncFolder: '',
  };
}
