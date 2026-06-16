import { useState, useMemo, useEffect } from 'react';
import { useStreamData } from './hooks/useStreamData';
import StreamMap from './components/StreamMap';
import FilterPanel, { WRC_CLASSES } from './components/FilterPanel';
import './App.css';

const ALL_CLASSES = new Set(WRC_CLASSES.map((c) => c.id));

export default function App() {
  const { features, loading, loadingStage, error, elevRange } = useStreamData();

  const [elevFilter, setElevFilter] = useState([0, 2000]);
  const [selectedClasses, setSelectedClasses] = useState(new Set(ALL_CLASSES));

  // Once the real elevation range loads, expand the filter to match
  useEffect(() => {
    setElevFilter(elevRange);
  }, [elevRange[0], elevRange[1]]);

  const filteredFeatures = useMemo(() => {
    return features.filter((f) => {
      const { _elev, FIRST_WRC_ } = f.properties;
      if (!selectedClasses.has(FIRST_WRC_)) return false;
      // If no elevation data, include the reach so it's never silently hidden
      if (_elev === null || _elev === undefined) return true;
      return _elev >= elevFilter[0] && _elev <= elevFilter[1];
    });
  }, [features, elevFilter, selectedClasses]);

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
          totalCount={features.length}
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
