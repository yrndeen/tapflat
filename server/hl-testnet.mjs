export const HYPERLIQUID_TESTNET_INFO_URL = "https://api.hyperliquid-testnet.xyz/info";
export const SUPPORTED_COINS = ["SOL", "BTC", "ETH"];

/**
 * Hard safety guard: never allow Hyperliquid mainnet URLs.
 */
export function assertTestnetInfoUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Hyperliquid Info URL: ${url}`);
  }
  if (parsed.hostname === "api.hyperliquid.xyz" || parsed.hostname !== "api.hyperliquid-testnet.xyz") {
    throw new Error(`Mainnet or unauthorized host blocked: ${parsed.hostname}. Only api.hyperliquid-testnet.xyz is allowed.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`HTTPS required for Hyperliquid testnet info API.`);
  }
  return parsed.toString();
}

/**
 * Fetch live mid prices from official Hyperliquid testnet public Info API.
 * Strictly read-only, no API keys, no wallet signing.
 */
export async function fetchTestnetMids({
  url = HYPERLIQUID_TESTNET_INFO_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
} = {}) {
  const safeUrl = assertTestnetInfoUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(safeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Hyperliquid testnet returned HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || typeof data !== "object") {
      throw new Error("Malformed allMids response from Hyperliquid testnet");
    }
    const mids = {};
    for (const coin of SUPPORTED_COINS) {
      const raw = data[coin];
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) {
        mids[coin] = num;
      }
    }
    if (Object.keys(mids).length === 0) {
      throw new Error("Hyperliquid testnet allMids missing SOL/BTC/ETH prices");
    }
    return {
      source: "hyperliquid-testnet",
      endpoint: safeUrl,
      fetchedAt: new Date().toISOString(),
      mids,
    };
  } finally {
    clearTimeout(timer);
  }
}
