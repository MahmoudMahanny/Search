#!/usr/bin/env node
/**
 * Generate Android launcher icons from the in-app لمّاح eye brand mark.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = join(import.meta.dirname, '..');
const res = join(root, 'android/app/src/main/res');

/** Full brand mark (matches index.html .brand-logo) */
const brandSvg = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f3d47c"/>
      <stop offset="1" stop-color="#b8892a"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#g)"/>
  <path d="M12 34c7-13 33-13 40 0-7 13-33 13-40 0Z" fill="#0e2b1c"/>
  <circle cx="32" cy="34" r="7.5" fill="url(#g)"/>
  <circle cx="32" cy="34" r="3" fill="#0e2b1c"/>
  <path d="M47 12l2.2 5 5 2.2-5 2.2-2.2 5-2.2-5-5-2.2 5-2.2 2.2-5Z" fill="#fff7e0"/>
</svg>`;

/**
 * Adaptive foreground: same mark inset into the 108dp safe zone
 * (logo occupies ~66% of the canvas so circular/squircle masks look good).
 */
const foregroundSvg = (size) => {
  const pad = size * 0.17;
  const inner = size - pad * 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${pad},${pad}) scale(${inner / 64})">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#f3d47c"/>
        <stop offset="1" stop-color="#b8892a"/>
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#g)"/>
    <path d="M12 34c7-13 33-13 40 0-7 13-33 13-40 0Z" fill="#0e2b1c"/>
    <circle cx="32" cy="34" r="7.5" fill="url(#g)"/>
    <circle cx="32" cy="34" r="3" fill="#0e2b1c"/>
    <path d="M47 12l2.2 5 5 2.2-5 2.2-2.2 5-2.2-5-5-2.2 5-2.2 2.2-5Z" fill="#fff7e0"/>
  </g>
</svg>`;
};

const densities = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const fgDensities = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

async function pngFromSvg(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

async function main() {
  for (const [dir, size] of Object.entries(densities)) {
    const outDir = join(res, dir);
    mkdirSync(outDir, { recursive: true });
    const icon = await pngFromSvg(brandSvg(size), size);
    writeFileSync(join(outDir, 'ic_launcher.png'), icon);
    writeFileSync(join(outDir, 'ic_launcher_round.png'), icon);
    console.log('wrote', dir, 'launcher', size);
  }

  for (const [dir, size] of Object.entries(fgDensities)) {
    const outDir = join(res, dir);
    mkdirSync(outDir, { recursive: true });
    const fg = await pngFromSvg(foregroundSvg(size), size);
    writeFileSync(join(outDir, 'ic_launcher_foreground.png'), fg);
    console.log('wrote', dir, 'foreground', size);
  }

  // Master asset for docs / future tooling
  const assets = join(root, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, 'lammah-icon.svg'), brandSvg(512));
  const master = await pngFromSvg(brandSvg(512), 512);
  writeFileSync(join(assets, 'lammah-icon.png'), master);
  console.log('wrote assets/lammah-icon.{svg,png}');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
