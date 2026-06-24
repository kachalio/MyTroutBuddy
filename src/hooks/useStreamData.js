import { useState, useEffect } from 'react';

const BASE_URL =
  'https://services1.arcgis.com/YfqBAUM5nWR3yhGP/arcgis/rest/services/PMTW_streams_2025/FeatureServer/0';

const ELEV_API = 'https://api.open-meteo.com/v1/elevation';
const ELEV_BATCH = 100;
const ELEV_DELAY_MS = 11000;
const ELEV_LONG_PAUSE_MS = 30000;
const ELEV_LONG_PAUSE_EVERY = 6;
const CACHE_KEY = 'pmtw_elevations_openmeteo_v2';

// Open-Meteo API LIMITS: 
//  10,000 calls per day
//  5,000 calls per hour
//  600 per minute

// Module-level lock: prevents concurrent fetches
let fetchInProgress = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Return sampled [lon, lat] points for start/mid/end of a stream geometry. */
function samplePoints(geometry) {
  if (!geometry) return null;
  const { type, coordinates } = geometry;
  let coords;
  if (type === 'LineString') {
    coords = coordinates;
  } else if (type === 'MultiLineString') {
    coords = coordinates.flat();
  } else {
    return null;
  }
  if (!coords.length) return null;

  const start = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const end = coords[coords.length - 1];

  return {
    start: start ? [start[0], start[1]] : null,
    mid: mid ? [mid[0], mid[1]] : null,
    end: end ? [end[0], end[1]] : null,
  };
}

/** Read cached elevation samples from localStorage. Returns null on miss. */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist elevation samples to localStorage (best-effort). */
function writeCache(elevations) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(elevations));
  } catch { /* quota / private-mode */ }
}

/**
 * Batch-fetch elevations from Open-Meteo with throttling and exponential
 * back-off on 429 (up to 3 retries per batch).
 */
async function fetchElevations(points) {
  const results = new Array(points.length).fill(null);
  const retryDelays = [30000, 60000]; // 30s, 60s, 120s
  const batchCount = Math.ceil(points.length / ELEV_BATCH);

  for (let b = 0; b < batchCount; b++) {
    if (b > 0) await sleep(ELEV_DELAY_MS);
    console.log("Pausing before batch", b, "of", batchCount, "for "+ ELEV_DELAY_MS + "ms");
    if (b > 0 && b % ELEV_LONG_PAUSE_EVERY === 0) {
      console.log("Long pause before batch", b, "of", batchCount, "for "+ ELEV_LONG_PAUSE_MS + "ms");
      await sleep(ELEV_LONG_PAUSE_MS);
    }

    const i = b * ELEV_BATCH;
    const slice = points.slice(i, i + ELEV_BATCH);
    const lats = slice.map((p) => p[1]).join(',');
    const lons = slice.map((p) => p[0]).join(',');
    const url = `${ELEV_API}?latitude=${lats}&longitude=${lons}`;

    let res;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      res = await fetch(url);
      if (res.status !== 429) break;
      if (attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]);
        console.log("sleeping before retrying batch", b, "attempt", attempt + 1);
      }
    }

    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    (json.elevation ?? []).forEach((e, j) => {
      results[i + j] = e;
    });
  }

  return results;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStreamData() {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('streams');
  const [error, setError] = useState(null);
  const [elevRange, setElevRange] = useState([0, 2000]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      if (fetchInProgress) return;
      fetchInProgress = true;
      try {
        // ── 1. Stream geometries + attributes ─────────────────────────────
        setLoadingStage('streams');
        const params = new URLSearchParams({
          where: '1=1',
          outFields: 'Displ_Name,FIRST_WRC_,WRC_Class,FIRST_Reg_,FIRST_Reg1,FIRST_MHTW',
          outSR: '4326',
          f: 'geojson',
           resultRecordCount: '2000', // fetch all (NCWRC limit is 10k)
        });

        const res = await fetch(`${BASE_URL}/query?${params}`);
        if (!res.ok) throw new Error(`Stream API HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        const raw = data.features || [];
        // Using this Line below for testing //
        // const raw = data.features.slice(0, 2000) || [];
        console.log('Fetched stream features:', raw.length);
        const samples = raw.map((f) => samplePoints(f.geometry));

        // ── 2. Elevations — cache first, then Open-Meteo ───────────────────
        let allElevations = readCache();

        const hasValidCache =
          Array.isArray(allElevations) &&
          allElevations.length === raw.length &&
          allElevations.every(
            (entry) =>
              entry &&
              Object.prototype.hasOwnProperty.call(entry, 'start') &&
              Object.prototype.hasOwnProperty.call(entry, 'mid') &&
              Object.prototype.hasOwnProperty.call(entry, 'end')
          );

        if (hasValidCache) {
          setLoadingStage('cache');
        } else {
          setLoadingStage('elevation');

          const pointRequests = [];
          samples.forEach((sample, featureIdx) => {
            if (!sample) return;
            ['start', 'mid', 'end'].forEach((kind) => {
              const point = sample[kind];
              if (!point) return;
              pointRequests.push({ featureIdx, kind, point });
            });
          });

          const fetched = await fetchElevations(pointRequests.map((r) => r.point));
          if (cancelled) return;

          allElevations = new Array(raw.length)
            .fill(null)
            .map(() => ({ start: null, mid: null, end: null }));

          pointRequests.forEach(({ featureIdx, kind }, j) => {
            allElevations[featureIdx][kind] = fetched[j] ?? null;
          });

          writeCache(allElevations);
        }

        // ── 3. Merge elevations onto features ──────────────────────────────
        let globalMin = Infinity;
        let globalMax = -Infinity;

        const enriched = raw.map((f, i) => {
          const elevSample = allElevations[i] ?? { start: null, mid: null, end: null };
          const elevMid = elevSample.mid ?? null;

          if (elevMid !== null) {
            if (elevMid < globalMin) globalMin = elevMid;
            if (elevMid > globalMax) globalMax = elevMid;
          }

          return {
            ...f,
            properties: {
              ...f.properties,
              _elev: elevMid,
              _elev_start: elevSample.start,
              _elev_mid: elevMid,
              _elev_end: elevSample.end,
            },
          };
        });

        if (!cancelled) {
          setFeatures(enriched);
          setElevRange([
            Math.floor(globalMin === Infinity ? 0 : globalMin),
            Math.ceil(globalMax === -Infinity ? 2000 : globalMax),
          ]);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        fetchInProgress = false;
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  return { features, loading, loadingStage, error, elevRange };
}
