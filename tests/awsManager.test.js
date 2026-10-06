import test from 'node:test';
import assert from 'node:assert/strict';
import { AWSManager } from '../server/awsManager.js';

const options = () => ({ awsProfile: 'test-profile', awsRegion: 'ap-south-1' });
const credentials = () => ({ AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'session', Expiration: new Date(Date.now() + 3600000).toISOString() });
const token = () => ({ authorizationToken: 'test-token', expiration: new Date(Date.now() + 43200000).toISOString() });
const output = (data) => ({ stdout: JSON.stringify(data) });
const failure = (stderr) => Object.assign(new Error('command failed'), { stderr });

test('exports SSO credentials for the selected profile, region and child environment', async () => {
  const calls = [];
  const manager = new AWSManager({ options: options(), run: async (command, args, opts) => {
    calls.push({ command, args, opts });
    return output(args.includes('export-credentials') ? credentials() : token());
  } });
  const status = await manager.refreshCredentials();
  assert.equal(status.isValid, true);
  assert.equal(status.isRefreshing, false);
  assert.ok(calls[0].args.includes('test-profile'));
  assert.ok(calls[0].args.includes('ap-south-1'));
  assert.equal(calls[0].opts.env.AWS_ACCESS_KEY_ID, undefined);
  assert.ok(calls[1].args.includes('ap-south-1'));
  assert.equal(calls[1].opts.env.AWS_ACCESS_KEY_ID, 'key');
  assert.equal(manager.getEnv().AWS_SESSION_TOKEN, 'session');
  assert.equal(manager.getEnv().AWS_PROFILE, 'test-profile');
  assert.equal(JSON.stringify(status).includes('test-token'), false);
  manager.cache.credentialsExpireAt = Date.now() - 1;
  assert.equal(manager.getStatus().isValid, false);
  assert.equal(manager.getEnv().CODEARTIFACT_AUTH_TOKEN, '');
});

test('concurrent callers await one refresh and profile changes are blocked while refreshing', async () => {
  let finish;
  let calls = 0;
  const manager = new AWSManager({ options: options(), run: async () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { finish = () => resolve(output(credentials())); });
    return output(token());
  } });
  const first = manager.refreshCredentials();
  const second = manager.refreshCredentials();
  assert.equal(first, second);
  assert.throws(() => manager.configure('other'), /Wait/);
  finish();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(manager.getStatus().isRefreshing, false);
});

test('legacy SSO fallback uses the selected profile, including recovery from expired static keys', async () => {
  for (const mode of ['old-cli', 'expired-static']) {
    let synced = false;
    const manager = new AWSManager({ options: options(), run: async (command, args) => {
      if (command === 'ssocreds') {
        assert.deepEqual(args, ['-p', 'test-profile']);
        synced = true;
        return { stdout: '' };
      }
      if (args.includes('export-credentials')) {
        if (mode === 'old-cli') throw failure('Unknown command export-credentials');
        return output(credentials());
      }
      if (args.includes('get')) {
        assert.ok(args.includes('test-profile'));
        return { stdout: 'legacy-value' };
      }
      if (!synced) throw failure('ExpiredTokenException');
      return output(token());
    } });
    assert.equal((await manager.refreshCredentials()).isValid, true);
    assert.equal(synced, true);
    assert.equal(manager.getEnv().AWS_ACCESS_KEY_ID, 'legacy-value');
  }
});

test('failed refresh is actionable, invalidates old credentials and never tries another profile', async () => {
  let fail = false;
  const manager = new AWSManager({ options: options(), run: async (command, args) => {
    if (fail) throw failure('SSO session expired');
    return output(args.includes('export-credentials') ? credentials() : token());
  } });
  await manager.refreshCredentials();
  fail = true;
  await assert.rejects(manager.refreshCredentials(), /aws sso login --profile test-profile/);
  assert.equal(manager.getStatus().isValid, false);
  assert.equal(manager.getStatus().isRefreshing, false);
  assert.equal(manager.getEnv().AWS_ACCESS_KEY_ID, '');
});

test('profile switch clears previous tokens and invalid JSON cannot expose secret output', async () => {
  const manager = new AWSManager({ options: options(), store: { saveAws: (profile, region) => ({ profile, region }) },
    run: async (command, args) => output(args.includes('export-credentials') ? credentials() : token()) });
  await manager.refreshCredentials();
  manager.configure('another-profile', 'eu-west-1');
  assert.equal(manager.getStatus().hasCodeArtifactToken, false);
  assert.equal(manager.getEnv().AWS_PROFILE, 'another-profile');
  manager.run = async (command) => {
    if (command === 'ssocreds') throw failure('Not available');
    return { stdout: 'secret-token-not-json' };
  };
  await assert.rejects(manager.refreshCredentials(), /invalid JSON/);
  assert.equal(manager.getStatus().lastError.includes('secret-token'), false);
});
