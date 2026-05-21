'use strict';

/**
 * Health writer — periodically writes a JSON health file for Docker HEALTHCHECK.
 *
 * Usage:
 *   const { startHealthWriter, stopHealthWriter, markReady, markShuttingDown, writeNow } = require('./utils/health');
 *   startHealthWriter({ path: '/app/temp/.health/health.json', intervalMs: 5000, client });
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const logger = require('./logger');

// Read version once at module load; default to 'unknown' if package.json unreadable.
let _version = 'unknown';
try {
    const pkg = require('../package.json');
    _version = pkg.version ?? 'unknown';
} catch {
    // non-fatal
}

/** @type {string|null} */
let _filePath = null;
/** @type {ReturnType<typeof setInterval>|null} */
let _intervalHandle = null;
/** @type {import('discord.js').Client|null} */
let _client = null;

// Internal mutable state
let _state = 'starting';
let _lastReady = null;
let _shuttingDownSince = null;
let _stopped = false;   // set to true after EROFS/EACCES — stop trying

/**
 * Derive state string from Discord client ws.status.
 * ws.status 0 === READY per discord.js WebSocketStatus enum.
 */
function _deriveState() {
    if (_state === 'shutting_down') return 'shutting_down';
    if (_client) {
        return _client.ws.status === 0 ? 'ready' : 'starting';
    }
    return _state;
}

/** Build the health payload object. */
function _buildPayload() {
    return {
        state: _deriveState(),
        lastReady: _lastReady,
        shuttingDownSince: _shuttingDownSince,
        uptime: process.uptime(),
        pid: process.pid,
        version: _version,
        ts: Date.now()
    };
}

/**
 * Atomically write health payload to disk (tmp → rename).
 * Silently stops on EROFS / EACCES to avoid spamming logs.
 */
async function writeNow() {
    if (!_filePath || _stopped) return;
    const tmp = `${_filePath}.tmp`;
    try {
        await fs.writeFile(tmp, JSON.stringify(_buildPayload()), 'utf8');
        await fs.rename(tmp, _filePath);
    } catch (err) {
        if (err.code === 'EROFS' || err.code === 'EACCES') {
            logger.warn({ err, path: _filePath }, 'health: filesystem not writable — disabling health writer');
            _stopped = true;
            stopHealthWriter();
        } else {
            logger.warn({ err, path: _filePath }, 'health: write failed');
        }
    }
}

/**
 * Synchronously write initial 'starting' health payload.
 * Safe to call before startHealthWriter (uses fs.mkdirSync + writeFileSync).
 * @param {string} filePath - Absolute path to write the health file.
 */
function writeStartingState(filePath) {
    if (!filePath) return;
    try {
        fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
        const payload = {
            state: 'starting',
            lastReady: null,
            shuttingDownSince: null,
            uptime: process.uptime(),
            pid: process.pid,
            version: _version,
            ts: Date.now()
        };
        fsSync.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    } catch (err) {
        logger.warn({ err, path: filePath }, 'health: initial sync write failed');
    }
}

/**
 * Start the health writer interval.
 * @param {object} opts
 * @param {string} opts.path         - Absolute path to write the health file.
 * @param {number} [opts.intervalMs=5000] - Write interval in milliseconds.
 * @param {import('discord.js').Client} [opts.client] - Discord client (optional).
 */
async function startHealthWriter({ path: filePath, intervalMs = 5000, client } = {}) {
    if (!filePath) throw new Error('health.startHealthWriter: `path` is required');

    _filePath = filePath;
    _client = client ?? null;
    _state = 'starting';
    _lastReady = null;
    _shuttingDownSince = null;
    _stopped = false;

    // Ensure parent directory exists
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') {
            logger.warn({ err, path: filePath }, 'health: failed to create health directory');
        }
    }

    await writeNow();

    if (_intervalHandle) clearInterval(_intervalHandle);
    _intervalHandle = setInterval(() => { writeNow().catch(() => {}); }, intervalMs);
}

/** Stop the write interval. Does not modify the health file. */
function stopHealthWriter() {
    if (_intervalHandle) {
        clearInterval(_intervalHandle);
        _intervalHandle = null;
    }
}

/** Mark state as ready and flush immediately. */
async function markReady() {
    _state = 'ready';
    _lastReady = Date.now();
    await writeNow();
}

/** Mark state as shutting_down and flush immediately. */
async function markShuttingDown() {
    _state = 'shutting_down';
    _shuttingDownSince = Date.now();
    await writeNow();
}

module.exports = {
    startHealthWriter,
    stopHealthWriter,
    markReady,
    markShuttingDown,
    writeNow,
    writeStartingState
};
