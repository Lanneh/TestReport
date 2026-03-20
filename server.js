const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

// Folder to store replays
const replayDir = path.join(__dirname, "replays");

// Create folder if missing
if (!fs.existsSync(replayDir)) {
    fs.mkdirSync(replayDir);
    console.log("📁 Created replay directory");
}

// =========================
// 📤 UPLOAD ENDPOINT
// =========================
app.post("/upload", (req, res) => {
    try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: "Empty body" });
        }

        const fileName = `replay_${Date.now()}.json`;
        const filePath = path.join(replayDir, fileName);

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        console.log("📩 Upload received");
        console.log("📦 Size:", JSON.stringify(data).length, "bytes");
        console.log("💾 Saved:", fileName);

        const url = `${req.protocol}://${req.get("host")}/replays/${fileName}`;

        res.json({
            success: true,
            url: url
        });

    } catch (err) {
        console.error("❌ Upload error:", err);
        res.status(500).json({ success: false });
    }
});

// =========================
// 📥 DOWNLOAD ENDPOINT (FORCES DOWNLOAD)
// =========================
app.get("/replays/:file", (req, res) => {
    try {
        const fileName = req.params.file;
        const filePath = path.join(replayDir, fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }

        console.log("⬇️ Download:", fileName);

        res.setHeader("Content-Type", "application/json");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        res.sendFile(filePath);

    } catch (err) {
        console.error("❌ Download error:", err);
        res.status(500).send("Server error");
    }
});

// =========================
// 🧪 HEALTH CHECK
// =========================
app.get("/", (req, res) => {
    res.send("✅ Replay server running");
});

// =========================
// 🚀 START SERVER
// =========================
app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
});
