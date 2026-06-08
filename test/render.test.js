// test/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderUsername } from '../src/render.js';

const DIR = 'test/tmp-render';
const ASSET = `${DIR}/fixture.png`;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function setup() {
  mkdirSync(DIR, { recursive: true });
  const c = createCanvas(400, 200);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 200);
  writeFileSync(ASSET, c.toBuffer('image/png'));
}

const cfg = {
  promoted: { assetPath: ASSET, x: 200, y: 100, maxWidth: 380, color: '#000000', fontFamily: 'sans-serif', fontWeight: 'bold', baseFontSize: 40 },
};

test('renderUsername returns a PNG buffer', async () => {
  setup();
  const buf = await renderUsername('promoted', 'Sebastiaan', cfg);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.subarray(0, 4).equals(PNG_SIG));
  rmSync(DIR, { recursive: true, force: true });
});

test('renderUsername fits very long names without throwing', async () => {
  setup();
  const buf = await renderUsername('promoted', 'EenHeelErgLangeGebruikersnaamXYZ', cfg);
  assert.ok(buf.subarray(0, 4).equals(PNG_SIG));
  rmSync(DIR, { recursive: true, force: true });
});

test('renderUsername throws on unknown type', async () => {
  setup();
  await assert.rejects(() => renderUsername('bogus', 'X', cfg), /Unknown render type/);
  rmSync(DIR, { recursive: true, force: true });
});

// A PNG stores width/height as big-endian uint32 at byte offsets 16 and 20.
function pngWidth(buf) { return buf.readUInt32BE(16); }
function pngHeight(buf) { return buf.readUInt32BE(20); }

test('renderUsername downscales output to outputWidth, preserving aspect ratio', async () => {
  setup();
  const scaledCfg = { promoted: { ...cfg.promoted, outputWidth: 200 } };
  const buf = await renderUsername('promoted', 'X', scaledCfg);
  assert.equal(pngWidth(buf), 200);   // 400 -> 200
  assert.equal(pngHeight(buf), 100);  // 200 -> 100 (aspect preserved)
  rmSync(DIR, { recursive: true, force: true });
});

test('renderUsername does not upscale when asset is narrower than outputWidth', async () => {
  setup();
  const buf = await renderUsername('promoted', 'X', cfg); // 400px asset, default outputWidth 1600
  assert.equal(pngWidth(buf), 400);
  assert.equal(pngHeight(buf), 200);
  rmSync(DIR, { recursive: true, force: true });
});
