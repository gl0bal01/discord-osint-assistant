const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

function ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    return TEMP_DIR;
}

function tempFilePath(prefix, extension = 'txt') {
    ensureTempDir();
    const randomId = crypto.randomBytes(8).toString('hex');
    return path.join(TEMP_DIR, `${prefix}_${randomId}.${extension}`);
}

async function cleanupFile(filePath, delay = 0) {
    const doCleanup = async () => {
        try { await fsp.unlink(filePath); } catch {}
    };
    if (delay > 0) {
        setTimeout(doCleanup, delay);
    } else {
        await doCleanup();
    }
}

async function cleanupDir(dirPath, delay = 0) {
    const doCleanup = async () => {
        try { await fsp.rm(dirPath, { recursive: true, force: true }); } catch {}
    };
    if (delay > 0) {
        setTimeout(doCleanup, delay);
    } else {
        await doCleanup();
    }
}

module.exports = { ensureTempDir, tempFilePath, cleanupFile, cleanupDir, TEMP_DIR };
