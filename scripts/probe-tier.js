import { main } from '../src/cli.js';
main(['check', 'movements']).catch((error) => { console.error(error.message); process.exitCode = 1; });
