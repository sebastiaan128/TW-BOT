// src/render.js
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

// Register one or more fonts so Skia can fall back per-glyph. Supports a
// `fonts` list of { path, family } or a single { fontPath, fontFamily }.
function registerFonts(cfg) {
  if (Array.isArray(cfg.fonts)) {
    for (const f of cfg.fonts) {
      if (f.path && existsSync(f.path)) GlobalFonts.registerFromPath(f.path, f.family);
    }
  } else if (cfg.fontPath && existsSync(cfg.fontPath)) {
    GlobalFonts.registerFromPath(cfg.fontPath, cfg.fontFamily);
  }
}

// Draw `text` centered at (x,y), shrinking the font until it fits maxWidth.
function drawAutoFit(ctx, text, { x, y, maxWidth, color, baseFontSize }, fontFamily, fontWeight) {
  ctx.fillStyle = color;
  let size = baseFontSize;
  const setFont = (s) => { ctx.font = `${fontWeight ?? 'bold'} ${s}px ${fontFamily}`; };
  setFont(size);
  while (ctx.measureText(text).width > maxWidth && size > 10) { size -= 2; setFont(size); }
  ctx.fillText(text, x, y);
}

// Full-res assets (~5504px) exceed the Discord upload limit. Render at full res
// for crisp text, then scale the composed image down to outputWidth (def 1600).
function finishCanvas(canvas, img, cfg) {
  const outputWidth = cfg.outputWidth ?? 1600;
  if (img.width > outputWidth) {
    const scale = outputWidth / img.width;
    const out = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out.toBuffer('image/png');
  }
  return canvas.toBuffer('image/png');
}

export async function renderUsername(type, username, renderConfig) {
  const cfg = renderConfig[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);
  registerFonts(cfg);

  const img = await loadImage(cfg.assetPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawAutoFit(ctx, username, {
    x: cfg.x, y: cfg.y, maxWidth: cfg.maxWidth, color: cfg.color, baseFontSize: cfg.baseFontSize,
  }, cfg.fontFamily, cfg.fontWeight);

  return finishCanvas(canvas, img, cfg);
}

// Draws multiple labelled fields onto an asset. `values` maps field.key ->
// string; `cfg.fields` is a list of { key, x, y, maxWidth, color, baseFontSize }.
export async function renderFields(type, values, renderConfig) {
  const cfg = renderConfig[type];
  if (!cfg) throw new Error(`Unknown render type: ${type}`);
  registerFonts(cfg);

  const img = await loadImage(cfg.assetPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const field of cfg.fields ?? []) {
    const text = String(values[field.key] ?? '');
    drawAutoFit(ctx, text, field, cfg.fontFamily, cfg.fontWeight);
  }

  return finishCanvas(canvas, img, cfg);
}
