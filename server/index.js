import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { discovery } from './discovery.js';
import { supervisor } from './supervisor.js';
import { orchestrator } from './orchestrator.js';
import { awsManager } from './awsManager.js';
import { systemMetrics } from './systemMetrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../public');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Broadcast helper
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// WebSocket connection handling
wss.on('connection', async (ws) => {
  // Send initial snapshot
  const repos = discovery.getAll().map((r) => {
    const proc = supervisor.getProcess(r.name);
    return {
      ...r,
      status: supervisor.getStatus(r.name),
      debugActive: proc ? !!proc.debugActive : false,
      debugPort: proc && proc.debugPort ? proc.debugPort : r.debugPort
    };
  });
  const metrics = await systemMetrics.getMetrics();
  const aws = awsManager.getStatus();
  const stack = orchestrator.getStatus();

  ws.send(JSON.stringify({ type: 'init', data: { repos, metrics, aws, stack, workspaceDir: config.verteilDir } }));

  ws.on('message', (message) => {
    try {
      const { action, payload } = JSON.parse(message.toString());
      if (action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch {}
  });
});

// Event subscriptions
discovery.onEvent((event, data) => {
  broadcast(event, data);
});

supervisor.onEvent((event, data) => {
  broadcast(event, data);
});

orchestrator.onEvent((data) => {
  broadcast('stack:progress', data);
});

// Periodic system metrics broadcast (every 2.5 seconds)
setInterval(async () => {
  try {
    const metrics = await systemMetrics.getMetrics();
    broadcast('metrics:update', metrics);
  } catch {}
}, 2500);

// REST API Endpoints

// Helper to format repo response
function formatRepo(r) {
  const proc = supervisor.getProcess(r.name);
  return {
    ...r,
    status: supervisor.getStatus(r.name),
    debugActive: proc ? !!proc.debugActive : false,
    debugPort: proc && proc.debugPort ? proc.debugPort : r.debugPort
  };
}

// 1. Repositories
app.get('/api/repos', (req, res) => {
  const repos = discovery.getAll().map(formatRepo);
  res.json({ success: true, count: repos.length, repos });
});

app.post('/api/repos/rescan', async (req, res) => {
  await discovery.scanAll();
  const repos = discovery.getAll().map(formatRepo);
  res.json({ success: true, count: repos.length, repos });
});

app.get('/api/repos/:name', (req, res) => {
  const repo = discovery.get(req.params.name);
  if (!repo) return res.status(404).json({ success: false, message: 'Repo not found' });
  res.json({
    success: true,
    repo: formatRepo(repo)
  });
});

app.post('/api/repos/:name/override', (req, res) => {
  const { jdk, port, buildCmd, runCmd, targetJar, debugPort, debugSuspend } = req.body;
  discovery.setOverride(req.params.name, {
    jdk,
    port,
    buildCmd,
    runCmd,
    targetJar,
    debugEnabled: false,
    debugPort: debugPort !== undefined ? parseInt(debugPort, 10) : undefined,
    debugSuspend
  });
  res.json({ success: true, repo: formatRepo(discovery.get(req.params.name)) });
});

// 2. Lifecycle Actions (Individual)
app.post('/api/repos/:name/start', async (req, res) => {
  try {
    const { debug, debugPort, suspend } = req.body || {};
    const result = await supervisor.start(req.params.name, { debug, debugPort, suspend });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/repos/:name/stop', async (req, res) => {
  try {
    const result = await supervisor.stop(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/repos/:name/restart', async (req, res) => {
  try {
    const { debug, debugPort, suspend } = req.body || {};
    const result = await supervisor.restart(req.params.name, { debug, debugPort, suspend });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/repos/:name/debug', async (req, res) => {
  try {
    const { debugPort, suspend } = req.body || {};
    const name = req.params.name;
    const repo = discovery.get(name);
    if (!repo) return res.status(404).json({ success: false, message: 'Repo not found' });

    const portNum = debugPort ? parseInt(debugPort, 10) : (repo.debugPort || config.defaultDebugPort || 5005);
    const suspendVal = suspend !== undefined ? !!suspend : (repo.debugSuspend || false);

    const currentStatus = supervisor.getStatus(name);
    let result;
    if (currentStatus === 'RUNNING' || currentStatus === 'STARTING') {
      result = await supervisor.restart(name, { debug: true, debugPort: portNum, suspend: suspendVal });
    } else {
      result = await supervisor.start(name, { debug: true, debugPort: portNum, suspend: suspendVal });
    }
    res.json({ success: true, ...result, debugPort: portNum });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/repos/:name/build', async (req, res) => {
  try {
    // Run build asynchronously, respond immediately that build has started
    supervisor.build(req.params.name).catch((err) => {
      console.error(`Build failed for ${req.params.name}:`, err.message);
    });
    res.json({ success: true, message: `Build initiated for ${req.params.name}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/repos/:name/pull', async (req, res) => {
  try {
    supervisor.pull(req.params.name).catch((err) => {
      console.error(`Git pull failed for ${req.params.name}:`, err.message);
    });
    res.json({ success: true, message: `Git pull initiated for ${req.params.name}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Logs
app.get('/api/repos/:name/logs', (req, res) => {
  const buffer = supervisor.getLogBuffer(req.params.name);
  res.json({ success: true, lines: buffer.getLines() });
});

app.post('/api/repos/:name/logs/clear', (req, res) => {
  supervisor.clearLogs(req.params.name);
  res.json({ success: true });
});

// 4. Stacks (V1, V3, Stop All)
app.post('/api/stack/v1', async (req, res) => {
  try {
    orchestrator.startV1Stack().catch((err) => {
      console.error('V1 Stack launch failed:', err.message);
    });
    res.json({ success: true, message: 'V1 Stack startup initiated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/stack/v3', async (req, res) => {
  try {
    orchestrator.startV3Stack().catch((err) => {
      console.error('V3 Stack launch failed:', err.message);
    });
    res.json({ success: true, message: 'V3 Stack startup initiated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/stack/stop-all', async (req, res) => {
  try {
    const result = await orchestrator.stopAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/system/kill-all-java', async (req, res) => {
  try {
    const result = await supervisor.killAllJava();
    orchestrator.activeStack = null;
    orchestrator.status = 'IDLE';
    orchestrator.currentStep = 0;
    orchestrator.emitProgress({ message: 'Kill Switch: All Java processes terminated and ports released.', status: 'IDLE' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/stack/status', (req, res) => {
  res.json(orchestrator.getStatus());
});

// 5. System Metrics & AWS
app.get('/api/metrics', async (req, res) => {
  const metrics = await systemMetrics.getMetrics();
  res.json(metrics);
});

app.get('/api/aws', (req, res) => {
  res.json(awsManager.getStatus());
});

app.post('/api/aws/refresh', async (req, res) => {
  try {
    const status = await awsManager.refreshCredentials();
    broadcast('aws:updated', status);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/aws/profile', async (req, res) => {
  try {
    const { profile } = req.body;
    if (profile && typeof profile === 'string') {
      config.awsProfile = profile.trim();
      process.env.AWS_PROFILE = config.awsProfile;
    }
    const status = await awsManager.refreshCredentials();
    broadcast('aws:updated', status);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, status: awsManager.getStatus() });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Boot server
async function startServer() {
  console.log('[DevDeck] Starting VDC DevDeck Server...');
  await awsManager.init();
  await discovery.init();

  server.listen(config.port, config.host, () => {
    console.log(`\n========================================================`);
    console.log(`⚡ VDC DevDeck running at: http://localhost:${config.port}`);
    console.log(`📂 Watching workspace:    ${config.verteilDir}`);
    console.log(`========================================================\n`);
  });
}

startServer().catch((err) => {
  console.error('[DevDeck] Fatal server startup error:', err);
  process.exit(1);
});
