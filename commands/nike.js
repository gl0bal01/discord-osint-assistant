/**
 * Discord Slash Command: /bob-nike
 * 
 * Description:
 * A Discord bot command that wraps the functionality of Nikelligence 
 * (https://github.com/castrickclues/Nikelligence) to search Nike Run Club users 
 * by email or full name. It handles Nike API token management, performs user lookups, 
 * and generates detailed HTML reports of search results.
 * 
 * Features:
 * - Supports lookups by email or full name using Nike's internal API.
 * - Allows updating and persisting Nike API tokens with optional expiry checks.
 * - Generates rich HTML reports with embedded user data and profile images.
 * - Sends result previews and attached reports back to the Discord channel.
 * 
 * Author: gl0bal01
 */
const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Path to store the token data
const TOKEN_FILE_PATH = path.join(__dirname, '..', 'data', 'nike_token.json');

// Small helper to split a string into pieces at most 2000 chars each.
function chunkString(str, size = 2000) {
  const chunks = [];
  let index = 0;
  while (index < str.length) {
    chunks.push(str.slice(index, index + size));
    index += size;
  }
  return chunks;
}

// Generate an HTML report file from results
function generateHTMLReport(objects, searchString) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nike Lookup Results for: ${searchString}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    .report-header {
      background-color: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .result-card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 25px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .result-header {
      background-color: #f5f5f5;
      margin: -15px -15px 15px -15px;
      padding: 10px 15px;
      border-radius: 8px 8px 0 0;
      border-bottom: 1px solid #ddd;
    }
    .profile-image {
      max-width: 300px;
      border-radius: 5px;
      margin: 10px 0;
    }
    .field {
      margin-bottom: 8px;
    }
    .field-name {
      font-weight: bold;
      color: #555;
      width: 120px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>Nike Lookup Results for: ${searchString}</h1>
    <p>Date: ${new Date().toLocaleString()}</p>
    <p>Total results: ${objects.length}</p>
  </div>`;
  
  objects.forEach((account, i) => {
    const {
      upmId,
      imageUrl,
      displayName,
      firstName,
      lastName,
      hometown,
      visibility,
      email: foundEmail,
    } = account;

    html += `
  <div class="result-card">
    <div class="result-header">
      <h2>Result ${i + 1}</h2>
    </div>`;
    
    if (imageUrl) {
      html += `
    <div class="profile-image-container">
      <img src="${imageUrl}" alt="${displayName || 'Profile'}" class="profile-image">
    </div>`;
    }
    
    html += `
    <div class="user-details">`;
    
    if (foundEmail)  html += `
      <div class="field"><span class="field-name">Email:</span> ${foundEmail}</div>`;
    if (upmId)       html += `
      <div class="field"><span class="field-name">ID:</span> ${upmId}</div>`;
    if (displayName) html += `
      <div class="field"><span class="field-name">Username:</span> ${displayName}</div>`;
    if (firstName)   html += `
      <div class="field"><span class="field-name">First Name:</span> ${firstName}</div>`;
    if (lastName)    html += `
      <div class="field"><span class="field-name">Last Name:</span> ${lastName}</div>`;
    if (hometown)    html += `
      <div class="field"><span class="field-name">Location:</span> ${hometown}</div>`;
    if (visibility)  html += `
      <div class="field"><span class="field-name">Visibility:</span> ${visibility}</div>`;
    
    html += `
    </div>
  </div>`;
  });
  
  html += `
</body>
</html>`;
  
  return html;
}

// Token management functions
function loadTokenData() {
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
      const data = fs.readFileSync(TOKEN_FILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading token data:', err);
  }
  
  // Return default structure if file doesn't exist or has an error
  return { token: process.env.NIKE_TOKEN || '', timestamp: Date.now() };
}

function saveTokenData(tokenData) {
  try {
    // Make sure the directory exists
    const dir = path.dirname(TOKEN_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(tokenData), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving token data:', err);
    return false;
  }
}

function isTokenExpired(tokenData) {
  // No token means it's expired
  if (!tokenData.token) {
    return true;
  }
  
  // Check if token is older than 50 minutes (3000000 ms)
  // Using 50 minutes instead of 60 to have a buffer
  const tokenAge = Date.now() - tokenData.timestamp;
  return tokenAge > 3000000;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bob-nike')
    .setDescription('Look up Nike Run Club user by email or full name')
    .addStringOption((option) =>
      option
        .setName('email')
        .setDescription('Email to look up')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Full name to look up')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('token')
        .setDescription('New Nike API token (updates stored token)')
        .setRequired(false)
    ),
  async execute(interaction) {
    await interaction.deferReply(); // Defer the reply since we might need time for token operations
    
    // Load token data from file
    let tokenData = loadTokenData();
    
    // Check if a new token was provided
    const newToken = interaction.options.getString('token');
    if (newToken) {
      tokenData = { token: newToken, timestamp: Date.now() };
      const saved = saveTokenData(tokenData);
      if (saved) {
        await interaction.editReply({
          content: '✅ New token saved successfully! This token will be used for searches until it expires (typically after 1 hour).',
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: '❌ Failed to save the new token.',
          ephemeral: true,
        });
        return;
      }
    }
    
    // Check if token is expired
    if (isTokenExpired(tokenData)) {
      return interaction.editReply({
        content: '❌ Token has expired (tokens typically expire after 1 hour). Please provide a new token using the `token` option.',
        ephemeral: false,
      });
    }
    
    // If we have a token but aren't sure if it's valid yet, let the user know
    if (tokenData.token && !newToken) {
      await interaction.followUp({
        content: 'ℹ️ Using saved token. If the lookup fails with an authorization error, you\'ll need to provide a new token.',
        ephemeral: true
      });
    }
    
    // Grab search arguments
    const email = interaction.options.getString('email');
    const fullName = interaction.options.getString('name');

    // If only a token was provided but no search criteria, just acknowledge the token update
    if (!email && !fullName && newToken) {
      return; // We already sent a message about the token update
    }

    if (!email && !fullName) {
      return interaction.editReply({
        content: 'Please provide either an email or a name to look up.',
        ephemeral: false,
      });
    }

    // Build the search string from whichever was provided
    const searchString = email || fullName;

    const URL = `https://api.nike.com/usersearch/search/v2?searchstring=${encodeURIComponent(
      searchString
    )}`;

    const HEADERS = {
      'User-Agent': 'NRC/4.36.0 (prod; 1711163123; Android 11.1.0; samsung SM-G781B)',
      Appid: 'com.nike.sport.running.droid',
      Authorization: `Bearer ${tokenData.token}`,
    };

    try {
      const response = await axios.get(URL, { headers: HEADERS });

      if (response.status === 401) {
        // Mark token as expired
        tokenData.timestamp = 0;
        saveTokenData(tokenData);
        
        return interaction.editReply({
          content: '❌ Token expired. Please provide a new token using the `/nike-lookup token:your_new_token` command.',
          ephemeral: false,
        });
      } else if (response.status !== 200) {
        return interaction.editReply({
          content: `Error: ${response.status}\nResponse: ${JSON.stringify(response.data)}`,
          ephemeral: false,
        });
      }

      const objects = response.data.objects;
      if (!objects || !objects.length) {
        return interaction.editReply({
          content: '[!] No results found',
          ephemeral: false,
        });
      }

      try {
        // Generate HTML report file by default
        const reportContent = generateHTMLReport(objects, searchString);
        const reportFilename = `nike_lookup_${Date.now()}.html`;
        const reportPath = path.join(__dirname, '..', 'temp', reportFilename);
        
        // Ensure temp directory exists
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Write report file
        fs.writeFileSync(reportPath, reportContent, 'utf8');
        
        // Send the report file as an attachment
        await interaction.editReply({
          content: `Found ${objects.length} results for "${searchString}".`,
          files: [reportPath],
          ephemeral: false,
        });
        
        // Also send a preview of the results with image embeds directly in Discord
        let previewMessage = `Preview of results for "${searchString}":\n\n`;
        
        // Only show partial preview of the first 3 results to avoid clutter
        const previewLimit = Math.min(3, objects.length);
        for (let i = 0; i < previewLimit; i++) {
          const account = objects[i];
          previewMessage += `**Result ${i + 1}**\n`;
          
          if (account.displayName) previewMessage += `Username: ${account.displayName}\n`;
          if (account.firstName && account.lastName) previewMessage += `Name: ${account.firstName} ${account.lastName}\n`;
          
          // Add the image URL on its own line so Discord will embed it
          if (account.imageUrl) {
            previewMessage += `${account.imageUrl}\n\n`;
          } else {
            previewMessage += '\n';
          }
        }
        
        if (objects.length > previewLimit) {
          previewMessage += `\n*...and ${objects.length - previewLimit} more results available in the HTML report.*`;
        }
        
        // Send the preview as a follow-up message
        await interaction.followUp({
          content: previewMessage,
          ephemeral: false,
        });
        
        // Clean up the file after it's been sent
        setTimeout(() => {
          try {
            fs.unlinkSync(reportPath);
          } catch (err) {
            console.error('Failed to clean up report file:', err);
          }
        }, 10000); // Clean up after 10 seconds
        
      } catch (err) {
        console.error('Error creating report file:', err);
        
        // Build a fallback text response
        let replyMessage = `Found ${objects.length} results for "${searchString}", but couldn't create HTML report: ${err.message}\n\n`;
        
        objects.forEach((account, i) => {
          const {
            upmId,
            imageUrl,
            displayName,
            firstName,
            lastName,
            hometown,
            visibility,
            email: foundEmail,
          } = account;

          replyMessage += `Result ${i + 1}\n`;
          replyMessage += '----------------------------------------\n';
          if (foundEmail)  replyMessage += `Email:         ${foundEmail}\n`;
          if (upmId)       replyMessage += `ID:            ${upmId}\n`;
          if (displayName) replyMessage += `Username:      ${displayName}\n`;
          
          // Add avatar URL and embed the image directly in Discord
          if (imageUrl) {
            replyMessage += `Avatar:        ${imageUrl}\n`;
            // Add the image URL on its own line so Discord will embed it
            replyMessage += `${imageUrl}\n`;
          }
          
          if (firstName)   replyMessage += `First Name:    ${firstName}\n`;
          if (lastName)    replyMessage += `Last Name:     ${lastName}\n`;
          if (hometown)    replyMessage += `Location:      ${hometown}\n`;
          if (visibility)  replyMessage += `Visibility:    ${visibility}\n`;
          replyMessage += '\n';
        });
        
        // Now break down the replyMessage if it's > 2000 chars
        const messageChunks = chunkString(replyMessage);
        
        // Edit our deferred reply with the first chunk and error message
        await interaction.editReply({
          content: messageChunks[0],
          ephemeral: false,
        });
        
        // Send any additional chunks as follow-ups
        for (let i = 1; i < messageChunks.length; i++) {
          await interaction.followUp({
            content: messageChunks[i],
            ephemeral: false,
          });
        }
      }

    } catch (err) {
      console.error(err);
      
      // Check if it's a 401 error (Unauthorized - likely expired token)
      if (err.response && err.response.status === 401) {
        // Mark token as expired
        tokenData.timestamp = 0;
        saveTokenData(tokenData);
        
        return interaction.editReply({
          content: '❌ Token expired. Please provide a new token using the `/nike-lookup token:your_new_token` command.',
          ephemeral: false,
        });
      }
      
      return interaction.editReply({
        content: `[!] Error: ${err.message}`,
        ephemeral: false,
      });
    }
  },
};
