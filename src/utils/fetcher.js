/**
 * Robust fetch utility with automatic fallback through multiple public CORS proxies.
 *
 * Strategy:
 *  1. Try direct fetch (works if server sends CORS headers, e.g. tenant.goprisma.com)
 *  2. Try Vite local dev proxy at /api/proxy (only available during `npm run dev`)
 *  3. Race multiple public CORS proxy services — first success wins
 *
 * Known-CORS-blocked origins are cached in memory so subsequent polls skip
 * the slow 8-second direct attempt and go straight to proxies.
 */

// In-memory set of origins confirmed to block CORS — avoids wasting 8s per poll cycle
const corsBlockedOrigins = new Set();

/** Multiple public CORS proxy builders, tried in race */
const PUBLIC_PROXY_BUILDERS = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://proxy.cors.sh/${url}`,
];

/**
 * Perform a GET request via a single proxy URL.
 * Returns { text, proxyIndex } on success, throws on failure.
 */
async function tryProxy(url, proxyBuilder, proxyIndex, timeoutMs = 12000) {
  const proxyUrl = proxyBuilder(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    const rawText = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: rawText, proxyIndex };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Race all configured public CORS proxies and return the first that succeeds.
 * Throws only if ALL proxies fail.
 */
async function tryPublicProxies(url) {
  const results = await Promise.allSettled(
    PUBLIC_PROXY_BUILDERS.map((builder, idx) => tryProxy(url, builder, idx))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      return { text: result.value.text, viaProxy: 'public' };
    }
  }

  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message)
    .join('; ');
  throw new Error(`All public CORS proxies failed: ${errors}`);
}

/**
 * Main export. Fetch URL with automatic CORS-bypass fallback.
 */
export async function fetchWithFallback(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const origin = (() => {
    try { return new URL(url).origin; } catch { return url; }
  })();

  // 1. Try direct fetch (skip entirely if we already know this origin blocks CORS)
  if (!corsBlockedOrigins.has(origin)) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const rawText = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText || 'Endpoint returned error'}`);
      return { text: rawText, viaProxy: false };
    } catch (directErr) {
      const isCorsOrNetwork =
        directErr.name === 'AbortError' ||
        directErr.name === 'TypeError' ||
        directErr.message?.toLowerCase().includes('failed to fetch') ||
        directErr.message?.toLowerCase().includes('cors') ||
        directErr.message?.toLowerCase().includes('networkerror');

      // Hard HTTP errors (4xx/5xx) from the server — don't bother proxying
      if (!isCorsOrNetwork && directErr.message?.startsWith('HTTP ')) throw directErr;

      // Remember this origin blocks CORS so future poll cycles are fast
      corsBlockedOrigins.add(origin);
      console.warn(`[fetcher] Direct fetch blocked for "${origin}". Will skip direct attempts from now on.`);
    }
  }

  // 2. Try Netlify Function proxy (/.netlify/functions/proxy) — works in Netlify production
  try {
    const netlifyProxyUrl = `/.netlify/functions/proxy?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(netlifyProxyUrl, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    const rawText = await res.text();
    const ct = res.headers.get('content-type') || '';
    // Guard: if response is HTML it means we hit a 404/catch-all page — skip
    const isHtml = ct.includes('text/html') || rawText.trimStart().startsWith('<!');
    if (res.ok && !isHtml) return { text: rawText, viaProxy: 'netlify' };
  } catch {
    // Not on Netlify or function not deployed — fall through
  }

  // 3. Try Vite dev-server proxy (only available during local `npm run dev`)
  try {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(proxyUrl, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    const rawText = await res.text();
    const ct = res.headers.get('content-type') || '';
    // Guard: Netlify/any static host returns index.html (text/html, 200 OK) for unknown paths
    const isHtml = ct.includes('text/html') || rawText.trimStart().startsWith('<!');
    if (res.ok && !isHtml) return { text: rawText, viaProxy: 'local' };
  } catch {
    // Silently fall through to public proxies — expected in production
  }

  // 3. Race public CORS proxies
  return tryPublicProxies(url);
}
