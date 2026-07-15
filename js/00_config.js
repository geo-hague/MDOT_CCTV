// 00_config.js — Configuration constants (Overpass, camera feed, DMS, tuning params)
// Part of the MD Traffic app; loaded as a classic (non-module) script so it
// shares top-level `let`/`const` scope with the other js/*.js files.

// ---------- Config ----------
// CHART's own export endpoint is unauthenticated but doesn't send CORS
// headers for third-party origins (it's meant for CHART's own map page on
// its own domain) — confirmed by a live "NetworkError" fetching it
// directly from a GitHub Pages origin. Routed through a tiny CORS-only
// proxy instead (no secret involved, unlike VA's DMS worker — see
// md-proxy-worker/README.md for deploy steps). Point this at your
// deployed worker's /cameras path once it's live.
const CAMERAS_URL = 'https://mdotdms.m-c-hunt429.workers.dev/cameras';
const MIN_DISPLACEMENT_M = 40;     // min movement before recomputing bearing
const BEARING_DISAGREE_DEG = 45;   // how much new bearing must differ to challenge current direction
const BEARING_CONFIRM_COUNT = 2;   // consecutive disagreeing samples needed to flip direction
const HIGHWAY_RECHECK_MS = 6000;   // re-run highway snap at most this often (base rate — backs off on repeated failures, see overpassFailStreak in 01_state.js)
const HIGHWAY_RECHECK_MAX_MS = 90000; // cap for the exponential backoff below, so we never go longer than 90s between attempts even during a sustained outage/rate-limit
const HIGHWAY_CONFIRM_COUNT = 2;   // consecutive matching reads needed before switching displayed highway
const MAX_SEARCH_DIST_M = 24140.2; // ~15 miles — cameras farther than this on your highway are ignored
const SWAP_BUFFER_M = 402.336;     // 1320 ft (1/4 mile) — a camera stays the displayed
                                    // "nearest"/"next" camera, counting down through negative
                                    // distance, until it's this far behind you
const BROWSE_RANGE_M = 80467;      // ~50 miles — how far the manual ahead/behind scan can look
const MANIFEST_TIMEOUT_MS = 12000; // if a stream hasn't started playing within this long, treat as stalled
const MAX_STREAM_RETRIES = 3;      // automatic retry attempts before showing a manual "tap to retry" button

// ---- Mile marker lookup ----
// MDOT SHA's Roadway Mile Markers FeatureServer. Unlike VA's feed, route
// prefix/number are clean separate fields (ID_PREFIX/ID_RTE_NO/ID_MP) —
// no packed-string decoding needed. BUT: this layer has no direction
// field at all (VA at least had an unreliable one), and lat/lon come from
// point geometry rather than flat attributes, in Web Mercator by default —
// outSR=4326 in the query forces WGS84 lat/lon instead. See the comment
// on updateMilepostAndDirection() in 03_highway.js for the real
// consequence of having no direction field: opposite-carriageway markers
// aren't excluded by the API, only by our own bearing-derived guess.
const MILEMARKER_QUERY_URL = 'https://mdgeodata.md.gov/imap/rest/services/Transportation/MD_RoadwayMileMarkers/FeatureServer/0/query';
const MILEMARKER_SEARCH_RADIUS_M = 900;  // ~0.56mi — wide enough to bracket the two nearest signs
const MILEMARKER_RECHECK_MS = 8000;      // how often we re-query for the current milepost

// ---- Highway shield images (Wikipedia / Wikimedia Commons) ----
// Special:FilePath redirects straight to the file, so it works as a plain
// <img src> with no API key or CORS preflight needed. We try a short list
// of likely filenames per route type and fall back silently if none load.
const COMMONS_FILEPATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

// ---- CHART message signs (DMS) ----
// Unauthenticated, but same CORS issue as cameras above — routed through
// the same proxy's /dms path. msgPlain already comes pre-formatted with
// real spacing between lines/pages (no NTCIP markup decoding needed).
const MSG_SIGN_URL = 'https://mdotdms.m-c-hunt429.workers.dev/dms';
const MSG_SIGN_RANGE_M = 16093.4;   // 10 miles
const MSG_SIGN_POLL_MS = 30000;     // re-poll signs this often so a sign 10mi out
                                     // can't silently change message before we reach it
