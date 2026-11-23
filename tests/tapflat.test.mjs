import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertTestnetInfoUrl, fetchTestnetMids, HYPERLIQUID_TESTNET_INFO_URL } from "../server/hl-testnet.mjs";
import { PaperLedger } from "../server/paper-engine.mjs";
import { createTapflatServer } from "../server/index.mjs";

test("assertTestnetInfoUrl blocks Hyperliquid mainnet and non-testnet hosts", () => {
  assert.equal(assertTestnetInfoUrl(HYPERLIQUID_TESTNET_INFO_URL), HYPERLIQUID_TESTNET_INFO_URL);
  assert.throws(() => assertTestnetInfoUrl("https://api.hyperliquid.xyz/info"), /Mainnet or unauthorized host blocked/);
  assert.throws(() => assertTestnetInfoUrl("http://api.hyperliquid-testnet.xyz/info"), /HTTPS required/);
  assert.throws(() => assertTestnetInfoUrl("https://evil.example.com/info"), /Mainnet or unauthorized host blocked/);
});

test("PaperLedger flatten is strictly reduce-only, persists ticket, and rejects already-flat", () => {
  const tmpFile = path.join(os.tmpdir(), `tapflat-ledger-${Date.now()}.json`);
  try {
    const ledger = new PaperLedger(tmpFile);
    assert.equal(ledger.getPosition("SOL"), null);

    // Rejects flattening when already flat
    assert.throws(
      () => ledger.flattenPosition({ coin: "SOL", markPrice: 150, trigger: "tap" }),
      (err) => err.code === "ALREADY_FLAT" && err.status === 409
    );

    // Open paper LONG 10 SOL @ $140
    ledger.openPaperPosition({ coin: "SOL", side: "LONG", size: 10, entryPrice: 140 });
    const marked = ledger.markPosition("SOL", 145.5);
    assert.equal(marked.upnlUsd, 55);
    assert.equal(marked.mode, "PAPER");

    // Flatten at $145.5 -> realized +$55.00, remainingSize = 0
    const ticket = ledger.flattenPosition({ coin: "SOL", markPrice: 145.5, trigger: "g2-ring" });
    assert.equal(ticket.mode, "PAPER");
    assert.equal(ticket.reduceOnly, true);
    assert.equal(ticket.remainingSize, 0);
    assert.equal(ticket.realizedPnlUsd, 55);
    assert.equal(ledger.getPosition("SOL"), null);

    // Second flatten must reject (no double-flatten, never opens SHORT)
    assert.throws(
      () => ledger.flattenPosition({ coin: "SOL", markPrice: 145.5, trigger: "g2-ring" }),
      (err) => err.code === "ALREADY_FLAT"
    );

    // Persistence check on reload
    const reloaded = new PaperLedger(tmpFile);
    assert.equal(reloaded.getPosition("SOL"), null);
    assert.equal(reloaded.listTickets(5).length, 1);
    assert.equal(reloaded.listTickets(5)[0].ticketId, ticket.ticketId);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("Tapflat HTTP server serves glance, flatten, re-open, and 409 on double-flatten", async () => {
  const tmpFile = path.join(os.tmpdir(), `tapflat-http-${Date.now()}.json`);
  const mockFetchMids = async () => ({
    source: "hyperliquid-testnet",
    endpoint: HYPERLIQUID_TESTNET_INFO_URL,
    fetchedAt: "2026-11-23T09:00:00.000Z",
    mids: { SOL: 162.5, BTC: 94200.0, ETH: 3420.0 },
  });

  const { server } = createTapflatServer({
    storagePath: tmpFile,
    fetchMids: mockFetchMids,
    seedDemoPosition: true,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.mode, "PAPER");

    const glance1 = await (await fetch(`${base}/api/glance?coin=SOL`)).json();
    assert.equal(glance1.ok, true);
    assert.equal(glance1.markPrice, 162.5);
    assert.ok(glance1.position && glance1.position.size === 25);

    const flatRes = await fetch(`${base}/api/paper/flatten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin: "SOL", trigger: "g2-ring" }),
    });
    assert.equal(flatRes.status, 200);
    const flatBody = await flatRes.json();
    assert.equal(flatBody.ok, true);
    assert.equal(flatBody.ticket.remainingSize, 0);
    assert.equal(flatBody.ticket.mode, "PAPER");

    // Second flatten returns 409 ALREADY_FLAT
    const flatRes2 = await fetch(`${base}/api/paper/flatten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin: "SOL", trigger: "g2-ring" }),
    });
    assert.equal(flatRes2.status, 409);
    const flatBody2 = await flatRes2.json();
    assert.equal(flatBody2.code, "ALREADY_FLAT");

    // Empty state after flatten
    const glanceEmpty = await (await fetch(`${base}/api/glance?coin=SOL`)).json();
    assert.equal(glanceEmpty.position, null);

    // Re-open demo paper position
    const openBody = await (
      await fetch(`${base}/api/paper/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coin: "SOL", side: "LONG" }),
      })
    ).json();
    assert.equal(openBody.ok, true);
    assert.equal(openBody.position.size, 25);
  } finally {
    server.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("Live Hyperliquid testnet allMids endpoint returns valid SOL/BTC/ETH prices", async () => {
  const res = await fetchTestnetMids();
  assert.equal(res.source, "hyperliquid-testnet");
  assert.equal(res.endpoint, HYPERLIQUID_TESTNET_INFO_URL);
  assert.ok(res.mids.SOL > 0, `expected positive SOL testnet mid, got ${res.mids.SOL}`);
  assert.ok(res.mids.BTC > 0, `expected positive BTC testnet mid, got ${res.mids.BTC}`);
  assert.ok(res.mids.ETH > 0, `expected positive ETH testnet mid, got ${res.mids.ETH}`);
});
