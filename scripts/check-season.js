import { main } from '../src/cli.js';
main(['seasons']).catch((error) => { console.error(error.message); process.exitCode = 1; });
