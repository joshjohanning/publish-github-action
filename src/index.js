/**
 * Publish GitHub Action
 * Publishes a GitHub Action by creating releases and tags with production dependencies
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import { readFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as semver from 'semver';

/**
 * Create a commit using GitHub API for verified commits
 * @param {object} octokit - GitHub API client
 * @param {object} context - GitHub Actions context
 * @param {string} branchName - Name of the branch to commit to
 * @param {string} version - Version being released
 * @param {string} commitDistFolder - Whether to commit dist folder
 * @returns {string} The SHA of the new commit
 */
async function createCommitViaAPI(octokit, context, branchName, version, commitDistFolder) {
  try {
    core.info('Creating verified commit via GitHub API...');

    // 1. Get current branch reference
    const { data: ref } = await octokit.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${branchName}`
    });
    core.info(`Current branch SHA: ${ref.object.sha}`);

    // 2. Get current commit
    const { data: commit } = await octokit.rest.git.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      commit_sha: ref.object.sha
    });
    core.info(`Current commit tree SHA: ${commit.tree.sha}`);

    // 3. Build tree with changed files
    const treeItems = [];

    // Get the tree from the parent commit to identify files to delete
    let existingTree;
    try {
      const { data: tree } = await octokit.rest.git.getTree({
        owner: context.repo.owner,
        repo: context.repo.repo,
        tree_sha: commit.tree.sha,
        recursive: true
      });
      existingTree = tree.tree;
    } catch (error) {
      core.info(`Could not fetch existing tree: ${error.message}`);
      existingTree = [];
    }

    // Always remove .github folder from release commits
    const githubFiles = existingTree.filter(item => item.path.startsWith('.github/'));
    for (const file of githubFiles) {
      treeItems.push({
        path: file.path,
        mode: file.mode,
        type: 'blob',
        sha: null // null sha marks file for deletion
      });
    }
    if (githubFiles.length > 0) {
      core.info(`Marked ${githubFiles.length} .github files for deletion`);
    }

    // If committing dist folder, first delete any existing dist files then add new ones
    if (commitDistFolder === 'true') {
      // Mark all existing dist/ files for deletion to handle renames/removals
      const existingDistFiles = existingTree.filter(item => item.path.startsWith('dist/'));
      for (const file of existingDistFiles) {
        treeItems.push({
          path: file.path,
          mode: file.mode,
          type: 'blob',
          sha: null // null sha marks file for deletion
        });
      }
      if (existingDistFiles.length > 0) {
        core.info(`Marked ${existingDistFiles.length} existing dist files for deletion`);
      }

      // Now add the new dist files
      const distFiles = await getFilesRecursively('dist');
      for (const file of distFiles) {
        const content = readFileSync(file.path, 'utf8');
        treeItems.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: content
        });
      }
      core.info(`Added ${distFiles.length} files from dist folder`);
    }

    // 4. Create new tree
    const { data: newTree } = await octokit.rest.git.createTree({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base_tree: commit.tree.sha,
      tree: treeItems
    });
    core.info(`Created new tree: ${newTree.sha}`);

    // 5. Create new commit (automatically signed by GitHub)
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      message: `chore: prepare ${version} release`,
      tree: newTree.sha,
      parents: [commit.sha]
    });
    core.info(`Created new verified commit: ${newCommit.sha}`);

    // 6. Update branch reference with new commit
    await octokit.rest.git.updateRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha
    });
    core.info(`Updated branch ${branchName} to ${newCommit.sha}`);

    return newCommit.sha;
  } catch (error) {
    core.error(`Failed to create commit via API: ${error.message}`);
    throw error;
  }
}

/**
 * Recursively get all files in a directory
 * @param {string} dir - Directory to scan
 * @returns {Array} Array of file objects with path
 */
function getFilesRecursively(dir) {
  const files = [];

  function scan(currentDir) {
    const items = readdirSync(currentDir);

    for (const item of items) {
      const fullPath = join(currentDir, item).replace(/\\/g, '/');
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        scan(fullPath);
      } else {
        files.push({ path: fullPath });
      }
    }
  }

  scan(dir);
  return files;
}

/**
 * Main action logic
 */
export async function run() {
  try {
    const githubToken = core.getInput('github_token', { required: true });
    const githubApiUrl = core.getInput('github_api_url', { required: false });
    const npmPackageCommand = core.getInput('npm_package_command', { required: false });
    const commitNodeModules = core.getInput('commit_node_modules', { required: false });
    const commitDistFolder = core.getInput('commit_dist_folder', { required: false });
    const publishMinorVersion = core.getInput('publish_minor_version', { required: false });
    const publishReleaseVersion = core.getInput('publish_release_branch', { required: false });
    const createReleaseAsDraft = core.getInput('create_release_as_draft', { required: false });

    const context = github.context;
    const opts = githubApiUrl ? { baseUrl: githubApiUrl } : {};
    const octokit = github.getOctokit(githubToken, opts);

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
    await exec.exec('npm', ['ci', '--omit=dev']);
    await exec.exec('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    await exec.exec('git config --global user.name "github-actions[bot]"');
    await exec.exec('git', [
      'remote',
      'set-url',
      'origin',
      `https://x-access-token:${githubToken}@github.com/${context.repo.owner}/${context.repo.repo}.git`
    ]);

    if (npmPackageCommand) {
      // Clean dist folder before building to remove stale files
      if (commitDistFolder === 'true') {
        rmSync('dist', { recursive: true, force: true });
        core.info('Cleaned dist folder before build');
      }

      await exec.exec(npmPackageCommand);
      await exec.exec('git add .');
    }

    if (commitNodeModules === 'true') {
      await exec.exec('git add -f node_modules');
    }

    if (commitDistFolder === 'true') {
      await exec.exec('git add -f dist');
    }

    // Remove .github folder from local git (for Git CLI path)
    // API path also removes .github by marking files for deletion in the tree
    // Use --ignore-unmatch to avoid failure if .github doesn't exist
    await exec.exec('git', ['rm', '-r', '--ignore-unmatch', '.github']);

    // Use API for verified commits when not committing node_modules
    // Otherwise fall back to git CLI (node_modules too large for API)
    let commitSha;
    if (commitNodeModules === 'true') {
      // Use git CLI - node_modules too large for API
      await exec.exec('git', ['commit', '-a', '-m', `chore: prepare ${version} release`]);

      // Always push release branch (needed for API operations, cleaned up later if needed)
      await exec.exec('git', ['push', 'origin', branchName]);

      // Get the commit SHA for tagging
      let shaOutput = '';
      await exec.exec('git', ['rev-parse', 'HEAD'], {
        listeners: {
          stdout: data => {
            shaOutput += data.toString();
          }
        }
      });
      commitSha = shaOutput.trim();
    } else {
      // Use GitHub API for verified commits
      // Push branch first so API can reference it
      await exec.exec('git', ['push', 'origin', branchName]);

      commitSha = await createCommitViaAPI(octokit, context, branchName, version, commitDistFolder);

      // Fetch the commit created via API so local git knows about it
      await exec.exec('git', ['fetch', 'origin', branchName]);
      core.info('Fetched API-created commit to local repository');
    }

    core.info(`Commit SHA for tagging: ${commitSha}`);

    // Create annotated tags via Git CLI for atomic updates (no downtime)
    // Tags will point to verified commits created via API
    await exec.exec('git', ['tag', '-fa', version, '-m', version, commitSha]);
    core.info(`Created annotated tag ${version}`);

    if (publishMinorVersion === 'true') {
      await exec.exec('git', ['tag', '-fa', minorVersion, '-m', minorVersion, commitSha]);
      core.info(`Created annotated tag ${minorVersion}`);
    }

    await exec.exec('git', ['tag', '-fa', majorVersion, '-m', majorVersion, commitSha]);
    core.info(`Created annotated tag ${majorVersion}`);

    // Push tags atomically (force push to update existing tags)
    await exec.exec('git', ['push', '--force', 'origin', `refs/tags/${version}`]);
    core.info(`Pushed tag ${version}`);

    if (publishMinorVersion === 'true') {
      await exec.exec('git', ['push', '--force', 'origin', `refs/tags/${minorVersion}`]);
      core.info(`Pushed tag ${minorVersion}`);
    }

    await exec.exec('git', ['push', '--force', 'origin', `refs/tags/${majorVersion}`]);
    core.info(`Pushed tag ${majorVersion}`);

    // Clean up release branch if not publishing
    if (publishReleaseVersion !== 'true') {
      try {
        await octokit.rest.git.deleteRef({
          owner: context.repo.owner,
          repo: context.repo.repo,
          ref: `heads/${branchName}`
        });
        core.info(`Deleted remote release branch ${branchName} (commit accessible via tags)`);
      } catch (error) {
        core.warning(`Failed to delete release branch ${branchName}: ${error.message}`);
      }
    }

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
      body: releaseNotes,
      draft: createReleaseAsDraft === 'true'
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
