import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // No test reads the shipped sample snapshots by accident (they would stand in for the faked Open-Meteo); tests that want them name the folder.
    env: {
      MEMORIA_SAMPLES_DIR: path.resolve(import.meta.dirname, "tests", "no-samples"),
      // Same for the outlook records and the damage map: tests that want them name the folder.
      MEMORIA_OUTLOOK_RECORD_DIR: path.resolve(import.meta.dirname, "tests", "no-samples"),
      MEMORIA_DAMAGE_DIR: path.resolve(import.meta.dirname, "tests", "no-samples"),
      // And the area events and the state percentiles (tests that want them name the folder or file).
      MEMORIA_EVENTS_DIR: path.resolve(import.meta.dirname, "tests", "no-samples"),
      // And the AI answers made ahead of time for the samples.
      MEMORIA_SAMPLE_AI_DIR: path.resolve(import.meta.dirname, "tests", "no-samples", "ai"),
      MEMORIA_QUIET_FILE: path.resolve(import.meta.dirname, "tests", "no-samples", "quiet-percentiles.json"),
    },
  },
});
