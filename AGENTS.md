# AGENTS.md — Agent Guidelines & Project Architecture

## 1. Project Overview & Mission

**VDC DevDeck** (`vdc-devdeck`) is a lightweight, local developer portal and headless process orchestrator engineered specifically for **Linux native environments** supporting **Verteil Direct Connect (VDC)** microservices.

### Core Objectives:
- **Zero-Window Sprawl**: Replaces dozens of bloated GNOME/terminal windows with a centralized, headless daemon and a dark-mode WebSocket-driven web dashboard (`http://localhost:9990`).
- **Dynamic Auto-Discovery**: Automatically discovers sibling Git repositories cloned inside the parent directory (`VERTEIL_DIR`), identifying project types (Maven, Gradle, Node/Angular, Tomcat) and matching SDKMAN JDK versions.
- **Anti-Lag Engine (Laptop Stability)**: Caps JVM heaps (`-Xms128m -Xmx384m`), enables client-only tiered compilation (`-XX:+TieredCompilation -XX:TieredStopAtLevel=1`), and lazy initialization (`-Dspring.main.lazy-initialization=true`) so 10+ services run within < 4 GB RAM.
- **AWS CodeArtifact Integration**: Manages AWS SSO tokens and automated refresh cycles for Verteil's private CodeArtifact repository (`vdc-repository`).
- **Sequenced Stack Orchestration**: Health-gated, port-polling startup sequences for V1 Full Stack, V3 NDC Stack, and custom user-defined stacks.

---

## 2. Project Architecture & Codebase Map

```
vdc-devdeck/
├── devdeck.sh              # Linux daemon CLI (start, stop, restart, status, logs, fg, kill-java)
├── package.json            # Node.js project manifest (ES Modules, dependencies, scripts)
├── AGENTS.md               # AI Agent operating manual & project conventions
├── README.md               # User documentation & quick-start guide
├── docs/                   # Engineering documentation and technical notes
│   └── aws-stack-fix.md
├── public/                 # Vanilla JS/CSS Dark Fluidic Frontend (SPA)
│   ├── index.html          # Dashboard HTML structure
│   ├── app.js              # Frontend state, WebSocket client, event dispatchers
│   ├── settingsUi.js       # AWS profile and custom stack configuration UI
│   ├── style.css           # Modern dark-mode UI stylesheet
│   ├── theme.js            # Theme persistence (dark/light)
│   └── ansi.js             # ANSI escape-code terminal color parser
├── server/                 # Backend Node.js daemon (Express + WebSocket)
│   ├── index.js            # Express server, WebSocket broker (/ws), REST API routes
│   ├── config.js           # Central configuration, default ports, JVM heap limits, JDK mappings
│   ├── discovery.js        # Sibling repo scanner, build tool & JDK detection
│   ├── supervisor.js       # Process lifecycle manager (start, stop, restart, build, pull, kill)
│   ├── orchestrator.js     # Sequenced multi-service startup engine with port health-polling
│   ├── awsManager.js       # AWS SSO credential exporter & CodeArtifact token cache
│   ├── gitManager.js       # Git branch, ahead/behind tracking, and git pull handler
│   ├── settings.js         # Settings & custom stack persistence (~/.vdc-devdeck/settings.json)
│   └── systemMetrics.js    # CPU, RAM, and active JVM monitoring via /proc/meminfo
└── tests/                  # Automated integration tests using Node.js native test runner
    ├── api.test.js
    ├── awsManager.test.js
    ├── orchestrator.test.js
    ├── settings.test.js
    └── fixtures/
```

---

## 3. Technology Stack & Key Dependencies

- **Runtime**: Node.js (v18+ recommended) with ECMAScript Modules (`"type": "module"`).
- **Backend**:
  - `express`: REST API endpoints.
  - `ws`: Real-time duplex WebSocket communication for terminal logs and telemetry.
  - `cors`: Cross-origin request handling.
  - `chokidar`: File system watcher for live workspace changes.
- **Frontend**: Vanilla ES6+ JavaScript, CSS3 with fluid styling, HTML5, native WebSockets.
- **Testing**: Built-in Node test runner (`node --test`). No external test framework dependencies.
- **Linux Native Dependencies**:
  - `ss` (`iproute2`), `fuser` (`psmisc`), `setsid`, `pkill`, `killall`.
  - Reads `/proc/meminfo` and `/proc/stat` for telemetry.
- **External Integrations**:
  - **SDKMAN!**: Located at `~/.sdkman/candidates/java`.
  - **AWS CLI v2 / ssocreds**: Configured for CodeArtifact token retrieval.

---

## 4. Development & Testing Commands

Agents must run these standard commands when inspecting, developing, or verifying code:

```bash
# Run test suite (Node native test runner)
npm test

# Start server in watch mode (hot reload)
npm run dev

# Start server normally
npm start

# Manage daemon via shell script
./devdeck.sh status     # Check daemon and workspace status
./devdeck.sh fg         # Run daemon in foreground for debugging
./devdeck.sh logs       # Tail daemon logs
./devdeck.sh kill-java  # Kill switch: purge lingering Java processes and free ports
```

---

## 5. Agent Safety & Autonomous Permission Rules

To align with developer requirements and maintain maximum productivity without unintended side-effects:

1. **Autonomous Operations (Auto-Execute)**:
   - Reading files, inspecting directory structures, and checking git status.
   - Executing read-only terminal commands (`npm test`, `git status`, `git branch`, `ss`, `ps`, `node -v`).
   - Checking system telemetry and daemon status.

2. **Code Change Protocol (Explicit Confirmation)**:
   - **Always ask and propose the planned changes before writing or editing code files.**
   - Summarize the file path, lines affected, and rationale.
   - Await developer confirmation before executing tools that alter files (`write_to_file`, `replace_file_content`).

3. **Linux First**:
   - DevDeck relies strictly on Linux-native kernel structures and binaries (`/proc`, `ss`, `fuser`, `setsid`). Never introduce OS abstractions or assumptions that break Linux compatibility.

4. **Testing Mandatory**:
   - Any server or backend logic modification must be accompanied by running `npm test`. All 12+ native tests must pass cleanly before completing a task.

5. **Code Style & ESM Standards**:
   - Strictly use ES Modules (`import`/`export`). Do not use CommonJS `require()`.
   - Preserve clean asynchronous patterns (`async`/`await`, proper error trapping).
   - Ensure file paths handle spaces and parent directory traversal safely.
