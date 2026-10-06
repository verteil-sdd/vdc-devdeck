import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { config } from './config.js';

const execAsync = promisify(exec);

class AWSManager {
  constructor() {
    this.cache = {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
      AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN || '',
      CODEARTIFACT_AUTH_TOKEN: process.env.CODEARTIFACT_AUTH_TOKEN || '',
      updatedAt: 0,
      isValid: false,
      lastError: null
    };
    this.isRefreshing = false;
  }

  async init() {
    // Try to load cached token or refresh once on boot
    try {
      await this.refreshCredentials();
    } catch (err) {
      console.warn('[AWSManager] Initial token refresh failed (user may need to run aws sso login):', err.message);
    }
  }

  isTokenFresh() {
    // CodeArtifact token is valid for 12 hours (43200 seconds); refresh if older than 10 hours
    const TEN_HOURS = 10 * 60 * 60 * 1000;
    return (
      this.cache.CODEARTIFACT_AUTH_TOKEN &&
      Date.now() - this.cache.updatedAt < TEN_HOURS
    );
  }

  getStatus() {
    const profile = config.awsProfile || process.env.AWS_PROFILE || 'sdd';
    return {
      isValid: !!this.cache.CODEARTIFACT_AUTH_TOKEN && this.isTokenFresh(),
      updatedAt: this.cache.updatedAt,
      isRefreshing: this.isRefreshing,
      hasCodeArtifactToken: !!this.cache.CODEARTIFACT_AUTH_TOKEN,
      hasAwsKeys: !!(this.cache.AWS_ACCESS_KEY_ID && this.cache.AWS_SECRET_ACCESS_KEY),
      lastError: this.cache.lastError,
      profile
    };
  }

  async refreshCredentials() {
    if (this.isRefreshing) {
      return this.getStatus();
    }
    this.isRefreshing = true;
    this.cache.lastError = null;

    try {
      let parsed = {};
      const profile = config.awsProfile || process.env.AWS_PROFILE || 'sdd';

      // 1. Fast path: Direct AWS CLI token retrieval using configured profile (~2-3s)
      try {
        const fastTokenCmd =
          `aws codeartifact get-authorization-token --profile ${profile} --domain vdc-repository --domain-owner 683455398069 --query authorizationToken --output text`;
        const { stdout: tokenOut } = await execAsync(fastTokenCmd, { timeout: 12000 });
        const token = tokenOut.trim();
        if (token && token.length > 20 && !token.includes('Error')) {
          const { stdout: akId } = await execAsync(`aws configure get --profile ${profile} aws_access_key_id`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
          const { stdout: secKey } = await execAsync(`aws configure get --profile ${profile} aws_secret_access_key`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
          const { stdout: sessTok } = await execAsync(`aws configure get --profile ${profile} aws_session_token`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
          parsed = {
            AWS_ACCESS_KEY_ID: akId.trim(),
            AWS_SECRET_ACCESS_KEY: secKey.trim(),
            AWS_SESSION_TOKEN: sessTok.trim(),
            CODEARTIFACT_AUTH_TOKEN: token
          };
        }
      } catch {
        // Fast path failed or credentials need full ssocreds refresh
      }

      // 2. Full refresh via configure.sh (handles legacy ssocreds if script exists)
      if (!parsed.CODEARTIFACT_AUTH_TOKEN && fs.existsSync(config.awsConfigScript)) {
        try {
          const cmd = `bash -c '. "${config.awsConfigScript}" >/dev/null 2>&1; echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"; echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"; echo "AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN"; echo "CODEARTIFACT_AUTH_TOKEN=$CODEARTIFACT_AUTH_TOKEN"'`;
          const { stdout } = await execAsync(cmd, { timeout: 90000 });
          const lines = stdout.split('\n');
          for (const line of lines) {
            const idx = line.indexOf('=');
            if (idx > -1) {
              const key = line.slice(0, idx).trim();
              let val = line.slice(idx + 1).trim();
              if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
              }
              parsed[key] = val;
            }
          }
        } catch (scriptErr) {
          console.warn('[AWSManager] awsConfigScript execution failed:', scriptErr.message);
        }
      }

      // 3. Fallback: Direct AWS CLI token retrieval without explicit profile
      if (!parsed.CODEARTIFACT_AUTH_TOKEN && profile !== 'default') {
        try {
          const defaultTokenCmd =
            'aws codeartifact get-authorization-token --domain vdc-repository --domain-owner 683455398069 --query authorizationToken --output text';
          const { stdout: tokenOut } = await execAsync(defaultTokenCmd, { timeout: 12000 });
          const token = tokenOut.trim();
          if (token && token.length > 20 && !token.includes('Error')) {
            const { stdout: akId } = await execAsync('aws configure get aws_access_key_id', { timeout: 5000 }).catch(() => ({ stdout: '' }));
            const { stdout: secKey } = await execAsync('aws configure get aws_secret_access_key', { timeout: 5000 }).catch(() => ({ stdout: '' }));
            const { stdout: sessTok } = await execAsync('aws configure get aws_session_token', { timeout: 5000 }).catch(() => ({ stdout: '' }));
            parsed = {
              AWS_ACCESS_KEY_ID: akId.trim(),
              AWS_SECRET_ACCESS_KEY: secKey.trim(),
              AWS_SESSION_TOKEN: sessTok.trim(),
              CODEARTIFACT_AUTH_TOKEN: token
            };
          }
        } catch {}
      }

      if (!parsed.CODEARTIFACT_AUTH_TOKEN) {
        throw new Error(`Failed to retrieve CODEARTIFACT_AUTH_TOKEN using AWS profile '${profile}'. Please run: aws sso login --profile ${profile}`);
      }

      this.cache = {
        AWS_ACCESS_KEY_ID: parsed.AWS_ACCESS_KEY_ID || '',
        AWS_SECRET_ACCESS_KEY: parsed.AWS_SECRET_ACCESS_KEY || '',
        AWS_SESSION_TOKEN: parsed.AWS_SESSION_TOKEN || '',
        CODEARTIFACT_AUTH_TOKEN: parsed.CODEARTIFACT_AUTH_TOKEN,
        updatedAt: Date.now(),
        isValid: true,
        lastError: null
      };

      console.log('[AWSManager] AWS credentials and CodeArtifact token refreshed successfully.');
    } catch (err) {
      this.cache.lastError = err.message;
      this.cache.isValid = false;
      console.error('[AWSManager] Error refreshing AWS credentials:', err.message);
      throw err;
    } finally {
      this.isRefreshing = false;
    }

    return this.getStatus();
  }

  getEnv() {
    return {
      AWS_ACCESS_KEY_ID: this.cache.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: this.cache.AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN: this.cache.AWS_SESSION_TOKEN,
      CODEARTIFACT_AUTH_TOKEN: this.cache.CODEARTIFACT_AUTH_TOKEN
    };
  }
}

export const awsManager = new AWSManager();
