/**
 * File: utils/temp-sweep.js
 * Description: Hourly recurring sweep of the temp directory.
 * Delegates to bootstrap.sweepBootTemp so exclusion logic stays DRY.
 */

const bootstrap = require('./bootstrap');
const { SWEEP_EXCLUDE_DEFAULT } = bootstrap;
const logger = require('./logger');

let sweepTimer = null;

function startHourlySweep(tempDir, { intervalMs = 60 * 60 * 1000, exclude = SWEEP_EXCLUDE_DEFAULT } = {}) {
    if (sweepTimer) return sweepTimer;
    sweepTimer = setInterval(() => {
        try {
            const result = bootstrap.sweepBootTemp(tempDir, exclude);
            logger.info({ ...result, dir: tempDir }, 'temp-sweep complete');
        } catch (err) {
            logger.error({ err }, 'temp-sweep failed');
        }
    }, intervalMs);
    sweepTimer.unref?.();
    return sweepTimer;
}

function stopHourlySweep() {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
}

module.exports = { startHourlySweep, stopHourlySweep };
