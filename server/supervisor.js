import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { config } from './config.js';
import { discovery } from './discovery.js';
import { awsManager } from './awsManager.js';
import { gitManager } from './gitManager.js';

const execAsync = promisify(exec);

class CircularLogBuffer {
  constructor(maxLines = 5000) {
    this.maxLines = maxLines;
    this.lines = [];
  }

  push(text) {
    const split = text.split('\n');
    for (let i = 0; i < split.length; i++) {
      if (i === split.length - 1 && split[i] === '') continue;
      this.lines.push(split[i]);
      if (this.lines.length > this.maxLines) {
        this.lines.shift();
      }
    }
  }

  getLines() {
    return this.lines;
  }

  clear() {
    this.lines = [];
  }
}

class SupervisorEngine {
  constructor() {
    this.processes = new Map(); // repoName -> { pid, child, status, startedAt, buffer, fileStream, port }
    this.listeners = new Set();
    this.initLogsDir();
  }

  initLogsDir() {
    if (!fs.existsSync(config.logsDir)) {
      fs.mkdirSync(config.logsDir, { recursive: true });
    }
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (err) {
        console.error('[Supervisor] Listener error:', err);
      }
    }
  }

  getProcess(name) {
    return this.processes.get(name);
  }

  getStatus(name) {
    const proc = this.processes.get(name);
    return proc ? proc.status : 'STOPPED';
  }

  getAllStatuses() {
    const result = {};
    for (const [name, proc] of this.processes.entries()) {
      result[name] = {
        status: proc.status,
        pid: proc.pid,
        startedAt: proc.startedAt,
        port: proc.port
      };
    }
    return result;
  }

  getLogBuffer(name) {
    let proc = this.processes.get(name);
    if (!proc) {
      proc = {
        status: 'STOPPED',
        buffer: new CircularLogBuffer(5000),
        startedAt: null
      };
      this.processes.set(name, proc);
    }
    return proc.buffer;
  }

  clearLogs(name) {
    const proc = this.processes.get(name);
    if (proc && proc.buffer) {
      proc.buffer.clear();
      this.emit('log:cleared', { name });
    }
  }

  appendLog(name, text, stream = 'stdout') {
    const proc = this.getProcess(name);
    if (proc && proc.buffer) {
      proc.buffer.push(text);
      if (proc.fileStream) {
        proc.fileStream.write(text);
      }
    }
    this.emit('log:line', { name, text, stream });
  }

  resolveJavaPath(jdkVersion) {
    const candidatePath = path.join(config.sdkmanJavaDir, jdkVersion);
    if (fs.existsSync(candidatePath)) {
      return {
        javaHome: candidatePath,
        javaBin: path.join(candidatePath, 'bin/java')
      };
    }

    // Check if current is available
    const currentPath = path.join(config.sdkmanJavaDir, 'current');
    if (fs.existsSync(currentPath)) {
      return {
        javaHome: currentPath,
        javaBin: path.join(currentPath, 'bin/java')
      };
    }

    return {
      javaHome: process.env.JAVA_HOME || '/usr/lib/jvm/default-java',
      javaBin: 'java'
    };
  }

  checkPortActive(port, timeoutMs = 1000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isConnected = false;

      socket.setTimeout(timeoutMs);
      socket.on('connect', () => {
        isConnected = true;
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(port, '127.0.0.1');
    });
  }

  async waitForPort(port, maxWaitMs = 60000, intervalMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const active = await this.checkPortActive(port, 800);
      if (active) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  async start(repoName) {
    const repo = discovery.get(repoName);
    if (!repo) {
      throw new Error(`Repository ${repoName} not found in catalog.`);
    }

    let proc = this.processes.get(repoName);
    if (proc && (proc.status === 'RUNNING' || proc.status === 'STARTING')) {
      return { success: true, message: `${repoName} is already running.` };
    }

    if (!proc) {
      proc = {
        status: 'STOPPED',
        buffer: new CircularLogBuffer(5000),
        startedAt: null
      };
      this.processes.set(repoName, proc);
    }

    // Ensure AWS credentials are fresh
    if (!awsManager.isTokenFresh()) {
      this.appendLog(repoName, '\x1b[33m[DevDeck]\x1b[0m AWS token expired or missing. Refreshing...\n');
      try {
        await awsManager.refreshCredentials();
        this.appendLog(repoName, '\x1b[32m[DevDeck]\x1b[0m AWS credentials refreshed.\n');
      } catch (err) {
        this.appendLog(repoName, `\x1b[31m[DevDeck AWS ERROR]\x1b[0m ${err.message}\n`);
      }
    }

    const awsEnv = awsManager.getEnv();
    repo.jdk = discovery.detectJdk(repo.path, repo.name);
    const { javaHome, javaBin } = this.resolveJavaPath(repo.jdk);
    this.appendLog(repoName, `\x1b[34m[DevDeck]\x1b[0m Resolved JDK: ${repo.jdk} (${javaBin})\n`);

    // Prepare anti-lag JVM flags
    const isHeavy = repo.name === 'vdc-configurator' || repo.name === 'tomcat-vdc';
    const mem = isHeavy ? config.heavyJvmMemory : config.defaultJvmMemory;
    const jvmMemoryFlags = [`-Xms${mem.min}`, `-Xmx${mem.max}`];
    const jvmFlags = [...jvmMemoryFlags, ...config.antiLagFlags];

    // Log file stream
    const logFilePath = path.join(config.logsDir, `${repoName}.log`);
    const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    proc.fileStream = fileStream;

    proc.status = 'STARTING';
    proc.startedAt = Date.now();
    proc.port = repo.port;
    this.emit('status:changed', { name: repoName, status: 'STARTING', port: repo.port });

    const isNodeOrAngular = repo.projectType === 'angular' || repo.projectType === 'node';
    this.appendLog(
      repoName,
      `\n\x1b[36m=======================================================\x1b[0m\n` +
      `\x1b[1;36m[DevDeck]\x1b[0m Starting \x1b[1m${repoName}\x1b[0m at ${new Date().toLocaleTimeString()}\n` +
      (isNodeOrAngular
        ? `\x1b[36m[DevDeck]\x1b[0m Project Type: ${repo.projectType.toUpperCase()} (Port: ${repo.port || 4200})\n`
        : `\x1b[36m[DevDeck]\x1b[0m JDK: ${repo.jdk} (${javaBin})\n` +
          `\x1b[36m[DevDeck]\x1b[0m Anti-Lag JVM Flags: ${jvmFlags.join(' ')}\n`) +
      `\x1b[36m=======================================================\x1b[0m\n\n`
    );

    let child;
    const env = {
      ...process.env,
      ...awsEnv,
      JAVA_HOME: javaHome,
      PATH: `${javaHome}/bin:${process.env.PATH}`,
      JAVA_OPTS: jvmFlags.join(' ')
    };

    if (isNodeOrAngular) {
      const pkgPath = path.join(repo.path, 'package.json');
      let hasStart = false;
      try {
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          hasStart = !!(pkg.scripts && pkg.scripts.start);
        }
      } catch {}

      // Prepend Node LTS (prefer v20.x, then v22.x, then v18.x) from nvm if available
      let customPath = process.env.PATH;
      const nvmBase = path.join(os.homedir(), '.nvm/versions/node');
      try {
        if (fs.existsSync(nvmBase)) {
          const allVersions = fs.readdirSync(nvmBase);
          const preferred = allVersions.find((v) => v.startsWith('v20')) ||
                            allVersions.find((v) => v.startsWith('v22')) ||
                            allVersions.find((v) => v.startsWith('v18'));
          if (preferred) {
            customPath = `${path.join(nvmBase, preferred, 'bin')}:${customPath}`;
          }
        }
      } catch {}

      let npmCmd;
      if (repo.projectType === 'angular') {
        npmCmd = hasStart
          ? ['run', 'start', '--', '--port', '4200']
          : ['run', 'ng', '--', 'serve', '--port', '4200'];
      } else {
        npmCmd = hasStart ? ['start'] : ['run', 'dev'];
      }

      this.appendLog(repoName, `\x1b[34m[DevDeck]\x1b[0m Executing command: npm ${npmCmd.join(' ')}\n`);

      child = spawn('npm', npmCmd, {
        cwd: repo.path,
        env: { ...env, PATH: customPath },
        detached: true
      });
    } else if (repo.projectType === 'tomcat') {
      child = spawn('sh', ['./bin/catalina.sh', 'jpda', 'run'], {
        cwd: repo.path,
        env,
        detached: true
      });
    } else {
      // Gradle or Maven Java Jar execution
      // Dynamically resolve the executable JAR on disk
      let resolvedJar = null;
      const jarInfo = discovery.findExecutableJar(repo.path, repo.name, repo.projectType);
      if (jarInfo && jarInfo.isBuilt && jarInfo.jarPath) {
        resolvedJar = jarInfo.jarPath;
        repo.targetJar = jarInfo.jarPath;
        repo.isBuilt = true;
      }

      // If not resolved from discovery, fallback to targetJar or wildcard expansion
      if (!resolvedJar && repo.targetJar) {
        if (fs.existsSync(path.join(repo.path, repo.targetJar))) {
          resolvedJar = repo.targetJar;
        } else {
          try {
            const { stdout } = await execAsync(`bash -c 'ls -1t ${repo.targetJar} 2>/dev/null | head -n 1'`, {
              cwd: repo.path
            });
            if (stdout.trim()) {
              resolvedJar = stdout.trim();
            }
          } catch {}
        }
      }

      if (!resolvedJar) {
        proc.status = 'STOPPED';
        this.emit('status:changed', { name: repoName, status: 'STOPPED' });
        const err = `Executable JAR file matching '${repo.targetJar || 'build'}' was not found. Please build the application first.`;
        this.appendLog(repoName, `\x1b[31m[ERROR]\x1b[0m ${err}\n`);
        throw new Error(err);
      }

      // Verify that the resolved JAR is truly executable (has Main-Class)
      const fullJarPath = path.join(repo.path, resolvedJar);
      if (fs.existsSync(fullJarPath) && !discovery.isJarExecutable(fullJarPath)) {
        proc.status = 'STOPPED';
        this.emit('status:changed', { name: repoName, status: 'STOPPED' });
        const err = `Resolved JAR '${resolvedJar}' has no Main-Class manifest attribute (not an executable JAR). Please verify that the server module is built.`;
        this.appendLog(repoName, `\x1b[31m[ERROR]\x1b[0m ${err}\n`);
        throw new Error(err);
      }

      this.appendLog(repoName, `\x1b[34m[DevDeck]\x1b[0m Starting with executable JAR: ${resolvedJar}\n`);

      const javaArgs = [...jvmFlags, '-jar', resolvedJar];
      child = spawn(javaBin, javaArgs, {
        cwd: repo.path,
        env,
        detached: true
      });
    }

    proc.pid = child.pid;
    proc.child = child;

    child.stdout.on('data', (chunk) => {
      this.appendLog(repoName, chunk.toString(), 'stdout');
    });

    child.stderr.on('data', (chunk) => {
      this.appendLog(repoName, chunk.toString(), 'stderr');
    });

    child.on('close', (code, signal) => {
      this.appendLog(
        repoName,
        `\n\x1b[33m[DevDeck]\x1b[0m Process exited with code ${code}, signal ${signal}\n`
      );
      proc.status = 'STOPPED';
      proc.pid = null;
      proc.child = null;
      this.emit('status:changed', { name: repoName, status: 'STOPPED', code });
    });

    child.on('error', (err) => {
      this.appendLog(repoName, `\x1b[31m[DevDeck Process Error]\x1b[0m ${err.message}\n`);
      proc.status = 'ERROR';
      this.emit('status:changed', { name: repoName, status: 'ERROR', error: err.message });
    });

    // Mark as running once spawned
    proc.status = 'RUNNING';
    this.emit('status:changed', { name: repoName, status: 'RUNNING', pid: child.pid });

    return { success: true, pid: child.pid };
  }

  async stop(repoName) {
    const proc = this.processes.get(repoName);
    if (!proc || !proc.child || proc.status === 'STOPPED') {
      if (proc) proc.status = 'STOPPED';
      this.emit('status:changed', { name: repoName, status: 'STOPPED' });
      return { success: true, message: `${repoName} is already stopped.` };
    }

    const pid = proc.pid;
    this.appendLog(repoName, `\x1b[33m[DevDeck]\x1b[0m Sending SIGTERM to process group -${pid}...\n`);

    try {
      // Kill entire process group
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        proc.child.kill('SIGTERM');
      } catch {}
    }

    // Wait up to 5s, else SIGKILL
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (proc.status === 'STOPPED') break;
    }

    if (proc.status !== 'STOPPED' && proc.child) {
      this.appendLog(repoName, `\x1b[31m[DevDeck]\x1b[0m Process did not terminate; forcing SIGKILL...\n`);
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          proc.child.kill('SIGKILL');
        } catch {}
      }
    }

    proc.status = 'STOPPED';
    proc.pid = null;
    proc.child = null;
    this.emit('status:changed', { name: repoName, status: 'STOPPED' });
    return { success: true };
  }

  async restart(repoName) {
    await this.stop(repoName);
    await new Promise((r) => setTimeout(r, 1000));
    return await this.start(repoName);
  }

  async build(repoName) {
    const repo = discovery.get(repoName);
    if (!repo) {
      throw new Error(`Repository ${repoName} not found in catalog.`);
    }

    let proc = this.processes.get(repoName);
    if (proc && proc.status === 'BUILDING') {
      return { success: false, message: 'Build already in progress.' };
    }

    if (!proc) {
      proc = {
        status: 'STOPPED',
        buffer: new CircularLogBuffer(5000),
        startedAt: null
      };
      this.processes.set(repoName, proc);
    }

    // Refresh AWS credentials
    if (!awsManager.isTokenFresh()) {
      this.appendLog(repoName, '\x1b[33m[DevDeck]\x1b[0m Refreshing AWS CodeArtifact token for build...\n');
      try {
        await awsManager.refreshCredentials();
      } catch (err) {
        this.appendLog(repoName, `\x1b[31m[AWS Error]\x1b[0m ${err.message}\n`);
      }
    }

    const awsEnv = awsManager.getEnv();
    const { javaHome } = this.resolveJavaPath(repo.jdk);

    const prevStatus = proc.status;
    proc.status = 'BUILDING';
    this.emit('status:changed', { name: repoName, status: 'BUILDING' });

    this.appendLog(
      repoName,
      `\n\x1b[35m=======================================================\x1b[0m\n` +
      `\x1b[1;35m[DevDeck BUILD]\x1b[0m Building \x1b[1m${repoName}\x1b[0m (${repo.buildCmd})\n` +
      `\x1b[35m[DevDeck BUILD]\x1b[0m Java Version: ${repo.jdk}\n` +
      `\x1b[35m=======================================================\x1b[0m\n\n`
    );

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        ...awsEnv,
        JAVA_HOME: javaHome,
        PATH: `${javaHome}/bin:${process.env.PATH}`,
        GRADLE_OPTS: '-Dorg.gradle.daemon=true -Dorg.gradle.jvmargs="-Xmx512m -XX:+TieredCompilation -XX:TieredStopAtLevel=1"'
      };

      const child = spawn('bash', ['-c', repo.buildCmd], {
        cwd: repo.path,
        env
      });

      child.stdout.on('data', (chunk) => {
        this.appendLog(repoName, chunk.toString(), 'stdout');
      });

      child.stderr.on('data', (chunk) => {
        this.appendLog(repoName, chunk.toString(), 'stderr');
      });

      child.on('close', async (code) => {
        if (code === 0) {
          this.appendLog(repoName, `\n\x1b[32m[DevDeck BUILD SUCCESS]\x1b[0m Built ${repoName} successfully.\n`);
          // Re-inspect repo to update targetJar and isBuilt
          const updated = await discovery.inspectDirectory(repo.path);
          if (updated) {
            discovery.repositories.set(repoName, updated);
            discovery.notify('repo:updated', updated);
          }
          proc.status = prevStatus === 'RUNNING' ? 'RUNNING' : 'STOPPED';
          this.emit('status:changed', { name: repoName, status: proc.status });
          resolve({ success: true });
        } else {
          this.appendLog(repoName, `\n\x1b[31m[DevDeck BUILD FAILED]\x1b[0m Exited with code ${code}.\n`);
          proc.status = 'STOPPED';
          this.emit('status:changed', { name: repoName, status: 'STOPPED' });
          reject(new Error(`Build exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        this.appendLog(repoName, `\x1b[31m[DevDeck BUILD ERROR]\x1b[0m ${err.message}\n`);
        proc.status = 'STOPPED';
        this.emit('status:changed', { name: repoName, status: 'STOPPED' });
        reject(err);
      });
    });
  }

  async pull(repoName) {
    const repo = discovery.get(repoName);
    if (!repo) {
      throw new Error(`Repository ${repoName} not found in catalog.`);
    }

    const prevStatus = this.getStatus(repoName);
    const proc = this.getProcess(repoName);
    if (proc) {
      proc.status = 'PULLING';
      this.emit('status:changed', { name: repoName, status: 'PULLING' });
    }

    try {
      await gitManager.pull(repo.path, (text) => this.appendLog(repoName, text));
      const gitInfo = await gitManager.getRepoGitInfo(repo.path);
      repo.git = gitInfo;
      discovery.notify('repo:updated', repo);
      return { success: true };
    } finally {
      if (proc) {
        proc.status = prevStatus === 'RUNNING' ? 'RUNNING' : 'STOPPED';
        this.emit('status:changed', { name: repoName, status: proc.status });
      }
    }
  }

  async stopAll() {
    console.log('[Supervisor] Stopping all running services...');
    const stopPromises = [];
    for (const [name, proc] of this.processes.entries()) {
      if (proc.status === 'RUNNING' || proc.status === 'STARTING') {
        stopPromises.push(this.stop(name));
      }
    }
    await Promise.all(stopPromises);
    return { success: true };
  }
}

export const supervisor = new SupervisorEngine();
