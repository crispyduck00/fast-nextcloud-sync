// [SPEC:CPS-20] The community plugin picker, opened from the real settings tab in the real Obsidian.
// Layer a cannot render the modal, so only opening it and listing an installed plugin is checked here.
import { browser, expect } from '@wdio/globals';
import { requireUiEnv } from '../support/env';

const ui = requireUiEnv();

const PROBE_ID = 'ncs-picker-probe';
const PROBE_MANIFEST = JSON.stringify({ id: PROBE_ID, name: 'Picker probe', version: '1.0.0' });

interface PickerObservation {
  titleShown: boolean;
  rowTexts: string[];
  closed: boolean;
  syncedAfter: string[];
}

describe('[SPEC:CPS-20] the plugin picker opens from settings', function () {
  it('lists an installed plugin in the modal and closes on Cancel without changing the list', async function () {
    if (!ui.ok) this.skip();
    const result = await browser.executeObsidian(
      async ({ app }, probeId, manifest) => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const plugin = (app as any).plugins.plugins['nextcloud-sync'];
        const adapter = app.vault.adapter;
        const dir = `${app.vault.configDir}/plugins/${probeId}`;
        const originalMaster = plugin.settings.syncConfigFolder;
        const originalList = [...plugin.settings.syncedCommunityPlugins];
        const setting = (app as any).setting;
        let observed: PickerObservation = { titleShown: false, rowTexts: [], closed: false, syncedAfter: [] };
        try {
          plugin.settings.syncConfigFolder = true;
          await plugin.saveSettings();
          await adapter.mkdir(dir);
          await adapter.write(`${dir}/manifest.json`, manifest);

          await setting.open();
          setting.openTabById('nextcloud-sync');
          await wait(600);
          const tab = setting.pluginTabs.find((t: any) => t.id === 'nextcloud-sync');
          tab.update();
          await wait(400);
          const rows = Array.from(tab.containerEl.querySelectorAll('.setting-item')) as HTMLElement[];
          const choose = rows.find((r) => r.querySelector('.setting-item-name')?.textContent === 'Choose plugins…');
          choose?.click();
          await wait(1500);

          // The settings dialog can live in a popout window, so look in the tab's own document, not `document`.
          const doc = tab.containerEl.ownerDocument as Document;
          const modal = Array.from(doc.querySelectorAll('.modal-container .modal')).pop() as HTMLElement | undefined;
          const rowTexts = Array.from(modal?.querySelectorAll('.setting-item-name') ?? []).map((e) => e.textContent ?? '');
          const buttons = Array.from(modal?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
          const titleShown = rowTexts.includes('Choose community plugins to sync');
          buttons.find((b) => b.textContent === 'Cancel')?.click();
          await wait(400);
          observed = {
            titleShown,
            rowTexts,
            closed: !modal?.isConnected,
            syncedAfter: [...plugin.settings.syncedCommunityPlugins],
          };
        } finally {
          // A picker left open by a failed step must not outlive the test.
          const leftoverDoc = (setting.pluginTabs?.[0]?.containerEl?.ownerDocument ?? document) as Document;
          leftoverDoc.querySelectorAll<HTMLElement>('.modal-container .modal-close-button').forEach((b) => b.click());
          setting.close();
          if (await adapter.exists(dir)) await adapter.rmdir(dir, true);
          plugin.settings.syncConfigFolder = originalMaster;
          plugin.settings.syncedCommunityPlugins = originalList;
          await plugin.saveSettings();
        }
        return { observed, originalList };
      },
      PROBE_ID,
      PROBE_MANIFEST,
    ) as { observed: PickerObservation; originalList: string[] };

    expect(result.observed.titleShown).toBe(true);
    expect(result.observed.rowTexts).toContain(`Picker probe (${PROBE_ID}) v1.0.0`);
    expect(result.observed.closed).toBe(true);
    expect(result.observed.syncedAfter).toEqual(result.originalList);
  });
});
