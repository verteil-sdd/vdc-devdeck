import { ansiToHtml } from './ansi.js';

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
    this.initEventListeners();
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
    this.modalDebugToggle = document.getElementById('modalDebugToggle');
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
    this.quickDebugSaveDefault = document.getElementById('quickDebugSaveDefault');
  }

  initEventListeners() {
    // Search
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== this.searchInput) {
        e.preventDefault();
        this.searchInput.focus();
      }
    });

    // Category filter clicks
    this.categoryFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active', 'bg-indigo-600', 'text-white'));
      btn.classList.add('active', 'bg-indigo-600', 'text-white');
      this.activeFilter = btn.dataset.filter;
      this.render();
    });

    // Stack Launches
    this.btnLaunchV1.addEventListener('click', () => this.launchStack('v1'));
    this.btnLaunchV3.addEventListener('click', () => this.launchStack('v3'));
    this.btnStopAll.addEventListener('click', () => this.stopAll());
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
    if (this.modalDebugToggle) {
      this.modalDebugToggle.addEventListener('change', () => this.updateModalDebugPreview());
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
    if (aws.isValid) {
      this.awsStatusText.textContent = 'CodeArtifact: Valid';
      this.awsStatusText.className = 'text-emerald-400 text-xs';
      this.awsRefreshIcon.classList.remove('fa-spin');
    } else if (aws.isRefreshing) {
      this.awsStatusText.textContent = 'Refreshing token...';
      this.awsStatusText.className = 'text-amber-400 text-xs';
      this.awsRefreshIcon.classList.add('fa-spin');
    } else {
      this.awsStatusText.textContent = 'Token Expired (Click to fix)';
      this.awsStatusText.className = 'text-rose-400 text-xs';
      this.awsRefreshIcon.classList.remove('fa-spin');
    }
  }

  async refreshAws() {
    this.awsStatusText.textContent = 'Refreshing...';
    this.awsRefreshIcon.classList.add('fa-spin');
    try {
      const res = await fetch('/api/aws/refresh', { method: 'POST' }).then((r) => r.json());
      if (res && res.status) {
        this.updateAwsStatus(res.status);
      }
    } catch (err) {
      alert(`AWS Refresh error: ${err.message}`);
    } finally {
      this.awsRefreshIcon.classList.remove('fa-spin');
    }
  }

  updateStackProgress(stack) {
    if (!stack || stack.status === 'IDLE') {
      this.stackProgressBanner.classList.add('hidden');
      return;
    }

    this.stackProgressBanner.classList.remove('hidden');
    const stackName = stack.activeStack === 'v1' ? 'V1 Full Stack' : 'V3 NDC Stack';
    this.stackProgressTitle.textContent = `Orchestrating ${stackName}`;

    if (stack.totalSteps > 0) {
      this.stackProgressStep.textContent = `Step ${stack.currentStep} of ${stack.totalSteps}`;
    } else {
      this.stackProgressStep.textContent = '';
    }

    this.stackProgressMessage.textContent = stack.message || 'Starting applications...';

    if (stack.status === 'RUNNING') {
      setTimeout(() => this.stackProgressBanner.classList.add('hidden'), 5000);
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

  async rescanRepos() {
    this.btnRescan.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin text-xs"></i> Scanning...`;
    try {
      const res = await fetch('/api/repos/rescan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        data.repos.forEach((r) => this.repos.set(r.name, r));
        this.render();
      }
    } finally {
      this.btnRescan.innerHTML = `<i class="fa-solid fa-arrows-rotate text-xs"></i> <span>Rescan</span>`;
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
    if (this.modalDebugFields && this.modalDebugToggle) {
      if (this.modalDebugToggle.checked) {
        this.modalDebugFields.classList.remove('opacity-40', 'pointer-events-none');
      } else {
        this.modalDebugFields.classList.add('opacity-40', 'pointer-events-none');
      }
    }
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
    if (this.quickDebugSaveDefault) this.quickDebugSaveDefault.checked = true;

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
    const saveDefault = this.quickDebugSaveDefault ? this.quickDebugSaveDefault.checked : true;

    this.closeQuickDebugModal();
    this.openTerminal(name);

    try {
      if (saveDefault) {
        // Save as default in repo configuration
        await fetch(`/api/repos/${name}/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            debugEnabled: true,
            debugPort: port,
            debugSuspend: suspend
          })
        });
      }

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
    if (this.modalDebugToggle) {
      this.modalDebugToggle.checked = !!repo.debugEnabled;
    }
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
      debugEnabled: this.modalDebugToggle ? this.modalDebugToggle.checked : false,
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
              <span class="w-1.5 h-1.5 rounded-full ${r.status === 'RUNNING' ? 'bg-emerald-400 pulse-green' : 'bg-blue-400'}"></span>
              <span class="font-medium truncate max-w-[140px]">${r.name}</span>
            </span>
            <span class="flex items-center gap-1">
              ${isOpen ? '<span class="text-[9px] text-cyan-400 bg-cyan-950 px-1 rounded border border-cyan-800">open</span>' : ''}
              <span class="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                ${r.port ? ':' + r.port : r.status}
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
            <span class="text-[10px] text-slate-600">${r.status}</span>
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

      let dotClass = 'bg-slate-500';
      let badgeClass = 'bg-slate-800 text-slate-400 border border-slate-700';
      if (status === 'RUNNING') {
        dotClass = 'bg-emerald-400 pulse-green';
        badgeClass = 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40';
      } else if (status === 'STARTING') {
        dotClass = 'bg-blue-400';
        badgeClass = 'bg-blue-950/60 text-blue-400 border border-blue-800/40';
      } else if (status === 'BUILDING') {
        dotClass = 'bg-amber-400';
        badgeClass = 'bg-amber-950/60 text-amber-400 border border-amber-800/40';
      } else if (status === 'ERROR') {
        dotClass = 'bg-rose-400';
        badgeClass = 'bg-rose-950/60 text-rose-400 border border-rose-800/40';
      }

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
          <span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span>
          <span class="font-medium max-w-[130px] truncate" title="${name}">${name}</span>
          <span class="text-[9px] px-1.5 py-0.5 rounded font-mono ${badgeClass}">${status}</span>
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
      this.terminalScreen.innerHTML = '<div class="text-slate-500 italic">[DevDeck] Click "+ Add App" or "Logs" on any application card to stream stdout/stderr...</div>';
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

    // 1. Update status badge in-place (keeps fixed dimensions, no jumping)
    const badge = card.querySelector('.status-badge');
    if (badge) {
      badge.className = `status-badge ${this.getStatusBadgeClass(status)}`;
      badge.innerHTML = this.getStatusBadgeContent(status);
    }

    // 2. Update debug indicator in header
    const debugBadgeEl = card.querySelector('.header-debug-badge');
    const isDebugActive = !!repo.debugActive;
    const isDebugEnabled = !!repo.debugEnabled;
    const debugPort = repo.debugPort || 5005;
    if (debugBadgeEl) {
      if (isDebugActive) {
        debugBadgeEl.className = 'header-debug-badge text-[10px] font-mono font-bold text-fuchsia-300 bg-fuchsia-950/80 px-2 py-0.5 rounded-full border border-fuchsia-500/60 shadow-sm shadow-fuchsia-900/40 flex items-center gap-1 pulse-purple';
        debugBadgeEl.innerHTML = `<i class="fa-solid fa-bug text-[10px] text-fuchsia-400"></i> :${debugPort}`;
      } else if (isDebugEnabled) {
        debugBadgeEl.className = 'header-debug-badge text-[10px] font-mono text-fuchsia-400/90 bg-fuchsia-950/40 px-1.5 py-0.5 rounded border border-fuchsia-800/40 flex items-center gap-1';
        debugBadgeEl.innerHTML = `<i class="fa-solid fa-bug text-[9px]"></i> :${debugPort}`;
      } else {
        debugBadgeEl.className = 'header-debug-badge hidden';
      }
    }

    // 3. Update buttons in-place
    const startBtn = card.querySelector('.btn-start');
    const stopBtn = card.querySelector('.btn-stop');
    const restartBtn = card.querySelector('.btn-restart');
    const buildBtn = card.querySelector('.btn-build');
    const pullBtn = card.querySelector('.btn-pull');
    const debugBtn = card.querySelector('.btn-debug');

    if (status === 'RUNNING') {
      if (startBtn) startBtn.classList.add('hidden');
      if (stopBtn) stopBtn.classList.remove('hidden');
      if (restartBtn) restartBtn.classList.remove('hidden');
      if (buildBtn) buildBtn.disabled = true;
      if (pullBtn) pullBtn.disabled = true;
      if (debugBtn) {
        debugBtn.disabled = false;
        debugBtn.classList.remove('hidden');
        if (isDebugActive) {
          debugBtn.className = 'btn-debug btn-fluid px-2 py-1.5 rounded-lg bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-500/60 shadow-sm shadow-fuchsia-900/30 font-medium text-xs';
        } else {
          debugBtn.className = 'btn-debug btn-fluid px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-fuchsia-950/60 text-fuchsia-400 hover:text-fuchsia-200 border border-slate-700/80 hover:border-fuchsia-500/40 font-medium text-xs';
        }
      }
    } else if (status === 'STARTING') {
      if (startBtn) startBtn.classList.add('hidden');
      if (stopBtn) stopBtn.classList.remove('hidden');
      if (restartBtn) restartBtn.classList.add('hidden');
      if (buildBtn) buildBtn.disabled = true;
      if (pullBtn) pullBtn.disabled = true;
      if (debugBtn) debugBtn.disabled = true;
    } else if (status === 'BUILDING' || status === 'PULLING') {
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.classList.remove('hidden');
      if (restartBtn) restartBtn.classList.add('hidden');
      if (buildBtn) buildBtn.disabled = true;
      if (pullBtn) pullBtn.disabled = true;
      if (debugBtn) debugBtn.classList.add('hidden');
    } else {
      // STOPPED or ERROR
      if (startBtn) {
        startBtn.classList.remove('hidden');
        startBtn.disabled = false;
      }
      if (stopBtn) stopBtn.classList.add('hidden');
      if (restartBtn) restartBtn.classList.add('hidden');
      if (buildBtn) buildBtn.disabled = false;
      if (pullBtn) pullBtn.disabled = false;
      if (debugBtn) {
        debugBtn.disabled = false;
        debugBtn.classList.remove('hidden');
        debugBtn.className = 'btn-debug btn-fluid px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-fuchsia-950/60 text-fuchsia-400 hover:text-fuchsia-200 border border-slate-700/80 hover:border-fuchsia-500/40 font-medium text-xs';
      }
    }
  }

  getStatusBadgeClass(status) {
    switch (status) {
      case 'RUNNING':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'STARTING':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'BUILDING':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'PULLING':
        return 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30';
      case 'ERROR':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  }

  getStatusBadgeContent(status) {
    switch (status) {
      case 'RUNNING':
        return `<span class="status-dot status-dot-running"></span>RUNNING`;
      case 'STARTING':
        return `<span class="status-dot status-dot-starting"></span>STARTING`;
      case 'BUILDING':
        return `<span class="status-dot status-dot-building"></span>BUILDING`;
      case 'PULLING':
        return `<span class="status-dot status-dot-pulling"></span>PULLING`;
      case 'ERROR':
        return `<span class="status-dot status-dot-error"></span>ERROR`;
      default:
        return `<span class="status-dot status-dot-stopped"></span>STOPPED`;
    }
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

    this.repoGrid.innerHTML = filtered.map((repo) => this.renderCardHtml(repo)).join('');

    // Attach event listeners to card buttons
    filtered.forEach((repo) => {
      const card = document.querySelector(`[data-card-repo="${repo.name}"]`);
      if (card) {
        this.attachCardListeners(card, repo.name);
      }
    });
  }

  renderCardHtml(repo) {
    const isRunning = repo.status === 'RUNNING';
    const isBuilding = repo.status === 'BUILDING';
    const isPulling = repo.status === 'PULLING';
    const isDebugActive = !!repo.debugActive;
    const isDebugEnabled = !!repo.debugEnabled;
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
      <div class="glass-card rounded-2xl p-4 flex flex-col justify-between" data-card-repo="${repo.name}">
        
        <!-- Header -->
        <div>
          <div class="flex items-start justify-between gap-2 mb-2.5">
            <div>
              <h4 class="font-bold text-sm tracking-tight text-white flex items-center gap-1.5 truncate max-w-[210px]" title="${repo.name}">
                ${repo.name}
              </h4>
              <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                <span class="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${catClass}">
                  ${catLabel}
                </span>
                ${repo.port ? `<span class="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40">:${repo.port}</span>` : ''}
                <span class="header-debug-badge ${isDebugActive ? 'text-[10px] font-mono font-bold text-fuchsia-300 bg-fuchsia-950/80 px-2 py-0.5 rounded-full border border-fuchsia-500/60 shadow-sm shadow-fuchsia-900/40 flex items-center gap-1 pulse-purple' : isDebugEnabled ? 'text-[10px] font-mono text-fuchsia-400/90 bg-fuchsia-950/40 px-1.5 py-0.5 rounded border border-fuchsia-800/40 flex items-center gap-1' : 'hidden'}" title="Remote Debugger (Port: ${debugPort})">
                  <i class="fa-solid fa-bug text-[10px] text-fuchsia-400"></i> :${debugPort}
                </span>
              </div>
            </div>

            <!-- Status Badge -->
            <span class="status-badge ${this.getStatusBadgeClass(repo.status)}">
              ${this.getStatusBadgeContent(repo.status)}
            </span>
          </div>

          <!-- Metadata Rows -->
          <div class="space-y-1.5 my-3 text-[11px] text-slate-400">
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

            <!-- JDWP Debug Row (if enabled or active) -->
            ${(isDebugEnabled || isDebugActive) ? `
              <div class="flex items-center justify-between text-[11px] ${isDebugActive ? 'text-fuchsia-300' : 'text-slate-400'}">
                <span class="flex items-center gap-1">
                  <i class="fa-solid fa-bug text-[10px] text-fuchsia-400"></i>
                  <span>JDWP Debug:</span>
                </span>
                <span class="font-mono text-[10px] ${isDebugActive ? 'text-fuchsia-300 font-bold' : 'text-slate-400'}">
                  :${debugPort} ${isDebugActive ? '<span class="text-[9px] bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-700/60 px-1 rounded ml-0.5">ACTIVE</span>' : ''}
                </span>
              </div>
            ` : ''}

            <!-- Anti-lag tuning pill -->
            <div class="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
              <span>Anti-Lag: <span class="text-indigo-400">384M / C1 JIT</span></span>
              <span>${repo.projectType.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <!-- Action Button Row -->
        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1 flex-wrap">
            <button class="btn-start btn-fluid px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs shadow-sm shadow-emerald-600/20 ${isRunning ? 'hidden' : ''}" title="Start Application">
              <i class="fa-solid fa-play text-[10px] mr-1"></i> Start
            </button>
            <button class="btn-debug btn-fluid px-2 py-1.5 rounded-lg ${isDebugActive ? 'bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-500/60 shadow-sm shadow-fuchsia-900/30' : 'bg-slate-800 hover:bg-fuchsia-950/60 text-fuchsia-400 hover:text-fuchsia-200 border border-slate-700/80 hover:border-fuchsia-500/40'} font-medium text-xs ${isBuilding || isPulling ? 'hidden' : ''}" title="Launch with Remote Debugger (JDWP port: ${debugPort})">
              <i class="fa-solid fa-bug text-[10px] mr-1 text-fuchsia-400"></i> Debug
            </button>
            <button class="btn-stop btn-fluid px-2.5 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white font-medium text-xs shadow-sm shadow-rose-600/20 ${isRunning || isBuilding ? '' : 'hidden'}" title="Stop Process">
              <i class="fa-solid fa-stop text-[10px] mr-1"></i> Stop
            </button>
            <button class="btn-restart btn-fluid p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs ${isRunning ? '' : 'hidden'}" title="Restart Process">
              <i class="fa-solid fa-rotate-right text-[11px]"></i>
            </button>
            <button class="btn-build btn-fluid px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs border border-slate-700/80" title="Build Application via ${repo.projectType}">
              <i class="fa-solid fa-hammer text-[10px] mr-1 text-amber-400"></i> Build
            </button>
            <button class="btn-pull btn-fluid p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs" title="Git Pull Latest">
              <i class="fa-solid fa-cloud-arrow-down text-[11px] text-fuchsia-400"></i>
            </button>
          </div>

          <div class="flex items-center gap-1">
            <button class="btn-logs btn-fluid px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-cyan-500/20 hover:text-cyan-300 text-slate-300 text-xs border border-slate-700/70" title="Stream stdout/stderr logs">
              <i class="fa-solid fa-terminal text-[10px] mr-1 text-cyan-400"></i> Logs
            </button>
            <button class="btn-config btn-fluid p-1.5 rounded-lg text-slate-400 hover:text-white text-xs hover:bg-slate-800" title="Configure Java / Port">
              <i class="fa-solid fa-gear text-[11px]"></i>
            </button>
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
