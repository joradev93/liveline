/**
 * Builds docs/demo.gif from the frames of record-demo.mjs. Pure JS (no ffmpeg):
 * frames are resampled to a fixed frame rate by their real timestamps, decoded with jpeg-js and
 * encoded with gifenc using one shared palette. Pixels that did not change since the previous
 * frame are written as transparent, which keeps the file small (most of the screen is static).
 *
 *   node e2e/make-gif.mjs [fps] [colors]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import jpeg from 'jpeg-js';

const { applyPalette, GIFEncoder, quantize } = gifenc;

const fps = Number(process.argv[2] ?? 8);
const dir = new URL('./results/demo/', import.meta.url).pathname;
const frames = JSON.parse(readFileSync(`${dir}frames.json`, 'utf8'));
if (frames.length === 0) throw new Error('no frames: run record-demo.mjs first');

// Pick the latest frame at or before each tick of the output clock.
const start = frames[0].t;
const end = frames.at(-1).t;
const picks = [];
for (let t = start, i = 0; t <= end; t += 1 / fps) {
  while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
  picks.push(frames[i].file);
}

const decode = (file) => jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true });
const first = decode(picks[0]);
const { width, height } = first;

// Shared palette from a few frames spread over the recording.
const sample = [0, 0.3, 0.6, 0.9].map(
  (p) => decode(picks[Math.floor(p * (picks.length - 1))]).data,
);
const merged = new Uint8Array(sample.reduce((n, d) => n + d.length, 0));
let offset = 0;
for (const d of sample) {
  merged.set(d, offset);
  offset += d.length;
}
const palette = quantize(merged, Number(process.argv[3] ?? 96));
const transparentIndex = palette.length;
palette.push([0, 0, 0]); // reserved: "same as previous frame"

const gif = GIFEncoder();
let shown = null; // palette indices currently on screen
let last = { file: null, indices: null };
for (const file of picks) {
  const indices =
    file === last.file
      ? last.indices
      : applyPalette(decode(file).data, palette.slice(0, transparentIndex));
  last = { file, indices };
  const frame = new Uint8Array(indices);
  if (shown)
    for (let i = 0; i < frame.length; i++) if (frame[i] === shown[i]) frame[i] = transparentIndex;
  gif.writeFrame(frame, width, height, {
    palette,
    delay: Math.round(1000 / fps),
    transparent: shown !== null,
    transparentIndex,
    dispose: 1, // keep the previous frame; transparent pixels show it
  });
  shown = indices;
}
gif.finish();
const out = new URL('../docs/demo.gif', import.meta.url).pathname;
writeFileSync(out, gif.bytes());
console.log(
  `${picks.length} frames, ${width}x${height}, ${fps} fps -> ${out} (${(gif.bytes().length / 1048576).toFixed(1)} MB)`,
);
