const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const REPORTS_DIR = path.join(TEMP_DIR, 'reports');

function ensureTempDir() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    return TEMP_DIR;
}

function ensureReportsDir() {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    return REPORTS_DIR;
}

function tempFilePath(prefix, extension = 'txt') {
    ensureTempDir();
    const randomId = crypto.randomBytes(8).toString('hex');
    return path.join(TEMP_DIR, `${prefix}_${randomId}.${extension}`);
}

/**
 * Generate a standardized report file path under temp/reports/.
 * All CLI-based commands should use this for their output files.
 * @param {string} command - Command name (e.g. 'sherlock', 'nuclei')
 * @param {string} extension - File extension without dot (default: 'txt')
 * @returns {string} Absolute file path
 */
function reportFilePath(command, extension = 'txt') {
    ensureReportsDir();
    const randomId = crypto.randomBytes(4).toString('hex');
    const timestamp = Date.now();
    return path.join(REPORTS_DIR, `${command}_${timestamp}_${randomId}.${extension}`);
}

/**
 * Generate a standardized report directory path under temp/reports/.
 * For commands that produce multiple files per run.
 * @param {string} command - Command name (e.g. 'linkook', 'ghunt')
 * @returns {string} Absolute directory path
 */
function reportDirPath(command) {
    ensureReportsDir();
    const randomId = crypto.randomBytes(4).toString('hex');
    const timestamp = Date.now();
    const dir = path.join(REPORTS_DIR, `${command}_${timestamp}_${randomId}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function cleanupFile(filePath, delay = 0) {
    const doCleanup = async () => {
        try { await fsp.unlink(filePath); } catch { /* file already removed */ }
    };
    if (delay > 0) {
        setTimeout(doCleanup, delay);
    } else {
        await doCleanup();
    }
}

async function cleanupDir(dirPath, delay = 0) {
    const doCleanup = async () => {
        try { await fsp.rm(dirPath, { recursive: true, force: true }); } catch { /* directory already removed */ }
    };
    if (delay > 0) {
        setTimeout(doCleanup, delay);
    } else {
        await doCleanup();
    }
}

module.exports = {
    ensureTempDir,
    ensureReportsDir,
    tempFilePath,
    reportFilePath,
    reportDirPath,
    cleanupFile,
    cleanupDir,
    TEMP_DIR,
    REPORTS_DIR
};
