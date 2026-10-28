# Changelog

## [0.2.0-beta.1] - 2026-10-28 — manual test build

This candidate is kept on a separate branch and supplied as a ZIP. No public GitHub Release/tag is created yet: BRAT can automatically select prereleases. Stable 0.1.1 remains unchanged.

- adapts all maintained isolated development topics to upstream 1.0.13
- adds upstream selected community-plugin sync, creation-time preservation, timestamp handling, public-share detection and binary/identity fixes
- defers known plugin Push work to regular bundle sessions without certifying the root checkpoint; unknown/generic/structural hints retain full reconciliation
- filters plugin events before Android Watch recovery
- fixes Restore merge-base persistence and remote read coherence
- preserves conflict-marker state and rejected ctime attempt metadata through identical-content shortcuts
- retains Group Folder/internal-share/version-history behavior for live regression testing
- includes the full public test suite, source provenance and deterministic standalone promotion checks

Automated integrated validation: 207 suites, 3,073 passed, 0 failed, 6 optional local-mockup checks skipped. New-candidate live Windows/Android, Group Folder, internal-share and Nextcloud version-count acceptance is pending. See [validation and acceptance](docs/UPSTREAM-1.0.13-VALIDATION.md).

## [0.1.1] - 2026-10-05

Promotes the validated `integration/all-topics` development state into the standalone plugin.

Highlights:

- fixes restored-Current Line History so later/deleted lines never leak into the current restored file
- preserves a restored source revision as a non-restorable historical/provenance anchor when core Nextcloud consumes the original retained version
- Version Browser now keeps the historical source at its chronological position while Current remains the final live state
- improves restored-state labels so historical revision time and Current state are not conflated
- adds a first-class Version History `history` entry point:
  - desktop ribbon
  - mobile Open menu
  - command palette / hotkey
  - mobile-toolbar pinnable command
  - file context / long-press menu
- adds targeted regression coverage for restored-version chronology and provenance
- cleans up development terminology: the combined development branch is now `integration/all-topics`; **Fast Nextcloud Sync** refers only to the standalone repository/plugin
- reduces duplicate Secret scan workflow runs and superseded-run notification noise

Development integration promoted from:
`crispyduck00/obsidian-nextcloudsync` → `integration/all-topics`

## [0.1.0] - 2026-10-05

First standalone release of **Fast Nextcloud Sync**.

Based on **Nextcloud Sync for Obsidian 1.0.8** by Daisuke ITO / @siosig, with the validated `integration/all-topics` integration from the development fork.

Highlights:

- optional Nextcloud Client Push / `notify_push`
- selective remote reconciliation with conservative full-sync fallback
- opt-in Android foreground watch mode
- compact Android sync-status control
- enhanced Nextcloud version history
- compare current / previous
- desktop side-by-side and mobile unified diff
- retained-version Line History
- read-only Version Browser with slider, dropdown, keyboard navigation, Markdown Rendered/Source and restore
- multiple isolated sync/recovery hardening fixes from the development fork

The standalone plugin uses its own plugin ID (`fast-nextcloud-sync`) and its own release/version line.

Development source and per-topic Draft PRs:
https://github.com/crispyduck00/obsidian-nextcloudsync

Upstream:
https://github.com/siosig/obsidian-nextcloudsync
