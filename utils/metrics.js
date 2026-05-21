'use strict';

/**
 * Prometheus metrics module.
 * Uses a fresh Registry — never the default global registry.
 * collectDefaultMetrics() is intentionally NOT called.
 */

const http = require('node:http');
const promClient = require('prom-client');
const logger = require('./logger');

const registry = new promClient.Registry();

const commandDuration = new promClient.Histogram({
    name: 'command_duration_seconds',
    help: 'Slash command execute() duration in seconds',
    labelNames: ['command'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry]
});

const commandErrors = new promClient.Counter({
    name: 'command_errors_total',
    help: 'Slash command failures',
    labelNames: ['command', 'reason'],
    registers: [registry]
});

const discordEvents = new promClient.Counter({
    name: 'discord_events_total',
    help: 'Discord gateway events observed',
    labelNames: ['event'],
    registers: [registry]
});

const ratelimitBlocks = new promClient.Counter({
    name: 'ratelimit_blocks_total',
    help: 'Rate-limit rejections',
    labelNames: ['command'],
    registers: [registry]
});

let _server = null;

/**
 * Start the Prometheus metrics HTTP server.
 * @param {object} [opts]
 * @param {number} [opts.port=9090]
 * @param {string} [opts.host='127.0.0.1']
 * @returns {Promise<http.Server>} Resolves once the server is listening.
 */
function startMetricsServer({ port = 9090, host = '127.0.0.1' } = {}) {
    return new Promise((resolve, reject) => {
        _server = http.createServer(async (req, res) => {
            if (req.method === 'GET' && req.url === '/metrics') {
                try {
                    const body = await registry.metrics();
                    res.writeHead(200, { 'Content-Type': registry.contentType });
                    res.end(body);
                } catch (_err) {
                    res.writeHead(500);
                    res.end('Internal Server Error');
                }
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        _server.once('error', reject);

        _server.listen(port, host, () => {
            const addr = _server.address();
            logger.info({ addr }, 'Metrics server listening');
            resolve(_server);
        });
    });
}

/**
 * Gracefully close the metrics HTTP server.
 * @returns {Promise<void>}
 */
function stopMetricsServer() {
    return new Promise((resolve, reject) => {
        if (!_server) {
            resolve();
            return;
        }
        _server.close((err) => {
            _server = null;
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = {
    registry,
    commandDuration,
    commandErrors,
    discordEvents,
    ratelimitBlocks,
    startMetricsServer,
    stopMetricsServer
};
