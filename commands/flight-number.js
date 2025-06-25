/**
 * File: flight-number.js
 * Description: Command to get flight tracking links for a given flight number
 * Author: gl0bal01
 * 
 * This command takes a flight number as input and generates tracking links
 * for various flight tracking services to help users monitor flights.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-flight-number')
        .setDescription('Get flight tracking links for a flight number')
        .addStringOption(option =>
            option.setName('flight')
                .setDescription('The flight number (e.g. BA234, DL1234)')
                .setRequired(true)),
                
    async execute(interaction) {
        try {
            const flightNumber = interaction.options.getString('flight');
            
            // Validate and standardize the flight number
            const standardizedFlightNumber = standardizeFlightNumber(flightNumber);
            if (!standardizedFlightNumber) {
                return await interaction.reply({
                    content: 'Please provide a valid flight number (e.g. BA234, DL1234, UA89).',
                    ephemeral: false
                });
            }
            
            // Generate links for the flight number
            const links = generateTrackingLinks(standardizedFlightNumber);
            
            // Create embed for response
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`Flight Tracking: ${standardizedFlightNumber.airline}${standardizedFlightNumber.number}`)
                .setDescription('Click on the links below to track this flight:')
                .addFields(
                    { name: 'AirNavRadar', value: links.airNavRadar, inline: false },
                    { name: 'FlightAware', value: links.flightAware, inline: false },
                    { name: 'Flightera', value: links.flightera, inline: false },
                    { name: 'AirportInfo Live', value: links.airportInfo, inline: false },
                    { name: 'FlightRadar24', value: links.flightRadar24, inline: false }
                )
                .setFooter({ text: 'Flight tracking data powered by multiple providers' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in flight-number command:', error);
            await interaction.reply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true
            });
        }
    },
};

/**
 * Standardize flight number into airline code and flight number
 * @param {string} input - Raw flight number input
 * @returns {object|null} - Object with airline and number properties, or null if invalid
 */
function standardizeFlightNumber(input) {
    if (!input) return null;
    
    // Remove spaces and convert to uppercase
    const cleanInput = input.toUpperCase().replace(/\s+/g, '');
    
    // Try to match airline code (2-3 letters) followed by flight number (1-4 digits)
    const match = cleanInput.match(/^([A-Z]{2,3})(\d{1,4})$/);
    if (!match) return null;
    
    const airline = match[1];
    const number = match[2];
    
    // Return standardized format
    return {
        airline: airline,
        number: number
    };
}

/**
 * Generate tracking links for various flight tracking websites
 * @param {object} flight - Standardized flight object
 * @returns {object} - Object containing links to various tracking websites
 */
function generateTrackingLinks(flight) {
    // Create the standard format
    const flightDesignator = `${flight.airline}${flight.number}`;
    
    return {
        airNavRadar: `https://www.airnavradar.com/data/flights/${flightDesignator}`,
        flightAware: `https://fr.flightaware.com/live/flight/${flightDesignator}`,
        flightera: `https://www.flightera.net/en/flight/${flightDesignator}`,
        airportInfo: `https://airportinfo.live/flight/${flightDesignator.toLowerCase()}`,
        flightRadar24: `https://www.flightradar24.com/data/flights/${flightDesignator.toLowerCase()}`
    };
}
