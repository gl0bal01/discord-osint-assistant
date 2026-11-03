import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Facts stated in several docs must match the code: command counts, the version, and the
// repository layout table (every top-level path has a documented purpose).
const require = createRequire(import.meta.url);
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

    it('every env var named in the docs exists (no stale or invented names)', () => {
        process.env.DISCORD_TOKEN ||= 'test-token';
        process.env.CLIENT_ID ||= 'test-client-id';
        const { REQUIRED, OPTIONAL } = require('../../utils/config.js');
        const known = new Set([...Object.keys(REQUIRED), ...Object.keys(OPTIONAL), 'BOT_TARGET', 'NODE_ENV', 'HOME', 'PATH', 'CI_LOG_DIR', 'TIMEOUT_MS', 'INSTALL_DIR', 'ENV_FILE', 'BOT_USER', 'SERVICE_NAME']);
        const envLike = /\b([A-Z][A-Z0-9]*_(?:[A-Z0-9]+_)*(?:KEY|TOKEN|ID|IDS|PATH|DIR|FILE|URL|LEVEL|DAYS|DAILY|ROLES|ENABLED|PORT|HOST|REGION|WORDLIST|TARGET))\b/g;
        for (const f of ['README.md', 'docs/INSTALLATION.md', 'SECURITY.md', 'CONTRIBUTING.md']) {
            const unknown = [...new Set([...read(f).matchAll(envLike)].map((m) => m[1]))].filter((n) => !known.has(n));
            expect(unknown, f).toEqual([]);
        }
    });

    it('README lists exactly the /bob-chat models the command offers', () => {
        const src = read('commands/chat.js');
        const block = (name) => src.split(`const ${name} = [`)[1].split('];')[0];
        const names = [...`${block('CHAT_MODELS')}${block('CODE_MODELS')}`.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
        const readme = read('README.md');
        expect(names.filter((n) => !readme.includes(n))).toEqual([]);
    });
});

