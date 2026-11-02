import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

let recon;
let axios;

beforeAll(() => {
    process.env.DISCORD_TOKEN ||= 'test-token';
    process.env.CLIENT_ID ||= 'test-client-id';
    // vi.mock does not intercept CJS require(): spy before recon-web destructures the import
    vi.spyOn(require('../../utils/ssrf.js'), 'validateUrlNotInternal').mockResolvedValue(undefined);
    axios = require('axios');
    recon = require('../../commands/recon-web.js');
});

afterAll(() => vi.restoreAllMocks());

describe('bob-web-recon crt.sh', () => {
    it('lists recent certs from the current crt.sh shape (no entry_timestamp)', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: [
                { issuer_name: 'C=US, O=Old CA, CN=X', not_before: '2025-01-02T00:00:00' },
                { issuer_name: 'C=NL, O=eMudhra BV, CN=EM DV TLS CA - G3B', not_before: '2026-10-20T21:19:03' },
                { issuer_name: 'C=US, O="Cloudflare, Inc.", CN=Cloudflare TLS', entry_timestamp: '2026-11-01T00:00:00.123' },
                { issuer_name: 'CN=Self Signed' }
            ]
        });
        const edits = [];
        const interaction = {
            options: { getString: (k) => ({ domain: 'example.com', service: 'crtsh' })[k] ?? null },
            deferReply: vi.fn(),
            editReply: vi.fn(async (m) => edits.push(m))
        };

        await recon.execute(interaction);

        const fields = edits.at(-1).embeds[0].data.fields;
        const recent = fields.find((f) => f.name === 'Recent Certificates').value;
        expect(recent).toBe(
            '• 2026-11-01 - Cloudflare, Inc.\n• 2026-10-20 - eMudhra BV\n• 2025-01-02 - Old CA\n• unknown date - CN=Self Signed'
        );
    });
});
