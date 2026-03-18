const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const dnsCallback = require('dns');

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
    // Handle IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1)
    if (ip.startsWith('::ffff:')) {
        const mappedIpv4 = ip.slice(7);
        if (net.isIPv4(mappedIpv4)) {
            return isPrivateIp(mappedIpv4);  // Recursively check the embedded IPv4
        }
    }

    if (net.isIPv6(ip)) {
        return ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fd') || ip.startsWith('fc');
    }
    if (!net.isIPv4(ip)) return true; // Block unknown formats
    const long = ipToLong(ip);
    return PRIVATE_RANGES.some(range => long >= ipToLong(range.start) && long <= ipToLong(range.end));
}

/**
 * Validates that a URL does not resolve to a private/internal IP address.
 * Checks both A (IPv4) and AAAA (IPv6) records to prevent bypasses.
 *
 * @param {string} url - The URL to validate.
 * @throws {Error} If the URL uses a disallowed protocol or resolves to a private IP.
 */
async function validateUrlNotInternal(url) {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are allowed');
    }

    // Check both IPv4 and IPv6 records
    let allAddresses = [];
    try { allAddresses.push(...await dns.resolve4(hostname)); } catch { /* no A records */ }
    try { allAddresses.push(...await dns.resolve6(hostname)); } catch { /* no AAAA records */ }

    if (allAddresses.length === 0) {
        throw new Error(`Could not resolve hostname: ${hostname}`);
    }

    for (const ip of allAddresses) {
        if (isPrivateIp(ip)) {
            throw new Error('URL resolves to a private/internal IP address');
        }
    }
}

/**
 * Create HTTP/HTTPS agents that validate resolved IPs at connect time,
 * preventing DNS rebinding attacks.
 */
function createSafeAgent(protocol) {
    const AgentClass = protocol === 'https:' ? https.Agent : http.Agent;
    return new AgentClass({
        lookup(hostname, options, callback) {
            dnsCallback.lookup(hostname, options, (err, address, family) => {
                if (err) return callback(err);
                if (isPrivateIp(address)) {
                    return callback(new Error('Connection to private/internal IP address blocked'));
                }
                callback(null, address, family);
            });
        }
    });
}

/**
 * Returns axios config objects with safe HTTP/HTTPS agents that block
 * connections to private/internal IP addresses at connect time.
 */
function getSafeAxiosConfig() {
    return {
        httpAgent: createSafeAgent('http:'),
        httpsAgent: createSafeAgent('https:')
    };
}

module.exports = { validateUrlNotInternal, isPrivateIp, getSafeAxiosConfig };
