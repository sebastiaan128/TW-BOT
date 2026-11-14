import { pathToFileURL } from 'node:url';
import { loadConfig, loadEnv } from './config.js';
import { createRuntime, effectiveConfig } from './runtime.js';
import { adminAction } from './admin.js';
import { drainQueue } from './queue.js';
import { scanMovements, scanAttacks } from './service.js';
import { enqueueReports } from './reports.js';

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const args = { positional: [] };
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) { args.positional.push(rest[i]); continue; }
    const key = rest[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  return { command, args };
}
export async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseArgs(argv);
  if (command === 'help') return console.log(`TW-Bot beheer:
  validate                         controleer configuratie en assets
  status | queue [--status failed] gezondheid / wachtrij
  check [movements|attacks]         controleer en zet meldingen klaar
  preview [movements|attacks]       toon detectie zonder opgeslagen voortgang te wijzigen
  seed [movements|attacks]          leg beginstand vast zonder meldingen
  deliver                          verstuur wachtende meldingen binnen limieten
  ranking [--season ID] [--clan TAG] 1-ster-ranking
  seasons | player TAG             seizoenen / spelerstatistieken
  settings [--feature oneStar --enabled true|false]
  rules [--key oneStar.stars --value '[1]']
  retry EVENT_ID [--confirm]        herprobeer; onzeker vereist controle
  cancel EVENT_ID                  annuleer een melding
  resolve EVENT_ID --message-id ID --channel-id ID
  correct --tag TAG --name NAAM --type promoted --reset YYYY-MM-DD
  register-commands                registreer /tw in de ingestelde server
  summary [--reset YYYY-MM-DD]      weekoverzicht als tekst`);
  loadEnv();
  const readOnly = ['status', 'queue', 'ranking', 'seasons', 'player', 'summary'].includes(command);
  const config = loadConfig(undefined, { requireSecrets: !readOnly && command !== 'validate' });
  if (command === 'validate') return console.log('Configuratie en assets OK');
  const runtime = await createRuntime({ config, preview: command === 'preview' });
  try {
    let result;
    if (['check', 'preview', 'seed'].includes(command)) {
      const feature = args.positional[0] ?? 'movements';
      if (!['movements', 'attacks'].includes(feature)) throw new Error('Choose movements or attacks');
      result = await (feature === 'attacks' ? scanAttacks : scanMovements)(runtime.store, effectiveConfig(runtime.store, config), { preview: command === 'preview', markSeen: command === 'seed' });
      if (command !== 'preview') enqueueReports(runtime.store, config);
    } else if (command === 'deliver') result = await drainQueue(runtime.store, effectiveConfig(runtime.store, config));
    else if (command === 'register-commands') {
      const { registerCommands } = await import('./commands.js');
      result = await registerCommands(config);
    } else {
      if (args.enabled != null) {
        if (!['true', 'false'].includes(args.enabled)) throw new Error('--enabled must be true/false');
        args.enabled = args.enabled === 'true';
      }
      if (args.value != null) args.value = JSON.parse(args.value);
      args.id = args.positional[0]; args.tag ??= command === 'player' ? args.positional[0] : undefined;
      result = adminAction(runtime.store, config, command, args);
    }
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return result;
  } finally { runtime.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
