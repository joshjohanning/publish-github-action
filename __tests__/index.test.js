/**
 * Tests for the Publish GitHub Action
 */

import { jest } from '@jest/globals';

// Mock the @actions/core module
const mockCore = {
  getInput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  warning: jest.fn()
};

// Mock the @actions/exec module
const mockExec = {
  exec: jest.fn()
};

// Mock the @actions/github module
const mockGithub = {
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' }
  },
  getOctokit: jest.fn()
};

// Mock octokit instance
const mockOctokit = {
  rest: {
    repos: {
      listTags: jest.fn(),
      listReleases: jest.fn(),
      createRelease: jest.fn()
    }
  },
  request: jest.fn()
};

// Mock fs module
const mockFs = {
  readFileSync: jest.fn()
};

// Mock semver module
const mockSemver = {
  major: jest.fn(),
  minor: jest.fn()
};

// Mock the modules before importing the main module
jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('@actions/exec', () => mockExec);
jest.unstable_mockModule('@actions/github', () => mockGithub);
jest.unstable_mockModule('fs', () => ({
  readFileSync: mockFs.readFileSync
}));
jest.unstable_mockModule('semver', () => ({
  major: mockSemver.major,
  minor: mockSemver.minor
}));

// Import the main module after mocking
const { default: run } = await import('../src/index.js');

describe('Publish GitHub Action', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mocks
    mockGithub.getOctokit.mockReturnValue(mockOctokit);

    // Default inputs
    mockCore.getInput.mockImplementation(name => {
      const inputs = {
        github_token: 'test-token',
        npm_package_command: 'npm run package',
        commit_node_modules: 'false',
        commit_dist_folder: 'true',
        publish_minor_version: 'false',
        publish_release_branch: 'false'
      };
      return inputs[name] || '';
    });

    // Mock package.json
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        name: 'test-action',
        version: '1.2.3'
      })
    );

    // Mock semver functions
    mockSemver.major.mockReturnValue(1);
    mockSemver.minor.mockReturnValue(2);

    // Mock exec calls
    mockExec.exec.mockResolvedValue(0);

    // Mock GitHub API calls
    mockOctokit.rest.repos.listTags.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.listReleases.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.createRelease.mockResolvedValue({ data: { id: 123 } });
    mockOctokit.request.mockResolvedValue({ data: { body: 'Generated release notes' } });
  });

  describe('Action execution', () => {
    test('should complete successfully with default inputs', async () => {
      await run();

      expect(mockCore.getInput).toHaveBeenCalledWith('github_token', { required: true });
      expect(mockFs.readFileSync).toHaveBeenCalledWith('package.json', 'utf8');
      expect(mockOctokit.rest.repos.listTags).toHaveBeenCalled();
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['checkout', '-b', 'releases/v1.2.3']);
      expect(mockCore.info).toHaveBeenCalledWith('✅ Action completed successfully!');
    });

    test('should skip if tag already exists', async () => {
      mockOctokit.rest.repos.listTags.mockResolvedValue({
        data: [{ name: 'v1.2.3' }]
      });

      await run();

      expect(mockExec.exec).not.toHaveBeenCalledWith('git', ['checkout', '-b', 'releases/v1.2.3']);
      expect(mockCore.info).not.toHaveBeenCalledWith('✅ Action completed successfully!');
    });

    test('should handle npm package command', async () => {
      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('npm run package');
      expect(mockExec.exec).toHaveBeenCalledWith('git add .');
    });

    test('should commit node_modules when enabled', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'true',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git add -f node_modules');
    });

    test('should commit dist folder when enabled', async () => {
      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git add -f dist');
    });

    test('should publish minor version when enabled', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          publish_minor_version: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', 'origin', ':refs/tags/v1.2']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-f', 'v1.2']);
    });

    test('should publish release branch when enabled', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          publish_release_branch: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', 'origin', 'releases/v1.2.3']);
    });

    test('should generate release notes with previous tag', async () => {
      mockOctokit.rest.repos.listReleases.mockResolvedValue({
        data: [{ tag_name: 'v1.2.2' }, { tag_name: 'v1.2.1' }]
      });

      await run();

      expect(mockOctokit.request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/releases/generate-notes', {
        owner: 'test-owner',
        repo: 'test-repo',
        tag_name: 'v1.2.3',
        previous_tag_name: 'v1.2.2'
      });
    });

    test('should create release with generated notes', async () => {
      await run();

      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        tag_name: 'v1.2.3',
        name: 'v1.2.3',
        body: 'Generated release notes'
      });
    });

    test('should handle errors gracefully', async () => {
      const testError = new Error('Test error');
      mockExec.exec.mockRejectedValue(testError);

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Test error');
    });

    test('should handle release notes generation failure', async () => {
      mockOctokit.request.mockRejectedValue(new Error('API Error'));

      await run();

      // Should still create release with empty body
      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        tag_name: 'v1.2.3',
        name: 'v1.2.3',
        body: ''
      });
    });

    test('should handle previous releases fetch failure', async () => {
      mockOctokit.rest.repos.listReleases.mockRejectedValue(new Error('API Error'));

      await run();

      // Should generate release notes without previous tag
      expect(mockOctokit.request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/releases/generate-notes', {
        owner: 'test-owner',
        repo: 'test-repo',
        tag_name: 'v1.2.3'
      });
    });
  });

  describe('Input validation', () => {
    test('should require github_token', async () => {
      mockCore.getInput.mockImplementation(name => {
        if (name === 'github_token') {
          throw new Error('Input required and not supplied: github_token');
        }
        return '';
      });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Input required and not supplied: github_token');
    });
  });

  describe('Version handling', () => {
    test('should handle different version formats', async () => {
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          name: 'test-action',
          version: '2.0.0'
        })
      );
      mockSemver.major.mockReturnValue(2);
      mockSemver.minor.mockReturnValue(0);

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git', ['checkout', '-b', 'releases/v2.0.0']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v2.0.0', '-m', 'v2.0.0']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-f', 'v2']);
    });
  });
});
