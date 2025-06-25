/**
 * @file extract-links.js
 * @description A Discord slash command to extract all unique hyperlinks from a given webpage.
 * @author gl0bal01
 *
 * @overview
 * This command allows a user to provide a URL. The script then fetches the webpage's content,
 * parses the HTML to find all `<a>` tags, and extracts their `href` attributes.
 * It resolves relative URLs to absolute ones, removes duplicate links, and sorts the results alphabetically.
 *
 * The output is delivered as two files:
 * 1. A clean, easy-to-read `.txt` file listing all unique links with their corresponding anchor text.
 * 2. A rich `.html` report that includes summary statistics (total links, unique links, unique domains),
 * a list of top domains, and a searchable, filterable table of all the extracted links.
 */

// Core Dependencies
const fs = require('fs');
const path = require('path');
const os = require('os');

// Discord.js and Web Scraping Dependencies
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Escapes special HTML characters in a string to prevent Cross-Site Scripting (XSS).
 * @param {string} unsafeText - The raw string to escape.
 * @returns {string} The HTML-escaped string.
 */
function escapeHtml(unsafeText) {
    if (typeof unsafeText !== 'string') return '';
    return unsafeText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Analyzes a list of links to count the number of unique domains.
 * @param {Array<object>} links - An array of link objects, where each object has an `href` property.
 * @returns {number} The total count of unique hostnames.
 */
function getDomainCount(links) {
    const domains = new Set();
    links.forEach(link => {
        try {
            const domain = new URL(link.href).hostname;
            domains.add(domain);
        } catch (e) {
            // Ignore invalid URLs that might have slipped through
        }
    });
    return domains.size;
}

/**
 * Identifies and ranks the most frequent domains from a list of links.
 * @param {Array<object>} links - An array of link objects with an `href` property.
 * @param {number} [limit=10] - The maximum number of top domains to return.
 * @returns {Array<{name: string, count: number}>} A sorted array of the top domains and their counts.
 */
function getTopDomains(links, limit = 10) {
    const domainCounts = links.reduce((acc, link) => {
        try {
            const domain = new URL(link.href).hostname;
            acc[domain] = (acc[domain] || 0) + 1;
        } catch (e) {
            // Ignore invalid URLs
        }
        return acc;
    }, {});

    return Object.entries(domainCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-extract-links')
        .setDescription('Extract all unique links from a webpage and generate a report.')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The full URL of the webpage to analyze')
                .setRequired(true)),

    /**
     * Executes the link extraction command.
     * @param {import('discord.js').CommandInteraction} interaction - The user's interaction event.
     */
    async execute(interaction) {
        await interaction.deferReply();

        const urlString = interaction.options.getString('url');
        let tempDir;

        try {
            // 1. Validate the provided URL
            let targetUrl;
            try {
                targetUrl = new URL(urlString);
                if (!['http:', 'https:'].includes(targetUrl.protocol)) {
                    throw new Error('Invalid protocol.');
                }
            } catch (error) {
                return interaction.editReply('Please provide a valid URL starting with `http://` or `https://`.');
            }

            // 2. Fetch webpage content
            const response = await axios.get(targetUrl.href, {
                timeout: 15000, // 15-second timeout
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                }
            });
            const html = response.data;

            // 3. Parse HTML and Extract Links
            const $ = cheerio.load(html);
            const pageTitle = $('title').text().trim() || 'Untitled Page';
            const allLinks = [];

            $('a').each((index, element) => {
                const href = $(element).attr('href');
                if (href) {
                    try {
                        const absoluteUrl = new URL(href, targetUrl.href).href;
                        allLinks.push({
                            text: $(element).text().trim() || '[No Text]',
                            href: absoluteUrl
                        });
                    } catch (e) {
                        console.error(`Skipping invalid href: ${href}`);
                    }
                }
            });
            
            // Remove duplicates based on the 'href' property, preserving the first occurrence.
            const uniqueLinks = [...new Map(allLinks.map(link => [link.href, link])).values()];
            uniqueLinks.sort((a, b) => a.href.localeCompare(b.href)); // Sort alphabetically

            if (uniqueLinks.length === 0) {
                return interaction.editReply(`No links found on ${targetUrl.href}.`);
            }

            // 4. Create Temporary Files
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-links-'));
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            // --- Text File Content ---
            const textContent = [
                `LINKS EXTRACTED FROM: ${targetUrl.href}`,
                `PAGE TITLE: ${pageTitle}`,
                `EXTRACTION DATE: ${new Date().toUTCString()}`,
                `TOTAL UNIQUE LINKS: ${uniqueLinks.length}\n`,
                ...uniqueLinks.map((link, i) => `${i + 1}. "${link.text}"\n   ${link.href}`)
            ].join('\n\n');
            const textFilePath = path.join(tempDir, `links-${timestamp}.txt`);
            fs.writeFileSync(textFilePath, textContent);

            // --- HTML File Content ---
            const topDomainsHtml = getTopDomains(uniqueLinks)
                .map(domain => `<li><strong>${escapeHtml(domain.name)}</strong>: ${domain.count} links</li>`).join('');

            const linksTableHtml = uniqueLinks.map((link, index) => `
                <tr>
                    <td class="index">${index + 1}</td>
                    <td>${escapeHtml(link.text)}</td>
                    <td><a href="${escapeHtml(link.href)}" class="url" target="_blank">${escapeHtml(link.href)}</a></td>
                </tr>`).join('');

            const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Link Report for ${escapeHtml(pageTitle)}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; color: #333; background-color: #fdfdfd; }
        a { color: #0056b3; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .report-header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px; border: 1px solid #dee2e6; }
        .report-header h1 { margin-top: 0; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 20px; text-align: center; }
        .stats div { background-color: #e9ecef; padding: 12px; border-radius: 5px; }
        .stats strong { display: block; font-size: 1.5em; }
        .search-container { margin-bottom: 20px; }
        #searchInput { padding: 10px; width: calc(100% - 24px); border: 1px solid #ccc; border-radius: 4px; font-size: 1em; }
        .links-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .links-table th, .links-table td { padding: 12px; border: 1px solid #ddd; text-align: left; vertical-align: top; }
        .links-table th { background-color: #f2f2f2; }
        .links-table tr:nth-child(even) { background-color: #f9f9f9; }
        .links-table tr:hover { background-color: #f1f1f1; }
        .url { word-break: break-all; }
        .index { width: 50px; text-align: center; }
        .footer { margin-top: 30px; text-align: center; color: #666; font-size: 0.8em; }
        ul { padding-left: 20px; }
    </style>
</head>
<body>
    <div class="report-header">
        <h1>Link Extraction Report</h1>
        <p><strong>Source URL:</strong> <a href="${escapeHtml(targetUrl.href)}" target="_blank">${escapeHtml(targetUrl.href)}</a></p>
        <p><strong>Page Title:</strong> ${escapeHtml(pageTitle)}</p>
        <p><strong>Requested by:</strong> ${escapeHtml(interaction.user.tag)} on ${new Date().toLocaleDateString()}</p>
        <div class="stats">
            <div><strong>${uniqueLinks.length}</strong> Unique Links</div>
            <div><strong>${allLinks.length}</strong> Total Links Found</div>
            <div><strong>${getDomainCount(uniqueLinks)}</strong> Unique Domains</div>
        </div>
    </div>
    
    <div class="search-container">
        <h3>Top Domains</h3>
        <ul>${topDomainsHtml}</ul>
        <hr style="margin: 20px 0;">
        <input type="text" id="searchInput" onkeyup="filterTable()" placeholder="Type to filter links by text or URL...">
        <div id="searchStatus" style="margin-top: 10px; color: #555;"></div>
    </div>

    <table class="links-table" id="linksTable">
        <thead>
            <tr>
                <th class="index">#</th>
                <th>Link Text</th>
                <th>URL</th>
            </tr>
        </thead>
        <tbody>${linksTableHtml}</tbody>
    </table>

    <div class="footer">Generated by Bob the Bot</div>
    
    <script>
        const table = document.getElementById("linksTable");
        const rows = table.getElementsByTagName("tr");
        const searchStatus = document.getElementById("searchStatus");
        const totalRows = rows.length - 1;

        function filterTable() {
            const filter = document.getElementById("searchInput").value.toLowerCase();
            let visibleCount = 0;
            
            for (let i = 1; i < rows.length; i++) {
                const textCell = rows[i].getElementsByTagName("td")[1];
                const urlCell = rows[i].getElementsByTagName("td")[2];
                if (textCell && urlCell) {
                    const textMatch = textCell.textContent.toLowerCase().includes(filter);
                    const urlMatch = urlCell.textContent.toLowerCase().includes(filter);
                    if (textMatch || urlMatch) {
                        rows[i].style.display = "";
                        visibleCount++;
                    } else {
                        rows[i].style.display = "none";
                    }
                }
            }
            searchStatus.textContent = \`Showing \${visibleCount} of \${totalRows} links.\`;
        }
        searchStatus.textContent = \`Showing \${totalRows} of \${totalRows} links.\`;
    </script>
</body>
</html>`;
            const htmlFilePath = path.join(tempDir, `links-${timestamp}.html`);
            fs.writeFileSync(htmlFilePath, htmlContent);

            // 5. Send Files to Discord
            const textAttachment = new AttachmentBuilder(textFilePath);
            const htmlAttachment = new AttachmentBuilder(htmlFilePath);

            await interaction.editReply({
                content: `I've extracted **${uniqueLinks.length}** unique links from \`${targetUrl.hostname}\`.\nAttached are a text file and an interactive HTML report.`,
                files: [textAttachment, htmlAttachment]
            });

        } catch (error) {
            console.error('Error in extract-links command:', error);
            let errorMessage = 'An unexpected error occurred. Please try again later.';

            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                    errorMessage = 'The request timed out. The server may be slow to respond.';
                } else if (error.response) {
                    const status = error.response.status;
                    errorMessage = `The server responded with HTTP status ${status}. `;
                    if (status === 403) errorMessage += 'Access is forbidden; the site may be blocking automated requests.';
                    else if (status === 404) errorMessage += 'The webpage was not found.';
                    else errorMessage += 'Please check the URL and try again.';
                } else if (error.request) {
                    errorMessage = 'The website could not be reached. Please check the URL and your connection.';
                }
            }
            
            await interaction.editReply(errorMessage);

        } finally {
            // 6. Clean up temporary files
            if (tempDir) {
                fs.rm(tempDir, { recursive: true, force: true }, (err) => {
                    if (err) console.error(`Failed to clean up temporary directory ${tempDir}:`, err);
                });
            }
        }
    },
};