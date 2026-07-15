// 02_geo-utils.js — Generic geo math helpers, highway-name normalization, camera list loading
// Part of the MD Traffic app; loaded as a classic (non-module) script so it
// shares top-level `let`/`const` scope with the other js/*.js files.

// ---------- Geo helpers ----------
function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function bearingToCompassLabel(bearing) {
  // Map to the 4 cardinal "of travel" labels most state DOT feeds use.
  if (bearing >= 315 || bearing < 45) return 'Northbound';
  if (bearing >= 45 && bearing < 135) return 'Eastbound';
  if (bearing >= 135 && bearing < 225) return 'Southbound';
  return 'Westbound';
}

// ---------- Highway name normalization ----------
function formatDistance(meters) {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

function normalizeHighwayName(raw) {
  if (!raw) return null;
  const s = raw.toUpperCase().trim();
  // Interstate: "I-40", "I 40", "Interstate 40"
  let m = s.match(/\bI[-\s]?(\d+)\b/) || s.match(/INTERSTATE\s+(\d+)/);
  if (m) return `I-${m[1]}`;
  // US Highway: "US-50", "US 50", "US Highway 50"
  m = s.match(/\bUS[-\s]?(\d+)\b/);
  if (m) return `US-${m[1]}`;
  // MD Highway: "MD-200", "MD 200"
  m = s.match(/\bMD[-\s]?(\d+)\b/);
  if (m) return `MD-${m[1]}`;
  // No route-number pattern matched (e.g. "Wade Avenue") — fall back to
  // the literal name, uppercased/trimmed so CHART's "route" field and
  // OSM's "name" tag compare equal as long as they're spelled the same way.
  return s;
}

// ---------- Load static camera list ----------
// CHART's export endpoint wraps its array as {"data": [...]}, with
// separate routePrefix/routeNumber/routeSuffix fields (much cleaner than
// VA's single combined string) — normalize here so every other file
// (03_highway.js, 05_cameras.js) can stay unchanged and just deal with
// { id, lat, lon, roadway, direction, location, videoUrl }.
//
// IMPORTANT CAVEAT: publicVideoURL points at an HTML wrapper page
// (chart.maryland.gov/Video/GetVideo/{id}), not a raw stream — same issue
// VA's GetVideo pages had initially. The actual stream format (HLS/m3u8 vs
// something else) hasn't been confirmed yet, so video playback in
// 05_cameras.js almost certainly needs adjusting once that's known. See
// the project handoff notes for how to find it (DevTools Network tab
// while a camera is actually playing on the real CHART site).
const MD_ROUTE_PREFIX_MAP = { IS: 'I', US: 'US', MD: 'MD' };

async function loadCameras() {
  const resp = await fetch(CAMERAS_URL);
  const json = await resp.json();
  const records = json.data || [];

  allCameras = records
    .filter(c => c.opStatus !== 'HARDWARE_FAILURE') // keep COMM_FAILURE/MARGINAL — those often still load, just flaky; hardware failure never will
    .map(c => {
      const lat = Number(c.lat);
      const lon = Number(c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const prefix = MD_ROUTE_PREFIX_MAP[String(c.routePrefix || '').toUpperCase()];
      const roadway = (prefix && c.routeNumber) ? `${prefix}-${c.routeNumber}` : '';
      return {
        id: c.id,
        lat, lon,
        roadway,
        direction: '', // CHART's camera feed doesn't include a direction field
        location: c.description || c.name || '',
        videoUrl: c.publicVideoURL, // NOT yet confirmed to be a direct stream URL — see caveat above
      };
    })
    .filter(c => c !== null);

  console.log(`Loaded ${allCameras.length} MD cameras.`);
}
