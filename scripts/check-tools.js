#!/usr/bin/env node
// Fails when a CLI-backed command would be hidden because its tool is missing.
// CI runs it inside the full image: every command there must load.
const path = require('node:path');
const { loadCommands } = require('../utils/bootstrap');

const { stats } = loadCommands(path.join(__dirname, '..', 'commands'));
if (stats.failed || stats.missingTool.length) {
    console.error(`missing tools: ${stats.missingTool.join(', ') || 'none'}; failed to load: ${stats.failed}`);
    process.exit(1);
}
console.log(`all ${stats.loaded} commands load, no tool missing`);
