#!/usr/bin/env node
/**
 * Copy static web assets into www/ for Capacitor Android packaging.
 * Source files stay at repo root for GitHub Pages; www/ is the app bundle.
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const www = join(root, 'www');

const files = [
  'index.html',
  'chassis.html',
  'history.html',
  'db.js',
  'data.json'
];

const optional = ['plates.txt.gz'];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const name of files) {
  cpSync(join(root, name), join(www, name));
}

for (const name of optional) {
  const src = join(root, name);
  if (existsSync(src)) cpSync(src, join(www, name));
}

console.log('Synced web assets → www/');
