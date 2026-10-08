/** Place names drawn over the regional heat grids (central and eastern US, and the Pacific Northwest for Bellevue), so the squares have context. */

/** [name, lat, lon, flag]: "cl" puts the label left of the dot, "nodot" drops the dot (the address marker is there). */
export type City = readonly [name: string, lat: number, lon: number, flag?: "cl" | "nodot"];

export const CITIES: readonly City[] = [
  ["Minneapolis", 44.98, -93.27], ["Milwaukee", 43.04, -87.91, "cl"], ["Detroit", 42.33, -83.05], ["Boston", 42.36, -71.06], ["New York", 40.71, -74.0, "cl"],
  ["Omaha", 41.26, -95.93], ["Chicago", 41.878, -87.63, "cl"], ["Cleveland", 41.5, -81.69], ["Philadelphia", 39.95, -75.17, "cl"], ["Washington", 38.9, -77.04, "cl"],
  ["Kansas City", 39.1, -94.58], ["Indianapolis", 39.768, -86.158], ["Columbus", 39.961, -82.999], ["Pittsburgh", 40.44, -80.0], ["St. Louis", 38.627, -90.199],
  ["Cincinnati", 39.103, -84.512, "cl"], ["Louisville", 38.253, -85.759], ["Wichita", 37.69, -97.34], ["Tulsa", 36.15, -95.99], ["Oklahoma City", 35.47, -97.52],
  ["Memphis", 35.15, -90.049], ["Nashville", 36.163, -86.782, "nodot"], ["Knoxville", 35.961, -83.921], ["Raleigh", 35.78, -78.64], ["Charlotte", 35.227, -80.843, "cl"],
  ["Little Rock", 34.747, -92.29, "cl"], ["Dallas", 32.78, -96.8], ["Birmingham", 33.519, -86.81, "cl"], ["Atlanta", 33.749, -84.388], ["Jackson", 32.299, -90.185, "cl"],
  ["Montgomery", 32.377, -86.3], ["Houston", 29.76, -95.37], ["New Orleans", 29.95, -90.07], ["Jacksonville", 30.33, -81.66], ["Tampa", 27.95, -82.46], ["Miami", 25.76, -80.19],
  ["Seattle", 47.606, -122.332, "cl"], ["Vancouver, B.C.", 49.283, -123.121, "cl"], ["Portland", 45.52, -122.68, "cl"], ["Eugene", 44.05, -123.09, "cl"], ["Spokane", 47.66, -117.43], ["Boise", 43.615, -116.2],
  ["Yakima", 46.6, -120.5], ["Bend", 44.06, -121.31],
];

export type StateLabel = readonly [name: string, lat: number, lon: number];

export const STATE_LABELS: readonly StateLabel[] = [
  ["MINNESOTA", 45.9, -94.6], ["WISCONSIN", 44.6, -90.0], ["MICHIGAN", 43.9, -84.7], ["NEW YORK", 42.9, -75.9], ["IOWA", 42.0, -93.4], ["NEBRASKA", 41.5, -99.6],
  ["PENNSYLVANIA", 41.0, -77.8], ["ILLINOIS", 40.0, -89.2], ["OHIO", 40.3, -82.8], ["INDIANA", 40.5, -86.3], ["MISSOURI", 38.4, -92.6], ["KANSAS", 38.5, -98.4],
  ["KENTUCKY", 37.5, -85.3], ["VIRGINIA", 37.5, -79.3], ["OKLAHOMA", 35.6, -98.3], ["ARKANSAS", 35.7, -92.6], ["TENNESSEE", 35.65, -88.7], ["N. CAROLINA", 36.35, -79.9],
  ["TEXAS", 31.4, -99.2], ["MISSISSIPPI", 32.8, -89.7], ["ALABAMA", 32.8, -86.8], ["GEORGIA", 32.7, -83.4], ["S. CAROLINA", 33.9, -80.9], ["LOUISIANA", 31.0, -92.2],
  ["FLORIDA", 28.6, -81.8], ["W. VA.", 38.6, -80.7],
  ["WASHINGTON", 47.4, -120.4], ["OREGON", 43.9, -120.6], ["IDAHO", 44.4, -115.2],
];

/** Farther than this (in degrees) from every listed city, we give coordinates rather than a misleading name. */
const NEAR_DEGREES = 2.5;

/** "25.0°N, 99.0°W" */
function coordinateText(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

/**
 * Nearest listed city to a point, for sentences like "the hottest square is near Memphis".
 * Far from every listed city (northern Mexico, the open Gulf), it says where the square is instead.
 */
export function nearestCity(lat: number, lon: number): string {
  let best = CITIES[0][0];
  let bestDistance = Infinity;
  for (const [name, cityLat, cityLon] of CITIES) {
    const distance = Math.hypot(lat - cityLat, (lon - cityLon) * 0.8);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return bestDistance <= NEAR_DEGREES ? best : coordinateText(lat, lon);
}
