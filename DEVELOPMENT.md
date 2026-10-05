# Development workflow

This document is the source of truth for how **Fast Nextcloud Sync** is developed, integrated, tested, and released.

It exists specifically to avoid confusing three different things that are related but have different jobs:

1. the upstream project,
2. the development fork and its topic/integration branches,
3. the standalone installable Fast Nextcloud Sync repository/plugin.

If a future contributor, AI assistant, or new chat continues development, follow this workflow unless the maintainer explicitly changes it.

## Repositories and roles

### 1. Upstream

Repository:

`siosig/obsidian-nextcloudsync`

This is the original **Nextcloud Sync for Obsidian** project.

The development fork tracks this project and should remain able to produce clean upstream-ready feature/fix PRs.

### 2. Development fork

Repository:

`crispyduck00/obsidian-nextcloudsync`

This is where functional development happens.

Its `main` branch must stay aligned with upstream. Do not put fork-only product changes directly on `main`.

The important branch classes are:

- `features/<name>` — one feature, directly from upstream/main
- `fixes/<name>` — one bugfix, directly from upstream/main
- integration branch — validated combination of all selected topic branches

The integration branch is:

`integration/all-topics`

The old branch name `fast-nextcloud-sync` was retired because it was too easy to confuse with the standalone repository/plugin below. **Fast Nextcloud Sync** now refers only to the installable product/release repository; `integration/all-topics` always refers to the combined development branch.

### 3. Standalone plugin/release repository

Repository:

`crispyduck00/fast-nextcloud-sync`

Plugin identity:

- ID: `fast-nextcloud-sync`
- Name: **Fast Nextcloud Sync**
- current initial release line: `0.1.x`

This repository is the installable/release form of the combined fork.

It is **not** the place where functional bugs or features should first be implemented.

## Non-negotiable branch rules

Every independent feature or fix must start directly from the current upstream-aligned development baseline.

Conceptually:

```text
upstream/main
├─ features/feature-a
├─ features/feature-b
├─ fixes/fix-a
├─ fixes/fix-b
└─ docs/fork-workflow      (fork-only documentation, if needed)

selected topic branches
        │
        └──── merge commits ────> integration/all-topics
```

Rules:

- never create a feature branch from the integration branch
- never create a fix branch from another feature/fix branch
- never put a functional fix only on the integration branch
- never put a functional fix only in the standalone release repository
- do not modify unrelated/frozen topic branches to make an integration test pass
- if an integration problem belongs to one topic, fix that topic branch, validate it, then merge the updated topic into integration again
- keep topic branches upstream-reviewable and free of standalone branding/versioning changes
- Draft PRs in the development fork should target its `main` branch
- the development fork's `main` should remain an upstream mirror/baseline

A topic may intentionally remain fork-only, but it should still be isolated and based directly on upstream so its scope is understandable.

## Where a newly found bug belongs

First determine the owner of the bug.

### Bug introduced by one feature

Example: a Version History UI or provenance bug introduced by `features/version-history`.

Fix it in that feature branch.

Flow:

```text
bug found
  -> fix in features/version-history
  -> focused tests
  -> build/lint
  -> real desktop/mobile test
  -> merge updated feature branch into integration
  -> full integration validation
  -> promote to standalone repository
  -> release new Fast Nextcloud Sync version
```

### General upstream bug

If the bug exists against unmodified upstream/main, create a separate branch:

`fixes/<descriptive-name>`

directly from upstream/main.

Do not hide an upstream bugfix inside an unrelated feature branch.

### Bug visible only after combining topics

Identify which topic owns the faulty behavior.

Fix that topic branch and merge it into integration again.

If the problem is genuinely integration-only and cannot reasonably belong to one topic, create an explicit integration-support topic branch directly from upstream/main rather than committing the fix only to integration.

## Testing a topic before integration

The installed plugin has its own ID, so a topic branch can be tested under the **Fast Nextcloud Sync** plugin identity without merging the topic first.

Typical workflow in the development repo:

```powershell
git switch features/version-history
git pull
pnpm build
pnpm lint
pnpm test -- <focused tests>
```

For real testing, copy the generated runtime files into the installed Fast Nextcloud Sync plugin directory while keeping that install's standalone `manifest.json` and `data.json` intact.

Usually the files under test are:

- `main.js`
- `styles.css` when changed

This gives a real Fast Nextcloud Sync installation with the current topic code, while Git history remains clean.

Do not run the official upstream plugin and Fast Nextcloud Sync simultaneously against the same vault.

## Integration branch semantics

The integration branch must be explainable as:

> upstream/main + selected independent topic branches

Merge commits are acceptable and useful because they preserve which topic supplied a change.

The integration branch is a composition target, not a development source.

Before promotion to the standalone repository, run the broadest practical validation, normally including:

```powershell
pnpm build
pnpm lint
pnpm test
pnpm secretlint
```

Also perform relevant real-device testing, especially Android for mobile/watch/UI behavior and a real Nextcloud server for sync/version behavior.

## Standalone repository semantics

The standalone repository packages a **validated integration state** with a distinct plugin identity and release metadata.

Functional source should come from the validated development integration branch.

The standalone repository may contain an identity/release overlay such as:

- `manifest.json` plugin ID/name/version
- `package.json` package name/version/repository metadata
- `versions.json`
- standalone README/documentation
- release/CI workflows
- branding or release-specific metadata

Do not independently patch sync logic in this repository.

If a bug is found while testing a standalone build:

1. reproduce/locate it in the development fork,
2. fix the owning topic branch,
3. validate the topic,
4. merge the updated topic into integration,
5. validate integration,
6. promote the new integrated source here,
7. publish a new version.

This prevents the release repository from becoming a second, divergent source tree.

## Promotion to the standalone repository

A release promotion should be deliberate.

Recommended sequence:

```text
topic branch validated
      ↓
topic merged into integration
      ↓
integration full validation
      ↓
copy/promote integration source into standalone repo
      ↓
preserve/apply standalone identity + release overlay
      ↓
standalone build/lint/secretlint
      ↓
bump release version
      ↓
commit
      ↓
tag exact version
      ↓
push commit + tag
      ↓
GitHub release workflow builds and publishes assets
```

The promotion process should eventually be scripted so source synchronization and the standalone overlay are deterministic.

## Versioning and releases

Current initial release line:

`0.1.x`

While the fork is experimental, patch releases can be used for tested incremental changes.

For a release such as `0.1.1`:

- `manifest.json.version` must be `0.1.1`
- `package.json.version` should be `0.1.1`
- add/update the matching `versions.json` entry
- commit those changes
- create tag `0.1.1` on that release commit
- push the commit and tag

The GitHub release workflow requires the tag to match `manifest.json.version`.

Tags use the bare version, not a `v` prefix:

```powershell
git tag 0.1.1
git push origin 0.1.1
```

The release workflow builds and publishes:

- `main.js`
- `manifest.json`
- `styles.css` when present

Those assets are what BRAT consumes.

Never move/reuse an already published stable version tag for different code. Publish a new version instead.

## Current Version History work

At the time this document was introduced, active work lives on:

`features/version-history`

It includes enhanced Nextcloud version metadata, compare views, Line History, Version Browser, restore UI, and Version History entry points.

Important restore semantics discovered during testing:

- normal Nextcloud user storage and Nextcloud Group/Team Folders do not always expose restored versions in the same way
- ordinary core `files_versions` can move the restored historical version back into the live file and preserve its historical mtime
- the restored source can therefore disappear as a separately retained historical file while its content becomes Current
- Group Folders use a different version backend and can preserve the historical source separately while producing a distinct live Current state
- **Current means the live state now**, regardless of the timestamp carried by its content
- when Current carries an old restored revision time and newer pre-restore versions remain, Version History may represent the Current content twice:
  - once as a non-restorable historical/provenance anchor at its old revision position
  - once as Current at the logical end of the state timeline
- Line History must only display lines present in its target state and should attribute those lines to the earliest available history state where they can be traced
- later pre-restore states must never cause deleted/later lines to appear in restored Current

Do not replace this with per-device local restore provenance: restores can happen from the Nextcloud web UI or another device, so history semantics should be derivable from server-visible state whenever possible.

## Terminology

Use these terms consistently:

**Upstream**
: `siosig/obsidian-nextcloudsync`

**Development fork**
: `crispyduck00/obsidian-nextcloudsync`

**Topic branch**
: one isolated `features/*` or `fixes/*` branch based directly on upstream/main

**Integration branch**
: combined selected topics in the development fork; named `integration/all-topics`

**Standalone repository**
: `crispyduck00/fast-nextcloud-sync`

**Fast Nextcloud Sync plugin**
: installable Obsidian plugin with ID `fast-nextcloud-sync`

These distinctions matter. The old duplicate name was intentionally removed: `integration/all-topics` is the development composition branch, while `fast-nextcloud-sync` is the standalone repository/plugin identity.

## Checklist before continuing work in a new session

Before editing code:

1. identify which repository you are in
2. identify whether the task is feature, fix, integration, or release work
3. confirm the branch's merge-base is upstream/main for a topic branch
4. do not make functional edits directly on integration or standalone main
5. inspect the relevant topic branch and its Draft PR
6. test locally before integration
7. promote only validated integration states to the standalone repository

When in doubt, preserve isolation first. It is easier to merge clean topics later than to separate mixed history afterward.
