import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { renderUsername, renderFields } from '../src/render.js';
const config = loadConfig(undefined, { requireSecrets: false });
await mkdir(config.outDir, { recursive: true });
for (const type of ['promoted', 'demoted', 'onestar']) {
  const buffer = type === 'onestar'
    ? await renderFields(type, { name: 'TW ✰ Sebastiaan', destruction: '79%', stars: '1' }, config.render)
    : await renderUsername(type, 'TW ✰ Sebastiaan', config.render);
  const path = join(config.outDir, `preview-${type}.png`);
  await writeFile(path, buffer);
  console.log(path);
}
