"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const github = __importStar(require("@actions/github"));
const fs = require('fs');
const semver = require('semver');
const githubToken = core.getInput('github_token', { required: true });
const npmPackageCommand = core.getInput('npm_package_command', { required: false });
const commitNodeModules = core.getInput('commit_node_modules', { required: false });
const publishMinorVersion = core.getInput('publish_minor_version', { required: false });
const publishReleaseVersion = core.getInput('publish_release_branch', { required: false });
const context = github.context;
const octokit = github.getOctokit(githubToken);
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let json = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            let version = 'v' + json.version;
            let minorVersion = 'v' + semver.major(json.version) + '.' + semver.minor(json.version);
            let majorVersion = 'v' + semver.major(json.version);
            let branchName = 'releases/' + version;
            let tags = yield octokit.repos.listTags({ owner: context.repo.owner, repo: context.repo.repo });
            if (tags.data.some(tag => tag.name === version)) {
                console.log('Tag', version, 'already exists');
                return;
            }
            yield exec.exec('git', ['checkout', '-b', branchName]);
            yield exec.exec('npm install --production');
            yield exec.exec('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
            yield exec.exec('git config --global user.name "github-actions[bot]"');
            yield exec.exec('git remote set-url origin https://x-access-token:' + githubToken + '@github.com/' + context.repo.owner + '/' + context.repo.repo + '.git');
            if (npmPackageCommand) {
                yield exec.exec(npmPackageCommand);
                yield exec.exec('git add .');
            }
            if (commitNodeModules === 'true') {
                yield exec.exec('git add -f node_modules');
            }
            yield exec.exec('git rm -r .github');
            yield exec.exec('git commit -a -m "prod dependencies"');
            if (publishReleaseVersion === 'true') {
                yield exec.exec('git', ['push', 'origin', branchName]);
            }
            yield exec.exec('git', ['push', 'origin', ':refs/tags/' + version]);
            yield exec.exec('git', ['tag', '-fa', version, '-m', version]);
            if (publishMinorVersion === 'true') {
                yield exec.exec('git', ['push', 'origin', ':refs/tags/' + minorVersion]);
                yield exec.exec('git', ['tag', '-f', minorVersion]);
            }
            yield exec.exec('git', ['push', 'origin', ':refs/tags/' + majorVersion]);
            yield exec.exec('git', ['tag', '-f', majorVersion]);
            yield exec.exec('git push --tags origin');
            // Find the previous semver release to use as baseline for release notes
            const SEMVER_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
            let previousTag;
            try {
                const releases = yield octokit.repos.listReleases({
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
            }
            catch (error) {
                console.log('Could not fetch previous releases:', error.message);
            }
            // Generate release notes
            let releaseNotes = '';
            if (previousTag) {
                try {
                    const generatedNotes = yield octokit.request('POST /repos/{owner}/{repo}/releases/generate-notes', {
                        owner: context.repo.owner,
                        repo: context.repo.repo,
                        tag_name: version,
                        previous_tag_name: previousTag
                    });
                    releaseNotes = generatedNotes.data.body;
                    console.log('Generated release notes from', previousTag, 'to', version);
                }
                catch (error) {
                    console.log('Could not generate release notes:', error.message);
                }
            }
            else {
                console.log('No previous semver release found, creating release without generated notes');
            }
            yield octokit.repos.createRelease({
                owner: context.repo.owner,
                repo: context.repo.repo,
                tag_name: version,
                name: version,
                body: releaseNotes
            });
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
run();
