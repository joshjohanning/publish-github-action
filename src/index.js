/**
 * Publish GitHub Action
 * Publishes a GitHub Action by creating releases and tags with production dependencies
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { readFileSync } from 'fs';
import * as semver from 'semver';

/**
 * Main action logic
 */
export async function run() {
  try {
    const githubToken = core.getInput('github_token', { required: true });
    const npmPackageCommand = core.getInput('npm_package_command', { required: false });
    const commitNodeModules = core.getInput('commit_node_modules', { required: false });
    const commitDistFolder = core.getInput('commit_dist_folder', { required: false });
    const publishMinorVersion = core.getInput('publish_minor_version', { required: false });
    const publishReleaseVersion = core.getInput('publish_release_branch', { required: false });

    const context = github.context;
    const octokit = github.getOctokit(githubToken);

    const json = JSON.parse(readFileSync('package.json', 'utf8'));
    const version = `v${json.version}`;
    const minorVersion = `v${semver.major(json.version)}.${semver.minor(json.version)}`;
    const majorVersion = `v${semver.major(json.version)}`;
    const branchName = `releases/${version}`;

    const tags = await octokit.rest.repos.listTags({
      owner: context.repo.owner,
      repo: context.repo.repo
    });

    if (tags.data.some(tag => tag.name === version)) {
      core.info(`Tag ${version} already exists`);
      return;
    }

    await exec.exec('git', ['checkout', '-b', branchName]);
    await exec.exec('npm install --production');
    await exec.exec('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    await exec.exec('git config --global user.name "github-actions[bot]"');
    await exec.exec('git', [
      'remote',
      'set-url',
      'origin',
      `https://x-access-token:${githubToken}@github.com/${context.repo.owner}/${context.repo.repo}.git`
    ]);

    if (npmPackageCommand) {
      await exec.exec(npmPackageCommand);
      await exec.exec('git add .');
    }

    if (commitNodeModules === 'true') {
      await exec.exec('git add -f node_modules');
    }

    if (commitDistFolder === 'true') {
      await exec.exec('git add -f dist');
    }

    await exec.exec('git rm -r .github');
    await exec.exec('git commit -a -m "prod dependencies"');

    if (publishReleaseVersion === 'true') {
      await exec.exec('git', ['push', 'origin', branchName]);
    }

    await exec.exec('git', ['push', 'origin', `:refs/tags/${version}`]);
    await exec.exec('git', ['tag', '-fa', version, '-m', version]);

    if (publishMinorVersion === 'true') {
      await exec.exec('git', ['push', 'origin', `:refs/tags/${minorVersion}`]);
      await exec.exec('git', ['tag', '-f', minorVersion]);
    }

    await exec.exec('git', ['push', 'origin', `:refs/tags/${majorVersion}`]);
    await exec.exec('git', ['tag', '-f', majorVersion]);
    await exec.exec('git push --tags origin');

    // Find the previous semver release to use as baseline for release notes
    const SEMVER_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
    let previousTag;

    try {
      const releases = await octokit.rest.repos.listReleases({
        owner: context.repo.owner,
        repo: context.repo.repo,
        per_page: 100
      });

      if (releases.data.length > 0) {
        // Find the most recent release with a semver tag (vX.Y.Z pattern)
        const semverRelease = releases.data.find(release => {
          const tagName = release.tag_name;
          return tagName && SEMVER_TAG_PATTERN.test(tagName);
        });

        if (semverRelease) {
          previousTag = semverRelease.tag_name;
        }
      }
    } catch (error) {
      core.info(`Could not fetch previous releases: ${error.message}`);
    }

    // Generate release notes
    let releaseNotes = '';
    try {
      const requestData = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        tag_name: version
      };

      // Only add previous_tag_name if we found one
      if (previousTag) {
        requestData.previous_tag_name = previousTag;
        core.info(`Generating release notes from ${previousTag} to ${version}`);
      } else {
        core.info(`Generating release notes for first release ${version}`);
      }

      const generatedNotes = await octokit.request('POST /repos/{owner}/{repo}/releases/generate-notes', requestData);
      releaseNotes = generatedNotes.data.body;
      core.info('Successfully generated release notes');
    } catch (error) {
      core.info(`Could not generate release notes: ${error.message}`);
    }

    await octokit.rest.repos.createRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_name: version,
      name: version,
      body: releaseNotes
    });

    core.info('✅ Action completed successfully!');
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Execute the action (only when run directly, not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

// Export as default for testing
export default run;
