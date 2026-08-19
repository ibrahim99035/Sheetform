import { round, pctShare } from "./shared";

/**
 * Geography lens (تحليل جغرافي).
 *
 * Aggregates sales, units and distinct customers by city / region / country,
 * plus a marker list for a leaflet map when coordinates are present. A single
 * geo property (city, country, region, or lat/lng) is enough to activate it.
 * Pure and deterministic.
 */

export interface GeoLine {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  customer: string | null;
  amount: number;
  units: number;
}

export interface GeoBucket {
  label: string;
  value: number;
  share_pct: number | null;
  units: number;
  customers: number;
}

export interface GeoMarker {
  label: string;
  lat: number;
  lng: number;
  value: number;
  units: number;
}

export interface GeographyResult {
  cities: GeoBucket[];
  regions: GeoBucket[];
  countries: GeoBucket[];
  markers: GeoMarker[];
  totals: {
    revenue: number;
    units: number;
    customers: number;
  };
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

const FALLBACK = "? (no region)";

export function runGeography(lines: GeoLine[]): GeographyResult {
  const flags: GeographyResult["flags"] = [];

  const cityMap = new Map<string, { value: number; units: number; customers: Set<string> }>();
  const regionMap = new Map<string, { value: number; units: number; customers: Set<string> }>();
  const countryMap = new Map<string, { value: number; units: number; customers: Set<string> }>();
  const markerMap = new Map<string, { lat: number; lng: number; value: number; units: number }>();

  let revenue = 0;
  let units = 0;
  const allCustomers = new Set<string>();

  for (const l of lines) {
    revenue += l.amount;
    units += l.units;
    if (l.customer) allCustomers.add(l.customer);

    push(cityMap, l.city ?? FALLBACK, l.amount, l.units, l.customer);
    push(regionMap, l.region ?? FALLBACK, l.amount, l.units, l.customer);
    push(countryMap, l.country ?? FALLBACK, l.amount, l.units, l.customer);

    if (l.lat != null && l.lng != null && Number.isFinite(l.lat) && Number.isFinite(l.lng)) {
      const label = l.city ?? l.region ?? l.country ?? "marker";
      const m = markerMap.get(label) ?? { lat: l.lat, lng: l.lng, value: 0, units: 0 };
      m.value += l.amount;
      m.units += l.units;
      markerMap.set(label, m);
    }
  }

  const noGeo = lines.every((l) => l.city == null && l.region == null && l.country == null && (l.lat == null || l.lng == null));
  if (lines.length === 0) {
    flags.push({ level: "high", message: "No rows — the geography lens is empty." });
  } else if (noGeo) {
    flags.push({ level: "medium", message: "No city/region/country column found — geography is aggregated under an unknown bucket." });
  }
  if (markerMap.size === 0 && !noGeo) {
    flags.push({ level: "low", message: "No latitude/longitude columns — the map is not plotted; add coordinates for a leaflet layer." });
  }

  return {
    cities: bucketList(cityMap, revenue),
    regions: bucketList(regionMap, revenue),
    countries: bucketList(countryMap, revenue),
    markers: [...markerMap.entries()]
      .map(([label, m]) => ({ label, lat: m.lat, lng: m.lng, value: round(m.value), units: m.units }))
      .sort((a, b) => b.value - a.value),
    totals: { revenue: round(revenue), units, customers: allCustomers.size },
    flags,
  };
}

function push(
  map: Map<string, { value: number; units: number; customers: Set<string> }>,
  key: string,
  amount: number,
  lineUnits: number,
  customer: string | null,
): void {
  const cur = map.get(key) ?? { value: 0, units: 0, customers: new Set<string>() };
  cur.value += amount;
  cur.units += lineUnits;
  if (customer) cur.customers.add(customer);
  map.set(key, cur);
}

function bucketList(
  map: Map<string, { value: number; units: number; customers: Set<string> }>,
  total: number,
): GeoBucket[] {
  return [...map.entries()]
    .map(([label, v]) => ({
      label,
      value: round(v.value),
      share_pct: pctShare(v.value, total),
      units: v.units,
      customers: v.customers.size,
    }))
    .sort((a, b) => b.value - a.value);
}