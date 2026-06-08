// src/util.js
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await wait(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}
