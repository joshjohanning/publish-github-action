/**
 * Tests for the Publish GitHub Action
 */

import { jest } from '@jest/globals';

// Mock the @actions/core module
const mockCore = {
  getInput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
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
    },
    git: {
      getRef: jest.fn(),
      getCommit: jest.fn(),
      getTree: jest.fn(),
      createTree: jest.fn(),
      createCommit: jest.fn(),
      updateRef: jest.fn(),
      deleteRef: jest.fn(),
      createTag: jest.fn(),
      createRef: jest.fn()
    }
  },
  request: jest.fn()
};

// Mock fs module
const mockFs = {
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  rmSync: jest.fn()
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
  readFileSync: mockFs.readFileSync,
  readdirSync: mockFs.readdirSync,
  statSync: mockFs.statSync,
  rmSync: mockFs.rmSync
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
        github_api_url: 'https://api.github.com',
        npm_package_command: 'npm run package',
        commit_node_modules: 'false',
        commit_dist_folder: 'true',
        publish_minor_version: 'false',
        publish_release_branch: 'false',
        create_release_as_draft: 'false'
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

    // Mock dist folder file listing for API path
    mockFs.readdirSync.mockReturnValue(['index.js']);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false });

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

    // Mock Git API calls
    mockOctokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'abc123' } } });
    mockOctokit.rest.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'tree123' } } });
    mockOctokit.rest.git.getTree.mockResolvedValue({ data: { tree: [] } }); // Empty tree by default
    mockOctokit.rest.git.createTree.mockResolvedValue({ data: { sha: 'newtree123' } });
    mockOctokit.rest.git.createCommit.mockResolvedValue({ data: { sha: 'commit123' } });
    mockOctokit.rest.git.updateRef.mockResolvedValue({ data: {} });
    mockOctokit.rest.git.deleteRef.mockResolvedValue({ data: {} });
    mockOctokit.rest.git.createTag.mockResolvedValue({ data: { sha: 'tag123' } });
    mockOctokit.rest.git.createRef.mockResolvedValue({ data: {} });
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

      // Mock git rev-parse output for getting commit SHA
      const execImplementation = (cmd, args, options) => {
        if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          if (options && options.listeners && options.listeners.stdout) {
            options.listeners.stdout(Buffer.from('abc123\n'));
          }
        }
        return Promise.resolve(0);
      };
      mockExec.exec.mockImplementation(execImplementation);

      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git add -f node_modules');
    });

    test('should commit dist folder when enabled', async () => {
      await run();

      expect(mockExec.exec).toHaveBeenCalledWith('git add -f dist');
    });

    test('should use API for verified commits when not committing node_modules', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock readFileSync to return both package.json and dist file content
      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should use API to create commit
      expect(mockOctokit.rest.git.createCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'chore: prepare v1.2.3 release'
        })
      );

      // Should create annotated tags via Git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v1.2.3', '-m', 'v1.2.3', 'commit123']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', '--force', 'origin', 'refs/tags/v1.2.3']);
    });

    test('should publish minor version when enabled', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          publish_minor_version: 'true',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      await run();

      // Should create minor version tag via Git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v1.2', '-m', 'v1.2', 'commit123']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', '--force', 'origin', 'refs/tags/v1.2']);
    });

    test('should publish release branch when enabled', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          publish_release_branch: 'true',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      await run();

      // Should update branch reference via API when using API commit path
      expect(mockOctokit.rest.git.updateRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'heads/releases/v1.2.3'
        })
      );

      // Should NOT delete remote branch when publishReleaseVersion is true
      expect(mockOctokit.rest.git.deleteRef).not.toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'heads/releases/v1.2.3'
        })
      );
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
        body: 'Generated release notes',
        draft: false
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
        body: '',
        draft: false
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

    test('should create release as draft when create_release_as_draft is true', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          github_api_url: 'https://api.github.com',
          npm_package_command: 'npm run package',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          publish_minor_version: 'false',
          publish_release_branch: 'false',
          create_release_as_draft: 'true'
        };
        return inputs[name] || '';
      });

      await run();

      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        tag_name: 'v1.2.3',
        name: 'v1.2.3',
        body: 'Generated release notes',
        draft: true
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
      // Should create annotated tags via Git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v2.0.0', '-m', 'v2.0.0', 'commit123']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v2', '-m', 'v2', 'commit123']);
    });

    test('should always create major version tag', async () => {
      await run();

      // Major version tag should always be created via Git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v1', '-m', 'v1', 'commit123']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', '--force', 'origin', 'refs/tags/v1']);
    });
  });

  describe('API commit path', () => {
    test('should delete remote branch when publishReleaseVersion is false', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          publish_release_branch: 'false',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should create commit via API
      expect(mockOctokit.rest.git.createCommit).toHaveBeenCalled();

      // Should update branch reference (needed for API operations)
      expect(mockOctokit.rest.git.updateRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'heads/releases/v1.2.3'
        })
      );

      // Should delete remote branch after tags are created
      expect(mockOctokit.rest.git.deleteRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'heads/releases/v1.2.3'
        })
      );

      // Should still create tags via Git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v1.2.3', '-m', 'v1.2.3', 'commit123']);
    });

    test('should handle empty tree when commitDistFolder is false', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'false',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      await run();

      // Should create tree with empty array
      expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: []
        })
      );
    });

    test('should handle API commit creation failure', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      mockOctokit.rest.git.createCommit.mockRejectedValue(new Error('API Error'));

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('API Error');
    });

    test('should delete existing dist and .github files when using API path', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock existing tree with old dist and .github files
      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          tree: [
            { path: 'dist/old-file.js', mode: '100644', type: 'blob', sha: 'oldsha1' },
            { path: 'dist/removed.js', mode: '100644', type: 'blob', sha: 'oldsha2' },
            { path: '.github/workflows/test.yml', mode: '100644', type: 'blob', sha: 'oldsha3' },
            { path: 'README.md', mode: '100644', type: 'blob', sha: 'readmesha' }
          ]
        }
      });

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'new dist file content';
      });

      await run();

      // Should fetch existing tree
      expect(mockOctokit.rest.git.getTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree_sha: 'tree123',
          recursive: true
        })
      );

      // Should create tree with deletion entries (sha: null) for old files
      expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            // .github files marked for deletion
            expect.objectContaining({
              path: '.github/workflows/test.yml',
              sha: null
            }),
            // Old dist files marked for deletion
            expect.objectContaining({
              path: 'dist/old-file.js',
              sha: null
            }),
            expect.objectContaining({
              path: 'dist/removed.js',
              sha: null
            }),
            // New dist file added
            expect.objectContaining({
              path: 'dist/index.js',
              content: 'new dist file content'
            })
          ])
        })
      );
    });

    test('should handle modifying existing dist files', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock existing tree with dist file that will be modified
      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          tree: [
            { path: 'dist/index.js', mode: '100644', type: 'blob', sha: 'oldsha1' },
            { path: 'README.md', mode: '100644', type: 'blob', sha: 'readmesha' }
          ]
        }
      });

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'modified dist content';
      });

      await run();

      // Should mark old file for deletion and add new version
      expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            // Old version marked for deletion
            expect.objectContaining({
              path: 'dist/index.js',
              sha: null
            }),
            // New version added
            expect.objectContaining({
              path: 'dist/index.js',
              content: 'modified dist content'
            })
          ])
        })
      );
    });

    test('should handle deleting dist files', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock existing tree with multiple dist files
      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          tree: [
            { path: 'dist/index.js', mode: '100644', type: 'blob', sha: 'oldsha1' },
            { path: 'dist/utils.js', mode: '100644', type: 'blob', sha: 'oldsha2' },
            { path: 'dist/removed.js', mode: '100644', type: 'blob', sha: 'oldsha3' },
            { path: 'README.md', mode: '100644', type: 'blob', sha: 'readmesha' }
          ]
        }
      });

      // Mock readdirSync to return only 2 files (removed.js is deleted)
      mockFs.readdirSync.mockReturnValue(['index.js', 'utils.js']);

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should mark all old files for deletion
      expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            // All old dist files marked for deletion
            expect.objectContaining({
              path: 'dist/index.js',
              sha: null
            }),
            expect.objectContaining({
              path: 'dist/utils.js',
              sha: null
            }),
            expect.objectContaining({
              path: 'dist/removed.js',
              sha: null
            }),
            // Only 2 new files added (removed.js not included)
            expect.objectContaining({
              path: 'dist/index.js',
              content: 'dist file content'
            }),
            expect.objectContaining({
              path: 'dist/utils.js',
              content: 'dist file content'
            })
          ])
        })
      );

      // Verify removed.js is NOT added back
      const createTreeCall = mockOctokit.rest.git.createTree.mock.calls[0][0];
      const addedFiles = createTreeCall.tree.filter(item => item.content && item.path.startsWith('dist/'));
      expect(addedFiles).toHaveLength(2);
      expect(addedFiles.some(f => f.path === 'dist/removed.js')).toBe(false);
    });

    test('should handle adding new dist files', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock existing tree with one dist file
      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          tree: [
            { path: 'dist/index.js', mode: '100644', type: 'blob', sha: 'oldsha1' },
            { path: 'README.md', mode: '100644', type: 'blob', sha: 'readmesha' }
          ]
        }
      });

      // Mock readdirSync to return 3 files (2 new ones added)
      mockFs.readdirSync.mockReturnValue(['index.js', 'new-module.js', 'another-new.js']);

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should mark old file for deletion and add all 3 files
      expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            // Old file marked for deletion
            expect.objectContaining({
              path: 'dist/index.js',
              sha: null
            }),
            // All 3 files added
            expect.objectContaining({
              path: 'dist/index.js',
              content: 'dist file content'
            }),
            expect.objectContaining({
              path: 'dist/new-module.js',
              content: 'dist file content'
            }),
            expect.objectContaining({
              path: 'dist/another-new.js',
              content: 'dist file content'
            })
          ])
        })
      );

      // Verify all 3 new files are added
      const createTreeCall = mockOctokit.rest.git.createTree.mock.calls[0][0];
      const addedFiles = createTreeCall.tree.filter(item => item.content && item.path.startsWith('dist/'));
      expect(addedFiles).toHaveLength(3);
    });

    test('should remove .github folder in API path', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'false',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock existing tree with .github files
      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          tree: [
            { path: '.github/workflows/ci.yml', mode: '100644', type: 'blob', sha: 'workflow1' },
            { path: '.github/workflows/test.yml', mode: '100644', type: 'blob', sha: 'workflow2' },
            { path: '.github/dependabot.yml', mode: '100644', type: 'blob', sha: 'dependabot' },
            { path: 'dist/index.js', mode: '100644', type: 'blob', sha: 'dist1' },
            { path: 'README.md', mode: '100644', type: 'blob', sha: 'readmesha' }
          ]
        }
      });

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should mark all .github files for deletion
      expect(mockOctokit.rest.git.createTree).toHaveBeenCalledWith(
        expect.objectContaining({
          tree: expect.arrayContaining([
            expect.objectContaining({
              path: '.github/workflows/ci.yml',
              sha: null
            }),
            expect.objectContaining({
              path: '.github/workflows/test.yml',
              sha: null
            }),
            expect.objectContaining({
              path: '.github/dependabot.yml',
              sha: null
            })
          ])
        })
      );

      // Verify .github files are marked for deletion
      const createTreeCall = mockOctokit.rest.git.createTree.mock.calls[0][0];
      const deletedGithubFiles = createTreeCall.tree.filter(
        item => item.sha === null && item.path.startsWith('.github/')
      );
      expect(deletedGithubFiles).toHaveLength(3);
    });
  });

  describe('Git CLI path', () => {
    test('should use git CLI when committing node_modules', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'true',
          commit_dist_folder: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock git rev-parse to return commit SHA
      mockExec.exec.mockImplementation((cmd, args, options) => {
        if (cmd === 'git' && args && args[0] === 'rev-parse' && args[1] === 'HEAD') {
          if (options && options.listeners && options.listeners.stdout) {
            options.listeners.stdout(Buffer.from('gitcommitsha123\n'));
          }
        }
        return Promise.resolve(0);
      });

      await run();

      // Should use git CLI for commit
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['commit', '-a', '-m', 'chore: prepare v1.2.3 release']);

      // Should get commit SHA via git rev-parse
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], expect.any(Object));

      // Should create tags via Git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v1.2.3', '-m', 'v1.2.3', 'gitcommitsha123']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', '--force', 'origin', 'refs/tags/v1.2.3']);

      // Should NOT use API for commit
      expect(mockOctokit.rest.git.createCommit).not.toHaveBeenCalled();
    });

    test('should push branch when publishReleaseVersion is true with git CLI', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          commit_node_modules: 'true',
          publish_release_branch: 'true',
          npm_package_command: 'npm run package'
        };
        return inputs[name] || '';
      });

      // Mock git rev-parse
      mockExec.exec.mockImplementation((cmd, args, options) => {
        if (cmd === 'git' && args && args[0] === 'rev-parse') {
          if (options && options.listeners && options.listeners.stdout) {
            options.listeners.stdout(Buffer.from('abc123\n'));
          }
        }
        return Promise.resolve(0);
      });

      await run();

      // Should push branch via git CLI
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', 'origin', 'releases/v1.2.3']);
    });
  });

  describe('Tag deletion', () => {
    test('should create tags atomically via Git CLI (no deletion needed)', async () => {
      await run();

      // Should still complete successfully
      expect(mockCore.info).toHaveBeenCalledWith('✅ Action completed successfully!');

      // Should create tags via Git CLI with -f flag for atomic updates
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['tag', '-fa', 'v1.2.3', '-m', 'v1.2.3', 'commit123']);
      expect(mockExec.exec).toHaveBeenCalledWith('git', ['push', '--force', 'origin', 'refs/tags/v1.2.3']);
    });
  });

  describe('GHES support', () => {
    test('should use custom API URL for GHES', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          github_api_url: 'https://ghes.example.com/api/v3',
          npm_package_command: 'npm run package',
          commit_node_modules: 'false',
          commit_dist_folder: 'true'
        };
        return inputs[name] || '';
      });

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should create octokit with custom baseUrl
      expect(mockGithub.getOctokit).toHaveBeenCalledWith('test-token', { baseUrl: 'https://ghes.example.com/api/v3' });
    });

    test('should use ghe.com API URL format', async () => {
      mockCore.getInput.mockImplementation(name => {
        const inputs = {
          github_token: 'test-token',
          github_api_url: 'https://api.octocorp.ghe.com',
          npm_package_command: 'npm run package',
          commit_node_modules: 'false',
          commit_dist_folder: 'true'
        };
        return inputs[name] || '';
      });

      mockFs.readFileSync.mockImplementation((path, _encoding) => {
        if (path === 'package.json') {
          return JSON.stringify({ name: 'test-action', version: '1.2.3' });
        }
        return 'dist file content';
      });

      await run();

      // Should create octokit with ghe.com baseUrl
      expect(mockGithub.getOctokit).toHaveBeenCalledWith('test-token', { baseUrl: 'https://api.octocorp.ghe.com' });
    });
  });
});
