import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
const images = new Map(), fonts = new Set();
function registerFonts(cfg) {
  for (const f of cfg.fonts ?? (cfg.fontPath ? [{ path: cfg.fontPath, family: cfg.fontFamily }] : [])) {
    const key = `${f.path}:${f.family}`;
    if (!fonts.has(key) && existsSync(f.path)) { GlobalFonts.registerFromPath(f.path, f.family); fonts.add(key); }
  }
}
async function image(path) {
  if (!images.has(path)) {
    if (images.size >= 8) images.delete(images.keys().next().value);
    images.set(path, loadImage(path).catch((e) => { images.delete(path); throw e; }));
  }
  return images.get(path);
}
function drawAutoFit(ctx, text, field, cfg, scale) {
  const { x, y, maxWidth, baseFontSize, color } = field;
  let size = baseFontSize * scale;
  const min = Math.max(8, (field.minFontSize ?? 10) * scale);
  const set = () => { ctx.font = `${cfg.fontWeight ?? 'bold'} ${size}px ${cfg.fontFamily ?? 'sans-serif'}`; };
  set();
  while (ctx.measureText(text).width > maxWidth * scale && size > min) { size = Math.max(min, size - 1); set(); }
  const chars = Array.from(text);
  if (ctx.measureText(text).width > maxWidth * scale) {
    while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth * scale) chars.pop();
    text = chars.join('') + '…';
  }
  ctx.fillStyle = color ?? '#ffffff';
  ctx.fillText(text, x * scale, y * scale, maxWidth * scale);
}
async function render(type, values, config, username = false) {
  const cfg = config[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);
  registerFonts(cfg);
  const img = await image(cfg.assetPath);
  const scale = Math.min(1, (cfg.outputWidth ?? 1600) / img.width);
  const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const label of cfg.labels ?? []) drawAutoFit(ctx, label.text, label, cfg, scale);
  for (const field of username ? [{ ...cfg, key: 'name' }] : cfg.fields ?? []) drawAutoFit(ctx, (field.format ?? '{value}').replace('{value}', String(values[field.key] ?? '')), field, cfg, scale);
  return canvas.toBuffer('image/png');
}
export function renderUsername(type, name, config) { return render(type, { name }, config, true); }
export function renderFields(type, values, config) { return render(type, values, config); }
