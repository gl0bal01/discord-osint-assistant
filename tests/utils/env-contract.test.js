import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Every environment variable has one documented home. This test keeps the code, the
// registry (utils/config.js), .env.example and the logger's redact list in step: a
// variable can't be read without being documented, or documented without being read.
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..', '..');

const SYSTEM = new Set(['HOME', 'LANG', 'NODE_ENV', 'PATH']); // set by the OS/runtime, not by .env
const SCRIPT_ONLY = new Set(['TIMEOUT_MS']); // scripts/smoke-test.js knob, documented in its header
const COMPOSE_ONLY = new Set(['BOT_TARGET']); // read by docker-compose.yml, not by Node
const SECRET = /(KEY|TOKEN|SECRET|WEBHOOK)/;

function sourceFiles() {
    const files = ['index.js', 'deploy-commands.js', 'clear-commands.js'];
    for (const dir of ['commands', 'utils', 'scripts']) {
        for (const f of fs.readdirSync(path.join(ROOT, dir))) {
            if (f.endsWith('.js')) files.push(path.join(dir, f));
        }
    }
    return files;
}

function readInCode() {
    const names = new Set();
    for (const file of sourceFiles()) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) {
            names.add(m[1] ?? m[2]);
        }
        // Indirect reads: tables of { envVar: 'X' } (commands/health.js)
        for (const m of src.matchAll(/envVar:\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) names.add(m[1]);
    }
    return names;
}

let registry;
beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    const { REQUIRED, OPTIONAL } = require('../../utils/config.js');
    registry = new Set([...Object.keys(REQUIRED), ...Object.keys(OPTIONAL)]);
});

describe('environment variable contract', () => {
    it('every variable the code reads is registered in utils/config.js', () => {
        const unregistered = [...readInCode()].filter((n) => !registry.has(n) && !SYSTEM.has(n) && !SCRIPT_ONLY.has(n));
        expect(unregistered).toEqual([]);
    });

    it('every registered variable is actually read somewhere', () => {
        const read = readInCode();
        expect([...registry].filter((n) => !read.has(n))).toEqual([]);
    });

    it('.env.example documents exactly the registered variables', () => {
        const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
        const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
        expect([...registry].filter((n) => !documented.has(n))).toEqual([]);
        expect([...documented].filter((n) => !registry.has(n) && !COMPOSE_ONLY.has(n))).toEqual([]);
    });

    it('the logger redacts every secret variable, and only registered ones', () => {
        const { _pinoOptions } = require('../../utils/logger.js');
        const redacted = new Set(_pinoOptions.redact.paths.filter((p) => /^[A-Z][A-Z0-9_]+$/.test(p)));
        const secrets = [...registry].filter((n) => SECRET.test(n));
        expect(secrets.filter((n) => !redacted.has(n))).toEqual([]);
        expect([...redacted].filter((n) => !registry.has(n))).toEqual([]);
        for (const name of redacted) expect(_pinoOptions.redact.paths).toContain(`*.${name}`);
    });
});
