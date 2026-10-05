# Fast Nextcloud Sync

**Fast Nextcloud Sync** is an unofficial, experimental fork of [Nextcloud Sync for Obsidian](https://github.com/siosig/obsidian-nextcloudsync) by **Daisuke ITO (@siosig)**.

The upstream plugin is the foundation of this project. It already provides the hard and important parts: a reliable Nextcloud-specific sync engine, file-ID tracking, checksums, sync tokens, safe reconciliation, conflict handling, Nextcloud Versions integration, Login Flow v2, chunked uploads, mobile support, and a strong test-oriented design.

This fork grew from a personal goal: make synchronization feel faster and require even less attention from the user — especially across several desktop and Android devices used by a family.

> **Status:** primarily built for personal/family use and experimentation. Others are welcome to use it, test it, report problems, contribute, or continue maintaining it, but there is **no guarantee of long-term maintenance, support, compatibility, or release cadence**.

## Relationship to upstream

Development happens in a separate fork:

- upstream: [siosig/obsidian-nextcloudsync](https://github.com/siosig/obsidian-nextcloudsync)
- development fork: [crispyduck00/obsidian-nextcloudsync](https://github.com/crispyduck00/obsidian-nextcloudsync)
- installable plugin: **this repository**

The development fork keeps `main` aligned with upstream. Features and fixes are kept on independent topic branches with Draft PRs; the validated combined build lives on its `fast-nextcloud-sync` integration branch.

Only a validated integration state is promoted here. This repository then adds the small standalone layer: its own plugin ID/name, documentation, versioning, and BRAT releases.

Useful changes are welcome upstream too. Ideally, features or fixes that fit the upstream project's design can eventually be merged wholly or partially rather than remaining fork-only.

## AI-assisted development

A substantial part of the fork-specific code, tests, documentation, and code-review work has been created with the assistance of AI coding tools.

That is disclosed deliberately.

AI output is **not** treated as authoritative by itself. Work is human-directed, changes are kept in isolated branches, reviewed in context, covered by automated tests where practical, integrated only after validation, and exercised on real desktop/Android clients against Nextcloud.

AI assistance can still introduce incorrect assumptions or subtle bugs. Treat this as experimental software and keep normal backups/version retention enabled.

## Main additions

### Near-realtime remote sync with Nextcloud Client Push

Optional support for Nextcloud `notify_push` lets remote changes trigger reconciliation quickly instead of waiting for the next periodic/resume sync.

Client Push is only a trigger. It does **not** replace the normal sync/conflict engine.

Where a pushed Nextcloud file ID can be resolved safely, the plugin can reconcile that path selectively. Unknown, structural, or ambiguous changes fall back to authoritative normal reconciliation.

### Android foreground watch

Android can opt into **Sync on file change** while Obsidian is in the foreground.

This is intentionally not advertised as reliable background sync: Android may suspend Obsidian. Resume/startup reconciliation remains the safety net.

### Compact Android status

Android has no normal desktop status bar, so the fork adds a compact persistent sync-status control for states such as syncing, success, conflict, error, network blocked, and Client Push connectivity.

### Enhanced Nextcloud version history

The plugin exposes more of the Versions data already kept by Nextcloud:

- author metadata when Nextcloud exposes it
- version timestamps, sizes, labels and ETags
- Compare current / Compare previous
- desktop side-by-side diff
- mobile unified diff
- retained-version Line History
- read-only Version Browser
  - previous/next buttons
  - timeline slider
  - exact-version dropdown
  - left/right keyboard navigation on desktop
  - Markdown **Rendered / Source**
  - lazy loading and in-window cache
  - restore directly from the selected version
- restore from History, Compare and Line History

Line History is **not Git blame**. It reconstructs provenance only from versions still retained by Nextcloud; pruned intermediate revisions cannot be recovered.

### Sync/recovery hardening

The development fork also contains isolated fixes found while testing the faster paths, including full/lightweight-operation coordination, file-ID bookkeeping, watch rename/delete handling, safer mirror state, restore-state convergence, and conflict-state handling.

## Installation with BRAT

Fast Nextcloud Sync currently targets **BRAT** for installation/testing rather than the Obsidian Community Plugins directory.

1. In Obsidian, install and enable **BRAT** from Community Plugins.
2. Open **Settings → BRAT**.
3. Choose **Add Beta plugin**.
4. Enter:
   `https://github.com/crispyduck00/fast-nextcloud-sync`
5. Install the latest release and enable **Fast Nextcloud Sync** under Community Plugins.

> Do **not** enable the official Nextcloud Sync plugin and Fast Nextcloud Sync at the same time in the same vault. They are separate plugins and two sync engines operating on one vault would be unsafe.

A future submission as a separate Obsidian Community Plugin is possible if the project proves useful and maintainable, but it is not promised.

## Basic setup

1. Open **Settings → Fast Nextcloud Sync**.
2. Enter the full Nextcloud WebDAV files URL:
   `https://<host>/remote.php/dav/files/<user>/`
3. Authenticate with **Login Flow v2** when possible, or use a Nextcloud **app password**.
4. Verify **Sync target (WebDAV)** points where expected.
5. Run **Sync now** for the first reconciliation.

The vault name is used as the remote vault folder, following the upstream plugin's model.

## Client Push / notify_push

### Server requirement

Install and configure Nextcloud's [notify_push](https://github.com/nextcloud/notify_push) app on the server.

The official `notify_push` project requires Redis to be configured for Nextcloud. Its recommended quick setup is:

1. Install the **Client Push** (`notify_push`) app from the Nextcloud app store.
2. Run:
   ```bash
   occ notify_push:setup
   ```
   and follow the setup wizard.
3. Make the push server reachable through your reverse proxy, normally below `/push/`.
4. If doing the final setup manually, enable/configure it with:
   ```bash
   occ app:enable notify_push
   occ notify_push:setup https://cloud.example.com/push
   ```
5. Ensure Nextcloud's `trusted_proxies` / forwarded-for configuration is correct. The setup command tests this and reports proxy problems.

Common reverse-proxy examples from the official project:

**nginx**

```nginx
location ^~ /push/ {
    proxy_pass http://127.0.0.1:7867/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**Caddy v2**

```caddy
handle_path /push/* {
    reverse_proxy http://127.0.0.1:7867
}
```

Exact service/container paths depend on your Nextcloud installation, so use the official `notify_push` README as the authoritative server-side reference.

### Plugin setup

In **Settings → Fast Nextcloud Sync**:

1. Enable **Use Nextcloud client push**.
2. Normally leave **Client Push URL override** empty.
3. Check **Client Push status**.

The plugin auto-detects the endpoint from Nextcloud capabilities. Use the override only when a reverse proxy causes Nextcloud to advertise the wrong WebSocket URL.

If Client Push is unavailable, normal startup, scheduled, resume and manual sync continue to work.

## Watch mode

### Desktop

Enable **Sync on file change** to reconcile local creates/edits after a short debounce and propagate supported delete/rename/folder operations quickly.

It works alongside normal periodic/startup/manual sync.

### Android

**Sync on file change** is an explicit opt-in and works while Obsidian is in the foreground.

Pending edits get a best-effort flush when the app becomes hidden, but Android can suspend in-flight work. Returning to the app rechecks uncertain state.

### iOS

Foreground watch is currently not enabled on iOS.

## Version History / Version Browser

For a synchronized file, run **Show version history**.

From there you can:

- compare revisions
- inspect retained line provenance
- restore a revision
- open **Version browser** to move through retained versions with the slider, dropdown, buttons, or desktop arrow keys
- switch Markdown between rendered and source form

Nextcloud's built-in **Versions** app must be enabled (it normally is by default).

### Team / Group Folders

Nextcloud Group Folders use different server-side version semantics from ordinary user storage.

In observed testing, restoring a personal-file version can make that historical revision the current file with its old timestamp/author metadata. A Group Folder restore can instead create a new live Current state while keeping the historical source revision separately visible.

The plugin deliberately displays the metadata Nextcloud actually exposes rather than inventing restore provenance. For history calculations, **Current is always treated as the final logical state**.

## Multi-user / shared notes

A useful family/team arrangement is:

- each person has their own Nextcloud user/account
- personal notes remain in that person's area
- common notes live in a normal share or Nextcloud Team/Group Folder
- the shared note folder is mounted/exposed inside the path synchronized by the user's Obsidian vault

Nextcloud permissions remain authoritative.

Separate users also allow server-side version metadata to preserve useful authorship information where supported.

## Conflicts and future ideas

The current text-conflict model is inherited from upstream and uses conflict markers.

One future direction being explored is **explicit conflict files** instead:

- keep the canonical/current file intact
- write the competing content as a device/time-named conflict copy
- sync that conflict copy normally so every client sees the unresolved conflict
- keep visible conflict state until the conflict copy is resolved/deleted
- use the same representation for binary conflicts
- optionally provide side-by-side resolution UI

No commitment is made to this design yet.

## Reliability and backups

The upstream project puts substantial effort into sync correctness, and the fork adds automated regression coverage for its changes. The integrated development build is also tested on real Nextcloud/desktop/Android setups before promotion here.

Nevertheless:

- this fork is experimental
- AI assistance is used extensively
- no sync tool can eliminate all risk
- keep Nextcloud Versions/backups enabled
- test important workflows before relying on the fork for critical data

## Contributions and maintenance

Issues, testing, review, documentation improvements, and code contributions are welcome.

This repository is primarily maintained for personal/family needs, so response times and future maintenance are not guaranteed. If somebody wants to help maintain or further develop the project, that is welcome.

Changes that make sense for the wider Nextcloud Sync community should also be considered for discussion/contribution upstream.

## License and attribution

This project is derived from **Nextcloud Sync for Obsidian** by Daisuke ITO / @siosig.

The upstream project is distributed under the **MIT License**. This repository retains the original MIT license and copyright notice and distributes fork-specific modifications under the same MIT terms.

See [LICENSE](LICENSE).

---

**Fast Nextcloud Sync is an unofficial fork and is not an official release of the upstream Nextcloud Sync project.**
