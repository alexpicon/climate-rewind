import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The API reads data/index/<ST>.json.gz, data/heat/<slug>.json and data/samples/<slug>.json at runtime by a
  // computed path, so tell the file tracer to ship them with the serverless functions.
  outputFileTracingIncludes: {
    // The page reads the AI test result, the damage map and (for the wording) the index at render time.
    "/": ["./data/ai-eval/**/*", "./data/damage/**/*", "./data/index/**/*"],
    "/api/lookup": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/damage/**/*"],
    "/api/heat/[slug]": ["./data/heat/**/*"],
    // The outlook and AI routes read the record for the sample addresses (and the AI routes do a whole lookup plus the damage map).
    "/api/outlook": ["./data/outlook-record/**/*"],
    "/api/brief": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/outlook-record/**/*", "./data/damage/**/*"],
    "/api/ask": ["./data/index/**/*", "./data/heat/**/*", "./data/samples/**/*", "./data/outlook-record/**/*", "./data/damage/**/*"],
  },
};

export default nextConfig;
