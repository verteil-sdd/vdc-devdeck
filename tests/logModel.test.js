import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_LIMIT, LOG_LIMIT, COLUMNS, normalizeCustomColumn, cellValue, stripAnsi, splitLogChunk, parseLog, createLogState, selectRows, cellPreview, mergeSnapshot } from '../public/logModel.js';

test('parses VDC fields with an empty or multiword Service and preserves the complete message', () => {
  for (const service of ['', '    ', 'Order Create']) {
    const raw = `2026-10-08 10:28:11,437 INFO  c.v.c.ac.config.ACConfiguration [connector-ac] [${service}] - Creating AC HttpClient `;
    const expected = {
      id: 1, raw, timestamp: '2026-10-08 10:28:11,437', logType: 'INFO',
      class: 'c.v.c.ac.config.ACConfiguration', application: 'connector-ac',
      service: service.trim(), message: 'Creating AC HttpClient '
    };
    const row = parseLog(raw, 1);
    for (const [key, value] of Object.entries(expected)) assert.equal(row[key], value, key);
  }
  const raw = '\x1b[31m2026-10-08 10:28:11,437 ERROR c.v.Order$Handler [connector-ac] [ Order Create ] - Failed [id=1] - retry INFO <payload>\x1b[0m';
  const row = parseLog(raw, 2);
  assert.equal(row.logType, 'ERROR');
  assert.equal(row.class, 'c.v.Order$Handler');
  assert.equal(row.service, 'Order Create');
  assert.equal(row.message, 'Failed [id=1] - retry INFO <payload>');
  assert.equal(row.raw, raw);
});

test('VDC Application and Service fields can be filtered, including missing Service', () => {
  const rows = ['', 'Order Create'].map((service, id) => parseLog(
    `2026-10-08 10:28:11,437 INFO c.v.Order [connector-ac] [${service}] - Ready`, id
  ));
  const state = createLogState();
  state.filters = [
    { column: 'application', operator: 'is', value: 'connector-ac' },
    { column: 'service', operator: 'contains', value: 'order create' }
  ];
  assert.deepEqual(selectRows(rows, state).map((row) => row.id), [1]);
  state.filters[1] = { column: 'service', operator: 'missing', value: '' };
  assert.deepEqual(selectRows(rows, state).map((row) => row.id), [0]);
});

test('extracts the five Logback MDC slots without shifting missing values or stripping message content', () => {
  for (const values of [
    ['USR901', '12345678', 'airshop', 'TP', 'TXN-4421'],
    ['', '12345678', 'orderCreate', '', 'TXN-4421'],
    ['USR901', '', '', 'TP', ''], ['', '', '', '', '']
  ]) {
    const raw = `2026-10-08 14:56:34,120 DEBUG NdcRequestLogger [connector-tpconnect-v1] [${values.join(' ')}] - - actual message - body`;
    const row = parseLog(raw, 1);
    assert.deepEqual([row.userId, row.iata, row.service, row.carrierId, row.transactionId], values);
    assert.equal(row.message, '- actual message - body');
    assert.equal(row.raw, raw);
  }
  const row = parseLog('2026-10-08 14:56:34,115 DEBUG LoggerHelper: [connector-tpconnect-v1] [USR901 12345678 airshop TP TXN-4421] - IsLogEnabled - ClientId : 12345678', 1);
  assert.equal(row.class, 'LoggerHelper:');
  assert.equal(row.message, 'IsLogEnabled - ClientId : 12345678');
  assert.equal(parseLog('- plain text', 1).message, '- plain text');
});

test('additional MDC positions and trace context can be displayed, filtered, and sorted', () => {
  const state = createLogState();
  const custom = normalizeCustomColumn({ label: 'Flow ID', source: 'mdc', field: '6' });
  state.customColumns.push(custom);
  const rows = ['flow10', 'flow2'].map((flow, id) => parseLog(
    `2026-10-08 14:56:34,120 INFO Logger [offermanagement-v1] [u i airshop TP txn ${flow}] [trace span] - Ready`, id));
  assert.equal(cellValue(rows[0], custom.key, state), 'flow10');
  assert.equal(rows[0].traceId, 'trace');
  assert.equal(rows[0].spanId, 'span');
  assert.equal(rows[0].service, 'airshop');
  state.sort = { column: custom.key, direction: 'asc' };
  assert.deepEqual(selectRows(rows, state).map(({ id }) => id), [1, 0]);
  state.filters = [{ column: 'carrierId', operator: 'is', value: 'tp' }, { column: custom.key, operator: 'is', value: 'flow2' }];
  assert.deepEqual(selectRows(rows, state).map(({ id }) => id), [1]);
  assert.equal(cellValue(parseLog('stack trace', 3), custom.key, state), '');
});

test('custom JSON paths support nested and dotted fields without exposing inherited properties', () => {
  const state = createLogState();
  const custom = normalizeCustomColumn({ label: 'Request ID', source: 'json', field: 'mdc.X-RID' });
  state.customColumns.push(custom);
  for (const data of [{ mdc: { 'X-RID': 'R1', 'X-SID': 'airshop' } }, { 'mdc.X-RID': 'R1', 'X-SID': 'airshop' }]) {
    const row = parseLog(JSON.stringify({ message: '- keep message hyphen', ...data }), 1);
    assert.equal(cellValue(row, custom.key, state), 'R1');
    assert.equal(row.service, 'airshop');
    assert.equal(row.message, '- keep message hyphen');
  }
  state.customColumns.push(normalizeCustomColumn({ label: 'Invalid inherited field', source: 'json', field: 'constructor.name' }));
  assert.equal(cellValue(parseLog('{}', 1), state.customColumns[1].key, state), '');
  for (const value of [null, { label: '', source: 'mdc', field: '1' }, { label: 'X', source: 'mdc', field: '0' }, { label: 'X', source: 'mdc', field: '33' }]) {
    assert.equal(normalizeCustomColumn(value), null);
  }
});

test('parses structured and Spring logs without losing payloads or stack traces', () => {
  const json = JSON.stringify({ '@timestamp': '2026-10-08T09:10:00Z', log: { level: 'error', logger: 'vdc.Order' }, message: 'Failed', order: { id: 123 } });
  const structured = parseLog(json, 1);
  assert.equal(structured.timestamp, '2026-10-08T09:10:00Z');
  assert.equal(structured.logType, 'ERROR');
  assert.equal(structured.class, 'vdc.Order');
  assert.equal(structured.message, 'Failed');
  assert.equal(structured.raw, json);
  const raw = '\x1b[32m2026-10-08 10:00:00.123 INFO 123 --- [main] com.vdc.App : Ready\x1b[0m';
  const spring = parseLog(raw, 2);
  assert.equal(spring.timestamp, '2026-10-08 10:00:00.123');
  assert.equal(spring.logType, 'INFO');
  assert.equal(spring.class, 'com.vdc.App');
  assert.equal(spring.message, stripAnsi(raw));
  const trace = '    at com.vdc.App.start(App.java:24)';
  assert.equal(parseLog(trace, 3).message, trace);
  assert.equal(parseLog(trace, 3).timestamp, '');
  assert.equal(parseLog('<img src=x onerror=alert(1)>', 4).message, '<img src=x onerror=alert(1)>');
});

test('filters combine with AND, support all operators, and stay application-specific', () => {
  const rows = [parseLog('{"level":"INFO","logger":"Order"}', 1), parseLog('{"level":"ERROR","logger":"Order"}', 2), parseLog('plain text', 3)];
  const a = createLogState();
  const b = createLogState();
  a.filters.push({ column: 'logType', operator: 'is', value: 'error' }, { column: 'class', operator: 'contains', value: 'ord' });
  assert.deepEqual(selectRows(rows, a).map((row) => row.id), [2]);
  assert.equal(selectRows(rows, b).length, 3);
  for (const [operator, value, expected] of [
    ['is_not', 'ERROR', [1, 3]], ['not_contains', 'err', [1, 3]],
    ['exists', '', [1, 2]], ['missing', '', [3]]
  ]) {
    b.filters = [{ column: 'logType', operator, value }];
    assert.deepEqual(selectRows(rows, b).map((row) => row.id), expected);
  }
  a.search = 'not present';
  assert.deepEqual(selectRows(rows, a), []);
});

test('sorts every column in both directions without mutating arrival order', () => {
  const rows = [
    parseLog('{"timestamp":"2026-10-08T10:00:00Z","level":"INFO","logger":"service10","application":"app10","service":"Order Create","message":"B"}', 1),
    parseLog('{"timestamp":"2026-10-08T10:30:00+02:00","level":"ERROR","logger":"service2","application":"app2","service":"Air Shopping","message":"A"}', 2)
  ];
  const state = createLogState();
  for (const column of COLUMNS.map(([key]) => key)) {
    state.sort = { column, direction: 'asc' };
    const asc = selectRows(rows, state).map((row) => row.id);
    state.sort.direction = 'desc';
    assert.deepEqual(selectRows(rows, state).map((row) => row.id), [...asc].reverse());
    if (column === 'timestamp' || column === 'class') assert.deepEqual(asc, [2, 1]);
  }
  assert.deepEqual(rows.map((row) => row.id), [1, 2]);
  state.sort.column = '';
  assert.deepEqual(selectRows(rows, state).map((row) => row.id), [1, 2]);
});

test('truncates by character without cutting emoji or modifying the full value', () => {
  const value = '😀'.repeat(CELL_LIMIT + 1);
  const preview = cellPreview(value);
  assert.equal(preview.text, '😀'.repeat(CELL_LIMIT));
  assert.equal(preview.truncated, true);
  assert.equal(cellPreview('x'.repeat(CELL_LIMIT)).truncated, false);
  assert.equal(Array.from(value).length, CELL_LIMIT + 1);
});

test('live chunk splitting matches snapshot lines and snapshot merge preserves new arrivals', () => {
  assert.deepEqual(splitLogChunk('first\nsecond\n'), ['first', 'second']);
  assert.deepEqual(splitLogChunk('\nfirst\n\n'), ['', 'first', '']);
  assert.deepEqual(mergeSnapshot(['a', 'b', 'c'], ['b', 'c', 'd']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(mergeSnapshot(['a'], ['b']), ['a', 'b']);
  assert.equal(mergeSnapshot(Array(LOG_LIMIT).fill('a'), ['b']).length, LOG_LIMIT);
});
