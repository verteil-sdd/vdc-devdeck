# ⚡ VDC DevDeck

> **Local Stack Orchestrator & Dynamic Application Auto-Discovery for Verteil Direct Connect (VDC)**

VDC DevDeck is a lightweight, local-hosted developer portal and headless process orchestrator. It solves the bottlenecks of manual scripts, eliminates lag and freeze-ups on developer laptops, dynamically discovers newly cloned repositories, and provides a modern, dark fluidic dashboard.

---

## 🌟 Key Capabilities

### 1. Dynamic Auto-Discovery (Zero Hardcoding)
- Continuously scans and watches `~/Desktop/verteil` (69+ repositories, including airline connectors).
- Whenever you `git clone` a new application or connector, DevDeck automatically detects it, identifies whether it uses **Maven**, **Gradle**, **Node/Angular**, or **Tomcat**, finds its target executable JARs, detects the appropriate **JDK version**, and exposes it on the dashboard without manual script editing.

### 2. The 3 Startup Modes
- **Mode 1: V1 Full Stack (`[⚡ Start V1 Stack]`)**:
  Sequenced, health-gated startup for:
  `verteil-ui` ➔ `tomcat-vdc` ➔ `vdc-configurator` ➔ `auth-service` ➔ `agencymanagement-v1` ➔ `entrygate-service` ➔ `ordermanagement-v1` ➔ `offermanagement-v1` ➔ `payment` ➔ `opendata`.
- **Mode 2: V3 NDC Stack (`[🚀 Start V3 Stack]`)**:
  Fast startup for next-gen microservices:
  `ordermanagement` (V3) ➔ `offermanagement` (V3).
- **Mode 3: Individual Microservice Lifecycle**:
  Every repository card provides independent controls for:
  - **Git Pull**: Pulls latest branch changes with ahead/behind indicators.
  - **Build**: Compiles via Gradle (`./gradlew clean build`) or Maven (`./mvnw clean install`) with streaming logs.
  - **Start / Stop / Restart**: Runs headless without opening heavy terminal windows.
  - **Logs**: Opens real-time streaming terminal with ANSI color support.
  - **Config**: Override JDK version, custom port, or target JAR.

### 3. Anti-Lag Engine (Engineered for Laptop Stability)
- **JVM Heap Capping**: Injects `-Xms128m -Xmx384m` (or `-Xmx512m` for configurator) so running 10 services uses **under 4GB RAM** instead of the default ~40GB virtual heap that previously caused severe disk swapping.
- **Fast Dev JIT & Tiered Compilation**: Injects `-XX:+TieredCompilation -XX:TieredStopAtLevel=1` (client compiler only) and `-Dspring.main.lazy-initialization=true` to cut JIT CPU burn and boot services in half the time.
- **Headless Execution**: Completely eliminates GNOME terminal GUI tabs. Captures stdout/stderr into in-memory ring buffers and streams over WebSockets.
- **AWS Token Pooling**: Authenticates once to AWS CodeArtifact and caches the token for 12 hours, avoiding slow AWS CLI subprocess calls on every run.

---

## 🚀 Quick Start

### Starting the Daemon
```bash
cd ~/Desktop/verteil/vdc-devdeck
./devdeck.sh start
```

Open your browser at:
👉 **[http://localhost:9990](http://localhost:9990)**

### Managing the Daemon
```bash
./devdeck.sh status     # Check status and PID
./devdeck.sh stop       # Stop daemon
./devdeck.sh restart    # Restart daemon
./devdeck.sh logs       # View daemon logs
./devdeck.sh fg         # Run in foreground for debugging
```

---

## 🖥 Dashboard Overview

- **Top Bar**:
  - `[Start V1 Stack]` & `[Start V3 Stack]` one-click launch buttons.
  - `[Stop All]` button.
  - **System Resource Telemetry**: Live CPU %, RAM GB used, and active JVM count.
  - **AWS CodeArtifact Status**: Shows validity and one-click token refresh.
- **Search & Filter Bar**:
  - Search any repo by name, branch, or type (press `/` to focus).
  - Quick filters: `All (78)`, `Running`, `V1 Stack`, `V3 Stack`, `Connectors`, `Needs Build`.
  - `[Rescan]` button to immediately reload workspace.
- **Application Cards**:
  - Pulsating status badge (`RUNNING 🟢`, `BUILDING 🟡`, `PULLING 🟣`, `STOPPED ⚪`, `ERROR 🔴`).
  - Git branch, uncommitted changes indicator, commits ahead/behind remote.
  - Configured SDKMAN JDK and service port.
- **Live Terminal Drawer**:
  - Slidable bottom console with ANSI colors.
  - Per-app tab switching, live auto-scroll, regex filter, and log clear.
