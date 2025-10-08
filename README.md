# Publish GitHub Action

[![CI](https://github.com/joshjohanning/publish-github-action/actions/workflows/ci.yml/badge.svg)](https://github.com/joshjohanning/publish-github-action/actions/workflows/ci.yml)
[![Publish GitHub Action](https://github.com/joshjohanning/publish-github-action/actions/workflows/publish.yml/badge.svg?branch=main&event=push)](https://github.com/joshjohanning/publish-github-action/actions/workflows/publish.yml)

This action creates a release branch for your GitHub Actions which will be automatically tagged and released. The release version can be  defined in `package.json`.

Based on the [tgymnich/publish-github-action](https://github.com/tgymnich/publish-github-action) action, but I wanted further customization and control over the release process (i.e.: adding `ncc` output and not committing `node_modules` directory).

## Example Workflow

```yml
name: "Publish GitHub Action"
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
