import test from 'node:test';
import assert from 'node:assert/strict';
import { LogView } from '../public/logView.js';

function harness() {
  const view = Object.create(LogView.prototype);
  Object.assign(view, {
    app: { logBuffers: new Map(), isTerminalOpen: false }, states: new Map(),
    loads: new Map(), loaded: new Set(), status: { textContent: '' }, refresh() {}
  });
  return view;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Minimal DOM for exercising the actual panel button bindings without a browser dependency.
function panelHarness(t) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  globalThis.document = {
    createElement() {
      return {
        children: [], attributes: {}, listeners: {}, dataset: {}, style: {},
        get lastElementChild() { return this.children.at(-1); },
        focus() {},
        setPointerCapture() {},
        remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); },
        classList: { add() {}, toggle() {} },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        append(...children) {
          for (const child of children) {
            this.children = this.children.filter((existing) => existing !== child);
            this.children.push(child);
            child.parentNode = this;
          }
        },
        replaceChildren(...children) { this.children = children; },
        contains() { return false; }
      };
    }
  };
  const view = harness();
  view.app.repos = new Map([
    ['connector-ac', { status: 'STOPPED' }], ['other', { status: 'RUNNING' }]
  ]);
  view.panels = new Map();
  for (const name of view.app.repos.keys()) view.panels.set(name, view.createPanel(name));
  return view;
}

test('column choices change table order, survive reload, and clear a hidden cell selection', async (t) => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  } });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  });
  const view = panelHarness(t);
  view.refresh = LogView.prototype.refresh;
  const name = 'connector-ac';
  view.app.activeTerminalRepo = name;
  const state = view.state(name);
  state.mode = 'kibana';
  view.append(name, '2026-10-08 12:00:00 INFO example');
  state.selected = { id: 0, column: 'timestamp', value: state.rows[0].timestamp };
  const panel = view.panels.get(name);
  const header = panel.root.children[0].children;
  const sortIndex = header.indexOf(panel.sort.root);
  assert.equal(header[sortIndex + 1], panel.copy);
  assert.equal(header[sortIndex + 2].textContent, 'Clear');
  view.setColumns(name, ['message', 'logType']);
  assert.equal(state.selected, null);
  assert.equal(panel.copy.disabled, true);
  const table = panel.body.children[0];
  assert.deepEqual(table.children[0].children[0].children.map((th) => th.textContent), ['message', 'logType']);
  assert.deepEqual(table.children[1].children[0].children.map((td) => td.children[0].dataset.column), ['message', 'logType']);
  assert.equal(view.state('other').columns.length, 6);
  const reloaded = harness();
  assert.deepEqual(reloaded.state(name).columns, ['message', 'logType']);
  view.setColumns(name, []);
  assert.deepEqual(state.columns, ['message', 'logType']);
  state.selected = { id: 0, column: 'message', value: 'full value' };
  view.updateCopy();
  assert.equal(panel.copy.disabled, false);
  let copied;
  view.copy = async (value) => { copied = value; };
  await panel.copy.listeners.click();
  assert.equal(copied, 'full value');
  state.mode = 'plain';
  view.updateCopy();
  assert.equal(panel.copy.disabled, true);
  saved.set('devdeck.logColumns.invalid', '["unknown"]');
  assert.equal(reloaded.state('invalid').columns.length, 6);
});

test('Columns menu hides, reorders and resets fields while retaining one visible column', (t) => {
  const view = panelHarness(t);
  const panel = view.panels.get('connector-ac');
  const state = view.state('connector-ac');
  const list = panel.columns.content.children[1];
  const timestampRow = list.children[0];
  timestampRow.children[2].listeners.click();
  assert.deepEqual(state.columns.slice(0, 2), ['logType', 'timestamp']);
  const checkbox = timestampRow.children[0].children[0];
  checkbox.checked = false;
  checkbox.listeners.change();
  assert.equal(state.columns.includes('timestamp'), false);
  view.setColumns('connector-ac', ['message']);
  assert.equal(list.children[0].children[0].children[0].disabled, true);
  assert.equal(list.children[0].children[1].disabled, true);
  assert.equal(list.children[0].children[2].disabled, true);
  panel.columns.content.children[2].listeners.click();
  assert.equal(state.columns.length, 6);
  assert.equal(state.columns[0], 'timestamp');
});

test('column resizing preserves live logs, clamps widths, and supports keyboard adjustment', (t) => {
  const view = panelHarness(t);
  view.refresh = LogView.prototype.refresh;
  const name = 'connector-ac';
  const state = view.state(name);
  const panel = view.panels.get(name);
  view.app.activeTerminalRepo = name;
  state.mode = 'kibana';
  view.append(name, 'first');
  view.refresh(name);
  const table = panel.body.children[0];
  const headers = table.children[0].children[0].children;
  const message = headers.at(-1);
  assert.equal(message.style.width, '600px');
  assert.ok(headers.slice(0, -1).every((header) => parseFloat(header.style.width) < 600));
  const handle = message.lastElementChild;
  const event = (clientX) => ({ button: 0, pointerId: 1, clientX, preventDefault() {} });
  handle.listeners.pointerdown(event(600));
  handle.listeners.pointermove(event(850));
  assert.equal(message.style.width, '850px');
  assert.equal(state.widths.message, 850);
  view.append(name, 'during drag');
  view.refresh(name, true);
  assert.equal(panel.body.children[0], table);
  assert.equal(panel.refreshPending, true);
  handle.listeners.pointerup(event(850));
  assert.equal(panel.resizing, false);
  assert.equal(panel.body.children[0].children[1].children.length, 2);
  const currentHeaders = panel.body.children[0].children[0].children[0].children;
  const currentHandle = currentHeaders.at(-1).lastElementChild;
  currentHandle.listeners.keydown({ key: 'ArrowRight', shiftKey: true, preventDefault() {} });
  assert.equal(state.widths.message, 950);
  currentHandle.listeners.pointerdown(event(0));
  currentHandle.listeners.pointermove(event(-10000));
  assert.equal(state.widths.message, 80);
  currentHandle.listeners.pointermove(event(10000));
  assert.equal(state.widths.message, 3000);
  currentHandle.listeners.pointercancel(event(10000));
  assert.equal(panel.resizing, false);
  assert.equal(view.state('other').widths.message, undefined);
  panel.columns.content.children[3].listeners.click();
  assert.deepEqual(state.widths, {});
  assert.equal(panel.body.children[0].children[0].children[0].children.at(-1).style.width, '600px');
});

test('saved column widths survive reload and follow columns when reordered', (t) => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  } });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  });
  const view = panelHarness(t);
  view.state('connector-ac').widths = { message: 900, timestamp: 240 };
  view.saveWidths('connector-ac');
  const reloaded = harness();
  assert.deepEqual(reloaded.state('connector-ac').widths, { message: 900, timestamp: 240 });
  view.setColumns('connector-ac', ['message', 'timestamp']);
  assert.deepEqual(view.tableWidths('connector-ac'), { message: 900, timestamp: 240 });
  saved.set('devdeck.logWidths.invalid', '{"message":"wide","timestamp":-2,"logType":999999,"unknown":100}');
  assert.deepEqual(reloaded.state('invalid').widths, { timestamp: 80, logType: 3000 });
});

test('adding a column renders existing MDC values and updates filter/sort controls; removal clears dependent state', (t) => {
  const view = panelHarness(t);
  view.refresh = LogView.prototype.refresh;
  const name = 'connector-ac';
  view.app.activeTerminalRepo = name;
  const state = view.state(name);
  const panel = view.panels.get(name);
  state.mode = 'kibana';
  view.append(name, '2026-10-08 14:56:34,120 INFO Logger [app] [user iata airshop TP txn request42] - payload');
  const definition = { label: 'Request ID', source: 'mdc', field: '6' };
  assert.equal(view.addColumn(name, definition), '');
  const key = state.customColumns[0].key;
  assert.equal(state.columns.at(-2), key);
  assert.equal(panel.filters.column.children.some((option) => option.value === key), true);
  assert.equal(panel.sort.column.children.some((option) => option.value === key), true);
  const table = panel.body.children[0];
  assert.equal(table.children[1].children[0].children.at(-2).children[0].textContent, 'request42');
  assert.equal(view.tableWidths(name)[key], 180);
  assert.match(view.addColumn(name, definition), /already exists/);
  state.selected = { id: 0, column: key, value: 'request42' };
  state.filters = [{ column: key, operator: 'is', value: 'request42' }];
  state.sort = { column: key, direction: 'asc' };
  view.removeColumn(name, key);
  assert.deepEqual(state.customColumns, []);
  assert.equal(state.columns.includes(key), false);
  assert.deepEqual(state.filters, []);
  assert.equal(state.sort.column, '');
  assert.equal(state.selected, null);
  assert.equal(panel.copy.disabled, true);
  assert.equal(panel.filters.column.children.some((option) => option.value === key), false);
});

test('custom column definitions, visibility, and widths survive reload per application', (t) => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  } });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  });
  const view = panelHarness(t);
  assert.equal(view.addColumn('connector-ac', { label: 'Request', source: 'json', field: 'mdc.X-RID' }), '');
  const state = view.state('connector-ac');
  const key = state.customColumns[0].key;
  state.widths[key] = 250;
  view.saveWidths('connector-ac');
  const reloaded = harness();
  assert.deepEqual(reloaded.state('connector-ac').customColumns, state.customColumns);
  assert.equal(reloaded.state('connector-ac').columns.includes(key), true);
  assert.equal(reloaded.state('connector-ac').widths[key], 250);
  assert.deepEqual(reloaded.state('other').customColumns, []);
});

test('each application panel has its own Kibana toggle and Start/Stop actions', async (t) => {
  const view = panelHarness(t);
  view.app.activeTerminalRepo = 'connector-ac';
  assert.deepEqual(view.visibleNames(), ['connector-ac']);
  const panel = view.panels.get('connector-ac');
  panel.mode.listeners.click();
  assert.equal(view.state('connector-ac').mode, 'kibana');
  assert.equal(view.state('other').mode, 'plain');
  const calls = [];
  view.app.startRepo = async (name) => { calls.push(['start', name]); };
  view.app.stopRepo = async (name) => { calls.push(['stop', name]); };
  await panel.start.listeners.click();
  await view.panels.get('other').stop.listeners.click();
  assert.deepEqual(calls, [['start', 'connector-ac'], ['stop', 'other']]);
  view.app.activeTerminalRepo = 'other';
  assert.deepEqual(view.visibleNames(), ['other']);
  panel.mode.listeners.click();
  assert.equal(view.state('connector-ac').mode, 'plain');
});

test('log controls follow process status, reject duplicate actions, and recover after failure', async (t) => {
  const view = panelHarness(t);
  const panel = view.panels.get('connector-ac');
  const repo = view.app.repos.get('connector-ac');
  for (const status of ['STOPPED', 'ERROR', 'STARTING', 'RUNNING', 'BUILDING', 'PULLING']) {
    repo.status = status;
    view.updateControls('connector-ac');
    const active = ['STARTING', 'RUNNING', 'BUILDING', 'PULLING'].includes(status);
    assert.equal(panel.start.disabled, active, status);
    assert.equal(panel.stop.disabled, !active, status);
  }
  repo.status = 'STOPPED';
  const request = deferred();
  let requests = 0;
  view.app.startRepo = async () => { requests++; await request.promise; throw new Error('offline'); };
  const starting = panel.start.listeners.click();
  assert.equal(panel.start.disabled, true);
  assert.equal(panel.stop.disabled, true);
  await panel.start.listeners.click();
  assert.equal(requests, 1);
  request.resolve();
  await starting;
  assert.match(view.status.textContent, /offline/);
  assert.equal(panel.start.disabled, false);
  view.app.repos.delete('connector-ac');
  view.updateControls('connector-ac');
  assert.equal(panel.start.disabled, true);
  assert.equal(panel.stop.disabled, true);
});

test('snapshot loading keeps live arrivals and does not mix application state', async (t) => {
  const response = deferred();
  t.mock.method(globalThis, 'fetch', () => response.promise);
  const view = harness();
  const loading = view.ensureLoaded('application with spaces');
  view.append('application with spaces', 'during\nafter\n');
  view.append('other', 'separate\n');
  response.resolve({ ok: true, json: async () => ({ success: true, lines: ['before', 'during'] }) });
  await loading;
  assert.deepEqual(view.state('application with spaces').rows.map((row) => row.raw), ['before', 'during', 'after']);
  assert.deepEqual(view.state('other').rows.map((row) => row.raw), ['separate']);
  assert.equal(globalThis.fetch.mock.calls[0].arguments[0], '/api/repos/application%20with%20spaces/logs');
});

test('clear invalidates an in-flight snapshot without losing later live logs', async (t) => {
  const response = deferred();
  t.mock.method(globalThis, 'fetch', () => response.promise);
  const view = harness();
  const loading = view.ensureLoaded('app');
  view.cleared('app');
  view.append('app', 'fresh\n');
  response.resolve({ ok: true, json: async () => ({ success: true, lines: ['old'] }) });
  await loading;
  assert.deepEqual(view.state('app').rows.map((row) => row.raw), ['fresh']);
});

test('late HTTP clear response cannot delete logs received after the clear event', async (t) => {
  const response = deferred();
  t.mock.method(globalThis, 'fetch', () => response.promise);
  const view = harness();
  view.append('app', 'old\n');
  const clearing = view.clear('app');
  view.cleared('app');
  view.append('app', 'fresh\n');
  response.resolve({ ok: true });
  await clearing;
  assert.deepEqual(view.state('app').rows.map((row) => row.raw), ['fresh']);
});

test('failed loads can be retried and failed clears preserve existing logs', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const view = harness();
  view.append('app', 'retained\n');
  await view.ensureLoaded('app');
  assert.equal(view.loads.size, 0);
  assert.equal(view.loaded.has('app'), false);
  assert.match(view.state('app').error, /offline/);
  await view.clear('app');
  assert.deepEqual(view.state('app').rows.map((row) => row.raw), ['retained']);
  assert.equal(view.status.textContent, 'offline');
});

test('stream buffers stay bounded with stable row identities', () => {
  const view = harness();
  view.append('app', Array.from({ length: 5010 }, (_, index) => `line ${index}`).join('\n'));
  assert.equal(view.state('app').rows.length, 5000);
  assert.equal(view.app.logBuffers.get('app').length, 5000);
  const first = view.state('app').rows[1];
  view.append('app', 'last\n');
  assert.equal(view.state('app').rows[0], first);
});
