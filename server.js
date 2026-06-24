import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';




const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json({ limit: '50mb' }));
/**
 * POST /api/elevations
 * Proxies elevation requests to Open-Meteo with server-side throttling.
 * Body: { points: [[lon, lat], ...] }
 * Response: { elevations: [meters, ...] }
 */
app.post('/api/elevations', async (req, res) => {
  const { points } = req.body;
  if (!Array.isArray(points)) {
    return res.status(400).json({ error: 'points must be an array' });
  }

  try {
    const BATCH_SIZE = 100;
    const DELAY_MS = 1000; // 1 second between batches
    const LONG_PAUSE_MS = 10000; // 10 second pause every 5 batches
    const LONG_PAUSE_EVERY = 5;
    const results = new Array(points.length).fill(null);

    const batchCount = Math.ceil(points.length / BATCH_SIZE);
    for (let b = 0; b < batchCount; b++) {
      // Delay before batch
      if (b > 0) await sleep(DELAY_MS);
      
      // Long pause every N batches
      if (b > 0 && b % LONG_PAUSE_EVERY === 0) {
        console.log(`[Elevation] Batch ${b}/${batchCount}: pausing ${LONG_PAUSE_MS}ms...`);
        await sleep(LONG_PAUSE_MS);
      }

      const i = b * BATCH_SIZE;
      const slice = points.slice(i, i + BATCH_SIZE);
      const lats = slice.map(p => p[1]).join(',');
      const lons = slice.map(p => p[0]).join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

      console.log(`[Elevation] Batch ${b + 1}/${batchCount}...`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
      
      const json = await response.json();
      (json.elevation ?? []).forEach((e, j) => {
        results[i + j] = e;
      });
    }

    res.json({ elevations: results });
  } catch (error) {
    console.error('[Elevation] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(PORT, () => {
  console.log(`Elevation proxy server running on http://localhost:${PORT}`);
});
