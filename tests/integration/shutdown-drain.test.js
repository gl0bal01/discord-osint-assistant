import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadBootstrap() {
    const resolved = require.resolve('../../utils/bootstrap.js');
    delete require.cache[resolved];
    return require('../../utils/bootstrap.js');
}

describe('createShutdownHandler drain ordering', () => {
    it('onSignal runs before onDrain, then client.destroy', () => {
        const { createShutdownHandler } = loadBootstrap();
        const order = [];

        const cmdShutdown = vi.fn(() => order.push('cmd'));
        const client = {
            commands: new Map([['x', { shutdown: cmdShutdown }]]),
            destroy: vi.fn(() => order.push('destroy'))
        };

        const handler = createShutdownHandler(client, {
            onSignal: (signal) => {
                expect(signal).toBe('SIGTERM');
                order.push('onSignal');
            },
            onDrain: () => order.push('onDrain')
        });

        handler('SIGTERM');

        expect(order).toEqual(['onSignal', 'cmd', 'onDrain', 'destroy']);
    });

    it('markShuttingDown (onSignal) runs before stopHealthWriter (onDrain)', () => {
        const { createShutdownHandler } = loadBootstrap();
        const callOrder = [];

        const mockMarkShuttingDown = vi.fn(() => callOrder.push('markShuttingDown'));
        const mockStopHealthWriter = vi.fn(() => callOrder.push('stopHealthWriter'));
        const mockStopRateLimitPrune = vi.fn(() => callOrder.push('stopRateLimitPrune'));

        const client = {
            commands: new Map(),
            destroy: vi.fn()
        };

        const handler = createShutdownHandler(client, {
            onSignal: (signal) => {
                // Simulates what index.js does in onSignal
                mockMarkShuttingDown();
            },
            onDrain: () => {
                // Simulates what index.js does in onDrain
                mockStopRateLimitPrune();
                mockStopHealthWriter();
            }
        });

        handler('SIGTERM');

        expect(callOrder).toEqual(['markShuttingDown', 'stopRateLimitPrune', 'stopHealthWriter']);

        // Verify invocation call order via mock metadata
        const markOrder = mockMarkShuttingDown.mock.invocationCallOrder[0];
        const stopOrder = mockStopHealthWriter.mock.invocationCallOrder[0];
        expect(markOrder).toBeLessThan(stopOrder);
    });

    it('is idempotent — second call does not re-invoke onSignal or onDrain', () => {
        const { createShutdownHandler } = loadBootstrap();
        const onSignal = vi.fn();
        const onDrain = vi.fn();
        const client = { commands: new Map(), destroy: vi.fn() };

        const handler = createShutdownHandler(client, { onSignal, onDrain });
        handler('SIGTERM');
        handler('SIGTERM');

        expect(onSignal).toHaveBeenCalledOnce();
        expect(onDrain).toHaveBeenCalledOnce();
        expect(client.destroy).toHaveBeenCalledOnce();
    });
});
