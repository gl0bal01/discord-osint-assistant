/**
 * File: utils/validation.js
 * Description: Input validation utilities for OSINT commands
 * Author: gl0bal01
 * 
 * This module provides common validation functions to ensure user inputs
 * are safe and properly formatted for OSINT operations.
 */

/**
 * Validates a domain name format
 * @param {string} domain - Domain to validate
 * @returns {boolean} Whether the domain is valid
 */
function isValidDomain(domain) {
    // Basic domain validation regex
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    
    if (!domain || typeof domain !== 'string') {
        return false;
    }
    
    // Check length constraints
    if (domain.length > 253) {
        return false;
    }
    
    // Check for valid characters and format
    return domainRegex.test(domain);
}

/**
 * Validates a URL format
 * @param {string} url - URL to validate
 * @returns {boolean} Whether the URL is valid
 */
function isValidUrl(url) {
    try {
        const urlObj = new URL(url);
        return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (error) {
        return false;
    }
}

/**
 * Validates an email address format
 * @param {string} email - Email to validate
 * @returns {boolean} Whether the email is valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validates a username format (alphanumeric with common special chars)
 * @param {string} username - Username to validate
 * @returns {boolean} Whether the username is valid
 */
function isValidUsername(username) {
    // Allow alphanumeric, underscores, dots, and hyphens
    const usernameRegex = /^[a-zA-Z0-9_.-]+$/;
    
    if (!username || typeof username !== 'string') {
        return false;
    }
    
    // Check length constraints (3-50 characters)
    if (username.length < 3 || username.length > 50) {
        return false;
    }
    
    return usernameRegex.test(username);
}

/**
 * Validates an IP address (IPv4 or IPv6)
 * @param {string} ip - IP address to validate
 * @returns {boolean} Whether the IP address is valid
 */
function isValidIpAddress(ip) {
    // IPv4 regex
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6 regex (simplified)
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    if (!ip || typeof ip !== 'string') {
        return false;
    }
    
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Validates a cryptocurrency address (basic validation)
 * @param {string} address - Crypto address to validate
 * @returns {boolean} Whether the address appears to be valid
 */
function isValidCryptoAddress(address) {
    if (!address || typeof address !== 'string') {
        return false;
    }
    
    // Bitcoin address patterns
    const btcRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/;
    
    // Ethereum address pattern
    const ethRegex = /^0x[a-fA-F0-9]{40}$/;
    
    // Litecoin address pattern
    const ltcRegex = /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/;
    
    return btcRegex.test(address) || ethRegex.test(address) || ltcRegex.test(address);
}

/**
 * Sanitizes user input to prevent injection attacks
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
    if (!input || typeof input !== 'string') {
        return '';
    }
    
    // Remove potentially dangerous characters
    return input
        .replace(/[<>\"';&|`$(){}[\]\\]/g, '')
        .trim()
        .slice(0, 1000); // Limit length
}

/**
 * Validates file extension for image files
 * @param {string} filename - Filename to check
 * @returns {boolean} Whether the file is a valid image
 */
function isValidImageFile(filename) {
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return validExtensions.includes(extension);
}

/**
 * Checks if a string contains potentially malicious patterns
 * @param {string} input - Input to check
 * @returns {boolean} Whether the input contains suspicious patterns
 */
function containsMaliciousPatterns(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    
    const maliciousPatterns = [
        /\b(eval|exec|system|shell_exec|passthru)\s*\(/i,
        /<script[^>]*>.*?<\/script>/gi,
        /javascript:/i,
        /data:text\/html/i,
        /\$\{.*\}/g, // Template literal injection
        /__proto__|constructor|prototype/i
    ];
    
    return maliciousPatterns.some(pattern => pattern.test(input));
}

module.exports = {
    isValidDomain,
    isValidUrl,
    isValidEmail,
    isValidUsername,
    isValidIpAddress,
    isValidCryptoAddress,
    sanitizeInput,
    isValidImageFile,
    containsMaliciousPatterns
};
