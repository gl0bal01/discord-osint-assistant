/**
 * File: bob-dork.js
 * Description: Command to generate a list of Google dork URLs for OSINT person lookup
 * Author: gl0bal01
 * 
 * This command generates a list of Google dork search URLs based on a person's name
 * to assist in open source intelligence gathering.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-dork')
        .setDescription('Generate Google dork URLs for person lookup')
        .addStringOption(option =>
            option.setName('firstname')
                .setDescription('First name of the person')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('lastname')
                .setDescription('Last name of the person')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('engine')
                .setDescription('Search engine to use')
                .setRequired(false)
                .addChoices(
                    { name: 'Google', value: 'google' },
                    { name: 'Bing', value: 'bing' },
                    { name: 'DuckDuckGo', value: 'duckduckgo' },
                    { name: 'Yandex', value: 'yandex' }
                ))
        .addBooleanOption(option =>
            option.setName('advanced')
                .setDescription('Include advanced dorks (more invasive)')
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            // Get options
            const firstname = interaction.options.getString('firstname');
            const lastname = interaction.options.getString('lastname');
            const engine = interaction.options.getString('engine') || 'google';
            const advanced = interaction.options.getBoolean('advanced') || false;
            
            // Validate inputs
            if (!firstname || !lastname) {
                return interaction.editReply('Both first name and last name are required.');
            }
            
            // Generate dorks and URLs
            const { urls, dorks } = generateDorkUrls(firstname, lastname, engine, advanced);
            
            // Create temp directory for output file
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Generate unique filename
            const randomId = crypto.randomBytes(4).toString('hex');
            const outputFile = path.join(tempDir, `dorks_${firstname}_${lastname}_${randomId}.txt`);
            
            // Write URLs to file
            let fileContent = `# OSINT Search URLs for ${firstname} ${lastname}\n`;
            fileContent += `# Generated: ${new Date().toISOString()}\n`;
            fileContent += `# Search Engine: ${engine}\n`;
            fileContent += `# Advanced Mode: ${advanced ? 'Yes' : 'No'}\n\n`;
            fileContent += `# Total URLs: ${urls.length}\n\n`;
            
            // Add URLs - one per line for easy copying
            urls.forEach(url => {
                fileContent += `${url}\n`;
            });
            
            // Add explanations at the end
            fileContent += `\n\n# DORK EXPLANATIONS\n`;
            fileContent += `# ----------------\n\n`;
            
            dorks.forEach((dork, index) => {
                fileContent += `# ${index + 1}. ${dork}\n`;
            });
            
            fs.writeFileSync(outputFile, fileContent);
            
            // Create attachment
            const attachment = new AttachmentBuilder(outputFile, { name: `${firstname}_${lastname}_dorks.txt` });
            
            // Send response
            await interaction.editReply({
                content: `Generated ${urls.length} search URLs for ${firstname} ${lastname}.
Use these URLs with browser extensions like "Open Multiple URLs" to open them all at once.`,
                files: [attachment]
            });
            
            // Clean up temp file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(outputFile);
                } catch (error) {
                    console.error('Error cleaning up temp file:', error);
                }
            }, 5000);
            
        } catch (error) {
            console.error('Error in dork command:', error);
            await interaction.editReply('An error occurred while generating dork URLs.');
        }
    },
};

/**
 * Generate dork URLs based on firstname and lastname
 * @param {string} firstname - First name of the person
 * @param {string} lastname - Last name of the person
 * @param {string} engineChoice - Search engine to use
 * @param {boolean} advanced - Whether to include advanced dorks
 * @returns {Object} Object containing arrays of urls and dorks
 */
function generateDorkUrls(firstname, lastname, engineChoice, advanced) {
    // Search engine base URLs
    const searchEngines = {
        'google': 'https://www.google.com/search?q=',
        'bing': 'https://www.bing.com/search?q=',
        'duckduckgo': 'https://duckduckgo.com/?q=',
        'yandex': 'https://yandex.com/search/?text='
    };
    
    const baseUrl = searchEngines[engineChoice];
    const dorks = generateDorks(firstname, lastname, advanced);
    const urls = dorks.map(dork => `${baseUrl}${encodeURIComponent(dork)}`);
    
    return { urls, dorks };
}

/**
 * Generate Google dorks for finding a person
 * @param {string} firstname - First name of the person
 * @param {string} lastname - Last name of the person
 * @param {boolean} advanced - Whether to include advanced dorks
 * @returns {string[]} Array of dork strings
 */
function generateDorks(firstname, lastname, advanced) {
    const dorks = [];
    
    // Basic name searches
    dorks.push(`"${firstname} ${lastname}"`);
    dorks.push(`"${lastname}, ${firstname}"`);
    dorks.push(`"${firstname} * ${lastname}"`);
  
    // Social media
    dorks.push(`"${firstname} ${lastname}" site:facebook.com OR site:linkedin.com OR site:instagram.com OR site:twitter.com`);
    dorks.push(`"${firstname} ${lastname}" inurl:profile OR inurl:about OR inurl:bio`);
    
    // Contact information
    dorks.push(`"${firstname} ${lastname}" intext:address OR intext:phone OR intext:email OR intext:contact`);
    
    // Location information
    dorks.push(`"${firstname} ${lastname}" intext:city OR intext:state OR intext:country OR intext:moved`);
    
    // Public records
    dorks.push(`"${firstname} ${lastname}" intext:court OR intext:property OR intext:marriage OR filetype:pdf`);
    
    // Digital footprint
    dorks.push(`"${firstname} ${lastname}" site:github.com OR site:medium.com OR site:wordpress.com OR inurl:author`);
    
    // Advanced dorks (only included if advanced=true)
    if (advanced) {
        // Phone and Contact Information Dorks
        dorks.push(`"${firstname} ${lastname}" intext:phone filetype:xlsx OR filetype:csv`);
        dorks.push(`"${firstname} ${lastname}" intext:"contact information" OR intext:"emergency contact"`);
        dorks.push(`"${firstname} ${lastname}" intext:resume phone`);
        dorks.push(`site:truecaller.com OR site:whitepages.com OR site:spokeo.com "${firstname} ${lastname}"`);
        
        // Medical and Welfare Dorks
        dorks.push(`"${firstname} ${lastname}" intext:patient OR intext:medical OR intext:hospital -doctor`);
        dorks.push(`"${firstname} ${lastname}" intext:insurance OR intext:policy`);
        dorks.push(`"${firstname} ${lastname}" intext:welfare OR intext:benefits OR intext:assistance`);
        
        // Financial Trace Dorks
        dorks.push(`"${firstname} ${lastname}" intext:bank OR intext:account OR intext:transaction`);
        dorks.push(`"${firstname} ${lastname}" intext:paypal OR intext:venmo OR intext:cashapp`);
        dorks.push(`"${firstname} ${lastname}" intext:loan OR intext:mortgage OR intext:credit`);
        
        // Prison, Legal and Police Dorks
        dorks.push(`"${firstname} ${lastname}" site:vinelink.com`);
        dorks.push(`"${firstname} ${lastname}" intext:inmate OR intext:prisoner OR intext:corrections`);
        dorks.push(`"${firstname} ${lastname}" site:mugshots.com OR site:arrests.org`);
        
        // Education and Employment Dorks
        dorks.push(`"${firstname} ${lastname}" site:.edu intext:student OR intext:alumni`);
        dorks.push(`"${firstname} ${lastname}" filetype:pdf intext:transcript OR intext:diploma`);
        dorks.push(`"${firstname} ${lastname}" site:linkedin.com AND (inurl:in/ OR inurl:pub/)`);
        
        // Historical and Archive Dorks
        dorks.push(`"${firstname} ${lastname}" site:archive.org`);
        dorks.push(`"${firstname} ${lastname}" site:newspapers.com OR site:legacy.com`);
        dorks.push(`"${firstname} ${lastname}" filetype:pdf intext:yearbook`);
        
        // Online Forums and Communities
        dorks.push(`"${firstname} ${lastname}" site:reddit.com OR site:quora.com`);
        dorks.push(`"${firstname} ${lastname}" intext:username OR intext:profile site:forum.*`);
        
        // Travel and Location Dorks
        dorks.push(`"${firstname} ${lastname}" intext:flight OR intext:booking OR intext:reservation`);
        dorks.push(`"${firstname} ${lastname}" intext:passport OR intext:visa OR intext:travel`);
        
        // Less Common But Effective Dorks
        dorks.push(`"${firstname} ${lastname}" ext:vcf OR ext:vcard`);
        dorks.push(`"${firstname} ${lastname}" intext:"IP address" OR intext:WHOIS`);
        dorks.push(`"${firstname} ${lastname}" site:findagrave.com OR site:cemetery`);
    }

    // Add people search databases
    dorks.push(`"${firstname} ${lastname}" site:spokeo.com OR site:whitepages.com OR site:truepeoplesearch.com OR site:fastpeoplesearch.com OR site:beenverified.com`);
    
    return dorks;
}
