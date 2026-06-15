import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Match NCWRC renderer colors
export const WRC_STYLES = {
  'Wild Trout Waters': { color: '#0070ff', weight: 2, dashArray: null },
  'Hatchery Supported Trout Waters': { color: '#00a884', weight: 2, dashArray: null },
  'Catch and Release/Artificial Flies and Lures Only Trout Waters': {
    color: '#fa3411',
    weight: 2,
    dashArray: null,
  },
  'Delayed Harvest Trout Waters': { color: '#222222', weight: 2.5, dashArray: '8 5' },
  'Special Regulation Trout Waters': { color: '#7b00d4', weight: 3.5, dashArray: null },
  'Hatchery Supported Trout Waters - CLOSED UNTIL FURTHER NOTICE DUE TO HURRICANE HELENE DAMAGE': {
    color: '#aaaaaa',
    weight: 2,
    dashArray: '4 4',
  },
  'Delayed Harvest Trout Waters - CLOSED UNTIL FURTHER NOTICE DUE TO HURRICANE HELENE DAMAGE': {
    color: '#aaaaaa',
    weight: 2,
    dashArray: '4 4',
  },
};

function getStyle(wrcClass) {
  return WRC_STYLES[wrcClass] ?? { color: '#999', weight: 1.5, dashArray: null };
}

function mFmt(m) {
  if (m === null || m === undefined) return '—';
  return `${Math.round(m)} m / ${Math.round(m * 3.281)} ft`;
}


function StreamLayer({ features }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    // Remove old layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!features.length) return;

    const geojson = { type: 'FeatureCollection', features };

    layerRef.current = L.geoJSON(geojson, {
      style: (f) => {
        const s = getStyle(f.properties.FIRST_WRC_);
        return {
          color: s.color,
          weight: s.weight,
          dashArray: s.dashArray,
          opacity: 0.85,
        };
      },
      onEachFeature: (f, layer) => {
        const p = f.properties;

        layer.bindPopup(
          `<div class="popup-content">
            <h4>${p.Displ_Name || 'Unnamed Stream'}</h4>
            <dl>
              <dt>Classification</dt><dd>${p.WRC_Class || p.FIRST_WRC_ || '—'}</dd>
              <dt>County</dt><dd>${p.FIRST_MHTW || '—'}</dd>
              <dt>Regulation</dt><dd>${p.FIRST_Reg_ || '—'}</dd>
              <dt>Midpoint Elevation</dt><dd>${mFmt(p._elev)}</dd>
            </dl>
          </div>`,
          { maxWidth: 280 }
        );

        const origStyle = getStyle(p.FIRST_WRC_);
        layer.on('mouseover', function () {
          this.setStyle({ weight: origStyle.weight + 2, opacity: 1 });
        });
        layer.on('mouseout', function () {
          layerRef.current?.resetStyle(this);
        });
      },
    }).addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [features, map]);

  return null;
}

export default function StreamMap({ features }) {
  return (
    <MapContainer
      center={[35.53, -82.95]}
      zoom={9}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://www.ncwildlife.org">NCWRC</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <StreamLayer features={features} />
    </MapContainer>
  );
}
