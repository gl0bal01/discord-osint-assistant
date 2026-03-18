const DISCORD_MAX = 1900;

function splitIntoChunks(text, maxSize = DISCORD_MAX) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        let breakPoint = Math.min(i + maxSize, text.length);
        if (breakPoint < text.length) {
            const newlineIndex = text.lastIndexOf('\n', breakPoint);
            if (newlineIndex > i && newlineIndex > breakPoint - 300) {
                breakPoint = newlineIndex + 1;
            }
        }
        chunks.push(text.substring(i, breakPoint));
        i = breakPoint;
    }
    return chunks;
}

function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

module.exports = { splitIntoChunks, chunkArray, DISCORD_MAX };
