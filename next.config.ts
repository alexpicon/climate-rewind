import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The API reads data/index/<ST>.json.gz, data/heat/<slug>.json and data/samples/<slug>.json at runtime by a
  // computed path, so tell the file tracer to ship them with the serverless functions.
  outputFileTracingIncludes: {
    // The page reads the AI test result, the damage map and (for the wording) the index at render time.
    "/": ["./data/ai-eval/**/*", "./data/damage/**/*", "./data/index/**/*"],
    "/api/lookup": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/damage/**/*", "./data/events/**/*", "./data/quiet-percentiles.json"],
    // The lookup in pieces (the page asks for each piece itself): the same files as the whole lookup.
    "/api/lookup/[part]": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/damage/**/*", "./data/events/**/*", "./data/quiet-percentiles.json"],
    // The story and plan maps read the zone outlines (data/events/<ST>/zones.json) and the flood and tornado index for the records' places.
    "/api/area-map": ["./data/events/**/zones.json", "./data/index/**/*"],
    "/api/heat/[slug]": ["./data/heat/**/*"],
    // The outlook and AI routes read the record for the sample addresses (and the AI routes do a whole lookup plus the damage map).
    "/api/outlook": ["./data/outlook-record/**/*"],
    "/api/brief": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/outlook-record/**/*", "./data/damage/**/*", "./data/events/**/*", "./data/quiet-percentiles.json"],
    "/api/ask": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/outlook-record/**/*", "./data/damage/**/*", "./data/events/**/*", "./data/quiet-percentiles.json"],
    // The area story reads only the events of the address's county and the zones over it.
    "/api/story": ["./data/events/**/*", "./data/samples/ai/**/*"],
    // The area replay reads the county's and zones' events, the zone outlines and the county-to-zone crosswalk.
    "/api/area-replay": ["./data/events/**/*"],
    // The climate view reads the precomputed sample projections and snapshots; the preparedness plan reads the area events, the index and the official guidance lines.
    "/api/future": ["./data/projections/**/*", "./data/samples/**/*"],
    "/api/ready": ["./data/events/**/*", "./data/index/**/*", "./data/samples/**/*", "./data/guidance/**/*"],
  },
};

export default nextConfig;
