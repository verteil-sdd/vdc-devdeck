import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from './config.js';
import { settings } from './settings.js';

const execFileAsync = promisify(execFile);
const FIVE_MINUTES = 5 * 60 * 1000;

export class AWSManager {
  constructor({ run = execFileAsync, options = config, store = settings } = {}) {
    this.run = run;
    this.options = options;
    this.store = store;
    this.cache = { updatedAt: 0, expiresAt: 0, credentialsExpireAt: 0, isValid: false, lastError: null };
    this.refreshPromise = null;
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitStatus() {
    for (const listener of this.listeners) listener(this.getStatus());
  }

  async init() {
    try {
      await this.refreshCredentials();
    } catch (err) {
      console.warn('[AWSManager]', err.message);
    }
  }

  isTokenFresh() {
    return !!(this.cache.isValid && this.cache.CODEARTIFACT_AUTH_TOKEN &&
      this.cache.profile === this.options.awsProfile && this.cache.region === this.options.awsRegion &&
      this.cache.expiresAt > Date.now() + FIVE_MINUTES &&
      this.cache.credentialsExpireAt > Date.now() + FIVE_MINUTES);
  }

  getStatus() {
    return {
      isValid: this.isTokenFresh(),
      updatedAt: this.cache.updatedAt,
      expiresAt: this.cache.expiresAt,
      credentialsExpireAt: this.cache.credentialsExpireAt,
      isRefreshing: !!this.refreshPromise,
      hasCodeArtifactToken: !!this.cache.CODEARTIFACT_AUTH_TOKEN,
      hasAwsKeys: !!(this.cache.AWS_ACCESS_KEY_ID && this.cache.AWS_SECRET_ACCESS_KEY),
      lastError: this.cache.lastError,
      profile: this.options.awsProfile,
      region: this.options.awsRegion
    };
  }

  configure(profile, region = this.options.awsRegion) {
    if (this.refreshPromise) throw new Error('Wait for the current AWS refresh to finish before changing settings.');
    const aws = this.store.saveAws(profile, region);
    this.options.awsProfile = aws.profile;
    this.options.awsRegion = aws.region;
    this.cache = { updatedAt: 0, expiresAt: 0, credentialsExpireAt: 0, isValid: false, lastError: null };
    this.emitStatus();
  }

  // Share the pending refresh so concurrent starts/builds wait for usable credentials.
  refreshCredentials() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = null;
      this.emitStatus();
    });
    this.emitStatus();
    return this.refreshPromise;
  }

  async refresh() {
    const profile = this.options.awsProfile;
    const region = this.options.awsRegion;
    this.cache.lastError = null;
    // Inherited expired keys must not override the selected profile.
    const env = { ...process.env, AWS_PROFILE: profile, AWS_DEFAULT_PROFILE: profile,
      AWS_REGION: region, AWS_DEFAULT_REGION: region, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' };
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN', 'CODEARTIFACT_AUTH_TOKEN']) delete env[key];
    const call = (command, args) => this.run(command, args, { env, timeout: 30000, maxBuffer: 1024 * 1024 });
    const aws = (args) => call('aws', [...args, '--profile', profile, '--region', region]);
    const errorText = (err) => err.code === 'ENOENT'
      ? 'Required command is not installed or is missing from PATH.'
      : err.killed ? 'AWS command timed out.' : String(err.stderr || err.message).trim().slice(0, 1500);
    const parse = (stdout) => {
      try { return JSON.parse(stdout); }
      catch { throw new Error('AWS CLI returned invalid JSON.'); }
    };
    const expiry = (credentials) => credentials.Expiration ? Date.parse(credentials.Expiration)
      : Date.now() + 60 * 60 * 1000;
    let usedLegacy = false;
    const legacyCredentials = async () => {
      usedLegacy = true;
      await call('ssocreds', ['-p', profile]);
      const read = async (key) => (await aws(['configure', 'get', key])).stdout.trim();
      const values = await Promise.all([
        read('aws_access_key_id'), read('aws_secret_access_key'), read('aws_session_token')
      ]);
      if (values.some((value) => !value)) throw new Error('SSO export returned incomplete credentials.');
      return { AccessKeyId: values[0], SecretAccessKey: values[1], SessionToken: values[2] };
    };
    const getToken = async (credentials) => {
      // Use the same resolved keys for CodeArtifact and child processes.
      const tokenEnv = { ...env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey, AWS_SESSION_TOKEN: credentials.SessionToken || '' };
      const { stdout } = await this.run('aws', ['codeartifact', 'get-authorization-token',
        '--domain', 'vdc-repository', '--domain-owner', '683455398069',
        '--region', region, '--output', 'json'], { env: tokenEnv, timeout: 30000 });
      return parse(stdout);
    };

    try {
      let credentials;
      try {
        const { stdout } = await aws(['configure', 'export-credentials', '--format', 'process']);
        credentials = parse(stdout);
        if (!credentials.AccessKeyId || !credentials.SecretAccessKey) throw new Error('AWS CLI returned incomplete credentials.');
        if (!Number.isFinite(expiry(credentials)) || expiry(credentials) <= Date.now() + FIVE_MINUTES) {
          throw new Error('AWS session credentials are expired or expire within five minutes.');
        }
      } catch (exportError) {
        // Matches configure.sh for older AWS CLI versions and legacy SSO setups.
        try {
          credentials = await legacyCredentials();
        } catch (legacyError) {
          throw new Error(`Credential export: ${errorText(exportError)} SSO fallback: ${errorText(legacyError)}`);
        }
      }
      if (!credentials.AccessKeyId || !credentials.SecretAccessKey) throw new Error('AWS CLI returned incomplete credentials.');
      let token;
      try {
        token = await getToken(credentials);
      } catch (tokenError) {
        // ssocreds may have left expired static keys without expiration metadata.
        if (usedLegacy || !/ExpiredToken|InvalidClientTokenId|UnrecognizedClientException/i.test(errorText(tokenError))) throw tokenError;
        credentials = await legacyCredentials();
        token = await getToken(credentials);
      }
      const credentialsExpireAt = expiry(credentials);
      const expiresAt = typeof token.expiration === 'number' ? token.expiration * 1000 : Date.parse(token.expiration);
      if (!token.authorizationToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + FIVE_MINUTES) {
        throw new Error('CodeArtifact returned an empty or expired authorization token.');
      }
      this.cache = {
        AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
        AWS_SESSION_TOKEN: credentials.SessionToken || '',
        CODEARTIFACT_AUTH_TOKEN: token.authorizationToken,
        profile, region, updatedAt: Date.now(), expiresAt, credentialsExpireAt,
        isValid: true, lastError: null
      };
    } catch (err) {
      this.cache.isValid = false;
      this.cache.lastError = `AWS setup failed for profile '${profile}' in ${region}: ${errorText(err)} If your SSO session expired, run: aws sso login --profile ${profile}`;
      throw new Error(this.cache.lastError);
    }
    // The promise finalizer publishes the settled status.
    return { ...this.getStatus(), isRefreshing: false };
  }

  getEnv() {
    const fresh = this.isTokenFresh();
    return {
      AWS_PROFILE: this.options.awsProfile,
      AWS_DEFAULT_PROFILE: this.options.awsProfile,
      AWS_REGION: this.options.awsRegion,
      AWS_DEFAULT_REGION: this.options.awsRegion,
      AWS_ACCESS_KEY_ID: fresh ? this.cache.AWS_ACCESS_KEY_ID : '',
      AWS_SECRET_ACCESS_KEY: fresh ? this.cache.AWS_SECRET_ACCESS_KEY : '',
      AWS_SESSION_TOKEN: fresh ? this.cache.AWS_SESSION_TOKEN : '',
      CODEARTIFACT_AUTH_TOKEN: fresh ? this.cache.CODEARTIFACT_AUTH_TOKEN : ''
    };
  }
}

export const awsManager = new AWSManager();
