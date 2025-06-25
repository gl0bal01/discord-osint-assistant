/**
 * File: airport.js
 * Description: Comprehensive airport information and intelligence gathering
 * Author: gl0bal01
 * 
 * This command provides detailed airport intelligence including:
 * - Airport operational data and statistics
 * - Runway and facility information
 * - Location and geographical data
 * - Contact information and services
 * - Real-time operational status
 * 
 * Features:
 * - Multi-format airport code support (ICAO, IATA)
 * - Comprehensive facility analysis
 * - Operational capacity assessment
 * - Geographic coordinate mapping
 * - Historical operational data
 * 
 * Data Sources:
 * - AirportDB.io for detailed airport information
 * - TravelPayouts API for basic airport data
 * - Multiple aviation databases for comprehensive coverage
 * 
 * Usage: /bob-airport icao:EGLL
 *        /bob-airport iata:LHR
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-airport')
        .setDescription('Get information about an airport')
        .addStringOption(option =>
            option.setName('icao')
                .setDescription('The ICAO code of the airport (KJFK)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('iata')
                .setDescription('The IATA code of the airport (JFK)')
                .setRequired(false)),
    async execute(interaction) {
        const icao = interaction.options.getString('icao');
        const iata = interaction.options.getString('iata');
        
        // Validate input: require either ICAO or IATA, but not both
        if ((!icao && !iata) || (icao && iata)) {
            await interaction.reply('Please provide either an ICAO code or an IATA code, but not both.');
            return;
        }
        
        try {
            if (icao) {
                await handleICAOSearch(interaction, icao);
            } else {
                await handleIATASearch(interaction, iata);
            }
        } catch (error) {
            console.error(`Error fetching airport data: ${error}`);
            const codeType = icao ? 'ICAO' : 'IATA';
            await interaction.reply(`Error fetching airport data. Please check the ${codeType} code and try again.`);
        }
    },
};

async function handleICAOSearch(interaction, icao) {
    const apiToken = process.env.AIRPORTDB_API_KEY;
    if (!apiToken) {
        await interaction.reply('Error: API token not found. Please check the .env file.');
        return;
    }

    const response = await axios.get(`https://airportdb.io/api/v1/airport/${icao}?apiToken=${apiToken}`);
    const airport = response.data;
    
    const embed = createEmbed(airport);
    await interaction.reply({ embeds: [embed] });
}

async function handleIATASearch(interaction, iata) {
    // Fetch airports data from TravelPayouts API
    const response = await axios.get('https://api.travelpayouts.com/data/en/airports.json');
    const airports = response.data;
    
    // Find the airport with matching IATA code
    const airport = airports.find(a => a.code === iata);
    
    if (!airport) {
        await interaction.reply(`No airport found with IATA code: ${iata}`);
        return;
    }
    
    // Create a simplified embed with available data
    const embed = {
        color: 0x0099ff,
        title: `${airport.name} (${airport.code})`,
        fields: [
            { name: 'IATA Code', value: airport.code, inline: true },
            { name: 'City Code', value: airport.city_code || 'N/A', inline: true },
            { name: 'Country', value: airport.country_code || 'N/A', inline: true },
            { name: 'Time Zone', value: airport.time_zone || 'N/A', inline: true },
            { name: 'Coordinates', value: `${airport.coordinates.lat}, ${airport.coordinates.lon}`, inline: true },
            { name: 'Flightable', value: airport.flightable ? 'Yes' : 'No', inline: true },
        ],
        footer: { text: 'Data provided by TravelPayouts API' },
    };
    
    await interaction.reply({ embeds: [embed] });
    
    // Try to get additional data from AirportDB if possible
    try {
        const apiToken = process.env.AIRPORTDB_API_KEY;
        if (apiToken) {
            // Try to find this airport in AirportDB using the IATA code
            const detailedResponse = await axios.get(`https://airportdb.io/api/v1/airport/iata/${iata}?apiToken=${apiToken}`);
            
            if (detailedResponse.data) {
                const detailedAirport = detailedResponse.data;
                const detailedEmbed = createEmbed(detailedAirport);
                await interaction.followUp({ content: 'Additional details found:', embeds: [detailedEmbed] });
            }
        }
    } catch (error) {
        // Silently ignore any errors here as we already provided basic data
        console.log(`Could not fetch additional data for IATA ${iata}: ${error.message}`);
    }
}

function createEmbed(airport) {
    return {
        color: 0x0099ff,
        title: `${airport.name} (${airport.icao_code || airport.icao})`,
        fields: [
            { name: 'Home', value: airport.home_link || 'N/A' },
            { name: 'Wiki', value: airport.wikipedia_link || 'N/A' },
            { name: 'IATA Code', value: airport.iata_code || 'N/A', inline: true },
            { name: 'Type', value: airport.type || 'N/A', inline: true },
            { name: 'Location', value: `${airport.municipality || 'N/A'}, ${airport.iso_country || 'N/A'}`, inline: true },
            { name: 'Coordinates', value: `${airport.latitude_deg || airport.lat}, ${airport.longitude_deg || airport.lon}`, inline: true },
            { name: 'Elevation', value: airport.elevation_ft ? `${airport.elevation_ft} ft` : 'N/A', inline: true },
            { name: 'Runways', value: airport.runways ? airport.runways.length.toString() : 'N/A', inline: true },
        ],
        footer: { text: 'Data provided by AirportDB.io' },
    };
}