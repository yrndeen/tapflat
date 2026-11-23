import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTestnetMids, SUPPORTED_COINS, HYPERLIQUID_TESTNET_INFO_URL } from "./hl-testnet.mjs";
import { PaperLedger } from "./paper-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE = path.resolve(__dirname, "../data/paper-ledger.json");

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createTapflatServer({
  storagePath = DEFAULT_STORAGE,
  fetchMids = fetchTestnetMids,
  seedDemoPosition = true,
} = {}) {
  const ledger = new PaperLedger(storagePath);

  // Cache mids briefly (3s) so rapid UI polls stay responsive while always fresh
  let cachedMids = null;
  let cachedAtMs = 0;

  async function getLiveMids(force = false) {
    const now = Date.now();
    if (!force && cachedMids && now - cachedAtMs < 3000) {
      return cachedMids;
    }
    const fresh = await fetchMids();
    cachedMids = fresh;
    cachedAtMs = now;
    return fresh;
  }

  let seeded = false;
  async function ensureSeeded(mids) {
    if (!seedDemoPosition || seeded) return;
    seeded = true;
    // Seed a single realistic SOL paper position only on first run if ledger is completely empty
    if (!ledger.getPosition("SOL") && ledger.listTickets(1).length === 0 && mids.SOL) {
      const entry = Number((mids.SOL * 0.992).toFixed(4));
      ledger.openPaperPosition({ coin: "SOL", side: "LONG", size: 25, entryPrice: entry });
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }

      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "tapflat-server",
          mode: "PAPER",
          testnetInfoUrl: HYPERLIQUID_TESTNET_INFO_URL,
          supportedCoins: SUPPORTED_COINS,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/glance") {
        const coin = (url.searchParams.get("coin") || "SOL").toUpperCase();
        if (!SUPPORTED_COINS.includes(coin)) {
          return sendJson(res, 400, { ok: false, error: `Unsupported coin ${coin}. Use SOL, BTC, or ETH.` });
        }
        const force = url.searchParams.get("force") === "1";
        const market = await getLiveMids(force);
        await ensureSeeded(market.mids);
        const markPrice = market.mids[coin];
        if (!markPrice) {
          return sendJson(res, 502, { ok: false, error: `Hyperliquid testnet mid unavailable for ${coin}` });
        }
        return sendJson(res, 200, {
          ok: true,
          mode: "PAPER",
          coin,
          markPrice,
          source: market.source,
          fetchedAt: market.fetchedAt,
          position: ledger.markPosition(coin, markPrice),
          recentTickets: ledger.listTickets(5),
        });
      }

      if (req.method === "POST" && url.pathname === "/api/paper/flatten") {
        const body = await readBody(req);
        const coin = String(body.coin || "SOL").toUpperCase();
        const trigger = String(body.trigger || "tap");
        if (!SUPPORTED_COINS.includes(coin)) {
          return sendJson(res, 400, { ok: false, error: `Unsupported coin ${coin}` });
        }
        const market = await getLiveMids(true);
        const markPrice = market.mids[coin];
        try {
          const ticket = ledger.flattenPosition({ coin, markPrice, trigger });
          return sendJson(res, 200, { ok: true, mode: "PAPER", ticket });
        } catch (err) {
          return sendJson(res, err.status || 400, {
            ok: false,
            code: err.code || "FLATTEN_FAILED",
            error: err.message,
          });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/paper/open") {
        const body = await readBody(req);
        const coin = String(body.coin || "SOL").toUpperCase();
        if (!SUPPORTED_COINS.includes(coin)) {
          return sendJson(res, 400, { ok: false, error: `Unsupported coin ${coin}` });
        }
        const market = await getLiveMids(true);
        const markPrice = market.mids[coin];
        const side = body.side === "SHORT" ? "SHORT" : "LONG";
        const defaultSize = coin === "BTC" ? 0.05 : coin === "ETH" ? 1.0 : 25;
        const size = Number(body.size || defaultSize);
        const entryPrice = Number(body.entryPrice || (markPrice * (side === "LONG" ? 0.992 : 1.008)).toFixed(4));
        const pos = ledger.openPaperPosition({ coin, side, size, entryPrice });
        return sendJson(res, 200, {
          ok: true,
          mode: "PAPER",
          position: ledger.markPosition(coin, markPrice),
          raw: pos,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/paper/tickets") {
        return sendJson(res, 200, { ok: true, mode: "PAPER", tickets: ledger.listTickets(20) });
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      return sendJson(res, 502, {
        ok: false,
        code: "UPSTREAM_OR_SERVER_ERROR",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { server, ledger };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const { server } = createTapflatServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`[tapflat-server] PAPER backend listening on http://127.0.0.1:${port}`);
    console.log(`[tapflat-server] Read-only market source: ${HYPERLIQUID_TESTNET_INFO_URL}`);
  });
}
