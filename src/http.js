// Timeout covers headers and body. Unsafe POSTs only retry explicit 429s.
export class HttpError extends Error {
  constructor(status, message, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.retryable = status === 429 || status >= 500;
  }
}
export async function requestJson(url, options = {}, {
  fetchImpl = fetch, timeoutMs = 15000, retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const safe = ['GET', 'PUT', 'DELETE'].includes(options.method ?? 'GET');
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const res = await fetchImpl(url, { ...options, signal: controller.signal });
          if (!res.ok) {
            const body = await Promise.resolve().then(() => res.json()).catch(() => ({}));
            const seconds = Number(body.retry_after ?? res.headers?.get('retry-after'));
            throw new HttpError(res.status, `HTTP ${res.status}: ${body.message ?? body.reason ?? 'request failed'}`,
              Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0);
          }
          return res.status === 204 ? null : res.json();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Request timed out')); }, timeoutMs);
        }),
      ]);
    } catch (error) {
      const retryable = error instanceof HttpError ? (error.status === 429 || (safe && error.status >= 500)) : safe;
      const delay = Math.max(error.retryAfterMs ?? 0, 300 * 2 ** attempt);
      if (!retryable || attempt >= retries || delay > 30000) throw error;
      clearTimeout(timer);
      await sleep(delay);
    } finally { clearTimeout(timer); }
  }
}
