import { useState, useMemo, useEffect } from 'react';
import { useStreamData } from './hooks/useStreamData';
import StreamMap from './components/StreamMap';
import FilterPanel, { WRC_CLASSES } from './components/FilterPanel';
import './App.css';

const ALL_CLASSES = new Set(WRC_CLASSES.map((c) => c.id));

function splitGeometryIntoHalves(geometry) {
  if (!geometry) return { startGeom: null, endGeom: null };

  const isLine = geometry.type === 'LineString';
  const isMulti = geometry.type === 'MultiLineString';
  if (!isLine && !isMulti) return { startGeom: null, endGeom: null };

  const parts = (isLine ? [geometry.coordinates] : geometry.coordinates)
    .filter((part) => Array.isArray(part) && part.length > 0);

  const totalPoints = parts.reduce((sum, part) => sum + part.length, 0);
  if (totalPoints < 2) return { startGeom: null, endGeom: null };

  const midIdx = Math.floor(totalPoints / 2);
  const startParts = [];
  const endParts = [];

  let offset = 0;
  for (const part of parts) {
    const n = part.length;
    const partStart = offset;
    const partEnd = offset + n - 1;

    if (midIdx >= partStart) {
      const startToLocal = Math.min(n - 1, midIdx - partStart);
      const startSlice = part.slice(0, startToLocal + 1);
      if (startSlice.length >= 2) startParts.push(startSlice);
    }

    if (midIdx <= partEnd) {
      const endFromLocal = Math.max(0, midIdx - partStart);
      const endSlice = part.slice(endFromLocal);
      if (endSlice.length >= 2) endParts.push(endSlice);
    }

    offset += n;
  }

  const buildGeometry = (segmentParts) => {
    if (!segmentParts.length) return null;
    if (isLine && segmentParts.length === 1) {
      return { type: 'LineString', coordinates: segmentParts[0] };
    }
    return { type: 'MultiLineString', coordinates: segmentParts };
  };

  return {
    startGeom: buildGeometry(startParts),
    endGeom: buildGeometry(endParts),
  };
}

function segmentPassesFilter(a, b, min, max) {
  if (a === null || a === undefined || b === null || b === undefined) return true;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return high >= min && low <= max;
}

export default function App() {
  const { features, loading, loadingStage, error, elevRange, cacheProgress } = useStreamData();

  const [elevFilter, setElevFilter] = useState([0, 2000]);
  const [selectedClasses, setSelectedClasses] = useState(new Set(ALL_CLASSES));

  // Once the real elevation range loads, expand the filter to match
  useEffect(() => {
    setElevFilter(elevRange);
  }, [elevRange[0], elevRange[1]]);

  const filteredFeatures = useMemo(() => {
    const [minElev, maxElev] = elevFilter;

    return features.flatMap((f) => {
      const { FIRST_WRC_, _elev_start, _elev_mid, _elev_end } = f.properties;
      if (!selectedClasses.has(FIRST_WRC_)) return [];

      const { startGeom, endGeom } = splitGeometryIntoHalves(f.geometry);

      const out = [];

      if (startGeom && segmentPassesFilter(_elev_start, _elev_mid, minElev, maxElev)) {
        out.push({
          ...f,
          geometry: startGeom,
          properties: {
            ...f.properties,
            _segment_label: 'Start to Midpoint',
            _seg_elev_from: _elev_start,
            _seg_elev_to: _elev_mid,
          },
        });
      }

      if (endGeom && segmentPassesFilter(_elev_mid, _elev_end, minElev, maxElev)) {
        out.push({
          ...f,
          geometry: endGeom,
          properties: {
            ...f.properties,
            _segment_label: 'Midpoint to End',
            _seg_elev_from: _elev_mid,
            _seg_elev_to: _elev_end,
          },
        });
      }

      return out;
    });
  }, [features, elevFilter, selectedClasses]);

  const totalSegmentCount = useMemo(() => {
    return features.reduce((count, f) => {
      const { FIRST_WRC_ } = f.properties;
      if (!selectedClasses.has(FIRST_WRC_)) return count;

      const { startGeom, endGeom } = splitGeometryIntoHalves(f.geometry);
      const hasStartSegment = Boolean(startGeom);
      const hasEndSegment = Boolean(endGeom);
      return count + (hasStartSegment ? 1 : 0) + (hasEndSegment ? 1 : 0);
    }, 0);
  }, [features, selectedClasses]);

  function handleClassToggle(cls) {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>NC Public Mountain Trout Waters</h1>
        <span className="header-sub">Interactive elevation filter · 2025–2026 NCWRC data</span>
      </header>

      <div className="app-body">
        <FilterPanel
          elevRange={elevRange}
          elevFilter={elevFilter}
          onElevFilterChange={setElevFilter}
          selectedClasses={selectedClasses}
          onClassToggle={handleClassToggle}
          loading={loading}
          visibleCount={filteredFeatures.length}
          totalCount={totalSegmentCount}
          cacheProgress={cacheProgress}
        />

        <main className="map-wrapper">
          {loading && (
            <div className="overlay loading-overlay">
              <div className="spinner" />
              <p>
                {loadingStage === 'cache'
                  ? 'Loading cached elevations…'
                  : loadingStage === 'elevation'
                  ? 'Fetching elevations from Open-Meteo (this will take a while on first load)…'
                  : 'Fetching stream data from NCWRC…'}
              </p>
            </div>
          )}
          {error && (
            <div className="overlay error-overlay">
              <p>⚠ Could not load data: {error}</p>
            </div>
          )}
          <StreamMap features={filteredFeatures} />
        </main>
      </div>
    </div>
  );
}
