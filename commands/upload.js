/**
 * File: upload.js
 * Description: Upload Discord attachments to the 1min.ai Asset API
 * Author: gl0bal01
 *
 * This command lets investigators upload files (audio, images, PDFs, etc.)
 * directly from Discord to the 1min.ai Asset API so they can be referenced
 * by other AI features such as /bob-chat transcribe.
 *
 * Usage: /bob-upload file:<attachment>
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const { getSafeAxiosConfig, SIZE_50MB } = require('../utils/ssrf');
const { sanitizeFilename } = require('../utils/validation');
const { capField } = require('../utils/embed');

const MAX_FILE_SIZE = SIZE_50MB; // 1min.ai limit
const ASSET_API_URL = 'https://api.1min.ai/api/assets';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-upload')
        .setDescription('Upload a file to the 1min.ai Asset API for use with AI features')
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('File to upload (max 50 MB)')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const apiKey = process.env.AI_API_KEY;
        if (!apiKey) {
            return interaction.editReply({
                content: '❌ **Configuration Error**\n' +
                    '`AI_API_KEY` is not configured. Please contact the administrator.'
            });
        }

        const attachment = interaction.options.getAttachment('file');
        if (!attachment) {
            return interaction.editReply({
                content: '❌ **Missing File**\nPlease attach a file to upload.'
            });
        }

        // Reject oversized attachments early
        if (attachment.size > MAX_FILE_SIZE) {
            return interaction.editReply({
                content: `❌ **File Too Large**\n` +
                    `Maximum upload size is **50 MB**.\n` +
                    `Your file: **${(attachment.size / 1024 / 1024).toFixed(2)} MB**`
            });
        }

        try {
            await interaction.editReply(`📤 Downloading **${attachment.name}**…`);

            const response = await axios.get(attachment.url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: MAX_FILE_SIZE,
                ...getSafeAxiosConfig()
            });

            const buffer = Buffer.from(response.data);
            const safeName = sanitizeFilename(attachment.name);

            await interaction.editReply(`📤 Uploading **${attachment.name}** to 1min.ai…`);

            // Build multipart request
            const form = new FormData();
            form.append('asset', buffer, {
                filename: safeName,
                contentType: attachment.contentType || 'application/octet-stream'
            });

            const uploadRes = await axios.post(ASSET_API_URL, form, {
                ...getSafeAxiosConfig(),
                headers: {
                    'API-KEY': apiKey,
                    ...form.getHeaders()
                },
                timeout: 120000,
                maxContentLength: MAX_FILE_SIZE,
                maxBodyLength: MAX_FILE_SIZE
            });

            const data = uploadRes.data;
            const asset = data?.asset;
            const fileContent = data?.fileContent;

            if (!fileContent?.path) {
                throw new Error('Unexpected API response: missing fileContent.path');
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Asset Uploaded')
                .setColor(0x00ff00)
                .setTimestamp()
                .addFields(
                    { name: '📁 File Name', value: capField(asset?.originalname ?? safeName), inline: true },
                    { name: '📦 Size', value: capField(`${(asset?.size ?? buffer.length).toLocaleString()} bytes`), inline: true },
                    { name: '🆔 UUID', value: capField(fileContent.uuid ?? 'N/A'), inline: true },
                    { name: '🔑 Asset Path', value: `\`${capField(fileContent.path)}\`` }
                );

            if (asset?.location) {
                embed.addFields({
                    name: '🔗 Direct URL',
                    value: capField(asset.location, 1024)
                });
            }

            embed.setFooter({ text: 'Use the Asset Path in /bob-chat transcribe or other AI features.' });

            await interaction.editReply({ content: null, embeds: [embed] });

        } catch (error) {
            console.error('[UPLOAD] Error:', error.response?.status, error.message);

            let message = '❌ **Upload Failed**\n';

            if (error.response) {
                const status = error.response.status;
                const errBody = error.response.data;
                const errMsg = errBody?.error?.message || errBody?.message || '';

                switch (status) {
                    case 400:
                        message += `**Bad Request** — ${capField(errMsg || 'Invalid file format or missing file.', 512)}`;
                        break;
                    case 401:
                        message += '**Unauthorized** — Invalid or missing API key.';
                        break;
                    case 413:
                        message += '**Payload Too Large** — File exceeds the 50 MB limit.';
                        break;
                    case 429:
                        message += '**Rate Limited** — Too many uploads. Please wait a moment.';
                        break;
                    default:
                        message += `**API Error (${status})** — ${capField(errMsg || 'An error occurred while uploading.', 512)}`;
                }
            } else if (error.code === 'ECONNABORTED') {
                message += '**Timeout** — The upload took too long. Please try again.';
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                message += '**Network Error** — Cannot reach the upload service.';
            } else {
                message += capField(error.message, 512);
            }

            await interaction.editReply({ content: message });
        }
    }
};
