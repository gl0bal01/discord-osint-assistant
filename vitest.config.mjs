// Commands log through pino; keep test output readable. Logger tests build their own instances.
export default {
    test: {
        env: { LOG_LEVEL: 'silent' }
    }
};
