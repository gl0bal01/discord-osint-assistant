/**
 * File: utils/process.js
 * Description: Safe process execution utilities using spawn (no shell interpolation)
 * Author: gl0bal01
 *
 * All external command execution MUST use these utilities instead of
 * string-interpolated shell calls to prevent command injection vulnerabilities.
 */

const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Safely run an external command using spawn (no shell).
 * @param {string} command - Path to binary
 * @param {string[]} args - Array of arguments (NOT interpolated into a shell string)
 * @param {object} options - { timeout, maxBuffer, cwd, env }
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function safeSpawn(command, args = [], options = {}) {
    const {
        timeout = 300000,
        maxBuffer = 10 * 1024 * 1024,
        cwd,
        env = process.env
    } = options;

    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
            if (stdout.length > maxBuffer) {
                proc.kill('SIGTERM');
                reject(new Error('Output exceeded maximum buffer size'));
            }
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeoutId = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                try { if (!proc.killed) proc.kill('SIGKILL'); } catch {}
            }, 5000);
            reject(new Error(`Process timed out after ${timeout / 1000} seconds`));
        }, timeout);

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (!killed) {
                resolve({ stdout, stderr, code: code ?? 0 });
            }
        });

        proc.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to start process: ${error.message}`));
        });
    });
}

/**
 * Safely spawn a process and write stdout to a file.
 * @param {string} command - Path to binary
 * @param {string[]} args - Array of arguments
 * @param {string} outputFilePath - Path to write stdout
 * @param {object} options - Same as safeSpawn
 * @returns {Promise<{ stderr: string, code: number }>}
 */
function safeSpawnToFile(command, args = [], outputFilePath, options = {}) {
    const {
        timeout = 300000,
        cwd,
        env = process.env
    } = options;

    return new Promise((resolve, reject) => {
        const outStream = fs.createWriteStream(outputFilePath);
        const proc = spawn(command, args, {
            cwd,
            env,
            stdio: ['ignore', outStream, 'pipe'],
            shell: false
        });

        let stderr = '';
        let killed = false;

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeoutId = setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                try { if (!proc.killed) proc.kill('SIGKILL'); } catch {}
            }, 5000);
            reject(new Error(`Process timed out after ${timeout / 1000} seconds`));
        }, timeout);

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            outStream.end();
            if (!killed) {
                resolve({ stderr, code: code ?? 0 });
            }
        });

        proc.on('error', (error) => {
            clearTimeout(timeoutId);
            outStream.end();
            reject(new Error(`Failed to start process: ${error.message}`));
        });
    });
}

module.exports = { safeSpawn, safeSpawnToFile };
