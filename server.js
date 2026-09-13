/**
 * Dairy farm backend — server.js
 * ---------------------------------------------------------------
 * Endpoints:
 *   GET  /api/cows                -> list all cows + latest readings
 *   POST /api/cows                -> add a new cow  { id, name }
 *   POST /api/cows/:id/reading     -> ESP32 posts a new sensor reading
 *   POST /api/advisory             -> proxies farmer questions/photos to Gemini AI
 *
 * Setup:
 *   npm init -y
 *   npm install express cors dotenv @google/genai
 *   echo "GEMINI_API_KEY=AIzaSy..." > .env
 *   node server.js
 *
 * Environment Variable Required:
 *   GEMINI_API_KEY (Get from https://aistudio.google.com)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" })); // large enough for base64 photos

const PORT = process.env.PORT || 3000;

// Initialize Google Gen AI client
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

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
// body: { id?, name }
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
// body can include any subset of:
//   { temperature_c, ambient_temp_c, ambient_humidity_pct,
//     milk_conductivity_mscm, milk_yield_l, milk_ph }
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
// POST /api/advisory — proxies farmer questions/photos to Gemini
// body: { text, imageDataUrl?, lang, history: [{from, text}] }
// ---------------------------------------------------------------
app.post("/api/advisory", async (req, res) => {
  if (!process.env.GEMINI_API_KEY || !ai) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY is not configured on the server" });
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

  try {
    const contents = [];

    // Map conversation history
    for (const m of history.slice(-6)) {
      contents.push({
        role: m.from === "user" ? "user" : "model",
        parts: [{ text: m.text || "" }],
      });
    }

    // Build current turn parts
    const currentParts = [];

    if (imageDataUrl) {
      const mimeType = imageDataUrl.slice(5, imageDataUrl.indexOf(";")) || "image/jpeg";
      const base64Data = imageDataUrl.split(",")[1];
      currentParts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      });
    }

    currentParts.push({ text: text || "What do you see in this photo?" });

    contents.push({
      role: "user",
      parts: currentParts,
    });

    // Generate response via SDK
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstructionText,
      },
    });

    const reply = response.text || "Sorry, I couldn't generate a response.";
    res.json({ reply });

  } catch (err) {
    console.error("Gemini SDK error:", err);
    res.status(502).json({ error: "AI request failed", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dairy backend running on http://localhost:${PORT}`);
});
