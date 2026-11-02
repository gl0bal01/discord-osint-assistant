/**
 * File: chat.js
 * Description: AI-powered chat assistant with multi-model support for OSINT analysis
 * Author: gl0bal01
 *
 * This command provides access to various AI models for OSINT analysis, research
 * assistance, data interpretation, and investigative support. Integrates with
 * multiple AI providers to offer comprehensive intelligence analysis capabilities.
 *
 * Features:
 * - Multi-model AI support (GPT, Claude, Gemini, etc.)
 * - Conversation context management
 * - OSINT-specific analysis prompts
 * - Code generation for automation
 * - Data analysis and interpretation
 * - Report generation assistance
 * - Investigation planning support
 *
 * Supported Models (1min.ai roster, see CHAT_MODELS / CODE_MODELS):
 * - Anthropic Claude Haiku/Sonnet/Opus 5.5, Fable 5.1
 * - OpenAI GPT-6, Google Gemini 4 / 3.8, xAI Grok 4.7
 * - DeepSeek V4, Qwen3.8, Kimi, GLM, Mistral, Muse
 * - Perplexity Sonar models (with live web search)
 *
 * Usage: /bob-chat ask message:"Analyze this OSINT data" model:sonar-pro
 *        /bob-chat code request:"Generate Python script for data parsing"
 */

const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const { getSafeAxiosConfig } = require('../utils/ssrf');
const { sanitizeChatInput } = require('../utils/validation');
const { neutralizeMentions } = require('../utils/discord');

const QWEN3_ASR_LANGUAGE_CODES = new Set([
    'zh', 'yue', 'en', 'ja', 'de', 'ko', 'ru', 'fr', 'pt', 'ar', 'it', 'es',
    'hi', 'id', 'th', 'tr', 'uk', 'vi', 'cs', 'da', 'fil', 'fi', 'is', 'ms',
    'no', 'pl', 'sv'
]);
const PHONE_CALL_LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/;

// Model roster from https://api.1min.ai/models?feature=UNIFY_CHAT_WITH_AI|CODE_GENERATOR
// (same lineup as discord-ai-assistant). Discord allows max 25 choices per option.
const CHAT_MODELS = [
    { name: 'Claude Haiku 5.5', value: 'us.anthropic.claude-haiku-5-5' },
    { name: 'Claude Sonnet 5.5', value: 'us.anthropic.claude-sonnet-5-5' },
    { name: 'Claude Opus 5.5', value: 'us.anthropic.claude-opus-5-5' },
    { name: 'Claude Fable 5.1', value: 'us.anthropic.claude-fable-5-1' },
    { name: 'GPT-6 Luna', value: 'gpt-6-luna' },
    { name: 'GPT-6.1 Sol', value: 'gpt-6.1-sol' },
    { name: 'GPT-6 Astra', value: 'gpt-6-astra' },
    { name: 'Gemini 3.8 Flash', value: 'gemini-3.8-flash' },
    { name: 'Gemini 4 Argon', value: 'gemini-4-argon' },
    { name: 'Grok 4.7', value: 'grok-4.7' },
    { name: 'DeepSeek V4.1 Flash', value: 'deepseek-flash' },
    { name: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
    { name: 'Qwen3.8 Max', value: 'qwen3.8-max' },
    { name: 'Kimi K3', value: 'moonshotai/kimi-k3' },
    { name: 'GLM-5.3', value: 'glm-5.3' },
    { name: 'Mistral Medium 3.5', value: 'mistral-medium-3-5' },
    { name: 'Muse Wonder', value: 'meta/muse-wonder' },
    { name: 'Sonar', value: 'sonar' },
    { name: 'Sonar Pro', value: 'sonar-pro' },
    { name: 'Sonar Reasoning Pro', value: 'sonar-reasoning-pro' },
    { name: 'Sonar Deep Research', value: 'sonar-deep-research' }
];
const CODE_MODELS = [
    { name: 'Claude Sonnet 5.5', value: 'us.anthropic.claude-sonnet-5-5' },
    { name: 'Claude Opus 5.5', value: 'us.anthropic.claude-opus-5-5' },
    { name: 'Gemini 4 Argon', value: 'gemini-4-argon' },
    { name: 'Grok 4.7', value: 'grok-4.7' },
    { name: 'Kimi K2.7 Code', value: 'moonshotai/kimi-k2.7-code' },
    { name: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
    { name: 'GLM-5.3', value: 'glm-5.3' }
];
const CHAT_DEFAULT_MODEL = 'us.anthropic.claude-haiku-5-5';
const CODE_DEFAULT_MODEL = 'us.anthropic.claude-sonnet-5-5';
const ANALYSIS_MODEL = 'us.anthropic.claude-sonnet-5-5';
const MODEL_LABELS = new Map([...CHAT_MODELS, ...CODE_MODELS].map(m => [m.value, m.name]));
const WEB_SEARCH_MODELS = new Set(['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research']);
const AI_TIMEOUT_MS = 120000; // 1min.ai generation deadline is two minutes

// Next real <tag> opener (tag name followed by whitespace or ">") at or after `from`
function findTag(text, tag, from) {
    const open = `<${tag}`;
    for (let i = text.indexOf(open, from); i !== -1; i = text.indexOf(open, i + 1)) {
        if (/[\s>]/.test(text.charAt(i + open.length))) return i;
    }
    return -1;
}

// Index of the ">" ending the tag that starts at `start`, skipping quoted attribute values
function findTagEnd(text, start) {
    let quoted = false;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '"') quoted = !quoted;
        else if (text[i] === '>' && !quoted) return i;
    }
    return -1;
}

// CODE_GENERATOR replies use 1min.ai's web UI format: <thinking>...</thinking>
// blocks and <artifact language="js">code</artifact> blocks. Drop the reasoning and
// turn artifacts into Discord code blocks. One forward pass with indexOf (no lazy
// regexes), so hostile output stays linear-time; tags inside an artifact are code.
// ponytail: a literal </artifact> or ``` inside code ends the block early, like 1min.ai's own UI.
function formatCodeReply(text) {
    let out = '';
    let pos = 0;
    let thinking = findTag(text, 'thinking', 0);
    let artifact = findTag(text, 'artifact', 0);

    while (thinking !== -1 || artifact !== -1) {
        const isThinking = thinking !== -1 && (artifact === -1 || thinking < artifact);
        const start = isThinking ? thinking : artifact;
        const closeTag = isThinking ? '</thinking>' : '</artifact>';
        const openEnd = findTagEnd(text, start);
        const close = openEnd === -1 ? -1 : text.indexOf(closeTag, openEnd);

        if (close === -1) {
            // Unclosed reasoning before an artifact: treat it as ending where the code starts
            if (isThinking && artifact !== -1) {
                out += text.slice(pos, start);
                pos = artifact;
                thinking = -1;
                continue;
            }
            // Unclosed reasoning with nothing before it means the reply was cut off mid-thought
            if (isThinking && !(out + text.slice(pos, start)).trim()) pos = text.length;
            break;
        }

        out += text.slice(pos, start);
        pos = close + closeTag.length;
        if (isThinking) {
            while (/\s/.test(text.charAt(pos))) pos++;
        } else {
            const lang = text.slice(start, openEnd).match(/language="([^"]*)"/)?.[1] ?? '';
            out += '```' + lang + '\n' + text.slice(openEnd + 1, close).replace(/^\n|\n$/g, '') + '\n```';
        }

        if (thinking !== -1 && thinking < pos) thinking = findTag(text, 'thinking', pos);
        if (artifact !== -1 && artifact < pos) artifact = findTag(text, 'artifact', pos);
    }
    return out + text.slice(pos);
}

// Store conversation contexts for users
const userConversations = new Map();
const MAX_CONVERSATIONS = 100;
const CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes

function pruneConversations() {
    const now = Date.now();
    for (const [key, conv] of userConversations) {
        if (conv.lastActivity && now - conv.lastActivity > CONVERSATION_TTL) {
            userConversations.delete(key);
        }
    }
    if (userConversations.size > MAX_CONVERSATIONS) {
        const oldest = [...userConversations.entries()]
            .sort((a, b) => (a[1].lastActivity || 0) - (b[1].lastActivity || 0));
        const toRemove = oldest.slice(0, userConversations.size - MAX_CONVERSATIONS);
        toRemove.forEach(([key]) => userConversations.delete(key));
    }
}

const pruneInterval = setInterval(pruneConversations, 5 * 60 * 1000);
pruneInterval.unref();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bob-chat')
        .setDescription('AI-powered assistant for OSINT analysis and research support')
        .addSubcommand(subcommand =>
            subcommand
                .setName('ask')
                .setDescription('Ask the AI assistant a question or request analysis')
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Your question or request for the AI')
                        .setRequired(true)
                        .setMaxLength(2000))
                .addStringOption(option =>
                    option.setName('model')
                        .setDescription(`AI model to use (default: ${MODEL_LABELS.get(CHAT_DEFAULT_MODEL)})`)
                        .setRequired(false)
                        .addChoices(...CHAT_MODELS))
                .addStringOption(option =>
                    option.setName('context')
                        .setDescription('Specialized context for the request')
                        .setRequired(false)
                        .addChoices(
                            { name: 'OSINT Analysis', value: 'osint' },
                            { name: 'Data Interpretation', value: 'data' },
                            { name: 'Investigation Planning', value: 'investigation' },
                            { name: 'Technical Analysis', value: 'technical' },
                            { name: 'Report Writing', value: 'report' },
                            { name: 'General Assistance', value: 'general' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('code')
                .setDescription('Generate code for OSINT automation and data analysis')
                .addStringOption(option =>
                    option.setName('request')
                        .setDescription('Describe the code you need')
                        .setRequired(true)
                        .setMaxLength(2000))
                .addStringOption(option =>
                    option.setName('language')
                        .setDescription('Programming language (default: Python)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Python', value: 'python' },
                            { name: 'JavaScript', value: 'javascript' },
                            { name: 'Bash/Shell', value: 'bash' },
                            { name: 'PowerShell', value: 'powershell' },
                            { name: 'SQL', value: 'sql' },
                            { name: 'Other/Specify', value: 'other' }
                        ))
                .addStringOption(option =>
                    option.setName('model')
                        .setDescription(`Code model to use (default: ${MODEL_LABELS.get(CODE_DEFAULT_MODEL)})`)
                        .setRequired(false)
                        .addChoices(...CODE_MODELS))
                .addBooleanOption(option =>
                    option.setName('new-context')
                        .setDescription('Start fresh code generation context (default: false)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('analyze')
                .setDescription('Analyze OSINT data, findings, or investigation results')
                .addStringOption(option =>
                    option.setName('data')
                        .setDescription('Data or findings to analyze')
                        .setRequired(true)
                        .setMaxLength(2000))
                .addStringOption(option =>
                    option.setName('analysis-type')
                        .setDescription('Type of analysis needed')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Pattern Recognition', value: 'pattern' },
                            { name: 'Threat Assessment', value: 'threat' },
                            { name: 'Link Analysis', value: 'link' },
                            { name: 'Timeline Analysis', value: 'timeline' },
                            { name: 'Risk Assessment', value: 'risk' },
                            { name: 'Summary Generation', value: 'summary' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transcribe')
                .setDescription('Transcribe uploaded audio (Qwen3 ASR Flash or Phone Call model)')
                .addStringOption(option =>
                    option.setName('audio-url')
                        .setDescription('Asset path from 1min.ai Asset API upload (fileContent.path)')
                        .setRequired(true)
                        .setMaxLength(512))
                .addStringOption(option =>
                    option.setName('stt-model')
                        .setDescription('Speech-to-text model to use (default: qwen3-asr-flash)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Qwen3 ASR Flash', value: 'qwen3-asr-flash' },
                            { name: 'Phone Call', value: 'phone_call' }
                        ))
                .addStringOption(option =>
                    option.setName('language')
                        .setDescription('Language code. Required for Phone Call (e.g. en-US), optional for Qwen3 (e.g. en)')
                        .setRequired(false)
                        .setMaxLength(10))
                .addBooleanOption(option =>
                    option.setName('enable-itn')
                        .setDescription('Qwen3 only: enable inverse text normalization (English/Chinese)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset conversation context with AI models')
                .addStringOption(option =>
                    option.setName('model')
                        .setDescription('Specific model to reset (default: all)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All Models', value: 'all' },
                            { name: 'Chat Context', value: 'chat' },
                            { name: 'Code Context', value: 'code' },
                            { name: 'Analysis Context', value: 'analysis' }
                        ))),

    /**
     * Execute the AI chat command
     * @param {CommandInteraction} interaction - Discord interaction object
     */
    async execute(interaction) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        // Initialize user conversations if not exists
        if (!userConversations.has(userId)) {
            const convMap = new Map();
            convMap.lastActivity = Date.now();
            userConversations.set(userId, convMap);
        } else {
            userConversations.get(userId).lastActivity = Date.now();
        }

        console.log(`🤖 [CHAT] Processing ${subcommand} request for user: ${userId}`);

        // Validate API key
        const apiKey = process.env.AI_API_KEY;
        if (!apiKey) {
            return interaction.editReply({
                content: '❌ **Configuration Error**\n' +
                        'AI API key is not configured. Please contact the administrator.\n\n' +
                        '**Setup Instructions:**\n' +
                        '1. Get API key from your AI service provider\n' +
                        '2. Add AI_API_KEY to environment variables',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            let response;

            switch (subcommand) {
                case 'ask':
                    response = await handleChatRequest(interaction, userId, apiKey);
                    break;
                case 'code':
                    response = await handleCodeRequest(interaction, userId, apiKey);
                    break;
                case 'analyze':
                    response = await handleAnalysisRequest(interaction, userId, apiKey);
                    break;
                case 'transcribe':
                    response = await handleSpeechToTextRequest(interaction, apiKey);
                    break;
                case 'reset':
                    response = await handleResetRequest(interaction, userId);
                    break;
                default:
                    throw new Error('Invalid subcommand');
            }

            // Neutralize Discord mentions in the reply content before sending
            if (response && typeof response.content === 'string') {
                response.content = neutralizeMentions(response.content);
            }

            await interaction.editReply(response);

            console.log(`✅ [CHAT] Successfully processed ${subcommand} request`);

        } catch (error) {
            await handleChatError(interaction, error, subcommand);
        }
    },

    shutdown() { clearInterval(pruneInterval); },

    formatCodeReply
};

/**
 * Handle chat/ask requests
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} userId - User ID
 * @param {string} apiKey - AI API key
 * @returns {Promise<Object>} Response object
 */
async function handleChatRequest(interaction, userId, apiKey) {
    const message = interaction.options.getString('message');
    const model = interaction.options.getString('model') || CHAT_DEFAULT_MODEL;
    const context = interaction.options.getString('context') || 'general';

    // Sanitize message using chat-friendly sanitizer (preserves brackets/parens)
    const cleanMessage = sanitizeChatInput(message);

    // Get or create conversation
    const conversations = userConversations.get(userId);
    let conversationId = conversations.get(`chat_${model}`);

    if (!conversationId) {
        conversationId = await createConversation('UNIFY_CHAT_WITH_AI', model, apiKey, context);
        conversations.set(`chat_${model}`, conversationId);
    }

    // Add context-specific system prompt
    const contextualMessage = addContextToMessage(cleanMessage, context);

    // Send message to AI
    const aiResponse = await sendAIRequest('UNIFY_CHAT_WITH_AI', model, conversationId, contextualMessage, apiKey);

    return formatAIResponse(aiResponse, model, 'Chat Response');
}

/**
 * Handle code generation requests
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} userId - User ID
 * @param {string} apiKey - AI API key
 * @returns {Promise<Object>} Response object
 */
async function handleCodeRequest(interaction, userId, apiKey) {
    const request = interaction.options.getString('request');
    const language = interaction.options.getString('language') || 'python';
    const model = interaction.options.getString('model') || CODE_DEFAULT_MODEL;
    const newContext = interaction.options.getBoolean('new-context') ?? false;

    // Get or create code conversation
    const conversations = userConversations.get(userId);
    let conversationId = conversations.get('code_context');

    if (!conversationId || newContext) {
        conversationId = await createConversation('CODE_GENERATOR', model, apiKey, 'code');
        conversations.set('code_context', conversationId);
    }

    // Format code request with OSINT context
    const codePrompt = formatCodeRequest(request, language);

    // Send to AI
    const aiResponse = await sendAIRequest('CODE_GENERATOR', model, conversationId, codePrompt, apiKey);

    return formatAIResponse(aiResponse, model, 'Code Generation', true);
}

/**
 * Handle analysis requests
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} userId - User ID
 * @param {string} apiKey - AI API key
 * @returns {Promise<Object>} Response object
 */
async function handleAnalysisRequest(interaction, userId, apiKey) {
    const data = interaction.options.getString('data');
    const analysisType = interaction.options.getString('analysis-type') || 'summary';

    const model = ANALYSIS_MODEL;

    // Get or create analysis conversation
    const conversations = userConversations.get(userId);
    let conversationId = conversations.get('analysis_context');

    if (!conversationId) {
        conversationId = await createConversation('UNIFY_CHAT_WITH_AI', model, apiKey, 'analysis');
        conversations.set('analysis_context', conversationId);
    }

    // Format analysis request
    const analysisPrompt = formatAnalysisRequest(data, analysisType);

    // Send to AI
    const aiResponse = await sendAIRequest('UNIFY_CHAT_WITH_AI', model, conversationId, analysisPrompt, apiKey);

    return formatAIResponse(aiResponse, model, 'OSINT Analysis');
}

/**
 * Handle speech-to-text requests using Qwen3 ASR Flash
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} apiKey - AI API key
 * @returns {Promise<Object>} Response object
 */
async function handleSpeechToTextRequest(interaction, apiKey) {
    const audioUrl = interaction.options.getString('audio-url');
    const sttModel = interaction.options.getString('stt-model') || 'qwen3-asr-flash';
    const language = interaction.options.getString('language');
    const enableItn = interaction.options.getBoolean('enable-itn') ?? false;

    const cleanAudioUrl = audioUrl.trim();
    const rawLanguage = language ? language.trim() : '';

    if (sttModel === 'phone_call') {
        if (!rawLanguage) {
            return {
                content: '❌ **Missing Language Code**\n' +
                        'Phone Call transcription requires `language` (example: `en-US`, `vi-VN`, `zh-CN`).'
            };
        }

        if (!PHONE_CALL_LANGUAGE_CODE_PATTERN.test(rawLanguage)) {
            return {
                content: '❌ **Invalid Phone Call Language Code**\n' +
                        `Provided: \`${neutralizeMentions(rawLanguage)}\`\n` +
                        'Use a BCP-47 style code like `en-US`, `en-GB`, `vi-VN`, or `zh-CN`.'
            };
        }

        const aiResponse = await phoneCallSpeechToText(cleanAudioUrl, apiKey, rawLanguage);
        return formatAIResponse(aiResponse, 'phone_call', 'Phone Call Speech to Text');
    }

    const normalizedLanguage = rawLanguage ? rawLanguage.toLowerCase() : undefined;
    if (normalizedLanguage && !QWEN3_ASR_LANGUAGE_CODES.has(normalizedLanguage)) {
        return {
            content: '❌ **Invalid Qwen3 Language Code**\n' +
                    `Provided: \`${neutralizeMentions(normalizedLanguage)}\`\n` +
                    'Use a supported code like `en`, `zh`, `yue`, `ja`, `de`, `fr`, or leave blank for auto-detection.'
        };
    }

    const aiResponse = await qwen3AsrFlashSpeechToText(cleanAudioUrl, apiKey, {
        language: normalizedLanguage,
        enableItn
    });
    return formatAIResponse(aiResponse, 'qwen3-asr-flash', 'Speech to Text');
}

/**
 * Handle context reset requests
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Response object
 */
async function handleResetRequest(interaction, userId) {
    const resetType = interaction.options.getString('model') || 'all';
    const conversations = userConversations.get(userId);

    let resetCount = 0;
    let resetLabel = resetType;

    if (resetType === 'all') {
        resetCount = conversations.size;
        conversations.clear();
    } else {
        if (resetType === 'chat') {
            const chatKeys = Array.from(conversations.keys()).filter(key => key.startsWith('chat_'));
            for (const key of chatKeys) {
                conversations.delete(key);
            }
            resetCount = chatKeys.length;
            resetLabel = 'Chat contexts';
        } else if (resetType === 'code') {
            if (conversations.delete('code_context')) resetCount = 1;
            resetLabel = 'Code context';
        } else if (resetType === 'analysis') {
            if (conversations.delete('analysis_context')) resetCount = 1;
            resetLabel = 'Analysis context';
        }
    }

    return {
        content: `✅ **Context Reset Complete**\n` +
                `🗑️ **Cleared:** ${resetCount} conversation context(s)\n` +
                `🎯 **Type:** ${resetType === 'all' ? 'All contexts' : resetLabel}\n\n` +
                `Your next AI interaction will start with a fresh context.`
    };
}

/**
 * Create new AI conversation
 * @param {string} type - Conversation type
 * @param {string} model - AI model
 * @param {string} apiKey - API key
 * @param {string} context - Context type
 * @returns {Promise<string>} Conversation ID
 */
async function createConversation(type, model, apiKey, context) {
    const contextTitles = {
        'osint': 'OSINT Investigation Assistant',
        'data': 'Data Analysis Assistant',
        'investigation': 'Investigation Planning Assistant',
        'technical': 'Technical Analysis Assistant',
        'report': 'Report Writing Assistant',
        'code': 'OSINT Code Generation',
        'analysis': 'OSINT Data Analysis',
        'general': 'General OSINT Assistant'
    };

    const response = await axios.post(
        'https://api.1min.ai/api/conversations',
        {
            title: contextTitles[context] || 'Discord OSINT Assistant',
            type: type === 'CHAT_WITH_AI' ? 'UNIFY_CHAT_WITH_AI' : type,
            model: model
        },
        {
            ...getSafeAxiosConfig(),
            headers: {
                'API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 15000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024
        }
    );

    return response.data?.conversation?.uuid || response.data?.uuid;
}

/**
 * Send request to AI API
 * @param {string} type - Request type
 * @param {string} model - AI model
 * @param {string} conversationId - Conversation ID
 * @param {string} prompt - User prompt
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} AI response
 */
async function sendAIRequest(type, model, conversationId, prompt, apiKey) {
    const isUnifiedChat = type === 'UNIFY_CHAT_WITH_AI' || type === 'CHAT_WITH_AI';
    const endpoint = isUnifiedChat
        ? 'https://api.1min.ai/api/chat-with-ai'
        : 'https://api.1min.ai/api/features';

    const payload = isUnifiedChat
        ? {
            type: 'UNIFY_CHAT_WITH_AI',
            model: model,
            promptObject: {
                prompt: prompt,
                conversationId: conversationId,
                settings: {
                    historySettings: {
                        isMixed: false,
                        historyMessageLimit: 10
                    },
                    // Perplexity Sonar models answer from live web results
                    ...(WEB_SEARCH_MODELS.has(model) && {
                        webSearchSettings: {
                            webSearch: true,
                            numOfSite: model === 'sonar-deep-research' ? 10 : 5,
                            maxWord: 1000
                        }
                    })
                }
            }
        }
        : {
            type: type,
            model: model,
            conversationId: conversationId,
            promptObject: {
                prompt: prompt,
                webSearch: false
            }
        };

    const response = await axios.post(
        endpoint,
        payload,
        {
            ...getSafeAxiosConfig(),
            headers: {
                'API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: AI_TIMEOUT_MS,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024
        }
    );

    return response.data;
}

/**
 * Transcribe audio with Qwen3 ASR Flash via 1min.ai AI Feature API
 * Docs: https://docs.1min.ai/docs/api/ai-for-audio/speech-to-text/qwen3-asr-flash
 * @param {string} audioUrl - Asset path returned by 1min.ai Asset API
 * @param {string} apiKey - AI API key
 * @param {Object} options - Optional settings
 * @param {string} [options.language] - Language code (e.g. en, zh, yue)
 * @param {boolean} [options.enableItn=false] - Enable inverse text normalization
 * @returns {Promise<Object>} AI response
 */
async function qwen3AsrFlashSpeechToText(audioUrl, apiKey, options = {}) {
    if (!audioUrl || typeof audioUrl !== 'string') {
        throw new Error('audioUrl is required for qwen3-asr-flash transcription');
    }

    const promptObject = {
        audioUrl: audioUrl,
        enable_itn: options.enableItn ?? false
    };

    if (options.language) {
        promptObject.language = options.language;
    }

    const response = await axios.post(
        'https://api.1min.ai/api/features',
        {
            type: 'SPEECH_TO_TEXT',
            model: 'qwen3-asr-flash',
            promptObject
        },
        {
            ...getSafeAxiosConfig(),
            headers: {
                'API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 120000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024
        }
    );

    return response.data;
}

/**
 * Transcribe phone call audio via 1min.ai Phone Call model
 * Docs: https://docs.1min.ai/docs/api/ai-for-audio/speech-to-text/phone-call-speech-to-text
 * @param {string} audioUrl - Asset path returned by 1min.ai Asset API
 * @param {string} apiKey - AI API key
 * @param {string} language - Language code (e.g. en-US, vi-VN)
 * @returns {Promise<Object>} AI response
 */
async function phoneCallSpeechToText(audioUrl, apiKey, language) {
    if (!audioUrl || typeof audioUrl !== 'string') {
        throw new Error('audioUrl is required for phone_call transcription');
    }
    if (!language || typeof language !== 'string') {
        throw new Error('language is required for phone_call transcription');
    }

    const response = await axios.post(
        'https://api.1min.ai/api/features',
        {
            type: 'SPEECH_TO_TEXT',
            model: 'phone_call',
            promptObject: {
                audioUrl,
                language
            }
        },
        {
            ...getSafeAxiosConfig(),
            headers: {
                'API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 120000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024
        }
    );

    return response.data;
}

/**
 * Add context-specific prompting to user message
 * @param {string} message - User message
 * @param {string} context - Context type
 * @returns {string} Enhanced message with context
 */
function addContextToMessage(message, context) {
    const contextPrompts = {
        'osint': 'As an OSINT analysis expert, please help with: ',
        'data': 'As a data analysis specialist, please analyze: ',
        'investigation': 'As an investigation planning expert, please advise on: ',
        'technical': 'As a technical analysis expert, please examine: ',
        'report': 'As a professional report writer, please help create: ',
        'general': ''
    };

    const contextPrompt = contextPrompts[context] || '';
    return contextPrompt + message;
}

/**
 * Format code generation request with OSINT context
 * @param {string} request - Code request
 * @param {string} language - Programming language
 * @returns {string} Formatted prompt
 */
function formatCodeRequest(request, language) {
    return `Please generate ${language} code for the following OSINT/investigation task: ${request}

Requirements:
- Include comprehensive comments explaining each section
- Add error handling and validation
- Make the code modular and reusable
- Include usage examples
- Consider OSINT best practices and data privacy
- Add appropriate logging for investigation trails

If this involves data processing, please include data validation and sanitization.`;
}

/**
 * Format analysis request with OSINT context
 * @param {string} data - Data to analyze
 * @param {string} analysisType - Type of analysis
 * @returns {string} Formatted prompt
 */
function formatAnalysisRequest(data, analysisType) {
    const analysisPrompts = {
        'pattern': 'Please analyze the following data for patterns, anomalies, and connections',
        'threat': 'Please assess the threat level and security implications of the following information',
        'link': 'Please identify relationships, connections, and associations in the following data',
        'timeline': 'Please create a timeline analysis of the following events and data',
        'risk': 'Please perform a risk assessment of the following information',
        'summary': 'Please provide a comprehensive summary and key insights from the following data'
    };

    const analysisPrompt = analysisPrompts[analysisType] || 'Please analyze the following data';

    return `${analysisPrompt}:

${data}

Please provide:
1. Key findings and insights
2. Notable patterns or anomalies
3. Potential investigative leads
4. Risk assessment if applicable
5. Recommended next steps
6. Confidence level in findings

Format your response for an OSINT investigation context.`;
}

/**
 * Format AI response for Discord
 * @param {Object} aiResponse - Raw AI response
 * @param {string} model - Model used
 * @param {string} responseType - Type of response
 * @param {boolean} isCode - Whether response contains code
 * @returns {Object} Formatted Discord response
 */
function formatAIResponse(aiResponse, model, responseType, isCode = false) {
    // resultObject is a list of strings (chat, code and speech-to-text alike)
    const resultObject = aiResponse?.aiRecord?.aiRecordDetail?.resultObject ??
        aiResponse?.result?.response;

    // 1min.ai can report errors (e.g. INSUFFICIENT_CREDITS) with a 2xx status,
    // either as the whole body or as an object in place of resultObject
    if (resultObject == null || (typeof resultObject === 'object' && !Array.isArray(resultObject))) {
        const noResult = new Error('AI API response has no result');
        noResult.apiCode = resultObject?.code ?? aiResponse?.code ?? aiResponse?.errorCode;
        throw noResult;
    }

    let content = Array.isArray(resultObject) ? resultObject.join('\n') : String(resultObject);
    if (isCode) content = formatCodeReply(content);
    if (!content.trim()) throw new Error('AI API response is empty');

    // Neutralize Discord mentions in LLM content before embedding in response
    content = neutralizeMentions(content);

    // Create response object
    const response = {
        content: `🤖 **${responseType} from ${MODEL_LABELS.get(model) ?? model}**\n\n`
    };

    // Handle long responses
    const maxLength = 1900; // Leave room for header

    if (content.length <= maxLength) {
        response.content += content;
    } else {
        // Create attachment for long responses
        const attachment = new AttachmentBuilder(
            Buffer.from(content, 'utf8'),
            { name: `ai_response_${responseType.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.${isCode ? 'md' : 'txt'}` }
        );

        response.content += `*Response too long for Discord message. See attached file.*\n\n`;
        const preview = content.substring(0, 500);
        // Close a code fence the cut left open, or Discord renders the code as markdown
        const openFence = (preview.match(/```/g) ?? []).length % 2 ? '\n```' : '';
        response.content += `**Preview:**\n${preview}...${openFence}`;
        response.files = [attachment];
    }

    return response;
}

/**
 * Handle chat command errors
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Error} error - The error that occurred
 * @param {string} subcommand - Subcommand that failed
 */
async function handleChatError(interaction, error, subcommand) {
    const apiCode = error.apiCode ?? error.response?.data?.errorCode ?? error.response?.data?.code;
    console.error('Chat error:', { status: error.response?.status, apiCode, message: error.message });

    let errorMessage = `❌ **AI ${subcommand.charAt(0).toUpperCase() + subcommand.slice(1)} Failed**\n\n`;

    if (apiCode === 'INSUFFICIENT_CREDITS') {
        errorMessage += '**💳 Out of Credits**\n';
        errorMessage += 'The AI service is out of credits. Please contact the administrator.';
    } else if (error.response) {
        const status = error.response.status;

        switch (status) {
            case 401:
            case 403:
                errorMessage += '**🔑 Authentication Error**\n';
                errorMessage += 'Invalid API key or unauthorized access. Check configuration.';
                break;
            case 429:
                errorMessage += '**🚦 Rate Limit Exceeded**\n';
                errorMessage += 'AI API rate limit reached. Please wait before trying again.';
                break;
            case 500:
            case 502:
            case 503:
                errorMessage += '**🛠️ Service Unavailable**\n';
                errorMessage += 'AI service is temporarily unavailable. Please try again later.';
                break;
            default:
                errorMessage += `**🚨 API Error (${status})**\n`;
                errorMessage += 'An error occurred communicating with the AI service.';
        }

    } else if (error.code === 'ECONNABORTED') {
        errorMessage += '**⏱️ Timeout Error**\n';
        errorMessage += 'AI request timed out. The request may be too complex or service is slow.';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage += '**🌐 Network Error**\n';
        errorMessage += 'Cannot connect to AI service. Please check your internet connection.';
    } else {
        errorMessage += '**🚨 Unexpected Error**\n';
        errorMessage += 'An unexpected error occurred while processing your request.';
    }

    await interaction.editReply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral
    });
}
