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

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ECONNREFUSED',
  'EPIPE'
]);

/**
 * Determine whether an error is likely transient and should be retried.
 * Retries HTTP 429 / 5xx and common network errors; fails fast on auth/validation errors.
 * @param {any} error - Error thrown by the operation
 * @returns {boolean} Whether the error should be retried
 */
export function isTransientError(error) {
  if (!error) {
    return false;
  }

  const status = error.status;
  if (typeof status === 'number') {
    if (status === 429) {
      return true;
    }
    if (status >= 500 && status < 600) {
      return true;
    }
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
      return false;
    }
  }

  const code = error.code;
  if (typeof code === 'string') {
    if (TRANSIENT_NETWORK_CODES.has(code)) {
      return true;
    }
  }

  return false;
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {object} [options] - Retry options
 * @param {number} [options.retries=3] - Maximum number of retries
 * @param {number} [options.baseDelay=1000] - Base delay in ms
 * @param {string} [options.description='operation'] - Description for logging
 * @param {(error: any) => boolean} [options.shouldRetry] - Optional predicate to decide if an error is retryable
 * @returns {Promise<*>} Result of the function
 */
export async function retryWithBackoff(
  fn,
  { retries = 3, baseDelay = 1000, description = 'operation', shouldRetry } = {}
) {
  const retriesNum = Number(retries);
  retries = Number.isFinite(retriesNum) ? Math.max(0, Math.floor(retriesNum)) : 3;

  const baseDelayNum = Number(baseDelay);
  baseDelay = Number.isFinite(baseDelayNum) && baseDelayNum >= 0 ? baseDelayNum : 1000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error?.status;
      const code = error?.code;
      const message = error?.message ?? String(error);
      const retryable = typeof shouldRetry === 'function' ? shouldRetry(error) : isTransientError(error);

      if (!retryable) {
        core.warning(
          `${description} failed with non-retryable error (status: ${status ?? 'unknown'}, code: ${code ?? 'unknown'}): ${message}`
        );
        throw error;
      }

      if (attempt === retries) {
        core.warning(
          `${description} failed after ${retries + 1} attempts (status: ${status ?? 'unknown'}, code: ${code ?? 'unknown'}): ${message}`
        );
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      core.warning(
        `${description} failed (attempt ${attempt + 1}/${retries + 1}, status: ${status ?? 'unknown'}, code: ${code ?? 'unknown'}): ${message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

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

    // 6. Update branch reference with new commit (retry for transient failures)
    // The "Object does not exist" error (422) can occur transiently due to
    // eventual consistency after creating the commit, so we include it as retryable
    await retryWithBackoff(
      () =>
        octokit.rest.git.updateRef({
          owner: context.repo.owner,
          repo: context.repo.repo,
          ref: `heads/${branchName}`,
          sha: newCommit.sha
        }),
      {
        description: `Updating ref heads/${branchName}`,
        shouldRetry: error =>
          isTransientError(error) || (error?.status === 422 && /object does not exist/i.test(error?.message))
      }
    );
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
 * Parse pull request numbers from generated release notes.
 * GitHub's release notes format includes PR URLs like:
 *   https://github.com/owner/repo/pull/42
 * @param {string | null | undefined} text - Release notes body text
 * @returns {number[]} Array of unique PR numbers
 */
export function parsePullRequestNumbers(text) {
  if (!text) {
    return [];
  }

  const prNumbers = new Set();
  const prUrlPattern = /\/pull\/(\d+)/g;
  let match;
  while ((match = prUrlPattern.exec(text)) !== null) {
    prNumbers.add(parseInt(match[1], 10));
  }
  return [...prNumbers];
}

const RELEASE_COMMENT_MARKER = '<!-- publish-github-action-release -->';

/**
 * Build the release comment body with an HTML marker for idempotency.
 * @param {string} version - Version tag (e.g. v1.2.3)
 * @param {string} releaseUrl - URL to the release page
 * @returns {string} Comment body
 */
function buildReleaseCommentBody(version, releaseUrl) {
  return `${RELEASE_COMMENT_MARKER}\n🚀 This has been shipped in **${version}**! ([Release notes](${releaseUrl}))`;
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
    const draftReleasePrReminder = core.getInput('draft_release_pr_reminder', { required: false });
    const commentOnLinkedIssues = core.getInput('comment_on_linked_issues', { required: false });

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

    // Find the previous release to use as baseline for release notes.
    // Fetches releases and selects the highest semver-tagged release that is
    // less than the current version. This correctly handles hotpatches and
    // backports (e.g. publishing v2.0.7 when v4.0.1 exists picks v2.0.6).
    let previousTag;

    try {
      const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        per_page: 100
      });

      const candidates = releases
        .map(r => r.tag_name)
        .filter(tag => tag && semver.valid(tag) && semver.lt(tag, version));

      if (candidates.length > 0) {
        candidates.sort(semver.rcompare);
        previousTag = candidates[0];
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

    const release = await octokit.rest.repos.createRelease({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_name: version,
      name: version,
      body: releaseNotes,
      draft: createReleaseAsDraft === 'true'
    });

    // Post reminder comment on merged PR if draft release was created
    if (createReleaseAsDraft === 'true' && draftReleasePrReminder !== 'false') {
      try {
        // Find the PR associated with the current commit (the merge commit)
        const commitShaForPr = context.sha;
        const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: context.repo.owner,
          repo: context.repo.repo,
          commit_sha: commitShaForPr
        });

        if (prs.length > 0) {
          // Get the most recently merged PR by sorting by merged_at date descending
          const mergedPrs = prs
            .filter(pr => pr.merged_at)
            .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at));

          if (mergedPrs.length === 0) {
            core.info('No merged PR found for this commit, skipping PR comment');
          } else {
            const mergedPr = mergedPrs[0];
            const releaseUrl = release.data.html_url;

            const commentBody =
              `## 📦 Draft Release Created\n\n` +
              `A draft release **${version}** has been created for this PR.\n\n` +
              `🔗 **[View Draft Release](${releaseUrl})**\n\n` +
              `### Next Steps\n` +
              `- [ ] Review the release notes\n` +
              `- [ ] Publish the release to make it permanent\n\n` +
              `> _This is an automated reminder from the publish-github-action workflow._`;

            await octokit.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: mergedPr.number,
              body: commentBody
            });

            core.info(`Posted reminder comment on PR #${mergedPr.number}`);
          }
        } else {
          core.info('No associated PR found for this commit');
        }
      } catch (error) {
        core.warning(`Could not post PR comment: ${error.message}`);
      }
    }

    // Comment on closed issues linked to PRs in the release notes
    if (commentOnLinkedIssues === 'true' && releaseNotes) {
      try {
        const prNumbers = parsePullRequestNumbers(releaseNotes);

        if (prNumbers.length === 0) {
          core.info('No pull request references found in release notes');
        } else {
          core.info(`Found ${prNumbers.length} PR(s) in release notes: ${prNumbers.join(', ')}`);

          // Get authenticated user for idempotency author filtering
          let authenticatedLogin = null;
          try {
            const { data: authUser } = await retryWithBackoff(() => octokit.rest.users.getAuthenticated(), {
              retries: 2,
              baseDelay: 1000,
              description: 'Get authenticated user'
            });
            authenticatedLogin = authUser.login;
            core.debug(`Authenticated as: ${authenticatedLogin}`);
          } catch (error) {
            core.debug(`Could not determine authenticated user: ${error.message}`);
          }

          // Query GraphQL for closing issue references on each PR (with pagination)
          const linkedIssues = new Set();
          for (const prNumber of prNumbers) {
            try {
              let hasNextPage = true;
              let cursor = null;
              while (hasNextPage) {
                const result = await retryWithBackoff(
                  () =>
                    octokit.graphql(
                      `query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
                      repository(owner: $owner, name: $repo) {
                        pullRequest(number: $pr) {
                          closingIssuesReferences(first: 50, after: $cursor) {
                            nodes {
                              number
                              state
                              repository {
                                owner { login }
                                name
                              }
                            }
                            pageInfo {
                              hasNextPage
                              endCursor
                            }
                          }
                        }
                      }
                    }`,
                      { owner: context.repo.owner, repo: context.repo.repo, pr: prNumber, cursor }
                    ),
                  { retries: 2, baseDelay: 1000, description: `GraphQL closingIssuesReferences for PR #${prNumber}` }
                );

                const refs = result.repository?.pullRequest?.closingIssuesReferences;
                const closingIssues = refs?.nodes || [];
                for (const issue of closingIssues) {
                  const issueOwner = issue.repository?.owner?.login;
                  const issueRepo = issue.repository?.name;
                  // Case-insensitive comparison for owner/repo
                  if (
                    issueOwner?.toLowerCase() === context.repo.owner.toLowerCase() &&
                    issueRepo?.toLowerCase() === context.repo.repo.toLowerCase() &&
                    issue.state === 'CLOSED'
                  ) {
                    linkedIssues.add(issue.number);
                  }
                }

                hasNextPage = refs?.pageInfo?.hasNextPage === true;
                cursor = refs?.pageInfo?.endCursor || null;
              }
            } catch (error) {
              core.warning(`Could not fetch linked issues for PR #${prNumber}: ${error.message}`);
            }
          }

          if (linkedIssues.size === 0) {
            core.info('No closed linked issues found across PRs');
          } else {
            core.info(`Found ${linkedIssues.size} closed linked issue(s): ${[...linkedIssues].join(', ')}`);

            const releaseUrl = release.data.html_url;
            const commentBody = buildReleaseCommentBody(version, releaseUrl);
            let commentedCount = 0;

            for (const issueNumber of linkedIssues) {
              try {
                // Check for existing comment with our marker for idempotency
                const existingComments = await retryWithBackoff(
                  () =>
                    octokit.paginate(octokit.rest.issues.listComments, {
                      owner: context.repo.owner,
                      repo: context.repo.repo,
                      issue_number: issueNumber,
                      per_page: 100
                    }),
                  { retries: 2, baseDelay: 1000, description: `List comments on issue #${issueNumber}` }
                );

                // Only consider marker comments authored by us; skip if we couldn't determine identity
                const existingComment =
                  authenticatedLogin === null
                    ? null
                    : existingComments.find(
                        c => c.body?.includes(RELEASE_COMMENT_MARKER) && c.user?.login === authenticatedLogin
                      );

                if (existingComment) {
                  if (existingComment.body !== commentBody) {
                    await retryWithBackoff(
                      () =>
                        octokit.rest.issues.updateComment({
                          owner: context.repo.owner,
                          repo: context.repo.repo,
                          comment_id: existingComment.id,
                          body: commentBody
                        }),
                      { retries: 2, baseDelay: 1000, description: `Update comment on issue #${issueNumber}` }
                    );
                    core.info(`Updated release comment on issue #${issueNumber}`);
                  } else {
                    core.info(`Release comment on issue #${issueNumber} is already up to date`);
                  }
                } else {
                  await retryWithBackoff(
                    () =>
                      octokit.rest.issues.createComment({
                        owner: context.repo.owner,
                        repo: context.repo.repo,
                        issue_number: issueNumber,
                        body: commentBody
                      }),
                    { retries: 2, baseDelay: 1000, description: `Create comment on issue #${issueNumber}` }
                  );
                  core.info(`Posted release comment on issue #${issueNumber}`);
                }

                commentedCount++;
              } catch (error) {
                core.warning(`Could not process issue #${issueNumber}: ${error.message}`);
              }
            }

            core.info(`Processed ${commentedCount} closed issue(s)`);
          }
        }
      } catch (error) {
        core.warning(`Could not comment on linked issues: ${error.message}`);
      }
    }

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
