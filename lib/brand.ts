/**
 * The product name, in ONE place. Renaming the product is a one-line change here (APP_NAME); the slug and tagline follow.
 * Safe to import from client and server code (no server modules).
 *
 * Not renamed by this file: the folder, the package name in package.json, the README title and the CSS comments. Those are
 * developer-facing; the title bar, top bar, landing page, document titles, noscript text, API user agent and AI prompts read from here.
 */
export const APP_NAME = "Climate Rewind";

/** Lowercase, URL- and header-safe form of the name ("climate-rewind"). */
export const APP_SLUG = APP_NAME.toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

/** The line under the name in the page title. */
export const APP_TAGLINE = "what the weather did to your street";

/** "Climate Rewind: what the weather did to your street" */
export const APP_TITLE = `${APP_NAME}: ${APP_TAGLINE}`;

/** How we identify ourselves to outside APIs that ask (api.weather.gov wants this). */
export const APP_USER_AGENT = `${APP_SLUG}/0.1 (ForgeHacks 2026 project)`;

/** "Look | Climate Rewind" for the browser tab. */
export const pageTitle = (...parts: string[]): string => [...parts, APP_NAME].join(" | ");
