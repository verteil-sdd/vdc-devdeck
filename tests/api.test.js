import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function start(dataDir) {
  const child = fork(new URL('./fixtures/api-server.mjs', import.meta.url), [], {
    silent: true, env: { ...process.env, DEVDECK_DATA_DIR: dataDir }
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`API startup timeout: ${logs}`)); }, 10000);
    child.once('message', ({ port }) => { clearTimeout(timer); resolve(port); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`API exited: ${logs}`)); });
  });
  return {
    async request(route, method = 'GET', body) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      });
      return { code: response.status, data: await response.json() };
    },
    async stop() { const exited = once(child, 'exit'); child.kill(); await exited; }
  };
}

test('API saves AWS settings, returns refresh errors, and persists custom stacks across restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdeck-api-'));
  let api;
  try {
    api = await start(dir);
    let result = await api.request('/api/aws/profile', 'POST', { profile: 'selected-profile', region: 'ap-south-1' });
    assert.equal(result.code, 200);
    assert.equal(result.data.status.isValid, true);
    assert.equal(result.data.status.profile, 'selected-profile');
    assert.equal(JSON.stringify(result).includes('fake-secret'), false);
    result = await api.request('/api/aws/profile', 'POST', { profile: 'expired-profile', region: 'ap-south-1' });
    assert.equal(result.code, 500);
    assert.equal(result.data.status.isValid, false);
    assert.match(result.data.message, /SSO session expired/);
    result = await api.request('/api/aws/refresh', 'POST');
    assert.equal(result.code, 500);
    assert.equal(result.data.status.profile, 'expired-profile');
    result = await api.request('/api/aws/profile', 'POST', { profile: 'bad;profile' });
    assert.equal(result.code, 400);
    const created = await api.request('/api/stacks', 'POST', { name: 'My custom stack', services: ['auth', 'gateway'] });
    assert.equal(created.code, 200);
    const id = created.data.stack.id;
    result = await api.request(`/api/stacks/${id}/start`, 'POST');
    assert.equal(result.code, 200);
    result = await api.request('/api/stack/status');
    assert.equal(result.data.stackName, 'My custom stack');
    assert.equal(result.data.status, 'RUNNING');
    result = await api.request('/api/stacks', 'POST', { name: 'Bad stack', services: ['unknown'] });
    assert.equal(result.code, 400);
    await api.stop();
    api = await start(dir);
    result = await api.request('/api/aws');
    assert.equal(result.data.profile, 'expired-profile');
    result = await api.request('/api/stacks');
    assert.deepEqual(result.data.stacks[0].services, ['auth', 'gateway']);
    result = await api.request(`/api/stacks/${id}`, 'DELETE');
    assert.equal(result.code, 200);
    assert.deepEqual((await api.request('/api/stacks')).data.stacks, []);
  } finally {
    if (api) await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
