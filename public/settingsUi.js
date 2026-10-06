export class SettingsUI {
  constructor(app) {
    this.app = app;
    this.stacks = [];
    this.services = [];
    this.editingId = null;
    this.awsDialog = document.getElementById('awsSettingsDialog');
    this.stacksDialog = document.getElementById('customStacksDialog');
    for (const dialog of [this.awsDialog, this.stacksDialog]) {
      dialog.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
    }
    document.getElementById('btnAwsSettings').addEventListener('click', () => {
      document.getElementById('awsProfileInput').value = app.awsStatus?.profile || '';
      document.getElementById('awsRegionInput').value = app.awsStatus?.region || 'ap-south-1';
      document.getElementById('awsSettingsError').textContent = app.awsStatus?.lastError || '';
      this.awsDialog.showModal();
    });
    document.getElementById('awsSettingsForm').addEventListener('submit', (event) => this.saveAws(event));
    document.getElementById('btnCustomStacks').addEventListener('click', () => this.openStacks());
    document.getElementById('customStackForm').addEventListener('submit', (event) => this.saveStack(event));
    document.getElementById('stackNew').addEventListener('click', () => this.editStack());
    document.getElementById('stackAddService').addEventListener('click', () => {
      const name = document.getElementById('stackServiceSelect').value;
      if (name && !this.services.includes(name)) this.services.push(name);
      this.renderServices();
    });
  }

  async request(url, method = 'GET', body) {
    const response = await fetch(url, { method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (data.status) this.app.updateAwsStatus(data.status);
    if (!response.ok || !data.success) throw new Error(data.message || 'Request failed.');
    return data;
  }

  async saveAws(event) {
    event.preventDefault();
    const button = document.getElementById('awsSettingsSave');
    const error = document.getElementById('awsSettingsError');
    button.disabled = true;
    button.textContent = 'Refreshing…';
    error.textContent = '';
    try {
      await this.request('/api/aws/profile', 'POST', {
        profile: document.getElementById('awsProfileInput').value.trim(),
        region: document.getElementById('awsRegionInput').value.trim()
      });
      this.awsDialog.close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Save and refresh';
    }
  }

  async openStacks() {
    this.editStack();
    this.stacksDialog.showModal();
    try {
      const data = await this.request('/api/stacks');
      this.setStacks(data.stacks);
    } catch (err) {
      document.getElementById('customStackError').textContent = err.message;
    }
  }

  setStacks(stacks) {
    this.stacks = stacks;
    const list = document.getElementById('customStacksList');
    list.replaceChildren();
    if (!stacks.length) {
      const empty = document.createElement('p');
      empty.className = 'settings-hint';
      empty.textContent = 'No custom stacks yet. Create one below.';
      list.append(empty);
    }
    for (const stack of stacks) {
      const row = document.createElement('div');
      row.className = 'custom-stack-row';
      const name = document.createElement('span');
      name.textContent = `${stack.name} (${stack.services.length})`;
      name.title = stack.services.join(' → ');
      row.append(name,
        this.button('Start', async () => {
          await this.request(`/api/stacks/${encodeURIComponent(stack.id)}/start`, 'POST');
          this.stacksDialog.close();
        }),
        this.button('Edit', () => this.editStack(stack)),
        this.button('Delete', async () => {
          await this.request(`/api/stacks/${encodeURIComponent(stack.id)}`, 'DELETE');
          this.setStacks(this.stacks.filter((item) => item.id !== stack.id));
          if (this.editingId === stack.id) this.editStack();
        }));
      list.append(row);
    }
  }

  button(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stack-button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      document.getElementById('customStackError').textContent = '';
      try { await action(); }
      catch (err) { document.getElementById('customStackError').textContent = err.message; }
      finally { button.disabled = false; }
    });
    return button;
  }

  editStack(stack) {
    this.editingId = stack?.id || null;
    this.services = [...(stack?.services || [])];
    document.getElementById('customStackName').value = stack?.name || '';
    document.getElementById('stackEditorTitle').textContent = stack ? 'Edit stack' : 'Add a stack';
    document.getElementById('customStackError').textContent = '';
    this.renderServices();
  }

  renderServices() {
    const select = document.getElementById('stackServiceSelect');
    select.replaceChildren();
    for (const name of [...this.app.repos.keys()].sort()) {
      if (this.services.includes(name)) continue;
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    document.getElementById('stackAddService').disabled = !select.options.length;
    const list = document.getElementById('stackServiceOrder');
    list.replaceChildren();
    this.services.forEach((name, index) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${name}${this.app.repos.has(name) ? '' : ' (missing)'} `;
      const move = (offset) => {
        [this.services[index], this.services[index + offset]] = [this.services[index + offset], this.services[index]];
        this.renderServices();
      };
      const up = this.button('↑', () => move(-1));
      up.setAttribute('aria-label', `Move ${name} up`);
      up.disabled = index === 0;
      const down = this.button('↓', () => move(1));
      down.setAttribute('aria-label', `Move ${name} down`);
      down.disabled = index === this.services.length - 1;
      const remove = this.button('Remove', () => { this.services.splice(index, 1); this.renderServices(); });
      remove.setAttribute('aria-label', `Remove ${name}`);
      row.append(label, up, down, remove);
      list.append(row);
    });
  }

  async saveStack(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const data = await this.request('/api/stacks', 'POST', {
        id: this.editingId,
        name: document.getElementById('customStackName').value.trim(),
        services: this.services
      });
      const stacks = this.stacks.filter((stack) => stack.id !== data.stack.id);
      this.setStacks([...stacks, data.stack]);
      this.editStack();
    } catch (err) {
      document.getElementById('customStackError').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }
}
