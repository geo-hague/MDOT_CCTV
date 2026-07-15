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

function parseMdDmsLocation(description) {
  if (!description) return { roadway: null, direction: null };
  const desc = description.toUpperCase();
  const routeMatch = desc.match(/\b(I|US|MD)[-\s]?(\d+)\b/);
  const roadway = routeMatch ? `${routeMatch[1]}-${routeMatch[2]}` : null;
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

function pickActiveMessageSign(lat, lon) {
  if (!messageSigns.length || !currentHighway || !currentHighway.length) return null;

  const dirMatches = (s) => {
    if (!highwayDirectionLabel) return false; // our own direction isn't known yet — can't confirm
                                                // a directional sign applies to us, so don't show it
    const signDir = s.DirectionOfTravel;
    if (signDir && signDir !== 'None' && signDir !== 'Unknown') {
      if (signDir === 'All Directions' || signDir === 'Both Directions') return true;
      return signDir === highwayDirectionLabel;
    }
    // DirectionOfTravel is missing/None/Unknown — fall back to the sign ID's
    // trailing N/S/E/W letter instead of refusing to show the sign at all.
    const inferred = directionFromSignId(s);
    return inferred ? inferred === highwayDirectionLabel : false;
  };

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
        dirMatched: dirMatches(x.s),
        roadwayMatched: currentHighway.some(h => (x.s.Roadway || '').toUpperCase().includes(h.replace('-', ''))
          || (x.s.Roadway || '').toUpperCase().includes(h)),
        distMi: Math.round(x.dist / 160.934) / 10,
      }));
    if (nearbyForDebug.length) {
      console.log('[DMS debug] our direction:', highwayDirectionLabel, 'currentHighway:', currentHighway, nearbyForDebug);
    }
  }

  const candidates = messageSigns
    .filter(s => s.Messages && s.Messages.length && s.Messages[0] !== 'NO_MESSAGE')
    .filter(s => dirMatches(s))
    .filter(s => currentHighway.some(h => (s.Roadway || '').toUpperCase().includes(h.replace('-', ''))
      || (s.Roadway || '').toUpperCase().includes(h)))
    .map(s => {
      const straightDist = haversineMeters(lat, lon, s.Latitude, s.Longitude);
      const bearingToSign = bearingDeg(lat, lon, s.Latitude, s.Longitude);
      const dist = lastStableBearing === null
        ? straightDist
        : straightDist * Math.cos(toRad(angleDiff(bearingToSign, lastStableBearing)));
      return { sign: s, dist };
    })
    .filter(c => c.dist >= -SWAP_BUFFER_M && c.dist <= MSG_SIGN_RANGE_M);

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.length ? candidates[0] : null;
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
  const active = pickActiveMessageSign(lat, lon);

  if (!active) {
    msgBannerEl.style.display = 'none';
    activeSignId = null;
    return;
  }

  const msgText = active.sign.Messages.join(' • ');
  msgBannerEl.innerHTML = '';
  const main = document.createElement('div');
  main.textContent = msgText;
  const meta = document.createElement('span');
  meta.className = 'msg-meta';
  meta.textContent = `${formatDistance(Math.max(0, active.dist))} ahead`;
  msgBannerEl.appendChild(main);
  msgBannerEl.appendChild(meta);
  msgBannerEl.style.display = 'block';

  // Speak only when this is a genuinely new sign/message, not every poll.
  const signKey = active.sign.Id + '::' + msgText;
  if (signKey !== activeSignId && msgText !== lastSpokenMessage) {
    speakMessage(msgText);
    lastSpokenMessage = msgText;
  }
  activeSignId = signKey;
}
