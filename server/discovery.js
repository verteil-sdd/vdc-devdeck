import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chokidar from 'chokidar';
import { config } from './config.js';
import { gitManager } from './gitManager.js';

class DiscoveryEngine {
  constructor() {
    this.repositories = new Map();
    this.overrides = new Map();
    this.watcher = null;
    this.listeners = new Set();
    this.isScanning = false;
  }

  async init() {
    this.loadOverrides();
    await this.scanAll();
    this.startWatcher();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (err) {
        console.error('[Discovery] Listener notification error:', err);
      }
    }
  }

  loadOverrides() {
    try {
      if (fs.existsSync(config.overridesFile)) {
        const data = JSON.parse(fs.readFileSync(config.overridesFile, 'utf8'));
        this.overrides = new Map(Object.entries(data));
      }
    } catch (err) {
      console.warn('[Discovery] Failed to load overrides:', err.message);
    }
  }

  saveOverrides() {
    try {
      if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
      }
      const obj = Object.fromEntries(this.overrides);
      fs.writeFileSync(config.overridesFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      console.error('[Discovery] Failed to save overrides:', err.message);
    }
  }

  setOverride(name, data) {
    const existing = this.overrides.get(name) || {};
    const cleaned = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        cleaned[k] = v;
      }
    }
    const updated = { ...existing, ...cleaned };
    this.overrides.set(name, updated);
    this.saveOverrides();

    if (this.repositories.has(name)) {
      const repo = this.repositories.get(name);
      Object.assign(repo, updated);
      this.notify('repo:updated', repo);
    }
  }

  startWatcher() {
    if (this.watcher) return;

    this.watcher = chokidar.watch(config.verteilDir, {
      depth: 1,
      ignoreInitial: true,
      ignored: (filePath) => {
        const basename = path.basename(filePath);
        return (
          basename.startsWith('.') ||
          basename === 'vdc-devdeck' ||
          basename === 'logs' ||
          basename === 'node_modules'
        );
      }
    });

    this.watcher.on('addDir', async (dirPath) => {
      // Only watch 1 level down
      if (path.dirname(dirPath) === config.verteilDir) {
        const name = path.basename(dirPath);
        console.log(`[Discovery] New directory detected: ${name}`);
        const info = await this.inspectDirectory(dirPath);
        if (info) {
          this.repositories.set(name, info);
          this.notify('repo:discovered', info);
        }
      }
    });

    this.watcher.on('unlinkDir', (dirPath) => {
      if (path.dirname(dirPath) === config.verteilDir) {
        const name = path.basename(dirPath);
        console.log(`[Discovery] Directory removed: ${name}`);
        if (this.repositories.has(name)) {
          this.repositories.delete(name);
          this.notify('repo:removed', { name });
        }
      }
    });
  }

  async scanAll() {
    if (this.isScanning) return;
    this.isScanning = true;
    console.log(`[Discovery] Scanning repositories in ${config.verteilDir}...`);

    try {
      if (!fs.existsSync(config.verteilDir)) {
        console.warn(`[Discovery] Verteil directory ${config.verteilDir} does not exist!`);
        return;
      }

      const entries = fs.readdirSync(config.verteilDir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter(
          (name) =>
            !name.startsWith('.') &&
            name !== 'vdc-devdeck' &&
            name !== 'logs' &&
            name !== 'node_modules'
        );

      for (const dirName of dirs) {
        const fullPath = path.join(config.verteilDir, dirName);
        try {
          const info = await this.inspectDirectory(fullPath);
          if (info) {
            this.repositories.set(dirName, info);
          }
        } catch (err) {
          console.warn(`[Discovery] Error inspecting ${dirName}:`, err.message);
        }
      }

      console.log(`[Discovery] Discovered ${this.repositories.size} repositories.`);
      this.notify('scan:complete', this.getAll());
    } finally {
      this.isScanning = false;
    }
  }

  async inspectDirectory(dirPath) {
    const name = path.basename(dirPath);

    // Git inspection
    const gitInfo = await gitManager.getRepoGitInfo(dirPath);

    // Build system detection
    let projectType = 'unknown';
    let buildCmd = '';
    let runCmd = '';
    let usesWrapper = false;

    const hasMvnw = fs.existsSync(path.join(dirPath, 'mvnw'));
    const hasPom = fs.existsSync(path.join(dirPath, 'pom.xml'));
    const hasGradlew = fs.existsSync(path.join(dirPath, 'gradlew'));
    const hasGradle =
      fs.existsSync(path.join(dirPath, 'build.gradle')) ||
      fs.existsSync(path.join(dirPath, 'build.gradle.kts'));
    const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
    const hasCatalina = fs.existsSync(path.join(dirPath, 'bin/catalina.sh'));

    if (hasCatalina) {
      projectType = 'tomcat';
      buildCmd = '';
      runCmd = 'sh ./bin/catalina.sh jpda run';
    } else if (hasPackageJson) {
      const hasAngular = fs.existsSync(path.join(dirPath, 'angular.json'));
      projectType = hasAngular ? 'angular' : 'node';
      buildCmd = 'npm install';
      runCmd = hasAngular ? 'ng serve' : 'npm start';
    } else if (hasMvnw || hasPom) {
      projectType = 'maven';
      usesWrapper = hasMvnw;
      buildCmd = hasMvnw
        ? './mvnw clean install -Dmaven.test.skip=true'
        : 'mvn clean install -Dmaven.test.skip=true';
    } else if (hasGradlew || hasGradle) {
      projectType = 'gradle';
      usesWrapper = hasGradlew;
      buildCmd = hasGradlew
        ? './gradlew clean build -x test'
        : 'gradle clean build -x test';
    }

    // Java Version detection
    const jdk = this.detectJdk(dirPath, name);

    // Target executable JAR detection
    const { jarPath, isBuilt } = this.findExecutableJar(dirPath, name, projectType);

    // Port detection
    const port = this.detectPort(dirPath, name);

    // Category
    let category = 'other';
    if (config.v1Stack.includes(name)) {
      category = 'v1-core';
    } else if (config.v3Stack.includes(name)) {
      category = 'v3-core';
    } else if (name.startsWith('connector-')) {
      category = 'connector';
    } else if (name.includes('schema')) {
      category = 'schema';
    }

    const defaultDebugPort = (config.debugPortDefaults && config.debugPortDefaults[name]) || config.defaultDebugPort || 5005;

    const baseInfo = {
      name,
      path: dirPath,
      projectType,
      usesWrapper,
      buildCmd,
      runCmd,
      jdk,
      targetJar: jarPath,
      isBuilt,
      port,
      category,
      git: gitInfo,
      debugEnabled: false,
      debugPort: defaultDebugPort,
      debugSuspend: false
    };

    // Apply any user overrides
    const override = this.overrides.get(name) || {};
    return { ...baseInfo, ...override };
  }

  findSdkForVersion(ver) {
    if (!ver) return null;
    const vStr = String(ver).trim();
    try {
      if (fs.existsSync(config.sdkmanJavaDir)) {
        const installed = fs.readdirSync(config.sdkmanJavaDir).filter((f) => f !== 'current' && !f.startsWith('.'));
        const match = installed.find((i) => i === vStr || i.startsWith(vStr + '.') || i.startsWith(vStr + '-'));
        if (match) return match;
      }
    } catch {}
    if (vStr === '25') return '25-amzn';
    if (vStr === '21') return '21.0.1-amzn';
    if (vStr === '18') return '18.0.2-sem';
    if (vStr === '17') return '17.0.9-amzn';
    if (vStr === '11') return '11.0.28-amzn';
    if (vStr === '8') return '8.0.392-amzn';
    return vStr;
  }

  parseJavaVersion(content) {
    if (!content) return null;
    const langMatch = content.match(/JavaLanguageVersion\.of\(\s*(\d+)\s*\)/);
    if (langMatch) return langMatch[1];
    const toolchainMatch = content.match(/jvmToolchain\s*\(?\s*(\d+)\s*\)?/);
    if (toolchainMatch) return toolchainMatch[1];
    const sourceCompatMatch = content.match(/sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(\d+)['"]?/);
    if (sourceCompatMatch) return sourceCompatMatch[1];
    const targetCompatMatch = content.match(/targetCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(\d+)['"]?/);
    if (targetCompatMatch) return targetCompatMatch[1];
    const releaseMatch = content.match(/options\.release\s*=\s*(\d+)/);
    if (releaseMatch) return releaseMatch[1];
    const pomMatch = content.match(/<(?:java\.version|maven\.compiler\.source|maven\.compiler\.target|release)>(\d+)<\//);
    if (pomMatch) return pomMatch[1];
    return null;
  }

  detectJdk(dirPath, name) {
    // 1. User override
    const override = this.overrides.get(name);
    if (override && override.jdk) {
      return override.jdk;
    }

    // 2. .sdkmanrc file
    const sdkmanrcPath = path.join(dirPath, '.sdkmanrc');
    if (fs.existsSync(sdkmanrcPath)) {
      const content = fs.readFileSync(sdkmanrcPath, 'utf8');
      const match = content.match(/java\s*=\s*([^\r\n]+)/);
      if (match) return match[1].trim();
    }

    // 3. Inspect build file contents (root & subprojects)
    const candidateFiles = [
      path.join(dirPath, 'build.gradle'),
      path.join(dirPath, 'build.gradle.kts'),
      path.join(dirPath, `${name}-server/build.gradle`),
      path.join(dirPath, 'pom.xml')
    ];

    for (const file of candidateFiles) {
      if (fs.existsSync(file)) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          const ver = this.parseJavaVersion(content);
          if (ver) {
            return this.findSdkForVersion(ver);
          }
        } catch {}
      }
    }

    // 4. Inspect built JAR manifest for Build-Jdk-Spec if available
    try {
      const found = this.findExecutableJar(dirPath, name, 'gradle');
      if (found && found.jarPath) {
        const fullJar = path.join(dirPath, found.jarPath);
        if (fs.existsSync(fullJar)) {
          const mf = execSync(`unzip -p "${fullJar}" META-INF/MANIFEST.MF 2>/dev/null`, {
            timeout: 2000,
            maxBuffer: 512 * 1024
          }).toString();
          const specMatch = mf.match(/Build-Jdk-Spec:\s*(\d+)/);
          if (specMatch) {
            return this.findSdkForVersion(specMatch[1]);
          }
        }
      }
    } catch {}

    // 5. Known default
    if (config.jdkDefaults[name]) {
      return config.jdkDefaults[name];
    }

    // 6. Heuristic fallbacks
    if (name.endsWith('-v1')) return '17.0.9-amzn';
    return '21.0.1-amzn';
  }

  isJarExecutable(jarFullPath) {
    if (!fs.existsSync(jarFullPath)) return false;
    try {
      const manifest = execSync(`unzip -p "${jarFullPath}" META-INF/MANIFEST.MF 2>/dev/null`, {
        timeout: 2000,
        maxBuffer: 512 * 1024
      }).toString();
      return manifest.includes('Main-Class:');
    } catch {
      return false;
    }
  }

  findExecutableJar(dirPath, name, projectType) {
    if (projectType !== 'gradle' && projectType !== 'maven') {
      return { jarPath: null, isBuilt: true };
    }

    // Known target JAR mappings from automate.sh
    const knownTargets = {
      'vdc-configurator': 'vdc-configurator-server/target/vdc-configurator-server.jar',
      'auth-service': 'build/libs/auth-service',
      'agencymanagement-v1': 'agencymanagement-v1-server/build/libs/agencymanagement-v1-server',
      'entrygate-service': 'verteil-infra-entrygate-web/target/entrygate-service',
      'offermanagement-v1': 'offermanagement-v1-server/build/libs/offermanagement-v1-server',
      'ordermanagement-v1': 'ordermanagement-v1-server/build/libs/ordermanagement-v1-server',
      'opendata': 'opendata-server/build/libs/opendata-server',
      'payment': 'payment-server/build/libs/payment-server',
      'ordermanagement': 'ordermanagement-server/build/libs/ordermanagement-server',
      'offermanagement': 'offermanagement-server/build/libs/offermanagement-server',
      'connector-flyr': 'connector-flyr-server/build/libs/connector-flyr-server',
      'connector-flyr-v1': 'connector-flyr-v1-server/build/libs/connector-flyr-v1-server'
    };

    // Helper to recursively find jar files in build/libs or target
    const findJars = (dir, depth = 0) => {
      if (depth > 3 || !fs.existsSync(dir)) return [];
      let results = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'libs' || entry.name === 'target') {
              const files = fs.readdirSync(full);
              for (const f of files) {
                if (
                  f.endsWith('.jar') &&
                  !f.endsWith('-sources.jar') &&
                  !f.endsWith('-javadoc.jar') &&
                  !f.endsWith('-plain.jar') &&
                  !f.includes('wrapper') &&
                  !f.includes('jacoco')
                ) {
                  results.push(path.relative(dirPath, path.join(full, f)));
                }
              }
            } else if (
              !entry.name.startsWith('.') &&
              entry.name !== 'node_modules' &&
              entry.name !== 'src' &&
              entry.name !== 'gradle' &&
              entry.name !== 'tmp'
            ) {
              results = results.concat(findJars(full, depth + 1));
            }
          }
        }
      } catch {}
      return results;
    };

    const foundJars = findJars(dirPath);

    if (foundJars.length > 0) {
      // Check which jars are truly executable (contain Main-Class in manifest)
      const executableJars = foundJars.filter((j) => this.isJarExecutable(path.join(dirPath, j)));
      const pool = executableJars.length > 0 ? executableJars : foundJars;

      // Score and prioritize candidate jars
      const scored = pool.map((j) => {
        let score = 0;
        const lower = j.toLowerCase();
        if (lower.includes('server')) score += 100;
        if (lower.includes('web')) score += 80;
        if (lower.includes(name.toLowerCase())) score += 20;
        if (lower.startsWith('build/libs/') && pool.some((p) => p.includes('server') || p.includes('web'))) {
          score -= 50; // penalize root jar if subproject server exists
        }
        if (lower.includes('client') || lower.includes('common') || lower.includes('acceptance') || lower.includes('test')) {
          score -= 60;
        }
        try {
          const stat = fs.statSync(path.join(dirPath, j));
          score += stat.mtimeMs / 1e12; // slight tie-breaker for newest build
        } catch {}
        return { path: j, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const chosen = scored[0].path;
      const isBuilt = executableJars.length > 0;
      return { jarPath: `./${chosen}`, isBuilt };
    }

    // If not built yet, construct expected pattern
    if (knownTargets[name]) {
      const ext = projectType === 'maven' ? '.jar' : '*.jar';
      return { jarPath: `./${knownTargets[name]}${ext}`, isBuilt: false };
    }

    // Check if subproject *-server or *-web directory exists
    try {
      const subdirs = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const serverDir = subdirs.find(
        (d) => d === `${name}-server` || d.endsWith('-server') || d.endsWith('-web')
      );
      if (serverDir) {
        return {
          jarPath: `./${serverDir}/${projectType === 'maven' ? 'target' : 'build/libs'}/*.jar`,
          isBuilt: false
        };
      }
    } catch {}

    return {
      jarPath: `./${projectType === 'maven' ? 'target' : 'build/libs'}/*.jar`,
      isBuilt: false
    };
  }

  detectPort(dirPath, name) {
    if (config.portDefaults[name]) {
      return config.portDefaults[name];
    }

    // Search application properties or yaml
    const checkFile = (relPath) => {
      const full = path.join(dirPath, relPath);
      if (!fs.existsSync(full)) return null;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const propMatch = content.match(/server\.port\s*=\s*(\d+)/);
        if (propMatch) return parseInt(propMatch[1], 10);

        const ymlMatch = content.match(/port\s*:\s*(\d+)/);
        if (ymlMatch) return parseInt(ymlMatch[1], 10);
      } catch {}
      return null;
    };

    const candidates = [
      'src/main/resources/application.properties',
      'src/main/resources/application.yml',
      `${name}-server/src/main/resources/application.properties`,
      `${name}-server/src/main/resources/application.yml`
    ];

    for (const c of candidates) {
      const port = checkFile(c);
      if (port) return port;
    }

    return null;
  }

  getAll() {
    return Array.from(this.repositories.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  get(name) {
    return this.repositories.get(name);
  }
}

export const discovery = new DiscoveryEngine();
