/**
 * File: exif.js
 * Description: Image metadata extraction and GPS coordinate analysis
 * Author: gl0bal01
 * 
 * This command extracts comprehensive EXIF metadata from images including:
 * - Camera information (make, model, settings)
 * - GPS coordinates with map URL generation
 * - Image properties (dimensions, format, creation date)
 * - Technical metadata (exposure, ISO, focal length)
 * 
 * Features:
 * - Automatic GPS coordinate mapping to multiple map services
 * - Image format validation and magic byte detection
 * - Secure file handling with cleanup
 * - Support for multiple image formats (JPEG, PNG, GIF, WEBP, TIFF, BMP)
 * 
 * Dependencies:
 * - ExifTool (external binary)
 * - GPS2MapUrl.config for coordinate mapping
 * 
 * Usage: /bob-exif url:https://example.com/image.jpg
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const util = require('util');
const { URL } = require('url');
const crypto = require('crypto');
const { isValidUrl, sanitizeInput } = require('../utils/validation');

// Promisify exec for async/await usage
const execPromise = util.promisify(exec);
const fsPromises = require('fs').promises;

// Ensure the temp directory exists
const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-exif')
        .setDescription('Extract comprehensive EXIF metadata from an image URL')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('Direct URL to the image file')
                .setRequired(true)
                .setMaxLength(2048))
        .addBooleanOption(option =>
            option.setName('detailed')
                .setDescription('Include all technical metadata (default: true)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('privacy-mode')
                .setDescription('Redact potentially sensitive information (default: false)')
                .setRequired(false)),
                
    /**
     * Execute the EXIF extraction command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        try {
            // Get and validate URL input
            const rawUrl = interaction.options.getString('url');
            const imageUrl = sanitizeInput(rawUrl);
            const includeDetailed = interaction.options.getBoolean('detailed') || true;
            const privacyMode = interaction.options.getBoolean('privacy-mode') || false;
            
            // Validate URL format
            if (!isValidUrl(imageUrl)) {
                return interaction.reply({
                    content: '❌ **Invalid URL Format**\n' +
                            'Please provide a valid HTTPS URL to an image.\n\n' +
                            '**Example:** `https://example.com/photo.jpg`\n' +
                            '**Supported formats:** JPEG, PNG, GIF, WEBP, TIFF, BMP\n' +
                            '**Note:** Only HTTPS URLs are accepted for security reasons.',
                    ephemeral: true
                });
            }
            
            // Parse URL for additional validation
            let parsedUrl;
            try {
                parsedUrl = new URL(imageUrl);
                if (parsedUrl.protocol !== 'https:') {
                    throw new Error('Invalid protocol');
                }
            } catch (error) {
                return interaction.reply({
                    content: '❌ **URL Validation Failed**\n' +
                            'The provided URL is not accessible or uses an unsupported protocol.\n' +
                            'Only HTTPS URLs are supported for security reasons.\n' +
                            'HTTP connections transmit data in cleartext and are not allowed.',
                    ephemeral: true
                });
            }
            
            await interaction.deferReply();
            
            console.log(`📸 [EXIF] Starting metadata extraction for: ${imageUrl}`);
            
            try {
                // Generate unique filename to prevent collisions
                const randomId = crypto.randomBytes(8).toString('hex');
                const timestamp = Date.now();
                const fileExtension = getExtensionFromUrl(imageUrl);
                const imagePath = path.join(tempDir, `exif_${timestamp}_${randomId}.${fileExtension}`);
                
                // Download the image with validation
                await downloadImageFromUrl(imageUrl, imagePath);
                
                // Verify downloaded file
                const fileStats = await validateDownloadedFile(imagePath);
                console.log(`📁 [EXIF] Downloaded file: ${path.basename(imagePath)} (${fileStats.size} bytes)`);
                
                // Verify it's actually an image file
                if (!await isImageFile(imagePath)) {
                    await cleanupFile(imagePath);
                    return interaction.editReply({
                        content: '❌ **Invalid Image File**\n' +
                                'The downloaded file is not a valid image format.\n\n' +
                                '**Possible issues:**\n' +
                                '• URL points to non-image content\n' +
                                '• Image is corrupted or incomplete\n' +
                                '• Unsupported image format'
                    });
                }
                
                // Extract EXIF data using ExifTool
                const exifData = await extractExifData(imagePath, includeDetailed);
                
                // Format the extracted data
                const formattedData = formatExifData(exifData, includeDetailed, privacyMode);
                
                // Create response with attachment
                await sendExifResults(interaction, formattedData, imageUrl, fileStats, exifData);
                
                // Clean up temporary file
                await cleanupFile(imagePath);
                
                console.log(`✅ [EXIF] Successfully extracted metadata from: ${imageUrl}`);
                
            } catch (error) {
                console.error(`❌ [EXIF] Error processing image from ${imageUrl}:`, error.message);
                await handleExifError(interaction, error, imageUrl);
            }
            
        } catch (unexpectedError) {
            console.error('❌ [EXIF] Unexpected error:', unexpectedError);
            
            const errorResponse = {
                content: '❌ **Unexpected Error**\n' +
                        'An unexpected error occurred while processing the image. Please try again later.',
                ephemeral: true
            };
            
            if (interaction.deferred) {
                await interaction.editReply(errorResponse);
            } else {
                await interaction.reply(errorResponse);
            }
        }
    },
};

/**
 * Download image from URL with proper error handling
 * @param {string} url - Image URL to download
 * @param {string} filePath - Local path to save the file
 * @returns {Promise<string>} Resolved with file path when complete
 */
async function downloadImageFromUrl(url, filePath) {
    return new Promise((resolve, reject) => {
        console.log(`⬇️ [EXIF] Downloading image from: ${url}`);

        const file = fs.createWriteStream(filePath);

        // Set timeout for download
        const timeout = setTimeout(() => {
            file.close();
            fs.unlink(filePath, () => {});
            reject(new Error('Download timeout after 30 seconds'));
        }, 30000);

        https.get(url, {
            headers: {
                'User-Agent': 'Discord-OSINT-Assistant/2.0 (Image-Analyzer)'
            }
        }, (response) => {
            // Check response status
            if (response.statusCode !== 200) {
                clearTimeout(timeout);
                file.close();
                fs.unlink(filePath, () => {});
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            
            // Check content type if available
            const contentType = response.headers['content-type'];
            if (contentType && !contentType.startsWith('image/')) {
                console.warn(`⚠️ [EXIF] Unexpected content type: ${contentType}`);
            }
            
            // Check content length
            const contentLength = parseInt(response.headers['content-length']);
            if (contentLength && contentLength > 50 * 1024 * 1024) { // 50MB limit
                clearTimeout(timeout);
                file.close();
                fs.unlink(filePath, () => {});
                reject(new Error('Image file too large (max 50MB)'));
                return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                clearTimeout(timeout);
                file.close(() => {
                    console.log(`✅ [EXIF] Successfully downloaded to: ${filePath}`);
                    resolve(filePath);
                });
            });
            
            file.on('error', (err) => {
                clearTimeout(timeout);
                fs.unlink(filePath, () => {});
                reject(err);
            });
            
        }).on('error', (err) => {
            clearTimeout(timeout);
            fs.unlink(filePath, () => {});
            reject(err);
        });
    });
}

/**
 * Validate downloaded file exists and has content
 * @param {string} filePath - Path to the downloaded file
 * @returns {Promise<Object>} File statistics
 */
async function validateDownloadedFile(filePath) {
    try {
        const stats = await fsPromises.stat(filePath);
        
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }
        
        if (stats.size > 50 * 1024 * 1024) { // 50MB limit
            throw new Error('File too large (max 50MB)');
        }
        
        return stats;
    } catch (error) {
        throw new Error(`File validation failed: ${error.message}`);
    }
}

/**
 * Check if file is a valid image by examining magic bytes
 * @param {string} filePath - Path to the file to check
 * @returns {Promise<boolean>} True if file is a valid image
 */
async function isImageFile(filePath) {
    try {
        const buffer = await fsPromises.readFile(filePath, { encoding: null });
        
        if (buffer.length < 4) return false;
        
        // Check magic bytes for common image formats
        const magicBytes = [
            { format: 'JPEG', signature: [0xFF, 0xD8, 0xFF] },
            { format: 'PNG', signature: [0x89, 0x50, 0x4E, 0x47] },
            { format: 'GIF', signature: [0x47, 0x49, 0x46, 0x38] },
            { format: 'BMP', signature: [0x42, 0x4D] },
            { format: 'WEBP', signature: [0x52, 0x49, 0x46, 0x46], offset: 0, additional: [0x57, 0x45, 0x42, 0x50], additionalOffset: 8 },
            { format: 'TIFF_LE', signature: [0x49, 0x49, 0x2A, 0x00] },
            { format: 'TIFF_BE', signature: [0x4D, 0x4D, 0x00, 0x2A] }
        ];
        
        for (const magic of magicBytes) {
            let matches = true;
            
            // Check main signature
            for (let i = 0; i < magic.signature.length; i++) {
                if (buffer[i] !== magic.signature[i]) {
                    matches = false;
                    break;
                }
            }
            
            // Check additional signature for formats like WEBP
            if (matches && magic.additional) {
                for (let i = 0; i < magic.additional.length; i++) {
                    if (buffer[magic.additionalOffset + i] !== magic.additional[i]) {
                        matches = false;
                        break;
                    }
                }
            }
            
            if (matches) {
                console.log(`🖼️ [EXIF] Detected image format: ${magic.format}`);
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('[EXIF] Error checking image format:', error);
        return false;
    }
}

/**
 * Extract EXIF data using ExifTool
 * @param {string} imagePath - Path to the image file
 * @param {boolean} includeDetailed - Whether to include all metadata
 * @returns {Promise<Object>} Parsed EXIF data
 */
async function extractExifData(imagePath, includeDetailed = false) {
    try {
        // Get ExifTool path from environment or use default
        const exiftoolPath = process.env.EXIFTOOL_PATH || 'exiftool';
        
        // Build ExifTool command
        const configPath = path.resolve('./addons/GPS2MapUrl.config');
        let command = `"${exiftoolPath}" -config "${configPath}" -json`;
        
        if (!includeDetailed) {
            // Only extract essential metadata
            command += ' -EXIF:* -GPS:* -IPTC:* -XMP:* -ICC_Profile:ColorSpace -File:*';
        }
        
        command += ` "${imagePath}"`;
        
        console.log(`🔧 [EXIF] Running ExifTool command: ${command}`);
        
        // Execute ExifTool with timeout
        const { stdout, stderr } = await execPromise(command, {
            timeout: 30000, // 30 second timeout
            maxBuffer: 1024 * 1024 * 5 // 5MB buffer
        });
        
        if (stderr && !stderr.includes('Warning')) {
            console.warn('[EXIF] ExifTool warnings:', stderr);
        }
        
        // Parse JSON output
        const exifArray = JSON.parse(stdout);
        const exifData = exifArray[0] || {};
        
        console.log(`📊 [EXIF] Extracted ${Object.keys(exifData).length} metadata fields`);
        
        return exifData;
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('ExifTool not found. Please install ExifTool and ensure it\'s in your PATH.');
        } else if (error.killed) {
            throw new Error('ExifTool process timed out');
        } else {
            throw new Error(`ExifTool error: ${error.message}`);
        }
    }
}

/**
 * Format EXIF data for display
 * @param {Object} data - Raw EXIF data
 * @param {boolean} includeDetailed - Include all metadata
 * @param {boolean} privacyMode - Redact sensitive information
 * @returns {string} Formatted EXIF data
 */
function formatExifData(data, includeDetailed = false, privacyMode = false) {
    const sections = {
        'Camera Information': [
            'Make', 'Model', 'LensModel', 'LensInfo', 'Software', 'SerialNumber'
        ],
        'Image Settings': [
            'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat',
            'ExposureCompensation', 'MeteringMode', 'ExposureMode', 'WhiteBalance', 
            'Flash', 'ExposureProgram', 'SceneCaptureType'
        ],
        'Image Properties': [
            'FileName', 'FileSize', 'ImageWidth', 'ImageHeight', 'ImageSize', 
            'Megapixels', 'ColorSpace', 'FileType', 'MIMEType'
        ],
        'Date & Time': [
            'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'FileModifyDate'
        ],
        'GPS Location': [
            'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSPosition', 
            'GPSDateTime', 'GPSMapDatum', 'GoogleMapsUrl', 'OpenStreetMapsUrl',
            'BingMapsUrl', 'YandexMapsUrl', 'MapquestMapsUrl'
        ]
    };
    
    let output = '';
    
    // Group data by sections
    const categorizedData = {};
    const processedKeys = new Set();
    
    // Process known sections
    for (const [sectionName, keys] of Object.entries(sections)) {
        const sectionData = {};
        
        for (const key of keys) {
            if (data[key] !== undefined && data[key] !== null) {
                // Apply privacy mode filtering
                if (privacyMode && isSensitiveField(key)) {
                    sectionData[key] = '[REDACTED]';
                } else {
                    sectionData[key] = data[key];
                }
                processedKeys.add(key);
            }
        }
        
        if (Object.keys(sectionData).length > 0) {
            categorizedData[sectionName] = sectionData;
        }
    }
    
    // Include additional metadata if detailed mode is enabled
    if (includeDetailed) {
        const additionalData = {};
        for (const [key, value] of Object.entries(data)) {
            if (!processedKeys.has(key) && 
                key !== 'SourceFile' && 
                key !== 'ExifToolVersion' && 
                key !== 'Directory' &&
                value !== null && 
                value !== undefined) {
                
                if (privacyMode && isSensitiveField(key)) {
                    additionalData[key] = '[REDACTED]';
                } else {
                    additionalData[key] = value;
                }
            }
        }
        
        if (Object.keys(additionalData).length > 0) {
            categorizedData['Additional Metadata'] = additionalData;
        }
    }
    
    // Format output
    for (const [sectionName, sectionData] of Object.entries(categorizedData)) {
        output += `=== ${sectionName} ===\n`;
        
        for (const [key, value] of Object.entries(sectionData)) {
            if (Array.isArray(value)) {
                output += `${key}: ${value.join(', ')}\n`;
            } else if (typeof value === 'object') {
                output += `${key}: ${JSON.stringify(value)}\n`;
            } else {
                // Format URLs as clickable links
                const formattedValue = isUrlField(key) ? formatClickableUrl(value) : value;
                output += `${key}: ${formattedValue}\n`;
            }
        }
        
        output += '\n';
    }
    
    return output || 'No EXIF metadata found in the image.';
}

/**
 * Check if a field contains sensitive information
 * @param {string} fieldName - Name of the metadata field
 * @returns {boolean} True if field may contain sensitive data
 */
function isSensitiveField(fieldName) {
    const sensitiveFields = [
        'SerialNumber', 'CameraOwnerName', 'Artist', 'Copyright',
        'OwnerName', 'UserComment', 'ImageDescription', 'DocumentName'
    ];
    
    return sensitiveFields.some(field => 
        fieldName.toLowerCase().includes(field.toLowerCase())
    );
}

/**
 * Check if a value is a URL and format it as a clickable link
 * @param {string} value - Value to check and potentially format
 * @returns {string} Original value or formatted clickable link
 */
function formatClickableUrl(value) {
    // Check if value is a URL
    if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
        return `<${value}>`; // Discord markdown for clickable links
    }
    return value;
}

/**
 * Check if a field name indicates it contains a URL
 * @param {string} fieldName - Name of the metadata field
 * @returns {boolean} True if field likely contains a URL
 */
function isUrlField(fieldName) {
    const urlFields = [
        'GoogleMapsUrl', 'BingMapsUrl', 'OpenStreetMapsUrl', 
        'YandexMapsUrl', 'MapquestMapsUrl', 'Url', 'URL', 'Link'
    ];
    
    return urlFields.some(field => 
        fieldName.toLowerCase().includes(field.toLowerCase())
    );
}

/**
 * Send EXIF results to Discord
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} formattedData - Formatted EXIF data
 * @param {string} imageUrl - Original image URL
 * @param {Object} fileStats - File statistics
 */
async function sendExifResults(interaction, formattedData, imageUrl, fileStats, exifData) {
    const attachment = new AttachmentBuilder(
        Buffer.from(formattedData, 'utf8'),
        { name: 'exif_metadata.txt' }
    );
    
    // Create summary for the message
    let summary = `📸 **EXIF Metadata Analysis**\n`;
    summary += `🔗 **Source:** ${imageUrl}\n`;
    summary += `📏 **File Size:** ${formatFileSize(fileStats.size)}\n`;
    
    // Check for GPS data and include clickable map links
    if (formattedData.includes('GPSLatitude') && formattedData.includes('GPSLongitude')) {
        summary += `📍 **GPS Data Found!**\n`;
        
        // Add clickable map links if available
        const mapLinks = [];
        if (exifData.GoogleMapsUrl) mapLinks.push(`[Google Maps](<${exifData.GoogleMapsUrl}>)`);
        if (exifData.OpenStreetMapsUrl) mapLinks.push(`[OpenStreetMap](<${exifData.OpenStreetMapsUrl}>)`);
        if (exifData.BingMapsUrl) mapLinks.push(`[Bing Maps](<${exifData.BingMapsUrl}>)`);
        if (exifData.YandexMapsUrl) mapLinks.push(`[Yandex Maps](<${exifData.YandexMapsUrl}>)`);
        if (exifData.MapquestMapsUrl) mapLinks.push(`[MapQuest](<${exifData.MapquestMapsUrl}>)`);
        
        if (mapLinks.length > 0) {
            summary += `🗺️ **Quick Links:** ${mapLinks.join(' • ')}\n`;
        }
    }
    
    summary += `📄 **Full metadata attached as text file**`;
    
    await interaction.editReply({
        content: summary,
        files: [attachment]
    });
}

/**
 * Handle EXIF extraction errors
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Error} error - The error that occurred
 * @param {string} imageUrl - Original image URL
 */
async function handleExifError(interaction, error, imageUrl) {
    let errorMessage = '❌ **EXIF Extraction Failed**\n';
    
    if (error.message.includes('timeout')) {
        errorMessage += 'The operation timed out. The image may be too large or the server is slow.';
    } else if (error.message.includes('HTTP')) {
        errorMessage += `Failed to download image: ${error.message}`;
    } else if (error.message.includes('ExifTool not found')) {
        errorMessage += 'ExifTool is not installed or not found in PATH.\nPlease contact the administrator.';
    } else if (error.message.includes('too large')) {
        errorMessage += 'Image file is too large (maximum 50MB allowed).';
    } else if (error.message.includes('Invalid image')) {
        errorMessage += 'The file is not a valid image or is corrupted.';
    } else {
        errorMessage += `Unexpected error: ${error.message}`;
    }
    
    await interaction.editReply({
        content: errorMessage,
        ephemeral: false
    });
}

/**
 * Get file extension from URL
 * @param {string} url - URL to extract extension from
 * @returns {string} File extension (default: jpg)
 */
function getExtensionFromUrl(url) {
    try {
        const urlPath = new URL(url).pathname;
        const extension = path.extname(urlPath).slice(1).toLowerCase();
        
        const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'];
        
        return validExtensions.includes(extension) ? extension : 'jpg';
    } catch (error) {
        return 'jpg';
    }
}

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Clean up temporary file
 * @param {string} filePath - Path to file to delete
 */
async function cleanupFile(filePath) {
    try {
        await fsPromises.unlink(filePath);
        console.log(`🗑️ [EXIF] Cleaned up temporary file: ${path.basename(filePath)}`);
    } catch (error) {
        console.warn(`⚠️ [EXIF] Failed to cleanup file ${filePath}:`, error.message);
    }
}
