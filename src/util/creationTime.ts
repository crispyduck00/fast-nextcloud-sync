// Pure rules for preserving the creation time of synced files (docs/spec.md §9.7).
// No I/O: the values come from the callers and the plan goes back to them.

/** Nextcloud's MtimeSanitizer rejects any value at or below one day (docs/spec.md §9.7). */
export const MIN_VALID_CREATION_SECONDS = 86400;

/** True when `ms` is a usable creation time: finite and above MIN_VALID_CREATION_SECONDS once floored to seconds. */
export function isValidCreationMs(ms: number | undefined | null): ms is number {
  return (
    typeof ms === 'number' &&
    Number.isFinite(ms) &&
    Math.floor(ms / 1000) > MIN_VALID_CREATION_SECONDS
  );
}

/** Unix seconds of a ms value (Math.floor(ms / 1000)). Caller guarantees validity. */
export function creationSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Smallest valid value in seconds, or null when none is valid. */
export function alignedCreationSeconds(...values: Array<number | undefined | null>): number | null {
  let min: number | null = null;
  for (const v of values) {
    if (!isValidCreationMs(v)) continue;
    const s = creationSeconds(v);
    if (min === null || s < min) min = s;
  }
  return min;
}

/** Creation time (ms, whole seconds) for a body written to the local file; undefined when neither side is valid (the write time applies). */
export function writeCreationTimeMs(
  localBeforeMs: number | undefined,
  remoteCreationTimeMs: number | undefined,
): number | undefined {
  const seconds = alignedCreationSeconds(localBeforeMs, remoteCreationTimeMs);
  return seconds === null ? undefined : seconds * 1000;
}

/** X-OC-CTime source (ms, whole seconds) for an upload; undefined when the server value is unknown or neither side is valid (no header). */
export function uploadCreationTimeMs(
  localMs: number | undefined,
  remoteCreationTimeMs: number | undefined,
): number | undefined {
  return remoteCreationTimeMs === undefined
    ? undefined
    : writeCreationTimeMs(localMs, remoteCreationTimeMs);
}

export interface CreationTimeAlignmentInput {
  localCtimeMs: number | undefined;
  remoteCreationTimeMs: number | undefined;
  localSettable: boolean;
  localAttemptSeconds: number | undefined;
  remoteAttemptSeconds: number | undefined;
}

export interface CreationTimeAlignmentPlan {
  setLocalSeconds: number | null;
  setRemoteSeconds: number | null;
}

/** Rules 1-4 of the alignment plan (docs/spec.md §9.7). */
export function planCreationTimeAlignment(
  input: CreationTimeAlignmentInput,
): CreationTimeAlignmentPlan {
  const none: CreationTimeAlignmentPlan = { setLocalSeconds: null, setRemoteSeconds: null };
  // Rule 1: an unknown server value means nothing is done.
  if (input.remoteCreationTimeMs === undefined) return none;
  // Rule 2: T is the oldest valid value; with no valid value there is nothing to align.
  const target = alignedCreationSeconds(input.localCtimeMs, input.remoteCreationTimeMs);
  if (target === null) return none;
  const local = isValidCreationMs(input.localCtimeMs)
    ? creationSeconds(input.localCtimeMs)
    : undefined;
  const remote = isValidCreationMs(input.remoteCreationTimeMs)
    ? creationSeconds(input.remoteCreationTimeMs)
    : undefined;
  // Rule 3: local, only on a settable device and not already tried for this value.
  const setLocal = input.localSettable && local !== target && input.localAttemptSeconds !== target;
  // Rule 4: server, not already tried for this value.
  const setRemote = remote !== target && input.remoteAttemptSeconds !== target;
  return {
    setLocalSeconds: setLocal ? target : null,
    setRemoteSeconds: setRemote ? target : null,
  };
}
