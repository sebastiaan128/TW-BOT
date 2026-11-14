import { createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { adminAction } from './admin.js';
import { discordRequest } from './discord.js';

const opt = (name, description, type = 3, required = false, choices) => ({ name, description, type, required, ...(choices ? { choices: choices.map((v) => ({ name: v, value: v })) } : {}) });
const sub = (name, description, options = []) => ({ name, description, type: 1, options });
export const commandDefinition = {
  name: 'tw', description: 'TW rankings, statistieken en botbeheer', type: 1,
  options: [
    sub('ranking', '1-ster-ranking per seizoen', [opt('season', 'Seizoens-ID'), opt('clan', '#clantag')]),
    sub('player', 'Statistieken van een speler', [opt('tag', '#spelertag', 3, true), opt('season', 'Seizoens-ID')]),
    sub('seasons', 'Huidig en opgeslagen seizoenen'), sub('status', 'Gezondheid van de bot'),
    sub('queue', 'Wachtende of mislukte meldingen', [opt('status', 'Berichtstatus', 3, false, ['pending', 'failed', 'uncertain', 'sent'])]),
    sub('settings', 'Functie aan of uit zetten', [opt('feature', 'Functie', 3, false, ['movements', 'oneStar', 'summary', 'ranking']), opt('enabled', 'Inschakelen', 5)]),
    sub('rules', 'Meldingsregels aanpassen', [opt('key', 'Instelling', 3, false, ['oneStar.stars', 'oneStar.tiers', 'oneStar.minDestruction', 'oneStar.maxDestruction', 'oneStar.ignoredPlayers', 'delivery.maxPerRun', 'delivery.maxPerChannel', 'delivery.maxPerPlayer']), opt('value', 'Waarde als JSON, bijvoorbeeld [1]')]),
    sub('check', 'Start een controle', [opt('feature', 'Functie', 3, true, ['movements', 'attacks'])]),
    sub('retry', 'Herprobeer na controle van Discord', [opt('id', 'Volledig event-ID', 3, true), opt('confirm', 'Onzekere verzending gecontroleerd', 5)]),
    sub('cancel', 'Annuleer een melding', [opt('id', 'Volledig event-ID', 3, true)]),
    sub('summary', 'Weekoverzicht van promoties/degradaties'),
  ],
};
export async function registerCommands(config, deps = {}) {
  if (!config.commands.enabled) throw new Error('Enable commands and configure application ID/public key first');
  // POST upserts only our command by name; never bulk-delete other commands.
  return discordRequest(`/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${config.commands.guildId}/commands`, config.botToken,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commandDefinition) }, deps);
}
export function verifySignature(raw, signature, timestamp, publicKey, now = Date.now()) {
  if (!/^[a-f\d]{128}$/i.test(signature ?? '') || !/^\d+$/.test(timestamp ?? '') || Math.abs(now - Number(timestamp) * 1000) > 300000) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), raw]), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}
export function executeInteraction(interaction, store, config, { onCheck = () => {}, applicationId = process.env.DISCORD_APPLICATION_ID } = {}) {
  if (interaction.type === 1) return { type: 1 };
  const respond = (content) => ({ type: 4, data: { content: String(content).slice(0, 1990), flags: 64, allowed_mentions: { parse: [] } } });
  if (interaction.application_id !== applicationId || interaction.guild_id !== config.commands.guildId || interaction.type !== 2 || interaction.data?.name !== 'tw') return respond('Deze opdracht is hier niet beschikbaar.');
  const command = interaction.data.options?.[0];
  if (!command) return respond('Opdracht ontbreekt.');
  const publicCommands = ['ranking', 'player', 'seasons', 'summary'];
  const permissions = /^\d+$/.test(interaction.member?.permissions ?? '') ? BigInt(interaction.member.permissions) : 0n;
  if (!publicCommands.includes(command.name) && !(permissions & (8n | 32n))) return respond('Alleen beheerders met Server beheren mogen deze opdracht uitvoeren.');
  const now = Date.now();
  const uid = interaction.member?.user?.id;
  if (!uid || !/^\d+$/.test(interaction.id ?? '')) return respond('Ongeldige opdracht.');
  const previous = store.get(`interaction:${interaction.id}`);
  if (previous) return previous.response;
  const recent = store.get(`commandRate:${uid}`, { at: now, count: 0 });
  const rate = now - recent.at < 60000 ? recent : { at: now, count: 0 };
  if (rate.count >= 20) return respond('Even wachten: maximaal 20 opdrachten per minuut.');
  store.set(`commandRate:${uid}`, { ...rate, count: rate.count + 1 });
  const args = Object.fromEntries((command.options ?? []).map((v) => [v.name, v.value]));
  let response;
  try {
    if (command.name === 'check') {
      if (!['movements', 'attacks'].includes(args.feature)) throw new Error('Kies movements of attacks');
      onCheck(args.feature);
      response = respond('Controle aangevraagd. Bekijk /tw status voor het resultaat.');
    } else {
      if (command.name === 'rules' && args.value != null) args.value = JSON.parse(args.value);
      const result = adminAction(store, config, command.name, args, `discord:${uid}`);
      response = respond(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
  } catch (error) { response = respond(error.message); }
  store.set(`interaction:${interaction.id}`, { response, at: now });
  // Bounded replay/rate bookkeeping; no user tokens are persisted.
  store.db.prepare("DELETE FROM state WHERE (key LIKE 'interaction:%' OR key LIKE 'commandRate:%') AND json_extract(value,'$.at')<?").run(now - 86400000);
  return response;
}
export function startCommandServer(store, config, options = {}) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/interactions') { res.writeHead(404).end(); return; }
    const chunks = []; let length = 0;
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 65536) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'], options.publicKey ?? process.env.DISCORD_PUBLIC_KEY)) { res.writeHead(401).end(); return; }
      const payload = executeInteraction(JSON.parse(raw.toString()), store, config, options);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(payload));
    } catch { if (!res.headersSent) res.writeHead(400).end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.listen(config.commands.port, config.commands.host);
  return server;
}
