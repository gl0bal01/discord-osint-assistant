const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');

const PRIVATE_RANGES = [
    { start: '10.0.0.0', end: '10.255.255.255' },
    { start: '172.16.0.0', end: '172.31.255.255' },
    { start: '192.168.0.0', end: '192.168.255.255' },
    { start: '127.0.0.0', end: '127.255.255.255' },
    { start: '169.254.0.0', end: '169.254.255.255' },
    { start: '0.0.0.0', end: '0.255.255.255' }
];

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIp(ip) {
    if (net.isIPv6(ip)) {
        return ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fd') || ip.startsWith('fc');
    }
    if (!net.isIPv4(ip)) return true;
    const long = ipToLong(ip);
    return PRIVATE_RANGES.some(range => long >= ipToLong(range.start) && long <= ipToLong(range.end));
}

async function validateUrlNotInternal(url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are allowed');
    }
    let addresses;
    try {
        addresses = await dns.resolve4(parsed.hostname);
    } catch {
        try {
            addresses = await dns.resolve6(parsed.hostname);
        } catch {
            throw new Error(`Could not resolve hostname: ${parsed.hostname}`);
        }
    }
    for (const ip of addresses) {
        if (isPrivateIp(ip)) {
            throw new Error('URL resolves to a private/internal IP address');
        }
    }
}

module.exports = { validateUrlNotInternal, isPrivateIp };
