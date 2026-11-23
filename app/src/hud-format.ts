export interface PaperPosition {
  coin: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  upnlUsd: number;
  roePct: number;
  mode: "PAPER";
}

export interface PaperTicket {
  ticketId: string;
  mode: "PAPER";
  action: string;
  reduceOnly: boolean;
  coin: string;
  closedSide: "LONG" | "SHORT";
  closedSize: number;
  entryPrice: number;
  fillPrice: number;
  realizedPnlUsd: number;
  remainingSize: number;
  trigger: string;
  executedAt: string;
}

export type HudView =
  | { kind: "loading"; coin: string }
  | { kind: "empty"; coin: string; markPrice: number; fetchedAt: string }
  | { kind: "glance"; coin: string; markPrice: number; fetchedAt: string; position: PaperPosition }
  | { kind: "confirm"; coin: string; markPrice: number; position: PaperPosition }
  | { kind: "ticket"; coin: string; ticket: PaperTicket }
  | { kind: "error"; coin: string; message: string };

function fmtPrice(p: number): string {
  if (p >= 1000) return `$${p.toFixed(2)}`;
  if (p >= 10) return `$${p.toFixed(3)}`;
  return `$${p.toFixed(4)}`;
}

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function fmtSignedPct(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

/**
 * Render concise, glanceable monochrome text tailored to the 576x288 G2 display.
 */
export function formatG2Hud(view: HudView): string {
  switch (view.kind) {
    case "loading":
      return [
        `TAPFLAT [PAPER]  ${view.coin}-PERP`,
        `------------------------------------`,
        `Fetching live Hyperliquid testnet...`,
        ``,
        `Mode: Read-only testnet + PAPER`,
      ].join("\n");

    case "empty":
      return [
        `TAPFLAT [PAPER]  ${view.coin}-PERP`,
        `HL Testnet Mark: ${fmtPrice(view.markPrice)}`,
        `------------------------------------`,
        `POSITION: FLAT (0 ${view.coin})`,
        ``,
        `[TAP / RING]  Open demo PAPER pos`,
        `[SCROLL]      Switch SOL / BTC / ETH`,
      ].join("\n");

    case "glance": {
      const p = view.position;
      return [
        `TAPFLAT [PAPER]  ${p.coin}-PERP`,
        `HL Testnet Mark: ${fmtPrice(view.markPrice)}`,
        `------------------------------------`,
        `${p.side} ${p.size} ${p.coin}  @ ${fmtPrice(p.entryPrice)}`,
        `uPnL: ${fmtSignedUsd(p.upnlUsd)} (${fmtSignedPct(p.roePct)})`,
        ``,
        `[TAP / RING]  Flatten PAPER (1-tap)`,
        `[SCROLL]      Switch SOL / BTC / ETH`,
      ].join("\n");
    }

    case "confirm": {
      const p = view.position;
      return [
        `CONFIRM REDUCE-ONLY [PAPER]`,
        `------------------------------------`,
        `Flatten ${p.side} ${p.size} ${p.coin}?`,
        `Live Testnet Mark: ${fmtPrice(view.markPrice)}`,
        `Est. Realized: ${fmtSignedUsd(p.upnlUsd)}`,
        ``,
        `[TAP / RING]    YES - FLATTEN NOW`,
        `[DOUBLE-CLICK]  NO  - CANCEL`,
      ].join("\n");
    }

    case "ticket": {
      const t = view.ticket;
      return [
        `PAPER TICKET ${t.ticketId}  [OK]`,
        `------------------------------------`,
        `FLATTENED ${t.closedSide} ${t.closedSize} ${t.coin}`,
        `Fill @ ${fmtPrice(t.fillPrice)} (Reduce-Only)`,
        `Realized: ${fmtSignedUsd(t.realizedPnlUsd)} | Rem: 0`,
        ``,
        `[TAP / RING]  Back to Glance`,
      ].join("\n");
    }

    case "error":
      return [
        `TAPFLAT [ERROR]  ${view.coin}-PERP`,
        `------------------------------------`,
        `${view.message.slice(0, 96)}`,
        ``,
        `No real funds touched (PAPER mode).`,
        `[TAP / RING]  Retry live testnet`,
      ].join("\n");
  }
}
