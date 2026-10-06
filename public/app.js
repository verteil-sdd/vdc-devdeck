import { ansiToHtml } from './ansi.js';
import { SettingsUI } from './settingsUi.js';

class App {
  constructor() {
    this.repos = new Map();
    this.activeFilter = 'all';
    this.searchQuery = '';
    this.activeTerminalRepo = null;
    this.logTabs = [];
    this.logBuffers = new Map();
    this.isTerminalOpen = false;
    this.isTerminalMaximized = false;
    this.autoScroll = true;
    this.ws = null;

    this.initElements();
    this.initTheme();
    this.initEventListeners();
    this.settingsUI = new SettingsUI(this);
    this.connectWebSocket();
    this.fetchInitialData();
  }

  initElements() {
    this.repoGrid = document.getElementById('repoGrid');
    this.emptyState = document.getElementById('emptyState');
    this.searchInput = document.getElementById('searchInput');
    this.categoryFilters = document.getElementById('categoryFilters');
    this.btnLaunchV1 = document.getElementById('btnLaunchV1');
    this.btnLaunchV3 = document.getElementById('btnLaunchV3');
    this.btnStopAll = document.getElementById('btnStopAll');
    this.btnKillJava = document.getElementById('btnKillJava');
    this.btnRescan = document.getElementById('btnRescan');

    // Metrics
    this.metricCpu = document.getElementById('metricCpu');
    this.metricRam = document.getElementById('metricRam');
    this.metricJvms = document.getElementById('metricJvms');
    this.awsBadge = document.getElementById('awsBadge');
    this.awsStatusText = document.getElementById('awsStatusText');
    this.awsRefreshIcon = document.getElementById('awsRefreshIcon');

    // Stack Progress Banner
    this.stackProgressBanner = document.getElementById('stackProgressBanner');
    this.stackProgressTitle = document.getElementById('stackProgressTitle');
    this.stackProgressStep = document.getElementById('stackProgressStep');
    this.stackProgressMessage = document.getElementById('stackProgressMessage');
    this.dismissStackBanner = document.getElementById('dismissStackBanner');

    // Terminal
    this.terminalDrawer = document.getElementById('terminalDrawer');
    this.termTabsContainer = document.getElementById('termTabsContainer');
    this.termAddAppBtn = document.getElementById('termAddAppBtn');
    this.termAddAppMenu = document.getElementById('termAddAppMenu');
    this.termAddAppRunningList = document.getElementById('termAddAppRunningList');
    this.termAddAppOtherList = document.getElementById('termAddAppOtherList');
    this.termAddAppRunningCount = document.getElementById('termAddAppRunningCount');
    this.terminalScreen = document.getElementById('terminalScreen');
    this.termAutoScroll = document.getElementById('termAutoScroll');
    this.termFilterInput = document.getElementById('termFilterInput');
    this.termClearBtn = document.getElementById('termClearBtn');
    this.termMaximizeBtn = document.getElementById('termMaximizeBtn');
    this.termCloseBtn = document.getElementById('termCloseBtn');

    // Counts
    this.countAll = document.getElementById('countAll');
    this.countRunning = document.getElementById('countRunning');
    this.countV1 = document.getElementById('countV1');
    this.countV3 = document.getElementById('countV3');
    this.countConnectors = document.getElementById('countConnectors');
    this.countUnbuilt = document.getElementById('countUnbuilt');

    // Config Modal
    this.configModal = document.getElementById('configModal');
    this.modalRepoName = document.getElementById('modalRepoName');
    this.modalJdkSelect = document.getElementById('modalJdkSelect');
    this.modalPortInput = document.getElementById('modalPortInput');
    this.modalTargetJarInput = document.getElementById('modalTargetJarInput');
    this.modalDebugPortInput = document.getElementById('modalDebugPortInput');
    this.modalDebugSuspendInput = document.getElementById('modalDebugSuspendInput');
    this.modalDebugPreview = document.getElementById('modalDebugPreview');
    this.modalDebugFields = document.getElementById('modalDebugFields');
    this.modalForm = document.getElementById('modalForm');
    this.modalCloseBtn = document.getElementById('modalCloseBtn');
    this.modalCancelBtn = document.getElementById('modalCancelBtn');

    // Quick Debug Modal
    this.quickDebugModal = document.getElementById('quickDebugModal');
    this.quickDebugRepoName = document.getElementById('quickDebugRepoName');
    this.quickDebugForm = document.getElementById('quickDebugForm');
    this.quickDebugPortInput = document.getElementById('quickDebugPortInput');
    this.quickDebugSuspendInput = document.getElementById('quickDebugSuspendInput');
    this.quickDebugPreview = document.getElementById('quickDebugPreview');
    this.quickDebugCloseBtn = document.getElementById('quickDebugCloseBtn');
    this.quickDebugCancelBtn = document.getElementById('quickDebugCancelBtn');
    this.quickDebugSubmitText = document.getElementById('quickDebugSubmitText');
  }

  initTheme() {
    const button = document.getElementById('btnTheme');
    const applyTheme = (theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = `<i class="fa-solid fa-${theme === 'dark' ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    };
    applyTheme(document.documentElement.dataset.theme || 'dark');
    button.addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      try {
        localStorage.setItem('devdeck-theme', theme);
      } catch { /* The toggle still works when storage is unavailable. */ }
    });
  }

  initEventListeners() {
    // Search
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        this.searchInput.focus();
      }
    });

    // Category filter clicks
    this.categoryFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      document.querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.remove('active', 'bg-indigo-600', 'text-white');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      this.activeFilter = btn.dataset.filter;
      this.render();
    });

    // Stack Launches
    this.btnLaunchV1.addEventListener('click', () => this.launchStack('v1'));
    this.btnLaunchV3.addEventListener('click', () => this.launchStack('v3'));
    this.btnStopAll.addEventListener('click', () => this.stopAll());
    if (this.btnKillJava) {
      this.btnKillJava.addEventListener('click', () => this.killJava());
    }
    this.btnRescan.addEventListener('click', () => this.rescanRepos());
    this.dismissStackBanner.addEventListener('click', () => {
      this.stackProgressBanner.classList.add('hidden');
    });

    // AWS Refresh
    this.awsBadge.addEventListener('click', () => this.refreshAws());

    // Terminal controls
    this.termAutoScroll.addEventListener('change', (e) => {
      this.autoScroll = e.target.checked;
    });

    this.termAddAppBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAddAppDropdown();
    });

    window.addEventListener('click', (e) => {
      if (this.termAddAppMenu && !this.termAddAppMenu.classList.contains('hidden')) {
        if (!this.termAddAppBtn.contains(e.target) && !this.termAddAppMenu.contains(e.target)) {
          this.termAddAppMenu.classList.add('hidden');
        }
      }
    });

    this.termClearBtn.addEventListener('click', () => {
      if (this.activeTerminalRepo) {
        fetch(`/api/repos/${this.activeTerminalRepo}/logs/clear`, { method: 'POST' });
        this.logBuffers.set(this.activeTerminalRepo, []);
        this.terminalScreen.innerHTML = '';
      }
    });

    this.termCloseBtn.addEventListener('click', () => this.closeTerminal());

    this.termMaximizeBtn.addEventListener('click', () => {
      this.isTerminalMaximized = !this.isTerminalMaximized;
      if (this.isTerminalMaximized) {
        this.terminalDrawer.classList.remove('h-72');
        this.terminalDrawer.classList.add('h-[80vh]');
      } else {
        this.terminalDrawer.classList.remove('h-[80vh]');
        this.terminalDrawer.classList.add('h-72');
      }
    });

    this.termFilterInput.addEventListener('input', () => {
      this.renderTerminalLogs();
    });

    // Config Modal
    this.modalCloseBtn.addEventListener('click', () => this.closeModal());
    this.modalCancelBtn.addEventListener('click', () => this.closeModal());
    this.modalForm.addEventListener('submit', (e) => this.handleModalSubmit(e));
    if (this.modalDebugPortInput) {
      this.modalDebugPortInput.addEventListener('input', () => this.updateModalDebugPreview());
    }
    if (this.modalDebugSuspendInput) {
      this.modalDebugSuspendInput.addEventListener('change', () => this.updateModalDebugPreview());
    }

    // Quick Debug Modal
    if (this.quickDebugCloseBtn) {
      this.quickDebugCloseBtn.addEventListener('click', () => this.closeQuickDebugModal());
    }
    if (this.quickDebugCancelBtn) {
      this.quickDebugCancelBtn.addEventListener('click', () => this.closeQuickDebugModal());
    }
    if (this.quickDebugForm) {
      this.quickDebugForm.addEventListener('submit', (e) => this.handleQuickDebugSubmit(e));
    }
    if (this.quickDebugPortInput) {
      this.quickDebugPortInput.addEventListener('input', () => this.updateQuickDebugPreview());
    }
    if (this.quickDebugSuspendInput) {
      this.quickDebugSuspendInput.addEventListener('change', () => this.updateQuickDebugPreview());
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[DevDeck] WebSocket connected.');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleWsMessage(msg);
      } catch (err) {
        console.error('[DevDeck] WS message parse error:', err);
      }
    };

    this.ws.onclose = () => {
      console.warn('[DevDeck] WebSocket disconnected. Reconnecting in 2s...');
      setTimeout(() => this.connectWebSocket(), 2000);
    };
  }

  handleWsMessage(msg) {
    const { type, data } = msg;

    switch (type) {
      case 'init':
        data.repos.forEach((r) => this.repos.set(r.name, r));
        this.updateMetrics(data.metrics);
        this.updateAwsStatus(data.aws);
        if (data.workspaceDir) {
          const wsEl = document.getElementById('headerWorkspaceText');
          if (wsEl) wsEl.textContent = data.workspaceDir;
        }
        if (data.stack) this.updateStackProgress(data.stack);
        this.render();
        break;

      case 'status:changed':
        if (this.repos.has(data.name)) {
          const repo = this.repos.get(data.name);
          repo.status = data.status;
          if (data.port) repo.port = data.port;
          if (data.debugActive !== undefined) repo.debugActive = data.debugActive;
          if (data.debugPort !== undefined) repo.debugPort = data.debugPort;

          this.updateCounts();

          if (this.activeFilter === 'running' || this.activeFilter === 'unbuilt') {
            this.render();
          } else {
            this.updateCardStatus(data.name, data.status);
          }

          if (this.logTabs.includes(data.name)) {
            this.renderLogTabs();
          }

          if (this.termAddAppMenu && !this.termAddAppMenu.classList.contains('hidden')) {
            this.renderAddAppDropdown();
          }
        }
        break;

      case 'repo:discovered':
        this.repos.set(data.name, data);
        this.render();
        break;

      case 'repo:removed':
        this.repos.delete(data.name);
        this.render();
        break;

      case 'repo:updated':
        this.repos.set(data.name, data);
        this.render();
        break;

      case 'log:line':
        if (!this.logBuffers.has(data.name)) {
          this.logBuffers.set(data.name, []);
        }
        const buf = this.logBuffers.get(data.name);
        buf.push(data.text);
        if (buf.length > 5000) buf.shift();

        if (this.activeTerminalRepo === data.name) {
          this.appendLogLine(data.text);
        }
        break;

      case 'log:cleared':
        this.logBuffers.set(data.name, []);
        if (this.activeTerminalRepo === data.name) {
          this.terminalScreen.innerHTML = '';
        }
        break;

      case 'metrics:update':
        this.updateMetrics(data);
        break;

      case 'aws:updated':
        this.updateAwsStatus(data);
        break;

      case 'stacks:updated':
        this.settingsUI.setStacks(data);
        break;

      case 'stack:progress':
        this.updateStackProgress(data);
        break;
    }
  }

  async fetchInitialData() {
    try {
      const [reposRes, metricsRes, awsRes] = await Promise.all([
        fetch('/api/repos').then((r) => r.json()),
        fetch('/api/metrics').then((r) => r.json()),
        fetch('/api/aws').then((r) => r.json())
      ]);

      if (reposRes.success) {
        reposRes.repos.forEach((r) => this.repos.set(r.name, r));
        this.render();
      }
      this.updateMetrics(metricsRes);
      this.updateAwsStatus(awsRes);
    } catch (err) {
      console.error('[DevDeck] Failed to fetch initial data:', err);
    }
  }

  updateMetrics(metrics) {
    if (!metrics) return;
    this.metricCpu.textContent = `${metrics.cpu}%`;
    if (metrics.cpu > 75) {
      this.metricCpu.className = 'font-mono font-medium text-rose-400';
    } else if (metrics.cpu > 50) {
      this.metricCpu.className = 'font-mono font-medium text-amber-400';
    } else {
      this.metricCpu.className = 'font-mono font-medium text-emerald-400';
    }

    const ramUsedGb = (metrics.memUsedMb / 1024).toFixed(1);
    const ramTotalGb = (metrics.memTotalMb / 1024).toFixed(1);
    this.metricRam.textContent = `${ramUsedGb}/${ramTotalGb} GB`;

    this.metricJvms.textContent = metrics.activeJvms || '0';
  }

  updateAwsStatus(aws) {
    if (!aws) return;
    this.awsStatus = aws;
    const profile = aws.profile || 'unconfigured';
    this.awsBadge.disabled = !!aws.isRefreshing;
    if (aws.isRefreshing) {
      this.awsStatusText.textContent = `Refreshing token (${profile})...`;
      this.awsStatusText.className = 'text-amber-400 text-xs';
      this.awsRefreshIcon.classList.add('fa-spin');
    } else if (aws.isValid) {
      this.awsStatusText.textContent = `CodeArtifact: Valid (${profile})`;
      this.awsStatusText.className = 'text-emerald-400 text-xs';
      this.awsRefreshIcon.classList.remove('fa-spin');
      if (this.awsBadge) this.awsBadge.title = `AWS Profile: ${profile} (Valid). Click to refresh token.`;
    } else {
      const label = aws.lastError ? 'AWS setup failed' : aws.hasCodeArtifactToken ? 'AWS refresh needed' : 'AWS not configured';
      this.awsStatusText.textContent = `${label} (${profile})`;
      this.awsStatusText.className = 'text-rose-400 text-xs';
      this.awsRefreshIcon.classList.remove('fa-spin');
      if (this.awsBadge) this.awsBadge.title = aws.lastError || `Click to refresh token for profile '${profile}'`;
    }
  }

  async refreshAws() {
    this.awsBadge.disabled = true;
    this.awsStatusText.textContent = 'Refreshing...';
    this.awsRefreshIcon.classList.add('fa-spin');
    try {
      const res = await fetch('/api/aws/refresh', { method: 'POST' }).then((r) => r.json());
      if (res && res.status) {
        this.updateAwsStatus(res.status);
      }
      if (!res.success) throw new Error(res.message || 'AWS refresh failed');
    } catch (err) {
      alert(`AWS Refresh error: ${err.message}`);
    } finally {
      this.awsRefreshIcon.classList.remove('fa-spin');
      this.awsBadge.disabled = false;
    }
  }

  updateStackProgress(stack) {
    clearTimeout(this.stackBannerTimer);
    if (!stack || stack.status === 'IDLE') {
      this.stackProgressBanner.classList.add('hidden');
      return;
    }

    this.stackProgressBanner.classList.remove('hidden');
    const stackName = stack.stackName || (stack.activeStack === 'v1' ? 'V1 Full Stack' : stack.activeStack === 'v3' ? 'V3 NDC Stack' : 'Custom stack');
    this.stackProgressTitle.textContent = `Orchestrating ${stackName}`;

    if (stack.totalSteps > 0) {
      this.stackProgressStep.textContent = `Step ${stack.currentStep} of ${stack.totalSteps}`;
    } else {
      this.stackProgressStep.textContent = '';
    }

    this.stackProgressMessage.textContent = stack.message || 'Starting applications...';

    if (stack.status === 'RUNNING') {
      this.stackBannerTimer = setTimeout(() => this.stackProgressBanner.classList.add('hidden'), 5000);
    }
  }

  async launchStack(stackType) {
    const isV1 = stackType === 'v1';
    const btn = isV1 ? this.btnLaunchV1 : this.btnLaunchV3;
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-sm"></i> Launching...`;

    try {
      const res = await fetch(`/api/stack/${stackType}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        alert(data.message || 'Failed to start stack');
      }
    } catch (err) {
      alert(`Error launching stack: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  async stopAll() {
    if (!confirm('Are you sure you want to stop all running applications?')) return;
    try {
      await fetch('/api/stack/stop-all', { method: 'POST' });
    } catch (err) {
      alert(`Error stopping services: ${err.message}`);
    }
  }

  async killJava() {
    if (!confirm('⚠️ KILL SWITCH: Are you sure you want to force-terminate ALL Java processes and free all microservice ports?')) {
      return;
    }
    const btn = this.btnKillJava;
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>`;
    }

    try {
      const res = await fetch('/api/system/kill-all-java', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // Update all repos to STOPPED locally immediately
        for (const [name, repo] of this.repos.entries()) {
          repo.status = 'STOPPED';
          repo.debugActive = false;
        }
        if (this.metricJvms) this.metricJvms.textContent = '0';
        this.render();
        alert(`⚡ Kill Switch Executed: Terminated ~${data.killedCount || 0} Java process(es) and cleared ports.`);
      } else {
        alert(`Failed to execute kill switch: ${data.message}`);
      }
    } catch (err) {
      alert(`Kill switch error: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  async rescanRepos() {
    this.btnRescan.disabled = true;
    this.btnRescan.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin" aria-hidden="true"></i>`;
    try {
      const res = await fetch('/api/repos/rescan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        data.repos.forEach((r) => this.repos.set(r.name, r));
        this.render();
      }
    } finally {
      this.btnRescan.disabled = false;
      this.btnRescan.innerHTML = `<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>`;
    }
  }

  // Card Operations
  async startRepo(name) {
    try {
      this.openTerminal(name);
      const res = await fetch(`/api/repos/${name}/start`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        alert(data.message);
      }
    } catch (err) {
      alert(`Failed to start ${name}: ${err.message}`);
    }
  }

  async stopRepo(name) {
    try {
      await fetch(`/api/repos/${name}/stop`, { method: 'POST' });
    } catch (err) {
      alert(`Failed to stop ${name}: ${err.message}`);
    }
  }

  async restartRepo(name) {
    try {
      this.openTerminal(name);
      await fetch(`/api/repos/${name}/restart`, { method: 'POST' });
    } catch (err) {
      alert(`Failed to restart ${name}: ${err.message}`);
    }
  }

  async buildRepo(name) {
    try {
      this.openTerminal(name);
      await fetch(`/api/repos/${name}/build`, { method: 'POST' });
    } catch (err) {
      alert(`Failed to trigger build for ${name}: ${err.message}`);
    }
  }

  async pullRepo(name) {
    try {
      this.openTerminal(name);
      await fetch(`/api/repos/${name}/pull`, { method: 'POST' });
    } catch (err) {
      alert(`Failed to git pull for ${name}: ${err.message}`);
    }
  }

  updateModalDebugPreview() {
    if (!this.modalDebugPreview) return;
    const port = this.modalDebugPortInput ? (this.modalDebugPortInput.value || '5005') : '5005';
    const suspend = this.modalDebugSuspendInput && this.modalDebugSuspendInput.checked ? 'y' : 'n';
    this.modalDebugPreview.textContent = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend},address=*:${port}`;
  }

  updateQuickDebugPreview() {
    if (!this.quickDebugPreview) return;
    const port = this.quickDebugPortInput ? (this.quickDebugPortInput.value || '5005') : '5005';
    const suspend = this.quickDebugSuspendInput && this.quickDebugSuspendInput.checked ? 'y' : 'n';
    this.quickDebugPreview.textContent = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend},address=*:${port}`;
  }

  openQuickDebugModal(name) {
    const repo = this.repos.get(name);
    if (!repo) return;

    this.quickDebugRepoName.textContent = repo.name;
    this.quickDebugForm.dataset.repo = repo.name;
    this.quickDebugPortInput.value = repo.debugPort || 5005;
    this.quickDebugSuspendInput.checked = !!repo.debugSuspend;

    const isRunning = repo.status === 'RUNNING' || repo.status === 'STARTING';
    if (this.quickDebugSubmitText) {
      this.quickDebugSubmitText.textContent = isRunning ? 'Restart in Debug Mode' : 'Start in Debug Mode';
    }

    this.updateQuickDebugPreview();
    this.quickDebugModal.classList.remove('hidden');
    setTimeout(() => {
      this.quickDebugPortInput.focus();
      this.quickDebugPortInput.select();
    }, 50);
  }

  closeQuickDebugModal() {
    if (this.quickDebugModal) {
      this.quickDebugModal.classList.add('hidden');
    }
  }

  async handleQuickDebugSubmit(e) {
    e.preventDefault();
    const name = this.quickDebugForm.dataset.repo;
    const port = parseInt(this.quickDebugPortInput.value, 10) || 5005;
    const suspend = this.quickDebugSuspendInput.checked;

    this.closeQuickDebugModal();
    this.openTerminal(name);

    try {
      const res = await fetch(`/api/repos/${name}/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugPort: port, suspend })
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.message || `Failed to start ${name} in debug mode`);
      }
    } catch (err) {
      alert(`Debug error: ${err.message}`);
    }
  }

  openConfig(name) {
    const repo = this.repos.get(name);
    if (!repo) return;

    this.modalRepoName.textContent = repo.name;
    this.modalForm.dataset.repo = repo.name;
    this.modalJdkSelect.value = repo.jdk || '21.0.1-amzn';
    this.modalPortInput.value = repo.port || '';
    this.modalTargetJarInput.value = repo.targetJar || '';
    if (this.modalDebugPortInput) {
      this.modalDebugPortInput.value = repo.debugPort || 5005;
    }
    if (this.modalDebugSuspendInput) {
      this.modalDebugSuspendInput.checked = !!repo.debugSuspend;
    }
    this.updateModalDebugPreview();

    this.configModal.classList.remove('hidden');
  }

  closeModal() {
    this.configModal.classList.add('hidden');
  }

  async handleModalSubmit(e) {
    e.preventDefault();
    const name = this.modalForm.dataset.repo;
    const body = {
      jdk: this.modalJdkSelect.value,
      port: this.modalPortInput.value ? parseInt(this.modalPortInput.value, 10) : null,
      targetJar: this.modalTargetJarInput.value.trim() || null,
      debugEnabled: false,
      debugPort: this.modalDebugPortInput && this.modalDebugPortInput.value ? parseInt(this.modalDebugPortInput.value, 10) : 5005,
      debugSuspend: this.modalDebugSuspendInput ? this.modalDebugSuspendInput.checked : false
    };

    try {
      const res = await fetch(`/api/repos/${name}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        this.repos.set(name, data.repo);
        this.render();
        this.closeModal();
      }
    } catch (err) {
      alert(`Failed to save config: ${err.message}`);
    }
  }

  // Terminal Drawer Operations
  async openTerminal(repoName) {
    if (!this.logTabs.includes(repoName)) {
      this.logTabs.push(repoName);
    }
    this.isTerminalOpen = true;
    this.terminalDrawer.classList.remove('translate-y-full');
    await this.selectLogTab(repoName);
  }

  closeTerminal() {
    this.isTerminalOpen = false;
    this.terminalDrawer.classList.add('translate-y-full');
    if (this.termAddAppMenu) {
      this.termAddAppMenu.classList.add('hidden');
    }
  }

  async selectLogTab(repoName) {
    this.activeTerminalRepo = repoName;
    this.renderLogTabs();

    // Check if we need to fetch initial log buffer from server
    if (!this.logBuffers.has(repoName) || this.logBuffers.get(repoName).length === 0) {
      this.terminalScreen.innerHTML = '<div class="text-slate-500 italic">[DevDeck] Loading logs...</div>';
      try {
        const res = await fetch(`/api/repos/${repoName}/logs`).then((r) => r.json());
        if (res.success && res.lines) {
          this.logBuffers.set(repoName, res.lines);
        }
      } catch (err) {
        console.error(`[DevDeck] Error fetching logs for ${repoName}:`, err);
      }
    }

    this.renderTerminalLogs();
  }

  closeLogTab(repoName, e) {
    if (e) e.stopPropagation();
    const idx = this.logTabs.indexOf(repoName);
    if (idx !== -1) {
      this.logTabs.splice(idx, 1);
    }

    if (this.activeTerminalRepo === repoName) {
      if (this.logTabs.length > 0) {
        const nextRepo = this.logTabs[Math.max(0, idx - 1)];
        this.selectLogTab(nextRepo);
      } else {
        this.activeTerminalRepo = null;
        this.closeTerminal();
        this.renderLogTabs();
      }
    } else {
      this.renderLogTabs();
    }
  }

  toggleAddAppDropdown() {
    const isHidden = this.termAddAppMenu.classList.contains('hidden');
    if (isHidden) {
      this.renderAddAppDropdown();
      this.termAddAppMenu.classList.remove('hidden');
    } else {
      this.termAddAppMenu.classList.add('hidden');
    }
  }

  renderAddAppDropdown() {
    const all = Array.from(this.repos.values());
    const running = all.filter((r) => r.status === 'RUNNING' || r.status === 'STARTING' || r.status === 'BUILDING');
    const others = all.filter((r) => r.status !== 'RUNNING' && r.status !== 'STARTING' && r.status !== 'BUILDING');

    this.termAddAppRunningCount.textContent = running.length;

    if (running.length === 0) {
      this.termAddAppRunningList.innerHTML = `<div class="px-3 py-1.5 text-slate-500 italic text-[11px]">No active applications</div>`;
    } else {
      this.termAddAppRunningList.innerHTML = running.map((r) => {
        const isOpen = this.logTabs.includes(r.name);
        return `
          <button 
            type="button"
            class="w-full text-left px-3 py-1.5 hover:bg-slate-800 flex items-center justify-between text-slate-200 transition-colors dropdown-repo-btn"
            data-repo="${r.name}"
          >
            <span class="flex items-center gap-1.5 truncate">
              ${this.getStatusBadgeContent(r.status)}
              <span class="font-medium truncate max-w-[140px]">${r.name}</span>
            </span>
            <span class="flex items-center gap-1">
              ${isOpen ? '<span class="text-[9px] text-cyan-400 bg-cyan-950 px-1 rounded border border-cyan-800">open</span>' : ''}
              <span class="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                ${r.port ? ':' + r.port : ''}
              </span>
            </span>
          </button>
        `;
      }).join('');
    }

    this.termAddAppOtherList.innerHTML = others.map((r) => {
      const isOpen = this.logTabs.includes(r.name);
      return `
        <button 
          type="button"
          class="w-full text-left px-3 py-1.5 hover:bg-slate-800 flex items-center justify-between text-slate-400 hover:text-slate-200 transition-colors dropdown-repo-btn"
          data-repo="${r.name}"
        >
          <span class="truncate max-w-[150px]">${r.name}</span>
          <span class="flex items-center gap-1">
            ${isOpen ? '<span class="text-[9px] text-cyan-400 bg-cyan-950 px-1 rounded border border-cyan-800">open</span>' : ''}
            ${this.getStatusBadgeContent(r.status)}
          </span>
        </button>
      `;
    }).join('');

    this.termAddAppMenu.querySelectorAll('.dropdown-repo-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const repoName = btn.dataset.repo;
        this.addLogTab(repoName);
      });
    });
  }

  addLogTab(repoName) {
    if (!this.logTabs.includes(repoName)) {
      this.logTabs.push(repoName);
    }
    this.isTerminalOpen = true;
    this.terminalDrawer.classList.remove('translate-y-full');
    this.termAddAppMenu.classList.add('hidden');
    this.selectLogTab(repoName);
  }

  renderLogTabs() {
    if (this.logTabs.length === 0) {
      this.termTabsContainer.innerHTML = `<span class="text-xs text-slate-500 italic font-mono px-2 py-1">No log streams open</span>`;
      return;
    }

    this.termTabsContainer.innerHTML = this.logTabs.map((name) => {
      const repo = this.repos.get(name);
      const status = repo ? repo.status : 'STOPPED';
      const isActive = this.activeTerminalRepo === name;

      const isDebugActive = repo && repo.debugActive;
      const debugPort = (repo && repo.debugPort) || 5005;

      return `
        <div 
          class="term-tab flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer transition-all border ${
            isActive 
              ? 'bg-slate-800 text-cyan-300 border-cyan-500/50 shadow-sm shadow-cyan-900/30' 
              : 'bg-slate-950/80 text-slate-400 border-slate-800/80 hover:bg-slate-900 hover:text-slate-200'
          }" 
          data-tab-repo="${name}"
        >
          ${this.getStatusBadgeContent(status)}
          <span class="font-medium max-w-[130px] truncate" title="${name}">${name}</span>
          ${isDebugActive ? `<span class="text-[9px] px-1.5 py-0.5 rounded font-mono bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-600/50 flex items-center gap-1"><i class="fa-solid fa-bug text-[8px]"></i>:${debugPort}</span>` : ''}
          <button 
            type="button"
            class="tab-close-btn ml-1 text-slate-500 hover:text-rose-400 p-0.5 rounded transition-colors" 
            data-close-repo="${name}" 
            title="Close Tab"
          >
            <i class="fa-solid fa-xmark text-[10px]"></i>
          </button>
        </div>
      `;
    }).join('');

    this.termTabsContainer.querySelectorAll('.term-tab').forEach((tab) => {
      const repoName = tab.dataset.tabRepo;
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close-btn')) return;
        this.selectLogTab(repoName);
      });
      const closeBtn = tab.querySelector('.tab-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => this.closeLogTab(repoName, e));
      }
    });
  }

  appendLogLine(text) {
    if (!this.isTerminalOpen) return;

    const filter = this.termFilterInput.value.toLowerCase().trim();
    if (filter && !text.toLowerCase().includes(filter)) {
      return;
    }

    const div = document.createElement('div');
    div.innerHTML = ansiToHtml(text);
    this.terminalScreen.appendChild(div);

    if (this.autoScroll) {
      this.terminalScreen.scrollTop = this.terminalScreen.scrollHeight;
    }
  }

  renderTerminalLogs() {
    const lines = this.activeTerminalRepo ? (this.logBuffers.get(this.activeTerminalRepo) || []) : [];
    const filter = this.termFilterInput.value.toLowerCase().trim();
    this.terminalScreen.innerHTML = '';

    if (!this.activeTerminalRepo) {
      this.terminalScreen.innerHTML = '<div class="text-slate-500 italic">[DevDeck] Click "+ Add App" or the terminal icon on any application card to stream stdout/stderr...</div>';
      return;
    }

    if (lines.length === 0) {
      this.terminalScreen.innerHTML = `<div class="text-slate-500 italic">[DevDeck] No logs recorded for ${this.activeTerminalRepo} yet.</div>`;
      return;
    }

    const linesToRender = filter
      ? lines.filter((l) => l.toLowerCase().includes(filter))
      : lines;

    const frag = document.createDocumentFragment();
    for (const line of linesToRender) {
      const div = document.createElement('div');
      div.innerHTML = ansiToHtml(line);
      frag.appendChild(div);
    }
    this.terminalScreen.appendChild(frag);

    if (this.autoScroll) {
      this.terminalScreen.scrollTop = this.terminalScreen.scrollHeight;
    }
  }

  attachCardListeners(card, repoName) {
    card.querySelector('.btn-start').addEventListener('click', () => this.startRepo(repoName));
    const debugBtn = card.querySelector('.btn-debug');
    if (debugBtn) {
      debugBtn.addEventListener('click', () => this.openQuickDebugModal(repoName));
    }
    card.querySelector('.btn-stop').addEventListener('click', () => this.stopRepo(repoName));
    card.querySelector('.btn-restart').addEventListener('click', () => this.restartRepo(repoName));
    card.querySelector('.btn-build').addEventListener('click', () => this.buildRepo(repoName));
    card.querySelector('.btn-pull').addEventListener('click', () => this.pullRepo(repoName));
    card.querySelector('.btn-logs').addEventListener('click', () => this.openTerminal(repoName));
    card.querySelector('.btn-config').addEventListener('click', () => this.openConfig(repoName));
  }

  updateCardStatus(name, status) {
    const card = document.querySelector(`[data-card-repo="${name}"]`);
    if (!card) return;
    const repo = this.repos.get(name);
    if (!repo) return;

    const badge = card.querySelector('.status-badge');
    if (badge) badge.innerHTML = this.getStatusBadgeContent(status);

    const debugBadge = card.querySelector('.header-debug-badge');
    if (debugBadge) {
      debugBadge.classList.toggle('hidden', !repo.debugActive);
      debugBadge.title = `Remote debugger on port ${repo.debugPort || 5005}`;
      debugBadge.innerHTML = `<i class="fa-solid fa-bug" aria-hidden="true"></i> :${repo.debugPort || 5005}`;
    }

    const running = status === 'RUNNING';
    const starting = status === 'STARTING';
    const busy = status === 'BUILDING' || status === 'PULLING';
    const setButton = (selector, hidden, disabled = false) => {
      const button = card.querySelector(selector);
      button.classList.toggle('hidden', hidden);
      button.disabled = disabled;
    };
    setButton('.btn-start', running || starting, busy);
    setButton('.btn-stop', !(running || starting || busy));
    setButton('.btn-restart', !running);
    setButton('.btn-build', false, running || starting || busy);
    setButton('.btn-pull', false, running || starting || busy);
    setButton('.btn-debug', busy, starting);
    card.querySelector('.btn-debug').classList.toggle('debug-active', !!repo.debugActive);
  }

  getStatusBadgeContent(status) {
    const states = {
      RUNNING: ['running', 'Running'],
      STOPPED: ['stopped', 'Stopped'],
      STARTING: ['starting', 'Starting'],
      BUILDING: ['building', 'Building'],
      PULLING: ['pulling', 'Pulling'],
      ERROR: ['error', 'Error']
    };
    const [state, label] = states[status] || states.STOPPED;
    return `<span class="status-dot status-dot-${state}" role="img" aria-label="${label}" title="${label}"></span>`;
  }

  updateCounts() {
    const list = Array.from(this.repos.values());
    this.countAll.textContent = list.length;
    this.countRunning.textContent = list.filter((r) => r.status === 'RUNNING' || r.status === 'STARTING').length;
    this.countV1.textContent = list.filter((r) => r.category === 'v1-core').length;
    this.countV3.textContent = list.filter((r) => r.category === 'v3-core').length;
    this.countConnectors.textContent = list.filter((r) => r.category === 'connector').length;
    this.countUnbuilt.textContent = list.filter((r) => !r.isBuilt).length;
  }

  render() {
    this.updateCounts();
    const all = Array.from(this.repos.values());

    const filtered = all.filter((repo) => {
      // Category filter
      if (this.activeFilter === 'running' && repo.status !== 'RUNNING' && repo.status !== 'STARTING') return false;
      if (this.activeFilter === 'v1-core' && repo.category !== 'v1-core') return false;
      if (this.activeFilter === 'v3-core' && repo.category !== 'v3-core') return false;
      if (this.activeFilter === 'connector' && repo.category !== 'connector') return false;
      if (this.activeFilter === 'unbuilt' && repo.isBuilt) return false;

      // Search query
      if (this.searchQuery) {
        const matchesName = repo.name.toLowerCase().includes(this.searchQuery);
        const matchesBranch = repo.git && repo.git.branch && repo.git.branch.toLowerCase().includes(this.searchQuery);
        const matchesCategory = repo.category && repo.category.toLowerCase().includes(this.searchQuery);
        if (!matchesName && !matchesBranch && !matchesCategory) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      this.repoGrid.innerHTML = '';
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');

    // Only animate newly visible cards, not routine live data updates.
    const visible = new Set(Array.from(this.repoGrid.children, (card) => card.dataset.cardRepo));
    this.repoGrid.innerHTML = filtered.map((repo, index) =>
      this.renderCardHtml(repo, !visible.has(repo.name), index)
    ).join('');

    // Attach event listeners to card buttons
    filtered.forEach((repo) => {
      const card = document.querySelector(`[data-card-repo="${repo.name}"]`);
      if (card) {
        this.attachCardListeners(card, repo.name);
        this.updateCardStatus(repo.name, repo.status);
      }
    });
  }

  renderCardHtml(repo, animate = false, index = 0) {
    const isDebugActive = !!repo.debugActive;
    const debugPort = repo.debugPort || 5005;

    const branch = repo.git && repo.git.branch ? repo.git.branch : 'main';
    const isDirty = repo.git && repo.git.isDirty;
    const ahead = repo.git ? repo.git.ahead : 0;
    const behind = repo.git ? repo.git.behind : 0;

    // Category badge color
    let catClass = 'bg-slate-800 text-slate-400 border-slate-700';
    let catLabel = 'Repo';
    if (repo.category === 'v1-core') {
      catClass = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      catLabel = 'V1 Core';
    } else if (repo.category === 'v3-core') {
      catClass = 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20';
      catLabel = 'V3 Core';
    } else if (repo.category === 'connector') {
      catClass = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      catLabel = 'Connector';
    } else if (repo.category === 'schema') {
      catClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      catLabel = 'Schema';
    }

    return `
      <div class="glass-card flex flex-col justify-between ${animate ? 'card-enter' : ''}" style="--entry-delay: ${Math.min(index, 7) * 35}ms" data-card-repo="${repo.name}">
        
        <!-- Header -->
        <div>
          <div class="card-heading">
            <div>
              <h4 class="card-title truncate" title="${repo.name}">
                ${repo.name}
              </h4>
              <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                <span class="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${catClass}">
                  ${catLabel}
                </span>
                ${repo.port ? `<span class="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40">:${repo.port}</span>` : ''}
                <span class="header-debug-badge text-[10px] font-mono text-fuchsia-300 flex items-center gap-1 ${isDebugActive ? '' : 'hidden'}" title="Remote Debugger (Port: ${debugPort})">
                  <i class="fa-solid fa-bug text-[10px] text-fuchsia-400"></i> :${debugPort}
                </span>
              </div>
            </div>

            <!-- Status Badge -->
            <span class="status-badge">
              ${this.getStatusBadgeContent(repo.status)}
            </span>
          </div>

          <!-- Metadata Rows -->
          <div class="card-metadata text-[11px] text-slate-400">
            <!-- Git Row -->
            <div class="flex items-center justify-between">
              <span class="flex items-center gap-1 text-slate-400 truncate max-w-[170px]" title="Branch: ${branch}">
                <i class="fa-solid fa-code-branch text-slate-500 text-[10px]"></i>
                <span class="font-mono text-slate-300">${branch}</span>
                ${isDirty ? '<span class="text-[9px] bg-amber-500/20 text-amber-400 px-1 rounded ml-1">modified</span>' : ''}
              </span>
              <div class="flex items-center gap-1 font-mono text-[10px]">
                ${ahead > 0 ? `<span class="text-emerald-400">↑${ahead}</span>` : ''}
                ${behind > 0 ? `<span class="text-rose-400">↓${behind}</span>` : ''}
                ${!ahead && !behind ? `<span class="text-slate-500">synced</span>` : ''}
              </div>
            </div>

            <!-- JDK & Engine -->
            <div class="flex items-center justify-between text-slate-400">
              <span class="flex items-center gap-1">
                <i class="fa-brands fa-java text-amber-500/80 text-[10px]"></i>
                <span>${repo.jdk || 'system'}</span>
              </span>
              <span class="text-[10px] font-mono ${repo.isBuilt ? 'text-slate-400' : 'text-amber-400 font-semibold'}">
                ${repo.isBuilt ? '<i class="fa-solid fa-check text-emerald-400 mr-0.5"></i> Built' : '<i class="fa-solid fa-triangle-exclamation mr-0.5"></i> Needs Build'}
              </span>
            </div>

            <!-- Anti-lag tuning pill -->
            <div class="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
              <span>Anti-Lag: <span class="text-indigo-400">384M / C1 JIT</span></span>
              <span>${repo.projectType.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <div class="card-actions">
          <div>
            <button class="btn-start icon-button" title="Start application" aria-label="Start application"><i class="fa-solid fa-play" aria-hidden="true"></i></button>
            <button class="btn-stop icon-button" title="Stop process" aria-label="Stop process"><i class="fa-solid fa-stop" aria-hidden="true"></i></button>
            <button class="btn-restart icon-button" title="Restart process" aria-label="Restart process"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button>
            <button class="btn-debug icon-button" title="Launch with remote debugger" aria-label="Launch with remote debugger"><i class="fa-solid fa-bug" aria-hidden="true"></i></button>
            <button class="btn-build icon-button" title="Build application" aria-label="Build application"><i class="fa-solid fa-hammer" aria-hidden="true"></i></button>
            <button class="btn-pull icon-button" title="Git pull latest" aria-label="Git pull latest"><i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i></button>
          </div>
          <div>
            <button class="btn-logs icon-button" title="View logs" aria-label="View logs"><i class="fa-solid fa-terminal" aria-hidden="true"></i></button>
            <button class="btn-config icon-button" title="Configure application" aria-label="Configure application"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button>
          </div>
        </div>

      </div>
    `;
  }
}

// Instantiate application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.devDeck = new App();
});
