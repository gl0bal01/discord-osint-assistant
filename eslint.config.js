const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                console: 'readonly',
                process: 'readonly',
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                Promise: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-useless-assignment': 'warn',
            'preserve-caught-error': 'off',
            'no-case-declarations': 'warn',
        },
    },
    {
        // etherscan-tx-graph is a standalone browser addon (vis-network/jsPDF,
        // DOM globals) — not part of the bot's Node source, so it's out of scope
        // for this CommonJS/Node lint config.
        ignores: ['node_modules/', 'temp/', 'tests/', 'etherscan-tx-graph/'],
    },
];
