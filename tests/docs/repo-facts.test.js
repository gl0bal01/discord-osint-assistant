import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Facts stated in the docs must match the code: command counts, the version, keywords, the
// required env vars, healthcheck timings, and the repository layout table (every top-level
// path has a documented purpose).
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const commandFiles = fs.readdirSync(path.join(ROOT, 'commands')).filter((f) => f.endsWith('.js'));
const toolCommands = commandFiles.filter((f) => /^\s+requiresTool:/m.test(read(`commands/${f}`))).length;
const total = commandFiles.length;

function envRegistry() {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    const { REQUIRED, OPTIONAL } = require('../../utils/config.js');
    return { required: Object.keys(REQUIRED), all: [...Object.keys(REQUIRED), ...Object.keys(OPTIONAL)] };
}

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

    it('CITATION.cff and zenodo.json carry the same keywords', () => {
        const block = read('CITATION.cff').split(/^keywords:\n/m)[1].split(/^\S/m)[0];
        const cff = [...block.matchAll(/^ {2}- "([^"]+)"$/gm)].map((m) => m[1]);
        expect(cff.length).toBeGreaterThan(0);
        expect(cff).toEqual(JSON.parse(read('zenodo.json')).keywords);
    });

    it('docs name the same required env vars as utils/config.js', () => {
        const { required } = envRegistry();
        for (const f of ['README.md', 'docs/INSTALLATION.md', '.env.example']) {
            const m = read(f).match(/Only `?([A-Z_]+)`? and `?([A-Z_]+)`? are required/);
            expect(m, f).not.toBeNull();
            expect([m[1], m[2]].sort(), f).toEqual([...required].sort());
        }
    });

    it('INSTALLATION says where every API key comes from and lists every tool path override', () => {
        const { all } = envRegistry();
        const install = read('docs/INSTALLATION.md');
        const section = (heading) => install.split(`${heading}\n`)[1].split('\n#')[0];
        const keys = all.filter((n) => /_(KEY|TOKEN)$|^AWS_/.test(n) && n !== 'DISCORD_TOKEN');
        expect(keys.filter((n) => !section('### API Keys').includes(`\`${n}\``))).toEqual([]);
        const tools = all.filter((n) => /_(PATH|WORDLIST)$/.test(n));
        expect(tools.filter((n) => !section('## External Tools').includes(`\`${n}\``))).toEqual([]);
    });

    it('healthcheck timings in the docs match the code', () => {
        const num = (f, re) => Number(read(f).match(re)[1]);
        const ready = num('scripts/healthcheck.js', /HEALTH_READY_MAX_AGE_MS = (\d+)/) / 1000;
        const grace = num('scripts/healthcheck.js', /HEALTH_GRACE_MS = (\d+)/) / 1000;
        const every = num('Dockerfile', /HEALTHCHECK --interval=(\d+)s/);
        const start = num('Dockerfile', /HEALTHCHECK .*--start-period=(\d+)s/);
        const write = num('index.js', /startHealthWriter\(\{[^}]*intervalMs: (\d+)/) / 1000;
        const security = read('SECURITY.md').split('### Healthcheck\n')[1].split('\n### ')[0];
        expect(security).toContain(`within ${ready} seconds`);
        expect(security).toContain(`${grace}-second grace window`);
        expect(security).toContain(`every ${every} seconds with a ${start}-second start period`);
        expect(read('README.md')).toContain(`every ${write} seconds`);
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
        const known = new Set([...envRegistry().all, 'BOT_TARGET', 'NODE_ENV', 'HOME', 'PATH', 'CI_LOG_DIR', 'TIMEOUT_MS', 'INSTALL_DIR', 'ENV_FILE', 'BOT_USER', 'SERVICE_NAME']);
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

