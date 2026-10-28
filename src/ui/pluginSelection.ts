import { normalizePluginIdList } from '../util/settingsMigration';

// A confirmation the caller must present before newly selected plugins are accepted.
export type PluginSelectionConfirmStep =
  | { kind: 'risk' }
  | { kind: 'ids'; added: readonly string[] };

// Normalizes the chosen plugin IDs and, when any ID is newly added, asks for the
// risk confirmation and then the ID confirmation. Returns the normalized list,
// or null when the user declines either step.
export async function applyPluginSelection(
  current: readonly string[],
  chosen: readonly string[],
  ownId: string,
  confirm: (step: PluginSelectionConfirmStep) => Promise<boolean>,
): Promise<string[] | null> {
  const next = normalizePluginIdList(chosen, ownId);
  const cur = new Set(normalizePluginIdList(current, ownId));
  const added = next.filter((id) => !cur.has(id));
  if (added.length === 0) return next;
  if (!(await confirm({ kind: 'risk' }))) return null;
  if (!(await confirm({ kind: 'ids', added }))) return null;
  return next;
}
