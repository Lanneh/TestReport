const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

// Folder to store replays
const replayDir = path.join(__dirname, "replays");
if (!fs.existsSync(replayDir)) {
    fs.mkdirSync(replayDir);
}

// Upload endpoint
app.post("/upload", (req, res) => {
    try {
        const data = req.body;

        const fileName = `replay_${Date.now()}.json`;
        const filePath = path.join(replayDir, fileName);

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        const url = `${req.protocol}://${req.get("host")}/replays/${fileName}`;

        res.json({ success: true, url });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// Serve files publicly
app.use("/replays", express.static(replayDir));

app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
