// src/render.js
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

export async function renderUsername(type, username, renderConfig) {
  const cfg = renderConfig[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);

  if (cfg.fontPath && existsSync(cfg.fontPath)) {
    GlobalFonts.registerFromPath(cfg.fontPath, cfg.fontFamily);
  }

  const img = await loadImage(cfg.assetPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  ctx.fillStyle = cfg.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let fontSize = cfg.baseFontSize;
  const setFont = (s) => { ctx.font = `${cfg.fontWeight ?? 'bold'} ${s}px ${cfg.fontFamily}`; };
  setFont(fontSize);
  while (ctx.measureText(username).width > cfg.maxWidth && fontSize > 10) {
    fontSize -= 2;
    setFont(fontSize);
  }

  ctx.fillText(username, cfg.x, cfg.y);

  // Downscale for Discord: full-res assets (~5504px) exceed the webhook upload
  // limit. Render text at full res for crisp antialiasing, then scale the
  // composed image down to outputWidth before encoding.
  const outputWidth = cfg.outputWidth ?? 1600;
  if (img.width > outputWidth) {
    const scale = outputWidth / img.width;
    const out = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out.toBuffer('image/png');
  }
  return canvas.toBuffer('image/png');
}
