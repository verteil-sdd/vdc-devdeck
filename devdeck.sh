#!/bin/bash
# VDC DevDeck Control Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
      echo "👉 URL: http://localhost:9990"
    else
      echo "⚪ VDC DevDeck is STOPPED."
    fi
    ;;

  logs)
    tail -f "$LOG_FILE"
    ;;

  fg)
    echo "Running VDC DevDeck in foreground..."
    cd "$SCRIPT_DIR"
    node server/index.js
    ;;

  *)
    echo "Usage: ./devdeck.sh {start|stop|restart|status|logs|fg}"
    exit 1
    ;;
esac
