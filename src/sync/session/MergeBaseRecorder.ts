// Decides which files get a 3-way merge base recorded and pairs every store write with a save request.
import { MergeBaseStore } from '../../data/MergeBaseStore';
import { isAutoMergeFileType, isMarkdown } from '../../util/mergeableExtensions';

export interface MergeBaseRecorderDeps {
  // Absent when no base store is injected: every method then no-ops.
  baseStore?: Pick<MergeBaseStore, 'set' | 'delete' | 'requestSave'>;
  // The configured Auto Merge File types, read at call time (settings can change).
  autoMergeFileTypes(): readonly string[];
  // Plugin files never enter text merge, so they keep no merge base.
  isPluginPath(path: string): boolean;
}

export class MergeBaseRecorder {
  constructor(private readonly deps: MergeBaseRecorderDeps) {}

  record(path: string, content: string): void {
    if (!this.shouldRecord(path)) return;
    this.store(path, content);
  }

  // Decodes the body as UTF-8 only when a base is going to be recorded, so files that keep no base
  // never pay for the decode.
  recordBytes(path: string, body: ArrayBuffer): void {
    if (!this.shouldRecord(path)) return;
    this.store(path, new TextDecoder().decode(body));
  }

  // Dropped on deletion so the base does not leak.
  drop(path: string): void {
    if (!this.deps.baseStore || this.deps.isPluginPath(path)) return;
    this.deps.baseStore.delete(path);
    this.deps.baseStore.requestSave();
  }

  private shouldRecord(path: string): boolean {
    if (!this.deps.baseStore || this.deps.isPluginPath(path)) return false;
    // Every Auto Merge File (body 3-way) and every markdown file (frontmatter set-merge needs a base to
    // detect deletions even when `md` is an Other File) gets a base.
    return isAutoMergeFileType(path, this.deps.autoMergeFileTypes()) || isMarkdown(path);
  }

  private store(path: string, content: string): void {
    const baseStore = this.deps.baseStore;
    if (!baseStore) return;
    baseStore.set(path, content);
    baseStore.requestSave();
  }
}
