/**
 * File: aviation.js
 * Description: Command to get real-time flight information using Aviation Stack API
 * Author: gl0bal01
 * 
 * This command allows users to retrieve flight information by flight number,
 * airline code, or airport code using the AviationStack API.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-flight')
        .setDescription('Get real-time flight information')
        .addStringOption(option => 
            option.setName('flight_number')
                .setDescription('Flight number (e.g., BA123)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('airline')
                .setDescription('Airline IATA code (e.g., BA for British Airways)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('airport')
                .setDescription('Airport IATA code (e.g., LHR for London Heathrow)')
                .setRequired(false)),
    
    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Get user input
            const flightNumber = interaction.options.getString('flight_number');
            const airline = interaction.options.getString('airline');
            const airport = interaction.options.getString('airport');
            
            // Check if at least one parameter is provided
            if (!flightNumber && !airline && !airport) {
                return interaction.editReply('Please provide at least one parameter: flight number, airline code, or airport code.');
            }

            // Validate the API token
            const apiToken = process.env.AVIATIONSTACK_API_KEY;
            if (!apiToken) {
                console.error('Missing AVIATIONSTACK_API_KEY in environment variables');
                return interaction.editReply('API configuration error. Please contact the administrator.');
            }

            // Build query parameters
            const params = {
                access_key: apiToken,
                limit: 5 // Limit results to avoid large responses
            };

            // Add query parameters based on user input
            if (flightNumber) {
                // Validate flight number format (basic check)
                if (!/^[A-Z0-9]{2,8}$/i.test(flightNumber)) {
                    return interaction.editReply('Invalid flight number format. Please provide a valid flight number (e.g., BA123).');
                }
                params.flight_number = flightNumber;
            }
            
            if (airline) {
                // Validate airline IATA code format
                if (!/^[A-Z]{2,3}$/i.test(airline)) {
                    return interaction.editReply('Invalid airline code format. Please provide a valid IATA code (2-3 characters, e.g., BA).');
                }
                params.airline_iata = airline.toUpperCase();
            }
            
            if (airport) {
                // Validate airport IATA code format
                if (!/^[A-Z]{3}$/i.test(airport)) {
                    return interaction.editReply('Invalid airport code format. Please provide a valid IATA code (3 characters, e.g., LHR).');
                }
                params.dep_iata = airport.toUpperCase(); // Departure airport
            }

            // Make API request with timeout and proper error handling
            try {
                const response = await axios.get('http://api.aviationstack.com/v1/flights', { 
                    params,
                    timeout: 10000 // 10 second timeout
                });
                
                if (response.data.error) {
                    console.error('Aviation Stack API error:', response.data.error);
                    return interaction.editReply(`API Error: ${response.data.error.message || 'Unknown error'}`);
                }

                const flights = response.data.data;
                
                if (!flights || flights.length === 0) {
                    return interaction.editReply('No flights found matching your criteria.');
                }

                // Create embed for the first flight
                const createFlightEmbed = (flight) => {
                    // Safely access nested properties
                    const airline = flight.airline || {};
                    const flightData = flight.flight || {};
                    const departure = flight.departure || {};
                    const arrival = flight.arrival || {};
                    const aircraft = flight.aircraft || {};

                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle(`${airline.name || 'Unknown Airline'} Flight ${flightData.iata || flightData.icao || 'Unknown'}`)
                        .setDescription(`Status: ${flight.flight_status || 'Unknown'}`)
                        .addFields(
                            { name: 'Departure', value: `${departure.airport || 'N/A'} (${departure.iata || 'N/A'})`, inline: true },
                            { name: 'Arrival', value: `${arrival.airport || 'N/A'} (${arrival.iata || 'N/A'})`, inline: true },
                            { name: 'Aircraft', value: aircraft.registration || 'N/A', inline: true },
                            { name: 'Scheduled Departure', value: formatDate(departure.scheduled) || 'N/A', inline: true },
                            { name: 'Scheduled Arrival', value: formatDate(arrival.scheduled) || 'N/A', inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Data provided by Aviation Stack' });

                    // Add delay information if available
                    if (departure.delay) {
                        embed.addFields({ name: 'Departure Delay', value: `${departure.delay} minutes`, inline: true });
                    }
                    if (arrival.delay) {
                        embed.addFields({ name: 'Arrival Delay', value: `${arrival.delay} minutes`, inline: true });
                    }

                    return embed;
                };

                // Format date function with better error handling
                function formatDate(dateString) {
                    if (!dateString) return null;
                    try {
                        const date = new Date(dateString);
                        if (isNaN(date.getTime())) return 'Invalid Date';
                        return date.toLocaleString();
                    } catch (error) {
                        console.error('Date formatting error:', error);
                        return 'Date Error';
                    }
                }

                // Get embeds for up to 5 flights
                const embeds = flights.slice(0, 5).map(flight => createFlightEmbed(flight));
                
                if (embeds.length === 1) {
                    return interaction.editReply({ embeds: [embeds[0]] });
                } else {
                    await interaction.editReply({ content: `Found ${flights.length} flights. Showing the first ${embeds.length}:`, embeds: [embeds[0]] });
                    
                    // Send additional embeds as follow-up messages to avoid hitting Discord's embed limits
                    for (let i = 1; i < embeds.length; i++) {
                        await interaction.followUp({ embeds: [embeds[i]] });
                    }
                }
            } catch (apiError) {
                console.error('Error fetching flight data:', apiError);
                
                // Provide informative error message based on the error type
                if (apiError.response) {
                    // API responded with an error status code
                    console.error('API error response:', apiError.response.status, apiError.response.data);
                    
                    if (apiError.response.status === 401) {
                        return interaction.editReply('Authentication error: Invalid API key. Please contact the administrator.');
                    } else if (apiError.response.status === 404) {
                        return interaction.editReply('No flights found matching your criteria.');
                    } else if (apiError.response.status === 429) {
                        return interaction.editReply('Rate limit exceeded. Please try again later.');
                    }
                    
                    return interaction.editReply(`API Error (${apiError.response.status}): ${apiError.response.data.error?.info || 'Failed to fetch flight data'}`);
                } else if (apiError.request) {
                    // No response received
                    return interaction.editReply('Could not connect to flight data service. Please try again later.');
                } else {
                    // Other error
                    return interaction.editReply(`Error fetching flight data: ${apiError.message}`);
                }
            }
        } catch (commandError) {
            // Handle any unexpected errors in the command execution
            console.error('Command execution error:', commandError);
            
            // Check if we've already replied (deferred)
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply('An unexpected error occurred while processing your request. Please try again later.');
            } else {
                await interaction.reply({ content: 'An unexpected error occurred while processing your request. Please try again later.', ephemeral: true });
            }
        }
    },
};
