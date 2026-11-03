const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const dnsCallback = require('dns');

// Every non-globally-routable range (IANA special-purpose registries). net.BlockList
// also matches IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1) against the IPv4 rules.
const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]
]) BLOCKED.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
    ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32],
    ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
]) BLOCKED.addSubnet(addr, prefix, 'ipv6');

function isPrivateIp(ip) {
    const family = net.isIP(ip);
    if (!family) return true; // Block unknown formats
    return BLOCKED.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

const stripBrackets = (host) => String(host ?? '').replace(/^\[|\]$/g, '');

function blockedError() {
    return Object.assign(new Error('Connection to private/internal IP address blocked'), { code: 'ESSRF' });
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

    const literal = stripBrackets(hostname);
    if (net.isIP(literal)) {
        if (isPrivateIp(literal)) throw new Error('URL resolves to a private/internal IP address');
        return;
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
    const agent = new AgentClass({
        keepAlive: true,
        lookup(hostname, options, callback) {
            // Always resolve with all:true so we can validate every record,
            // but mirror the caller's `all` flag in the callback signature
            // (some Node internals pass all:true and expect an array back).
            const wantsAll = !!(options && options.all);
            const opts = { ...options, all: true, family: 0 };
            dnsCallback.lookup(hostname, opts, (err, addresses) => {
                if (err) return callback(err);
                const list = Array.isArray(addresses)
                    ? addresses
                    : (addresses ? [{ address: addresses, family: opts.family || 4 }] : []);
                const valid = list.filter(a => a && typeof a.address === 'string' && a.address.length > 0);
                if (valid.length === 0) {
                    return callback(new Error(`Could not resolve hostname: ${hostname}`));
                }
                for (const a of valid) {
                    if (isPrivateIp(a.address)) {
                        return callback(blockedError());
                    }
                }
                if (wantsAll) {
                    return callback(null, valid.map(a => ({
                        address: a.address,
                        family: a.family || (net.isIPv6(a.address) ? 6 : 4)
                    })));
                }
                const first = valid[0];
                callback(null, first.address, first.family || (net.isIPv6(first.address) ? 6 : 4));
            });
        }
    });
    // Node never calls `lookup` for an IP-literal host (http://127.0.0.1/, or a redirect
    // to one), so check literals here, before any socket opens.
    const createConnection = agent.createConnection;
    agent.createConnection = function (options, callback) {
        const host = stripBrackets(options?.host ?? options?.hostname);
        if (net.isIP(host) && isPrivateIp(host)) {
            const err = blockedError();
            if (typeof callback === 'function') { callback(err); return undefined; }
            throw err;
        }
        return createConnection.call(this, options, callback);
    };
    return agent;
}

// Singletons. Lookup hook is stateless; reusing the agents keeps the
// keepalive socket pool warm across calls.
const SAFE_HTTP_AGENT = createSafeAgent('http:');
const SAFE_HTTPS_AGENT = createSafeAgent('https:');

const SAFE_AXIOS_CONFIG = Object.freeze({
    httpAgent: SAFE_HTTP_AGENT,
    httpsAgent: SAFE_HTTPS_AGENT
});

/**
 * Returns axios config with safe HTTP/HTTPS agents that block connections
 * to private/internal IP addresses at connect time.
 */
function getSafeAxiosConfig() {
    return SAFE_AXIOS_CONFIG;
}

// Common response-size budgets for axios maxContentLength / maxBodyLength.
const SIZE_5MB = 5 * 1024 * 1024;
const SIZE_10MB = 10 * 1024 * 1024;
const SIZE_50MB = 50 * 1024 * 1024;

module.exports = {
    validateUrlNotInternal,
    isPrivateIp,
    getSafeAxiosConfig,
    SIZE_5MB, SIZE_10MB, SIZE_50MB
};
