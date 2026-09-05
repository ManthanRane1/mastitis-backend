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

const API_KEY = "mastitis2026secret"; // must match the ESP32 firmware's API_KEY

// In-memory store: { cow_id: { id, name, temp, ambientTemp, ambientHumidity, lastUpdated, history } }
const MAX_HISTORY = 20;

const cows = {
  COW_001: { id: "COW_001", name: "Ganga", temp: 38.4, ambientTemp: 28.5, ambientHumidity: 61, lastUpdated: Date.now(), history: [] },
  COW_002: { id: "COW_002", name: "Lakshmi", temp: 39.8, ambientTemp: 28.5, ambientHumidity: 61, lastUpdated: Date.now(), history: [] },
  COW_003: { id: "COW_003", name: "Radha", temp: 38.6, ambientTemp: 28.5, ambientHumidity: 61, lastUpdated: Date.now(), history: [] },
  COW_004: { id: "COW_004", name: "Chandni", temp: 39.0, ambientTemp: 28.5, ambientHumidity: 61, lastUpdated: Date.now(), history: [] },
  COW_005: { id: "COW_005", name: "Kaveri", temp: 38.5, ambientTemp: 28.5, ambientHumidity: 61, lastUpdated: Date.now(), history: [] },
};

// --- ESP32 posts a new reading here ---
app.post("/api/sensor-data", (req, res) => {
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const { cow_id, temperature_c, ambient_temp_c, ambient_humidity_pct } = req.body;
  if (!cow_id || typeof temperature_c !== "number") {
    return res.status(400).json({ error: "cow_id and temperature_c are required" });
  }

  const existing = cows[cow_id];
  const history = existing?.history || [];
  history.push({ temp: temperature_c, time: Date.now() });
  if (history.length > MAX_HISTORY) history.shift();

  cows[cow_id] = {
    id: cow_id,
    name: existing?.name || cow_id,
    temp: temperature_c,
    // Only overwrite ambient readings if this POST actually included them —
    // so a device without a DHT sensor doesn't wipe out the last known value.
    ambientTemp: ambient_temp_c ?? existing?.ambientTemp,
    ambientHumidity: ambient_humidity_pct ?? existing?.ambientHumidity,
    lastUpdated: Date.now(),
    history,
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

  cows[id] = { id, name, temp: 38.5, lastUpdated: Date.now(), history: [] };
  res.status(201).json(cows[id]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
