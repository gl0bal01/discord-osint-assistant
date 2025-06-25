/**
 * File: pappers.js
 * Description: Command to get European company information via Pappers API
 * Author: gl0bal01
 * 
 * This command interfaces with the Pappers API to retrieve comprehensive information
 * about European companies, including company details, officers, and financial data.
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Definitions of available fields for company endpoint
const AVAILABLE_FIELD_GROUPS = {
    'officers': 'Company officers and directors',
    'ubos': 'Ultimate Beneficial Owners',
    'financials': 'Financial statements and data',
    'documents': 'Company documents',
    'certificates': 'Company certificates',
    'publications': 'Official publications and notices',
    'establishments': 'Company establishments and branches',
    'contacts': 'Contact information'
};

// Country codes and names for better UX
const COUNTRY_CODES = [
    { name: 'United Kingdom', value: 'UK' },
    { name: 'France', value: 'FR' },
    { name: 'Belgium', value: 'BE' },
    { name: 'Switzerland', value: 'CH' },
    { name: 'Germany', value: 'DE' },
    { name: 'Spain', value: 'ES' },
    { name: 'Italy', value: 'IT' },
    { name: 'Luxembourg', value: 'LU' },
    { name: 'Netherlands', value: 'NL' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-pappers')
        .setDescription('Get European company information via Pappers API')
        .addSubcommand(subcommand =>
            subcommand
                .setName('company')
                .setDescription('Get detailed information about a company')
                .addStringOption(option =>
                    option.setName('country_code')
                        .setDescription('The country code of the company')
                        .setRequired(true)
                        .addChoices(...COUNTRY_CODES))
                .addStringOption(option =>
                    option.setName('company_number')
                        .setDescription('The company registration number')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('fields')
                        .setDescription('Additional fields to include (comma separated)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('Search for companies by name')
                .addStringOption(option =>
                    option.setName('country_code')
                        .setDescription('The country code to search in')
                        .setRequired(true)
                        .addChoices(...COUNTRY_CODES))
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('The company name to search for')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('Page number of results')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('per_page')
                        .setDescription('Results per page (max 100)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(100)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('officer')
                .setDescription('Search for a company officer/director by name')
                .addStringOption(option =>
                    option.setName('country_code')
                        .setDescription('The country code to search in')
                        .setRequired(true)
                        .addChoices(...COUNTRY_CODES))
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The officer/director name to search for')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('Page number of results')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('per_page')
                        .setDescription('Results per page (max 100)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(100))),
        /*
        addSubcommand(subcommand =>
            subcommand
                .setName('balance')
                .setDescription('Check your Pappers API account balance')),
        */
    async execute(interaction) {
        await interaction.deferReply();

        // Get API token from environment variables
        const token = process.env.PAPPERS_API_KEY;
        if (!token) {
            return interaction.editReply('Error: PAPPERS_API_KEY not found in environment variables. Please contact the administrator.');
        }

        // Create a unique identifier for this request using timestamp and user ID
        const requestId = crypto.randomBytes(6).toString('hex');
        
        // Send initial response with progress info
        await interaction.editReply(`Processing request ID ${requestId}...`);
        
        // Set up progress interval (updates every 2 seconds)
        let elapsedTime = 0;
        const progressInterval = setInterval(async () => {
            elapsedTime += 2;
            try {
                // Only update every few seconds to reduce API calls
                if (elapsedTime % 4 === 0) {
                    await interaction.editReply(`Processing request ID ${requestId}... (${elapsedTime}s elapsed)`);
                }
            } catch (e) {
                // If we can't update anymore, clear the interval
                clearInterval(progressInterval);
            }
        }, 2000);

        try {
            const subcommand = interaction.options.getSubcommand();
            
            // Create temp directory for output files if it doesn't exist
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Handle different subcommands
            let apiResponse = null;
            let filename = '';
            
            // Company details request
            if (subcommand === 'company') {
                const countryCode = interaction.options.getString('country_code');
                const companyNumber = interaction.options.getString('company_number');
                
                // Validate company number (basic validation)
                if (!companyNumber.trim()) {
                    clearInterval(progressInterval);
                    return interaction.editReply('Please provide a valid company registration number.');
                }
                
                // Process fields option
                let fieldsValue = '';
                const fieldsOption = interaction.options.getString('fields');
                
                if (fieldsOption) {
                    if (fieldsOption === 'all') {
                        fieldsValue = Object.keys(AVAILABLE_FIELD_GROUPS).join(',');
                    } else {
                        // Validate field names
                        const requestedFields = fieldsOption.split(',').map(f => f.trim());
                        const validFields = requestedFields.filter(field => 
                            Object.keys(AVAILABLE_FIELD_GROUPS).includes(field)
                        );
                        
                        fieldsValue = validFields.join(',');
                    }
                }

                try {
                    // Make API request
                    const response = await axios.get('https://api.pappers.in/v1/company', {
                        params: {
                            api_token: token,
                            country_code: countryCode,
                            company_number: companyNumber,
                            fields: fieldsValue
                        },
                        timeout: 30000 // 30-second timeout
                    });
                    
                    apiResponse = response.data;
                    filename = `company_${countryCode}_${companyNumber}_${requestId}.json`;
                } catch (apiError) {
                    handleApiError(apiError, interaction, progressInterval);
                    return;
                }
            } 
            // Company search request
            else if (subcommand === 'search') {
                const countryCode = interaction.options.getString('country_code');
                const query = interaction.options.getString('query');
                const page = interaction.options.getInteger('page') || 1;
                const perPage = interaction.options.getInteger('per_page') || 10;

                if (!query.trim() || query.trim().length < 2) {
                    clearInterval(progressInterval);
                    return interaction.editReply('Please provide a search query with at least 2 characters.');
                }

                try {
                    const response = await axios.get('https://api.pappers.in/v1/search', {
                        params: {
                            api_token: token,
                            country_code: countryCode,
                            q: query,
                            page: page,
                            per_page: perPage
                        },
                        timeout: 30000 // 30-second timeout
                    });
                    
                    apiResponse = response.data;
                    filename = `search_${countryCode}_${query.replace(/[^a-z0-9]/gi, '_').substring(0, 20)}_${requestId}.json`;
                } catch (apiError) {
                    handleApiError(apiError, interaction, progressInterval);
                    return;
                }
            }
            // Officer search request
            else if (subcommand === 'officer') {
                const countryCode = interaction.options.getString('country_code');
                const name = interaction.options.getString('name');
                const page = interaction.options.getInteger('page') || 1;
                const perPage = interaction.options.getInteger('per_page') || 10;

                if (!name.trim() || name.trim().length < 2) {
                    clearInterval(progressInterval);
                    return interaction.editReply('Please provide a name with at least 2 characters.');
                }

                try {
                    const response = await axios.get('https://api.pappers.in/v1/officer', {
                        params: {
                            api_token: token,
                            country_code: countryCode,
                            name: name,
                            page: page,
                            per_page: perPage
                        },
                        timeout: 30000 // 30-second timeout
                    });
                    
                    apiResponse = response.data;
                    filename = `officer_${countryCode}_${name.replace(/[^a-z0-9]/gi, '_').substring(0, 20)}_${requestId}.json`;
                } catch (apiError) {
                    handleApiError(apiError, interaction, progressInterval);
                    return;
                }
            }
            // Account balance request
            /*else if (subcommand === 'balance') {
                try {
                    const response = await axios.get('https://api.pappers.in/v1/account', {
                        params: {
                            api_token: token,
                        },
                        timeout: 10000 // 10-second timeout
                    });
                    
                    apiResponse = response.data;
                    filename = `account_balance_${requestId}.json`;
                } catch (apiError) {
                    handleApiError(apiError, interaction, progressInterval);
                    return;
                }
            }*/
            
            // Stop the progress updates
            clearInterval(progressInterval);
            
            if (!apiResponse) {
                return interaction.editReply('No data received from the API.');
            }
            
            // Save the raw API response to a file
            const filePath = path.join(tempDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(apiResponse, null, 2));
            
            // Create an attachment with the file
            const attachment = new AttachmentBuilder(filePath, { name: filename });
            
            // Create a response message based on the subcommand and result
            let responseMessage = '';
            
            if (subcommand === 'company') {
                const company = apiResponse;
                const companyName = company.name || company.company_name || 'Unknown Company';
                responseMessage = `Company information for "${companyName}" in ${getCountryName(interaction.options.getString('country_code'))}`;
            } else if (subcommand === 'search') {
                const results = apiResponse.companies || apiResponse.results || [];
                responseMessage = `Found ${results.length} companies matching "${interaction.options.getString('query')}" in ${getCountryName(interaction.options.getString('country_code'))}`;
            } else if (subcommand === 'officer') {
                const results = apiResponse.officers || apiResponse.results || [];
                responseMessage = `Found ${results.length} officers/directors matching "${interaction.options.getString('name')}" in ${getCountryName(interaction.options.getString('country_code'))}`;
            } else if (subcommand === 'balance') {
                const credits = apiResponse.credits || apiResponse.remaining_credits || 'Unknown';
                responseMessage = `Account balance information: ${credits} credits remaining`;
            }
            
            // Send the file as an attachment
            await interaction.editReply({
                content: `${responseMessage}\nRequest ID: ${requestId}`,
                files: [attachment]
            });
            
            // Clean up the temporary file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error('Error deleting temporary file:', error);
                }
            }, 5000);
            
        } catch (error) {
            // Stop the progress updates
            clearInterval(progressInterval);
            
            console.error('Unexpected error in pappers command:', error);
            
            let errorMessage = 'An unexpected error occurred while processing your request.';
            if (error.message) {
                errorMessage += ` Error details: ${error.message}`;
            }
            
            await interaction.editReply(errorMessage);
        }
    },
};

/**
 * Handle API errors and provide appropriate response
 * @param {Error} error - The error object
 * @param {Object} interaction - Discord interaction object
 * @param {Object} interval - Progress update interval to clear
 */
function handleApiError(error, interaction, interval) {
    clearInterval(interval);
    
    console.error('Error with Pappers API:', error);
    
    let errorMessage = 'An error occurred while fetching company information.';
    
    if (error.response) {
        const statusCode = error.response.status;
        const responseData = error.response.data;
        
        if (statusCode === 404) {
            errorMessage = 'No results found. Please check your search criteria.';
        } else if (statusCode === 401) {
            errorMessage = 'API authentication failed. Please check the API token.';
        } else if (statusCode === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (statusCode === 402) {
            errorMessage = 'Insufficient credits. Please recharge your Pappers API account.';
        } else {
            errorMessage = `API error: ${statusCode} - ${responseData?.error || 'Unknown error'}`;
        }
    } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'The request timed out. The API may be experiencing issues.';
    } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'Could not reach the Pappers API server. Please check your network connection.';
    } else {
        errorMessage = `Error: ${error.message}`;
    }
    
    interaction.editReply(errorMessage);
}

/**
 * Get country name from country code
 * @param {string} code - Country code
 * @returns {string} Country name
 */
function getCountryName(code) {
    const country = COUNTRY_CODES.find(c => c.value === code);
    return country ? country.name : code;
}
