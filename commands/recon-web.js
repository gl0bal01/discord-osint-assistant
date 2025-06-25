/**
 * File: bob-web-recon.js
 * Description: Multi-source domain reconnaissance tool for Discord bots
 * Author: gl0bal01
 * 
 * This command performs web reconnaissance by providing direct link access to services on a given domain using:
 * - Certificate transparency search (CertSpotter, crt.sh)
 * - Historical snapshots via Wayback Machine
 * - VirusTotal domain reputation lookup
 * - Shodan favicon hashing and search
 * 
 * Features:
 * - Real-time progress tracking with visual indicators
 * - Rich embed generation with links and summaries
 * - Automatic favicon extraction and MurmurHash computation
 * - Interactive buttons for streamlined navigation
 * - Temporary file handling and cleanup for favicon analysis
 * 
 * Usage: /bob-web-recon domain:example.com service:[all|certspotter|virustotal|crtsh|wayback|shodan]
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const mmh = require('murmurhash'); // Changed from mmh3 to mmh

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-web-recon')
        .setDescription('Perform reconnaissance on a domain using various tools')
        .addStringOption(option =>
            option.setName('domain')
                .setDescription('The domain to perform reconnaissance on')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('service')
                .setDescription('The service to use for reconnaissance')
                .setRequired(false)
                .addChoices(
                    { name: 'All Services', value: 'all' },
                    { name: 'CertSpotter', value: 'certspotter' },
                    { name: 'VirusTotal', value: 'virustotal' },
                    { name: 'crt.sh', value: 'crtsh' },
                    { name: 'Wayback Machine', value: 'wayback' },
                    { name: 'Shodan Favicon', value: 'shodan' }
                )),
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });
        
        try {
            const domain = interaction.options.getString('domain');
            const service = interaction.options.getString('service') || 'all';
            
            // Validate domain format
            if (!isValidDomain(domain)) {
                return interaction.editReply('Please provide a valid domain name (e.g., example.com)');
            }
            
            // Create an embed for the response
            const embed = new EmbedBuilder()
                .setTitle(`Reconnaissance for ${domain}`)
                .setDescription(`Running reconnaissance tools for ${domain}...`)
                .setColor(0x00FFFF)
                .setTimestamp();
            
            // Initial response to show progress is starting
            await interaction.editReply({
                content: `Starting reconnaissance for ${domain}...`,
                embeds: [embed]
            });
            
            // Progress indicators
            const progressStates = ['⬛⬛⬛⬛⬛', '🟦⬛⬛⬛⬛', '🟦🟦⬛⬛⬛', '🟦🟦🟦⬛⬛', '🟦🟦🟦🟦⬛', '🟦🟦🟦🟦🟦'];
            let progressIndex = 0;
            let completedServices = 0;
            
            // Determine which services to use
            const services = service === 'all' 
                ? ['certspotter', 'virustotal', 'crtsh', 'wayback', 'shodan'] 
                : [service];
            
            // Create progress update interval
            const progressInterval = setInterval(async () => {
                progressIndex = (progressIndex + 1) % progressStates.length;
                
                embed.setDescription(
                    `Running reconnaissance for ${domain}...\n` +
                    `Progress: ${progressStates[progressIndex]} (${completedServices}/${services.length} services completed)`
                );
                
                try {
                    await interaction.editReply({ embeds: [embed] });
                } catch (err) {
                    console.error('Error updating progress:', err);
                    clearInterval(progressInterval);
                }
            }, 2000); // Update every 2 seconds
            
            // Create button row for links
            const row = new ActionRowBuilder();
            
            // Process each service
            for (const svc of services) {
                switch(svc) {
                    case 'certspotter':
                        const certspotterUrl = `https://api.certspotter.com/v1/issuances?domain=${domain}&include_subdomains=true&expand=dns_names&expand=issuer&expand=cert`;
                        embed.addFields({ 
                            name: 'CertSpotter', 
                            value: `[View certificates issued for ${domain}](${certspotterUrl})` 
                        });
                        row.addComponents(
                            new ButtonBuilder()
                                .setLabel('CertSpotter')
                                .setURL(certspotterUrl)
                                .setStyle(ButtonStyle.Link)
                        );
                        completedServices++;
                        break;
                        
                    case 'virustotal':
                        const virustotalUrl = `https://www.virustotal.com/gui/domain/${domain}`;
                        embed.addFields({ 
                            name: 'VirusTotal', 
                            value: `[View security analysis for ${domain}](${virustotalUrl})` 
                        });
                        row.addComponents(
                            new ButtonBuilder()
                                .setLabel('VirusTotal')
                                .setURL(virustotalUrl)
                                .setStyle(ButtonStyle.Link)
                        );
                        completedServices++;
                        break;
                        
                    case 'crtsh':
                        try {
                            embed.setDescription(
                                `Running reconnaissance for ${domain}...\n` +
                                `Currently fetching data from crt.sh...`
                            );
                            await interaction.editReply({ embeds: [embed] });
                            
                            const crtshResponse = await axios.get(`https://crt.sh/json?q=${domain}`);
                            const certs = crtshResponse.data;
                            
                            if (certs && certs.length > 0) {
                                // Count unique certificates and issuers
                                const uniqueIssuers = new Set();
                                certs.forEach(cert => uniqueIssuers.add(cert.issuer_name));
                                
                                const crtshUrl = `https://crt.sh/?q=${domain}`;
                                embed.addFields({ 
                                    name: 'crt.sh', 
                                    value: `Found ${certs.length} certificates from ${uniqueIssuers.size} issuers\n[View detailed certificate info](${crtshUrl})` 
                                });
                                
                                // Add the 5 most recent certificates
                                const recentCerts = certs
                                    .sort((a, b) => new Date(b.entry_timestamp) - new Date(a.entry_timestamp))
                                    .slice(0, 5);
                                
                                const certsDetails = recentCerts.map(cert => {
                                    const issuer = cert.issuer_name.split(' ')[0];
                                    return `• ${new Date(cert.entry_timestamp).toISOString().split('T')[0]} - ${issuer}`;
                                }).join('\n');
                                
                                embed.addFields({ 
                                    name: 'Recent Certificates', 
                                    value: certsDetails 
                                });
                                
                                row.addComponents(
                                    new ButtonBuilder()
                                        .setLabel('crt.sh')
                                        .setURL(crtshUrl)
                                        .setStyle(ButtonStyle.Link)
                                );
                            } else {
                                embed.addFields({ 
                                    name: 'crt.sh', 
                                    value: 'No certificates found' 
                                });
                            }
                        } catch (error) {
                            console.error('Error fetching crt.sh data:', error);
                            embed.addFields({ 
                                name: 'crt.sh', 
                                value: 'Error fetching certificate data' 
                            });
                        }
                        completedServices++;
                        break;
                        
                    case 'wayback':
                        try {
                            embed.setDescription(
                                `Running reconnaissance for ${domain}...\n` +
                                `Currently fetching data from Wayback Machine...`
                            );
                            await interaction.editReply({ embeds: [embed] });
                            
                            const waybackResponse = await axios.get(
                                `https://web.archive.org/cdx/search/cdx?fl=original&collapse=urlkey&url=*.${domain}`,
                                { responseType: 'text' }
                            );
                            
                            const urls = waybackResponse.data.trim().split('\n');
                            const waybackUrl = `https://web.archive.org/web/*/${domain}/*`;
                            
                            if (urls.length > 0 && urls[0] !== '') {
                                embed.addFields({ 
                                    name: 'Wayback Machine', 
                                    value: `Found ${urls.length} archived URLs\n[View archive history](${waybackUrl})` 
                                });
                                
                                // Add sample of URLs if there are any
                                if (urls.length > 0) {
                                    const sampleUrls = urls
                                        .slice(0, Math.min(5, urls.length))
                                        .map(url => `• ${url.length > 70 ? url.substring(0, 67) + '...' : url}`)
                                        .join('\n');
                                    
                                    embed.addFields({ 
                                        name: 'Sample Archived URLs', 
                                        value: sampleUrls 
                                    });
                                }
                            } else {
                                embed.addFields({ 
                                    name: 'Wayback Machine', 
                                    value: 'No archived URLs found' 
                                });
                            }
                            
                            row.addComponents(
                                new ButtonBuilder()
                                    .setLabel('Wayback Machine')
                                    .setURL(waybackUrl)
                                    .setStyle(ButtonStyle.Link)
                            );
                        } catch (error) {
                            console.error('Error fetching Wayback Machine data:', error);
                            embed.addFields({ 
                                name: 'Wayback Machine', 
                                value: 'Error fetching archive data' 
                            });
                        }
                        completedServices++;
                        break;
                        
                    case 'shodan':
                        try {
                            embed.setDescription(
                                `Running reconnaissance for ${domain}...\n` +
                                `Currently processing favicon for Shodan hash...`
                            );
                            await interaction.editReply({ embeds: [embed] });
                            
                            // Construct URL with http protocol if not specified
                            let targetUrl = domain;
                            if (!targetUrl.startsWith('http')) {
                                targetUrl = 'https://' + targetUrl;
                            }
                            
                            // Create temp directory for files
                            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-favicons-'));
                            
                            // Parse the domain for display purposes
                            const parsedUrl = new URL(targetUrl);
                            const domainName = parsedUrl.hostname;
                            
                            // Fetch the webpage content
                            const response = await axios.get(targetUrl);
                            const html = response.data;
                            
                            // Use cheerio to parse HTML
                            const $ = cheerio.load(html);
                            
                            // Array to store favicon data
                            let faviconData = null;
                            
                            // Check common favicon locations
                            const faviconSelectors = [
                                'link[rel="icon"]',
                                'link[rel="shortcut icon"]',
                                'link[rel="apple-touch-icon"]',
                                'link[rel="apple-touch-icon-precomposed"]'
                            ];
                            
                            // Check for favicon links in the page
                            for (const selector of faviconSelectors) {
                                const element = $(selector).first();
                                if (element.length) {
                                    const href = element.attr('href');
                                    if (href) {
                                        try {
                                            // Convert relative URLs to absolute
                                            const faviconUrl = new URL(href, targetUrl).href;
                                            faviconData = {
                                                url: faviconUrl,
                                                originalUrl: href,
                                                rel: element.attr('rel'),
                                                sizes: element.attr('sizes') || 'unknown'
                                            };
                                            break;
                                        } catch (e) {
                                            console.error(`Invalid URL: ${href}`);
                                        }
                                    }
                                }
                            }
                            
                            // Check for default favicon.ico if none found
                            if (!faviconData) {
                                const defaultFaviconUrl = new URL('/favicon.ico', targetUrl).href;
                                faviconData = {
                                    url: defaultFaviconUrl,
                                    originalUrl: '/favicon.ico',
                                    rel: 'default',
                                    sizes: 'unknown'
                                };
                            }
                            
                            // Download the favicon
                            const faviconResponse = await axios.get(faviconData.url, { responseType: 'arraybuffer' });
                            const contentType = faviconResponse.headers['content-type'] || '';
                            
                            // If it's an image, save it
                            if (contentType.startsWith('image/')) {
                                // Extract extension from content-type
                                let extension = contentType.split('/')[1].split(';')[0];
                                extension = extension === 'svg+xml' ? 'svg' : extension;
                                
                                // Create a filename
                                const filename = `favicon-${domainName}.${extension}`;
                                const filePath = path.join(tempDir, filename);
                                
                                // Save the file
                                fs.writeFileSync(filePath, Buffer.from(faviconResponse.data));
                                
                                // Update favicon data
                                faviconData.contentType = contentType;
                                faviconData.extension = extension;
                                faviconData.filename = filename;
                                faviconData.filePath = filePath;
                                faviconData.fileSize = faviconResponse.data.length;
                                
                                // Calculate the mmh hash (the same way Shodan does it)
                                const faviconBuffer = Buffer.from(faviconResponse.data);
                                const faviconBase64 = faviconBuffer.toString('base64');
                                
                                // Use mmh instead of mmh3
                                const faviconHash = mmh.v3(faviconBase64).toString(16);
                                
                                // Generate the Shodan search URL
                                const shodanUrl = `https://www.shodan.io/search?query=http.favicon.hash%3A${faviconHash}`;
                                
                                // Add to embed
                                embed.addFields(
                                    { name: 'Shodan Favicon Hash', value: `\`${faviconHash}\`` },
                                    { 
                                        name: 'Shodan Search', 
                                        value: `[Find sites with matching favicon](${shodanUrl})` 
                                    }
                                );
                                
                                // Add to button row
                                row.addComponents(
                                    new ButtonBuilder()
                                        .setLabel('Shodan Favicon')
                                        .setURL(shodanUrl)
                                        .setStyle(ButtonStyle.Link)
                                );
                                
                                // Create an attachment for the favicon
                                const attachment = new AttachmentBuilder(filePath, { name: filename });
                                
                                // We'll need to add this attachment to the reply later
                                interaction.faviconAttachment = {
                                    attachment: attachment,
                                    filename: filename,
                                    tempDir: tempDir
                                };
                                
                                // Set the thumbnail to the attachment
                                embed.setThumbnail(`attachment://${filename}`);
                            } else {
                                embed.addFields({ 
                                    name: 'Shodan Favicon', 
                                    value: `Unable to process favicon: The resource at ${faviconData.url} is not an image.` 
                                });
                            }
                        } catch (error) {
                            console.error('Error in Shodan favicon processing:', error);
                            embed.addFields({ 
                                name: 'Shodan Favicon', 
                                value: 'Failed to extract and hash the favicon.'
                            });
                        }
                        completedServices++;
                        break;
                }
            }
            
            // Stop the progress interval
            clearInterval(progressInterval);
            
            // Update embed description to show completion
            embed.setDescription(`Reconnaissance completed for ${domain}`);
            
            // Send the response with attachment if it exists
            const replyOptions = {
                content: `Reconnaissance results for ${domain}:`,
                embeds: [embed],
                components: row.components.length > 0 ? [row] : []
            };
            
            // Add favicon attachment if it exists
            if (interaction.faviconAttachment) {
                replyOptions.files = [interaction.faviconAttachment.attachment];
                
                // Clean up temp files after a short delay
                setTimeout(() => {
                    try {
                        fs.readdirSync(interaction.faviconAttachment.tempDir).forEach(file => {
                            fs.unlinkSync(path.join(interaction.faviconAttachment.tempDir, file));
                        });
                        fs.rmdirSync(interaction.faviconAttachment.tempDir);
                    } catch (e) {
                        console.error('Error cleaning up temp files:', e);
                    }
                }, 5000);
            }
            
            await interaction.editReply(replyOptions);
            
        } catch (error) {
            console.error('Error in recon command:', error);
            
            // Provide a helpful error message
            let errorMessage = 'An unexpected error occurred while processing your request';
            
            if (error.response) {
                errorMessage += `: HTTP status ${error.response.status}`;
            } else if (error.code) {
                errorMessage += `: ${error.code}`;
            } else if (error.message) {
                errorMessage += `: ${error.message}`;
            }
            
            await interaction.editReply(errorMessage);
        }
    },
};

// Helper function to validate domain
function isValidDomain(domain) {
    // Basic domain validation
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
}
