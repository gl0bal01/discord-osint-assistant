import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { checkPermission, RESTRICTED_COMMANDS } from '../../utils/permissions.js';

function makeInteraction({ commandName, hasPerm = false, guild = true, roleIds = [] }) {
    return {
        commandName,
        guild: guild ? { id: 'g1' } : null,
        memberPermissions: { has: (perm) => hasPerm === true || hasPerm === perm },
        member: {
            roles: {
                cache: {
                    some: (fn) => roleIds.some((id) => fn({ id }))
                }
            }
        }
    };
}

describe('checkPermission', () => {
    const ORIGINAL_ROLES = process.env.OSINT_ALLOWED_ROLES;
    afterEach(() => {
        if (ORIGINAL_ROLES === undefined) delete process.env.OSINT_ALLOWED_ROLES;
        else process.env.OSINT_ALLOWED_ROLES = ORIGINAL_ROLES;
    });

    it('allows unrestricted commands without checks', () => {
        const result = checkPermission(makeInteraction({ commandName: 'bob-dns' }));
        expect(result.allowed).toBe(true);
    });

    it('blocks restricted command when user lacks required permission', () => {
        const result = checkPermission(makeInteraction({ commandName: 'bob-nuclei', hasPerm: false }));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/permission/i);
    });

    it('allows restricted command when user has required permission', () => {
        const result = checkPermission(makeInteraction({
            commandName: 'bob-nuclei',
            hasPerm: PermissionFlagsBits.Administrator
        }));
        expect(result.allowed).toBe(true);
    });

    it('blocks restricted command outside a guild (DM)', () => {
        const result = checkPermission(makeInteraction({ commandName: 'bob-nuclei', guild: false }));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/server/i);
    });

    it('allows via OSINT_ALLOWED_ROLES override', () => {
        process.env.OSINT_ALLOWED_ROLES = 'role-a, role-b';
        const result = checkPermission(makeInteraction({
            commandName: 'bob-sherlock',
            hasPerm: false,
            roleIds: ['role-b']
        }));
        expect(result.allowed).toBe(true);
    });

    it('still blocks when OSINT_ALLOWED_ROLES set but user lacks any allowed role', () => {
        process.env.OSINT_ALLOWED_ROLES = 'role-a,role-b';
        const result = checkPermission(makeInteraction({
            commandName: 'bob-sherlock',
            hasPerm: false,
            roleIds: ['some-other-role']
        }));
        expect(result.allowed).toBe(false);
    });

    it('bob-nuclei requires Administrator (not ManageGuild)', () => {
        expect(RESTRICTED_COMMANDS['bob-nuclei']).toBe(PermissionFlagsBits.Administrator);
    });

    it('all other restricted commands require ManageGuild', () => {
        const expectManageGuild = [
            'bob-monitor', 'bob-rekognition', 'bob-jwt', 'bob-ghunt',
            'bob-sherlock', 'bob-maigret', 'bob-linkook', 'bob-xeuledoc'
        ];
        for (const cmd of expectManageGuild) {
            expect(RESTRICTED_COMMANDS[cmd]).toBe(PermissionFlagsBits.ManageGuild);
        }
    });
});
