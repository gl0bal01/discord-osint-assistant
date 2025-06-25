/**
 * File: vpic.js
 * Description: Command to retrieve vehicle information using NHTSA vPIC API
 * Author: gl0bal01
 * 
 * This command interfaces with the NHTSA vPIC API to decode VINs and
 * retrieve vehicle make information, returning detailed vehicle data.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-vpic')
        .setDescription('Retrieve vehicle information using NHTSA vPIC API')
        .addSubcommand(subcommand =>
            subcommand
                .setName('decode')
                .setDescription('Decode a VIN')
                .addStringOption(option =>
                    option.setName('vin')
                        .setDescription('The VIN to decode')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('raw')
                        .setDescription('Return raw JSON data')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('makes')
                .setDescription('Get all vehicle makes')
                .addIntegerOption(option =>
                    option.setName('year')
                        .setDescription('Filter makes by model year')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('Page number for results (starts at 1)')
                        .setRequired(false)
                        .setMinValue(1))
                .addBooleanOption(option =>
                    option.setName('raw')
                        .setDescription('Return raw JSON data')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('models')
                .setDescription('Get models for a specific make')
                .addStringOption(option =>
                    option.setName('make')
                        .setDescription('The vehicle make (e.g., Honda)')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('year')
                        .setDescription('Filter by model year')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('raw')
                        .setDescription('Return raw JSON data')
                        .setRequired(false))),
                        
    async execute(interaction) {
        await interaction.deferReply();

        try {
            const subcommand = interaction.options.getSubcommand();
            const returnRaw = interaction.options.getBoolean('raw') || false;
            
            // Handle different subcommands
            if (subcommand === 'decode') {
                await handleVinDecode(interaction, returnRaw);
            } else if (subcommand === 'makes') {
                await handleGetMakes(interaction, returnRaw);
            } else if (subcommand === 'models') {
                await handleGetModels(interaction, returnRaw);
            }
        } catch (error) {
            console.error('Error in vpic command:', error);
            
            const errorMessage = generateErrorMessage(error);
            await interaction.editReply(errorMessage);
        }
    },
};

/**
 * Handle the VIN decode command
 * @param {object} interaction - Discord interaction
 * @param {boolean} returnRaw - Whether to return raw JSON data
 */
async function handleVinDecode(interaction, returnRaw) {
    const vin = interaction.options.getString('vin');
    
    // Validate VIN format
    if (!isValidVin(vin)) {
        return interaction.editReply('Please provide a valid Vehicle Identification Number (VIN). VINs are typically 17 characters long and do not include the letters I, O, or Q.');
    }
    
    try {
        // Get both basic and extended data for more complete information
        const basicResponse = await axios.get(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { 
            timeout: 10000 
        });
        
        const extendedResponse = await axios.get(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`, { 
            timeout: 10000 
        });
        
        // Check if we got valid responses
        if (!basicResponse.data || !basicResponse.data.Results || !basicResponse.data.Results.length) {
            return interaction.editReply('No data found for the provided VIN. Please check the VIN and try again.');
        }
        
        // Extract data
        const basicData = basicResponse.data.Results[0];
        const extendedData = extendedResponse.data.Results;
        
        // If raw data requested, return the full JSON data
        if (returnRaw) {
            // Combine both datasets for complete info
            const combinedData = {
                basic: basicData,
                extended: extendedData
            };
            
            // Create a temp directory for the file
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Create unique filename with random ID
            const randomId = crypto.randomBytes(4).toString('hex');
            const filePath = path.join(tempDir, `vin_${vin}_${randomId}.json`);
            
            // Write the data to a JSON file
            fs.writeFileSync(filePath, JSON.stringify(combinedData, null, 2));
            
            // Create an attachment for the JSON file
            const attachment = new AttachmentBuilder(filePath, { 
                name: `vin_${vin}.json` 
            });
            
            // Send the response with the attachment
            await interaction.editReply({
                content: `Raw vehicle data for VIN: ${vin}`,
                files: [attachment]
            });
            
            // Clean up the temporary file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error('Error cleaning up temporary file:', error);
                }
            }, 5000);
            
            return;
        }
        
        // Extract the most relevant fields
        const make = basicData.Make || 'Unknown';
        const model = basicData.Model || 'Unknown';
        const year = basicData.ModelYear || 'Unknown';
        const vehicleType = basicData.VehicleType || 'Unknown';
        const bodyClass = basicData.BodyClass || 'Unknown';
        const driveType = basicData.DriveType || 'Unknown';
        const engineCylinders = basicData.EngineCylinders || 'Unknown';
        const engineHP = basicData.EngineHP || 'Unknown';
        const fuelType = basicData.FuelTypePrimary || 'Unknown';
        const manufacturer = basicData.Manufacturer || 'Unknown';
        const plantCountry = basicData.PlantCountry || 'Unknown';
        const transmissionStyle = basicData.TransmissionStyle || 'Unknown';
        
        // Create an embed for the response
        const embed = new EmbedBuilder()
            .setTitle(`Vehicle Information for VIN: ${vin}`)
            .setDescription(`Decoded information for the provided Vehicle Identification Number`)
            .setColor(0x0099FF)
            .addFields(
                { name: 'Make', value: make, inline: true },
                { name: 'Model', value: model, inline: true },
                { name: 'Year', value: year, inline: true },
                { name: 'Vehicle Type', value: vehicleType, inline: true },
                { name: 'Body Style', value: bodyClass, inline: true },
                { name: 'Drive Type', value: driveType, inline: true },
                { name: 'Engine', value: `${engineCylinders} cyl / ${engineHP} HP`, inline: true },
                { name: 'Fuel Type', value: fuelType, inline: true },
                { name: 'Transmission', value: transmissionStyle, inline: true },
                { name: 'Manufacturer', value: manufacturer, inline: false },
                { name: 'Manufactured In', value: plantCountry, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Data from NHTSA vPIC API' });
            
        // Add some specific values from the extended data that might be useful
        // These are cherry-picked from the extended data for their usefulness
        const keyExtendedFields = [
            'Engine Model', 'Trim', 'Series', 'Seat Belt Type', 
            'Traction Control Type', 'ABS Type', 'Steering Type', 
            'Engine Configuration', 'Displacement (CC)', 'Transmission Speeds'
        ];
        
        // Add extended fields if available
        if (extendedData && extendedData.length > 0) {
            const extendedFields = keyExtendedFields.map(field => {
                const item = extendedData.find(item => item.Variable === field);
                return item ? { name: field, value: item.Value || 'Not specified', inline: true } : null;
            }).filter(Boolean);
            
            // Only add if we found some extended data
            if (extendedFields.length > 0) {
                embed.addFields({ name: 'Additional Information', value: '\u200B' });
                embed.addFields(...extendedFields);
            }
        }
        
        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error decoding VIN:', error);
        throw error;
    }
}

/**
 * Handle the get vehicle makes command
 * @param {object} interaction - Discord interaction
 * @param {boolean} returnRaw - Whether to return raw JSON data
 */
async function handleGetMakes(interaction, returnRaw) {
    const year = interaction.options.getInteger('year');
    const page = interaction.options.getInteger('page') || 1;
    
    try {
        // Build the URL based on whether a year was provided
        let url = 'https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json';
        if (year) {
            // Validate year input
            if (year < 1900 || year > new Date().getFullYear() + 1) {
                return interaction.editReply(`Invalid year. Please provide a year between 1900 and ${new Date().getFullYear() + 1}.`);
            }
            url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetMakeForManufacturer/${year}?format=json`;
        }
        
        const response = await axios.get(url, { timeout: 10000 });
        
        // Check if we got valid response data
        if (!response.data || !response.data.Results) {
            return interaction.editReply('No make data available from NHTSA API.');
        }
        
        const makes = response.data.Results;
        
        // If raw data requested, return the full JSON data
        if (returnRaw) {
            // Create a temp directory for the file
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Create unique filename with random ID
            const randomId = crypto.randomBytes(4).toString('hex');
            const filePath = path.join(tempDir, `vehicle_makes_${year || 'all'}_${randomId}.json`);
            
            // Write the data to a JSON file
            fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
            
            // Create an attachment for the JSON file
            const attachment = new AttachmentBuilder(filePath, { 
                name: `vehicle_makes_${year || 'all'}.json` 
            });
            
            // Send the response with the attachment
            await interaction.editReply({
                content: `Raw vehicle make data${year ? ` for year ${year}` : ''}`,
                files: [attachment]
            });
            
            // Clean up the temporary file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error('Error cleaning up temporary file:', error);
                }
            }, 5000);
            
            return;
        }
        
        // Format and process the data for display
        // Sort makes alphabetically
        makes.sort((a, b) => {
            const nameA = a.Make_Name || a.MakeName || '';
            const nameB = b.Make_Name || b.MakeName || '';
            return nameA.localeCompare(nameB);
        });
        
        // Implement pagination - NHTSA API doesn't support it, so we need to do it client-side
        const pageSize = 20; // Limit to 20 makes per page to avoid hitting Discord message limits
        const totalPages = Math.ceil(makes.length / pageSize);
        
        // Validate page number
        if (page > totalPages) {
            return interaction.editReply(`Invalid page number. There are only ${totalPages} pages of results.`);
        }
        
        // Get the makes for the current page
        const startIndex = (page - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, makes.length);
        const currentPageMakes = makes.slice(startIndex, endIndex);
        
        // Create a formatted list
        let makesList = '';
        currentPageMakes.forEach((make, index) => {
            const makeName = make.Make_Name || make.MakeName || 'Unknown';
            makesList += `${startIndex + index + 1}. ${makeName}\n`;
        });
        
        // Create an embed for the main response
        const embed = new EmbedBuilder()
            .setTitle(`Vehicle Makes${year ? ` for ${year}` : ''}`)
            .setDescription(`Found ${makes.length} vehicle makes${year ? ` for the year ${year}` : ''}`)
            .setColor(0x0099FF)
            .addFields(
                { name: `Makes (Page ${page} of ${totalPages})`, value: makesList || 'No makes found' },
                { name: 'Navigation', value: `Use \`/bob-vpic makes page:${page + 1}\` to see the next page` }
            )
            .setTimestamp()
            .setFooter({ text: `Page ${page} of ${totalPages} • Data from NHTSA vPIC API` });
            
        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error getting vehicle makes:', error);
        throw error;
    }
}

/**
 * Handle the get vehicle models command
 * @param {object} interaction - Discord interaction
 * @param {boolean} returnRaw - Whether to return raw JSON data
 */
async function handleGetModels(interaction, returnRaw) {
    const make = interaction.options.getString('make');
    const year = interaction.options.getInteger('year');
    
    try {
        // Build the URL
        let url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`;
        
        // If year is provided, use the GetModelsForMakeYear endpoint
        if (year) {
            // Validate year input
            if (year < 1900 || year > new Date().getFullYear() + 1) {
                return interaction.editReply(`Invalid year. Please provide a year between 1900 and ${new Date().getFullYear() + 1}.`);
            }
            url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
        }
        
        const response = await axios.get(url, { timeout: 10000 });
        
        // Check if we got valid response data
        if (!response.data || !response.data.Results) {
            return interaction.editReply(`No models found for make: ${make}${year ? ` and year: ${year}` : ''}. Please check the spelling or try a different make.`);
        }
        
        const models = response.data.Results;
        
        // If no models found
        if (models.length === 0) {
            return interaction.editReply(`No models found for make: ${make}${year ? ` and year: ${year}` : ''}. Please check the spelling or try a different make.`);
        }
        
        // If raw data requested, return the full JSON data
        if (returnRaw) {
            // Create a temp directory for the file
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Create unique filename with random ID
            const randomId = crypto.randomBytes(4).toString('hex');
            const filePath = path.join(tempDir, `vehicle_models_${make.replace(/\s+/g, '_')}_${year || 'all'}_${randomId}.json`);
            
            // Write the data to a JSON file
            fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2));
            
            // Create an attachment for the JSON file
            const attachment = new AttachmentBuilder(filePath, { 
                name: `vehicle_models_${make.replace(/\s+/g, '_')}_${year || 'all'}.json` 
            });
            
            // Send the response with the attachment
            await interaction.editReply({
                content: `Raw vehicle model data for ${make}${year ? ` (${year})` : ''}`,
                files: [attachment]
            });
            
            // Clean up the temporary file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error('Error cleaning up temporary file:', error);
                }
            }, 5000);
            
            return;
        }
        
        // Sort models alphabetically
        models.sort((a, b) => {
            const nameA = a.Model_Name || '';
            const nameB = b.Model_Name || '';
            return nameA.localeCompare(nameB);
        });
        
        // Create an embed for the main response
        const embed = new EmbedBuilder()
            .setTitle(`${make} Models${year ? ` for ${year}` : ''}`)
            .setDescription(`Found ${models.length} models for ${make}${year ? ` in the year ${year}` : ''}`)
            .setColor(0x0099FF)
            .setTimestamp()
            .setFooter({ text: 'Data from NHTSA vPIC API' });
            
        // Add fields with model names grouped by chunks to fit in embed
        const chunkSize = 20; // Maximum number of models per field
        for (let i = 0; i < models.length; i += chunkSize) {
            const chunk = models.slice(i, i + chunkSize);
            const modelList = chunk.map(model => model.Model_Name).join('\n');
            
            const fieldName = i === 0 ? 'Models' : `Models (continued)`;
            embed.addFields({ name: fieldName, value: modelList || 'No model names available' });
        }
        
        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error getting vehicle models:', error);
        throw error;
    }
}

/**
 * Validate a VIN
 * @param {string} vin - VIN to validate
 * @returns {boolean} Whether the VIN is valid
 */
function isValidVin(vin) {
    // Basic VIN validation - VINs are 17 characters and don't include I, O, or Q
    // This doesn't check the checksum, just the format
    if (!vin || typeof vin !== 'string') return false;
    
    // Remove spaces and convert to uppercase
    const cleanVin = vin.replace(/\s+/g, '').toUpperCase();
    
    // Check length
    if (cleanVin.length !== 17) return false;
    
    // Check for invalid characters
    if (/[IOQ]/.test(cleanVin)) return false;
    
    // Check for valid characters
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin);
}

/**
 * Generate an appropriate error message from an error
 * @param {object} error - Error object
 * @returns {string} Error message
 */
function generateErrorMessage(error) {
    if (error.response) {
        // Request was made and server responded with non 2xx status
        const status = error.response.status;
        
        if (status === 404) {
            return 'The requested resource could not be found. Please check your input and try again.';
        } else if (status === 429) {
            return 'Too many requests. Please try again later.';
        } else {
            return `API error: ${status} - ${error.response.statusText || 'Unknown error'}`;
        }
    } else if (error.request) {
        // Request was made but no response was received
        return 'No response from the vehicle information service. Please try again later.';
    } else {
        // Something else happened while setting up the request
        return `Error: ${error.message}`;
    }
}
