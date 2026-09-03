// Minimal backend connecting the ESP32 to the app.
// Run: npm init -y && npm install express cors
//      node server.js
// For real deployment, swap the in-memory `cows` object for a real
// database (Firestore, MongoDB, Postgres) so data survives a restart.

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = "YOUR_API_KEY"; // must match the ESP32 firmware's API_KEY

// In-memory store: { cow_id: { id, name, temp, lastUpdated } }
// Pre-seed with the cows your app already knows about.
const cows = {
  COW_001: { id: "COW_001", name: "Ganga", temp: 38.4, lastUpdated: Date.now() },
  COW_002: { id: "COW_002", name: "Lakshmi", temp: 39.8, lastUpdated: Date.now() },
  COW_003: { id: "COW_003", name: "Radha", temp: 38.6, lastUpdated: Date.now() },
  COW_004: { id: "COW_004", name: "Chandni", temp: 39.0, lastUpdated: Date.now() },
  COW_005: { id: "COW_005", name: "Kaveri", temp: 38.5, lastUpdated: Date.now() },
};

// --- ESP32 posts a new reading here ---
app.post("/api/sensor-data", (req, res) => {
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const { cow_id, temperature_c } = req.body;
  if (!cow_id || typeof temperature_c !== "number") {
    return res.status(400).json({ error: "cow_id and temperature_c are required" });
  }

  const existingName = cows[cow_id]?.name || cow_id;
  cows[cow_id] = {
    id: cow_id,
    name: existingName,
    temp: temperature_c,
    lastUpdated: Date.now(),
  };

  console.log(`Reading received: ${cow_id} -> ${temperature_c}°C`);
  res.status(201).json({ ok: true });
});

// --- App polls this to refresh the dashboard ---
app.get("/api/cows", (req, res) => {
  res.json(Object.values(cows));
});

// --- App calls this when the farmer taps "Add cow" ---
app.post("/api/cows", (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: "id and name are required" });
  if (cows[id]) return res.status(409).json({ error: "Cow ID already exists" });

  cows[id] = { id, name, temp: 38.5, lastUpdated: Date.now() };
  res.status(201).json(cows[id]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
