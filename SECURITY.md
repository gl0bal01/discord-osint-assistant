# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | No |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email the repository owner or use GitHub's private vulnerability reporting.
3. Include: description, steps to reproduce, and potential impact.
4. You will receive a response within 48 hours.

## Security Architecture

### Command Execution
All external tool execution uses `spawn()` with argument arrays via `utils/process.js`. Shell string interpolation is never used for commands that process user input.

### Input Validation
User inputs are validated through `utils/validation.js` before processing. The `sanitizeInput()` function strips shell metacharacters, newlines, null bytes, and fullwidth Unicode characters.

### Authorization
Sensitive OSINT commands require elevated Discord permissions (ManageGuild or Administrator). Configure the `OSINT_ALLOWED_ROLES` environment variable for role-based access control.

### SSRF Protection
All URL-accepting commands validate that target URLs do not resolve to private or internal IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x) via `utils/ssrf.js`.

### Data Handling
- Temporary files are cleaned up automatically after use
- No investigation data is persisted beyond the Discord message lifetime
- API keys are loaded from environment variables, never hardcoded
- Error messages shown to users are generic; detailed errors are logged server-side only

## Best Practices for Operators

- Set `.env` file permissions to `chmod 600 .env`
- Use least-privilege IAM policies for AWS credentials
- Rotate API keys regularly
- Restrict the bot to private Discord servers with trusted members
- Review server logs for audit trail (command usage is logged with user/guild info)
- Configure `OSINT_ALLOWED_ROLES` to restrict sensitive commands
