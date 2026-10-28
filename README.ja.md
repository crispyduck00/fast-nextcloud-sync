# Fast Nextcloud Sync

Nextcloud Sync for Obsidian を基にした非公式 fork です。インストール方法と現在のテスト状況は [README.md](README.md) を参照してください。安定版 0.1.1 は維持され、0.2.0-beta.1 は別の Vault で手動テストする候補です。

## 設定の既定値

| Setting | Desktop | Android |
|---|---|---|
| Startup delay | 1 second | 1 second |
| Network timeout | 30 seconds | 30 seconds |
| Maximum file size | Unlimited | 20 MB on first run |
| Config folder sync | Off | Off |
| Selected community plugins | Empty, per device | Empty, per device |
| Watch | On | Explicit opt-in |

Network concurrency: 16 at 8 GB+, 8 at 4 GB+, 4 below, 3 when memory is not reported. Existing settings are preserved. iOS Watch is disabled in this fork.

Server URL のサブフォルダは Nextcloud 上にあらかじめ存在している必要があります。プラグインはその中に Vault 用のフォルダを作成しますが、サブフォルダ自体は作成しません。`HTTP 409 (MKCOL)` の場合は、親フォルダを作成するか Server URL を修正してから再試行してください。

上流の詳細な説明: [Nextcloud Sync](https://github.com/siosig/obsidian-nextcloudsync)。この fork の仕様とテスト状況は英語版の文書を優先してください。
