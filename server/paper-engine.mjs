import fs from "node:fs";
import path from "node:path";

/**
 * Local PAPER-ONLY trading ledger.
 * - Never touches real funds, wallets, or live exchange order endpoints.
 * - Flatten is strictly reduce-only: closes an existing paper position to 0, never flips side.
 */
export class PaperLedger {
  constructor(storagePath = null) {
    this.storagePath = storagePath;
    this.state = {
      mode: "PAPER",
      nextTicketNum: 1001,
      positions: {},
      tickets: [],
    };
    if (storagePath) {
      this._load();
    }
  }

  _load() {
    if (!fs.existsSync(this.storagePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.mode === "PAPER") {
        this.state = {
          mode: "PAPER",
          nextTicketNum: Number(parsed.nextTicketNum) || 1001,
          positions: parsed.positions || {},
          tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
        };
      }
    } catch {
      // Fall back to fresh paper state if file is corrupt
    }
  }

  _save() {
    if (!this.storagePath) return;
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getPosition(coin) {
    return this.state.positions[coin] || null;
  }

  listTickets(limit = 20) {
    return this.state.tickets.slice(0, limit);
  }

  /**
   * Compute unrealized PnL and ROE% against live testnet mark.
   */
  markPosition(coin, markPrice) {
    const pos = this.getPosition(coin);
    if (!pos) return null;
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      throw new Error("Invalid mark price");
    }
    const dir = pos.side === "LONG" ? 1 : -1;
    const notional = Math.abs(pos.size) * pos.entryPrice;
    const upnl = (markPrice - pos.entryPrice) * pos.size * dir;
    const roePct = notional > 0 ? (upnl / notional) * 100 : 0;
    return {
      ...pos,
      mode: "PAPER",
      markPrice,
      notionalUsd: Number(notional.toFixed(2)),
      upnlUsd: Number(upnl.toFixed(2)),
      roePct: Number(roePct.toFixed(2)),
    };
  }

  /**
   * Open or replace a demo PAPER position for testing the G2 glance + flatten loop.
   */
  openPaperPosition({ coin, side = "LONG", size, entryPrice }) {
    if (!coin || typeof coin !== "string") throw new Error("coin required");
    const normSide = side === "SHORT" ? "SHORT" : "LONG";
    const numSize = Number(size);
    const numEntry = Number(entryPrice);
    if (!Number.isFinite(numSize) || numSize <= 0) throw new Error("size must be > 0");
    if (!Number.isFinite(numEntry) || numEntry <= 0) throw new Error("entryPrice must be > 0");

    const pos = {
      coin,
      side: normSide,
      size: numSize,
      entryPrice: numEntry,
      openedAt: new Date().toISOString(),
      mode: "PAPER",
    };
    this.state.positions[coin] = pos;
    this._save();
    return pos;
  }

  /**
   * Strictly reduce-only PAPER flatten at the live Hyperliquid testnet mark price.
   * Rejects if no open position exists (never opens an opposite position).
   */
  flattenPosition({ coin, markPrice, trigger = "tap" }) {
    const pos = this.getPosition(coin);
    if (!pos || pos.size <= 0) {
      const err = new Error(`No open PAPER position in ${coin} to flatten.`);
      err.code = "ALREADY_FLAT";
      err.status = 409;
      throw err;
    }
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      const err = new Error("Valid live testnet markPrice is required to flatten.");
      err.code = "INVALID_MARK";
      err.status = 400;
      throw err;
    }

    const dir = pos.side === "LONG" ? 1 : -1;
    const realizedPnlUsd = Number(((markPrice - pos.entryPrice) * pos.size * dir).toFixed(2));
    const ticketId = `TF-${this.state.nextTicketNum++}`;
    const ticket = {
      ticketId,
      mode: "PAPER",
      action: "FLATTEN_REDUCE_ONLY",
      reduceOnly: true,
      coin,
      closedSide: pos.side,
      closedSize: pos.size,
      entryPrice: pos.entryPrice,
      fillPrice: markPrice,
      realizedPnlUsd,
      remainingSize: 0,
      trigger,
      executedAt: new Date().toISOString(),
    };

    delete this.state.positions[coin];
    this.state.tickets.unshift(ticket);
    if (this.state.tickets.length > 100) {
      this.state.tickets = this.state.tickets.slice(0, 100);
    }
    this._save();
    return ticket;
  }
}
