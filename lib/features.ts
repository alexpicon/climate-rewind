/** A GeoJSON collection, typed just enough for what the map overlays draw. Coordinates are [lon, lat]. */
export interface Features {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }>;
}

export const NO_FEATURES: Features = { type: "FeatureCollection", features: [] };
