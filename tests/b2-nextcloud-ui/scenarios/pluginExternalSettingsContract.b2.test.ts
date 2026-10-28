// Platform contract: a plugin's onExternalSettingsChange fires when its data.json is replaced the way
// LocalAdapter.atomicWriteBinary does (tmp writeBinary with mtime -> remove target -> rename), unless the mtime is in the past.
import { browser, expect } from '@wdio/globals';
import { requireUiEnv } from '../support/env';

const ui = requireUiEnv();

type CaseResult = {
  case: string;
  called: boolean;
  calls: number;
  loadData: unknown;
  rawPaths: string[];
};

type ProbeOutput = { enabled: unknown; results: CaseResult[]; error: string | null };

async function runProbe(): Promise<ProbeOutput> {
  return browser.executeObsidian(async ({ app }) => {
    const id = 'ncs-probe-plugin';
    const w = window as any;
    const adapter = app.vault.adapter;
    const configDir = app.vault.configDir;
    const dir = `${configDir}/plugins/${id}`;
    const target = `${dir}/data.json`;
    const tmp = `${dir}/.probe1.ncs.tmp`;
    const cpPath = `${configDir}/community-plugins.json`;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const enc = (s: string) => new TextEncoder().encode(s).buffer;
    const results: CaseResult[] = [];
    let enabled: unknown = null;
    let error: string | null = null;
    let rawPaths: string[] = [];
    let ref: any = null;

    const hadCp = await adapter.exists(cpPath);
    const cpBefore = hadCp ? await adapter.read(cpPath) : null;

    try {
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(
        `${dir}/manifest.json`,
        JSON.stringify({
          id,
          name: 'NCS Probe',
          version: '0.0.1',
          minAppVersion: '0.15.0',
          description: 'probe',
          author: 'probe',
          isDesktopOnly: false,
        }),
      );
      await adapter.write(
        `${dir}/main.js`,
        [
          "const { Plugin } = require('obsidian');",
          'module.exports = class extends Plugin {',
          '  async onload() { await this.loadData(); }',
          '  async onExternalSettingsChange() {',
          '    const d = await this.loadData();',
          '    window.__ncsProbe = window.__ncsProbe || { calls: [] };',
          '    window.__ncsProbe.calls.push({ at: Date.now(), data: d });',
          '  }',
          '};',
        ].join('\n'),
      );

      await app.plugins.loadManifests();
      enabled = await app.plugins.enablePluginAndSave(id);
      const plugin = app.plugins.plugins[id];
      if (!plugin) throw new Error('probe plugin not loaded');
      await plugin.saveData({ v: 'init' });
      await sleep(1500);

      ref = app.vault.on('raw', (p: string) => {
        rawPaths.push(p);
      });

      const cases: Array<{ name: string; run: (payload: ArrayBuffer, text: string) => Promise<void> }> = [
        {
          name: 'mtime-now',
          run: async (payload) => {
            await adapter.writeBinary(tmp, payload, { mtime: Date.now() });
            if (await adapter.exists(target)) await adapter.remove(target);
            await adapter.rename(tmp, target);
          },
        },
        {
          name: 'mtime-past',
          run: async (payload) => {
            await adapter.writeBinary(tmp, payload, { mtime: Date.now() - 86400000 });
            if (await adapter.exists(target)) await adapter.remove(target);
            await adapter.rename(tmp, target);
          },
        },
        {
          name: 'plain-write',
          run: async (_payload, text) => {
            await adapter.write(target, text);
          },
        },
      ];

      for (const c of cases) {
        w.__ncsProbe = { calls: [] };
        rawPaths = [];
        const text = JSON.stringify({ v: c.name });
        await c.run(enc(text), text);
        await sleep(1500);
        const calls = (w.__ncsProbe?.calls ?? []) as Array<{ data: unknown }>;
        results.push({
          case: c.name,
          called: calls.length > 0,
          calls: calls.length,
          loadData: calls.length > 0 ? calls[calls.length - 1].data : await plugin.loadData(),
          rawPaths: [...rawPaths],
        });
      }
    } catch (e) {
      error = String((e as Error)?.stack ?? e);
    } finally {
      try {
        if (ref) app.vault.offref(ref);
      } catch {
        /* ignore */
      }
      try {
        await app.plugins.disablePluginAndSave(id);
      } catch {
        /* ignore */
      }
      try {
        if (await adapter.exists(dir)) await adapter.rmdir(dir, true);
      } catch {
        /* ignore */
      }
      try {
        await app.plugins.loadManifests();
      } catch {
        /* ignore */
      }
      try {
        delete w.__ncsProbe;
      } catch {
        /* ignore */
      }
      try {
        if (hadCp && cpBefore !== null) await adapter.write(cpPath, cpBefore);
        else if (await adapter.exists(cpPath)) await adapter.remove(cpPath);
      } catch {
        /* ignore */
      }
    }
    return { enabled, results, error };
  }) as Promise<ProbeOutput>;
}

describe('[SPEC:CPS-15] onExternalSettingsChange after an atomicWriteBinary-style data.json replace', function () {
  it('fires for mtime=now and a plain write, not for a past mtime', async function () {
    if (!ui.ok) this.skip();
    this.timeout(120000);
    const out = await runProbe();
    expect(out.error).toBeNull();
    const byCase = (name: string) => out.results.find((r) => r.case === name);
    const now = byCase('mtime-now');
    expect(now?.calls).toBe(1);
    expect(now?.loadData).toEqual({ v: 'mtime-now' });
    expect(byCase('mtime-past')?.calls).toBe(0);
    expect(byCase('plain-write')?.calls).toBe(1);
  });
});
