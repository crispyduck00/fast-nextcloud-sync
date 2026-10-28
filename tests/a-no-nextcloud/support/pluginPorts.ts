// Pass-through stubs for the community-plugin ports, shared by suites that build a service directly.
// With these, a service behaves exactly as it did before plugin sync existed.
import type {
  LocalWritePort, PluginPathGate, PluginSessionPort, PluginConflictRule,
} from '../../../src/sync/plugins/PluginSyncCoordinator';

export const passThroughLocalWrite: LocalWritePort = { mtimeFor: (_p, m) => m, written: () => undefined };

export const emptyPluginGate: PluginPathGate = { isPluginFileIncluded: () => false, includedPluginIds: () => [] };

export const noPluginConflictRule = (): PluginConflictRule | null => null;

export const noPluginPath = (): boolean => false;

export const noopPluginSession: PluginSessionPort = {
  begin: () => undefined,
  discard: () => undefined,
  prepare: () => Promise.resolve(),
  finish: () => ({ pluginsNeedingRestart: [], invalidateRootEtag: false, ignored: new Map() }),
};
