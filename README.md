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
| `mode`                      | `publish` builds, tags, and creates the release. `promote` moves the floating major (and, with `publish_minor_version`, minor) tags to an already published release; use it on the `release` `published`/`released` events, or manually with `release_tag` (see [Draft releases](#draft-releases-and-floating-tags))   | No       | `publish`               |
| `release_workflow_file`     | Optional workflow file to keep in the release tag so it can handle release `published`/`released` events; must be a `.yml` or `.yaml` file directly under `.github/workflows/`                                                                                                                                         | No       | -                       |
| `release_tag`               | Exact published release tag (e.g. `v2.1.2`) to promote in `mode: promote` when not triggered by a release event, e.g. from `workflow_dispatch` to recover a release whose tag has no listener                                                                                                                          | No       | -                       |
| `npm_package_command`       | Command to build the action                                                                                                                                                                                                                                                                                            | No       | `npm run package`       |
| `commit_node_modules`       | Whether to commit `node_modules` folder. **Note:** When set to `true`, commits will NOT be verified due to API limitations with large file counts                                                                                                                                                                      | No       | `false`                 |
| `commit_dist_folder`        | Whether to commit `dist` folder                                                                                                                                                                                                                                                                                        | No       | `true`                  |
| `publish_minor_version`     | Whether to publish minor version tag (e.g., `v1.2`)                                                                                                                                                                                                                                                                    | No       | `false`                 |
| `publish_release_branch`    | Whether to publish release branch (e.g., `releases/v1.2.3`)                                                                                                                                                                                                                                                            | No       | `false`                 |
| `create_release_as_draft`   | Whether to create release as draft to allow review of the release before publishing; useful with [immutable releases](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases) where changes cannot be made after publishing           | No       | `false`                 |
| `draft_release_pr_reminder` | Post a reminder comment on the merged PR when creating a draft release                                                                                                                                                                                                                                                 | No       | `false`                 |
| `comment_on_linked_issues`  | Comment on closed issues linked to PRs in the release notes to notify followers of the release (uses GraphQL `closingIssuesReferences`; idempotent — updates existing comment on rerun). Comments are posted for both published and draft releases; the comment is updated if the version changes on a subsequent run. | No       | `false`                 |
| `skip_release_label`        | Skip publishing when the most recently merged PR for the commit has this label. The label must exist in the repository.                                                                                                                                                                                                | No       | `skip-release`          |

### Draft Releases and Floating Tags

When `create_release_as_draft: true`, only the exact version tag (e.g. `v2.1.2`) is pushed. The floating major tag (e.g. `v2`) and optional minor tag (e.g. `v2.1`) are **not** moved until the release is published, so consumers of `@v2` never pick up an unreleased draft.

To promote the floating tags once you publish the draft, run this action again with `mode: promote` on the `release` `published` and `released` events (`released` also covers a prerelease later changed to a full release). Promotion is idempotent, so receiving both events for one release is harmless. Promotion points the floating tags at the exact release tag's existing bundled commit (no rebuild), and only moves a tag if the release is the newest stable release for that major/minor line (so publishing a backport won't move `v2` backwards). Prereleases are skipped.

For non-draft releases (`create_release_as_draft: false`), the floating tags are promoted immediately after the release is created. If that promotion fails, rerunning the publish workflow resumes it for the existing published release without rebuilding or moving the exact tag.

To promote manually (for example, drafts created before the release commit contained the listener, or a promotion run that was missed), run `mode: promote` with `release_tag` set to the published release tag. The example workflow below exposes this as a `promote_tag` input on `workflow_dispatch`. The same newest-stable-release checks apply.

Serialize all publication and promotion entry points in the repository with the **same concurrency group** and `cancel-in-progress: false`. This keeps the newest-release eligibility check and alias updates inside one serialized execution, preventing an older run from overwriting a newer promotion. The examples use `${{ github.workflow }}-publish`; if publication and promotion live in differently named workflows, use the same fixed group (for example, `Publish GitHub Action-publish`) in each instead. Do not include the branch, tag, or event in the group.

`queue: max` retains up to 100 pending runs instead of replacing the single pending run. The examples target GitHub.com; verify support on your GHES version and use an actionlint version that recognizes this property. Removing `queue: max` on an unsupported host still serializes execution but allows pending runs to be replaced, so a canceled promotion must be rerun.

> [!NOTE]
> Releases published by `GITHUB_TOKEN` do not trigger other workflows, which is why non-draft releases promote in the same run. Drafts published manually in the UI trigger the `release` `published`/`released` events normally. If the workflow file is removed from release commits, set `release_workflow_file` to its path so the released tag retains the listener.

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
| `pull-requests: read`  | Publish  | Check the merged PR label before publishing                            |
| `pull-requests: write` | No       | Post reminder comment on merged PR (`draft_release_pr_reminder: true`) |
| `issues: write`        | No       | Comment on linked issues (`comment_on_linked_issues: true`)            |

Example with all permissions:

```yml
permissions:
  contents: write
  pull-requests: write # read is needed for the label check; write also allows draft_release_pr_reminder
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

concurrency:
  group: ${{ github.workflow }}-publish
  cancel-in-progress: false
  queue: max

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
          skip_release_label: skip-release
```

Add the `skip-release` label to each repository where you want to use this opt-out. Merging a PR with that label skips publishing for that commit; tests and other CI workflows still run. A later unlabelled merge with a version bump can publish the accumulated changes together.

### Example Workflow with Draft Releases

```yml
name: 'Publish GitHub Action'
on:
  workflow_dispatch:
    inputs:
      promote_tag:
        description: 'Only promote floating tags to this published release tag (e.g. v2.1.2); leave empty to publish'
        required: false
        default: ''
  push:
    branches:
      - main
  release:
    types: [published, released]

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: ${{ github.workflow }}-publish
  cancel-in-progress: false
  queue: max

jobs:
  publish:
    if: github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.promote_tag == '')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: joshjohanning/publish-github-action@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          create_release_as_draft: true
          release_workflow_file: .github/workflows/publish.yml
          draft_release_pr_reminder: true

  promote:
    if: (github.event_name == 'release' && !github.event.release.draft && !github.event.release.prerelease) || (github.event_name == 'workflow_dispatch' && inputs.promote_tag != '')
    runs-on: ubuntu-latest
    steps:
      - uses: joshjohanning/publish-github-action@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          mode: promote
          release_tag: ${{ inputs.promote_tag }}
```
