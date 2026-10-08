import { ansiToHtml } from './ansi.js';
import { renderCardMetadata } from './cardMetadata.js';
import { COLUMNS, logColumns, normalizeCustomColumn, cellValue, LOG_LIMIT, createLogState, parseLog, splitLogChunk, selectRows, cellPreview, mergeSnapshot } from './logModel.js';

const PAGE_SIZE = 100;
const DEFAULT_WIDTHS = { timestamp: 210, logType: 90, class: 180, application: 150, service: 150, message: 600 };
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 3000;
const OPERATORS = [['contains', 'contains'], ['not_contains', 'does not contain'], ['is', 'is'], ['is_not', 'is not'], ['exists', 'exists'], ['missing', 'is missing']];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, action) {
  const node = element('button', 'log-button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function select(options, label) {
  const node = element('select');
  node.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const option = element('option', '', text);
    option.value = value;
    node.append(option);
  }
  return node;
}

export class LogView {
  constructor(app) {
    this.app = app;
    this.states = new Map();
    this.panels = new Map();
    this.loads = new Map();
    this.loaded = new Set();
    this.copyOwner = null;
    this.dirty = new Set();
    this.screen = app.terminalScreen;
    this.status = document.getElementById('logViewStatus');
    this.dialog = document.getElementById('logDetailDialog');
    this.dialogText = document.getElementById('logDetailText');
    this.dialogStatus = document.getElementById('logDetailStatus');
    document.getElementById('logDetailClose').addEventListener('click', () => this.dialog.close());
    document.getElementById('logDetailCopy').addEventListener('click', () => this.copy(this.dialogText.textContent, this.dialogStatus));
    document.getElementById('logDetailSave').addEventListener('click', () => this.saveDetail());
    document.addEventListener('click', (event) => {
      for (const menu of document.querySelectorAll('.log-menu[open]')) {
        if (!menu.contains(event.target)) menu.open = false;
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        for (const menu of document.querySelectorAll('.log-menu[open]')) {
          menu.open = false;
          menu.querySelector('summary').focus();
        }
      }
    });
  }

  state(name) {
    if (!this.states.has(name)) {
      const state = createLogState();
      try {
        const saved = JSON.parse(localStorage.getItem(`devdeck.logCustomColumns.${name}`));
        if (Array.isArray(saved)) {
          for (const value of saved.slice(0, 32)) {
            const column = normalizeCustomColumn(value);
            if (column && !state.customColumns.some(({ key }) => key === column.key)) state.customColumns.push(column);
          }
        }
      } catch { /* Ignore invalid custom column definitions. */ }
      try {
        const saved = JSON.parse(localStorage.getItem(`devdeck.logColumns.${name}`));
        if (Array.isArray(saved)) {
          const columns = [...new Set(saved.filter((key) => logColumns(state).some(([column]) => column === key)))];
          if (columns.length) state.columns = columns;
        }
      } catch { /* Storage may be unavailable or contain outdated preferences. */ }
      try {
        const saved = JSON.parse(localStorage.getItem(`devdeck.logWidths.${name}`));
        for (const [key] of logColumns(state)) {
          if (Number.isFinite(saved?.[key])) state.widths[key] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, saved[key]));
        }
      } catch { /* Use default widths when storage is unavailable or invalid. */ }
      this.states.set(name, state);
    }
    return this.states.get(name);
  }

  visibleNames() {
    return this.app.activeTerminalRepo ? [this.app.activeTerminalRepo] : [];
  }

  async ensureLoaded(name) {
    if (this.loaded.has(name)) return;
    if (this.loads.has(name)) return this.loads.get(name).promise;
    const load = { pending: [], promise: null };
    this.loads.set(name, load);
    load.promise = (async () => {
      try {
        const response = await fetch(`/api/repos/${encodeURIComponent(name)}/logs`);
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.lines)) throw new Error(data.message || 'Could not load logs');
        // Clear invalidates a pending snapshot so old logs cannot reappear.
        if (this.loads.get(name) !== load) return;
        const lines = mergeSnapshot(data.lines, load.pending);
        this.app.logBuffers.set(name, lines);
        const state = this.state(name);
        state.rows = lines.map((line) => parseLog(line, state.nextId++));
        state.selected = null;
        state.error = '';
        this.loaded.add(name);
      } catch (error) {
        if (this.loads.get(name) === load) this.state(name).error = `${error.message}. Reopen the log tab to retry.`;
      } finally {
        if (this.loads.get(name) === load) this.loads.delete(name);
        this.refresh(name, true);
      }
    })();
    this.refresh(name);
    return load.promise;
  }

  append(name, chunk) {
    const lines = splitLogChunk(chunk);
    const state = this.state(name);
    const buffer = this.app.logBuffers.get(name) || [];
    buffer.push(...lines);
    if (buffer.length > LOG_LIMIT) buffer.splice(0, buffer.length - LOG_LIMIT);
    this.app.logBuffers.set(name, buffer);
    const pending = this.loads.get(name)?.pending;
    if (pending) {
      pending.push(...lines);
      if (pending.length > LOG_LIMIT) pending.splice(0, pending.length - LOG_LIMIT);
    }
    state.rows.push(...lines.map((line) => parseLog(line, state.nextId++)));
    if (state.rows.length > LOG_LIMIT) state.rows.splice(0, state.rows.length - LOG_LIMIT);
    if (!this.app.isTerminalOpen || !this.visibleNames().includes(name)) return;
    this.dirty.add(name);
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      for (const repo of this.dirty) this.refresh(repo, true);
      this.dirty.clear();
    }, 150);
  }

  cleared(name) {
    this.loads.delete(name);
    this.loaded.add(name);
    this.app.logBuffers.set(name, []);
    const state = this.state(name);
    state.rows = [];
    state.selected = null;
    state.page = 0;
    state.error = '';
    state.clearRevision = (state.clearRevision || 0) + 1;
    this.refresh(name);
  }

  async clear(name) {
    if (!name) return;
    const revision = this.state(name).clearRevision || 0;
    try {
      const response = await fetch(`/api/repos/${encodeURIComponent(name)}/logs/clear`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not clear logs');
      // A WebSocket clear may arrive before the HTTP response, followed by fresh logs.
      if ((this.state(name).clearRevision || 0) === revision) this.cleared(name);
    } catch (error) { this.status.textContent = error.message; }
  }

  render() {
    const names = this.visibleNames();
    if (!names.includes(this.copyOwner)) this.copyOwner = names.find((name) => this.state(name).selected) || null;
    this.app.termClearBtn.disabled = !names.length;
    this.app.termClearBtn.title = 'Clear application logs';
    for (const [name, panel] of this.panels) {
      if (!names.includes(name)) { panel.root.remove(); this.panels.delete(name); }
    }
    if (!this.panels.size) this.screen.replaceChildren();
    for (const name of names) {
      let panel = this.panels.get(name);
      if (!panel) {
        panel = this.createPanel(name);
        this.panels.set(name, panel);
      }
      this.screen.append(panel.root);
      this.refresh(name);
    }
    if (!names.length) this.screen.textContent = 'Open an application log to view its output.';
    this.updateCopy();
  }

  createPanel(name) {
    const state = this.state(name);
    const root = element('section', 'log-panel');
    root.setAttribute('aria-label', `${name} logs`);
    const header = element('div', 'log-panel-header');
    const title = element('strong', 'log-panel-title', name);
    const heading = element('div', 'log-panel-heading');
    const metadata = element('div', 'log-panel-metadata');
    const port = element('span', 'card-port text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40');
    port.hidden = true;
    heading.append(title, port, metadata);
    const mode = button('Kibana view', () => {
      state.mode = state.mode === 'plain' ? 'kibana' : 'plain';
      state.selected = null;
      this.refresh(name);
    });
    mode.setAttribute('aria-label', `Toggle Kibana view for ${name}`);
    const start = button('Start', () => this.runAction(name, 'start'));
    const stop = button('Stop', () => this.runAction(name, 'stop'));
    start.classList.add('log-start');
    stop.classList.add('log-stop');
    start.setAttribute('aria-label', `Start ${name}`);
    stop.setAttribute('aria-label', `Stop ${name}`);
    const search = element('input', 'log-search');
    search.type = 'search';
    search.placeholder = 'Search this application…';
    search.setAttribute('aria-label', `Search ${name} logs`);
    search.value = state.search;
    search.addEventListener('input', () => { state.search = search.value; state.page = 0; this.refresh(name); });
    const filters = this.createFilters(name);
    const sort = this.createSort(name);
    const columns = this.createColumns(name);
    const copy = button('Copy cell', () => {
      if (state.selected) this.copy(state.selected.value, this.status);
    });
    copy.disabled = true;
    header.append(heading, start, stop, mode, search, columns.root, filters.root, sort.root, copy, button('Clear', () => this.clear(name)));
    const body = element('div', 'log-panel-body');
    body.tabIndex = 0;
    body.setAttribute('aria-label', `${name} log content`);
    const footer = element('div', 'log-panel-footer');
    const count = element('span');
    const previous = button('Previous', () => { state.page = (state.page || 0) - 1; this.refresh(name); });
    const next = button('Next', () => { state.page = (state.page || 0) + 1; this.refresh(name); });
    footer.append(count, previous, next);
    root.append(header, body, footer);
    return { root, body, metadata, port, mode, start, stop, filters, sort, columns, copy, count, previous, next };
  }

  updateControls(name) {
    const panel = this.panels.get(name);
    if (!panel) return;
    const repo = this.app.repos.get(name);
    const status = repo?.status;
    panel.port.hidden = !repo?.port;
    panel.port.textContent = repo?.port ? `:${repo.port}` : '';
    panel.port.title = repo?.port ? `Application port: ${repo.port}` : '';
    const metadataHtml = repo ? renderCardMetadata(repo) : '';
    if (panel.metadataHtml !== metadataHtml) {
      panel.metadata.innerHTML = metadataHtml;
      panel.metadataHtml = metadataHtml;
    }
    const active = ['RUNNING', 'STARTING', 'BUILDING', 'PULLING'].includes(status);
    const pending = !!this.state(name).actionPending;
    panel.start.disabled = pending || !['STOPPED', 'ERROR'].includes(status);
    panel.stop.disabled = pending || !active;
  }

  async runAction(name, action) {
    this.updateControls(name);
    if (this.panels.get(name)?.[action]?.disabled !== false) return;
    const state = this.state(name);
    state.actionPending = true;
    this.updateControls(name);
    try {
      if (action === 'start') await this.app.startRepo(name);
      else await this.app.stopRepo(name);
    } catch (error) {
      this.status.textContent = `Could not ${action} ${name}: ${error.message}`;
    } finally {
      state.actionPending = false;
      this.updateControls(name);
    }
  }

  menu(label) {
    const root = element('details', 'log-menu');
    const summary = element('summary', 'log-button', label);
    const content = element('div', 'log-submenu');
    root.append(summary, content);
    root.addEventListener('toggle', () => {
      if (root.open) for (const other of document.querySelectorAll('.log-menu[open]')) {
        if (other !== root) other.open = false;
      }
    });
    return { root, summary, content };
  }

  createFilters(name) {
    const state = this.state(name);
    const menu = this.menu('Filters');
    const list = element('div', 'log-filter-list');
    const form = element('form', 'log-filter-form');
    const column = select(logColumns(state), 'Filter column');
    const operator = select(OPERATORS, 'Filter operator');
    const value = element('input');
    value.placeholder = 'Filter value';
    value.setAttribute('aria-label', 'Filter value');
    value.required = true;
    operator.addEventListener('change', () => {
      value.disabled = ['exists', 'missing'].includes(operator.value);
      value.required = !value.disabled;
    });
    const add = element('button', 'log-button', 'Add filter');
    add.type = 'submit';
    form.append(column, operator, value, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      state.filters.push({ column: column.value, operator: operator.value, value: value.value });
      state.page = 0;
      value.value = '';
      this.refresh(name);
    });
    menu.content.append(element('p', 'log-hint', 'Match all filters (AND). Values are case-insensitive.'), list, form,
      button('Clear filters', () => { state.filters = []; state.page = 0; this.refresh(name); }));
    return { ...menu, list, column };
  }

  createSort(name) {
    const state = this.state(name);
    const menu = this.menu('Sort');
    const column = select([['', 'Received order'], ...logColumns(state)], 'Sort column');
    const direction = select([['asc', 'Ascending'], ['desc', 'Descending']], 'Sort direction');
    column.value = state.sort.column;
    direction.value = state.sort.direction;
    direction.disabled = !column.value;
    column.addEventListener('change', () => { direction.disabled = !column.value; });
    menu.content.append(column, direction, button('Apply sort', () => {
      state.sort = { column: column.value, direction: direction.value };
      state.page = 0;
      menu.root.open = false;
      this.refresh(name);
    }));
    return { ...menu, column };
  }

  setColumns(name, columns) {
    const state = this.state(name);
    const valid = [...new Set(columns.filter((key) => logColumns(state).some(([column]) => column === key)))];
    if (!valid.length) return;
    state.columns = valid;
    if (state.selected && !valid.includes(state.selected.column)) state.selected = null;
    try { localStorage.setItem(`devdeck.logColumns.${name}`, JSON.stringify(valid)); }
    catch { /* The controls still work when browser storage is unavailable. */ }
    this.panels.get(name)?.columns.update();
    this.refresh(name);
  }

  saveCustomColumns(name) {
    try { localStorage.setItem(`devdeck.logCustomColumns.${name}`, JSON.stringify(this.state(name).customColumns)); }
    catch { /* Custom columns remain available for this session. */ }
    const panel = this.panels.get(name);
    if (!panel) return;
    for (const [control, options] of [
      [panel.filters.column, logColumns(this.state(name))],
      [panel.sort.column, [['', 'Received order'], ...logColumns(this.state(name))]]
    ]) {
      const previous = control.value;
      control.replaceChildren(...select(options, '').children);
      if (options.some(([key]) => key === previous)) control.value = previous;
    }
  }

  addColumn(name, definition) {
    const state = this.state(name);
    const column = normalizeCustomColumn(definition);
    if (!column) return 'Enter a name and a valid JSON field path or MDC position (1–32).';
    if (state.customColumns.some(({ key }) => key === column.key)) return 'A column for this field already exists. Enable it in the list above.';
    if (state.customColumns.length >= 32) return 'Remove a custom column before adding another (maximum 32).';
    state.customColumns.push(column);
    this.saveCustomColumns(name);
    const columns = [...state.columns];
    const messageIndex = columns.indexOf('message');
    columns.splice(messageIndex < 0 ? columns.length : messageIndex, 0, column.key);
    this.setColumns(name, columns);
    return '';
  }

  removeColumn(name, key) {
    const state = this.state(name);
    state.customColumns = state.customColumns.filter((column) => column.key !== key);
    state.filters = state.filters.filter((filter) => filter.column !== key);
    if (state.sort.column === key) state.sort = { column: '', direction: 'asc' };
    delete state.widths[key];
    this.saveWidths(name);
    this.saveCustomColumns(name);
    const columns = state.columns.filter((column) => column !== key);
    this.setColumns(name, columns.length ? columns : ['message']);
  }

  createColumns(name) {
    const state = this.state(name);
    const menu = this.menu('Columns');
    const list = element('div', 'log-column-list');
    const controls = new Map();
    const update = () => {
      const available = logColumns(state);
      for (const [key, label] of available) if (!controls.has(key)) createControl(key, label);
      for (const [key, control] of controls) {
        if (!available.some(([column]) => column === key)) { control.row.remove(); controls.delete(key); }
      }
      const ordered = [...state.columns, ...available.map(([key]) => key).filter((key) => !state.columns.includes(key))];
      for (const key of ordered) {
        const { row, checkbox, left, right } = controls.get(key);
        const index = state.columns.indexOf(key);
        checkbox.checked = index !== -1;
        checkbox.disabled = checkbox.checked && state.columns.length === 1;
        left.disabled = index <= 0;
        right.disabled = index === -1 || index === state.columns.length - 1;
        list.append(row);
      }
      menu.summary.textContent = `Columns (${state.columns.length})`;
    };
    const createControl = (key, label) => {
      const row = element('div', 'log-column-item');
      const field = element('label');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => this.setColumns(name, checkbox.checked
        ? [...state.columns, key] : state.columns.filter((column) => column !== key)));
      field.append(checkbox, element('span', '', label));
      const move = (offset) => {
        const columns = [...state.columns];
        const index = columns.indexOf(key);
        if (index < 0 || index + offset < 0 || index + offset >= columns.length) return;
        [columns[index], columns[index + offset]] = [columns[index + offset], columns[index]];
        this.setColumns(name, columns);
      };
      const left = button('←', () => move(-1));
      const right = button('→', () => move(1));
      left.setAttribute('aria-label', `Move ${label} left`);
      right.setAttribute('aria-label', `Move ${label} right`);
      row.append(field, left, right);
      if (state.customColumns.some((column) => column.key === key)) {
        const remove = button('Remove', () => this.removeColumn(name, key));
        remove.setAttribute('aria-label', `Remove ${label} column`);
        row.append(remove);
      }
      controls.set(key, { row, checkbox, left, right });
    };
    menu.content.append(element('p', 'log-hint', 'Choose columns and change their order. Keep at least one column visible.'), list,
      button('Reset columns', () => this.setColumns(name, COLUMNS.map(([key]) => key))),
      button('Reset widths', () => {
        state.widths = {};
        this.saveWidths(name);
        this.refresh(name);
      }));
    const form = element('form', 'log-add-column');
    const label = element('input');
    label.placeholder = 'Column name';
    label.setAttribute('aria-label', 'New column name');
    label.required = true;
    label.maxLength = 80;
    const source = select([['mdc', 'MDC position'], ['json', 'JSON field']], 'Column source');
    const field = element('input');
    field.placeholder = 'Position, e.g. 6';
    field.setAttribute('aria-label', 'Column field or position');
    field.required = true;
    field.maxLength = 100;
    source.addEventListener('change', () => { field.placeholder = source.value === 'mdc' ? 'Position, e.g. 6' : 'Field, e.g. mdc.X-RID'; });
    const submit = element('button', 'log-button', 'Add column');
    submit.type = 'submit';
    const error = element('p', 'log-column-error');
    error.setAttribute('role', 'status');
    form.append(label, source, field, submit, error);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      error.textContent = this.addColumn(name, { label: label.value, source: source.value, field: field.value });
      if (!error.textContent) { label.value = ''; field.value = ''; label.focus(); }
    });
    menu.content.append(element('p', 'log-hint', 'Add fields from the log: MDC positions start at 1 (User, IATA, Service, Carrier, Transaction). JSON accepts a field name or dotted path. Missing values stay empty.'), form);
    update();
    return { ...menu, update };
  }

  saveWidths(name) {
    try { localStorage.setItem(`devdeck.logWidths.${name}`, JSON.stringify(this.state(name).widths)); }
    catch { /* Resizing still works without browser storage. */ }
  }

  tableWidths(name) {
    const state = this.state(name);
    const widths = Object.fromEntries(state.columns.map((key) => [key, state.widths[key] ?? DEFAULT_WIDTHS[key] ?? 180]));
    const total = Object.values(widths).reduce((sum, width) => sum + width, 0);
    const flexible = state.columns.includes('message') ? 'message' : state.columns.at(-1);
    if (state.widths[flexible] == null) {
      widths[flexible] += Math.max(0, (this.panels.get(name).body.clientWidth || 0) - total);
    }
    return widths;
  }

  sizeTable(table, headers, widths) {
    table.style.width = `${Object.values(widths).reduce((sum, width) => sum + width, 0)}px`;
    for (const [key, th] of headers) {
      th.style.width = `${widths[key]}px`;
      th.lastElementChild.setAttribute('aria-valuenow', String(Math.round(widths[key])));
    }
  }

  createResizeHandle(name, key, label, table, headers, widths) {
    const handle = element('span', 'log-column-resize');
    handle.dataset.resizeColumn = key;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Resize ${label} column`);
    handle.setAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH));
    handle.setAttribute('aria-valuemax', String(MAX_COLUMN_WIDTH));
    handle.title = 'Drag to resize; use Left/Right arrow keys when focused';
    const panel = this.panels.get(name);
    let drag = null;
    const resize = (width) => {
      widths[key] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
      // Freeze the visible layout so live refreshes do not redistribute a resized column.
      Object.assign(this.state(name).widths, widths);
      this.sizeTable(table, headers, widths);
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || panel.resizing) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, x: event.clientX, width: widths[key] };
      panel.resizing = true;
    });
    handle.addEventListener('pointermove', (event) => {
      if (drag?.pointerId === event.pointerId) resize(drag.width + event.clientX - drag.x);
    });
    const finish = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      panel.resizing = false;
      this.saveWidths(name);
      if (panel.refreshPending) {
        panel.refreshPending = false;
        this.refresh(name, true);
      }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finish);
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      resize(widths[key] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 100 : 20));
      this.saveWidths(name);
    });
    return handle;
  }

  refresh(name, streaming = false) {
    const panel = this.panels.get(name);
    if (!panel) { this.updateCopy(); return; }
    // Keep pointer capture intact while logs continue arriving during a drag.
    if (panel.resizing) { panel.refreshPending = true; return; }
    this.updateControls(name);
    const state = this.state(name);
    const kibana = state.mode === 'kibana';
    panel.mode.setAttribute('aria-pressed', String(kibana));
    panel.filters.root.hidden = !kibana;
    panel.sort.root.hidden = !kibana;
    panel.columns.root.hidden = !kibana;
    if (!kibana) { panel.filters.root.open = false; panel.sort.root.open = false; panel.columns.root.open = false; }
    panel.filters.summary.textContent = `Filters${state.filters.length ? ` (${state.filters.length})` : ''}`;
    panel.sort.summary.textContent = state.sort.column ? `Sort: ${logColumns(state).find(([key]) => key === state.sort.column)[1]} ${state.sort.direction === 'asc' ? '↑' : '↓'}` : 'Sort';
    // Keep open forms and their focus intact when new logs arrive.
    if (!streaming) {
      panel.filters.list.replaceChildren();
      state.filters.forEach((filter, index) => {
        const item = element('div', 'log-filter-item');
        item.append(element('span', '', `${filter.column} ${OPERATORS.find(([key]) => key === filter.operator)[1]} ${['exists', 'missing'].includes(filter.operator) ? '' : filter.value}`),
          button('Remove', () => { state.filters.splice(index, 1); state.page = 0; this.refresh(name); }));
        panel.filters.list.append(item);
      });
    }
    const rows = selectRows(state.rows, kibana ? state : { ...state, filters: [], sort: { column: '' } });
    const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
    if (state.page == null || (streaming && this.app.autoScroll && (!kibana || !state.sort.column))) state.page = lastPage;
    state.page = Math.max(0, Math.min(state.page, lastPage));
    const visible = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    if (state.selected && (!kibana || !visible.some((row) => row.id === state.selected.id))) state.selected = null;
    const scrollTop = panel.body.scrollTop;
    const scrollLeft = panel.body.scrollLeft;
    const focused = panel.body.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.dataset.rowId;
    const focusColumn = focused?.dataset.column;
    const resizeColumn = focused?.dataset.resizeColumn;
    panel.body.replaceChildren();
    if (!visible.length) {
      panel.body.append(element('p', 'log-empty', state.error || (this.loads.has(name) ? 'Loading logs…' : state.rows.length ? 'No logs match these filters.' : 'No logs recorded yet.')));
    } else if (kibana) {
      const table = element('table', 'log-table');
      const widths = this.tableWidths(name);
      const headers = new Map();
      const head = element('thead');
      const heading = element('tr');
      for (const key of state.columns) {
        const label = logColumns(state).find(([column]) => column === key)[1];
        const th = element('th', '', label);
        th.scope = 'col';
        headers.set(key, th);
        th.append(this.createResizeHandle(name, key, label, table, headers, widths));
        if (state.sort.column === key) th.setAttribute('aria-sort', state.sort.direction === 'asc' ? 'ascending' : 'descending');
        heading.append(th);
      }
      head.append(heading);
      const tbody = element('tbody');
      for (const row of visible) {
        const tr = element('tr');
        for (const column of state.columns) tr.append(this.createCell(name, row, column));
        tbody.append(tr);
      }
      table.append(head, tbody);
      this.sizeTable(table, headers, widths);
      panel.body.append(table);
    } else {
      const fragment = document.createDocumentFragment();
      for (const row of visible) {
        const line = element('div', 'log-plain-line');
        line.innerHTML = ansiToHtml(row.raw);
        fragment.append(line);
      }
      panel.body.append(fragment);
    }
    panel.count.textContent = `${rows.length ? state.page * PAGE_SIZE + 1 : 0}–${Math.min((state.page + 1) * PAGE_SIZE, rows.length)} of ${rows.length} entries (${state.rows.length} retained)${state.error ? ` · ${state.error}` : ''}`;
    panel.previous.disabled = state.page === 0;
    panel.next.disabled = state.page === lastPage;
    if (focusId != null) {
      const target = [...panel.body.querySelectorAll('[data-row-id]')].find((cell) => cell.dataset.rowId === focusId && cell.dataset.column === focusColumn);
      target?.focus({ preventScroll: true });
    }
    if (resizeColumn) panel.body.querySelector(`[data-resize-column="${resizeColumn}"]`)?.focus({ preventScroll: true });
    panel.body.scrollTop = this.app.autoScroll && state.page === lastPage ? panel.body.scrollHeight : scrollTop;
    panel.body.scrollLeft = scrollLeft;
    this.updateCopy();
  }

  createCell(name, row, column) {
    const state = this.state(name);
    const cell = element('td', 'log-cell');
    const value = cellValue(row, column, state);
    const preview = cellPreview(value);
    const content = element('button', 'log-cell-value', preview.text || '—');
    content.type = 'button';
    content.dataset.rowId = row.id;
    content.dataset.column = column;
    content.setAttribute('aria-label', `Select ${column}: ${preview.text || 'empty'}`);
    const selected = state.selected?.id === row.id && state.selected?.column === column;
    content.setAttribute('aria-pressed', String(selected));
    cell.classList.toggle('is-selected', selected);
    content.addEventListener('click', () => {
      state.selected = { id: row.id, column, value };
      this.copyOwner = name;
      for (const node of this.panels.get(name).body.querySelectorAll('.log-cell')) {
        node.classList.remove('is-selected');
        node.querySelector('.log-cell-value').setAttribute('aria-pressed', 'false');
      }
      cell.classList.add('is-selected');
      content.setAttribute('aria-pressed', 'true');
      this.updateCopy();
    });
    cell.append(content);
    if (preview.truncated) {
      cell.append(element('span', 'log-truncated', '…'), button('Expand', () => this.openDetail(name, column, value)));
    }
    return cell;
  }

  updateCopy() {
    for (const [name, panel] of this.panels) {
      const state = this.state(name);
      const selected = state.selected;
      const available = this.visibleNames().includes(name) && state.mode === 'kibana' && selected;
      panel.copy.disabled = !available;
      panel.copy.title = available ? `Copy full ${selected.column} from ${name}` : 'Select a table cell to copy';
    }
  }

  async copy(value, status) {
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = 'Copied to clipboard.';
    } catch { status.textContent = 'Clipboard unavailable. Select the text and use Ctrl+C.'; }
  }

  openDetail(name, column, value) {
    this.detailName = name;
    document.getElementById('logDetailTitle').textContent = `${name} · ${column}`;
    this.dialogText.textContent = value;
    this.dialogStatus.textContent = '';
    this.dialog.showModal();
  }

  async saveDetail() {
    const text = this.dialogText.textContent;
    const filename = `${this.detailName.replace(/[^a-zA-Z0-9._-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Log file', accept: { 'text/plain': ['.log', '.txt'] } }] });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        this.dialogStatus.textContent = 'File saved.';
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const link = element('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        this.dialogStatus.textContent = 'Download started.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') this.dialogStatus.textContent = `Could not save: ${error.message}`;
    }
  }
}
