import { describe, it, expect } from 'vitest';
import { isPrivateIp } from '../../utils/ssrf.js';

describe('isPrivateIp', () => {
    it('detects 10.x.x.x range', () => {
        expect(isPrivateIp('10.0.0.1')).toBe(true);
        expect(isPrivateIp('10.255.255.255')).toBe(true);
    });
    it('detects 172.16-31.x.x range', () => {
        expect(isPrivateIp('172.16.0.1')).toBe(true);
        expect(isPrivateIp('172.31.255.255')).toBe(true);
    });
    it('detects 192.168.x.x range', () => {
        expect(isPrivateIp('192.168.1.1')).toBe(true);
        expect(isPrivateIp('192.168.0.0')).toBe(true);
    });
    it('detects localhost', () => {
        expect(isPrivateIp('127.0.0.1')).toBe(true);
        expect(isPrivateIp('127.255.255.255')).toBe(true);
    });
    it('detects link-local / cloud metadata', () => {
        expect(isPrivateIp('169.254.169.254')).toBe(true);
    });
    it('allows public IPs', () => {
        expect(isPrivateIp('8.8.8.8')).toBe(false);
        expect(isPrivateIp('1.1.1.1')).toBe(false);
        expect(isPrivateIp('93.184.216.34')).toBe(false);
        expect(isPrivateIp('172.32.0.1')).toBe(false);
    });
    it('detects private IPv6', () => {
        expect(isPrivateIp('::1')).toBe(true);
        expect(isPrivateIp('fe80::1')).toBe(true);
        expect(isPrivateIp('fd00::1')).toBe(true);
    });
    it('detects IPv4-mapped IPv6 private addresses', () => {
        expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
        expect(isPrivateIp('::ffff:192.168.1.1')).toBe(true);
        expect(isPrivateIp('::ffff:172.16.0.1')).toBe(true);
        expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
    });
    it('allows IPv4-mapped IPv6 public addresses', () => {
        expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
        expect(isPrivateIp('::ffff:1.1.1.1')).toBe(false);
        expect(isPrivateIp('::ffff:93.184.216.34')).toBe(false);
    });
});
