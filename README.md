# Tapflat

**Track 02 · Crypto & DeFi (Hyperliquid)** — Heads Up: Even Realities Hackathon

Tapflat is a 576×288 monochrome Even Realities G2 glance app for traders mid-session. It streams live **Hyperliquid testnet** mark prices through a local proxy and lets the user flatten an open **PAPER** position in two taps (one click or R1 ring press to open the confirmation screen, a second click to execute a strictly reduce-only paper flatten ticket).

> **Money Safety Notice:** Tapflat is **PAPER TRADING ONLY**. It reads public, unauthenticated market data from `https://api.hyperliquid-testnet.xyz/info` and writes strictly to a local paper-trading ledger (`data/paper-ledger.json`). It never connects to Hyperliquid mainnet, never holds user funds, never ships API keys, and contains zero wallet-signing code.

---

## Architecture

```
Even Realities G2 (576x288 Monochrome) / Even Hub Simulator
        │  @evenrealities/even_hub_sdk (CreateStartUpPageContainer + TextContainerUpgrade + onEvenHubEvent)
        ▼
app/ (Vite + TypeScript WebView)
        │  Whitelisted in app.json -> http://127.0.0.1:8787
        ▼
server/ (Zero-dependency Node.js proxy + PAPER ledger)
        ├── READ  ──▶ https://api.hyperliquid-testnet.xyz/info  ({"type":"allMids"})
        └── WRITE ──▶ data/paper-ledger.json (strictly reduce-only PAPER flatten tickets)
```

### G2 UX States (576×288, single event-capturing text container)
1. **Loading** — Fetching live Hyperliquid testnet mark.
2. **Live Glance** — Displays active coin (`SOL` / `BTC` / `ETH`), live testnet mark, paper side/size/entry, and live uPnL + ROE%.
3. **Confirm Dialog** — Single tap / R1 ring click opens `CONFIRM REDUCE-ONLY [PAPER]`; tap again to confirm or double-click to cancel.
4. **Success Ticket** — Shows `PAPER TICKET TF-XXXX`, fill price, realized PnL, and `Rem: 0`.
5. **Empty (Flat)** — Shows `POSITION: FLAT` with a one-tap option to open a fresh demo PAPER position.
6. **Error** — Clean offline/upstream error view with one-tap retry.

---

## Quickstart (Local + Even Hub Simulator)

**Prerequisites:** Node.js 20+ (verified on Node `v24.22.1`).

```bash
# 1. Install dependencies
npm install

# 2. Run automated tests (paper engine + HTTP API + live Hyperliquid testnet check)
npm test

# 3. Start the local Hyperliquid testnet proxy & PAPER ledger (port 8787)
npm run dev:server

# 4. In a second terminal, start the Even Hub Vite app (port 5173)
npm run dev:app

# 5. (Optional) Launch the official Even Hub G2 simulator against the app
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
evenhub-simulator http://localhost:5173
```

To typecheck and build the production bundle:
```bash
npm run typecheck
npm run build
```

---

## What Existed Before Nov 23, 2026
All Tapflat application code (`app/`, `server/`, `tests/`, `app.json`) was written from scratch for the Heads Up: Even Realities Hackathon starting Nov 23, 2026. Existing third-party dependencies used are:
- `@evenrealities/even_hub_sdk` (`0.0.16`) — official Even Hub WebView SDK
- `vite` (`6.2.0`) and `typescript` (`5.7.3`) — build tooling
- Hyperliquid public testnet Info API (`https://api.hyperliquid-testnet.xyz/info`)

## License
MIT — see [LICENSE](./LICENSE).
