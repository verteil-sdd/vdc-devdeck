#!/bin/bash
# VDC DevDeck Control Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Auto-detect parent workspace directory containing all sibling repos if VERTEIL_DIR is not set
export VERTEIL_DIR="${VERTEIL_DIR:-$PARENT_DIR}"

# The server resolves saved dashboard settings before environment defaults.
AWS_PROFILE_LABEL="${AWS_PROFILE:-VerteilDeveloper-683455398069} (saved dashboard settings take precedence)"

PID_FILE="$HOME/.vdc-devdeck/devdeck.pid"
LOG_FILE="$HOME/.vdc-devdeck/devdeck.log"

mkdir -p "$HOME/.vdc-devdeck"

is_running() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      return 0
    fi
  fi
  # Also check if something is listening on 9990
  if ss -tulpn 2>/dev/null | grep -q ":9990 "; then
    return 0
  fi
  return 1
}

case "$1" in
  start)
    if is_running; then
      echo "⚡ VDC DevDeck is already running."
      echo "👉 Open in your browser: http://localhost:9990"
      exit 0
    fi
    echo "Starting VDC DevDeck daemon on http://localhost:9990..."
    echo "📁 Workspace:   $VERTEIL_DIR"
    echo "☁️  AWS Profile: $AWS_PROFILE_LABEL"
    cd "$SCRIPT_DIR"
    setsid node server/index.js >> "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    
    # Wait up to 30s for server to start listening
    for i in {1..30}; do
      if ss -tulpn 2>/dev/null | grep -q ":9990 "; then
        echo "✅ VDC DevDeck started successfully (PID: $PID)"
        echo "👉 Open in your browser: http://localhost:9990"
        exit 0
      fi
      sleep 1
    done

    if kill -0 $PID 2>/dev/null; then
      echo "✅ VDC DevDeck process is running (PID: $PID), initializing..."
      echo "👉 Open in your browser: http://localhost:9990"
    else
      echo "❌ Failed to start VDC DevDeck. Recent logs:"
      tail -n 25 "$LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    echo "Stopping VDC DevDeck..."
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null
      fi
      rm -f "$PID_FILE"
    fi
    # Also kill any node server/index.js on 9990 if lingering
    F_PID=$(ss -tulpn 2>/dev/null | grep ":9990 " | awk '{print $NF}' | sed -E 's/.*pid=([0-9]+).*/\1/')
    if [ -n "$F_PID" ]; then
      kill "$F_PID" 2>/dev/null || true
    fi
    echo "✅ VDC DevDeck stopped."
    ;;

  restart)
    $0 stop
    sleep 2
    $0 start
    ;;

  status)
    if is_running; then
      echo "✅ VDC DevDeck is RUNNING."
      echo "👉 URL:         http://localhost:9990"
      echo "📁 Workspace:   $VERTEIL_DIR"
      echo "☁️  AWS Profile: $AWS_PROFILE_LABEL"
    else
      echo "⚪ VDC DevDeck is STOPPED."
      echo "📁 Workspace:   $VERTEIL_DIR"
      echo "☁️  AWS Profile: $AWS_PROFILE_LABEL"
    fi
    ;;

  logs)
    tail -f "$LOG_FILE"
    ;;

  fg)
    echo "Running VDC DevDeck in foreground..."
    echo "📁 Workspace:   $VERTEIL_DIR"
    echo "☁️  AWS Profile: $AWS_PROFILE_LABEL"
    cd "$SCRIPT_DIR"
    node server/index.js
    ;;

  kill-java)
    echo "⚠️  Triggering Kill Switch: Terminating all Java processes and releasing ports..."
    killall -9 java 2>/dev/null || true
    pkill -9 -x java 2>/dev/null || true
    pkill -9 -f GradleDaemon 2>/dev/null || true
    for port in 2243 5000 7003 7070 8000 8005 8051 8080 8081 8082 8083 8084 8085 8086 8087 8088 8089 8090 8091 8092 8093 8097 8098 9000 9003 9010 9024 5005 5006 5007 5008 5009 5010 5011 5012 5013 5014 5015 5016; do
      fuser -k -9 ${port}/tcp 2>/dev/null || true
    done
    echo "✅ All Java processes terminated and ports released."
    ;;

  *)
    echo "Usage: ./devdeck.sh {start|stop|restart|status|logs|fg|kill-java}"
    exit 1
    ;;
esac
