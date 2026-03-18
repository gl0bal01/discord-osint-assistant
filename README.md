# Discord OSINT Assistant v2.0

<div align="center">

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14.17.3-blue.svg)](https://discord.js.org/)
[![Version](https://img.shields.io/badge/Version-2.0.0-orange.svg)](https://github.com/gl0bal01/discord-osint-assistant/releases)
[![DOI](https://zenodo.org/badge/1007802575.svg)](https://doi.org/10.5281/zenodo.15741849)

[![OSINT](https://img.shields.io/badge/Category-OSINT-red.svg)]()
[![Security](https://img.shields.io/badge/Category-Security-darkred.svg)]()
[![Intelligence](https://img.shields.io/badge/Category-Intelligence-purple.svg)]()
[![Discord Bot](https://img.shields.io/badge/Type-Discord%20Bot-5865F2.svg)](https://discord.com/developers/docs)
[![Blockchain Analysis](https://img.shields.io/badge/Feature-Blockchain%20Analysis-gold.svg)]()
[![AI Powered](https://img.shields.io/badge/Feature-AI%20Powered-cyan.svg)]()


[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/gl0bal01/discord-osint-assistant/pulls)
[![GitHub](https://img.shields.io/badge/GitHub-gl0bal01-181717?logo=github&logoColor=white)](https://github.com/gl0bal01)

</div>

A comprehensive Discord bot designed for Open Source Intelligence (OSINT) gathering and analysis. This professional-grade bot provides investigators, researchers, and security professionals with a complete suite of intelligence gathering tools directly from Discord.

## 🌟 Features Overview

### Core OSINT Intelligence Capabilities
- **Domain & Network Analysis**: DNS lookups, WHOIS history, subdomain enumeration, and web technology detection
- **Identity Investigation**: Multi-platform username searches, profile enumeration, and social media reconnaissance  
- **Image Intelligence**: EXIF metadata extraction with GPS coordinate mapping and facial recognition
- **Blockchain Analysis**: Cryptocurrency address investigation, transaction analysis, and address detection
- **Transportation Intelligence**: Aviation tracking, airport data, flight information, and maritime vessel tracking
- **Business Intelligence**: Company information gathering, corporate data analysis, and registry searches

### Advanced Analysis Tools
- **AI-Powered Analysis**: Multi-model AI integration for data interpretation and report generation
- **Document Processing**: JWT token analysis, document metadata extraction, and file analysis
- **Network Reconnaissance**: Vulnerability scanning, port analysis, and security assessment
- **Link Analysis**: URL investigation, redirect chain analysis, and favicon reconnaissance
- **Geospatial Intelligence**: GPS coordinate analysis, location mapping, and geographic correlation

### Specialized OSINT Features
- **Social Engineering Tools**: Username generation, profile discovery, and account enumeration
- **Search Intelligence**: Google dorking assistance, advanced search query generation
- **Monitoring Capabilities**: Target monitoring, real-time alerts, and continuous surveillance
- **Data Extraction**: Link extraction, pattern recognition, and automated data parsing

## 🛠️ Complete Command Reference

### Domain & Network Intelligence
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-dns` | Comprehensive DNS analysis | Records analysis, security detection, nameserver info |
| `/bob-whoxy` | WHOIS history and reverse lookups | Historical data, registrant tracking, change analysis |
| `/bob-hostio` | Domain hosting intelligence | Infrastructure analysis, hosting details, technology stack |
| `/bob-recon-web` | Web reconnaissance | Technology detection, service enumeration, security headers |
| `/bob-redirect-chain` | URL redirect analysis | Redirect tracking, destination analysis, security assessment |
| `/bob-favicons` | Website favicon analysis | Icon extraction, hash analysis, brand identification |

### Identity & Social Intelligence
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-nuclei` | Username investigation | Most reliable tool, no false/positive |
| `/bob-sherlock` | Multi-platform username search | 400+ platforms, real-time tracking, results export |
| `/bob-maigret` | Enhanced username investigation | Advanced reconnaissance, deep profile analysis |
| `/bob-linkook` | Username investigation | Discover linked social accounts |
| `/bob-generate-usernames` | Username variation generation | Pattern creation, format variations, enumeration lists |
| `/bob-ghunt` | Google account investigation | Gmail analysis, profile discovery, account correlation |

### Image & Media Analysis
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-exif` | Image metadata extraction | GPS coordinates, camera data, privacy mode, map integration |
| `/bob-rekognition` | AWS facial recognition | Face detection, celebrity recognition, demographic analysis |

### Blockchain & Cryptocurrency
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-blockchain` | Cryptocurrency address analysis | Multi-network support, transaction history, risk assessment |
| `/bob-blockchain-detect` | Crypto address detection | Format identification, confidence scoring, explorer links |

### Transportation & Aviation
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-aviation` | Aviation intelligence | Flight tracking, aircraft data, airline operations |
| `/bob-airport` | Airport information lookup | Facility data, runway information, operational status |
| `/bob-flight-number` | Specific flight tracking | Real-time status, route analysis, delay information |
| `/bob-vessels` | Maritime vessel tracking | Ship information, location tracking, maritime intelligence |

### Business & Corporate Intelligence
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-pappers` | Business registry | Company information, corporate structure, legal status |
| `/bob-nike` | Look up email address or a name | On Nike Run Club (NRC) fitness app |
| `/bob-vpic` | Vehicle identification by VIN | Car details, manufacturer data, specification lookup |

### AI & Analysis Tools
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-chat` | AI-powered analysis assistant | Multi-model support, OSINT analysis, code generation |
| `/bob-jwt` | JWT token analysis | Token decoding, security analysis, payload extraction |
| `/bob-xeuledoc` | Document analysis | Metadata extraction, content analysis, file intelligence |

### Utilities & Support
| Command | Description | Features |
|---------|-------------|----------|
| `/bob-extract-links` | URL extraction from text | Pattern matching, validation, bulk processing |
| `/bob-dork` | Google dorking assistance | Query generation, search optimization, target enumeration |
| `/bob-monitor` | Target monitoring setup | Continuous surveillance, alert configuration |
| `/bob-health` | System health monitoring | Bot status, API connectivity, performance metrics |

## 🚀 Quick Installation Guide

### Prerequisites
- **Node.js** v18.0.0 or higher
- **Discord Bot Token**
- **External Tools**: ExifTool, Sherlock, Maigret, Nuclei (optional)
- **API Keys**: Various services for full functionality (see Configuration)

### Basic Setup
```bash
# Clone repository
git clone https://github.com/gl0bal01/discord-osint-assistant.git
cd discord-osint-assistant

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your tokens and API keys

# Deploy commands
npm run deploy

# Start bot
npm start
```

## ⚙️ Configuration

### Required Environment Variables
```env
# Discord Configuration (Required)
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_application_client_id
GUILD_ID=your_development_server_id

# Notification Channel for Monitored Websites
MONITOR_CHANNEL_ID=your_monitor_notification_discord_channel_id

# Core API Keys (Recommended)
WHOXY_API_KEY=your_whoxy_api_key
DNSDUMPSTER_TOKEN=your_dnsdumpster_token
HOSTIO_API_KEY=your_hostio_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
AIRPORTDB_API_KEY=your_airportdb_api_key

# Advanced Features (Optional)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
PAPPERS_API_KEY=your_pappers_api_key

# 1MIN AI
AI_API_KEY=your_ai_api_key

# Tool Paths (Optional - if not in PATH)
EXIFTOOL_PATH=exiftool
SHERLOCK_PATH=sherlock
NUCLEI_PATH=nuclei
NUCLEI_TEMPLATE_PATH=/username/nuclei-templates/http/osint/user-enumeration
MAIGRET_PATH=maigret

# Access Control (Optional)
OSINT_ALLOWED_ROLES=comma_separated_discord_role_ids
```

### External Tool Integration
- **ExifTool**: Image metadata extraction with GPS mapping
- **Sherlock**: Username investigation across 400+ platforms
- **Maigret**: Enhanced username reconnaissance
- **Nuclei**: Most reliable username search

## 📊 Usage Examples

### Basic Domain Investigation
```
/bob-dns domain:example.com
/bob-whoxy type:domain domain:example.com
/bob-hostio domain:example.com
```

### Identity Investigation
```
/bob-sherlock username:target_user
/bob-generate-usernames firstname:John lastname:Doe
/bob-ghunt email:target@example.com
```

### Image Analysis
```
/bob-exif image_url:https://example.com/image.jpg privacy:true
/bob-rekognition image_url:https://example.com/photo.jpg
```

### Blockchain Investigation
```
/bob-blockchain address btc 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
/bob-blockchain-detect text:"Check this address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
```

### AI-Powered Analysis
```
/bob-chat ask message:"Analyze this OSINT data" context:osint
/bob-chat code request:"Generate Python script for data parsing" language:python
```

## 🏗️ Architecture

```
discord-osint-assistant/
├── README.md                    # Project documentation
├── package.json                 # Dependencies and scripts
├── index.js                     # Main bot entry point
├── deploy-commands.js           # Command deployment utility
├── .env.example                 # Environment template
├── 
├── commands/                    # Complete command suite
│   ├── dns.js              # DNS analysis and reconnaissance
│   ├── whoxy.js            # WHOIS history and reverse lookup
│   ├── nuclei.js           # Most reliable username search
│   ├── exif.js             # Image metadata with GPS mapping
│   ├── blockchain.js       # Cryptocurrency investigation
│   |── chat.js             # AI-powered analysis assistant
│   ├── hostio.js           # Domain hosting intelligence
│   ├── recon-web.js        # Web reconnaissance
│   ├── redirect-chain.js   # URL redirect analysis
│   ├── favicons.js         # Website favicon analysis
│   ├── aviation.js         # Aviation intelligence
│   ├── airport.js          # Airport information
│   ├── flight-number.js    # Flight tracking
│   ├── vessels.js          # Maritime tracking
│   ├── pappers.js          # Business registry
│   ├── nike.js             # Product authentication
│   ├── vpic.js             # Vehicle identification
│   ├── sherlock.js         # Multi-platform username search
│   ├── maigret.js          # Enhanced username investigation
│   ├── linkook.js          # Discover linked/connected social accounts
│   ├── ghunt.js            # Google account investigation
│   ├── extract-links.js    # URL extraction
│   ├── jwt.js              # Token analysis
│   ├── dork.js             # Google dorking
│   ├── xeuledoc.js         # Document analysis
│   ├── blockchain-detect.js # Crypto address detection
│   ├── generate-usernames.js # Username generation
│   ├── rekognition.js      # AWS facial recognition
│   ├── monitor.js          # Target monitoring
│   ├── health.js           # System monitoring
│   │
├── utils/                       # Shared utility modules
│   ├── validation.js           # Input validation and sanitization
│   ├── process.js              # Safe process execution (spawn, no shell)
│   ├── ssrf.js                 # SSRF protection (private IP blocking)
│   ├── permissions.js          # Role-based command access control
│   ├── temp.js                 # Temp directory and file management
│   ├── chunks.js               # Discord message chunking utilities
│   └── config.js               # Centralized environment config
│
├── addons/                     # Configuration files
│   └── GPS2MapUrl.config      # ExifTool GPS mapping
│
├── tests/                      # Test suite (vitest)
│   └── utils/                  # Utility function tests
│       ├── validation.test.js
│       ├── process.test.js
│       └── ssrf.test.js
│
├── docs/                       # Documentation
│   └── INSTALLATION.md         # Detailed setup guide
│
├── SECURITY.md                 # Security policy and vulnerability reporting
└── CONTRIBUTING.md             # Contribution guidelines
```

## 🔒 Security & Privacy

For full details, see [SECURITY.md](SECURITY.md).

### Built-in Security Features
- **Safe Command Execution**: All external tools run via `spawn()` with argument arrays — no shell string interpolation. See `utils/process.js`
- **Input Validation**: Comprehensive sanitization strips shell metacharacters, newlines, null bytes, and Unicode bypass characters. See `utils/validation.js`
- **SSRF Protection**: URL-accepting commands validate that targets do not resolve to private/internal IP ranges. See `utils/ssrf.js`
- **Permission System**: Sensitive OSINT commands require elevated Discord permissions (ManageGuild/Administrator). Configurable via `OSINT_ALLOWED_ROLES` env var. See `utils/permissions.js`
- **Audit Logging**: All command usage is logged with user, guild, and timestamp
- **Secure Error Handling**: Error responses shown to users are generic; detailed errors are logged server-side only

### Privacy Considerations
- Configurable privacy modes for sensitive operations
- Automatic cleanup of temporary files
- API keys loaded from environment variables, never hardcoded
- No investigation data persisted beyond Discord message lifetime

## 📈 Performance & Scalability

### System Requirements
- **Minimum**: 2GB RAM, Node.js 18.0.0+, 1GB storage
- **Recommended**: 4GB+ RAM, SSD storage, stable internet
- **Production**: Load balancing, monitoring, log rotation

### Performance Features
- Asynchronous processing for concurrent operations
- Intelligent timeout handling for long-running tasks
- Memory-efficient file processing
- Optimized API request patterns

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

### Development Setup
```bash
# Development mode with auto-restart
npm run dev

# Run tests
npm test

# Linting
npm run lint

# Cleanup temporary files
npm run clean
```

### Adding New Commands
1. Create command file in `/commands/` directory
2. Import validation from `utils/validation.js`
3. Use `safeSpawn`/`safeSpawnToFile` from `utils/process.js` for external tools — **never use shell string interpolation**
4. Use `utils/temp.js` for temporary files
5. Deploy with `npm run deploy`

## 📄 Legal & Compliance

### Usage Guidelines
This tool is designed for legitimate OSINT research, security testing, and educational purposes. Users must:
- Comply with applicable laws and regulations
- Respect platform terms of service
- Obtain proper authorization for investigations
- Use responsibly and ethically

### Disclaimer
The authors are not responsible for misuse of this software. Users bear full responsibility for ensuring legal compliance in their jurisdiction.

## 🆘 Support & Resources

### Documentation
- **Complete Setup Guide**: [docs/INSTALLATION.md](docs/INSTALLATION.md)
- **Security Policy**: [SECURITY.md](SECURITY.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Command Reference**: Individual command help available via Discord

### Health Monitoring
Use `/bob-health detailed:true check-apis:true check-tools:true` to verify:
- System status and performance
- API connectivity and quotas
- External tool availability
- Configuration validation

### Community & Support
- **GitHub Issues**: Bug reports and feature requests
- **Documentation**: Comprehensive guides and examples
- **Discord Support**: Community assistance and updates

## 🚀 Version Information

**Current Version**: 2.0.0  
**Author**: gl0bal01  
**License**: MIT  
**Node.js**: >=18.0.0 required

### Key Features in v2.0
- Comprehensive OSINT commands
- Multi-AI model integration
- Advanced blockchain analysis
- Enhanced privacy controls
- Professional documentation
- Production-ready architecture

---

**Discord OSINT Assistant** - Professional intelligence gathering made accessible through Discord.

*Empowering investigators, researchers, and security professionals with comprehensive OSINT capabilities.*

**🎆 Made with ❤️ for the Osint community**

[![GitHub](https://img.shields.io/badge/GitHub-gl0bal01-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/gl0bal01)
