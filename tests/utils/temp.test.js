import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { reportDirPath, cleanupDir } from '../../utils/temp.js';

describe('utils/temp', () => {
    it('creates per-run report dirs owner-only (they hold data about targets)', async () => {
        const dir = reportDirPath('perm-check');
        try {
            expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        } finally {
            await cleanupDir(dir);
        }
    });
});
