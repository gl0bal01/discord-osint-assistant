import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isToolAvailable } from '../../utils/tools.js';

describe('isToolAvailable', () => {
    it('finds a binary on PATH', () => {
        expect(isToolAvailable(['sh'])).toBe(true);
    });

    it('is false when no candidate exists', () => {
        expect(isToolAvailable(['no-such-tool-xyz'])).toBe(false);
        expect(isToolAvailable([])).toBe(false);
    });

    it('accepts any candidate and checks paths as files, not directories', () => {
        expect(isToolAvailable(['/nonexistent/tool', 'sh'])).toBe(true);
        expect(isToolAvailable(['/bin/sh'])).toBe(true);
        expect(isToolAvailable(['/tmp'])).toBe(false);
    });

    it('ignores files without the executable bit', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'));
        const file = path.join(dir, 'fake-tool');
        fs.writeFileSync(file, '#!/bin/sh\n', { mode: 0o644 });
        try {
            expect(isToolAvailable([file])).toBe(false);
            fs.chmodSync(file, 0o755);
            expect(isToolAvailable([file])).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
