#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const platform = process.argv[2];
const BUILD_COMMANDS = {
  mac: 'electron-builder --mac',
  win: 'electron-builder --win',
  linux: 'electron-builder --linux',
};

if (!BUILD_COMMANDS[platform]) {
  console.error(`Usage: node scripts/release.js <mac|win|linux>`);
  process.exit(1);
}

console.log(`\nRunning build for ${platform}...\n`);
const child = spawn('npx', BUILD_COMMANDS[platform].split(' '), {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', code => process.exit(code));
