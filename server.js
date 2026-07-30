const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Replay data can get large, so we increase the JSON payload limit to 50mb
app.use(express.json({ limit: '50mb' }));

// Ensure the 'replays' directory exists before we try saving to it
const replaysDir = path.join(__dirname, 'replays');
if (!fs.existsSync(replaysDir)) {
    fs.mkdirSync(replaysDir);
}

app.post('/api/upload-replay', (req, res) => {
    const replayData = req.body;

    // Basic validation to make sure it's actual replay data
    if (!replayData || !replayData.StartTime) {
        console.error("Received invalid data format.");
        return res.status(400).json({ error: 'Invalid replay data' });
    }

    // Generate a unique filename using the current time and a random string
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const filename = `replay_${timestamp}_${randomSuffix}.json`;
    const filepath = path.join(replaysDir, filename);

    // Save the JSON to disk
    // Note: We use JSON.stringify with null, 2 to format it nicely, 
    // but you can remove the formatting to save disk space if you want.
    fs.writeFile(filepath, JSON.stringify(replayData, null, 2), (err) => {
        if (err) {
            console.error('Failed to save replay:', err);
            return res.status(500).json({ error: 'Failed to save replay to disk' });
        }
        
        console.log(`Replay saved successfully: ${filename} | Size: ${(JSON.stringify(replayData).length / 1024).toFixed(2)} KB`);
        res.status(200).json({ message: 'Replay saved successfully', filename: filename });
    });
});

app.listen(PORT, () => {
    console.log(`Replay server listening on port ${PORT}`);
    console.log(`Waiting for replays at http://localhost:${PORT}/api/upload-replay`);
});
