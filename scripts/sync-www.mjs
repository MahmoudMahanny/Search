#!/usr/bin/env node
/**
 * Copy static web assets into www/ for Capacitor Android packaging.
 * Source files stay at repo root for GitHub Pages; www/ is the app bundle.
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const www = join(root, 'www');
const vendorDir = join(www, 'vendor');
const xlsxSrc = join(root, 'node_modules/xlsx/dist/xlsx.full.min.js');

const files = [
  'index.html',
  'chassis.html',
  'history.html',
  'settings.html',
  'db.js',
  'theme.js',
  'theme.css',
  'data.json'
];

const optional = ['plates.txt.gz', 'android-version.json'];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const name of files) {
  cpSync(join(root, name), join(www, name));
}

for (const name of optional) {
  const src = join(root, name);
  if (existsSync(src)) cpSync(src, join(www, name));
}

mkdirSync(vendorDir, { recursive: true });
const vendorRoot = join(root, 'vendor');
mkdirSync(vendorRoot, { recursive: true });
if (existsSync(xlsxSrc)) {
  cpSync(xlsxSrc, join(vendorDir, 'xlsx.full.min.js'));
  cpSync(xlsxSrc, join(vendorRoot, 'xlsx.full.min.js'));
} else {
  console.warn('Warning: xlsx bundle missing — run npm install first');
}

console.log('Synced web assets → www/');
