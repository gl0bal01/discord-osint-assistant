/**
 * File: vessels.js
 * Description: Command to get vessel tracking links for an IMO number
 * Author: gl0bal01
 * 
 * This command generates tracking links for maritime vessels based on IMO numbers
 * or vessel names, providing quick access to multiple vessel tracking services.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-vessel')
        .setDescription('Get vessel tracking and information links')
        .addSubcommand(subcommand =>
            subcommand
                .setName('imo')
                .setDescription('Search vessel by IMO number')
                .addStringOption(option =>
                    option.setName('number')
                        .setDescription('The IMO number (e.g. 9395044)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('name')
                .setDescription('Search vessel by name')
                .addStringOption(option =>
                    option.setName('vessel')
                        .setDescription('The vessel name to search')
                        .setRequired(true))),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            const subcommand = interaction.options.getSubcommand();
            
            if (subcommand === 'imo') {
                const imoNumber = interaction.options.getString('number');
                
                // Validate IMO number
                if (!validateIMO(imoNumber)) {
                    return interaction.editReply('Please provide a valid IMO number (7 digits, e.g. 9395044).');
                }
                
                // Generate tracking links for the IMO number
                const links = generateTrackingLinks(imoNumber);
                
                // Try to fetch basic vessel info if possible
                let vesselInfo = null;
                try {
                    vesselInfo = await fetchVesselInfo(imoNumber);
                } catch (error) {
                    console.error('Error fetching vessel info:', error);
                    // Continue without vessel info - links will still work
                }
                
                // Create embed for response
                const embed = createVesselEmbed(imoNumber, links, vesselInfo);
                
                await interaction.editReply({ embeds: [embed] });
            } 
            else if (subcommand === 'name') {
                const vesselName = interaction.options.getString('vessel');
                
                if (!vesselName || vesselName.trim().length < 3) {
                    return interaction.editReply('Please provide a vessel name with at least 3 characters.');
                }
                
                // Create search links for vessel name
                const searchLinks = generateNameSearchLinks(vesselName);
                
                // Create embed for vessel name search
                const embed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle(`Vessel Search: "${vesselName}"`)
                    .setDescription('Search for this vessel name on multiple tracking services:')
                    .addFields(
                        { name: 'MarineTraffic', value: searchLinks.marineTraffic, inline: false },
                        { name: 'VesselFinder', value: searchLinks.vesselFinder, inline: false },
                        { name: 'MyShipTracking', value: searchLinks.myShipTracking, inline: false },
                        { name: 'FleetMon', value: searchLinks.fleetMon, inline: false },
                        { name: 'IMO Search', value: searchLinks.imoSearch, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Use the IMO number for more precise tracking once you identify the vessel' });
                
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error in vessel command:', error);
            await interaction.editReply('An error occurred while processing your request. Please try again later.');
        }
    },
};

/**
 * Validate IMO number
 * @param {string} imo - The IMO number to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateIMO(imo) {
    // Remove spaces and any non-digit characters
    const cleanImo = imo.replace(/\D/g, '');
    
    // IMO numbers should be 7 digits
    if (cleanImo.length !== 7) return false;
    
    // Check if all characters are digits
    return /^\d{7}$/.test(cleanImo);
    
    // More thorough validation could include the checksum algorithm for IMO numbers:
    // IMO number is a 7-digit number where the last digit is a checksum
    // Checksum is calculated by: multiplying each of the first 6 digits by a factor of 2 to 7
    // (from right to left), summing the products, and taking the result modulo 10
}

/**
 * Generate tracking links for various maritime tracking websites
 * @param {string} imo - The IMO number
 * @returns {object} - Object containing links to various tracking websites
 */
function generateTrackingLinks(imo) {
    // Clean the IMO number to ensure it's just digits
    const cleanImo = imo.replace(/\D/g, '');
    
    return {
        balticShipping: `https://www.balticshipping.com/vessel/imo/${cleanImo}`,
        vesselFinder: `https://www.vesselfinder.com/vessels/details/${cleanImo}`,
        marineTraffic: `https://www.marinetraffic.com/en/ais/details/ships/imo:${cleanImo}`,
        vesselTracker: `https://www.vesseltracker.com/en/Ships/${cleanImo}.html`,
        myShipTracking: `https://www.myshiptracking.com/vessels/details/${cleanImo}`,
        fleetMon: `https://www.fleetmon.com/vessels/search/?q=${cleanImo}`,
        equasis: `https://www.equasis.org/EquasisWeb/public/PublicSearch/IMO?IMONumber=${cleanImo}`,
        shipVault: `https://www.shipvault.com/vessel/${cleanImo}`,
        ihs: `https://maritime.ihs.com/vessels/${cleanImo}/imo`
    };
}

/**
 * Generate search links for vessel name searches
 * @param {string} name - The vessel name to search for
 * @returns {object} - Object containing links to various search websites
 */
function generateNameSearchLinks(name) {
    // Encode the name for URLs
    const encodedName = encodeURIComponent(name);
    
    return {
        marineTraffic: `https://www.marinetraffic.com/en/ais/index/search/all/keyword:${encodedName}`,
        vesselFinder: `https://www.vesselfinder.com/vessels?name=${encodedName}`,
        myShipTracking: `https://www.myshiptracking.com/?search=${encodedName}`,
        fleetMon: `https://www.fleetmon.com/vessels/search/?q=${encodedName}`,
        imoSearch: `https://www.imonumbers.lrfairplay.com/search?query=${encodedName}`
    };
}

/**
 * Create an embed for vessel information
 * @param {string} imo - The IMO number
 * @param {object} links - Object containing tracking links
 * @param {object} vesselInfo - Optional vessel information
 * @returns {EmbedBuilder} - Discord embed with vessel information
 */
function createVesselEmbed(imo, links, vesselInfo) {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`Vessel Tracking: IMO ${imo}`)
        .setDescription('Click on the links below to track this vessel:')
        .addFields(
            { name: 'MarineTraffic', value: links.marineTraffic, inline: false },
            { name: 'VesselFinder', value: links.vesselFinder, inline: false },
            { name: 'BalticShipping', value: links.balticShipping, inline: false },
            { name: 'VesselTracker', value: links.vesselTracker, inline: false },
            { name: 'MyShipTracking', value: links.myShipTracking, inline: false },
            { name: 'FleetMon', value: links.fleetMon, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Maritime vessel tracking data from multiple providers' });
    
    // Add vessel information if available
    if (vesselInfo) {
        if (vesselInfo.name) embed.setTitle(`${vesselInfo.name} (IMO ${imo})`);
        
        const infoFields = [];
        if (vesselInfo.type) infoFields.push({ name: 'Vessel Type', value: vesselInfo.type, inline: true });
        if (vesselInfo.flag) infoFields.push({ name: 'Flag', value: vesselInfo.flag, inline: true });
        if (vesselInfo.built) infoFields.push({ name: 'Built', value: vesselInfo.built.toString(), inline: true });
        if (vesselInfo.length) infoFields.push({ name: 'Length', value: `${vesselInfo.length} m`, inline: true });
        if (vesselInfo.beam) infoFields.push({ name: 'Beam', value: `${vesselInfo.beam} m`, inline: true });
        if (vesselInfo.gt) infoFields.push({ name: 'Gross Tonnage', value: vesselInfo.gt.toString(), inline: true });
        
        if (infoFields.length > 0) {
            embed.addFields({ name: 'Vessel Information', value: '\u200B' });
            embed.addFields(...infoFields);
        }
        
        // Add image if available
        if (vesselInfo.image) {
            embed.setImage(vesselInfo.image);
        }
    }
    
    // Add additional resources section
    embed.addFields({
        name: 'Additional Resources', 
        value: 'Other databases:\n' +
               `[Equasis](${links.equasis}) | ` +
               `[ShipVault](${links.shipVault}) | ` +
               `[IHS Maritime](${links.ihs})`
    });
    
    return embed;
}

/**
 * Attempt to fetch basic vessel information
 * @param {string} imo - The IMO number
 * @returns {Promise<object>} - Promise resolving to vessel information
 */
async function fetchVesselInfo(imo) {
    try {
        // Note: This is a placeholder function. In a real-world scenario,
        // you would implement an actual API call to a maritime database.
        // For demonstration purposes, this function simulates an API call
        // but would need to be replaced with a real implementation.
        
        // Example using a free API (if one were available):
        // const response = await axios.get(`https://api.maritime-database.com/vessel/imo/${imo}`, {
        //     headers: { 'Authorization': `Bearer ${process.env.MARITIME_API_KEY}` }
        // });
        // return response.data;
        
        // For now, return null to indicate no vessel info is available
        return null;
        
        // If you have a specific API you'd like to use, you would implement
        // the API call and data transformation here.
    } catch (error) {
        console.error('Error fetching vessel info:', error);
        return null;
    }
}
