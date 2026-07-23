# Tripline

**Turn a folder of daily GPX files into one trip.**

---

## What it is, and why you'd use it

If you've ever ridden a multi-day bikepacking trip, you know the problem:
your GPS device gives you one GPX file per day, and every tool treats that
as one *activity*. So your four-day traverse of the Alps becomes four
disconnected entries — four separate distances, four separate elevation
charts, four separate everything. There's no single place that shows you
the *trip*.

Tripline exists to fix exactly that. Drop in one GPX file per day, and it
merges them into a single continuous route, one elevation profile spanning
the whole trip, one set of trip-wide stats, and a clean shareable summary
you can actually post or print. The four days become one story again.

### Why it's worth using

- **It's built for trips, not rides.** Every stat is trip-aware. "Longest
  day," "biggest climb," "net elevation change start-to-finish" — these are
  questions about a multi-day journey, not a single ride, and most
  GPX/fitness tools simply don't answer them because they're not designed
  to look across files.
- **It tells you things a single-day tool can't.** Because it's looking at
  the whole trip at once, it can separate "longest climb" from "biggest
  climb" (often two completely different days), tell you how far north-to-
  south and east-to-west you actually traveled, and show your elevation
  gain/loss as one continuous story instead of four disconnected charts.
- **It respects your data.** There's no account, no upload to a server, no
  processing "in the cloud." Every GPX file is parsed and rendered entirely
  in your browser. Close the tab and it's gone — nothing about your trip is
  stored anywhere.
- **The export is actually shareable.** Instead of a screenshot of a
  dashboard, you get a designed card — route, key stats, elevation
  silhouette — sized for however you're posting it: Instagram Story, a
  square post, a landscape social image, or a print-ready A4/A5, if you'd
  rather put your trip on a wall than a feed.
- **It's honest about its numbers.** Elevation gain/loss is computed from
  your file's own GPS/barometer data with sensible noise-filtering — it
  will read a little differently than Strava or Garmin, because they run
  proprietary corrected-elevation models you don't have access to. Tripline
  tells you that plainly instead of pretending its number is *the* number.

### Who it's for

Bikepackers, tourers, and multi-day gravel/road riders who record a GPX per
day and want the *trip*, not four separate rides — and who'd rather not
hand that data to another platform to get it.

---

## Technical specs

### Stack

Plain HTML/CSS/JavaScript. No framework, no bundler, no build step, no
package.json. Three files, opened directly in a browser or served as
static files:

| File         | Contents                                                                |
|--------------|--------------------------------------------------------------------------|
| `index.html` | Page markup                                                              |
| `style.css`  | All styling — dark "field log" theme, Space Grotesk + IBM Plex Mono/Sans |
| `script.js`  | GPX parsing, all stat computation, map/elevation/card rendering          |

### External dependencies (CDN, no install)

- **Leaflet 1.9.4** — the interactive route map
- **html2canvas 1.4.1** — PNG export of the shareable card
- **CARTO dark basemap tiles** (`basemaps.cartocdn.com`) — used by both the
  live map and the hand-drawn card map
- **Google Fonts** — Space Grotesk, IBM Plex Mono, IBM Plex Sans
- **Umami** — page-view analytics only, no PII

### GPX parsing

- `DOMParser` against `application/xml`, with BOM-stripping and a
  parser-error check before use
- Falls back through `<trkpt>` → `<rtept>` → `<wpt>` depending on what the
  file actually contains
- Per-point: `lat`, `lon`, `ele` (defaults to 0 if absent/`NaN`), `time`
  (parsed via `Date`, discarded if invalid)
- Days are sorted by parsed start time if at least half the uploaded files
  have valid timestamps; otherwise upload order is preserved and can be
  fixed manually

### Distance & speed

- Distance: haversine sum between consecutive points (Earth radius 6371 km)
- Per-segment speed: distance ÷ time-delta, discarding deltas below 0.3s
  (avoids divide-by-near-zero) and speeds above 100 km/h (GPS-jump
  rejection)
- Moving time: sum of time-deltas where segment speed > 1.5 km/h; anything
  at or below that is treated as stopped
- Max speed: segment speeds run through a 5-sample moving average before
  taking the max, to avoid a single noisy sample producing a fake spike
- Two average speeds are reported: **moving** (distance ÷ moving time) and
  **total/elapsed** (distance ÷ full recorded duration, including stops)

### Elevation

- Smoothing window is sized from the **actual recording interval**, not
  point count — targets ~8 seconds of smoothing (`clamp(3, round(8 /
  avg_interval_seconds), 15)`), falling back to a fixed window of 5 if no
  reliable timestamps exist. Sizing it from point count alone was an
  earlier bug: a long, densely-sampled ride would hit an aggressive cap and
  flatten real rolling terrain along with the sensor noise.
- Gain/loss: hysteresis walk over the smoothed elevation — a change only
  commits once it exceeds a 1-meter threshold from the last committed
  point, then the anchor moves. This rejects sensor jitter without also
  rejecting real small-scale terrain texture.
- Validated against a synthetic terrain profile with a known "true" gain/
  loss value (no noise, no filtering): the current tuning recovers ~97.5%
  of true elevation change, while producing zero false gain on flat,
  noise-only terrain.
- Climbs: `findClimbs()` walks the same hysteresis logic but records the
  `[startIndex, endIndex]` of each contiguous climbing streak instead of
  summing. "Longest climb" (by distance) and "biggest climb" (by meters
  gained) are computed separately, per day, since they're frequently
  different climbs entirely.
- Min/max/start/finish elevation all read from the *smoothed* series, so a
  single noisy sample can't masquerade as the trip's highest point.

### Route span & bounds

N–S and E–W span: bounding-box lat/lon (sampled every 5th point across all
days) converted to a real distance via haversine between the box's
opposite edges at the midpoint latitude/longitude.

### Rendering

- **Live map** — standard Leaflet, one polyline + numbered `divIcon` marker
  per day, colored from a fixed 5-color palette cycled by day index.
- **Elevation chart** — hand-built SVG (no charting library): per-day path
  segments with a filled area beneath, dashed day-boundary dividers,
  downsampled to ≤500 points for render performance regardless of source
  file size.
- **Shareable card map** — *not* a screenshot of the Leaflet map. Drawn by
  hand onto a `<canvas>` using the same Web Mercator projection formula
  real tile servers use (`x = (lon+180)/360 · 256·2^zoom`, standard
  latitude formula), with zoom chosen by searching down from z17 until the
  route's bounding box fits the available canvas space. Tiles are fetched
  directly (`crossOrigin: 'anonymous'`) and drawn with a dark casing stroke
  under each day's route color. This exists because `html2canvas` cannot
  reliably capture a live Leaflet view (CSS-transformed tile panes, async
  tile loading) — the canvas is the actual export target, not something
  being screenshotted after the fact.
- **Card formats** — `#tripCard` becomes a flex column for any non-"auto"
  format; the fixed-ratio formats set `aspect-ratio` + `max-width`, and the
  map area (`flex: 1 1 auto`) claims whatever vertical space is left after
  the title/stats/elevation chart, rather than a hand-tuned ratio per
  format. The map canvas reads its container's actual rendered
  `getBoundingClientRect()` at draw time, so it always matches whatever
  shape the chosen format leaves it. A CSS **container query** (not a media
  query) handles the stat grid's column count, since a narrow Story-format
  card can exist on a wide desktop viewport.

### Safety details worth knowing about

- All array min/max operations use a plain loop (`arrMin`/`arrMax`), never
  `Math.max(...array)` — spreading a large array into `Math.max` throws a
  stack-size error once you're past roughly 100k elements, which a
  multi-day, 1Hz-recorded GPX can hit easily. This was a real, previously-
  shipped bug (silently blank elevation chart / card map on large files)
  before being replaced with loop-based versions everywhere.
- `renderAll()` runs each render step (ledger, map, elevation, day table,
  card) in its own `try/catch`, so a failure in one section can't blank out
  the others.
- `beforeunload` warns before refresh/close/navigate-away if a trip is
  currently loaded, since there's no persistence layer to lose it to.

### Known limitations

- Elevation figures won't match Strava/Garmin/Komoot exactly — different
  correction methodology, not a bug.
- Climb detection doesn't cross day boundaries (two days' recordings aren't
  necessarily geographically continuous).
- "Longest stop" only sees pauses *within* one day's recording; an
  overnight gap between days isn't in the data (the device was off).
- PNG export's map tiles depend on the tile provider allowing cross-origin
  canvas reads (`useCORS`) — generally reliable, not universally
  guaranteed.
- No persistence: everything lives in page memory for the current session
  only.