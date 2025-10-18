# Publish GitHub Action

[![GitHub release](https://img.shields.io/github/release/joshjohanning/publish-github-action.svg?labelColor=333)](https://github.com/joshjohanning/publish-github-action/releases)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-publish--github--action--with--ncc-blue?logo=github)](https://github.com/marketplace/actions/publish-github-action-with-ncc)
[![CI](https://github.com/joshjohanning/publish-github-action/actions/workflows/ci.yml/badge.svg)](https://github.com/joshjohanning/publish-github-action/actions/workflows/ci.yml)
[![Publish GitHub Action](https://github.com/joshjohanning/publish-github-action/actions/workflows/publish.yml/badge.svg?branch=main&event=push)](https://github.com/joshjohanning/publish-github-action/actions/workflows/publish.yml)
![Coverage](./badges/coverage.svg)

This action creates a release branch for your GitHub Actions which will be automatically tagged and released. The release version can be defined in `package.json`.

Based on the [tgymnich/publish-github-action](https://github.com/tgymnich/publish-github-action) action, but I wanted further customization and control over the release process (i.e.: adding `ncc` output and not committing `node_modules` directory).

## Features

- 🔐 **Verified Commits** - Uses GitHub API to create verified commits (when `commit_node_modules` is `false`)
- 🏷️ **Annotated Tags** - Creates annotated tags via Git CLI with atomic updates (no downtime)
- 🌐 **Multi-instance Support** - API URL defaults to the environment you are running in; works with GitHub.com, GitHub Enterprise Server, and GHE.com
- 📦 **Flexible Build** - Automatically installs production dependencies and supports custom build commands
- 🗂️ **Selective Commits** - Choose which files to include (dist, node_modules, or both)

## Inputs

| Input                    | Description                                                                                                                                       | Required | Default                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| `github_token`           | Token for the GitHub API                                                                                                                          | Yes      | -                       |
| `github_api_url`         | GitHub API URL (e.g., `https://api.github.com` for GitHub.com or `https://ghes.domain.com/api/v3` for GHES)                                       | No       | `${{ github.api_url }}` |
| `npm_package_command`    | Command to build the action                                                                                                                       | No       | `npm run package`       |
| `commit_node_modules`    | Whether to commit `node_modules` folder. **Note:** When set to `true`, commits will NOT be verified due to API limitations with large file counts | No       | `false`                 |
| `commit_dist_folder`     | Whether to commit `dist` folder                                                                                                                   | No       | `true`                  |
| `publish_minor_version`  | Whether to publish minor version tag (e.g., `v1.2`)                                                                                               | No       | `false`                 |
| `publish_release_branch` | Whether to publish release branch (e.g., `releases/v1.2.3`)                                                                                       | No       | `false`                 |

### Commit Signing Behavior

- ✅ **Verified commits** (signed by GitHub) when `commit_node_modules: false` - Uses GitHub API for commits; tags are created locally via Git CLI
- ❌ **Unverified commits** when `commit_node_modules: true` - Uses Git CLI due to API limitations with large file counts

### Build and File Management

The action automatically handles clean builds and file management:

- **Dist folder cleaning**: When `commit_dist_folder: true` and `npm_package_command` is specified, the `dist/` folder is cleaned before building to ensure no stale files persist
- **Automatic file deletion**: The action removes `.github/` files from release commits and properly handles renamed/deleted files in the `dist/` folder

## Example Workflow

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
      - uses: actions/checkout@v5
      - name: install ncc
        run: npm i -g @vercel/ncc
      - uses: joshjohanning/publish-github-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          npm_package_command: npm run package
          commit_node_modules: false
          commit_dist_folder: true # defaults to true
          publish_minor_version: false
          publish_release_branch: false
```
