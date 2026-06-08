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
  return canvas.toBuffer('image/png');
}
