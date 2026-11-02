const murmurhash = require('murmurhash');

/**
 * Favicon hash as indexed by Shodan (`http.favicon.hash`), BinaryEdge
 * (`web.favicon.mmh3`) and ZoomEye (`iconhash`): Python's
 * `mmh3.hash(codecs.encode(data, 'base64'))`, i.e. the signed 32-bit
 * MurmurHash3 of base64 wrapped at 76 chars with a newline after every line.
 * @param {Buffer} buffer - Raw favicon bytes.
 * @returns {number} Signed 32-bit integer.
 */
function shodanFaviconHash(buffer) {
    const wrapped = buffer.toString('base64').replace(/.{1,76}/g, '$&\n');
    return murmurhash.v3(wrapped) | 0;
}

module.exports = { shodanFaviconHash };
