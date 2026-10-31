# Publish GitHub Action

[![GitHub release](https://img.shields.io/github/release/joshjohanning/publish-github-action.svg?labelColor=333)](https://github.com/joshjohanning/publish-github-action/releases)
[![Immutable Releases](https://img.shields.io/badge/releases-immutable-blue?labelColor=333)](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-publish--github--action--with--ncc-blue?logo=github&labelColor=333)](https://github.com/marketplace/actions/publish-github-action-with-ncc)
[![CI](https://github.com/joshjohanning/publish-github-action/actions/workflows/ci.yml/badge.svg)](https://github.com/joshjohanning/publish-github-action/actions/workflows/ci.yml)
[![Publish GitHub Action](https://github.com/joshjohanning/publish-github-action/actions/workflows/publish.yml/badge.svg?branch=main&event=push)](https://github.com/joshjohanning/publish-github-action/actions/workflows/publish.yml)
![Coverage](./badges/coverage.svg)

This action creates a release branch for your GitHub Actions which will be automatically tagged and released. The release version can be defined in `package.json`.

Based on the [tgymnich/publish-github-action](https://github.com/tgymnich/publish-github-action) action, but I wanted further customization and control over the release process (i.e.: adding `ncc` output and not committing `node_modules` directory).

## What's new

Please refer to the [release page](https://github.com/joshjohanning/publish-github-action/releases) for the latest release notes.

## Features

- 🔐 **Verified Commits** - Uses GitHub API to create verified commits (when `commit_node_modules` is `false`)
- 🏷️ **Annotated Tags** - Creates annotated tags via Git CLI with atomic updates (no downtime)
- 🌐 **Multi-instance Support** - API URL defaults to the environment you are running in; works with GitHub.com, GitHub Enterprise Server, and GHE.com
- 📦 **Flexible Build** - Automatically installs production dependencies and supports custom build commands
- 🗂️ **Selective Commits** - Choose which files to include (dist, node_modules, or both)

## Inputs

| Input                       | Description                                                                                                                                                                                                                                                                                                            | Required | Default                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| `github_token`              | Token for the GitHub API                                                                                                                                                                                                                                                                                               | Yes      | -                       |
| `github_api_url`            | GitHub API URL (e.g., `https://api.github.com` for GitHub.com or `https://ghes.domain.com/api/v3` for GHES)                                                                                                                                                                                                            | No       | `${{ github.api_url }}` |
| `mode`                      | `publish` builds, tags, and creates the release. `promote` moves the floating major (and, with `publish_minor_version`, minor) tags to an already published release; use it on the `release` `published` event (see [Draft releases](#draft-releases-and-floating-tags))                                               | No       | `publish`               |
| `release_workflow_file`     | Optional workflow file to keep in the release tag so it can handle `release.published`; must be under `.github/workflows/`                                                                                                                                                                                             | No       | -                       |
| `npm_package_command`       | Command to build the action                                                                                                                                                                                                                                                                                            | No       | `npm run package`       |
| `commit_node_modules`       | Whether to commit `node_modules` folder. **Note:** When set to `true`, commits will NOT be verified due to API limitations with large file counts                                                                                                                                                                      | No       | `false`                 |
| `commit_dist_folder`        | Whether to commit `dist` folder                                                                                                                                                                                                                                                                                        | No       | `true`                  |
| `publish_minor_version`     | Whether to publish minor version tag (e.g., `v1.2`)                                                                                                                                                                                                                                                                    | No       | `false`                 |
| `publish_release_branch`    | Whether to publish release branch (e.g., `releases/v1.2.3`)                                                                                                                                                                                                                                                            | No       | `false`                 |
| `create_release_as_draft`   | Whether to create release as draft to allow review of the release before publishing; useful with [immutable releases](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases) where changes cannot be made after publishing           | No       | `false`                 |
| `draft_release_pr_reminder` | Post a reminder comment on the merged PR when creating a draft release                                                                                                                                                                                                                                                 | No       | `false`                 |
| `comment_on_linked_issues`  | Comment on closed issues linked to PRs in the release notes to notify followers of the release (uses GraphQL `closingIssuesReferences`; idempotent — updates existing comment on rerun). Comments are posted for both published and draft releases; the comment is updated if the version changes on a subsequent run. | No       | `false`                 |

### Draft Releases and Floating Tags

When `create_release_as_draft: true`, only the exact version tag (e.g. `v2.1.2`) is pushed. The floating major tag (e.g. `v2`) and optional minor tag (e.g. `v2.1`) are **not** moved until the release is published, so consumers of `@v2` never pick up an unreleased draft.

To promote the floating tags once you publish the draft, run this action again with `mode: promote` on the `release` `published` event. Promotion points the floating tags at the exact release tag's existing bundled commit (no rebuild), and only moves a tag if the release is the newest stable release for that major/minor line (so publishing a backport won't move `v2` backwards). Prereleases are skipped.

For non-draft releases (`create_release_as_draft: false`), the floating tags are promoted immediately after the release is created.

> [!NOTE]
> Releases published by `GITHUB_TOKEN` do not trigger other workflows, which is why non-draft releases promote in the same run. Drafts published manually in the UI trigger the `release` `published` event normally. If the workflow file is removed from release commits, set `release_workflow_file` to its path so the released tag retains the listener.

### Commit Signing Behavior

- ✅ **Verified commits** (signed by GitHub) when `commit_node_modules: false` - Uses GitHub API for commits; tags are created locally via Git CLI
- ❌ **Unverified commits** when `commit_node_modules: true` - Uses Git CLI due to API limitations with large file counts

### Build and File Management

The action automatically handles clean builds and file management:

- **Dist folder cleaning**: When `commit_dist_folder: true` and `npm_package_command` is specified, the `dist/` folder is cleaned before building to ensure no stale files persist
- **Automatic file deletion**: The action removes `.github/` files from release commits and properly handles renamed/deleted files in the `dist/` folder; `release_workflow_file` can preserve the published-release listener when needed

## Permissions

The action requires specific permissions depending on features used:

| Permission             | Required | Purpose                                                                |
| ---------------------- | -------- | ---------------------------------------------------------------------- |
| `contents: write`      | Yes      | Push tags, create releases, and promote floating tags                  |
| `pull-requests: write` | No       | Post reminder comment on merged PR (`draft_release_pr_reminder: true`) |
| `issues: write`        | No       | Comment on linked issues (`comment_on_linked_issues: true`)            |

Example with all permissions:

```yml
permissions:
  contents: write
  pull-requests: write # only needed if using draft_release_pr_reminder
  issues: write # only needed if using comment_on_linked_issues
```

## Example Workflow

> [!NOTE]
> The `install ncc` step is only needed if `@vercel/ncc` is not in your `package.json` devDependencies. If you already have it as a dev dependency, you can skip this step.

```yml
name: 'Publish GitHub Action'
on:
  push:
    branches:
      - main

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: install ncc
        run: npm i -g @vercel/ncc
      - uses: joshjohanning/publish-github-action@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          npm_package_command: npm run package
          commit_node_modules: false
          commit_dist_folder: true
          publish_minor_version: false
          publish_release_branch: false
          create_release_as_draft: false
          draft_release_pr_reminder: true
```

### Example Workflow with Draft Releases

```yml
name: 'Publish GitHub Action'
on:
  workflow_dispatch:
  push:
    branches:
      - main
  release:
    types: [published]

permissions:
  contents: write
  pull-requests: write

jobs:
  publish:
    if: github.event_name != 'release'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: joshjohanning/publish-github-action@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          create_release_as_draft: true
          draft_release_pr_reminder: true

  promote:
    if: github.event_name == 'release' && !github.event.release.draft && !github.event.release.prerelease
    runs-on: ubuntu-latest
    steps:
      - uses: joshjohanning/publish-github-action@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: promote
```
