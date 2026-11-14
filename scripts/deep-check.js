import { main } from '../src/cli.js';
main(['status']).catch((error) => { console.error(error.message); process.exitCode = 1; });
