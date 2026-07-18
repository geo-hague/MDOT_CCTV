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
// Highways where mile markers/DMS use a carriageway label ("Inner"/"Outer")
// instead of a compass direction. Bearing-derived direction is actively
// wrong on a loop (you head every cardinal direction at different points
// around it), so these get special-cased in updateMilepostAndDirection()
// in 03_highway.js to resolve direction from ascending/descending milepost
// trend instead — see the comment there.
//
// Each entry's convention is NOT universal — confirmed different for
// MD's two loops specifically:
//   I-695 (Baltimore Beltway): the "expected" convention — mileposts
//     ascend clockwise, so ascending = Inner. ascendingIsInner: true.
//   I-495 (Capital Beltway): an exception, because its mile numbering is
//     forced to align with I-95's own numbering (which enters MD from the
//     Virginia state line and increases heading north/clockwise around
//     the west side) rather than following its own loop's natural
//     rotational count — so I-495 ascends counter-clockwise, meaning
//     ascending = Outer. ascendingIsInner: false.
const LOOP_HIGHWAYS = {
  'I-495': { ascendingIsInner: false },
  'I-695': { ascendingIsInner: true },
};
const MAX_SEARCH_DIST_M = 32186.9; // 20 miles — cameras farther than this on your highway are ignored
const SECONDARY_REF_RANGE_M = 804.672; // 0.5 miles — when multiple routes are concurrent
                                    // (e.g. locked to ["I-26","US-25","US-74"]), only refs of the
                                    // TOP route type get the full search radius above. Lower-tier
                                    // refs are capped to this much tighter window, since a real
                                    // concurrency is a short physical overlap, not a long shared
                                    // stretch — without this, a camera tagged e.g. "US-25" miles
                                    // away on a DIVERGED parallel alignment (same route number,
                                    // different road once the concurrency ends) would incorrectly
                                    // show up just because that number is part of the current lock.
                                    // NOTE: used by getScoredCameras() in 05_cameras.js — that file
                                    // MUST be deployed alongside this one and 03_highway.js, or it
                                    // throws a ReferenceError that silently kills cameras, mile
                                    // markers, and direction all at once.
const SWAP_BUFFER_M = 402.336;     // 1320 ft (1/4 mile) — a camera stays the displayed
                                    // "nearest"/"next" camera, counting down through negative
                                    // distance, until it's this far behind you
const BROWSE_RANGE_M = 80467;      // ~50 miles — how far the manual ahead/behind scan can look
const MANIFEST_TIMEOUT_MS = 12000; // if a stream hasn't started playing within this long, treat as stalled
const MAX_STREAM_RETRIES = 3;      // automatic retry attempts before showing a manual "tap to retry" button

// ---- Mile marker lookup ----
// MDOT SHA's Roadway Mile Markers FeatureServer. Route prefix/number are
// clean separate fields (ID_PREFIX/ID_RTE_NO) — no packed-string decoding
// needed. ID_MP looked like the milepost field but turned out unreliable
// in practice; MP_INT_RTE_NAME (e.g. "MILE MARKER 66.0") is the field that
// actually holds the correct value — parsed out via parseMpFromRteName()
// in 03_highway.js. This layer also has no direction field at all (VA at
// least had an unreliable one), and lat/lon come from point geometry
// rather than flat attributes, in Web Mercator by default — outSR=4326 in
// the query forces WGS84 lat/lon instead. See the comment on
// updateMilepostAndDirection() in 03_highway.js for the real consequence
// of having no direction field: opposite-carriageway markers aren't
// excluded by the API, only by our own bearing-derived guess.
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
const MSG_SIGN_RANGE_M = 32186.9;   // 20 miles — matches MAX_SEARCH_DIST_M (cameras)
const MSG_SIGN_POLL_MS = 30000;     // re-poll signs this often so a sign 10mi out
                                     // can't silently change message before we reach it
