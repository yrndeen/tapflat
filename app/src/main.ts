import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { formatG2Hud, type HudView, type PaperPosition, type PaperTicket } from "./hud-format";

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE || "http://127.0.0.1:8787";
const COINS = ["SOL", "BTC", "ETH"] as const;
const CONTAINER_ID = 1;
const CONTAINER_NAME = "tapflat-hud";

let coinIndex = 0;
let currentView: HudView = { kind: "loading", coin: COINS[coinIndex] };
let recentTickets: PaperTicket[] = [];
let bridge: EvenAppBridge | null = null;
let bridgeInitialized = false;
let busy = false;
let forceErrorOnce = false;

const $screen = document.getElementById("g2Screen") as HTMLPreElement;
const $stateBadge = document.getElementById("viewStateBadge") as HTMLSpanElement;
const $bridgeStatus = document.getElementById("bridgeStatus") as HTMLDivElement;
const $ticketLog = document.getElementById("ticketLog") as HTMLDivElement;
const $voiceHint = document.getElementById("voiceHint") as HTMLParagraphElement;

function activeCoin(): string {
  return COINS[coinIndex];
}

async function pushToG2(content: string): Promise<void> {
  $screen.textContent = content;
  $stateBadge.textContent = `STATE: ${currentView.kind.toUpperCase()}`;

  if (!bridge) return;
  try {
    if (!bridgeInitialized) {
      await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [
            new TextContainerProperty({
              containerID: CONTAINER_ID,
              containerName: CONTAINER_NAME,
              xPosition: 0,
              yPosition: 0,
              width: 576,
              height: 288,
              paddingLength: 10,
              isEventCapture: 1,
              content,
            }),
          ],
        })
      );
      bridgeInitialized = true;
    } else {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER_ID,
          containerName: CONTAINER_NAME,
          contentOffset: 0,
          contentLength: content.length,
          content,
        })
      );
    }
  } catch {
    // Keep browser preview functional even outside G2 WebView
  }
}

function renderTickets(): void {
  if (!recentTickets.length) {
    $ticketLog.textContent = "No paper flatten tickets yet.";
    return;
  }
  $ticketLog.innerHTML = recentTickets
    .map(
      (t) =>
        `<div class="ticket-item"><strong>${t.ticketId}</strong> [${t.mode} · Reduce-Only] ` +
        `Closed ${t.closedSide} ${t.closedSize} ${t.coin} @ $${t.fillPrice} ` +
        `| Realized: ${t.realizedPnlUsd >= 0 ? "+" : "-"}$${Math.abs(t.realizedPnlUsd).toFixed(2)} ` +
        `| Trigger: ${t.trigger}</div>`
    )
    .join("");
}

async function setView(view: HudView): Promise<void> {
  currentView = view;
  await pushToG2(formatG2Hud(view));
  renderTickets();
}

async function fetchGlance(force = false): Promise<void> {
  const coin = activeCoin();
  if (busy) return;
  busy = true;
  try {
    await setView({ kind: "loading", coin });
    if (forceErrorOnce) {
      forceErrorOnce = false;
      throw new Error("Simulated backend/testnet outage (click to retry)");
    }
    const res = await fetch(`${API_BASE}/api/glance?coin=${encodeURIComponent(coin)}${force ? "&force=1" : ""}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Backend HTTP ${res.status}`);
    }
    recentTickets = Array.isArray(data.recentTickets) ? data.recentTickets : [];
    const pos: PaperPosition | null = data.position || null;
    if (!pos) {
      await setView({ kind: "empty", coin, markPrice: data.markPrice, fetchedAt: data.fetchedAt });
    } else {
      await setView({ kind: "glance", coin, markPrice: data.markPrice, fetchedAt: data.fetchedAt, position: pos });
    }
  } catch (err) {
    await setView({
      kind: "error",
      coin,
      message: err instanceof Error ? err.message : "Failed to reach local Tapflat server",
    });
  } finally {
    busy = false;
  }
}

async function executePaperFlatten(trigger: string): Promise<void> {
  const coin = activeCoin();
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(`${API_BASE}/api/paper/flatten`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin, trigger }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Flatten failed (${res.status})`);
    }
    const ticket: PaperTicket = data.ticket;
    recentTickets = [ticket, ...recentTickets].slice(0, 5);
    await setView({ kind: "ticket", coin, ticket });
  } catch (err) {
    await setView({
      kind: "error",
      coin,
      message: err instanceof Error ? err.message : "Paper flatten failed",
    });
  } finally {
    busy = false;
  }
}

async function openDemoPaperPosition(): Promise<void> {
  const coin = activeCoin();
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(`${API_BASE}/api/paper/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coin, side: "LONG" }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Open demo paper position failed (${res.status})`);
    }
    busy = false;
    await fetchGlance(true);
  } catch (err) {
    busy = false;
    await setView({
      kind: "error",
      coin,
      message: err instanceof Error ? err.message : "Open demo position failed",
    });
  }
}

async function handleAction(action: "click" | "double_click" | "scroll_prev" | "scroll_next", trigger = "tap"): Promise<void> {
  if (busy) return;

  if (action === "scroll_prev") {
    coinIndex = (coinIndex - 1 + COINS.length) % COINS.length;
    await fetchGlance(false);
    return;
  }
  if (action === "scroll_next") {
    coinIndex = (coinIndex + 1) % COINS.length;
    await fetchGlance(false);
    return;
  }

  if (action === "double_click") {
    if (currentView.kind === "confirm" || currentView.kind === "ticket" || currentView.kind === "error") {
      await fetchGlance(false);
    }
    return;
  }

  // Primary single click / R1 ring tap
  switch (currentView.kind) {
    case "glance":
      await setView({
        kind: "confirm",
        coin: currentView.coin,
        markPrice: currentView.markPrice,
        position: currentView.position,
      });
      return;
    case "confirm":
      await executePaperFlatten(trigger);
      return;
    case "empty":
      await openDemoPaperPosition();
      return;
    case "ticket":
    case "error":
      await fetchGlance(true);
      return;
    case "loading":
      return;
  }
}

function handleEvenHubEvent(event: EvenHubEvent): void {
  const rawType = event.textEvent?.eventType ?? event.sysEvent?.eventType ?? event.listEvent?.eventType;
  if (rawType === OsEventTypeList.CLICK_EVENT) {
    void handleAction("click", "g2-ring");
  } else if (rawType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void handleAction("double_click", "g2-ring");
  } else if (rawType === OsEventTypeList.SCROLL_TOP_EVENT) {
    void handleAction("scroll_prev", "g2-scroll");
  } else if (rawType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    void handleAction("scroll_next", "g2-scroll");
  }
}

async function initBridge(): Promise<void> {
  // Detect Even Hub WebView bridge with a fast timeout so local browser preview never stalls
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200));
  const detected = await Promise.race([waitForEvenAppBridge().catch(() => null), timeout]);
  if (detected) {
    bridge = detected;
    $bridgeStatus.textContent = "G2 Bridge: Connected (Even Hub SDK 0.0.16)";
    bridge.onEvenHubEvent(handleEvenHubEvent);
  } else {
    $bridgeStatus.textContent = "G2 Bridge: Browser / Simulator Preview Mode";
  }
}

function triggerVoiceKeyword(): void {
  const SpeechRec =
    (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

  if (!SpeechRec) {
    // Free local fallback: trigger the "flatten" voice keyword flow directly if Web Speech isn't available
    if (currentView.kind === "glance") {
      $voiceHint.textContent = 'Voice keyword "flatten" recognized (local fallback) — confirm with one tap.';
      void handleAction("click", "voice");
    } else if (currentView.kind === "confirm") {
      $voiceHint.textContent = 'Voice confirm "flatten" — submitting PAPER reduce-only flatten.';
      void handleAction("click", "voice");
    } else {
      $voiceHint.textContent = 'Voice keyword "flatten" is active when a paper position is open.';
    }
    return;
  }

  const rec = new SpeechRec();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  $voiceHint.textContent = 'Listening locally via Web Speech API — say "flatten"...';
  rec.onresult = (e: any) => {
    const transcript = String(e.results?.[0]?.[0]?.transcript || "").toLowerCase();
    $voiceHint.textContent = `Heard: "${transcript}"`;
    if (transcript.includes("flatten") || transcript.includes("yes")) {
      void handleAction("click", "voice");
    } else if (transcript.includes("cancel") || transcript.includes("no")) {
      void handleAction("double_click", "voice");
    }
  };
  rec.onerror = () => {
    $voiceHint.textContent = "Browser speech unavailable in headless/offline mode; use R1 Ring / Tap.";
  };
  rec.start();
}

// Wire preview / simulator buttons
document.getElementById("btnClick")?.addEventListener("click", () => void handleAction("click", "tap"));
document.getElementById("btnDoubleClick")?.addEventListener("click", () => void handleAction("double_click", "tap"));
document.getElementById("btnScrollPrev")?.addEventListener("click", () => void handleAction("scroll_prev", "scroll"));
document.getElementById("btnScrollNext")?.addEventListener("click", () => void handleAction("scroll_next", "scroll"));
document.getElementById("btnRefresh")?.addEventListener("click", () => void fetchGlance(true));
document.getElementById("btnVoice")?.addEventListener("click", () => triggerVoiceKeyword());
document.getElementById("btnSimError")?.addEventListener("click", () => {
  forceErrorOnce = true;
  void fetchGlance(true);
});

// Boot
void (async () => {
  await initBridge();
  await fetchGlance(false);
})();
