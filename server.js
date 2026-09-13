/**
 * Dairy farm backend — server.js
 * ---------------------------------------------------------------
 * Endpoints:
 *   GET  /api/cows                -> list all cows + latest readings
 *   POST /api/cows                -> add a new cow  { id, name }
 *   POST /api/cows/:id/reading     -> ESP32 posts a new sensor reading
 *   POST /api/advisory             -> proxies farmer questions/photos to Gemini
 *
 * Setup:
 *   npm init -y
 *   npm install express cors dotenv
 *   echo "GEMINI_API_KEY=AIzaSy..." > .env
 *   node server.js
 *
 * Environment Variable Required:
 *   GEMINI_API_KEY (Get from https://aistudio.google.com)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" })); // large enough for base64 photos

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ---------------------------------------------------------------
// In-memory cow store
// ---------------------------------------------------------------
const cows = new Map([
  [
    "COW_001",
    {
      id: "COW_001",
      name: "Ganga",
      temperature_c: 38.4,
      ambient_temp_c: 28.5,
      ambient_humidity_pct: 61,
      milk_conductivity_mscm: 4.8, // normal: roughly 4.0-5.5 mS/cm
      milk_yield_l: 9.2,
      milk_ph: 6.6, // normal: roughly 6.4-6.8
      updated_at: Date.now(),
    },
  ],
  [
    "COW_002",
    {
      id: "COW_002",
      name: "Lakshmi",
      temperature_c: 39.8,
      ambient_temp_c: 28.5,
      ambient_humidity_pct: 61,
      milk_conductivity_mscm: 6.9, // elevated -> possible mastitis
      milk_yield_l: 5.1, // dropped -> possible mastitis
      milk_ph: 6.9, // elevated
      updated_at: Date.now(),
    },
  ],
  [
    "COW_003",
    {
      id: "COW_003",
      name: "Radha",
      temperature_c: 38.6,
      ambient_temp_c: 28.5,
      ambient_humidity_pct: 61,
      milk_conductivity_mscm: 5.0,
      milk_yield_l: 8.7,
      milk_ph: 6.5,
      updated_at: Date.now(),
    },
  ],
  [
    "COW_004",
    {
      id: "COW_004",
      name: "Chandni",
      temperature_c: 39.0,
      ambient_temp_c: 28.5,
      ambient_humidity_pct: 61,
      milk_conductivity_mscm: 5.4,
      milk_yield_l: 8.1,
      milk_ph: 6.6,
      updated_at: Date.now(),
    },
  ],
  [
    "COW_005",
    {
      id: "COW_005",
      name: "Kaveri",
      temperature_c: 38.5,
      ambient_temp_c: 28.5,
      ambient_humidity_pct: 61,
      milk_conductivity_mscm: 4.9,
      milk_yield_l: 9.0,
      milk_ph: 6.5,
      updated_at: Date.now(),
    },
  ],
]);

// ---------------------------------------------------------------
// GET /api/cows — the frontend polls this every 5s
// ---------------------------------------------------------------
app.get("/api/cows", (req, res) => {
  res.json(Array.from(cows.values()));
});

// ---------------------------------------------------------------
// POST /api/cows — add a new cow from the app's "Add cow" form
// ---------------------------------------------------------------
app.post("/api/cows", (req, res) => {
  const { id, name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const cowId = id || `COW_${String(cows.size + 1).padStart(3, "0")}`;
  if (cows.has(cowId)) {
    return res.status(409).json({ error: "cow id already exists" });
  }

  const cow = {
    id: cowId,
    name,
    temperature_c: 38.5,
    ambient_temp_c: 28.5,
    ambient_humidity_pct: 60,
    milk_conductivity_mscm: 4.8,
    milk_yield_l: 8.5,
    milk_ph: 6.6,
    updated_at: Date.now(),
  };
  cows.set(cowId, cow);
  res.status(201).json(cow);
});

// ---------------------------------------------------------------
// POST /api/cows/:id/reading — ESP32 / sensor gateway posts here
// ---------------------------------------------------------------
app.post("/api/cows/:id/reading", (req, res) => {
  const cow = cows.get(req.params.id);
  if (!cow) return res.status(404).json({ error: "unknown cow id" });

  const fields = [
    "temperature_c",
    "ambient_temp_c",
    "ambient_humidity_pct",
    "milk_conductivity_mscm",
    "milk_yield_l",
    "milk_ph",
  ];
  for (const f of fields) {
    if (req.body[f] !== undefined) cow[f] = Number(req.body[f]);
  }
  cow.updated_at = Date.now();
  res.json(cow);
});

// ---------------------------------------------------------------
// POST /api/advisory — proxies questions/photos to Gemini API
// body: { text, imageDataUrl?, lang, history: [{from, text}] }
// ---------------------------------------------------------------
app.post("/api/advisory", async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not set on the server" });
  }

  const { text, imageDataUrl, lang, history = [] } = req.body || {};
  const langName = { en: "English", hi: "Hindi", mr: "Marathi" }[lang] || "English";

  const systemInstructionText =
    `You are a friendly dairy farming and animal health assistant helping a ` +
    `smallholder dairy farmer in Maharashtra, India. Answer any question the ` +
    `farmer asks — about cow health, mastitis, feed, breeding, milk quality ` +
    `(conductivity, pH, yield), general farm management, or anything else. ` +
    `If a photo of an udder or cow is shared, look at it carefully and ` +
    `describe what you notice (swelling, redness, discharge, wounds, etc.) ` +
    `and what it might mean. Always make clear this is guidance only and a ` +
    `real veterinarian should examine the animal for any serious or ` +
    `worsening symptoms — but still give practical, specific advice first, ` +
    `not just a referral. Keep answers short (3-5 sentences), warm, and ` +
    `practical. Respond only in ${langName}.`;

  // Format prior conversation history into Gemini's contents format
  const contents = history.slice(-6).map((m) => ({
    role: m.from === "user" ? "user" : "model",
    parts: [{ text: m.text || "" }],
  }));

  // Build the current user message payload
  const currentParts = [];

  if (imageDataUrl) {
    const mimeType = imageDataUrl.slice(5, imageDataUrl.indexOf(";")) || "image/jpeg";
    const base64Data = imageDataUrl.split(",")[1];
    currentParts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64Data,
      },
    });
  }

  currentParts.push({ text: text || "What do you see in this photo?" });

  contents.push({
    role: "user",
    parts: currentParts,
  });

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstructionText }],
        },
        contents: contents,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Gemini API error:", response.status, errBody);
      return res.status(502).json({ error: "AI request failed" });
    }

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn't generate a response.";

    res.json({ reply });
  } catch (err) {
    console.error("Advisory proxy error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

app.listen(PORT, () => {
  console.log(`Dairy backend running on http://localhost:${PORT}`);
});
