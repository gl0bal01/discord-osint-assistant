/**
 * File: utils/reports.js
 * Description: Durable report archive for OSINT command exports.
 *
 * Command exports (sherlock, maigret, nuclei, linkook, ghunt, ...) are attached
 * to Discord from `temp/` and then deleted, so nothing survives the request.
 * This module persists a copy under `reports/` so an investigation's output
 * remains available on disk. Files are auto-pruned by the reports sweep
 * (see `startReportsSweep` / `index.js`) after `REPORTS_RETENTION_DAYS`.
 *
 * Security: report labels derive from user input (usernames, domains, IPs).
 * Every label passes through `sanitizeFilename` before it touches the
 * filesystem — NEVER build a report path from raw user input. Archiving is
 * best-effort: every entry point swallows its own errors and returns null so a
 * failed archive can never break the user-facing command.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { sanitizeFilename } = require('./validation');
const bootstrap = require('./bootstrap');
const logger = require('./logger');

const REPORTS_DIR = process.env.REPORTS_DIR
    ? path.resolve(process.env.REPORTS_DIR)
    : path.join(__dirname, '..', 'reports');

const RETENTION_DAYS = Number(process.env.REPORTS_RETENTION_DAYS) || 30;
const REPORTS_MAX_AGE_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function ensureReportsDir() {
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    return REPORTS_DIR;
}

// Compact UTC stamp, e.g. 20260708T142530Z. Keeps repeat runs of the same
// target from clobbering each other and makes reports chronologically sortable.
function stamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Build a durable, filesystem-safe path inside REPORTS_DIR. Both label and
// extension are sanitized; the result is always confined to REPORTS_DIR. A short
// random suffix follows the (second-resolution) stamp so repeat runs of the same
// label+extension within one second don't clobber each other.
function reportFilePath(label, extension = 'txt') {
    ensureReportsDir();
    const safeLabel = sanitizeFilename(label);
    const safeExt = sanitizeFilename(String(extension || 'txt')).replace(/^\.+/, '') || 'txt';
    const rand = crypto.randomBytes(3).toString('hex');
    return path.join(REPORTS_DIR, `${safeLabel}_${stamp()}_${rand}.${safeExt}`);
}

// Persist string/Buffer content as a report. Returns the dest path, or null on
// failure — archiving must never break the command that called it.
async function saveReport(label, content, extension = 'txt') {
    try {
        const dest = reportFilePath(label, extension);
        await fsp.writeFile(dest, content);
        logger.info({ report: path.basename(dest) }, 'report archived');
        return dest;
    } catch (err) {
        logger.warn({ err }, 'failed to archive report');
        return null;
    }
}

// Copy an existing file (typically a temp export) into reports/. The source
// extension is preserved unless overridden. Returns dest path or null.
async function archiveReport(srcPath, label, extension) {
    try {
        const ext = extension || path.extname(String(srcPath)).replace(/^\./, '') || 'txt';
        const dest = reportFilePath(label, ext);
        await fsp.copyFile(srcPath, dest);
        logger.info({ report: path.basename(dest) }, 'report archived');
        return dest;
    } catch (err) {
        logger.warn({ err }, 'failed to archive report');
        return null;
    }
}

// One-shot prune of reports/ older than the retention window. Reuses the shared
// TTL sweep from bootstrap (no exclusions — everything under reports/ ages out).
function pruneReports(maxAgeMs = REPORTS_MAX_AGE_MS) {
    if (!fs.existsSync(REPORTS_DIR)) return { swept: 0, kept: 0 };
    return bootstrap.sweepBootTemp(REPORTS_DIR, [], maxAgeMs);
}

let reportsSweepTimer = null;

function startReportsSweep({ intervalMs = 60 * 60 * 1000, maxAgeMs = REPORTS_MAX_AGE_MS } = {}) {
    if (reportsSweepTimer) return reportsSweepTimer;
    reportsSweepTimer = setInterval(() => {
        try {
            const result = pruneReports(maxAgeMs);
            logger.info({ ...result, dir: REPORTS_DIR }, 'reports-sweep complete');
        } catch (err) {
            logger.error({ err }, 'reports-sweep failed');
        }
    }, intervalMs);
    reportsSweepTimer.unref?.();
    return reportsSweepTimer;
}

function stopReportsSweep() {
    if (reportsSweepTimer) {
        clearInterval(reportsSweepTimer);
        reportsSweepTimer = null;
    }
}

module.exports = {
    REPORTS_DIR,
    REPORTS_MAX_AGE_MS,
    ensureReportsDir,
    reportFilePath,
    saveReport,
    archiveReport,
    pruneReports,
    startReportsSweep,
    stopReportsSweep,
};
