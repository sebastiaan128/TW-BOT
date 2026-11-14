// Only these known endpoints may receive the CoC bearer token.
const ENDPOINTS = new Set([
  'https://api.clashofclans.com/v1',
  'https://cocproxy.royaleapi.dev/v1',
]);
export function cocApiBase(value = process.env.COC_API_BASE_URL ?? 'https://api.clashofclans.com/v1') {
  const base = typeof value === 'string' ? value.trim().replace(/\/$/, '') : '';
  if (!ENDPOINTS.has(base)) throw new Error('COC_API_BASE_URL must be https://api.clashofclans.com/v1 or https://cocproxy.royaleapi.dev/v1');
  return base;
}
