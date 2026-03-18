import { describe, it, expect } from 'vitest';
import {
    isValidDomain, isValidUrl, isValidEmail,
    isValidUsername, isValidIpAddress, isValidCryptoAddress,
    sanitizeInput, containsMaliciousPatterns
} from '../../utils/validation.js';

describe('isValidDomain', () => {
    it('accepts valid domains', () => {
        expect(isValidDomain('example.com')).toBe(true);
        expect(isValidDomain('sub.example.co.uk')).toBe(true);
        expect(isValidDomain('a-b.example.com')).toBe(true);
    });
    it('rejects invalid domains', () => {
        expect(isValidDomain('')).toBe(false);
        expect(isValidDomain(null)).toBe(false);
        expect(isValidDomain('not a domain')).toBe(false);
        expect(isValidDomain('a'.repeat(254))).toBe(false);
        expect(isValidDomain('-example.com')).toBe(false);
    });
});

describe('isValidUrl', () => {
    it('accepts http/https URLs', () => {
        expect(isValidUrl('https://example.com')).toBe(true);
        expect(isValidUrl('http://example.com/path?q=1')).toBe(true);
    });
    it('rejects non-http URLs', () => {
        expect(isValidUrl('ftp://example.com')).toBe(false);
        expect(isValidUrl('javascript:alert(1)')).toBe(false);
        expect(isValidUrl('not-a-url')).toBe(false);
    });
});

describe('isValidEmail', () => {
    it('accepts valid emails', () => {
        expect(isValidEmail('user@example.com')).toBe(true);
        expect(isValidEmail('user+tag@sub.example.com')).toBe(true);
    });
    it('rejects invalid emails', () => {
        expect(isValidEmail('not-an-email')).toBe(false);
        expect(isValidEmail('@example.com')).toBe(false);
        expect(isValidEmail('user@')).toBe(false);
    });
});

describe('isValidUsername', () => {
    it('accepts valid usernames', () => {
        expect(isValidUsername('john_doe')).toBe(true);
        expect(isValidUsername('user.name')).toBe(true);
        expect(isValidUsername('user-123')).toBe(true);
    });
    it('rejects too short/long usernames', () => {
        expect(isValidUsername('ab')).toBe(false);
        expect(isValidUsername('a'.repeat(51))).toBe(false);
    });
    it('rejects shell metacharacters', () => {
        expect(isValidUsername('user;rm -rf')).toBe(false);
        expect(isValidUsername('user$(whoami)')).toBe(false);
        expect(isValidUsername('user`id`')).toBe(false);
    });
    it('rejects null/undefined', () => {
        expect(isValidUsername(null)).toBe(false);
        expect(isValidUsername(undefined)).toBe(false);
        expect(isValidUsername('')).toBe(false);
    });
});

describe('isValidIpAddress', () => {
    it('accepts valid IPv4', () => {
        expect(isValidIpAddress('192.168.1.1')).toBe(true);
        expect(isValidIpAddress('8.8.8.8')).toBe(true);
    });
    it('rejects invalid IPs', () => {
        expect(isValidIpAddress('999.999.999.999')).toBe(false);
        expect(isValidIpAddress('not-an-ip')).toBe(false);
        expect(isValidIpAddress(null)).toBe(false);
    });
});

describe('isValidCryptoAddress', () => {
    it('accepts valid Ethereum addresses', () => {
        expect(isValidCryptoAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38')).toBe(true);
    });
    it('rejects invalid addresses', () => {
        expect(isValidCryptoAddress('not-a-crypto-address')).toBe(false);
        expect(isValidCryptoAddress(null)).toBe(false);
    });
});

describe('sanitizeInput', () => {
    it('strips shell metacharacters', () => {
        expect(sanitizeInput('hello;world')).toBe('helloworld');
        expect(sanitizeInput('test|pipe')).toBe('testpipe');
        expect(sanitizeInput('$(rm -rf /)')).toBe('rm -rf /');
    });
    it('strips newlines and null bytes', () => {
        expect(sanitizeInput('hello\nworld')).toBe('helloworld');
        expect(sanitizeInput('hello\rworld')).toBe('helloworld');
        expect(sanitizeInput('hello\0world')).toBe('helloworld');
    });
    it('strips fullwidth unicode characters', () => {
        expect(sanitizeInput('hello\uFF1Bworld')).toBe('helloworld');
    });
    it('truncates to 1000 chars', () => {
        expect(sanitizeInput('a'.repeat(2000)).length).toBe(1000);
    });
    it('handles null/undefined', () => {
        expect(sanitizeInput(null)).toBe('');
        expect(sanitizeInput(undefined)).toBe('');
        expect(sanitizeInput(42)).toBe('');
    });
});

describe('containsMaliciousPatterns', () => {
    it('detects eval/exec patterns', () => {
        expect(containsMaliciousPatterns('eval(code)')).toBe(true);
        expect(containsMaliciousPatterns('exec(cmd)')).toBe(true);
    });
    it('detects script tags', () => {
        expect(containsMaliciousPatterns('<script>alert(1)</script>')).toBe(true);
    });
    it('detects prototype pollution', () => {
        expect(containsMaliciousPatterns('__proto__')).toBe(true);
        expect(containsMaliciousPatterns('constructor')).toBe(true);
    });
    it('passes clean input', () => {
        expect(containsMaliciousPatterns('hello world')).toBe(false);
        expect(containsMaliciousPatterns('normal text 123')).toBe(false);
    });
    it('handles null/undefined', () => {
        expect(containsMaliciousPatterns(null)).toBe(false);
        expect(containsMaliciousPatterns(undefined)).toBe(false);
    });
});
