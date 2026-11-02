#!/usr/bin/env node
/**
 * Smoke test runner for all bot slash commands.
 *
 * Loads the local .env, builds a mock Discord ChatInputCommandInteraction,
 * and invokes each command's execute() with a representative sample input.
 * Reports pass / skip / fail per command.
 *
 * Skip rules:
 *   - attachment-only commands (cannot mock Discord CDN attachments)
 *   - CLI-backed commands whose `requiresTool` isn't installed (slim image)
 *   - commands whose required API key env var is unset
 *
 * A reply reporting an error (❌, "failed", ...) counts as a failure.
 *
 * Usage:
 *   node scripts/smoke-test.js                # run all
 *   node scripts/smoke-test.js bob-dns bob-airport   # subset
 *   TIMEOUT_MS=60000 node scripts/smoke-test.js
 *   docker compose run --rm bot bun run smoke   # in its own container, not the live bot's
 */

require('dotenv').config({ quiet: true });

const path = require('path');
const fs = require('fs');
const { PermissionsBitField } = require('discord.js');
const { isToolAvailable } = require('../utils/tools');

// Loosen guild whitelist + role gate while testing so the runner reaches
// the command's own logic. (The bot's real index.js still enforces these.)
process.env.ALLOWED_GUILD_IDS = '';
process.env.OSINT_ALLOWED_ROLES = '';

const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10);
const argFilter = process.argv.slice(2);

/**
 * Per-command sample input + skip rules. Each entry:
 *   options:    Map of option name -> value (covers getString/getInteger/getBoolean)
 *   subcommand: optional name (for getSubcommand)
 *   skip:       optional reason string -> command is skipped without execution
 *   needsEnv:   optional list of env vars; if any unset -> auto-skip
 *   timeoutMs:  optional per-command timeout (CLI scans run for minutes)
 *   expect:     optional regex the final reply must match (instead of the error check)
 * Commands exporting `requiresTool` are skipped when the tool isn't installed
 * (slim image), and run in the full image.
 */
const loadedCommands = new Map();
const LONG = 240000;
const SAMPLES = {
    'bob-airport':       { options: { icao: 'KJFK' }, needsEnv: ['AIRPORTDB_API_KEY'] },
    'bob-flight':        { options: { flight_number: 'AA100' }, needsEnv: ['AVIATIONSTACK_API_KEY'] },
    'bob-blockchain':    { subcommand: 'address', options: { blockchain: 'eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' } },
    'bob-blockchain-detect': { options: { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' } },
    'bob-chat':          { subcommand: 'ask', options: { message: 'Reply with the single word OK.' }, needsEnv: ['AI_API_KEY'], timeoutMs: 130000 },
    'bob-dns':           { options: { domain: 'github.com' }, needsEnv: ['DNSDUMPSTER_TOKEN'] },
    'bob-dork':          { options: { firstname: 'John', lastname: 'Doe', engine: 'google' } },
    'bob-exif':          { options: { url: 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/Canon_40D.jpg' } },
    'bob-extract-links': { options: { url: 'https://www.iana.org/' } },
    'bob-favicon':       { options: { url: 'https://github.com' } },
    'bob-flight-number': { options: { flight: 'AA100' } },
    'bob-generate-usernames': { options: { firstname: 'John', lastname: 'Doe' } },
    'bob-ghunt':         { options: { type: 'check-login' }, expect: /Logged In|Credentials/ },
    'bob-health':        { options: { detailed: true } },
    'bob-help':          { options: {} },
    'bob-hostio':        { subcommand: 'full', options: { domain: 'github.com' }, needsEnv: ['HOSTIO_API_KEY'] },
    'bob-jwt':           { subcommand: 'analyze', options: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' } },
    'bob-linkook':       { options: { username: 'torvalds' }, timeoutMs: LONG },
    'bob-maigret':       { options: { username: 'torvalds' }, timeoutMs: 330000 },
    'bob-monitor':       { subcommand: 'list', options: {} },
    'bob-nike':          { options: { name: 'John Doe' }, needsEnv: ['NIKE_TOKEN'] },
    'bob-nuclei':        { options: { username: 'torvalds', timeout: 200 }, timeoutMs: LONG },
    'bob-pappers':       { subcommand: 'search', options: { country_code: 'FR', query: 'Renault' }, needsEnv: ['PAPPERS_API_KEY'] },
    'bob-web-recon':     { options: { domain: 'example.com', service: 'crtsh' }, timeoutMs: 90000 },
    'bob-redirect-check': { options: { url: 'https://google.com' }, expect: /Redirect Chain/ },
    'bob-rekognition':   { subcommand: 'analyze', options: { url: 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/Canon_40D.jpg', features: 'labels' }, needsEnv: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] },
    'bob-sherlock':      { options: { username: 'torvalds', timeout: 200 }, timeoutMs: LONG },
    'bob-upload':        { skip: 'attachment-only command cannot be mocked' },
    'bob-vessel':        { subcommand: 'name', options: { vessel: 'Ever Given' } },
    'bob-vpic':          { subcommand: 'decode', options: { vin: '1HGCM82633A004352' } },
    'bob-whoxy':         { options: { type: 'balance' }, needsEnv: ['WHOXY_API_KEY'] },
    'bob-xeuledoc':      { options: { link: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' }, timeoutMs: 90000 }
};

// A reply that reports a failure means the command did not work, even if execute() resolved.
const ERROR_REPLY = /❌|\berror\b|failed|please provide|invalid request|not configured|not allowed|rate limit|could not|unable to/i;

function buildMockInteraction(commandName, sample) {
    const replies = [];
    const state = { replied: false, deferred: false };
    const opts = sample.options || {};

    const getOpt = (name, required = false) => {
        if (Object.prototype.hasOwnProperty.call(opts, name)) return opts[name];
        if (required) throw new Error(`Mock missing required option '${name}' for ${commandName}`);
        return null;
    };

    const interaction = {
        commandName,
        isChatInputCommand: () => true,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        user: { id: 'smoke-user', tag: 'smoke#0001' },
        guild: { id: 'smoke-guild', name: 'smoke-guild' },
        guildId: 'smoke-guild',
        channelId: 'smoke-channel',
        memberPermissions: new PermissionsBitField(PermissionsBitField.All),
        member: {
            roles: { cache: { some: () => true } },
            permissions: new PermissionsBitField(PermissionsBitField.All)
        },
        client: {
            channels: {
                fetch: async () => ({
                    send: async () => ({}),
                    permissionsFor: () => ({ has: () => true })
                })
            },
            user: { id: 'smoke-bot', tag: 'smoke-bot#0000' },
            commands: loadedCommands,
            isReady: () => true,
            presence: { status: 'online' },
            ws: { ping: 42 },
            guilds: { cache: { size: 1 } },
            users: { cache: { size: 1 } },
            uptime: 1000,
            readyAt: new Date()
        },
        options: {
            getString: (name, required) => {
                const v = getOpt(name, required);
                return v == null ? null : String(v);
            },
            getInteger: (name, required) => {
                const v = getOpt(name, required);
                return v == null ? null : parseInt(v, 10);
            },
            getNumber: (name, required) => {
                const v = getOpt(name, required);
                return v == null ? null : Number(v);
            },
            getBoolean: (name, required) => {
                const v = getOpt(name, required);
                return v == null ? null : Boolean(v);
            },
            getAttachment: () => null,
            getSubcommand: (required) => {
                if (!sample.subcommand && required) throw new Error(`Mock missing subcommand for ${commandName}`);
                return sample.subcommand || null;
            },
            getSubcommandGroup: () => null
        },
        deferReply: async (payload = {}) => {
            state.deferred = true;
            interaction.deferred = true;
            replies.push({ kind: 'defer', payload });
            return {};
        },
        reply: async (payload) => {
            state.replied = true;
            interaction.replied = true;
            replies.push({ kind: 'reply', payload });
            return {};
        },
        editReply: async (payload) => {
            replies.push({ kind: 'edit', payload });
            return {};
        },
        followUp: async (payload) => {
            replies.push({ kind: 'followUp', payload });
            return {};
        },
        fetchReply: async () => ({ id: 'mock-msg' })
    };
    return { interaction, replies };
}

function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
        promise.then(v => { clearTimeout(t); resolve(v); },
                     e => { clearTimeout(t); reject(e); });
    });
}

function summarizeReply(replies) {
    if (!replies.length) return '<no reply>';
    const last = replies[replies.length - 1];
    const p = last.payload || {};
    if (typeof p === 'string') return p.slice(0, 120);
    if (p.content) return String(p.content).slice(0, 120);
    if (p.embeds && p.embeds.length) {
        const e = p.embeds[0]?.data || p.embeds[0] || {};
        return `[embed] ${e.title || ''} :: ${(e.description || '').slice(0, 80)}`;
    }
    if (p.files) return `[file] ${p.files[0]?.name || 'attachment'}`;
    return JSON.stringify(p).slice(0, 120);
}

async function runOne(commandName, modulePath) {
    const sample = SAMPLES[commandName];
    if (!sample) {
        return { commandName, status: 'skip', reason: 'no sample registered' };
    }
    if (sample.skip) {
        return { commandName, status: 'skip', reason: sample.skip };
    }
    if (sample.needsEnv) {
        const missing = sample.needsEnv.filter(k => !process.env[k]);
        if (missing.length) {
            return { commandName, status: 'skip', reason: `missing env: ${missing.join(', ')}` };
        }
    }

    let cmd;
    try {
        cmd = require(modulePath);
    } catch (e) {
        return { commandName, status: 'fail', error: `require: ${e.message}` };
    }
    if (!cmd.execute) return { commandName, status: 'fail', error: 'no execute()' };
    if (cmd.requiresTool && !isToolAvailable(cmd.requiresTool)) {
        return { commandName, status: 'skip', reason: 'tool not installed (full image only)' };
    }

    const { interaction, replies } = buildMockInteraction(commandName, sample);
    const start = Date.now();
    try {
        const ms = sample.timeoutMs ?? TIMEOUT_MS;
        await withTimeout(Promise.resolve(cmd.execute(interaction)), ms, commandName);
        const preview = summarizeReply(replies);
        const last = replies.at(-1);
        const text = JSON.stringify(last?.payload ?? ''); // whole reply, embed fields included
        const error = !last || last.kind === 'defer' ? 'no reply after defer'
            : sample.expect ? (!sample.expect.test(text) && `reply does not match ${sample.expect}`)
            : (ERROR_REPLY.test(text) && 'error reply');
        if (error) {
            return { commandName, status: 'fail', ms: Date.now() - start, error, preview };
        }
        return {
            commandName,
            status: 'pass',
            ms: Date.now() - start,
            replies: replies.length,
            preview: summarizeReply(replies)
        };
    } catch (e) {
        return {
            commandName,
            status: 'fail',
            ms: Date.now() - start,
            error: e.message,
            preview: summarizeReply(replies)
        };
    }
}

async function main() {
    const commandsDir = path.join(__dirname, '..', 'commands');
    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
    const tasks = [];
    for (const file of files) {
        const modulePath = path.join(commandsDir, file);
        const cmd = (() => { try { return require(modulePath); } catch { return null; } })();
        if (!cmd?.data?.name) continue;
        const name = cmd.data.name;
        loadedCommands.set(name, cmd);
        if (argFilter.length && !argFilter.includes(name)) continue;
        tasks.push({ name, modulePath });
    }

    const results = [];
    for (const t of tasks) {
        process.stdout.write(`▶ ${t.name.padEnd(24)} `);
        const r = await runOne(t.name, t.modulePath);
        results.push(r);
        if (r.status === 'pass') {
            console.log(`✅ pass (${r.ms}ms, ${r.replies} replies) — ${r.preview}`);
        } else if (r.status === 'skip') {
            console.log(`⏭  skip — ${r.reason}`);
        } else {
            console.log(`❌ FAIL (${r.ms || 0}ms) — ${r.error}`);
            if (r.preview) console.log(`     last reply: ${r.preview}`);
        }
    }

    // Cleanly stop any module-level intervals so the runner exits.
    for (const t of tasks) {
        const cmd = require(t.modulePath);
        if (typeof cmd.shutdown === 'function') {
            try { cmd.shutdown(); } catch { /* ignore */ }
        }
    }

    const pass = results.filter(r => r.status === 'pass').length;
    const skip = results.filter(r => r.status === 'skip').length;
    const fail = results.filter(r => r.status === 'fail').length;
    console.log('\n────────────────────────────────────');
    console.log(`Total: ${results.length}   Pass: ${pass}   Skip: ${skip}   Fail: ${fail}`);
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('runner error:', e); process.exit(2); });
