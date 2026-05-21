import { describe, it, expect } from 'vitest';
import { neutralizeMentions } from '../../utils/discord.js';

describe('neutralizeMentions', () => {
    it('neutralizes @everyone', () => {
        const out = neutralizeMentions('hello @everyone');
        expect(out).not.toBe('hello @everyone');
        expect(out).not.toMatch(/(^|[^​])@everyone/);
    });

    it('neutralizes @here', () => {
        const out = neutralizeMentions('hey @here');
        expect(out).not.toBe('hey @here');
        expect(out).not.toMatch(/(^|[^​])@here/);
    });

    it('case-insensitive @EveryOne / @HERE', () => {
        expect(neutralizeMentions('@EveryOne')).not.toBe('@EveryOne');
        expect(neutralizeMentions('@HERE')).not.toBe('@HERE');
    });

    it('neutralizes role mentions <@&123>', () => {
        const out = neutralizeMentions('ping <@&123456789012345678>');
        expect(out).not.toContain('<@&123456789012345678>');
        expect(out).toContain('123456789012345678');
    });

    it('preserves user mentions <@123> (not role/mass)', () => {
        const out = neutralizeMentions('hi <@111111111111111111>');
        expect(out).toBe('hi <@111111111111111111>');
    });

    it('passes through clean text unchanged', () => {
        expect(neutralizeMentions('plain text without mentions')).toBe('plain text without mentions');
    });

    it('returns non-strings unchanged', () => {
        expect(neutralizeMentions(null)).toBe(null);
        expect(neutralizeMentions(undefined)).toBe(undefined);
        expect(neutralizeMentions(42)).toBe(42);
        const obj = { a: 1 };
        expect(neutralizeMentions(obj)).toBe(obj);
    });

    it('handles multiple mentions in one string', () => {
        const out = neutralizeMentions('@everyone @here <@&999>');
        expect(out).not.toMatch(/(^|[^​])@everyone/);
        expect(out).not.toMatch(/(^|[^​])@here/);
        expect(out).not.toContain('<@&999>');
    });
});
