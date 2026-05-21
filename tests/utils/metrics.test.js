'use strict';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';

// Use vi.resetModules() so each test suite gets a fresh registry
let metrics;

describe('metrics module', () => {
    beforeEach(async () => {
        vi.resetModules();
        metrics = await import('../../utils/metrics.js');
    });

    afterEach(async () => {
        await metrics.stopMetricsServer();
    });

    describe('registry isolation', () => {
        it('exposes exactly four metrics', () => {
            const all = metrics.registry.getMetricsAsArray();
            expect(all).toHaveLength(4);
        });

        it('output does NOT contain default Node/process metrics', async () => {
            const output = await metrics.registry.metrics();
            expect(output).not.toMatch(/^process_resident_memory_bytes/m);
            expect(output).not.toMatch(/^nodejs_heap_size_total/m);
            expect(output).not.toMatch(/^process_cpu_seconds_total/m);
        });

        it('output DOES contain the four declared metrics', async () => {
            // Record one observation so the histogram emits bucket lines
            metrics.commandDuration.observe({ command: 'test' }, 0.1);
            const output = await metrics.registry.metrics();
            expect(output).toMatch(/command_duration_seconds_bucket/);
            expect(output).toMatch(/command_errors_total/);
            expect(output).toMatch(/discord_events_total/);
            expect(output).toMatch(/ratelimit_blocks_total/);
        });
    });

    describe('counter increment', () => {
        it('reflects incremented commandErrors in output', async () => {
            metrics.commandErrors.inc({ command: 'ping', reason: 'timeout' });
            const output = await metrics.registry.metrics();
            expect(output).toMatch(/command_errors_total\{command="ping",reason="timeout"\} 1/);
        });
    });

    describe('HTTP server', () => {
        it('GET /metrics returns 200 with correct content-type', async () => {
            const server = await metrics.startMetricsServer({ port: 0, host: '127.0.0.1' });
            const port = server.address().port;

            const response = await new Promise((resolve, reject) => {
                http.get(`http://127.0.0.1:${port}/metrics`, (res) => {
                    let body = '';
                    res.on('data', (chunk) => { body += chunk; });
                    res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
                }).on('error', reject);
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['content-type']).toContain('text/plain');
            expect(response.body).toMatch(/command_duration_seconds/);
        });

        it('GET /other returns 404', async () => {
            const server = await metrics.startMetricsServer({ port: 0, host: '127.0.0.1' });
            const port = server.address().port;

            const statusCode = await new Promise((resolve, reject) => {
                http.get(`http://127.0.0.1:${port}/other`, (res) => {
                    res.resume();
                    res.on('end', () => resolve(res.statusCode));
                }).on('error', reject);
            });

            expect(statusCode).toBe(404);
        });

        it('binds to 127.0.0.1 by default', async () => {
            const server = await metrics.startMetricsServer({ port: 0 });
            expect(server.address().address).toBe('127.0.0.1');
        });

        it('stopMetricsServer closes the listener', async () => {
            const server = await metrics.startMetricsServer({ port: 0, host: '127.0.0.1' });
            const port = server.address().port;
            await metrics.stopMetricsServer();

            // After close, connecting should fail
            await expect(
                new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${port}/metrics`, resolve).on('error', reject);
                })
            ).rejects.toThrow();
        });
    });
});
