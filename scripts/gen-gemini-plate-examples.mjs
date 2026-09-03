#!/usr/bin/env node
/**
 * Build gemini-plate-examples.js — 1000 Saudi plate samples for Gemini system prompt.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const gz = readFileSync(join(root, 'plates.txt.gz'));
const lines = gunzipSync(gz).toString('utf8').trim().split('\n');

const plates = [];
const seen = new Set();
for (const line of lines) {
  const plate = String(line.split('|')[0] || '').trim();
  if (!/^[\u0621-\u064A]{3}\d{4}$/.test(plate)) continue;
  if (seen.has(plate)) continue;
  seen.add(plate);
  plates.push(plate);
  if (plates.length >= 1000) break;
}

if (plates.length < 1000) {
  console.warn('Warning: only found', plates.length, 'valid plates');
}

const out = `/* Auto-generated — ${plates.length} Saudi plate examples for Gemini Live */
(function () {
  window.LAMMAH_GEMINI_PLATE_SAMPLES = ${JSON.stringify(plates)};
})();
`;

writeFileSync(join(root, 'gemini-plate-examples.js'), out, 'utf8');
console.log('Wrote gemini-plate-examples.js with', plates.length, 'plates');
