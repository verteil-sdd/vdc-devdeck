import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrator } from '../server/orchestrator.js';
import { discovery } from '../server/discovery.js';
import { supervisor } from '../server/supervisor.js';

function setup(t) {
  const originals = { get: discovery.get, start: supervisor.start, stop: supervisor.stop,
    stopAll: supervisor.stopAll, waitForPort: supervisor.waitForPort };
  discovery.get = (name) => ['auth', 'gateway'].includes(name) ? { name, port: name === 'auth' ? 9000 : 8081 } : undefined;
  supervisor.stop = async () => ({ success: true });
  supervisor.stopAll = async () => ({ success: true });
  orchestrator.status = 'IDLE';
  orchestrator.customRun = null;
  t.after(() => {
    discovery.get = originals.get;
    for (const name of ['start', 'stop', 'stopAll', 'waitForPort']) supervisor[name] = originals[name];
    orchestrator.status = 'IDLE';
    orchestrator.customRun = null;
  });
}
const stack = { id: 'custom-id', name: 'My stack', services: ['auth', 'gateway'] };

test('custom stack follows saved order and waits for readiness', async (t) => {
  setup(t);
  const events = [];
  supervisor.start = async (name) => { events.push(`start:${name}`); return { success: true }; };
  supervisor.waitForPort = async (port) => { events.push(`ready:${port}`); return true; };
  await orchestrator.startCustomStack(stack);
  assert.deepEqual(events, ['start:auth', 'ready:9000', 'start:gateway', 'ready:8081']);
  assert.equal(orchestrator.getStatus().stackName, 'My stack');
  assert.equal(orchestrator.getStatus().status, 'RUNNING');
});

test('missing repositories and startup failure never report success', async (t) => {
  setup(t);
  await assert.rejects(orchestrator.startCustomStack({ ...stack, services: ['missing'] }), /no longer available/);
  supervisor.start = async () => ({ success: false, message: 'No runnable JAR' });
  await assert.rejects(orchestrator.startCustomStack(stack), /No runnable JAR/);
  assert.equal(orchestrator.status, 'ERROR');
});

test('readiness timeout halts a custom sequence', async (t) => {
  setup(t);
  const started = [];
  supervisor.start = async (name) => { started.push(name); return { success: true }; };
  supervisor.waitForPort = async () => false;
  await assert.rejects(orchestrator.startCustomStack(stack), /did not become ready/);
  assert.deepEqual(started, ['auth']);
  assert.equal(orchestrator.status, 'ERROR');
});

test('stop-all cancels pending custom starts and prevents the next service launching', async (t) => {
  setup(t);
  let finishStart;
  const started = [];
  const stopped = [];
  supervisor.start = (name) => { started.push(name); return new Promise((resolve) => { finishStart = resolve; }); };
  supervisor.stop = async (name) => { stopped.push(name); };
  const pending = orchestrator.startCustomStack(stack);
  await assert.rejects(orchestrator.startCustomStack(stack), /already in progress/);
  await orchestrator.stopAll();
  finishStart({ success: true });
  await pending;
  assert.deepEqual(started, ['auth']);
  assert.deepEqual(stopped, ['auth']);
  assert.equal(orchestrator.status, 'IDLE');
});
