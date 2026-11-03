import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Facts stated in several docs must match the code: command counts, the version, and the
// repository layout table (every top-level path has a documented purpose).
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const commandFiles = fs.readdirSync(path.join(ROOT, 'commands')).filter((f) => f.endsWith('.js'));
const toolCommands = commandFiles.filter((f) => /\brequiresTool\b/.test(read(`commands/${f}`))).length;
const total = commandFiles.length;

describe('repository facts stated in docs', () => {
    it('command counts match commands/ (full = all, slim = without CLI-backed ones)', () => {
        for (const f of ['README.md', 'CITATION.cff', 'zenodo.json']) {
            const counts = [...read(f).matchAll(/\b(\d+) (?:slash commands|commands|OSINT workflows)\b/g)].map((m) => Number(m[1]));
            expect(counts.length, f).toBeGreaterThan(0);
            expect(counts, f).toEqual(counts.map(() => total));
        }
        const install = read('docs/INSTALLATION.md');
        expect(install).toMatch(new RegExp(`\\| ${total - toolCommands} \\(CLI-backed ones hidden\\)`));
        expect(install).toMatch(new RegExp(`\\| all ${total} \\|`));
    });

    it('package.json, CITATION.cff and zenodo.json carry the same version', () => {
        const version = JSON.parse(read('package.json')).version;
        expect(read('CITATION.cff')).toMatch(new RegExp(`^version: v?${version.replace(/\./g, '\\.')}$`, 'm'));
        expect(JSON.parse(read('zenodo.json')).version).toBe(version);
    });

    it('CONTRIBUTING "Repository Layout" documents every top-level path', () => {
        const local = new Set(['.git', 'node_modules', 'temp', 'reports', '.env', '.omc', 'CLAUDE.md', 'package-lock.json', 'coverage']);
        const table = read('CONTRIBUTING.md').split('## Repository Layout')[1].split('\n## ')[0];
        const documented = [...table.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        const missing = fs.readdirSync(ROOT).filter((name) => !local.has(name))
            .filter((name) => !documented.some((d) => d === name || d.startsWith(`${name}/`)));
        expect(missing).toEqual([]);
    });
});
