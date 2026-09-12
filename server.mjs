import WebSocket from "ws";
import http from "node:http";

const SYMBOL = (process.env.BINANCE_SYMBOL || "BTCUSDT").toUpperCase();
const STREAM_SYMBOL = SYMBOL.toLowerCase();
const PORT = Number(process.env.PORT || 8080);
const WS_URL = `wss://stream.binance.com:9443/ws/${STREAM_SYMBOL}@trade`;

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let state = {
  status: "starting",
  symbol: SYMBOL,
  source: "Binance public WebSocket",
  connectedAt: null,
  lastEventAt: null,
  lastPrice: null,
  lastQuantity: null,
  tradeId: null,
  eventCount: 0,
  reconnects: 0,
  lastError: null
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function connect() {
  clearTimeout(reconnectTimer);
  state.status = "connecting";
  log(`Connecting to ${WS_URL}`);

  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    reconnectAttempt = 0;
    state.status = "connected";
    state.connectedAt = new Date().toISOString();
    state.lastError = null;
    log(`LIVE connected: ${SYMBOL}`);
  });

  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.e !== "trade") return;

      state.lastEventAt = new Date(msg.E || Date.now()).toISOString();
      state.lastPrice = Number(msg.p);
      state.lastQuantity = Number(msg.q);
      state.tradeId = msg.t;
      state.eventCount += 1;

      // For the first test we only print one sample every 100 events.
      // The stream itself remains continuous.
      if (state.eventCount === 1 || state.eventCount % 100 === 0) {
        log(
          `LIVE ${SYMBOL}`,
          `price=${state.lastPrice}`,
          `qty=${state.lastQuantity}`,
          `events=${state.eventCount}`
        );
      }
    } catch (err) {
      state.lastError = err.message;
      log("MESSAGE_PARSE_ERROR", err.message);
    }
  });

  ws.on("ping", data => {
    // ws normally replies automatically; this makes the behavior explicit.
    try { ws.pong(data); } catch {}
  });

  ws.on("close", (code, reason) => {
    state.status = "disconnected";
    state.reconnects += 1;
    log(`WebSocket closed code=${code} reason=${reason?.toString() || ""}`);
    scheduleReconnect();
  });

  ws.on("error", err => {
    state.lastError = err.message;
    log("WEBSOCKET_ERROR", err.message);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempt += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt - 1, 5));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  log(`Reconnect scheduled in ${delay / 1000}s`);
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: state.status === "connected",
      ...state,
      checkedAt: new Date().toISOString()
    }, null, 2));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Health server listening on port ${PORT}`);
  connect();
});

function shutdown(signal) {
  log(`Received ${signal}, shutting down`);
  clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
