import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export const gitManager = {
  async getRepoGitInfo(repoPath) {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return { isGit: false };
    }

    try {
      // Branch name
      const { stdout: branchOut } = await execAsync('git branch --show-current', {
        cwd: repoPath,
        timeout: 5000
      });
      const branch = branchOut.trim() || 'detached';

      // Commit info
      const { stdout: commitOut } = await execAsync('git log -1 --format="%h - %s (%cr)"', {
        cwd: repoPath,
        timeout: 5000
      }).catch(() => ({ stdout: '' }));
      const lastCommit = commitOut.trim();

      // Working tree dirty?
      const { stdout: statusOut } = await execAsync('git status --porcelain', {
        cwd: repoPath,
        timeout: 5000
      });
      const isDirty = statusOut.trim().length > 0;
      const changedFilesCount = statusOut.trim() ? statusOut.trim().split('\n').length : 0;

      // Remote sync: ahead / behind
      let ahead = 0;
      let behind = 0;
      try {
        const { stdout: syncOut } = await execAsync('git rev-list --left-right --count HEAD...@{u}', {
          cwd: repoPath,
          timeout: 5000
        });
        const parts = syncOut.trim().split(/\s+/);
        if (parts.length === 2) {
          ahead = parseInt(parts[0], 10) || 0;
          behind = parseInt(parts[1], 10) || 0;
        }
      } catch {
        // No upstream configured or offline
      }

      return {
        isGit: true,
        branch,
        lastCommit,
        isDirty,
        changedFilesCount,
        ahead,
        behind
      };
    } catch (err) {
      return {
        isGit: true,
        branch: 'unknown',
        error: err.message
      };
    }
  },

  pull(repoPath, onLog) {
    return new Promise((resolve, reject) => {
      onLog(`\x1b[36m[GIT]\x1b[0m Starting git pull in ${path.basename(repoPath)}...\n`);
      const child = spawn('git', ['pull'], {
        cwd: repoPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });

      child.stdout.on('data', (data) => onLog(data.toString()));
      child.stderr.on('data', (data) => onLog(data.toString()));

      child.on('close', (code) => {
        if (code === 0) {
          onLog(`\x1b[32m[GIT]\x1b[0m Successfully pulled latest changes.\n`);
          resolve({ success: true });
        } else {
          onLog(`\x1b[31m[GIT]\x1b[0m Git pull failed with code ${code}.\n`);
          reject(new Error(`Git pull exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        onLog(`\x1b[31m[GIT ERROR]\x1b[0m ${err.message}\n`);
        reject(err);
      });
    });
  }
};
