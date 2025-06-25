/**
 * File: generate-usernames.js
 * Description: Username variation generator for OSINT investigations
 * Author: gl0bal01
 * 
 * This command generates comprehensive username variations based on first and last names,
 * providing investigators with potential username combinations to search across platforms.
 * Useful for social media reconnaissance and account discovery.
 * 
 * Features:
 * - Multiple combination patterns (firstname.lastname, f.lastname, etc.)
 * - Customizable separators (dots, underscores, hyphens, etc.)
 * - Optional suffix/prefix support
 * - Common social media username patterns
 * - Export results to file for batch processing
 * 
 * Usage: /generate-usernames firstname:John lastname:Doe separators:.,_,- suffix:123
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const { sanitizeInput } = require('../utils/validation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-generate-usernames')
        .setDescription('Generate username combinations for OSINT investigations')
        .addStringOption(option => 
            option.setName('firstname')
                .setDescription('First name to use for generation')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50))
        .addStringOption(option => 
            option.setName('lastname')
                .setDescription('Last name to use for generation')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50))
        .addStringOption(option => 
            option.setName('separators')
                .setDescription('Custom separators (comma-separated, default: ".,_,-")')
                .setRequired(false)
                .setMaxLength(50))
        .addStringOption(option => 
            option.setName('suffix')
                .setDescription('Text to append to all usernames (e.g., birth year)')
                .setRequired(false)
                .setMaxLength(20))
        .addStringOption(option => 
            option.setName('prefix')
                .setDescription('Text to prepend to all usernames')
                .setRequired(false)
                .setMaxLength(20))
        .addBooleanOption(option =>
            option.setName('include-numbers')
                .setDescription('Include variations with common numbers (01, 123, etc.)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('case-variations')
                .setDescription('Include different case variations (default: true)')
                .setRequired(false)),
                
    /**
     * Execute the username generation command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        // Get and validate input parameters
        const rawFirstName = interaction.options.getString('firstname');
        const rawLastName = interaction.options.getString('lastname');
        const customSeparators = interaction.options.getString('separators');
        const suffix = interaction.options.getString('suffix') || '';
        const prefix = interaction.options.getString('prefix') || '';
        const includeNumbers = interaction.options.getBoolean('include-numbers') || false;
        const caseVariations = interaction.options.getBoolean('case-variations') !== false; // Default true
        
        // Sanitize inputs
        const firstName = sanitizeInput(rawFirstName);
        const lastName = sanitizeInput(rawLastName);
        
        // Validate inputs
        if (!firstName || !lastName) {
            return interaction.reply({
                content: '❌ **Invalid Input**\n' +
                        'First name and last name must contain valid characters.\n' +
                        'Allowed: letters, numbers, spaces (spaces will be removed)',
                ephemeral: true
            });
        }
        
        // Remove spaces and validate final names
        const cleanFirstName = firstName.replace(/\s+/g, '');
        const cleanLastName = lastName.replace(/\s+/g, '');
        
        if (cleanFirstName.length === 0 || cleanLastName.length === 0) {
            return interaction.reply({
                content: '❌ **Invalid Names**\n' +
                        'Names must contain at least one valid character after cleaning.',
                ephemeral: true
            });
        }
        
        console.log(`👤 [USERNAME-GEN] Generating usernames for: ${cleanFirstName} ${cleanLastName}`);
        
        try {
            // Generate username variations
            const usernames = generateUsernames({
                firstName: cleanFirstName,
                lastName: cleanLastName,
                separators: customSeparators || '.,_,-',
                suffix: sanitizeInput(suffix),
                prefix: sanitizeInput(prefix),
                includeNumbers,
                caseVariations
            });
            
            // Format response
            const response = formatUsernameResponse(usernames, cleanFirstName, cleanLastName);
            
            // Create attachment with full list
            const attachment = createUsernameAttachment(usernames, cleanFirstName, cleanLastName);
            
            await interaction.reply({
                content: response,
                files: [attachment],
                ephemeral: true // Keep results private for OSINT work
            });
            
            console.log(`✅ [USERNAME-GEN] Generated ${usernames.length} username variations`);
            
        } catch (error) {
            console.error('[USERNAME-GEN] Error generating usernames:', error);
            await interaction.reply({
                content: '❌ **Generation Failed**\n' +
                        'An error occurred while generating username variations.',
                ephemeral: true
            });
        }
    },
};

/**
 * Generate comprehensive username variations
 * @param {Object} options - Generation options
 * @returns {Array<string>} Array of generated usernames
 */
function generateUsernames(options) {
    const {
        firstName,
        lastName,
        separators,
        suffix,
        prefix,
        includeNumbers,
        caseVariations
    } = options;
    
    const usernames = new Set(); // Use Set to avoid duplicates
    
    // Basic name components
    const firstInitial = firstName.charAt(0);
    const lastInitial = lastName.charAt(0);
    const firstThree = firstName.substring(0, 3);
    const lastThree = lastName.substring(0, 3);
    const firstFour = firstName.substring(0, 4);
    const lastFour = lastName.substring(0, 4);
    
    // Base patterns without separators
    const basePatterns = [
        `${firstName}${lastName}`,
        `${lastName}${firstName}`,
        `${firstInitial}${lastName}`,
        `${lastName}${firstInitial}`,
        `${firstName}${lastInitial}`,
        `${lastInitial}${firstName}`,
        `${firstThree}${lastThree}`,
        `${lastThree}${firstThree}`,
        `${firstFour}${lastFour}`,
        `${lastFour}${firstFour}`,
        `${firstName}`,
        `${lastName}`,
        `${firstInitial}${lastInitial}`,
        `${lastInitial}${firstInitial}`
    ];
    
    // Add base patterns to usernames
    basePatterns.forEach(pattern => {
        addUsernameVariation(usernames, pattern, prefix, suffix, caseVariations);
    });
    
    // Patterns with separators
    const separatorList = separators.split(',').filter(sep => sep.trim() !== '');
    
    separatorList.forEach(separator => {
        const cleanSep = separator.trim();
        
        const separatorPatterns = [
            `${firstName}${cleanSep}${lastName}`,
            `${lastName}${cleanSep}${firstName}`,
            `${firstName}${cleanSep}${lastInitial}`,
            `${lastName}${cleanSep}${firstInitial}`,
            `${firstInitial}${cleanSep}${lastName}`,
            `${lastInitial}${cleanSep}${firstName}`,
            `${firstThree}${cleanSep}${lastThree}`,
            `${lastThree}${cleanSep}${firstThree}`,
            `${firstInitial}${cleanSep}${lastInitial}`,
            `${lastInitial}${cleanSep}${firstInitial}`
        ];
        
        separatorPatterns.forEach(pattern => {
            addUsernameVariation(usernames, pattern, prefix, suffix, caseVariations);
        });
    });
    
    // Add number variations if requested
    if (includeNumbers) {
        const commonNumbers = ['1', '01', '12', '123', '1234', '21', '2023', '2024', '2025'];
        const currentUsernames = Array.from(usernames);
        
        currentUsernames.forEach(username => {
            commonNumbers.forEach(number => {
                // Strip existing prefix/suffix to avoid duplication
                const baseUsername = username.replace(new RegExp(`^${prefix}`), '').replace(new RegExp(`${suffix}$`), '');
                addUsernameVariation(usernames, baseUsername, prefix, suffix + number, caseVariations);
                addUsernameVariation(usernames, baseUsername, prefix + number, suffix, caseVariations);
            });
        });
    }
    
    // Convert Set back to Array and sort
    return Array.from(usernames).sort();
}

/**
 * Add username variation with prefix, suffix, and case options
 * @param {Set} usernames - Set to add usernames to
 * @param {string} baseUsername - Base username pattern
 * @param {string} prefix - Prefix to add
 * @param {string} suffix - Suffix to add
 * @param {boolean} caseVariations - Whether to include case variations
 */
function addUsernameVariation(usernames, baseUsername, prefix, suffix, caseVariations) {
    const fullUsername = `${prefix}${baseUsername}${suffix}`;
    
    if (caseVariations) {
        // Add different case variations
        usernames.add(fullUsername.toLowerCase());
        usernames.add(fullUsername.toUpperCase());
        usernames.add(capitalizeFirst(fullUsername));
        usernames.add(fullUsername); // Original case
    } else {
        usernames.add(fullUsername.toLowerCase());
    }
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Format username response for Discord message
 * @param {Array<string>} usernames - Generated usernames
 * @param {string} firstName - First name used
 * @param {string} lastName - Last name used
 * @returns {string} Formatted response
 */
function formatUsernameResponse(usernames, firstName, lastName) {
    const maxDisplayInMessage = 20;
    const displayUsernames = usernames.slice(0, maxDisplayInMessage);
    
    let response = `👤 **Username Variations Generated**\n`;
    response += `📝 **For:** ${firstName} ${lastName}\n`;
    response += `📊 **Total Variations:** ${usernames.length}\n\n`;
    
    response += `**🔍 Sample Usernames (showing ${Math.min(maxDisplayInMessage, usernames.length)}):**\n`;
    response += '```\n';
    
    displayUsernames.forEach((username, index) => {
        response += `${(index + 1).toString().padStart(2)}. ${username}\n`;
    });
    
    response += '```\n';
    
    if (usernames.length > maxDisplayInMessage) {
        response += `\n📎 **Complete list attached** (${usernames.length} total variations)\n`;
    }
    
    response += `\n💡 **OSINT Tip:** Use these variations with tools like Sherlock, Maigret, or manual platform searches.`;
    
    return response;
}

/**
 * Create attachment file with all usernames
 * @param {Array<string>} usernames - Generated usernames
 * @param {string} firstName - First name used
 * @param {string} lastName - Last name used
 * @returns {AttachmentBuilder} Discord attachment
 */
function createUsernameAttachment(usernames, firstName, lastName) {
    const timestamp = new Date().toISOString();
    
    let content = `# Username Variations for ${firstName} ${lastName}\n`;
    content += `# Generated: ${timestamp}\n`;
    content += `# Total Variations: ${usernames.length}\n`;
    content += `# \n`;
    content += `# Use these usernames for:\n`;
    content += `# - Social media searches\n`;
    content += `# - Email enumeration\n`;
    content += `# - Platform reconnaissance\n`;
    content += `# - Account discovery\n`;
    content += `#\n\n`;
    
    usernames.forEach((username, index) => {
        content += `${username}\n`;
    });
    
    content += `\n# End of variations\n`;
    content += `# Generated by Discord OSINT Assistant\n`;
    
    return new AttachmentBuilder(
        Buffer.from(content, 'utf8'),
        { name: `usernames_${firstName}_${lastName}_${Date.now()}.txt` }
    );
}
