// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const app = express();

const PORT = process.env.PORT || 3000;

// IMPORTANT:
// Put this in Render environment variables
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Your Render URL
// Example:
// https://my-server.onrender.com
const SERVER_URL =
    process.env.SERVER_URL ||
    `http://localhost:${PORT}`;

// Reports folder
const DATA_DIR = path.join(__dirname, 'reports');


// =========================
// Middleware
// =========================

app.use(cors());

app.use(express.json({
    limit: '50mb'
}));


// =========================
// Initialize reports folder
// =========================

async function initializeDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, {
            recursive: true
        });

        console.log('[Server] Reports directory ready');
    } catch (error) {
        console.error('[Server] Failed creating reports directory:', error);
    }
}


// =========================
// Helpers
// =========================

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return (
        Math.round(bytes / Math.pow(k, i) * 100) / 100 +
        ' ' +
        sizes[i]
    );
}


// =========================
// Discord Webhook
// =========================

async function sendDiscordNotification(reportData, downloadUrl) {

    if (!DISCORD_WEBHOOK_URL) {
        console.warn('[Discord] Missing webhook URL');
        return false;
    }

    const embed = {
        title: '🚨 New Player Report',
        color: 0xFF5555,

        fields: [
            {
                name: '📝 Report ID',
                value: `\`${reportData.reportId}\``,
                inline: false
            },

            {
                name: '👤 Reporter',
                value: reportData.reporter?.name || 'Unknown',
                inline: true
            },

            {
                name: '🎯 Reported Player',
                value: reportData.reported?.name || 'Unknown',
                inline: true
            },

            {
                name: '📄 Reason',
                value: (reportData.reason || 'No reason')
                    .substring(0, 1000),
                inline: false
            },

            {
                name: '📊 Recording Info',
                value:
                    `${reportData.metadata?.frameCount || 0} frames\n` +
                    `${reportData.metadata?.duration || 0}s\n` +
                    `${reportData.metadata?.captureRate || 0} FPS`,
                inline: false
            },

            {
                name: '🎮 Game Info',
                value:
                    `Place ID: ${reportData.metadata?.placeId || 'N/A'}\n` +
                    `Job ID: \`${reportData.metadata?.jobId || 'N/A'}\``,
                inline: false
            },

            {
                name: '📥 Download Replay Data',
                value:
                    `[Download JSON File](${downloadUrl})\n\n` +
                    `Download and load into viewer.html`,
                inline: false
            }
        ],

        timestamp: new Date(
            (reportData.timestamp || Date.now() / 1000) * 1000
        ).toISOString(),

        footer: {
            text: 'Roblox Replay System'
        }
    };

    try {

        await axios.post(DISCORD_WEBHOOK_URL, {
            content: '⚠️ New report submitted',
            embeds: [embed],

            username: 'Roblox Report Bot',

            avatar_url:
                'https://cdn.icon-icons.com/icons2/2699/PNG/512/roblox_logo_icon_170891.png'
        });

        console.log(
            `[Discord] Sent notification for ${reportData.reportId}`
        );

        return true;

    } catch (error) {

        console.error(
            '[Discord] Webhook error:',
            error.response?.data || error.message
        );

        return false;
    }
}


// =========================
// Download Route
// =========================

// This forces download instead of showing JSON in browser

app.get('/reports/:file', async (req, res) => {

    try {

        const fileName = path.basename(req.params.file);

        if (!fileName.endsWith('.json')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid file'
            });
        }

        const filePath = path.join(DATA_DIR, fileName);

        await fs.access(filePath);

        res.download(filePath);

    } catch (error) {

        console.error('[Download] Error:', error);

        res.status(404).json({
            success: false,
            error: 'File not found'
        });
    }
});


// =========================
// Submit Report
// =========================

app.post('/api/report', async (req, res) => {

    try {

        const reportData = req.body;

        if (!reportData || !reportData.reportId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid report data'
            });
        }

        console.log(
            `[API] Received report ${reportData.reportId}`
        );

        const reportSize =
            JSON.stringify(reportData).length;

        console.log(
            `[API] Size: ${formatBytes(reportSize)}`
        );

        // Safe filename
        const safeId =
            reportData.reportId.replace(/[^a-zA-Z0-9_-]/g, '');

        const fileName = `${safeId}.json`;

        const filePath = path.join(DATA_DIR, fileName);

        // Save report
        await fs.writeFile(
            filePath,
            JSON.stringify(reportData, null, 2),
            'utf8'
        );

        console.log(
            `[API] Saved report: ${filePath}`
        );

        // Public download URL
        const downloadUrl =
            `${SERVER_URL}/reports/${fileName}`;

        // Send Discord webhook
        await sendDiscordNotification(
            reportData,
            downloadUrl
        );

        return res.json({
            success: true,
            reportId: safeId,
            downloadUrl,
            message: 'Report uploaded successfully'
        });

    } catch (error) {

        console.error(
            '[API] Submit report error:',
            error
        );

        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});


// =========================
// List Reports
// =========================

app.get('/api/reports', async (req, res) => {

    try {

        const files = await fs.readdir(DATA_DIR);

        const reports = [];

        for (const file of files) {

            if (!file.endsWith('.json')) {
                continue;
            }

            try {

                const filePath = path.join(DATA_DIR, file);

                const stats = await fs.stat(filePath);

                const raw = await fs.readFile(
                    filePath,
                    'utf8'
                );

                const reportData = JSON.parse(raw);

                reports.push({

                    reportId: reportData.reportId,

                    fileName: file,

                    downloadUrl:
                        `${SERVER_URL}/reports/${file}`,

                    timestamp: reportData.timestamp,

                    reporter: reportData.reporter,

                    reported: reportData.reported,

                    reason:
                        (reportData.reason || '')
                            .substring(0, 100),

                    size: formatBytes(stats.size)
                });

            } catch (err) {

                console.error(
                    `[Reports] Failed parsing ${file}`,
                    err
                );
            }
        }

        reports.sort((a, b) =>
            (b.timestamp || 0) -
            (a.timestamp || 0)
        );

        res.json({
            success: true,
            count: reports.length,
            reports
        });

    } catch (error) {

        console.error(
            '[Reports] Error:',
            error
        );

        res.status(500).json({
            success: false,
            error: 'Failed to list reports'
        });
    }
});


// =========================
// Health Check
// =========================

app.get('/health', (req, res) => {

    res.json({
        success: true,
        status: 'online',
        uptime: process.uptime()
    });
});


// =========================
// Home Page
// =========================

app.get('/', (req, res) => {

    res.send(`
        <h1>Replay Report Server</h1>
        <p>Status: Online</p>
        <p>Reports API: /api/reports</p>
    `);
});


// =========================
// Start Server
// =========================

async function startServer() {

    await initializeDataDirectory();

    app.listen(PORT, () => {

        console.log('=================================');
        console.log(`[Server] Running on port ${PORT}`);
        console.log(`[Server] URL: ${SERVER_URL}`);
        console.log(`[Server] Reports folder: ${DATA_DIR}`);
        console.log('=================================');
    });
}

startServer();
