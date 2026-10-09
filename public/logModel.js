export const CELL_LIMIT = 500;
export const LOG_LIMIT = 5000;
export const COLUMNS = [
  ['timestamp', 'Timestamp'], ['logType', 'logType'], ['class', 'class'],
  ['application', 'Application'], ['service', 'Service'], ['message', 'message']
];
export const AVAILABLE_COLUMNS = [...COLUMNS,
  ['userId', 'User ID (X-UID)'], ['iata', 'IATA (X-IATA)'],
  ['carrierId', 'Carrier ID (X-CID)'], ['transactionId', 'Transaction ID (X-TID)'],
  ['traceId', 'Trace ID'], ['spanId', 'Span ID'], ['mdc', 'MDC context'], ['raw', 'Raw log']
];

export function normalizeCustomColumn(value) {
  if (!value || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80) return null;
  const { source } = value;
  const field = String(value.field ?? '').trim();
  if (source === 'mdc' ? !/^([1-9]|[12]\d|3[0-2])$/.test(field)
    : source !== 'json' || !/^[A-Za-z_@][A-Za-z0-9_@.-]{0,99}$/.test(field)) return null;
  return { key: `custom:${source}:${field}`, label: value.label.trim(), source, field };
}

export function logColumns(state) {
  return [...AVAILABLE_COLUMNS, ...(state.customColumns || []).map(({ key, label }) => [key, label])];
}

function jsonField(data, path) {
  if (data == null || typeof data !== 'object') return undefined;
  if (Object.hasOwn(data, path)) return data[path];
  return path.split('.').reduce((value, key) => value != null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, data);
}

export function cellValue(row, column, state) {
  const custom = state?.customColumns?.find(({ key }) => key === column);
  if (custom) return display(custom.source === 'mdc' ? row.mdcValues?.[Number(custom.field) - 1] : jsonField(row.fields, custom.field));
  return AVAILABLE_COLUMNS.some(([key]) => key === column) ? display(row[column]) : '';
}

export function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

// Match the server's line buffer: a trailing newline is a terminator, not a row.
export function splitLogChunk(text) {
  const lines = String(text).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function display(value) {
  return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function parseLog(raw, id) {
  const text = stripAnsi(raw);
  const row = { id, raw, timestamp: '', logType: '', class: '', application: '', service: '', message: text };
  const vdc = text.match(/^\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\[([^\]]*)\](?:\s+\[([^\]]*)\])?\s*-[ \t]?([\s\S]*)$/);
  if (vdc) {
    [, row.timestamp, row.logType, row.class, row.application, row.mdc, , row.message] = vdc;
    row.application = row.application.trim();
    // Each literal space separates a Logback %X slot. Empty slots must not shift later values.
    row.mdcValues = row.mdc.split(' ');
    if (row.mdcValues.length >= 5) {
      [row.userId, row.iata, row.service, row.carrierId, row.transactionId] = row.mdcValues;
    } else row.service = row.mdc.trim(); // Older single-Service layouts.
    if (vdc[6] != null) [row.traceId = '', row.spanId = ''] = vdc[6].split(' ');
    return row;
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      row.timestamp = display(data['@timestamp'] ?? data.timestamp ?? data.time);
      row.logType = display(data.logType ?? data['log.level'] ?? data.log?.level ?? data.level ?? data.severity).toUpperCase();
      row.class = display(data.class ?? data.logger_name ?? data['log.logger'] ?? data.log?.logger ?? data.logger);
      row.application = display(data.application);
      row.service = display(data.service);
      row.fields = data;
      for (const [column, keys] of [
        ['userId', ['X-UID', 'mdc.X-UID']], ['iata', ['X-IATA', 'mdc.X-IATA']],
        ['service', ['X-SID', 'mdc.X-SID', 'service.name']], ['carrierId', ['X-CID', 'mdc.X-CID']],
        ['transactionId', ['X-TID', 'mdc.X-TID']], ['traceId', ['dd.trace_id', 'traceId', 'trace.id']],
        ['spanId', ['dd.span_id', 'spanId', 'span.id']]
      ]) {
        const value = keys.map((key) => jsonField(data, key)).find((value) => value != null);
        if (value != null) row[column] = display(value);
      }
      row.message = display(data.message ?? text);
      return row;
    }
  } catch { /* Plain text and stack traces remain readable. */ }
  const timestamp = text.match(/^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  row.timestamp = timestamp?.[1] || '';
  const level = text.match(/\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|OFF)\b/i);
  row.logType = level?.[1].toUpperCase() || '';
  const logger = text.match(/\]\s+([\w.$/-]+)\s*(?::|\s+-\s)/);
  row.class = logger?.[1] || '';
  return row;
}

export function createLogState() {
  return { mode: 'plain', columns: COLUMNS.map(([key]) => key), customColumns: [], widths: {}, search: '', filters: [], sort: { column: '', direction: 'asc' }, selected: null, rows: [], nextId: 0 };
}

export function selectRows(rows, state) {
  const search = state.search.trim().toLowerCase();
  const result = rows.filter((row) => {
    if (search && !stripAnsi(row.raw).toLowerCase().includes(search)) return false;
    return state.filters.every(({ column, operator, value }) => {
      const actual = cellValue(row, column, state);
      const left = actual.toLowerCase();
      const right = value.toLowerCase();
      switch (operator) {
        case 'is': return left === right;
        case 'is_not': return left !== right;
        case 'contains': return left.includes(right);
        case 'not_contains': return !left.includes(right);
        case 'exists': return actual !== '';
        case 'missing': return actual === '';
        default: return true;
      }
    });
  });
  const { column, direction } = state.sort;
  if (logColumns(state).some(([key]) => key === column)) {
    result.sort((a, b) => {
      let order;
      const aValue = cellValue(a, column, state);
      const bValue = cellValue(b, column, state);
      const aTime = column === 'timestamp' ? Date.parse(aValue.replace(',', '.')) : NaN;
      const bTime = column === 'timestamp' ? Date.parse(bValue.replace(',', '.')) : NaN;
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) order = aTime - bTime;
      else order = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
      return (direction === 'desc' ? -order : order) || a.id - b.id;
    });
  }
  return result;
}

export function cellPreview(value) {
  const characters = Array.from(value);
  return { text: characters.slice(0, CELL_LIMIT).join(''), truncated: characters.length > CELL_LIMIT };
}

// A snapshot can already include live events received while its request was pending.
export function mergeSnapshot(snapshot, pending) {
  for (let overlap = Math.min(snapshot.length, pending.length); overlap > 0; overlap--) {
    if (pending.slice(0, overlap).every((line, index) => line === snapshot[snapshot.length - overlap + index])) {
      return [...snapshot, ...pending.slice(overlap)].slice(-LOG_LIMIT);
    }
  }
  return [...snapshot, ...pending].slice(-LOG_LIMIT);
}
