import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// docs/COMMANDS.md is generated from the slash-command definitions; it must never drift.
const require = createRequire(import.meta.url);
const { render, OUT } = require('../../scripts/gen-commands-doc.js');

afterAll(() => {
    for (const f of fs.readdirSync(`${__dirname}/../../commands`)) require(`../../commands/${f}`).shutdown?.();
});

describe('docs/COMMANDS.md', () => {
    it('matches the command definitions (run `bun run docs:commands` to update)', () => {
        expect(fs.readFileSync(OUT, 'utf8')).toBe(render());
    });
});
