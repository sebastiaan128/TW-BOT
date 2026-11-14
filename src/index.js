import { pathToFileURL } from 'node:url';
import { runFeature } from './runtime.js';
export function run(options = {}, deps = {}) { return runFeature('movements', options, deps); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--force')) { console.error('--force is removed. Use npm run manage -- retry EVENT_ID after checking Discord.'); process.exitCode = 1; }
  else run({ dryRun: process.argv.includes('--dry-run'), markSeen: process.argv.includes('--mark-seen') }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
