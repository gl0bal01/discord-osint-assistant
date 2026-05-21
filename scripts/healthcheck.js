'use strict';

/**
 * Standalone Docker HEALTHCHECK script.
 * Reads HEALTH_FILE (default ./temp/.health/health.json) and exits 0 (healthy)
 * or 1 (unhealthy / not yet ready).
 *
 * No external dependencies — plain CommonJS only.
 */

const fs = require('fs');
const path = require('path');

const HEALTH_FILE = process.env.HEALTH_FILE ?? './temp/.health/health.json';
const HEALTH_READY_MAX_AGE_MS = Number(process.env.HEALTH_READY_MAX_AGE_MS ?? 30000);
const HEALTH_GRACE_MS = Number(process.env.HEALTH_GRACE_MS ?? 60000);

let raw;
try {
    raw = fs.readFileSync(path.resolve(HEALTH_FILE), 'utf8');
} catch (err) {
    if (err.code === 'ENOENT') {
        process.stderr.write(`healthcheck: ENOENT — file not found: ${HEALTH_FILE}\n`);
    } else {
        process.stderr.write(`healthcheck: read error (${err.code}): ${err.message}\n`);
    }
    process.exit(1);
}

let payload;
try {
    payload = JSON.parse(raw);
} catch {
    process.stderr.write(`healthcheck: JSON parse error — ${raw.slice(0, 80)}\n`);
    process.exit(1);
}

const { state, lastReady, shuttingDownSince } = payload;
const now = Date.now();

if (state === 'ready') {
    const age = now - lastReady;
    if (age < HEALTH_READY_MAX_AGE_MS) {
        process.stderr.write(`healthcheck: OK — state=ready, age=${age}ms\n`);
        process.exit(0);
    }
    process.stderr.write(`healthcheck: FAIL — state=ready but lastReady is stale (age=${age}ms > ${HEALTH_READY_MAX_AGE_MS}ms)\n`);
    process.exit(1);
}

if (state === 'shutting_down') {
    const elapsed = now - shuttingDownSince;
    if (elapsed < HEALTH_GRACE_MS) {
        process.stderr.write(`healthcheck: OK — state=shutting_down within grace (elapsed=${elapsed}ms)\n`);
        process.exit(0);
    }
    process.stderr.write(`healthcheck: FAIL — state=shutting_down grace expired (elapsed=${elapsed}ms > ${HEALTH_GRACE_MS}ms)\n`);
    process.exit(1);
}

process.stderr.write(`healthcheck: FAIL — state=${state}\n`);
process.exit(1);
