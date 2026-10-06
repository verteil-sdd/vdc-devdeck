# ⚡ VDC DevDeck

> **Local Stack Orchestrator & Dynamic Application Auto-Discovery for Verteil Direct Connect (VDC)**

VDC DevDeck is a lightweight, local developer portal and headless process orchestrator designed for **Linux native environments**. It eliminates manual multi-terminal startup scripts, prevents laptop freezes through smart JVM memory limits, auto-discovers newly cloned repositories, and provides a real-time dark fluidic dashboard.

---

## 💻 System Requirements

> [!IMPORTANT]
> **Linux Native OS Required**: DevDeck is designed and optimized specifically for **Linux native machines** (Ubuntu, Debian, Fedora, Arch, or WSL2 on Windows). It depends on Linux-native process control utilities (`ss`, `fuser`, `setsid`, `pkill`, `killall`, and `/proc/meminfo`).

### Prerequisites Checklist:
1. **Node.js**: v18+ installed and available on `$PATH`.
2. **SDKMAN!**: Installed at `~/.sdkman` with JDK candidates installed (`17.0.9-amzn`, `21.0.1-amzn`, `18.0.2-sem`, etc.).
3. **AWS CLI & SSO**: Installed and configured for Verteil's private AWS CodeArtifact (`vdc-repository`).
4. **Linux Utilities**: Standard tools (`fuser` via `psmisc`, `ss` via `iproute2`, `unzip`, `git`).

---

## 🌟 Key Capabilities

### 1. Dynamic Auto-Discovery (Plug & Play)
- **Zero Hardcoding**: Simply clone `vdc-devdeck` inside the directory where all your other Verteil repositories are cloned (e.g. `~/Desktop/verteil`, `~/projects/verteil`, `~/workspace`).
- DevDeck automatically detects its parent workspace directory and continuously scans all sibling repositories (microservices, airline connectors, schemas, UI).
- When you `git clone` a new service, DevDeck detects it in real-time, identifies whether it uses **Maven**, **Gradle**, **Node/Angular**, or **Tomcat**, locates the target executable JAR, detects the required **JDK version**, and adds it to the dashboard.
- *(Optional override: set `export VERTEIL_DIR=/custom/path` if your repos are in a different directory).*

### 2. AWS CodeArtifact Token Management
- Fetches CodeArtifact tokens using your selected profile and region, tracks token/session expiry, and refreshes credentials before builds and service starts when needed.
- **Configurable AWS Profile**:
  - Open the gear beside the AWS badge to save your profile and CodeArtifact region. Defaults: `VerteilDeveloper-683455398069`, `ap-south-1`.
  - Saved dashboard settings take precedence over `AWS_PROFILE` and `AWS_REGION` / `AWS_DEFAULT_REGION`. Settings and custom stacks persist in `~/.vdc-devdeck/settings.json` (override the directory with `DEVDECK_DATA_DIR`).
  - Uses AWS CLI v2 credential export for SSO. Older CLI setups fall back to `ssocreds -p <profile>`, matching the legacy setup script. Ensure `aws` and, when needed, `ssocreds` are available on the daemon’s `PATH`.
  - If your local AWS SSO profile has a different name, specify it with `export AWS_PROFILE=your-profile` or prefix `./devdeck.sh start`:
    ```bash
    AWS_PROFILE=my-profile ./devdeck.sh start
    ```
  - Ensure you have an active session:
    ```bash
    aws sso login --profile <your-profile>
    ```

### 3. Startup Modes
- **Mode 1: V1 Full Stack (`[⚡ Start V1 Stack]`)**:
  Sequenced, health-gated startup for:
  `verteil-ui` ➔ `tomcat-vdc` ➔ `vdc-configurator` ➔ `auth-service` ➔ `agencymanagement-v1` ➔ `entrygate-service` ➔ `ordermanagement-v1` ➔ `offermanagement-v1` ➔ `payment` ➔ `opendata`.
  *(Automatically skips any services you haven't cloned).*
- **Mode 2: V3 NDC Stack (`[🚀 Start V3 Stack]`)**:
  Fast startup for next-gen microservices:
  `ordermanagement` (V3) ➔ `offermanagement` (V3).
- **Mode 3: Individual Microservice Lifecycle**:
  Every repository card provides independent controls for:
  - **Git Pull**: Pulls latest branch changes with ahead/behind indicators.
  - **Build**: Compiles via Gradle (`./gradlew clean build`) or Maven (`./mvnw clean install`) with streaming logs.
  - **Start / Stop / Restart**: Runs headless without opening heavy terminal windows.
  - **Logs**: Opens real-time streaming terminal with ANSI color support.
  - **Config / Remote Debug**: Configure JDK version, custom port, or attach JDWP remote debugging.

- **Custom stacks**: Open **Custom stacks** in the top bar, name a stack, add repositories and use the arrows to arrange startup order. Save it, then click **Start**. Saved stacks can be edited or deleted. Put dependencies first; each configured service port must become ready before the next service starts. Missing repositories and startup failures are reported in the progress banner.

### 4. Anti-Lag Engine (Engineered for Laptop Stability)
- **JVM Heap Capping**: Injects `-Xms128m -Xmx384m` (or `-Xmx512m` for configurator) so running 10 services uses **under 4GB RAM** instead of the default ~40GB virtual heap that causes severe disk swapping.
- **Fast Dev JIT & Tiered Compilation**: Injects `-XX:+TieredCompilation -XX:TieredStopAtLevel=1` (client compiler only) and `-Dspring.main.lazy-initialization=true` to cut JIT CPU burn and boot services in half the time.
- **Headless Execution**: Eliminates GNOME terminal GUI tabs. Captures stdout/stderr into in-memory ring buffers and streams over WebSockets.
- **Ghost Process Auto-Cleanup**: Automatically cleans up dead/orphaned processes blocking ports before launching a service.

---

## 🚀 Quick Start

### 1. Clone into your repos folder
Clone `vdc-devdeck` directly into the folder where your other Verteil repositories are kept:
```bash
cd /path/to/your/verteil-repos
git clone <repo-url> vdc-devdeck
cd vdc-devdeck
```

### 2. Start the Daemon
```bash
./devdeck.sh start
```
*(Or supply a default profile before saving settings in the dashboard)*:
```bash
AWS_PROFILE=my-verteil-profile ./devdeck.sh start
```

### 3. Open the Dashboard
👉 **[http://localhost:9990](http://localhost:9990)**

---

## 🛠 Managing the Daemon

```bash
./devdeck.sh status     # Check status, detected workspace & AWS profile
./devdeck.sh stop       # Stop daemon
./devdeck.sh restart    # Restart daemon
./devdeck.sh logs       # Stream daemon logs
./devdeck.sh fg         # Run in foreground for debugging
./devdeck.sh kill-java  # Kill switch: terminates all lingering Java processes & frees ports
```

---

## 🖥 Dashboard Overview

- **Top Bar**:
  - Play controls for V1 and V3 launches, plus a custom-stack editor and launcher.
  - Stop-all and force-kill icons with descriptive tooltips.
  - Light/dark theme toggle. Defaults to the system theme and remembers your selection.
  - **Auto-detected Workspace Path**: Displays the active directory being monitored.
  - **System Resource Telemetry**: Live CPU %, RAM GB used, and active JVM count.
  - **AWS CodeArtifact Status**: Shows token validity, configured AWS profile, one-click token refresh, and a gear to edit profile/region. Setup failures show the actual error instead of a generic “Token Expired” label.
- **Search & Filter Bar**:
  - Search any repo by name, branch, or type (press `/` to focus).
  - Quick filters: `All`, `Running`, `V1 Stack`, `V3 Stack`, `Connectors`, `Needs Build`.
  - Rescan icon to immediately reload workspace.
- **Application Cards**:
  - Green dots for running applications and red dots for stopped or failed applications; activity rings for starting, building, and pulling. Hover for the status label.
  - Icon controls for start, debug, stop, restart, build, pull, logs, and configuration, with tooltips and accessible labels.
  - Frosted glass panels, responsive spacing, and subtle entry animations that respect reduced-motion preferences.
  - Git branch, uncommitted changes indicator, commits ahead/behind remote.
  - Configured SDKMAN JDK and service port.
- **Live Terminal Drawer**:
  - Slidable bottom console with ANSI colors.
  - Per-app tab switching, live auto-scroll, regex filter, and log clear.
