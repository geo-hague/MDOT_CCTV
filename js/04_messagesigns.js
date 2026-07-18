// 04_messagesigns.js — CHART DMS (message sign) fetching, matching, banner + speech
// Part of the MD Traffic app; loaded as a classic (non-module) script so it
// shares top-level `let`/`const` scope with the other js/*.js files.

// ---------- DMS message signs ----------
// CHART's feed is plain public JSON — no token, no account, no proxy
// needed (unlike VA's TMDD/XML feed). msgPlain already comes pre-formatted
// with real spacing between lines/pages, so no markup decoding either.
async function fetchMessageSignsIfNeeded() {
  const now = Date.now();
  if (now - lastMsgSignFetch < MSG_SIGN_POLL_MS) return;
  lastMsgSignFetch = now;
  if (!MSG_SIGN_URL) {
    setDebug({ messageSigns: 'MSG_SIGN_URL not configured' });
    return;
  }
  try {
    const resp = await fetch(MSG_SIGN_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    messageSigns = parseMdDmsSigns(json.data || []);
  } catch (err) {
    setDebug({ messageSigns: `fetch failed: ${err.message}` });
  }
}

// ---------- CHART DMS JSON parsing ----------
// CHART gives no separate roadway/direction fields for signs — both have
// to be pulled out of the free-text "description" field, e.g.
// "US 50 WEST AT EXIT 42 MD 835 KENT NARROWS RD (WB)" or
// "I-95 South, past Ex 80 MD 543, prior to MD 136 at MM 79.5". This is
// the same kind of text-parsing VA needed for its sign names, just against
// a different field.
const MD_DMS_DIR_WORDS = { NORTH: 'Northbound', SOUTH: 'Southbound', EAST: 'Eastbound', WEST: 'Westbound' };

// I-495 (Capital Beltway) signs use "IL"/"OL" instead of a cardinal
// direction, e.g. "I-495 IL past Exit 39 MD 190" — no NORTH/SOUTH/EAST/WEST
// word appears at all on these. Checked first, since the cardinal regex
// below would simply find nothing on a loop sign's description and
// silently leave direction unresolved otherwise. Word-bounded so it only
// matches a standalone "IL"/"OL" token, not a substring of an unrelated word.
const MD_LOOP_DIR_WORDS = { IL: 'Inner', OL: 'Outer' };

function parseMdDmsLocation(description) {
  if (!description) return { roadway: null, direction: null };
  const desc = description.toUpperCase();

  // Loop signs can mention OTHER route numbers elsewhere in the
  // description (e.g. a cross-reference to I-95 at an interchange) that
  // appear BEFORE the loop highway's own number — confirmed real: a sign
  // that was genuinely about I-495 (DirectionOfTravel correctly resolved
  // to "Outer") got its Roadway mis-extracted as "I-95" because I-95 was
  // mentioned earlier in the text. MDOT SHA's own convention pairs the
  // loop's route number directly adjacent to its IL/OL token (confirmed
  // sample: "I-495 IL past Exit 39 MD 190"), so when a loop indicator is
  // present, prefer whichever route number sits immediately next to it
  // over the first route number anywhere in the string.
  const adjacentLoopMatch = desc.match(/\b(I|US|MD)[-\s]?(\d+)\s+(IL|OL)\b/);
  if (adjacentLoopMatch) {
    return {
      roadway: `${adjacentLoopMatch[1]}-${adjacentLoopMatch[2]}`,
      direction: MD_LOOP_DIR_WORDS[adjacentLoopMatch[3]],
    };
  }

  const routeMatch = desc.match(/\b(I|US|MD)[-\s]?(\d+)\b/);
  const roadway = routeMatch ? `${routeMatch[1]}-${routeMatch[2]}` : null;

  // IL/OL present but not adjacent to a route number (unexpected phrasing,
  // not matching the confirmed convention above) — still record the
  // direction against whatever roadway WAS found, better than nothing.
  const loopMatch = desc.match(/\b(IL|OL)\b/);
  if (loopMatch) return { roadway, direction: MD_LOOP_DIR_WORDS[loopMatch[1]] };

  const dirMatch = desc.match(/\b(NORTH|SOUTH|EAST|WEST)\b/);
  const direction = dirMatch ? MD_DMS_DIR_WORDS[dirMatch[1]] : null;
  return { roadway, direction };
}

function parseMdDmsSigns(records) {
  const parsed = records
    .map(r => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const { roadway, direction } = parseMdDmsLocation(r.description);
      const msgText = (r.msgPlain || '').trim();
      return {
        Id: r.id,
        Name: r.name,
        Roadway: roadway,
        DirectionOfTravel: direction,
        Latitude: lat,
        Longitude: lon,
        Messages: msgText ? [msgText] : ['NO_MESSAGE'],
        commMode: r.commMode,   // kept for debugging, not used for matching
        opStatus: r.opStatus,   // kept for debugging, not used for matching
      };
    })
    .filter(s => s !== null);

  setDebug({
    dmsRecordCount: records.length,
    dmsParsedCount: parsed.length,
    dmsWithMessages: parsed.filter(s => s.Messages[0] !== 'NO_MESSAGE').length,
    dmsSample: parsed.filter(s => s.Messages[0] !== 'NO_MESSAGE').slice(0, 3),
  });

  return parsed;
}

// CHART's sign "name" field is just a short numeric/alphanumeric code
// (e.g. "8829", "5511") with no direction encoded in it — unlike VA's
// device names. So this fallback will rarely find anything for MD; the
// primary path (DirectionOfTravel parsed from the description field
// above) is what actually matters here. Kept for structural parity with
// the VA/NC codebase and in case some sign names do encode direction.
function directionFromSignId(s) {
  const map = { N: 'Northbound', S: 'Southbound', E: 'Eastbound', W: 'Westbound' };
  if (typeof s.Name !== 'string') return null;
  const name = s.Name.trim();
  const wordMatch = /\b(North|South|East|West)\b/i.exec(name);
  if (wordMatch) return map[wordMatch[1][0].toUpperCase()];
  const letterMatch = /([NSEW])\s*[)\]]*\s*$/i.exec(name);
  return letterMatch ? map[letterMatch[1].toUpperCase()] : null;
}

// Extracted from the old inline dirMatches()/roadway-check so both the
// live "closest sign" pick and manual ahead/behind browsing use the exact
// same eligibility rules — otherwise browsing could show a sign live
// detection would never have picked (or vice versa), which would be a
// confusing inconsistency.
function messageSignDirMatches(s) {
  // Find which currentHighway ref this sign's Roadway actually corresponds
  // to, so we compare against THAT ref's own direction — not a single
  // global fallback, which breaks down whenever concurrent refs have
  // genuinely different directions at once (e.g. I-95=Northbound,
  // I-495=Outer, at the same physical point on the Capital Beltway). A
  // sign tagged for I-495 must be checked against highwayDirectionLabels
  // ["I-495"], not whichever ref happened to set the global value last.
  const roadwayUpper = (s.Roadway || '').toUpperCase();
  const matchedRef = currentHighway.find(h => roadwayUpper.includes(h.replace('-', '')) || roadwayUpper.includes(h));
  const relevantDirection = (matchedRef && highwayDirectionLabels[matchedRef]) || highwayDirectionLabel;

  if (!relevantDirection) return false; // our own direction isn't known yet — can't confirm
                                          // a directional sign applies to us, so don't show it
  const signDir = s.DirectionOfTravel;
  if (signDir && signDir !== 'None' && signDir !== 'Unknown') {
    if (signDir === 'All Directions' || signDir === 'Both Directions') return true;
    return signDir === relevantDirection;
  }
  // DirectionOfTravel is missing/None/Unknown — fall back to the sign ID's
  // trailing N/S/E/W letter instead of refusing to show the sign at all.
  const inferred = directionFromSignId(s);
  return inferred ? inferred === relevantDirection : false;
}

function messageSignRoadwayMatches(s) {
  return currentHighway.some(h => (s.Roadway || '').toUpperCase().includes(h.replace('-', ''))
    || (s.Roadway || '').toUpperCase().includes(h));
}

// Direction+roadway-filtered, signed-distance-scored, sorted-nearest-first
// list of active (non-blank) message signs — shared basis for both the
// live "closest" pick and manual browsing. minDist/maxDist let callers use
// a tight window (live: a small negative buffer so a sign doesn't vanish
// the instant you pass it) or the full symmetric range (browsing: can page
// backward the same distance it can page forward), mirroring
// getScoredCameras() in 05_cameras.js.
function getScoredMessageSigns(lat, lon, minDist, maxDist) {
  if (!messageSigns.length || !currentHighway || !currentHighway.length || !highwayDirectionLabel) return [];

  return messageSigns
    .filter(s => s.Messages && s.Messages.length && s.Messages[0] !== 'NO_MESSAGE')
    .filter(messageSignDirMatches)
    .filter(messageSignRoadwayMatches)
    .map(s => {
      const straightDist = haversineMeters(lat, lon, s.Latitude, s.Longitude);
      const bearingToSign = bearingDeg(lat, lon, s.Latitude, s.Longitude);
      const dist = lastStableBearing === null
        ? straightDist
        : straightDist * Math.cos(toRad(angleDiff(bearingToSign, lastStableBearing)));
      return { sign: s, dist };
    })
    .filter(c => c.dist >= minDist && c.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist);
}

function pickActiveMessageSign(lat, lon) {
  if (!messageSigns.length || !currentHighway || !currentHighway.length) return null;

  if (highwayDirectionLabel) {
    const nearbyForDebug = messageSigns
      .filter(s => s.Messages && s.Messages.length && s.Messages[0] !== 'NO_MESSAGE')
      .map(s => ({ s, dist: haversineMeters(lat, lon, s.Latitude, s.Longitude) }))
      .filter(x => x.dist <= MSG_SIGN_RANGE_M)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
      .map(x => ({
        raw: x.s, // full object — check this if the field name assumptions above are wrong
        Roadway: x.s.Roadway,
        DirectionOfTravel: x.s.DirectionOfTravel,
        inferredDirection: directionFromSignId(x.s),
        dirMatched: messageSignDirMatches(x.s),
        roadwayMatched: messageSignRoadwayMatches(x.s),
        distMi: Math.round(x.dist / 160.934) / 10,
      }));
    if (nearbyForDebug.length) {
      console.log('[DMS debug] our direction:', highwayDirectionLabel, 'currentHighway:', currentHighway, nearbyForDebug);
    }
  }

  const scored = getScoredMessageSigns(lat, lon, -SWAP_BUFFER_M, MSG_SIGN_RANGE_M);
  return scored.length ? scored[0] : null;
}

// ---------- Manual ahead/behind DMS browsing ----------
// Lets you page through message signs further out than the live nearest
// match, without changing what the live auto-detected banner (and its
// one-time speech) shows — mirrors the camera browse pattern in
// 06_browse.js. Snapshots the sign list at the moment you first press a
// button (using your last known position), then Ahead/Behind just walk an
// index through that snapshot. Only ever includes signs with an active
// message (a page full of "no message" signs would be clutter, not
// information) and stays direction-filtered, same eligibility rules as
// live detection via getScoredMessageSigns() above.
let msgBrowseActive = false;
let msgBrowseList = [];
let msgBrowseIndex = 0;

function enterMsgBrowseIfNeeded() {
  if (msgBrowseActive || !lastKnownPos) return false;
  // Uses BROWSE_RANGE_M (same ~50mi range camera browsing uses) rather
  // than the tighter MSG_SIGN_RANGE_M live-detection radius — browsing
  // should be able to scan as far ahead as camera browsing does; live
  // auto-detection stays at its original tighter range so a random sign
  // 50 miles out doesn't trigger the live banner/speech.
  const list = getScoredMessageSigns(lastKnownPos.lat, lastKnownPos.lon, -BROWSE_RANGE_M, BROWSE_RANGE_M);
  if (!list.length) return false;
  // Start browsing from whichever sign is currently closest to your actual
  // position, so the first tap moves logically forward/back from where
  // you already are rather than jumping to the list's edge.
  let closestIdx = 0, closestAbs = Infinity;
  list.forEach((s, i) => { const a = Math.abs(s.dist); if (a < closestAbs) { closestAbs = a; closestIdx = i; } });
  msgBrowseList = list;
  msgBrowseIndex = closestIdx;
  msgBrowseActive = true;
  return true;
}

function moveMsgAhead() {
  const justEntered = enterMsgBrowseIfNeeded();
  if (!msgBrowseActive) return;
  if (!justEntered) msgBrowseIndex = Math.min(msgBrowseIndex + 1, Math.max(0, msgBrowseList.length - 1));
  updateMessageBanner(lastKnownPos.lat, lastKnownPos.lon);
}

function moveMsgBehind() {
  const justEntered = enterMsgBrowseIfNeeded();
  if (!msgBrowseActive) return;
  if (!justEntered) msgBrowseIndex = Math.max(msgBrowseIndex - 1, 0);
  updateMessageBanner(lastKnownPos.lat, lastKnownPos.lon);
}

function exitMsgBrowse() {
  msgBrowseActive = false;
  msgBrowseList = [];
  msgBrowseIndex = 0;
  if (lastKnownPos) updateMessageBanner(lastKnownPos.lat, lastKnownPos.lon);
}

// Shows/hides the small ◀ Closest ▶ controls row. Kept deliberately
// minimal (mobile real estate) — hidden entirely unless there's at least
// one sign to browse to, so it adds zero footprint on quiet stretches of
// highway. The middle button is a static "Closest" label that returns to
// live tracking, matching the camera scan bar's "Closest Cam" button.
function renderMessageBrowseControls(hasBrowsableSigns) {
  const controls = document.getElementById('msg-scan-controls');
  if (!controls) return; // markup not present — degrade silently rather than throw
  const counter = document.getElementById('msg-scan-counter-btn');
  const behindBtn = document.getElementById('msg-scan-behind-btn');
  const aheadBtn = document.getElementById('msg-scan-ahead-btn');

  if (!hasBrowsableSigns && !msgBrowseActive) {
    controls.style.display = 'none';
    return;
  }
  controls.style.display = '';
  counter.textContent = 'Closest';
  counter.classList.toggle('active', msgBrowseActive);
  if (msgBrowseActive) {
    behindBtn.disabled = msgBrowseIndex <= 0;
    aheadBtn.disabled = msgBrowseIndex >= msgBrowseList.length - 1;
  } else {
    behindBtn.disabled = false; // live mode's arrows always just START browsing from here
    aheadBtn.disabled = false;
  }
}

function speakMessage(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // don't stack overlapping announcements
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.warn('Speech synthesis failed:', err);
  }
}

async function updateMessageBanner(lat, lon) {
  await fetchMessageSignsIfNeeded();

  const contentEl = document.getElementById('msg-banner-content') || msgBannerEl;

  let active, isLive, hasBrowsableSigns;
  if (msgBrowseActive) {
    active = msgBrowseList[msgBrowseIndex] || null;
    isLive = false;
    hasBrowsableSigns = msgBrowseList.length > 0;
  } else {
    active = pickActiveMessageSign(lat, lon);
    isLive = true;
    hasBrowsableSigns = getScoredMessageSigns(lat, lon, -BROWSE_RANGE_M, BROWSE_RANGE_M).length > 0;
  }

  renderMessageBrowseControls(hasBrowsableSigns);

  if (!active) {
    msgBannerEl.style.display = 'none';
    if (isLive) activeSignId = null;
    return;
  }

  const msgText = active.sign.Messages.join(' • ');
  contentEl.innerHTML = '';
  const main = document.createElement('div');
  main.textContent = msgText;
  const meta = document.createElement('span');
  meta.className = 'msg-meta';
  meta.textContent = isLive
    ? `${formatDistance(Math.max(0, active.dist))} ahead`
    : `${formatDistance(Math.abs(active.dist))} ${active.dist >= 0 ? 'ahead' : 'behind'}`;
  contentEl.appendChild(main);
  contentEl.appendChild(meta);
  msgBannerEl.style.display = 'block';

  if (isLive) {
    const signKey = active.sign.Id + '::' + msgText;
    if (signKey !== activeSignId && msgText !== lastSpokenMessage) {
      speakMessage(msgText);
      lastSpokenMessage = msgText;
    }
    activeSignId = signKey;
  }
}
