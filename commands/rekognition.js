/**
 * File: rekognition.js
 * Description: Command to analyze images and compare faces using AWS Rekognition
 * Author: global01
 * 
 * This command interfaces with AWS Rekognition to perform advanced image analysis
 * including object detection, text extraction, face analysis, and face comparison
 * between two images.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
// Import AWS SDK v3 modules
const { RekognitionClient, DetectLabelsCommand, DetectTextCommand, 
  DetectFacesCommand, DetectModerationLabelsCommand, 
  RecognizeCelebritiesCommand, CompareFacesCommand } = require('@aws-sdk/client-rekognition');
require('dotenv').config();

// Initialize the AWS Rekognition client (v3)
const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-rekognition')
        .setDescription('Analyze images using AWS Rekognition')
        .addSubcommand(subcommand =>
            subcommand
                .setName('analyze')
                .setDescription('Analyze a single image for objects, text, faces, and more')
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('URL of the image to analyze')
                        .setRequired(false))
                .addAttachmentOption(option =>
                    option.setName('image')
                        .setDescription('Upload an image to analyze')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('features')
                        .setDescription('Features to analyze (comma-separated)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All Features', value: 'all' },
                            { name: 'Labels (Objects)', value: 'labels' },
                            { name: 'Text', value: 'text' },
                            { name: 'Faces', value: 'faces' },
                            { name: 'Moderation', value: 'moderation' },
                            { name: 'Celebrities', value: 'celebrities' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('compare')
                .setDescription('Compare faces between two images')
                .addStringOption(option =>
                    option.setName('source_url')
                        .setDescription('URL of the source image with reference face')
                        .setRequired(false))
                .addAttachmentOption(option =>
                    option.setName('source_image')
                        .setDescription('Upload a source image with reference face')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('target_url')
                        .setDescription('URL of the target image to compare with')
                        .setRequired(false))
                .addAttachmentOption(option =>
                    option.setName('target_image')
                        .setDescription('Upload a target image to compare with')
                        .setRequired(false))
                .addNumberOption(option =>
                    option.setName('similarity')
                        .setDescription('Minimum similarity threshold (0-100)')
                        .setRequired(false))),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            // Check if AWS credentials are configured
            if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
                return interaction.editReply('AWS credentials are not properly configured. Please add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to your environment variables.');
            }
            
            const subcommand = interaction.options.getSubcommand();
            
            // Use the temp directory in the project
            const tempDir = path.join(__dirname, '..', 'temp');
            
            // Ensure the temp directory exists
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            if (subcommand === 'analyze') {
                await handleAnalyze(interaction, tempDir);
            } else if (subcommand === 'compare') {
                await handleCompare(interaction, tempDir);
            }
        } catch (error) {
            console.error('Error in rekognition command:', error);
            
            let errorMessage = 'An error occurred while processing your request.';
            
            if (error.code === 'InvalidImageFormatException') {
                errorMessage = 'The provided image is in an invalid format. Please use JPEG or PNG format.';
            } else if (error.code === 'InvalidParameterException') {
                errorMessage = 'Invalid parameter: ' + error.message;
            } else if (error.code === 'ImageTooLargeException') {
                errorMessage = 'The image is too large. Maximum size is 5MB for JPEG and 8MB for PNG.';
            } else if (error.code === 'AccessDeniedException') {
                errorMessage = 'AWS access denied. Please check your credentials and permissions.';
            } else if (error.message) {
                errorMessage = `Error: ${error.message}`;
            }
            
            await interaction.editReply(errorMessage);
        } finally {
            // Clean up temp files after a delay (don't delete the entire temp directory)
            setTimeout(() => {
                try {
                    // Just clean up the files we created in this command execution
                    // Get all files that match our timestamp or command-specific naming
                    const currentTime = Date.now();
                    const cleanupTime = 60000; // 1 minute
                    
                    const files = fs.readdirSync(tempDir).filter(file => {
                        // Only delete files created by this command that are older than a few seconds
                        if (file.includes('rekognition_') || file.includes('face_comparison') || 
                            file.startsWith('source_') || file.startsWith('target_') || 
                            file.startsWith('original_')) {
                            
                            const filePath = path.join(tempDir, file);
                            const stats = fs.statSync(filePath);
                            const fileAge = currentTime - stats.mtime.getTime();
                            
                            // Only delete files older than a few seconds to avoid race conditions
                            return fileAge > 10000; // 10 seconds
                        }
                        return false;
                    });
                    
                    // Delete matching files
                    for (const file of files) {
                        fs.unlinkSync(path.join(tempDir, file));
                    }
                } catch (cleanupError) {
                    console.error('Error cleaning up files:', cleanupError);
                }
            }, 5000); // Wait 5 seconds before cleaning up
        }
    },
};

/**
 * Handle the analyze subcommand
 * @param {object} interaction - Discord interaction
 * @param {string} tempDir - Temporary directory for files
 */
async function handleAnalyze(interaction, tempDir) {
    try {
        const imageUrl = interaction.options.getString('url');
        const uploadedImage = interaction.options.getAttachment('image');
        const featureOption = interaction.options.getString('features') || 'all';
        
        // Check if we have either a URL or an uploaded image
        if (!imageUrl && !uploadedImage) {
            return await interaction.editReply('Please provide either an image URL or upload an image.');
        }

        let imageBuffer;
        let sourceDescription;
        let imageAttachment = null;
        
        if (uploadedImage) {
            // Handle uploaded image
            sourceDescription = `uploaded image (${uploadedImage.name})`;
            
            // Validate image attachment
            if (!uploadedImage.contentType || !uploadedImage.contentType.startsWith('image/')) {
                return await interaction.editReply('The uploaded file is not an image. Please upload a valid image file.');
            }
            
            // Update status
            await interaction.editReply(`📷 Processing uploaded image (${uploadedImage.name})...`);
            
            try {
                // Download the attachment
                const response = await axios.get(uploadedImage.url, { 
                    responseType: 'arraybuffer',
                    timeout: 10000 // 10 second timeout
                });
                
                imageBuffer = Buffer.from(response.data);
                
                // Save the image locally so we can attach it to our response
                const imagePath = path.join(tempDir, `original_${uploadedImage.name}`);
                fs.writeFileSync(imagePath, imageBuffer);
                
                // Create an attachment to send back
                imageAttachment = new AttachmentBuilder(imagePath, {
                    name: uploadedImage.name,
                    description: 'Original uploaded image'
                });
            } catch (error) {
                console.error('Error downloading attachment:', error);
                throw new Error('Failed to download the uploaded image. Please try again or provide an image URL instead.');
            }
        } else {
            // Handle image URL
            sourceDescription = imageUrl;
            
            // Validate URL
            if (!isValidUrl(imageUrl)) {
                return await interaction.editReply('Please provide a valid image URL starting with http:// or https://');
            }
            
            // Update status
            await interaction.editReply(`📷 Downloading and analyzing image from ${imageUrl}...`);
            
            try {
                // Download the image
                const imagePath = await downloadImage(imageUrl, tempDir);
                
                // Read the image as a buffer
                imageBuffer = fs.readFileSync(imagePath);
                
                // Create an attachment to send back
                const fileName = path.basename(imagePath);
                imageAttachment = new AttachmentBuilder(imagePath, {
                    name: fileName,
                    description: 'Original image from URL'
                });
            } catch (error) {
                console.error('Error downloading image:', error);
                throw new Error(`Failed to download image from URL: ${error.message}`);
            }
        }
        
        // Determine which features to analyze
        const features = featureOption === 'all' 
            ? ['labels', 'text', 'faces', 'moderation', 'celebrities'] 
            : featureOption.split(',');
        
        // Create results object
        const results = {};
        
        // Update progress
        await interaction.editReply(`📊 Processing image features: ${features.join(', ')}...`);
        
        // Run all the analyses
        const analysisPromises = [];
        
        if (features.includes('labels')) {
            analysisPromises.push(detectLabels(imageBuffer).then(data => results.labels = data));
        }
        
        if (features.includes('text')) {
            analysisPromises.push(detectText(imageBuffer).then(data => results.text = data));
        }
        
        if (features.includes('faces')) {
            analysisPromises.push(detectFaces(imageBuffer).then(data => results.faces = data));
        }
        
        if (features.includes('moderation')) {
            analysisPromises.push(detectModerationLabels(imageBuffer).then(data => results.moderation = data));
        }
        
        if (features.includes('celebrities')) {
            analysisPromises.push(recognizeCelebrities(imageBuffer).then(data => results.celebrities = data));
        }
        
        // Wait for all analyses to complete
        await Promise.all(analysisPromises);
        
        // Create a report file with the analysis results
        const reportPath = await createAnalysisReport(results, sourceDescription, tempDir);
        
        // Prepare the response embed
        const embed = new EmbedBuilder()
            .setTitle('AWS Rekognition Analysis Results')
            .setDescription(`Analysis of ${sourceDescription}`)
            .setColor(0x00FFFF)
            .setTimestamp();
        
        // If we have an image attachment, set it as the thumbnail
        if (imageAttachment) {
            embed.setImage(`attachment://${imageAttachment.name}`);
        }
        
        // Add fields based on the analyzed features
        if (results.labels && results.labels.Labels) {
            const topLabels = results.labels.Labels
                .sort((a, b) => b.Confidence - a.Confidence)
                .slice(0, 10)
                .map(label => `${label.Name} (${label.Confidence.toFixed(1)}%)`)
                .join(', ');
            
            embed.addFields({ name: '🏷️ Top Labels', value: topLabels || 'No labels detected' });
        }
        
        if (results.text && results.text.TextDetections) {
            const textLines = results.text.TextDetections
                .filter(text => text.Type === 'LINE')
                .map(text => text.DetectedText)
                .join('\n')
                .substring(0, 1024); // Discord field limit
            
            embed.addFields({ 
                name: '📝 Detected Text', 
                value: textLines || 'No text detected',
                inline: false 
            });
        }
        
        if (results.faces && results.faces.FaceDetails && results.faces.FaceDetails.length > 0) {
            const facesCount = results.faces.FaceDetails.length;
            const faceSummary = results.faces.FaceDetails.map((face, index) => {
                let summary = `Face ${index + 1}: `;
                if (face.Gender) summary += `${face.Gender.Value} (${face.Gender.Confidence.toFixed(1)}%), `;
                if (face.AgeRange) summary += `Age ${face.AgeRange.Low}-${face.AgeRange.High}, `;
                if (face.Emotions && face.Emotions.length > 0) {
                    const topEmotion = face.Emotions.sort((a, b) => b.Confidence - a.Confidence)[0];
                    summary += `${topEmotion.Type} (${topEmotion.Confidence.toFixed(1)}%)`;
                }
                return summary;
            }).join('\n').substring(0, 1024);
            
            embed.addFields({ 
                name: `😀 Faces Detected (${facesCount})`, 
                value: faceSummary || 'No faces detected',
                inline: false 
            });
        }
        
        if (results.celebrities && results.celebrities.CelebrityFaces && results.celebrities.CelebrityFaces.length > 0) {
            const celebs = results.celebrities.CelebrityFaces.map(celeb => 
                `${celeb.Name} (${celeb.MatchConfidence.toFixed(1)}%)`
            ).join('\n');
            
            embed.addFields({ 
                name: '🌟 Celebrities Detected', 
                value: celebs || 'No celebrities detected',
                inline: false 
            });
        }
        
        if (results.moderation && results.moderation.ModerationLabels && results.moderation.ModerationLabels.length > 0) {
            const moderationLabels = results.moderation.ModerationLabels.map(label => 
                `${label.Name} (${label.Confidence.toFixed(1)}%)`
            ).join('\n');
            
            embed.addFields({ 
                name: '⚠️ Moderation Labels', 
                value: moderationLabels || 'No moderation concerns detected',
                inline: false 
            });
        }
        
        // Create an attachment with the detailed report
        const attachment = new AttachmentBuilder(reportPath, { 
            name: 'rekognition_analysis.json' 
        });
        
        // Create an array of files to send
        const files = [attachment];
        if (imageAttachment) {
            files.push(imageAttachment);
        }
        
        // Send the response
        await interaction.editReply({
            content: 'AWS Rekognition analysis complete!',
            embeds: [embed],
            files: files
        });
        
    } catch (error) {
        console.error('Error analyzing image:', error);
        throw error;
    }
}

/**
 * Handle the compare subcommand
 * @param {object} interaction - Discord interaction
 * @param {string} tempDir - Temporary directory for files
 */
async function handleCompare(interaction, tempDir) {
    try {
        const sourceUrl = interaction.options.getString('source_url');
        const sourceAttachment = interaction.options.getAttachment('source_image');
        const targetUrl = interaction.options.getString('target_url');
        const targetAttachment = interaction.options.getAttachment('target_image');
        const similarityThreshold = interaction.options.getNumber('similarity') || 80;
        
        // Check if we have either URLs or attachments for both source and target
        if (!sourceUrl && !sourceAttachment) {
            return await interaction.editReply('Please provide either a source image URL or upload a source image.');
        }
        
        if (!targetUrl && !targetAttachment) {
            return await interaction.editReply('Please provide either a target image URL or upload a target image.');
        }
        
        // Validate similarity threshold
        if (similarityThreshold < 0 || similarityThreshold > 100) {
            return await interaction.editReply('Similarity threshold must be between 0 and 100.');
        }
        
        // Update status
        await interaction.editReply(`📷 Preparing images for comparison...`);
        
        // Variables to store image data and descriptions
        let sourceImageBuffer;
        let targetImageBuffer;
        let sourceDescription;
        let targetDescription;
        let sourceAttachmentFile = null;
        let targetAttachmentFile = null;
        
        // Process source image
        if (sourceAttachment) {
            // Validate image attachment
            if (!sourceAttachment.contentType || !sourceAttachment.contentType.startsWith('image/')) {
                return await interaction.editReply('The uploaded source file is not an image. Please upload a valid image file.');
            }
            
            sourceDescription = `uploaded source image (${sourceAttachment.name})`;
            
            try {
                // Download the attachment
                const response = await axios.get(sourceAttachment.url, { 
                    responseType: 'arraybuffer',
                    timeout: 10000
                });
                
                sourceImageBuffer = Buffer.from(response.data);
                
                // Save the image locally to attach in response
                const imagePath = path.join(tempDir, `original_source_${sourceAttachment.name}`);
                fs.writeFileSync(imagePath, sourceImageBuffer);
                
                // Create an attachment
                sourceAttachmentFile = new AttachmentBuilder(imagePath, {
                    name: `source_${sourceAttachment.name}`,
                    description: 'Source image'
                });
            } catch (error) {
                console.error('Error downloading source attachment:', error);
                throw new Error('Failed to download the uploaded source image.');
            }
        } else {
            // Validate URL
            if (!isValidUrl(sourceUrl)) {
                return await interaction.editReply('Please provide a valid source image URL starting with http:// or https://');
            }
            
            sourceDescription = sourceUrl;
            
            try {
                // Download the image
                const sourceImagePath = await downloadImage(sourceUrl, tempDir, 'source');
                sourceImageBuffer = fs.readFileSync(sourceImagePath);
                
                // Create an attachment
                const fileName = path.basename(sourceImagePath);
                sourceAttachmentFile = new AttachmentBuilder(sourceImagePath, {
                    name: `source_${fileName}`,
                    description: 'Source image from URL'
                });
            } catch (error) {
                console.error('Error downloading source image:', error);
                throw new Error(`Failed to download source image from URL: ${error.message}`);
            }
        }
        
        // Process target image
        if (targetAttachment) {
            // Validate image attachment
            if (!targetAttachment.contentType || !targetAttachment.contentType.startsWith('image/')) {
                return await interaction.editReply('The uploaded target file is not an image. Please upload a valid image file.');
            }
            
            targetDescription = `uploaded target image (${targetAttachment.name})`;
            
            try {
                // Download the attachment
                const response = await axios.get(targetAttachment.url, { 
                    responseType: 'arraybuffer',
                    timeout: 10000
                });
                
                targetImageBuffer = Buffer.from(response.data);
                
                // Save the image locally to attach in response
                const imagePath = path.join(tempDir, `original_target_${targetAttachment.name}`);
                fs.writeFileSync(imagePath, targetImageBuffer);
                
                // Create an attachment
                targetAttachmentFile = new AttachmentBuilder(imagePath, {
                    name: `target_${targetAttachment.name}`,
                    description: 'Target image'
                });
            } catch (error) {
                console.error('Error downloading target attachment:', error);
                throw new Error('Failed to download the uploaded target image.');
            }
        } else {
            // Validate URL
            if (!isValidUrl(targetUrl)) {
                return await interaction.editReply('Please provide a valid target image URL starting with http:// or https://');
            }
            
            targetDescription = targetUrl;
            
            try {
                // Download the image
                const targetImagePath = await downloadImage(targetUrl, tempDir, 'target');
                targetImageBuffer = fs.readFileSync(targetImagePath);
                
                // Create an attachment
                const fileName = path.basename(targetImagePath);
                targetAttachmentFile = new AttachmentBuilder(targetImagePath, {
                    name: `target_${fileName}`,
                    description: 'Target image from URL'
                });
            } catch (error) {
                console.error('Error downloading target image:', error);
                throw new Error(`Failed to download target image from URL: ${error.message}`);
            }
        }
        
        // Update status with the source descriptions
        await interaction.editReply(`🔍 Analyzing and comparing faces...\nSource: ${sourceDescription}\nTarget: ${targetDescription}`);
        
        // Compare faces
        const comparisonResult = await compareFaces(sourceImageBuffer, targetImageBuffer, similarityThreshold / 100);
        
        // Create a detailed report
        const reportPath = path.join(tempDir, 'face_comparison_report.json');
        fs.writeFileSync(reportPath, JSON.stringify(comparisonResult, null, 2));
        
        // Create the response embed
        const embed = new EmbedBuilder()
            .setTitle('Face Comparison Results')
            .setDescription(`Comparing faces from source and target images with ${similarityThreshold}% similarity threshold`)
            .setColor(0x00FFFF)
            .setTimestamp();
            
        // Add image thumbnails from our attachments
        if (sourceAttachmentFile) {
            embed.setThumbnail(`attachment://${sourceAttachmentFile.name}`);
        }
        
        // If we have a target attachment, use it in the image field
        if (targetAttachmentFile) {
            embed.setImage(`attachment://${targetAttachmentFile.name}`);
        }
        
        const matchedFaces = comparisonResult.FaceMatches || [];
        const unmatchedFaces = comparisonResult.UnmatchedFaces || [];
        
        if (matchedFaces.length > 0) {
            const matchesSummary = matchedFaces.map((match, index) => {
                const similarity = match.Similarity.toFixed(1);
                return `Match ${index + 1}: ${similarity}% similarity`;
            }).join('\n');
            
            embed.addFields({
                name: `✅ Matched Faces (${matchedFaces.length})`,
                value: matchesSummary,
                inline: false
            });
        } else {
            embed.addFields({
                name: '❌ No Matching Faces',
                value: 'No faces matched between the images at the specified similarity threshold.',
                inline: false
            });
        }
        
        if (unmatchedFaces.length > 0) {
            embed.addFields({
                name: `ℹ️ Unmatched Faces (${unmatchedFaces.length})`,
                value: `${unmatchedFaces.length} faces in the target image did not match the source face.`,
                inline: false
            });
        }
        
        // Add source and target descriptions to the embed
        embed.addFields(
            { name: 'Source Image', value: sourceDescription, inline: false },
            { name: 'Target Image', value: targetDescription, inline: false }
        );
        
        // Create an attachment with the detailed report
        const attachment = new AttachmentBuilder(reportPath, {
            name: 'face_comparison_report.json'
        });
        
        // Create array of files to send
        const files = [attachment];
        if (sourceAttachmentFile) files.push(sourceAttachmentFile);
        if (targetAttachmentFile) files.push(targetAttachmentFile);
        
        // Send the response
        await interaction.editReply({
            content: 'Face comparison complete!',
            embeds: [embed],
            files: files
        });
    } catch (error) {
        console.error('Error comparing faces:', error);
        
        // Handle specific error cases
        if (error.code === 'InvalidParameterException' && error.message.includes('no face')) {
            await interaction.editReply('No faces detected in one or both of the images. Please use images with clearly visible faces.');
            return;
        }
        
        throw error;
    }
}

/**
 * Download an image from a URL
 * @param {string} url - URL of the image
 * @param {string} tempDir - Directory to save the image
 * @param {string} prefix - Optional prefix for the filename
 * @returns {Promise<string>} - Path to the downloaded image
 */
async function downloadImage(url, tempDir, prefix = '') {
    try {
        // Generate a unique filename
        const urlObj = new URL(url);
        const fileExtension = path.extname(urlObj.pathname) || '.jpg';
        const randomId = crypto.randomBytes(8).toString('hex');
        const fileName = `${prefix ? prefix + '_' : ''}image_${randomId}${fileExtension}`;
        const filePath = path.join(tempDir, fileName);
        
        // Download the image
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 10000 // 10 second timeout
        });
        
        // Check if the response is an image
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
            throw new Error(`URL did not return an image (received: ${contentType})`);
        }
        
        // Save the image to disk
        fs.writeFileSync(filePath, Buffer.from(response.data));
        
        return filePath;
    } catch (error) {
        console.error('Error downloading image:', error);
        
        if (error.response) {
            throw new Error(`Failed to download image: HTTP status ${error.response.status}`);
        } else if (error.code === 'ECONNABORTED') {
            throw new Error('Timeout while downloading image. The server may be slow or unresponsive.');
        } else {
            throw error;
        }
    }
}

/**
 * Check if a string is a valid URL
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether the URL is valid
 */
function isValidUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return ['http:', 'https:'].includes(parsedUrl.protocol);
    } catch (error) {
        return false;
    }
}

/**
 * Create a JSON report file with all analysis results
 * @param {object} results - Analysis results
 * @param {string} imageUrl - URL of the analyzed image
 * @param {string} tempDir - Directory to save the report
 * @returns {Promise<string>} - Path to the report file
 */
async function createAnalysisReport(results, imageUrl, tempDir) {
    // Create a report object
    const report = {
        meta: {
            timestamp: new Date().toISOString(),
            imageUrl: imageUrl
        },
        results: results
    };
    
    // Write the report to a file
    const reportPath = path.join(tempDir, 'rekognition_analysis_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    return reportPath;
}

// AWS Rekognition functions

/**
 * Detect labels in an image
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<object>} - Detected labels
 */
async function detectLabels(imageBuffer) {
    const params = {
        Image: {
            Bytes: imageBuffer
        },
        MaxLabels: 50,
        MinConfidence: 70
    };
    
    const command = new DetectLabelsCommand(params);
    const response = await rekognitionClient.send(command);
    return response;
}

/**
 * Detect text in an image
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<object>} - Detected text
 */
async function detectText(imageBuffer) {
    const params = {
        Image: {
            Bytes: imageBuffer
        }
    };
    
    const command = new DetectTextCommand(params);
    const response = await rekognitionClient.send(command);
    return response;
}

/**
 * Detect faces in an image
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<object>} - Detected faces
 */
async function detectFaces(imageBuffer) {
    const params = {
        Image: {
            Bytes: imageBuffer
        },
        Attributes: ['ALL']
    };
    
    const command = new DetectFacesCommand(params);
    const response = await rekognitionClient.send(command);
    return response;
}

/**
 * Detect moderation labels in an image
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<object>} - Detected moderation labels
 */
async function detectModerationLabels(imageBuffer) {
    const params = {
        Image: {
            Bytes: imageBuffer
        },
        MinConfidence: 50
    };
    
    const command = new DetectModerationLabelsCommand(params);
    const response = await rekognitionClient.send(command);
    return response;
}

/**
 * Recognize celebrities in an image
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<object>} - Recognized celebrities
 */
async function recognizeCelebrities(imageBuffer) {
    const params = {
        Image: {
            Bytes: imageBuffer
        }
    };
    
    const command = new RecognizeCelebritiesCommand(params);
    const response = await rekognitionClient.send(command);
    return response;
}

/**
 * Compare faces between two images
 * @param {Buffer} sourceImageBuffer - Source image buffer
 * @param {Buffer} targetImageBuffer - Target image buffer
 * @param {number} similarityThreshold - Similarity threshold (0-1)
 * @returns {Promise<object>} - Face comparison results
 */
async function compareFaces(sourceImageBuffer, targetImageBuffer, similarityThreshold) {
    const params = {
        SourceImage: {
            Bytes: sourceImageBuffer
        },
        TargetImage: {
            Bytes: targetImageBuffer
        },
        SimilarityThreshold: similarityThreshold * 100 // Convert from 0-1 to 0-100
    };
    
    const command = new CompareFacesCommand(params);
    const response = await rekognitionClient.send(command);
    return response;
}
