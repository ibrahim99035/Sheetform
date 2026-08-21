"use client";

import { useEffect, useState } from "react";
import type { GeoMarker } from "@/lib/analysis/geography";

interface GeoMapProps {
  markers: GeoMarker[];
  height?: number;
}

function SvgFallback({ markers, height }: { markers: GeoMarker[]; height: number }) {
  const maxVal = Math.max(...markers.map((m) => m.value), 1);
  const padding = 20;
  const width = 400;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full rounded-lg border border-border bg-surface"
      style={{ height }}
    >
      <rect width={width} height={height} fill="none" />
      <text x={width / 2} y={16} textAnchor="middle" className="fill-muted text-[10px]">
        SVG fallback (tiles unavailable)
      </text>
      {markers.map((m, i) => {
        const x = padding + ((i / Math.max(markers.length - 1, 1)) * (width - 2 * padding));
        const y = height - padding - (m.value / maxVal) * (height - 2 * padding);
        const r = Math.max(4, Math.min(16, (m.value / maxVal) * 16));
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill="var(--color-brand, #1ba290)" opacity={0.7} />
            <text x={x} y={y - r - 4} textAnchor="middle" className="fill-foreground text-[8px]">
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LeafletMap({ markers, height }: { markers: GeoMarker[]; height: number }) {
  const [MapContainer, setMapContainer] = useState<typeof import("react-leaflet").MapContainer | null>(null);
  const [TileLayer, setTileLayer] = useState<typeof import("react-leaflet").TileLayer | null>(null);
  const [CircleMarker, setCircleMarker] = useState<typeof import("react-leaflet").CircleMarker | null>(null);
  const [Popup, setPopup] = useState<typeof import("react-leaflet").Popup | null>(null);
  const [tileFailed, setTileFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // Leaflet sets fill/stroke as SVG attributes, which cannot resolve CSS
  // variables — read the resolved brand color once at mount instead.
  // Safe in the initializer: this component is dynamically imported with
  // ssr:false, so it only ever runs in the browser.
  const [brandColor] = useState(() => {
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue("--brand")
      .trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(resolved) ? resolved : "#1ba290";
  });

  useEffect(() => {
    Promise.all([
      import("react-leaflet"),
      import("leaflet/dist/leaflet.css"),
    ]).then(([rl]) => {
      setMapContainer(() => rl.MapContainer);
      setTileLayer(() => rl.TileLayer);
      setCircleMarker(() => rl.CircleMarker);
      setPopup(() => rl.Popup);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const img = new Image();
    img.onload = () => setTileFailed(false);
    img.onerror = () => setTileFailed(true);
    img.src = "https://tile.openstreetmap.org/0/0/0.png";
  }, [ready]);

  if (!ready || !MapContainer || !TileLayer || !CircleMarker || !Popup) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted"
        style={{ height }}
      >
        Loading map…
      </div>
    );
  }

  if (tileFailed) {
    return <SvgFallback markers={markers} height={height} />;
  }

  const maxVal = Math.max(...markers.map((m) => m.value), 1);
  const center: [number, number] = [markers[0].lat, markers[0].lng];
  const MC = MapContainer as React.ComponentType<React.ComponentProps<typeof MapContainer>>;
  const TL = TileLayer as React.ComponentType<React.ComponentProps<typeof TileLayer>>;
  const CM = CircleMarker as React.ComponentType<React.ComponentProps<typeof CircleMarker>>;
  const PP = Popup as React.ComponentType<React.ComponentProps<typeof Popup>>;

  return (
    <MC
      center={center}
      zoom={markers.length === 1 ? 10 : 5}
      className="w-full rounded-lg border border-border"
      style={{ height }}
      scrollWheelZoom={false}
    >
      <TL
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markers.map((m, i) => (
        <CM
          key={i}
          center={[m.lat, m.lng]}
          radius={Math.max(4, Math.min(20, (m.value / maxVal) * 20))}
          pathOptions={{ color: brandColor, fillColor: brandColor, fillOpacity: 0.6 }}
        >
          <PP>
            <div className="text-sm">
              <p className="font-semibold">{m.label}</p>
              <p>Revenue: {m.value.toLocaleString()}</p>
              <p>Units: {m.units.toLocaleString()}</p>
            </div>
          </PP>
        </CM>
      ))}
    </MC>
  );
}

export function GeoMap({ markers, height = 320 }: GeoMapProps) {
  if (markers.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-surface text-sm text-muted"
        style={{ height }}
      >
        No coordinates to plot.
      </div>
    );
  }

  return <LeafletMap markers={markers} height={height} />;
}
