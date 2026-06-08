// src/coc.js
import { withRetry } from './util.js';

const API_BASE = 'https://api.clashofclans.com/v1';
const TIER_BY_TOKEN = { I: 'I', '1': 'I', II: 'II', '2': 'II', III: 'III', '3': 'III' };

export function getTier(member) {
  const name = member?.league?.name;
  if (!name) return null;
  const m = name.match(/legend\s*league\s*(III|II|I|[123])/i);
  if (!m) return null;
  return TIER_BY_TOKEN[m[1].toUpperCase()] ?? null;
}
