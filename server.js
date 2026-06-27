// server.js
//
// Receives report payloads from the Roblox game, saves them, forwards a
// copy to Discord as a file attachment (Discord messages are capped at
// ~2000 characters, so the JSON always goes as an attachment, never inline),
// and exposes the saved reports back out so the 3D viewer can load them
// either by file upload or by fetching /report/:id directly.
//
// Required environment variable (set this in Render's dashboard, NOT in code):
//   DISCORD_WEBHOOK_URL = https://discord.com/api/webhooks/...
//
// Node 18+ is assumed (Render's default Node images are 18+), which means
// fetch / FormData / Blob are all available globally — no extra HTTP deps.

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const REPORTS_DIR = path.join(__dirname, "reports");

// Render's filesystem is ephemeral (wiped on redeploy/restart), so this
// local store is a best-effort cache for convenience during a session —
// the durable copy of every report is the file attached to the Discord
// message. For long-term storage, swap this for S3 / a database.
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

app.use(express.json({ limit: "15mb" }));

// Allow the standalone viewer.html (opened from anywhere - disk, GitHub
// Pages, wherever) to fetch reports from this server in the browser.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => {
  res.json({ ok: true, service: "roblox-report-system" });
});

app.post("/report", async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.players)) {
      return res.status(400).json({ ok: false, error: "Malformed report payload." });
    }

    const reportId = crypto.randomUUID();
    const filename = `report-${reportId}.json`;
    const enriched = {
      reportId,
      receivedAt: new Date().toISOString(),
      ...payload,
    };

    fs.writeFileSync(
      path.join(REPORTS_DIR, filename),
      JSON.stringify(enriched, null, 2)
    );

    let discordResult = null;
    if (DISCORD_WEBHOOK_URL) {
      discordResult = await postToDiscord(enriched, filename);
    } else {
      console.warn("DISCORD_WEBHOOK_URL is not set — skipping Discord delivery.");
    }

    res.json({
      ok: true,
      reportId,
      viewUrl: `/report/${reportId}`,
      discordDelivered: Boolean(discordResult),
    });
  } catch (err) {
    console.error("Error handling /report:", err);
    res.status(500).json({ ok: false, error: "Internal error processing report." });
  }
});

app.get("/report/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ ok: false, error: "Invalid report id." });
  }
  const filePath = path.join(REPORTS_DIR, `report-${id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "Report not found (it may have expired)." });
  }
  res.sendFile(filePath);
});

// Resend a report that's already on disk — useful after a Discord/Cloudflare
// delivery failure (see postToDiscord below) once the block has cleared.
// Doesn't require Roblox to resubmit anything.
app.post("/report/:id/redeliver", async (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ ok: false, error: "Invalid report id." });
  }
  const filename = `report-${id}.json`;
  const filePath = path.join(REPORTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "Report not found (it may have expired)." });
  }
  if (!DISCORD_WEBHOOK_URL) {
    return res.status(400).json({ ok: false, error: "DISCORD_WEBHOOK_URL is not set." });
  }

  const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const result = await postToDiscord(report, filename);
  res.json({ ok: Boolean(result), discordDelivered: Boolean(result) });
});

app.listen(PORT, () => {
  console.log(`Report server listening on port ${PORT}`);
});

// ---------------------------------------------------------------------
// Discord delivery
//
// Two distinct failure modes show up as the same HTTP 429 status, and they
// need opposite responses:
//
//  1. Discord's own per-webhook rate limit — comes back as a small JSON
//     body with a `retry_after` field. Safe to wait that long and retry once.
//  2. A Cloudflare "Error 1015" IP-level ban in front of discord.com — comes
//     back as an HTML page, not JSON. Retrying soon makes the block last
//     LONGER, per Cloudflare's own guidance. We do not retry this — we log
//     it clearly and leave the report saved on disk so it can be sent later
//     via POST /report/:id/redeliver once the ban has cleared.
//
// A minimum gap is also enforced between any two outgoing Discord requests,
// so this server doesn't contribute to triggering either kind of limit.
// ---------------------------------------------------------------------

const MIN_GAP_MS = 2000;
let lastDiscordPostAt = 0;

async function waitForDiscordSlot() {
  const elapsed = Date.now() - lastDiscordPostAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastDiscordPostAt = Date.now();
}

async function postToDiscord(report, filename, attempt = 1) {
  const reporterName = report.reporter?.name ?? "Unknown";
  const targetName = report.target?.name ?? "—";
  const playerCount = report.players?.length ?? 0;
  const duration = report.historySeconds ?? "?";
  const rate = report.sampleRate ?? "?";

  const embed = {
    title: "New player report",
    color: 0xc23b3b,
    fields: [
      { name: "Reporter", value: reporterName, inline: true },
      { name: "Target", value: targetName, inline: true },
      { name: "Players in scene", value: String(playerCount), inline: true },
      { name: "Window", value: `${duration}s @ ${rate}Hz`, inline: true },
      { name: "Place / Job", value: `${report.placeId ?? "?"} / ${report.jobId ?? "?"}`, inline: false },
    ],
    description: report.reason ? truncate(report.reason, 500) : undefined,
    timestamp: new Date().toISOString(),
    footer: { text: `Report ID: ${report.reportId}` },
  };

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ embeds: [embed] }));
  form.append(
    "files[0]",
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    filename
  );

  await waitForDiscordSlot();

  const response = await fetch(`${DISCORD_WEBHOOK_URL}?wait=true`, {
    method: "POST",
    body: form,
    headers: {
      "User-Agent": "RobloxReportSystem/1.0 (incident report relay)",
    },
  });

  if (response.ok) {
    return response.json();
  }

  const contentType = response.headers.get("content-type") || "";
  const isDiscordJsonError = contentType.includes("application/json");

  if (response.status === 429 && isDiscordJsonError && attempt < 2) {
    const data = await response.json().catch(() => ({}));
    const retryAfterMs = Math.min(Math.max((data.retry_after ?? 1) * 1000, 250), 10_000);
    console.warn(`Discord per-webhook rate limit hit — retrying once in ${retryAfterMs}ms.`);
    await new Promise((r) => setTimeout(r, retryAfterMs));
    return postToDiscord(report, filename, attempt + 1);
  }

  if (response.status === 429 && !isDiscordJsonError) {
    console.error(
      `[report ${report.reportId}] Discord delivery blocked by Cloudflare (HTTP 429, ` +
      `error 1015) — this is an IP-level ban on this server, not Discord's per-webhook ` +
      `rate limit. NOT retrying now, since retrying during the block window can extend ` +
      `it. The report is saved on disk; once the ban clears, resend it with ` +
      `POST /report/${report.reportId}/redeliver.`
    );
    return null;
  }

  const text = await response.text().catch(() => "");
  console.error("Discord webhook failed:", response.status, text.slice(0, 300));
  return null;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}
