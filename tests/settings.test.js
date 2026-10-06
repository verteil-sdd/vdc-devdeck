import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../server/settings.js';

test('AWS settings and ordered custom stacks survive reload, edit and delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdeck-settings-'));
  try {
    const file = path.join(dir, 'settings.json');
    const store = new SettingsStore(file);
    store.saveAws('my-profile', 'ap-south-1');
    const stack = store.saveStack({ name: 'My stack', services: ['auth', 'gateway'] }, ['auth', 'gateway']);
    const reloaded = new SettingsStore(file);
    assert.equal(reloaded.data.aws.profile, 'my-profile');
    assert.deepEqual(reloaded.data.customStacks[0].services, ['auth', 'gateway']);
    reloaded.saveStack({ ...stack, services: ['gateway'] }, ['auth', 'gateway']);
    assert.deepEqual(new SettingsStore(file).data.customStacks[0].services, ['gateway']);
    reloaded.deleteStack(stack.id);
    assert.deepEqual(new SettingsStore(file).data.customStacks, []);
    assert.equal(new SettingsStore(file).data.aws.profile, 'my-profile');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rejects invalid profiles, regions, unknown repos, duplicates and malformed stack input', () => {
  const store = new SettingsStore('/tmp/devdeck-nonexistent-settings-test/settings.json');
  for (const profile of ['', ' ', 'x;echo hi', '$(cmd)', null]) assert.throws(() => store.saveAws(profile, 'ap-south-1'), /profile/);
  assert.throws(() => store.saveAws('good', 'invalid'), /region/);
  for (const services of [[], ['missing'], ['auth', 'auth'], 'auth', [null]]) {
    assert.throws(() => store.saveStack({ name: 'test', services }, ['auth']));
  }
  assert.throws(() => store.saveStack({ name: ' ', services: ['auth'] }, ['auth']));
});
