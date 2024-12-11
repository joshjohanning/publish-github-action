import * as core from '@actions/core';
import * as exec from '@actions/exec';
const Github = require('@actions/github');
const { Octokit } = require("@octokit/rest");
const { retry } = require("@octokit/plugin-retry");
const fs = require('fs');
const semver = require('semver');
const githubToken = core.getInput('github_token', { required: true });
const npmPackageCommand = core.getInput('npm_package_command', { required: false });
const commitNodeModules = core.getInput('commit_node_modules', { required: false });
const publishMinorVersion = core.getInput('publish_minor_version', { required: false });
const publishReleaseVersion = core.getInput('publish_release_branch', { required: false });
const context = Github.context;
const MyOctokit = Octokit.plugin(retry)
const octokit = new MyOctokit({
  auth: githubToken,
  request: {
    retries: 4,
    retryAfter: 60,
  },
});

async function run() {
  try {
    let json = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    let version = 'v'+json.version;
    let minorVersion = 'v'+semver.major(json.version)+'.'+semver.minor(json.version);
    let majorVersion = 'v'+semver.major(json.version);
    let branchName: string = 'releases/'+version;
    let installCommand = "npm install --production";
    if (fs.existsSync("pnpm-lock.yaml")) {
      installCommand = "pnpm install --prod";
    } else if (fs.existsSync("yarn.lock")) {
      installCommand = "yarn install --production";
    }

    let tags = await octokit.repos.listTags({owner: context.repo.owner, repo: context.repo.repo});

    if (tags.data.some(tag => tag.name === version)) {
      console.log('Tag', version, 'already exists');
      return;
    }

    await exec.exec('git', ['checkout', '-b', branchName]);
    await exec.exec(installCommand);
    await exec.exec('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
    await exec.exec('git config --global user.name "github-actions[bot]"');
    await exec.exec('git remote set-url origin https://x-access-token:'+githubToken+'@github.com/'+context.repo.owner+'/'+context.repo.repo+'.git');
    if (npmPackageCommand) {
      await exec.exec(npmPackageCommand);
      await exec.exec('git add .');
    }

    if (commitNodeModules === 'true') {
        await exec.exec('git add -f node_modules');
    }
    await exec.exec('git rm -r .github');
    await exec.exec('git commit -a -m "prod dependencies"');
    if (publishReleaseVersion === 'true') {
      await exec.exec('git', ['push', 'origin', branchName]);
    }

    await exec.exec('git', ['push', 'origin', ':refs/tags/'+version]);
    await exec.exec('git', ['tag', '-fa', version, '-m', version]);
    if (publishMinorVersion === 'true') {
      await exec.exec('git', ['push', 'origin', ':refs/tags/'+minorVersion]);
      await exec.exec('git', ['tag', '-f', minorVersion]);
    }
    await exec.exec('git', ['push', 'origin', ':refs/tags/'+majorVersion]);
    await exec.exec('git', ['tag', '-f', majorVersion]);
    await exec.exec('git push --tags origin')

    await octokit.repos.createRelease({owner: context.repo.owner, repo: context.repo.repo, tag_name: version, name: version});

  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
