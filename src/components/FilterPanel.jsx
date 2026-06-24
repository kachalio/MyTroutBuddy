import { useEffect, useState } from 'react';
import { WRC_STYLES } from './StreamMap';

export const WRC_CLASSES = [
  { id: 'Wild Trout Waters', label: 'Wild Trout Waters' },
  { id: 'Hatchery Supported Trout Waters', label: 'Hatchery Supported' },
  {
    id: 'Catch and Release/Artificial Flies and Lures Only Trout Waters',
    label: 'Catch & Release / Artificial Only',
  },
  { id: 'Delayed Harvest Trout Waters', label: 'Delayed Harvest' },
  { id: 'Special Regulation Trout Waters', label: 'Special Regulation' },
  {
    id: 'Hatchery Supported Trout Waters - CLOSED UNTIL FURTHER NOTICE DUE TO HURRICANE HELENE DAMAGE',
    label: 'Hatchery Supported (Helene Closure)',
  },
  {
    id: 'Delayed Harvest Trout Waters - CLOSED UNTIL FURTHER NOTICE DUE TO HURRICANE HELENE DAMAGE',
    label: 'Delayed Harvest (Helene Closure)',
  },
];

function toFt(m) {
  return Math.round(m * 3.281);
}

function LegendSwatch({ wrcId }) {
  const s = WRC_STYLES[wrcId] ?? { color: '#999', weight: 2, dashArray: null };
  const dashArr = s.dashArray ?? '';
  return (
    <svg
      width="30"
      height="12"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <line
        x1="0"
        y1="6"
        x2="30"
        y2="6"
        stroke={s.color}
        strokeWidth={Math.min(s.weight, 3)}
        strokeDasharray={dashArr}
      />
    </svg>
  );
}

export default function FilterPanel({
  elevRange,
  elevFilter,
  onElevFilterChange,
  selectedClasses,
  onClassToggle,
  loading,
  visibleCount,
  totalCount,
}) {
  const [localMin, setLocalMin] = useState(elevFilter[0]);
  const [localMax, setLocalMax] = useState(elevFilter[1]);

  // Sync once real elevRange loads from API
  useEffect(() => {
    setLocalMin(elevRange[0]);
    setLocalMax(elevRange[1]);
  }, [elevRange[0], elevRange[1]]);

  function handleMinChange(e) {
    const val = Math.min(Number(e.target.value), localMax - 10);
    setLocalMin(val);
    onElevFilterChange([val, localMax]);
  }

  function handleMaxChange(e) {
    const val = Math.max(Number(e.target.value), localMin + 10);
    setLocalMax(val);
    onElevFilterChange([localMin, val]);
  }

  function selectAll() {
    WRC_CLASSES.forEach((c) => {
      if (!selectedClasses.has(c.id)) onClassToggle(c.id);
    });
  }

  function selectNone() {
    WRC_CLASSES.forEach((c) => {
      if (selectedClasses.has(c.id)) onClassToggle(c.id);
    });
  }

  return (
    <aside className="filter-panel">
      {/* ── Header ── */}
      <div className="filter-section">
        <h2>Filters</h2>
        <p className="count-text">
          {loading ? (
            <em>Loading…</em>
          ) : (
            <>
              Showing <strong>{visibleCount.toLocaleString()}</strong> of{' '}
              <strong>{totalCount.toLocaleString()}</strong> segments
            </>
          )}
        </p>
      </div>

      {/* ── Elevation ── */}
      <div className="filter-section">
        <h3>Elevation Filter</h3>
        <p className="hint" style={{ marginBottom: 10 }}>
          Segments are shown when their endpoint elevation range overlaps this filter (start→mid, mid→end). Data range:{' '}
          <strong>{elevRange[0]} m</strong> – <strong>{elevRange[1]} m</strong>
          &nbsp;({toFt(elevRange[0])} – {toFt(elevRange[1])} ft).
        </p>

        <div className="slider-group">
          <label className="slider-label">
            <span>
              Min &nbsp;<strong>{localMin} m</strong>&nbsp;
              <span className="ft">({toFt(localMin)} ft)</span>
            </span>
            <input
              type="range"
              className="range-input"
              min={elevRange[0]}
              max={elevRange[1]}
              step={10}
              value={localMin}
              onChange={handleMinChange}
            />
          </label>

          <label className="slider-label">
            <span>
              Max &nbsp;<strong>{localMax} m</strong>&nbsp;
              <span className="ft">({toFt(localMax)} ft)</span>
            </span>
            <input
              type="range"
              className="range-input"
              min={elevRange[0]}
              max={elevRange[1]}
              step={10}
              value={localMax}
              onChange={handleMaxChange}
            />
          </label>
        </div>
      </div>

      {/* ── Classification ── */}
      <div className="filter-section">
        <h3>Water Classification</h3>
        <div className="class-actions">
          <button className="btn-link" onClick={selectAll}>All</button>
          <span className="sep">·</span>
          <button className="btn-link" onClick={selectNone}>None</button>
        </div>
        <ul className="class-list">
          {WRC_CLASSES.map(({ id, label }) => (
            <li key={id} className="class-item">
              <label>
                <input
                  type="checkbox"
                  checked={selectedClasses.has(id)}
                  onChange={() => onClassToggle(id)}
                />
                <LegendSwatch wrcId={id} />
                {label}
              </label>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Source note ── */}
      <div className="filter-section source-note">
        <p>
          Source:{' '}
          <a
            href="https://www.ncwildlife.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            NCWRC
          </a>{' '}
          · 2025–2026 PMTW dataset.
          Boundaries are approximate.
        </p>
      </div>
    </aside>
  );
}
