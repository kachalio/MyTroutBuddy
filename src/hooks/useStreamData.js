import { useState, useEffect } from 'react';

const BASE_URL =
  'https://services1.arcgis.com/YfqBAUM5nWR3yhGP/arcgis/rest/services/PMTW_streams_2025/FeatureServer/0';

const ELEV_API = 'https://api.open-meteo.com/v1/elevation';
const ELEV_BATCH = 100;
const ELEV_DELAY_MS = 11000;
const ELEV_LONG_PAUSE_MS = 30000;
const ELEV_LONG_PAUSE_EVERY = 6;
const CACHE_KEY = 'pmtw_elevations_openmeteo_v3';

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
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    // v3 shape: { version: 3, entries: [...] }
    if (parsed && parsed.version === 3 && Array.isArray(parsed.entries)) {
      return parsed.entries;
    }

    // Legacy shape: plain array of entries.
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Persist elevation samples to localStorage (best-effort). */
function writeCache(elevations) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 3, entries: elevations }));
  } catch { /* quota / private-mode */ }
}

function createEmptyElevations(count) {
  return new Array(count)
    .fill(null)
    .map(() => ({ start: null, mid: null, end: null }));
}

function normalizeCache(cached, featureCount) {
  const normalized = createEmptyElevations(featureCount);
  if (!Array.isArray(cached)) return normalized;

  for (let i = 0; i < featureCount; i++) {
    const src = cached[i];
    if (!src || typeof src !== 'object') continue;
    normalized[i] = {
      start: src.start ?? null,
      mid: src.mid ?? null,
      end: src.end ?? null,
    };
  }
  return normalized;
}

/**
 * Batch-fetch elevations from Open-Meteo with throttling and exponential
 * back-off on 429 (up to 3 retries per batch).
 */
async function fetchElevations(points) {
  const results = new Array(points.length).fill(null);
  const retryDelays = [30000, 60000]; // 30s, 60s, 120s
  const batchCount = Math.ceil(points.length / ELEV_BATCH);
  let completedBatches = 0;
  let aborted = false;

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

    if (!res.ok) {
      aborted = true;
      console.warn(`Open-Meteo batch ${b + 1}/${batchCount} failed with HTTP ${res.status}. Keeping partial elevation cache.`);
      break;
    }

    const json = await res.json();
    (json.elevation ?? []).forEach((e, j) => {
      results[i + j] = e;
    });
    completedBatches += 1;
  }

  return { results, completedBatches, batchCount, aborted };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStreamData() {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('streams');
  const [error, setError] = useState(null);
  const [elevRange, setElevRange] = useState([0, 2000]);
  const [cacheProgress, setCacheProgress] = useState({
    cachedPoints: 0,
    totalPoints: 0,
    percent: 0,
  });

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

        // ── 2. Elevations — load cache and request only missing points ─────
        const cachedElevations = readCache();
        const allElevations = normalizeCache(cachedElevations, raw.length);

        const pointRequests = [];
        samples.forEach((sample, featureIdx) => {
          if (!sample) return;
          ['start', 'mid', 'end'].forEach((kind) => {
            const point = sample[kind];
            if (!point) return;
            if (allElevations[featureIdx][kind] !== null) return;
            pointRequests.push({ featureIdx, kind, point });
          });
        });

        const totalPoints = pointRequests.length + allElevations.reduce((count, entry) => {
          let filled = 0;
          if (entry.start !== null) filled += 1;
          if (entry.mid !== null) filled += 1;
          if (entry.end !== null) filled += 1;
          return count + filled;
        }, 0);

        const cachedPointsBeforeFetch = totalPoints - pointRequests.length;
        setCacheProgress({
          cachedPoints: cachedPointsBeforeFetch,
          totalPoints,
          percent: totalPoints === 0 ? 100 : Math.round((cachedPointsBeforeFetch / totalPoints) * 100),
        });

        if (pointRequests.length > 0) {
          setLoadingStage('elevation');
          const fetchResult = await fetchElevations(pointRequests.map((r) => r.point));
          if (cancelled) return;

          pointRequests.forEach(({ featureIdx, kind }, j) => {
            const elev = fetchResult.results[j];
            if (elev !== null && elev !== undefined) {
              allElevations[featureIdx][kind] = elev;
            }
          });

          const cachedPointsAfterFetch = allElevations.reduce((count, entry) => {
            let filled = 0;
            if (entry.start !== null) filled += 1;
            if (entry.mid !== null) filled += 1;
            if (entry.end !== null) filled += 1;
            return count + filled;
          }, 0);

          setCacheProgress({
            cachedPoints: cachedPointsAfterFetch,
            totalPoints,
            percent: totalPoints === 0 ? 100 : Math.round((cachedPointsAfterFetch / totalPoints) * 100),
          });

          writeCache(allElevations);

          if (fetchResult.aborted && !cancelled) {
            setError(
              `Elevation fetch rate-limited after ${fetchResult.completedBatches}/${fetchResult.batchCount} batches. Showing partial elevations and caching progress.`
            );
          }
        } else {
          setLoadingStage('cache');
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

  return { features, loading, loadingStage, error, elevRange, cacheProgress };
}
