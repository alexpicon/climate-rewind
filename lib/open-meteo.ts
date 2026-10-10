/**
 * Open-Meteo's paid endpoints. With OPEN_METEO_API_KEY set (server only, in Vercel), an Open-Meteo URL goes to the customer host with the key;
 * without it, the free host is used unchanged. The key is never sent to the browser or shown in a notice.
 */
export function withOpenMeteoKey(url: string, key = process.env.OPEN_METEO_API_KEY): string {
  if (!key) return url;
  return url.replace(/^https:\/\/(archive-api|climate-api)\.open-meteo\.com\//, "https://customer-$1.open-meteo.com/") + `&apikey=${encodeURIComponent(key)}`;
}
