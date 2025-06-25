# Installation Guide - Discord OSINT Assistant v2.0

This comprehensive guide provides step-by-step instructions for setting up the Discord OSINT Assistant bot with all commands and advanced features.

## 📋 Prerequisites

### System Requirements
- **Node.js**: Version 16.9.0 or higher
- **npm**: Version 7.0.0 or higher (included with Node.js)
- **Operating System**: Windows 10/11, macOS 10.14+, or Linux (Ubuntu 18.04+)
- **RAM**: Minimum 2GB, recommended 4GB+ for optimal performance
- **Storage**: 2GB free space for installation, dependencies, and temporary files
- **Network**: Stable internet connection for API calls and external tool integration

### Required Accounts & API Keys

#### Essential Services
1. **Discord Developer Account** - [discord.com/developers](https://discord.com/developers/applications)
2. **DNSDumpster API** - [dnsdumpster.com/api](https://dnsdumpster.com/api/) (DNS analysis)
3. **Whoxy API** - [whoxy.com](https://www.whoxy.com/) (WHOIS data)

#### Recommended Services
4. **Host.io API** - [host.io](https://host.io/) (Domain intelligence)
5. **AviationStack API** - [aviationstack.com](https://aviationstack.com/) (Flight data)
6. **AirportDB API** - [airportdb.io](https://airportdb.io/) (Airport information)
7. **AWS Account** - [aws.amazon.com](https://aws.amazon.com/) (Rekognition for facial analysis)

#### Optional Services
8. **Pappers API** - [pappers.fr](https://www.pappers.fr/) (French business data)
9. **AI Service** - OpenAI, Anthropic, or Google (AI-powered analysis)
10. **Various blockchain API services** (Enhanced crypto analysis)

## 🤖 Discord Bot Setup

### Step 1: Create Discord Application

1. **Navigate to Discord Developer Portal**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application"
   - Enter name: "OSINT Assistant" or preferred name
   - Click "Create"

2. **Configure Application Settings**
   - Add description: "Professional OSINT intelligence gathering bot"
   - Upload bot icon (optional)
   - Save changes

### Step 2: Create and Configure Bot

1. **Create Bot User**
   - Go to "Bot" section in left sidebar
   - Click "Add Bot"
   - Confirm by clicking "Yes, do it!"

2. **Configure Bot Settings**
   - **Username**: Set to "OSINT-Assistant" or preferred name
   - **Avatar**: Upload professional icon (optional)
   - **Public Bot**: Disable (recommended for security)
   - **Require OAuth2 Code Grant**: Disable

3. **Bot Token Security**
   - Click "Reset Token" to generate new token
   - **IMPORTANT**: Copy and securely store the bot token
   - Never share or commit the token to version control

4. **Privileged Gateway Intents**
   Enable the following intents:
   - ✅ **Server Members Intent** (for user information)
   - ✅ **Message Content Intent** (for message processing)
   - ❌ **Presence Intent** (not required)

### Step 3: Bot Permissions

Navigate to "OAuth2" > "URL Generator":

**Scopes:**
- ✅ `bot`
- ✅ `applications.commands`

**Bot Permissions:**
- ✅ **Send Messages** - Core functionality
- ✅ **Use Slash Commands** - Command execution
- ✅ **Attach Files** - Report generation
- ✅ **Embed Links** - Rich responses
- ✅ **Read Message History** - Context understanding
- ✅ **Use External Emojis** - Enhanced responses
- ✅ **Add Reactions** - Interactive responses
- ✅ **Manage Messages** - Cleanup capabilities

## 🛠️ External Tool Installation

### ExifTool (Required for image analysis)

**Windows:**
1. Download from [exiftool.org](https://exiftool.org/install.html#Windows)
2. Extract `exiftool(-k).exe` to `C:\Windows\` or preferred location
3. Rename to `exiftool.exe`
4. Verify installation: `exiftool -ver`

**macOS:**
```bash
# Using Homebrew (recommended)
brew install exiftool

# Verify installation
exiftool -ver
```

**Linux (Ubuntu/Debian):**
```bash
# Update package list
sudo apt update

# Install ExifTool
sudo apt install exiftool

# Verify installation
exiftool -ver
```

### Sherlock (Required for username investigation)

**All Platforms (Python required):**
```bash
# Install via pip
pip install sherlock-project

# Verify installation
sherlock --version
```

**Alternative Git Installation:**
```bash
# Clone repository
git clone https://github.com/sherlock-project/sherlock.git
cd sherlock

# Install dependencies
pip install -r requirements.txt

# Test installation
python sherlock.py --help
```

### Maigret (Enhanced username searches)

```bash
# Install via pip
pip install maigret

# Verify installation
maigret --version
```

### Nuclei (Optional - vulnerability scanning)

**Windows:**
1. Download from [GitHub Releases](https://github.com/projectdiscovery/nuclei/releases)
2. Extract `nuclei.exe` to desired location
3. Add to PATH environment variable

**macOS:**
```bash
# Using Homebrew
brew install nuclei

# Verify installation
nuclei -version
```

**Linux:**
```bash
# Download and install
wget https://github.com/projectdiscovery/nuclei/releases/download/v2.9.15/nuclei_2.9.15_linux_amd64.zip
unzip nuclei_2.9.15_linux_amd64.zip
sudo mv nuclei /usr/local/bin/

# Verify installation
nuclei -version
```

## 📦 Bot Installation

### Step 1: Download Source Code

```bash
# Clone the repository
git clone https://github.com/gl0bal01/discord-osint-assistant.git

# Navigate to project directory
cd discord-osint-assistant

# Verify file structure
ls -la
```

### Step 2: Install Dependencies

```bash
# Install all required packages
npm install

# Verify installation
npm list --depth=0
```

**Expected Dependencies:**
- discord.js v14.17.3+
- axios for HTTP requests
- @aws-sdk/client-rekognition for image analysis
- cheerio for web scraping
- jsdom for HTML parsing
- And many more...

### Step 3: Environment Configuration

```bash
# Create environment file
cp .env.example .env

# Edit configuration
nano .env  # or use your preferred editor
```

### Complete Environment Configuration

```env
# =====================================
# DISCORD CONFIGURATION (Required)
# =====================================
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_test_server_id_here
MONITOR_CHANNEL_ID=your_discord_channel_id

# =====================================
# CORE OSINT API KEYS (Recommended)
# =====================================
# DNS Analysis
DNSDUMPSTER_TOKEN=your_dnsdumpster_api_token
WHOXY_API_KEY=your_whoxy_api_key

# Domain Intelligence
HOSTIO_API_KEY=your_hostio_api_key

# Aviation Intelligence
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
AIRPORTDB_API_KEY=your_airportdb_api_key

# =====================================
# ADVANCED FEATURES (Optional)
# =====================================
# AWS Services (Rekognition)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# Business Intelligence
PAPPERS_API_KEY=your_pappers_api_key

# 1MIN AI-Powered Analysis
AI_API_KEY=your_ai_api_key

# Product Authentication
NIKE_TOKEN=your_nike_api_token

# =====================================
# BLOCKCHAIN APIs (Optional)
# =====================================
ETHERSCAN_API_KEY=your_etherscan_api_key
BSCSCAN_API_KEY=your_bscscan_api_key
POLYGONSCAN_API_KEY=your_polygonscan_api_key

# =====================================
# EXTERNAL TOOL PATHS (Optional)
# =====================================
# Only set if tools are not in system PATH
EXIFTOOL_PATH=exiftool
SHERLOCK_PATH=sherlock
NUCLEI_PATH=nuclei
NUCLEI_TEMPLATE_PATH=/username/nuclei-templates/http/osint/user-enumeration
MAIGRET_PATH=maigret

# =====================================
# ADVANCED CONFIGURATION
# =====================================
# Performance Settings
NODE_ENV=production
MAX_FILE_SIZE=25MB
DEFAULT_TIMEOUT=180
REQUEST_TIMEOUT=30000

# Logging
LOG_LEVEL=info
LOG_FILE=osint-assistant.log

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=3600000
```

## 🔑 API Key Configuration

### Getting Required API Keys

#### DNSDumpster API
1. Register at [dnsdumpster.com](https://dnsdumpster.com/register/)
2. Navigate to API section
3. Generate API token
4. Add to `.env` as `DNSDUMPSTER_TOKEN`

#### Whoxy API
1. Sign up at [whoxy.com](https://www.whoxy.com/register/)
2. Purchase API credits (starting from $10)
3. Get API key from dashboard
4. Add to `.env` as `WHOXY_API_KEY`

#### Host.io API
1. Register at [host.io](https://host.io/signup)
2. Navigate to API section
3. Generate API key
4. Add to `.env` as `HOSTIO_API_KEY`

#### AviationStack API
1. Sign up at [aviationstack.com](https://aviationstack.com/signup)
2. Get free or paid API key
3. Add to `.env` as `AVIATIONSTACK_API_KEY`

#### AWS Rekognition Setup
1. Create AWS account at [aws.amazon.com](https://aws.amazon.com/)
2. Navigate to IAM console
3. Create new user with programmatic access
4. Attach policy: `AmazonRekognitionFullAccess`
5. Save access key and secret key
6. Add to `.env`:
   ```env
   AWS_ACCESS_KEY_ID=your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key
   AWS_REGION=us-east-1
   ```

## 🚀 Deployment

### Step 1: Deploy Slash Commands

```bash
# Deploy to your test server (recommended)
npm run deploy

# Or deploy globally (takes up to 1 hour)
npm run deploy:global
```

**Command Deployment Verification:**
- Check Discord server for slash commands
- Type `/bob-` to see available commands
- Verify all commands are present

### Step 2: Start the Bot

```bash
# Production mode
npm start

# Development mode (auto-restart on changes)
npm run dev
```

**Startup Verification:**
- Bot shows online status in Discord
- Console shows successful login message
- No error messages in startup logs

### Step 3: Invite Bot to Server

1. **Generate Invite URL**
   - Go to Discord Developer Portal > OAuth2 > URL Generator
   - Select scopes and permissions (as configured above)
   - Copy generated URL

2. **Invite to Server**
   - Open invite URL in browser
   - Select target server
   - Authorize permissions
   - Verify bot appears in member list

## ✅ Installation Verification

### Basic Functionality Test

```bash
# Test basic command
/bob-health detailed:true

# Test DNS analysis
/bob-dns domain:google.com

# Test username generation
/bob-generate-usernames firstname:John lastname:Doe

# Test AI assistant (if configured)
/bob-chat ask message:"Hello, test message"
```

### Advanced Feature Testing

```bash
# Test image analysis (requires ExifTool)
/bob-exif image_url:https://example.com/image.jpg

# Test username investigation (requires Sherlock)
/bob-sherlock username:github

# Test blockchain analysis
/bob-blockchain-detect text:"Check this: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"

# Test aviation intelligence (requires API key)
/bob-aviation airline:BA

# Test vulnerability scanning (requires Nuclei)
/bob-nuclei target:example.com
```

### Health Check Verification

```bash
# Comprehensive system check
/bob-health detailed:true check-apis:true check-tools:true
```

**Expected Results:**
- ✅ Bot Status: Online
- ✅ Discord API: Connected
- ✅ System Resources: Normal
- ✅ External Tools: Available
- ✅ API Connectivity: Active services show connected

## 🔧 Troubleshooting

### Common Installation Issues

**Bot doesn't respond to commands:**
```bash
# Check bot permissions
# Verify slash commands deployed
npm run deploy

# Check bot token
# Ensure DISCORD_TOKEN is correct in .env
```

**ExifTool not found:**
```bash
# Windows: Add to PATH or set full path in .env
EXIFTOOL_PATH=C:\exiftool\exiftool.exe

# Linux/macOS: Install via package manager
sudo apt install exiftool  # Ubuntu
brew install exiftool      # macOS
```

**Sherlock command fails:**
```bash
# Install Sherlock
pip install sherlock-project

# Or set custom path
SHERLOCK_PATH=/usr/local/bin/sherlock
```

**API errors:**
- Verify API keys are correct and active
- Check API rate limits and quotas
- Ensure network connectivity to services

**Permission errors:**
- Bot needs correct Discord permissions
- Check role hierarchy in server
- Verify OAuth2 scopes during invitation

### Log Analysis

**Enable detailed logging:**
```env
LOG_LEVEL=debug
LOG_FILE=osint-assistant.log
```

**Check logs for errors:**
```bash
# View recent logs
tail -f osint-assistant.log

# Search for specific errors
grep -i "error" osint-assistant.log

# Check API connectivity issues
grep -i "api" osint-assistant.log
```

**Common Error Patterns:**
- `401 Unauthorized` - Invalid API key
- `429 Too Many Requests` - Rate limit exceeded
- `ENOTFOUND` - Network connectivity issues
- `ECONNABORTED` - Request timeout

### Performance Optimization

**For High-Volume Usage:**

1. **System Resources:**
   ```bash
   # Increase memory allocation
   NODE_OPTIONS="--max-old-space-size=4096" npm start
   
   # Monitor resource usage
   top -p $(pgrep -f "node index.js")
   ```

2. **Database Optimization:**
   ```env
   # Increase timeout values
   DEFAULT_TIMEOUT=300
   REQUEST_TIMEOUT=60000
   
   # Optimize batch processing
   MAX_CONCURRENT_REQUESTS=5
   ```

3. **Caching Configuration:**
   ```env
   # Enable response caching
   ENABLE_CACHE=true
   CACHE_TTL=3600
   
   # Clean temp files regularly
   AUTO_CLEANUP=true
   CLEANUP_INTERVAL=86400
   ```

## 🔒 Security Configuration

### Environment Security

**File Permissions:**
```bash
# Secure .env file
chmod 600 .env

# Secure log files
chmod 644 *.log

# Verify permissions
ls -la .env
```

**API Key Security:**
- Never commit `.env` to version control
- Use separate keys for development/production
- Rotate keys regularly
- Monitor API usage for anomalies

### Bot Security

**Discord Permissions:**
- Use principle of least privilege
- Limit bot to specific channels if needed
- Regular permission audits
- Monitor bot activity logs

**Network Security:**
```env
# Restrict network access if needed
ALLOWED_IPS=192.168.1.0/24,10.0.0.0/8

# Enable rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=3600000
```

## 📊 Monitoring & Maintenance

### Health Monitoring

**Regular Health Checks:**
```bash
# Daily health verification
/bob-health detailed:true check-apis:true check-tools:true

# Monitor system resources
/bob-health system-info:true

# Check API quotas
/bob-health api-status:true
```

**Automated Monitoring:**
```bash
# Create monitoring script
cat > monitor.sh << 'EOF'
#!/bin/bash
LOG_FILE="health-check.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Check if bot process is running
if pgrep -f "node index.js" > /dev/null; then
    echo "$DATE - Bot is running" >> $LOG_FILE
else
    echo "$DATE - Bot is down, restarting..." >> $LOG_FILE
    npm start &
fi

# Check memory usage
MEMORY=$(ps -o pid,vsz,rss,pcpu,comm -p $(pgrep -f "node index.js"))
echo "$DATE - Memory usage: $MEMORY" >> $LOG_FILE
EOF

chmod +x monitor.sh

# Add to crontab for regular checks
crontab -e
# Add: */5 * * * * /path/to/discord-osint-assistant/monitor.sh
```

### Maintenance Tasks

**Regular Cleanup:**
```bash
# Clean temporary files
npm run clean

# Clear old logs (keep last 30 days)
find . -name "*.log" -mtime +30 -delete

# Update dependencies
npm update

# Security audit
npm audit
```

**Backup Configuration:**
```bash
# Backup critical files
tar -czf backup-$(date +%Y%m%d).tar.gz \
    .env package.json commands/ utils/ docs/

# Store backup securely
cp backup-*.tar.gz /secure/backup/location/
```

## 🚀 Production Deployment

### Process Management

**Using PM2 (Recommended):**
```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'osint-assistant',
    script: 'index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Enable startup script
pm2 startup
pm2 save
```

**Using systemd (Linux):**
```bash
# Create service file
sudo tee /etc/systemd/system/osint-assistant.service << 'EOF'
[Unit]
Description=Discord OSINT Assistant
After=network.target

[Service]
Type=simple
User=osint
WorkingDirectory=/home/osint/discord-osint-assistant
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl enable osint-assistant
sudo systemctl start osint-assistant
sudo systemctl status osint-assistant
```

### Load Balancing & Scaling

**For Multiple Servers:**
```bash
# Use Docker for containerization
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

USER node
EXPOSE 3000

CMD ["npm", "start"]
EOF

# Build and run
docker build -t osint-assistant .
docker run -d --name osint-bot osint-assistant
```

## 📚 Advanced Configuration

### Custom Command Development

**Adding New Commands:**
```javascript
// Template for new command
/**
 * File: new-command.js
 * Description: Brief description of functionality
 * Author: gl0bal01
 */

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-newcommand')
        .setDescription('Description of new command')
        .addStringOption(option =>
            option.setName('parameter')
                .setDescription('Parameter description')
                .setRequired(true)),
    
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            // Command implementation
            const result = await performOperation();
            
            const embed = new EmbedBuilder()
                .setTitle('Command Result')
                .setDescription(result)
                .setColor(0x00ff00);
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Command error:', error);
            await interaction.editReply('An error occurred.');
        }
    },
};
```

### Database Integration

**Adding Persistent Storage:**
```bash
# Install database dependencies
npm install sqlite3 sequelize

# Configure database connection
# Add to .env:
DATABASE_URL=sqlite:./data/osint.db
```

### API Rate Limiting

**Advanced Rate Limiting:**
```javascript
// Add to index.js
const rateLimit = new Map();

function checkRateLimit(userId, command) {
    const key = `${userId}-${command}`;
    const now = Date.now();
    const limit = rateLimit.get(key);
    
    if (limit && now - limit.timestamp < 60000) {
        if (limit.count >= 10) {
            return false; // Rate limited
        }
        limit.count++;
    } else {
        rateLimit.set(key, { timestamp: now, count: 1 });
    }
    
    return true;
}
```

## 🆘 Support & Resources

### Getting Help

**Documentation Hierarchy:**
1. **Installation Guide** (this document)
2. **Command Reference** - Individual help via `/command --help`
3. **Configuration Guide** - API setup and integration
4. **Troubleshooting** - Common issues and solutions

**Support Channels:**
- **GitHub Issues** - Bug reports and feature requests
- **Discord Community** - User support and discussions
- **Documentation** - Comprehensive guides and examples

### Useful Commands

**System Information:**
```bash
# Node.js version
node --version

# npm version  
npm --version

# Check global packages
npm list -g --depth=0

# System resources
free -h  # Linux
top      # All systems
```

**Bot Information:**
```bash
# Bot statistics
/bob-health detailed:true

# Check specific APIs
/bob-health check-apis:true

# Tool availability
/bob-health check-tools:true

# Performance metrics
/bob-health performance:true
```

## 🎯 Next Steps

### Post-Installation

1. **Test All Commands**
   - Go through each command category
   - Verify API integrations work
   - Test external tool connectivity

2. **Configure Monitoring**
   - Set up health check automation
   - Configure log rotation
   - Establish backup procedures

3. **Security Hardening**
   - Review permissions and access
   - Implement monitoring and alerts
   - Regular security updates

4. **User Training**
   - Create usage guidelines
   - Establish investigation procedures
   - Document best practices

5. **Performance Optimization**
   - Monitor resource usage
   - Optimize for your use case
   - Scale as needed

### Recommended Learning Path

1. **Basic Commands**: Start with DNS, username, and health commands
2. **Image Analysis**: Learn EXIF and Rekognition capabilities  
3. **Advanced Intelligence**: Explore blockchain, aviation, and business commands
4. **AI Integration**: Utilize chat assistant for analysis and automation
5. **Custom Development**: Add organization-specific commands

---

## 📞 Installation Support

**Installation Complete!** Your Discord OSINT Assistant v2.0 is ready for professional intelligence operations.

**Final Verification Checklist:**
- ✅ All commands available in Discord
- ✅ External tools installed and accessible
- ✅ API keys configured and tested
- ✅ Health check shows all systems operational
- ✅ Bot permissions properly configured
- ✅ Security measures implemented

**For additional support:**
- Review the main [README.md](../README.md) for usage examples
- Check individual command documentation
- Use `/bob-health` for system diagnostics
- Consult troubleshooting section for common issues

*Your OSINT intelligence gathering capabilities are now fully operational!*