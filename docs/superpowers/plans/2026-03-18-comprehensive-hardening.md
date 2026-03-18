# Discord OSINT Assistant - Comprehensive Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 18 security findings, all code quality issues, add tests, documentation, and clean up dependencies — sequential priority order (Critical then High then Medium then Low then Quality then Docs then Tests).

**Architecture:** Shared utility modules (`utils/process.js`, `utils/temp.js`, `utils/chunks.js`, `utils/ssrf.js`, `utils/permissions.js`) replace duplicated patterns across 30 command files. All shell command calls switch from string interpolation to `spawn()` with argument arrays. A permission middleware guards all commands. Test framework (vitest) covers validation and utilities.

**Tech Stack:** Node.js, discord.js v14, vitest (new), child_process.spawn (replacing string-interpolated shell calls)

---

## Phase 1: Security — Critical Command Injection Fixes

### Task 1: Create safe process execution utility

**Files:**
- Create: `utils/process.js`

- [ ] **Step 1: Create `utils/process.js` with `safeSpawn` function**

Uses `child_process.spawn` with `shell: false` to prevent injection. Provides two functions:
- `safeSpawn(cmd, args, opts)` — returns `{ stdout, stderr, code }`
- `safeSpawnToFile(cmd, args, outputPath, opts)` — pipes stdout to file

Key implementation details:
- Arguments passed as array (never interpolated into a shell string)
- `shell: false` explicitly set
- Configurable timeout with SIGTERM then SIGKILL fallback
- maxBuffer enforcement on stdout accumulation

- [ ] **Step 2: Commit**

```bash
git add utils/process.js
git commit -m "feat: add safe process execution utility using spawn instead of string interpolation"
```

---

### Task 2: Fix CRITICAL command injection in xeuledoc.js

**Files:**
- Modify: `commands/xeuledoc.js`

- [ ] **Step 1: Rewrite xeuledoc.js to use safeSpawn and add deferReply**

Key changes:
- Replace string-interpolated shell call with `safeSpawn('xeuledoc', [parsedUrl.href])`
- Validate the full URL object, not just prefix (current `startsWith` check is bypassable)
- Add `deferReply()` (was missing — causes silent failure on slow commands)
- Use `editReply` instead of `reply` in callbacks
- Stop leaking `error.message` to users

- [ ] **Step 2: Commit**

```bash
git add commands/xeuledoc.js
git commit -m "fix(security): eliminate command injection in xeuledoc — use spawn with args array"
```

---

### Task 3: Fix CRITICAL command injection in ghunt.js

**Files:**
- Modify: `commands/ghunt.js`

- [ ] **Step 1: Replace shell call with safeSpawn() in ghunt.js**

The critical change is at line 483. Key fixes:
1. Remove redundant `require('dotenv').config();` (line 16)
2. Replace child_process import with `const { safeSpawn } = require('../utils/process');`
3. For each switch case, build an args array instead of a string:
   - email: `['email', sanitizedQuery, '--json', outputFilePath]`
   - drive: `['drive', sanitizedQuery, '--json', outputFilePath]`
   - gaia: `['gaia', sanitizedQuery, '--json', outputFilePath]`
   - geolocate: `['geolocate', sanitizedQuery, '--json', outputFilePath]`
   - spiderdal: `['spiderdal', sanitizedQuery, '--json', outputFilePath]`
4. Call `safeSpawn('ghunt', args, { timeout: 120000 })` instead of shell string
5. Fix HTML report XSS — add `escapeHtml()` helper and apply to `query`, `userTag`, `searchType` in `generateHtmlReport()` (lines 39, 205, 209, 213, 260) and `generateLinkCard` (lines 275-276)

- [ ] **Step 2: Commit**

```bash
git add commands/ghunt.js
git commit -m "fix(security): eliminate command injection and XSS in ghunt — spawn + escapeHtml"
```

---

### Task 4: Fix command injection in maigret.js

**Files:**
- Modify: `commands/maigret.js`

- [ ] **Step 1: Replace shell call with safeSpawnToFile()**

1. Replace child_process import with `const { safeSpawnToFile } = require('../utils/process');`
2. Replace the shell call + promise block (lines 68-109) with:
   ```
   const args = [username, '-a', '--no-progressbar', '--txt'];
   if (verbose) args.push('--verbose');
   await safeSpawnToFile(maigretPath, args, outputFile, { timeout: customTimeout * 1000 });
   ```
3. Remove the unreachable code at lines 85-87 (dead code after `return resolve(stdout)`)

- [ ] **Step 2: Commit**

```bash
git add commands/maigret.js
git commit -m "fix(security): replace shell call with spawn in maigret, remove unreachable code"
```

---

### Task 5: Fix command injection in sherlock.js

**Files:**
- Modify: `commands/sherlock.js`

- [ ] **Step 1: Replace shell call with safeSpawnToFile()**

1. Replace child_process import with `const { safeSpawnToFile } = require('../utils/process');`
2. Replace `executeSherlockScan` function to use spawn with args array:
   ```
   const args = [username];
   if (verbose) args.push('--verbose');
   if (!includeNsfw) args.push('--nsfw');
   await safeSpawnToFile(sherlockPath, args, outputFile, { timeout, env });
   ```
3. Remove the duplicate `isValidUrl` function at lines 364-371 — import from `utils/validation.js` instead

- [ ] **Step 2: Commit**

```bash
git add commands/sherlock.js
git commit -m "fix(security): replace shell call with spawn in sherlock, deduplicate isValidUrl"
```

---

### Task 6: Fix command injection in nuclei.js

**Files:**
- Modify: `commands/nuclei.js`

- [ ] **Step 1: Replace shell call with safeSpawn()**

1. Replace child_process import with `const { safeSpawn } = require('../utils/process');`
2. Build args array instead of interpolated string (lines 165-175):
   ```
   const args = ['-t', templatesPath, '-tags', tagsList.join(','),
                  '-var', `user=${username}`, '-o', outputFile,
                  verbose ? '-v' : '-silent'];
   ```
3. Replace the shell call promise (lines 188-258) with:
   ```
   await safeSpawn(nucleiBinary, args, { timeout: customTimeout * 1000 });
   ```

- [ ] **Step 2: Commit**

```bash
git add commands/nuclei.js
git commit -m "fix(security): replace shell call with spawn in nuclei"
```

---

### Task 7: Fix command injection in jwt.js

**Files:**
- Modify: `commands/jwt.js`

- [ ] **Step 1: Replace execPromise with safeSpawn**

1. Replace child_process and util.promisify imports with `const { safeSpawn, safeSpawnToFile } = require('../utils/process');`
2. Update `findJwtTool` to use `safeSpawn` instead of `execPromise`
3. Update `executeJwtCommand` to use `safeSpawnToFile` with args array
4. Build each subcommand as an args array instead of string concatenation
5. Restrict `wordlist` path — use `path.basename()` to strip directory traversal and restrict to a configured wordlist directory

- [ ] **Step 2: Commit**

```bash
git add commands/jwt.js
git commit -m "fix(security): replace shell calls with spawn in jwt, restrict wordlist path traversal"
```

---

### Task 8: Fix shell call in exif.js

**Files:**
- Modify: `commands/exif.js`

- [ ] **Step 1: Replace execPromise with safeSpawn()**

At line 350, replace the `execPromise(command, ...)` with spawn:
```
const args = ['-config', configPath, '-json', imagePath];
const { stdout } = await safeSpawn(exiftoolPath, args, { timeout: 30000 });
```

Also fix the `|| true` bug at line 73:
```
// OLD: const includeDetailed = interaction.options.getBoolean('detailed') || true;
// NEW: const includeDetailed = interaction.options.getBoolean('detailed') ?? true;
```

- [ ] **Step 2: Commit**

```bash
git add commands/exif.js
git commit -m "fix(security): replace shell call with spawn in exif, fix boolean default bug"
```

---

## Phase 2: Security — High Priority Fixes

### Task 9: Add SSRF protection utility

**Files:**
- Create: `utils/ssrf.js`

- [ ] **Step 1: Create SSRF validation utility**

Implements `validateUrlNotInternal(url)` that:
- Parses the URL and extracts hostname
- Resolves hostname to IP addresses via DNS
- Checks each resolved IP against private ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fe80::, fd/fc)
- Throws if any IP is private

Also exports `isPrivateIp(ip)` for testing.

- [ ] **Step 2: Commit**

```bash
git add utils/ssrf.js
git commit -m "feat: add SSRF protection utility to block private IP resolution"
```

---

### Task 10: Apply SSRF protection to URL-accepting commands

**Files:**
- Modify: `commands/monitor.js`, `commands/recon-web.js`, `commands/redirect-chain.js`, `commands/extract-links.js`, `commands/favicons.js`, `commands/rekognition.js`

- [ ] **Step 1: Add SSRF check before HTTP requests in all 6 commands**

Add `const { validateUrlNotInternal } = require('../utils/ssrf');` and call `await validateUrlNotInternal(url)` before any HTTP request with a user-supplied URL.

- [ ] **Step 2: Commit**

```bash
git add commands/monitor.js commands/recon-web.js commands/redirect-chain.js commands/extract-links.js commands/favicons.js commands/rekognition.js
git commit -m "fix(security): add SSRF protection to all URL-accepting commands"
```

---

### Task 11: Add permission/authorization system

**Files:**
- Create: `utils/permissions.js`
- Modify: `index.js`

- [ ] **Step 1: Create permissions utility**

Maps sensitive commands to required Discord permissions:
- nuclei, monitor, rekognition, jwt, ghunt, sherlock, maigret → ManageGuild
- Also supports `OSINT_ALLOWED_ROLES` env var for role-based access

- [ ] **Step 2: Add permission check middleware to index.js**

After getting the command (line 108), check permissions before executing:
```
const { allowed, reason } = checkPermission(interaction);
if (!allowed) return interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
```

- [ ] **Step 3: Commit**

```bash
git add utils/permissions.js index.js
git commit -m "feat(security): add role-based permission system for sensitive commands"
```

---

### Task 12: Remove plaintext credential input from monitor.js

**Files:**
- Modify: `commands/monitor.js`

- [ ] **Step 1: Remove the login subcommand**

- Remove the `login` subcommand builder (lines 134-149)
- Replace the `case 'login':` handler with a deprecation message
- Remove the `monitorLogin` function (lines 65-100)
- Remove `const { chromium } = require('playwright');` (line 32) — was only used by login
- Remove `require('dotenv').config();` (line 28)

- [ ] **Step 2: Commit**

```bash
git add commands/monitor.js
git commit -m "fix(security): remove plaintext credential login monitoring feature"
```

---

## Phase 3: Security — Medium Priority Fixes

### Task 13: Fix boolean default bugs

**Files:**
- Modify: `commands/redirect-chain.js` (lines 65, 67)
- Modify: `commands/aviation.js` (if same pattern)

- [ ] **Step 1: Fix `|| true` to `?? true`**

```
// redirect-chain.js line 65:
const includeHeaders = interaction.options.getBoolean('headers') ?? true;
// redirect-chain.js line 67:
const deepAnalysis = interaction.options.getBoolean('deep') ?? true;
// aviation.js (if present):
const includeDetailed = interaction.options.getBoolean('detailed') ?? true;
```

- [ ] **Step 2: Commit**

```bash
git add commands/redirect-chain.js commands/aviation.js
git commit -m "fix: use nullish coalescing for boolean defaults — || true always evaluates true"
```

---

### Task 14: Add bounds to in-memory Maps

**Files:**
- Modify: `commands/chat.js`
- Modify: `commands/monitor.js`

- [ ] **Step 1: Add TTL and size limit to chat.js userConversations**

Add `MAX_CONVERSATIONS = 100`, `CONVERSATION_TTL = 30 * 60 * 1000`, and a `pruneConversations()` function on a 5-minute interval.

- [ ] **Step 2: Add max sessions limit to monitor.js**

Add `MAX_MONITORS = 20` and check before creating new intervals.

- [ ] **Step 3: Commit**

```bash
git add commands/chat.js commands/monitor.js
git commit -m "fix: add bounds and TTL to in-memory caches to prevent memory exhaustion"
```

---

### Task 15: Improve sanitizeInput

**Files:**
- Modify: `utils/validation.js`

- [ ] **Step 1: Harden sanitizeInput against Unicode and newlines**

Add stripping of `\r`, `\n`, `\0` and fullwidth Unicode characters (`\u{FF00}-\u{FFEF}`).

- [ ] **Step 2: Commit**

```bash
git add utils/validation.js
git commit -m "fix(security): harden sanitizeInput against Unicode and newline bypass"
```

---

### Task 16: Stop leaking error details to users

**Files:**
- Modify: `commands/linkook.js`, `commands/recon-web.js`, `commands/sherlock.js`, `commands/nuclei.js`

- [ ] **Step 1: Replace raw error.message with generic messages in user-facing responses**

Keep `error.message` in `console.error` but show generic message to Discord users.

- [ ] **Step 2: Commit**

```bash
git add commands/linkook.js commands/recon-web.js commands/sherlock.js commands/nuclei.js
git commit -m "fix(security): stop leaking internal error details to Discord users"
```

---

### Task 17: Add ghunt results cleanup

**Files:**
- Modify: `commands/ghunt.js`

- [ ] **Step 1: Add finally block for cleanup**

Clean up `outputFilePath` and HTML report after 30-second delay.

- [ ] **Step 2: Commit**

```bash
git add commands/ghunt.js
git commit -m "fix: add cleanup for ghunt result files to prevent data persistence"
```

---

## Phase 4: Code Quality

### Task 18: Create shared temp directory utility

**Files:**
- Create: `utils/temp.js`

- [ ] **Step 1: Create temp utility**

Exports: `ensureTempDir()`, `tempFilePath(prefix, ext)`, `cleanupFile(path, delay)`, `cleanupDir(path, delay)`.

- [ ] **Step 2: Commit**

```bash
git add utils/temp.js
git commit -m "feat: add shared temp directory utility to eliminate duplication"
```

---

### Task 19: Create shared message chunking utility

**Files:**
- Create: `utils/chunks.js`

- [ ] **Step 1: Create chunks utility**

Exports: `splitIntoChunks(text, maxSize)`, `chunkArray(array, chunkSize)`.

- [ ] **Step 2: Commit**

```bash
git add utils/chunks.js
git commit -m "feat: add shared message chunking utility"
```

---

### Task 20: Remove redundant dotenv calls and deduplicate validation imports

**Files:**
- Modify: `commands/airport.js`, `commands/aviation.js`, `commands/blockchain.js`, `commands/dns.js`, `commands/hostio.js` (remove dotenv)
- Modify: `commands/recon-web.js`, `commands/hostio.js` (remove local isValidDomain, import from utils)
- Modify: `commands/redirect-chain.js`, `commands/rekognition.js` (remove local isValidUrl, import from utils)

- [ ] **Step 1: Remove redundant dotenv calls from 5 command files**
- [ ] **Step 2: Replace local validation functions with imports from utils/validation.js**
- [ ] **Step 3: Commit**

```bash
git add commands/
git commit -m "refactor: remove redundant dotenv calls and deduplicate validation functions"
```

---

### Task 21: Standardize SlashCommandBuilder imports

**Files:**
- Modify: All 28 command files using `@discordjs/builders`

- [ ] **Step 1: Bulk replace `require('@discordjs/builders')` with `require('discord.js')`**

Safe find-and-replace since discord.js v14 re-exports everything.

- [ ] **Step 2: Commit**

```bash
git add commands/
git commit -m "refactor: standardize SlashCommandBuilder import from discord.js"
```

---

### Task 22: Clean up dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove unused deps, fix engines, generate lockfile**

Remove `node-fetch` (unused), `@discordjs/builders` (re-exported by discord.js). Check if `@discordjs/rest` is used in deploy-commands.js before removing. Update engines to `>=18.0.0`.

- [ ] **Step 2: Run npm install to generate lockfile**
- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused deps, fix engines, generate lockfile"
```

---

### Task 23: Fix ephemeral on editReply no-ops

**Files:**
- Modify: `commands/dns.js`, `commands/ghunt.js`

- [ ] **Step 1: Remove `ephemeral: true` from editReply calls**

The ephemeral flag only works at deferReply time.

- [ ] **Step 2: Commit**

```bash
git add commands/dns.js commands/ghunt.js
git commit -m "fix: remove no-op ephemeral flag from editReply calls"
```

---

## Phase 5: Tests

### Task 24: Set up test framework and write tests

**Files:**
- Modify: `package.json`
- Create: `tests/utils/validation.test.js`
- Create: `tests/utils/process.test.js`
- Create: `tests/utils/ssrf.test.js`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Update package.json test script**

Change `"test": "echo ..."` to `"test": "vitest run"` and add `"test:watch": "vitest"`.

- [ ] **Step 3: Create validation tests**

Test all functions: `isValidDomain`, `isValidUrl`, `isValidEmail`, `isValidUsername`, `isValidIpAddress`, `isValidCryptoAddress`, `sanitizeInput`, `containsMaliciousPatterns`.

Key test cases:
- sanitizeInput strips shell metacharacters, newlines, null bytes, fullwidth unicode
- isValidUsername rejects `user;rm -rf` and `user$(whoami)`
- isValidUrl rejects `javascript:` and `ftp://`

- [ ] **Step 4: Create SSRF tests**

Test `isPrivateIp` for 10.x, 172.16.x, 192.168.x, 127.x, 169.254.x, ::1, fe80::, and public IPs.

- [ ] **Step 5: Create process utility tests**

Test: simple command, command not found, timeout, arguments passed safely without shell interpretation (e.g., `echo 'hello; rm -rf /'` outputs the literal string).

- [ ] **Step 6: Run tests and verify all pass**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add package.json tests/
git commit -m "feat: add vitest test framework with validation, SSRF, and process utility tests"
```

---

## Phase 6: Documentation

### Task 25: Create SECURITY.md

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: Write SECURITY.md**

Cover: supported versions, vulnerability reporting process, security architecture (input validation, spawn-based execution, authorization, SSRF protection, data handling), best practices for operators.

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md with vulnerability disclosure policy"
```

---

### Task 26: Create CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write CONTRIBUTING.md**

Cover: getting started, adding new commands (use spawn not shell strings, use validation, use temp utils), code standards, testing, PR process.

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md with development guidelines"
```

---

### Task 27: Fix REPOSITORY_SUMMARY.md license inconsistency

**Files:**
- Modify: `REPOSITORY_SUMMARY.md`

- [ ] **Step 1: Fix the license field from ISC to MIT**
- [ ] **Step 2: Commit**

```bash
git add REPOSITORY_SUMMARY.md
git commit -m "docs: fix license inconsistency in REPOSITORY_SUMMARY.md — MIT not ISC"
```

---

### Task 28: Create centralized config module

**Files:**
- Create: `utils/config.js`

- [ ] **Step 1: Create config module**

Validates all required env vars at startup and provides defaults for optional ones. Documents every env var with a description.

- [ ] **Step 2: Commit**

```bash
git add utils/config.js
git commit -m "feat: add centralized config module with startup validation"
```

---

## Phase 7: Final Cleanup

### Task 29: Remove Nike token plaintext storage

**Files:**
- Modify: `commands/nike.js`

- [ ] **Step 1: Replace file-based token storage with in-memory cache**

Use a module-scoped variable with TTL instead of writing to `data/nike_token.json`.

- [ ] **Step 2: Commit**

```bash
git add commands/nike.js
git commit -m "fix(security): store Nike token in memory instead of plaintext on disk"
```

---

### Task 30: Final verification

- [ ] **Step 1: Run all tests** — `npm test` — all pass
- [ ] **Step 2: Verify no string-interpolated shell calls remain in commands/** — grep for the pattern
- [ ] **Step 3: Verify all commands import from utils/validation.js where needed**
- [ ] **Step 4: Verify no redundant dotenv calls** — grep commands/ for dotenv
- [ ] **Step 5: Commit any remaining fixes**

---

## Summary

| Phase | Tasks | What it fixes |
|-------|-------|---------------|
| 1 | Tasks 1-8 | 2 CRITICAL + 4 HIGH command injection vulns |
| 2 | Tasks 9-12 | SSRF, authorization, credential exposure |
| 3 | Tasks 13-17 | Boolean bugs, memory leaks, error leaks, data persistence |
| 4 | Tasks 18-23 | Code duplication, dependency cleanup, import standardization |
| 5 | Task 24 | Test framework + tests for utils |
| 6 | Tasks 25-28 | SECURITY.md, CONTRIBUTING.md, config module, license fix |
| 7 | Tasks 29-30 | Nike token, final verification |
