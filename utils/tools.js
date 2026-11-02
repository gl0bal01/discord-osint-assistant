/**
 * File: utils/tools.js
 * Description: Detect whether a command's external CLI tool is installed.
 *
 * Commands that shell out export `requiresTool: [candidate, ...]`. A candidate
 * containing "/" is a path to an executable file; anything else is looked up on PATH. A command is
 * available when any candidate exists, so the lean Docker image (no tools) hides
 * the commands it can't run instead of registering them.
 */

const fs = require('node:fs');
const path = require('node:path');

function isExecutable(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
    } catch { return false; }
}

function isToolAvailable(candidates = []) {
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    return candidates.some(c => (c.includes('/') ? isExecutable(c) : dirs.some(d => isExecutable(path.join(d, c)))));
}

module.exports = { isToolAvailable };
