import { App, Modal, Setting } from 'obsidian';
import type { PluginCandidate, PluginCandidateList } from '../sync/plugins/candidates';

export interface CommunityPluginPickerOptions {
  load(): Promise<PluginCandidateList>;
  current: readonly string[];
  apply(chosen: string[]): Promise<void>;
}

const LOCATION_LABEL: Record<PluginCandidate['location'], string> = {
  local: 'this device',
  remote: 'server',
  both: 'this device and server',
};

function rowName(c: PluginCandidate): string {
  return `${c.name} (${c.id})${c.version ? ` v${c.version}` : ''}`;
}

// Lets the user pick which community plugins to sync. Selection changes are handed to `apply`;
// the caller decides whether they are accepted.
export class CommunityPluginPickerModal extends Modal {
  private readonly checked = new Set<string>();
  private candidates: PluginCandidate[] = [];

  constructor(app: App, private readonly opts: CommunityPluginPickerOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName('Choose community plugins to sync').setHeading();
    const loading = contentEl.createEl('p', { text: 'Loading plugins…' });
    void this.opts.load().then(
      (list) => { loading.remove(); this.renderList(list); },
      (err: unknown) => { loading.remove(); this.renderError(err); },
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.contentEl.createEl('p', { text: `Could not list plugins: ${message}` });
  }

  private renderList(list: PluginCandidateList): void {
    const { contentEl } = this;
    this.candidates = list.candidates;
    for (const id of this.opts.current) this.checked.add(id);
    if (!list.remoteAvailable) {
      contentEl.createEl('p', { text: 'The server could not be reached. Only plugins installed on this device are listed.' });
    }
    if (list.candidates.length === 0) contentEl.createEl('p', { text: 'No community plugins found.' });
    for (const c of list.candidates) this.renderRow(c);
    this.renderButtons();
  }

  private renderRow(c: PluginCandidate): void {
    const desc = c.selectable
      ? LOCATION_LABEL[c.location]
      : `${LOCATION_LABEL[c.location]}. Desktop only — cannot be synced on this device.`;
    new Setting(this.contentEl)
      .setName(rowName(c))
      .setDesc(desc)
      .addToggle((toggle) => toggle
        .setValue(this.checked.has(c.id))
        .setDisabled(!c.selectable)
        .onChange((value) => {
          if (value) this.checked.add(c.id);
          else this.checked.delete(c.id);
        }));
  }

  private renderButtons(): void {
    new Setting(this.contentEl)
      .addButton((btn) => btn.setButtonText('Apply').setCta().onClick(() => { void this.applyAndClose(); }))
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()));
  }

  private async applyAndClose(): Promise<void> {
    const known = new Set(this.candidates.map((c) => c.id));
    const kept = this.opts.current.filter((id) => !known.has(id));
    const picked = this.candidates.filter((c) => this.checked.has(c.id)).map((c) => c.id);
    this.close();
    await this.opts.apply([...kept, ...picked]);
  }
}
