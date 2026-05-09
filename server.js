// server.js - Simplified version for downloadable JSON files
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1370204009167585411/G5jV2PnfvTovyPzWBvolF3g3un-euXNgd4Ze0P1QhBa76mYeNMysTmJdq33JvPCbKKGw';

// For ngrok or public server, use the public URL
// For localhost testing, just use localhost
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/reports', express.static('reports')); // Serve JSON files for download

// Data directory
const DATA_DIR = path.join(__dirname, 'reports');

// Initialize
async function initializeDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log('[Server] Data directory initialized');
    } catch (error) {
        console.error('[Server] Failed to create data directory:', error);
    }
}

// Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Send Discord notification with download link
async function sendDiscordNotification(reportData, downloadUrl) {
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
                value: reportData.reporter.name,
                inline: true
            },
            {
                name: '🎯 Reported Player',
                value: reportData.reported ? reportData.reported.name : 'N/A',
                inline: true
            },
            {
                name: '📄 Reason',
                value: reportData.reason.substring(0, 200),
                inline: false
            },
            {
                name: '📊 Recording Info',
                value: `${reportData.metadata.frameCount} frames over ${reportData.metadata.duration}s @ ${reportData.metadata.captureRate} FPS`,
                inline: false
            },
            {
                name: '🎮 Game Info',
                value: `Place ID: ${reportData.metadata.placeId}\nJob ID: \`${reportData.metadata.jobId}\``,
                inline: false
            },
            {
                name: '📥 Download Replay Data',
                value: `[Click here to download JSON](${downloadUrl})\n\nThen open viewer.html and load this file.`,
                inline: false
            }
        ],
        timestamp: new Date(reportData.timestamp * 1000).toISOString(),
        footer: {
            text: 'Download the JSON and open in viewer.html'
        }
    };
    
    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
            content: '⚠️ **New report submitted!** Download the replay data below.',
            embeds: [embed],
            username: 'Roblox Report Bot',
            avatar_url: 'https://cdn.icon-icons.com/icons2/2699/PNG/512/roblox_logo_icon_170891.png'
        });
        
        console.log('[Discord] Notification sent for report:', reportData.reportId);
        return true;
    } catch (error) {
        console.error('[Discord] Failed to send notification:', error.message);
        return false;
    }
}

// Submit report endpoint
app.post('/api/report', async (req, res) => {
    try {
        const reportData = req.body;
        
        if (!reportData || !reportData.reportId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid report data' 
            });
        }
        
        console.log(`[API] Received report: ${reportData.reportId}`);
        console.log(`[API] Frames: ${reportData.metadata.frameCount}`);
        
        const dataSize = JSON.stringify(reportData).length;
        console.log(`[API] Report size: ${formatBytes(dataSize)}`);
        
        // Save to file
        const fileName = `${reportData.reportId}.json`;
        const filePath = path.join(DATA_DIR, fileName);
        await fs.writeFile(filePath, JSON.stringify(reportData, null, 2));
        
        console.log(`[API] Report saved: ${filePath}`);
        
        // Create download URL
        const downloadUrl = `${SERVER_URL}/reports/${fileName}`;
        
        // Send Discord notification
        await sendDiscordNotification(reportData, downloadUrl);
        
        res.json({ 
            success: true, 
            reportId: reportData.reportId,
            downloadUrl: downloadUrl,
            message: 'Report saved. Download the JSON file and open in viewer.html'
        });
        
    } catch (error) {
        console.error('[API] Error processing report:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// List reports
app.get('/api/reports', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const reports = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(DATA_DIR, file);
                const stats = await fs.stat(filePath);
                const data = await fs.readFile(filePath, 'utf-8');
                const reportData = JSON.parse(data);
                
                reports.push({
                    reportId: reportData.reportId,
                    fileName: file,
                    downloadUrl: `${SERVER_URL}/reports/${file}`,
                    timestamp: reportData.timestamp,
                    reporter: reportData.reporter,
                    reported: reportData.reported,
                    reason: reportData.reason.substring(0, 100),
                    size: formatBytes(stats.size)
                });
            }
        }
        
        reports.sort((a, b) => b.timestamp - a.timestamp);
        
        res.json({ 
            success: true, 
            reports 
        });
        
    } catch (error) {
        console.error('[API] Error listing reports:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start server
async function startServer() {
    await initializeDataDirectory();
    
    app.listen(PORT, () => {
        console.log(`[Server] Running on port ${PORT}`);
        console.log(`[Server] Reports will be saved to: ${DATA_DIR}`);
        console.log(`[Server] Download URL base: ${SERVER_URL}/reports/`);
        console.log(`\nTo view reports:`);
        console.log(`1. Download the JSON file from Discord link`);
        console.log(`2. Open viewer.html in your browser`);
        console.log(`3. Load the JSON file\n`);
    });
}

startServer();
