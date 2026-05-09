// server.js
// Node.js Express server to receive Roblox reports and send to Discord

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1370204009167585411/G5jV2PnfvTovyPzWBvolF3g3un-euXNgd4Ze0P1QhBa76mYeNMysTmJdq33JvPCbKKGw';
const VIEWER_BASE_URL = process.env.VIEWER_BASE_URL || 'http://localhost:3000';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large JSON payloads
app.use(express.static('public')); // Serve static files (viewer)

// Data directory
const DATA_DIR = path.join(__dirname, 'reports');

// Ensure data directory exists
async function InitializeDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log('[Server] Data directory initialized');
    } catch (error) {
        console.error('[Server] Failed to create data directory:', error);
    }
}

// Format file size
function FormatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Send Discord notification
async function SendDiscordNotification(reportData) {
    const reportUrl = `${VIEWER_BASE_URL}/viewer.html?report=${reportData.reportId}`;
    
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
                name: '🔗 View Replay',
                value: `[Click here to view replay](${reportUrl})`,
                inline: false
            }
        ],
        timestamp: new Date(reportData.timestamp * 1000).toISOString(),
        footer: {
            text: 'Roblox Report System'
        }
    };
    
    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
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

// API Routes

// Submit report
app.post('/api/report', async (req, res) => {
    try {
        const reportData = req.body;
        
        // Validate
        if (!reportData || !reportData.reportId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid report data' 
            });
        }
        
        console.log(`[API] Received report: ${reportData.reportId}`);
        console.log(`[API] Frames: ${reportData.metadata.frameCount}`);
        
        // Calculate data size
        const dataSize = JSON.stringify(reportData).length;
        console.log(`[API] Report size: ${FormatBytes(dataSize)}`);
        
        // Save to file
        const filePath = path.join(DATA_DIR, `${reportData.reportId}.json`);
        await fs.writeFile(filePath, JSON.stringify(reportData, null, 2));
        
        console.log(`[API] Report saved: ${filePath}`);
        
        // Send Discord notification
        await SendDiscordNotification(reportData);
        
        res.json({ 
            success: true, 
            reportId: reportData.reportId,
            viewUrl: `${VIEWER_BASE_URL}/viewer.html?report=${reportData.reportId}`
        });
        
    } catch (error) {
        console.error('[API] Error processing report:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Get report data
app.get('/api/report/:reportId', async (req, res) => {
    try {
        const { reportId } = req.params;
        const filePath = path.join(DATA_DIR, `${reportId}.json`);
        
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ 
                success: false, 
                error: 'Report not found' 
            });
        }
        
        // Read and send file
        const data = await fs.readFile(filePath, 'utf-8');
        const reportData = JSON.parse(data);
        
        res.json({ 
            success: true, 
            data: reportData 
        });
        
    } catch (error) {
        console.error('[API] Error fetching report:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// List all reports
app.get('/api/reports', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const reports = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(DATA_DIR, file);
                const data = await fs.readFile(filePath, 'utf-8');
                const reportData = JSON.parse(data);
                
                reports.push({
                    reportId: reportData.reportId,
                    timestamp: reportData.timestamp,
                    reporter: reportData.reporter,
                    reported: reportData.reported,
                    reason: reportData.reason.substring(0, 100),
                    frameCount: reportData.metadata.frameCount
                });
            }
        }
        
        // Sort by timestamp (newest first)
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
async function StartServer() {
    await InitializeDataDirectory();
    
    app.listen(PORT, () => {
        console.log(`[Server] Running on port ${PORT}`);
        console.log(`[Server] Viewer URL: ${VIEWER_BASE_URL}/viewer.html`);
    });
}

StartServer();
