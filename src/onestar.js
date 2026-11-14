import { pathToFileURL } from 'node:url';
import { runFeature } from './runtime.js';
export function run(options = {}, deps = {}) { return runFeature('oneStar', options, deps); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ dryRun: process.argv.includes('--dry-run'), markSeen: process.argv.includes('--mark-seen') }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
