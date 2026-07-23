(function () {
    "use strict";

    const PALETTE = ["#E2793D", "#5FA8A3", "#C9A227", "#7B8CDE", "#A85C8B"];
    let days = []; // {id,name,points,distanceKm,gainM,lossM,elapsedMs,movingMs,startTime,avgSpeedMovingKmh,avgSpeedElapsedKmh,maxSpeedKmh,color}
    let leafletMap = null;
    let dayLayers = [];

    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("fileInput");
    const dashboard = document.getElementById("dashboard");
    const dropzoneWrap = document.getElementById("dropzoneWrap");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const loadingText = document.getElementById("loadingText");
    const errorBanner = document.getElementById("errorBanner");

    let colorRouteByDay = true;
    let colorElevationByDay = true;

    // ---- safe min/max: never spread large arrays into Math.min/max, it blows
    // the call stack once a track has more than ~100k points (very easy to hit
    // on a multi-day, 1s-interval recording). Plain loops have no such limit.
    function arrMin(arr) {
        let m = arr[0];
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] < m) m = arr[i];
        }
        return m;
    }
    function arrMax(arr) {
        let m = arr[0];
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] > m) m = arr[i];
        }
        return m;
    }

    dropzone.addEventListener("click", () => fileInput.click());
    ["dragenter", "dragover"].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.add("drag");
        }),
    );
    ["dragleave", "drop"].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.remove("drag");
        }),
    );
    dropzone.addEventListener("drop", (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length)
            handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length)
            handleFiles(e.target.files);
        fileInput.value = "";
    });
    document
        .getElementById("addMoreTop")
        .addEventListener("click", () => fileInput.click());
    document
        .getElementById("addMoreBottom")
        .addEventListener("click", () => fileInput.click());
    document.getElementById("resetBtn").addEventListener("click", () => {
        const ok = window.confirm(
            "Start a new trip? This clears the current days and can't be undone.",
        );
        if (!ok) return;
        days = [];
        dashboard.classList.remove("show");
        dropzoneWrap.style.display = "block";
        errorBanner.innerHTML = "";
        document.getElementById("tripTitle").value = "Untitled Trip";
        document.getElementById("tripSubtitle").value = "";
    });
    document.getElementById("tripTitle").addEventListener("input", (e) => {
        document.getElementById("cardTitle").textContent =
            e.target.value || "Untitled Trip";
    });
    document.getElementById("tripSubtitle").addEventListener("input", (e) => {
        document.getElementById("cardSubtitle").textContent = e.target.value;
        document.getElementById("cardSubtitle").style.display =
            e.target.value ? "block" : "none";
    });
    document
        .getElementById("downloadBtn")
        .addEventListener("click", downloadCard);

    const routeColorToggle = document.getElementById("routeColorToggle");

    if (routeColorToggle) {
        routeColorToggle.addEventListener("change", (e) => {
            colorRouteByDay = e.target.checked;
            renderMap();
            renderCard();
        });
    }

    const elevationColorToggle = document.getElementById(
        "elevationColorToggle",
    );

    if (elevationColorToggle) {
        elevationColorToggle.addEventListener("change", (e) => {
            colorElevationByDay = e.target.checked;
            renderElevation();
            renderCard();
        });
    }

    // Shareable card export formats. "auto" is the original behavior (card
    // grows to fit its content, no fixed aspect ratio) and stays the default
    // so existing exports don't change unless the person picks something else.
    const CARD_FORMATS = {
        auto: { label: "Classic (auto height)" },
        story: { label: "Instagram Story · 9:16", maxWidth: 420 },
        portrait: { label: "Instagram Post · 4:5", maxWidth: 480 },
        square: { label: "Instagram Square · 1:1", maxWidth: 560 },
        landscape: { label: "Social Landscape · 1.91:1", maxWidth: 820 },
        a4: { label: "Print · A4", maxWidth: 560 },
        a5: { label: "Print · A5", maxWidth: 480 },
    };

    const cardFormatSelect = document.getElementById("cardFormat");
    if (cardFormatSelect) {
        cardFormatSelect.addEventListener("change", (e) => {
            applyCardFormat(e.target.value);
            // the map area's box just changed shape, so its canvas needs
            // to be redrawn at the new dimensions, not just re-styled
            drawCardMap();
        });
    }

    function applyCardFormat(formatKey) {
        const card = document.getElementById("tripCard");
        if (!card) return;
        Object.keys(CARD_FORMATS).forEach((key) =>
            card.classList.remove("format-" + key),
        );
        card.classList.add("format-" + formatKey);
    }

    // Warn on refresh/close/navigate-away if there's imported data that would
    // be lost — GPX files would have to be re-uploaded, there's no persistence.
    window.addEventListener("beforeunload", (e) => {
        if (days.length) {
            e.preventDefault();
            e.returnValue = "";
        }
    });

    function showLoading(text) {
        loadingText.textContent = text;
        loadingOverlay.classList.add("show");
    }
    function hideLoading() {
        loadingOverlay.classList.remove("show");
    }

    function handleFiles(fileList) {
        const files = Array.from(fileList).filter((f) =>
            /\.gpx$/i.test(f.name),
        );
        if (!files.length) return;
        errorBanner.innerHTML = "";
        let pending = files.length;
        let completed = 0;
        const failed = [];
        showLoading("Reading GPX file 1 of " + files.length + "…");

        files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const points = parseGPX(e.target.result);
                    if (points.length < 2)
                        throw new Error("no usable track points found");
                    const stats = computeStats(points);
                    days.push(
                        Object.assign(
                            {
                                id:
                                    "d" +
                                    Math.random().toString(36).slice(2, 9),
                                name: file.name.replace(/\.gpx$/i, ""),
                            },
                            stats,
                            { points },
                        ),
                    );
                } catch (err) {
                    console.error("Could not parse", file.name, err);
                    failed.push(file.name);
                } finally {
                    completed++;
                    pending--;
                    if (pending > 0)
                        showLoading(
                            "Reading GPX file " +
                                (completed + 1) +
                                " of " +
                                files.length +
                                "…",
                        );
                    if (pending === 0) finishImport(failed);
                }
            };
            reader.onerror = () => {
                failed.push(file.name);
                completed++;
                pending--;
                if (pending === 0) finishImport(failed);
            };
            reader.readAsText(file);
        });
    }

    function finishImport(failed) {
        hideLoading();
        if (!days.length) {
            errorBanner.innerHTML = `<b>Couldn't read ${failed.length === 1 ? "that file" : "those files"}.</b><br>Tripline expects standard GPX track files (.gpx) with &lt;trkpt&gt; points. ${failed.length ? "Failed: " + failed.join(", ") : ""}`;
            return;
        }
        if (failed.length) {
            errorBanner.innerHTML = `<b>Skipped ${failed.length} file${failed.length > 1 ? "s" : ""} that couldn't be read:</b> ${failed.join(", ")}`;
        }
        finalizeAndRender();
    }

    function parseGPX(text) {
        const clean = text.replace(/^\uFEFF/, "").trim();
        const doc = new DOMParser().parseFromString(clean, "application/xml");
        if (doc.getElementsByTagName("parsererror").length)
            throw new Error("bad xml");
        let nodes = Array.from(doc.getElementsByTagName("trkpt"));
        if (!nodes.length)
            nodes = Array.from(doc.getElementsByTagName("rtept"));
        if (!nodes.length) nodes = Array.from(doc.getElementsByTagName("wpt"));
        return nodes
            .map((pt) => {
                const lat = parseFloat(pt.getAttribute("lat"));
                const lon = parseFloat(pt.getAttribute("lon"));
                const eleNode = pt.getElementsByTagName("ele")[0];
                const timeNode = pt.getElementsByTagName("time")[0];
                let ele = eleNode ? parseFloat(eleNode.textContent) : 0;
                if (!isFinite(ele)) ele = 0;
                let time = null;
                if (timeNode) {
                    const t = new Date(timeNode.textContent);
                    if (!isNaN(t.getTime())) time = t;
                }
                return { lat, lon, ele, time };
            })
            .filter((p) => isFinite(p.lat) && isFinite(p.lon));
    }

    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1),
            dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
                Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function smooth(arr, window) {
        if (arr.length === 0) return arr;
        const out = new Array(arr.length);
        const half = Math.max(1, Math.floor(window / 2));
        for (let i = 0; i < arr.length; i++) {
            let sum = 0,
                n = 0;
            for (
                let j = Math.max(0, i - half);
                j <= Math.min(arr.length - 1, i + half);
                j++
            ) {
                sum += arr[j];
                n++;
            }
            out[i] = sum / n;
        }
        return out;
    }

    // The old window picked purely from point *count* (points.length/40, capped
    // at 21) conflated trip length with sampling rate: a long, densely-sampled
    // ride (e.g. 1Hz for hours) hit the 21-point cap, which is a 21-*second*
    // moving average — enough to flatten real rolling terrain, not just GPS/
    // barometer jitter. That, combined with a 3m hysteresis threshold, is why
    // gain/loss came out noticeably lower here than Strava or other analyzers:
    // it was filtering out real small climbs along with the noise. Sizing the
    // window from actual elapsed time (targeting ~8 seconds of smoothing) and
    // dropping the threshold to 1m keeps genuine terrain texture while still
    // rejecting single-sample spikes.
    function elevationSmoothingWindow(points) {
        const times = points.map((p) => p.time).filter(Boolean);
        if (times.length > 1) {
            const elapsedSec = (arrMax(times) - arrMin(times)) / 1000;
            const avgIntervalSec = elapsedSec / (points.length - 1);
            if (avgIntervalSec > 0 && isFinite(avgIntervalSec)) {
                const targetSeconds = 8;
                return Math.max(
                    3,
                    Math.min(15, Math.round(targetSeconds / avgIntervalSec)),
                );
            }
        }
        return 5; // no reliable timestamps to size the window from — light default
    }

    // Hysteresis gain/loss: only commits a change once it exceeds `threshold`
    // meters from the last committed point, so it's not sensitive to GPS/
    // barometer jitter the way a naive point-to-point diff sum would be.
    function gainLoss(elevs, threshold) {
        let gain = 0,
            loss = 0;
        if (elevs.length < 2) return { gain, loss };
        let anchor = elevs[0];
        for (let i = 1; i < elevs.length; i++) {
            const diff = elevs[i] - anchor;
            if (diff >= threshold) {
                gain += diff;
                anchor = elevs[i];
            } else if (diff <= -threshold) {
                loss += -diff;
                anchor = elevs[i];
            }
        }
        return { gain, loss };
    }

    // Same hysteresis walk as gainLoss, but instead of summing, it records
    // the [startIdx, endIdx] of each contiguous climbing streak — a run that
    // keeps gaining (allowing for sub-threshold jitter) until it gives back
    // more than `threshold` meters, which is where the descent begins.
    function findClimbs(elevs, cumDistKm, threshold) {
        const climbs = [];
        if (elevs.length < 2) return climbs;
        let anchorIdx = 0;
        let anchorEle = elevs[0];
        let climbStartIdx = null;
        for (let i = 1; i < elevs.length; i++) {
            const diff = elevs[i] - anchorEle;
            if (diff >= threshold) {
                if (climbStartIdx === null) climbStartIdx = anchorIdx;
                anchorEle = elevs[i];
                anchorIdx = i;
            } else if (diff <= -threshold) {
                if (climbStartIdx !== null) {
                    climbs.push({ startIdx: climbStartIdx, endIdx: anchorIdx });
                    climbStartIdx = null;
                }
                anchorEle = elevs[i];
                anchorIdx = i;
            }
        }
        if (climbStartIdx !== null)
            climbs.push({ startIdx: climbStartIdx, endIdx: anchorIdx });
        return climbs
            .map((c) => ({
                distKm: cumDistKm[c.endIdx] - cumDistKm[c.startIdx],
                gainM: elevs[c.endIdx] - elevs[c.startIdx],
            }))
            .filter((c) => c.gainM > 0 && c.distKm > 0);
    }

    function computeStats(points) {
        let distanceKm = 0;
        const cumDistKm = [0];
        const segSpeeds = [];
        let movingMs = 0;
        let longestStopMs = 0;
        let currentStopMs = 0;
        for (let i = 1; i < points.length; i++) {
            const d = haversine(
                points[i - 1].lat,
                points[i - 1].lon,
                points[i].lat,
                points[i].lon,
            );
            distanceKm += d;
            cumDistKm.push(distanceKm);
            if (points[i - 1].time && points[i].time) {
                const dtMs = points[i].time - points[i - 1].time;
                if (dtMs > 300) {
                    // >0.3s — just enough to avoid divide-by-near-zero, keeps 1s-interval devices intact
                    const spd = d / (dtMs / 3600000); // km/h
                    if (spd <= 100) segSpeeds.push(spd); // drop clear GPS-jump artifacts
                    if (spd > 1.5) {
                        movingMs += dtMs; // treat <=1.5km/h as stopped
                        if (currentStopMs > longestStopMs)
                            longestStopMs = currentStopMs;
                        currentStopMs = 0;
                    } else {
                        currentStopMs += dtMs;
                    }
                }
            }
        }
        // in case the recording ends mid-stop
        if (currentStopMs > longestStopMs) longestStopMs = currentStopMs;

        const smWindow = elevationSmoothingWindow(points);
        const elevs = smooth(
            points.map((p) => p.ele || 0),
            smWindow,
        );
        const { gain, loss } = gainLoss(elevs, 1);
        // Absolute high/low point of the day — distinct from gain/loss, which
        // only cares about cumulative up/down, not the actual altitude reached.
        const minEleM = elevs.length ? arrMin(elevs) : null;
        const maxEleM = elevs.length ? arrMax(elevs) : null;
        // Start/finish elevation (smoothed, so a single noisy sample at the
        // very first/last point doesn't skew the trip's net elevation change).
        const startEleM = elevs.length ? elevs[0] : null;
        const finishEleM = elevs.length ? elevs[elevs.length - 1] : null;

        // Longest (by distance) and biggest (by total climbed) contiguous
        // uphill segment of the day — these are frequently two *different*
        // climbs (a long gradual drag vs. a short brutal wall).
        const climbs = findClimbs(elevs, cumDistKm, 1);
        let longestClimbKm = null,
            longestClimbGainM = null,
            biggestClimbGainM = null,
            biggestClimbKm = null;
        climbs.forEach((c) => {
            if (longestClimbKm == null || c.distKm > longestClimbKm) {
                longestClimbKm = c.distKm;
                longestClimbGainM = c.gainM;
            }
            if (biggestClimbGainM == null || c.gainM > biggestClimbGainM) {
                biggestClimbGainM = c.gainM;
                biggestClimbKm = c.distKm;
            }
        });

        const times = points.map((p) => p.time).filter(Boolean);
        const startTime =
            times.length ? new Date(arrMin(times).getTime()) : null;
        const endTime = times.length ? new Date(arrMax(times).getTime()) : null;
        const elapsedMs =
            startTime && endTime && endTime > startTime ?
                endTime - startTime
            :   null;

        const avgSpeedElapsedKmh =
            elapsedMs ? distanceKm / (elapsedMs / 3600000) : null;
        const avgSpeedMovingKmh =
            movingMs > 0 ? distanceKm / (movingMs / 3600000) : null;

        let maxSpeedKmh = null;
        if (segSpeeds.length) {
            const smoothedSpeeds = smooth(segSpeeds, 5);
            maxSpeedKmh = arrMax(smoothedSpeeds);
        }

        return {
            distanceKm,
            gainM: gain,
            lossM: loss,
            minEleM,
            maxEleM,
            startEleM,
            finishEleM,
            elapsedMs,
            movingMs: movingMs > 0 ? movingMs : null,
            longestStopMs: longestStopMs > 0 ? longestStopMs : null,
            longestClimbKm,
            longestClimbGainM,
            biggestClimbGainM,
            biggestClimbKm,
            startTime,
            avgSpeedMovingKmh,
            avgSpeedElapsedKmh,
            maxSpeedKmh,
        };
    }

    function finalizeAndRender() {
        const withTime = days.filter((d) => d.startTime);
        if (withTime.length >= days.length * 0.5) {
            days.sort((a, b) => {
                if (a.startTime && b.startTime)
                    return a.startTime - b.startTime;
                if (a.startTime) return -1;
                if (b.startTime) return 1;
                return 0;
            });
        }
        days.forEach((d, i) => (d.color = PALETTE[i % PALETTE.length]));
        dropzoneWrap.style.display = "none";
        dashboard.classList.add("show");
        renderAll();
    }

    function fmtKm(km) {
        return km.toFixed(km < 10 ? 2 : 1);
    }
    function fmtDur(ms) {
        if (ms == null) return "—";
        const totalMin = Math.round(ms / 60000);
        const h = Math.floor(totalMin / 60),
            m = totalMin % 60;
        return h ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
    }
    function fmtDate(d, showYear) {
        if (!d) return "—";
        const opts = { month: "short", day: "numeric" };
        if (showYear) opts.year = "numeric";
        return d.toLocaleDateString(undefined, opts);
    }
    function fmtSpeed(kmh) {
        return kmh == null ? "—" : kmh.toFixed(1);
    }

    // True once the trip's days straddle a Dec→Jan boundary — the one case
    // where a bare "12 – 3" range (or per-row dates) becomes ambiguous.
    function daysSpanMultipleYears() {
        const years = days
            .filter((d) => d.startTime)
            .map((d) => d.startTime.getFullYear());
        if (years.length < 2) return false;
        return arrMin(years) !== arrMax(years);
    }

    // Single-year trip: year printed once, at the end ("12–16 Aug 2026").
    // Cross-year trip: year printed on both ends, since it's load-bearing.
    function formatDateRange(start, end) {
        if (!start || !end) return null;
        const sameYear = start.getFullYear() === end.getFullYear();
        return sameYear ?
                fmtDate(start, false) + " – " + fmtDate(end, true)
            :   fmtDate(start, true) + " – " + fmtDate(end, true);
    }

    function totals() {
        const distanceKm = days.reduce((s, d) => s + d.distanceKm, 0);
        const gainM = days.reduce((s, d) => s + d.gainM, 0);
        const lossM = days.reduce((s, d) => s + d.lossM, 0);

        const elapsedDays = days.filter((d) => d.elapsedMs != null);
        const elapsedMs =
            elapsedDays.length ?
                elapsedDays.reduce((s, d) => s + d.elapsedMs, 0)
            :   null;

        const movingDays = days.filter((d) => d.movingMs != null);
        const movingMs =
            movingDays.length ?
                movingDays.reduce((s, d) => s + d.movingMs, 0)
            :   null;

        const avgSpeedElapsedKmh =
            elapsedMs ? distanceKm / (elapsedMs / 3600000) : null;
        const avgSpeedMovingKmh =
            movingMs ? distanceKm / (movingMs / 3600000) : null;

        const dayMaxes = days
            .map((d) => d.maxSpeedKmh)
            .filter((v) => v != null);
        const maxSpeedKmh = dayMaxes.length ? arrMax(dayMaxes) : null;

        const movingPct =
            movingMs != null && elapsedMs ? (movingMs / elapsedMs) * 100 : null;

        const minEles = days.map((d) => d.minEleM).filter((v) => v != null);
        const maxEles = days.map((d) => d.maxEleM).filter((v) => v != null);
        const minEleM = minEles.length ? arrMin(minEles) : null;
        const maxEleM = maxEles.length ? arrMax(maxEles) : null;

        // Longest single day by distance (with which day, for the label)
        let longestDayKm = null,
            longestDayIdx = null;
        days.forEach((d, i) => {
            if (longestDayKm == null || d.distanceKm > longestDayKm) {
                longestDayKm = d.distanceKm;
                longestDayIdx = i;
            }
        });

        // Longest contiguous stop anywhere in the trip (a stop can't be
        // detected *between* days — the recording is off overnight — so
        // this is the longest pause *within* any single day's file)
        const stopDays = days
            .map((d) => d.longestStopMs)
            .filter((v) => v != null);
        const longestStopMs = stopDays.length ? arrMax(stopDays) : null;

        // Net elevation change: trip's first recorded point vs its last —
        // different story than gain/loss, which only tracks cumulative
        // up/down and says nothing about where you started vs ended up.
        const startEleM = days.length ? days[0].startEleM : null;
        const finishEleM =
            days.length ? days[days.length - 1].finishEleM : null;
        const netChangeM =
            startEleM != null && finishEleM != null ?
                finishEleM - startEleM
            :   null;

        // Longest and biggest climb across the whole trip — climbs are
        // detected per day (crossing a day boundary would compare elevations
        // from two separate recordings that may not be geographically
        // continuous), then the best of each kind is picked across all days.
        let longestClimbKm = null,
            longestClimbDayIdx = null,
            biggestClimbGainM = null,
            biggestClimbDayIdx = null;
        days.forEach((d, i) => {
            if (
                d.longestClimbKm != null &&
                (longestClimbKm == null || d.longestClimbKm > longestClimbKm)
            ) {
                longestClimbKm = d.longestClimbKm;
                longestClimbDayIdx = i;
            }
            if (
                d.biggestClimbGainM != null &&
                (biggestClimbGainM == null ||
                    d.biggestClimbGainM > biggestClimbGainM)
            ) {
                biggestClimbGainM = d.biggestClimbGainM;
                biggestClimbDayIdx = i;
            }
        });

        // N–S / E–W span of the whole route's bounding box — sampled every
        // 5th point (consistent with the sampling already used elsewhere for
        // bounds/map purposes) since this only needs to be approximately
        // right, not point-exact.
        let nsSpanKm = null,
            ewSpanKm = null;
        {
            const lats = [],
                lons = [];
            days.forEach((d) =>
                d.points.forEach((p, idx) => {
                    if (idx % 5 === 0) {
                        lats.push(p.lat);
                        lons.push(p.lon);
                    }
                }),
            );
            if (lats.length) {
                const latMin = arrMin(lats),
                    latMax = arrMax(lats);
                const lonMin = arrMin(lons),
                    lonMax = arrMax(lons);
                const latMid = (latMin + latMax) / 2,
                    lonMid = (lonMin + lonMax) / 2;
                nsSpanKm = haversine(latMin, lonMid, latMax, lonMid);
                ewSpanKm = haversine(latMid, lonMin, latMid, lonMax);
            }
        }

        return {
            distanceKm,
            gainM,
            lossM,
            elapsedMs,
            movingMs,
            movingPct,
            avgSpeedMovingKmh,
            avgSpeedElapsedKmh,
            maxSpeedKmh,
            minEleM,
            maxEleM,
            longestDayKm,
            longestDayIdx,
            longestStopMs,
            startEleM,
            netChangeM,
            longestClimbKm,
            longestClimbDayIdx,
            biggestClimbGainM,
            biggestClimbDayIdx,
            nsSpanKm,
            ewSpanKm,
        };
    }

    function renderAll() {
        const steps = [
            renderLedger,
            renderMap,
            renderElevation,
            renderDayTable,
            renderCard,
        ];
        steps.forEach((fn) => {
            try {
                fn();
            } catch (err) {
                console.error(fn.name + " failed:", err);
            }
        });
    }

    function fmtPct(p) {
        return p == null ? "—" : Math.round(p) + "%";
    }
    function fmtEle(m) {
        return m == null ? "—" : Math.round(m);
    }
    function fmtEleSigned(m) {
        if (m == null) return "—";
        const r = Math.round(m);
        return (r > 0 ? "+" : "") + r;
    }

    // Full stat set, grouped the way it reads in the app: what the route
    // covers, what the terrain did, how the time broke down, how fast it went.
    function statGroups(t) {
        return [
            {
                title: "Route",
                cells: [
                    {
                        label: "Distance",
                        value: fmtKm(t.distanceKm),
                        unit: "km",
                    },
                    { label: "Days", value: days.length, unit: "" },
                    {
                        label: "Avg / day",
                        value: fmtKm(t.distanceKm / Math.max(1, days.length)),
                        unit: "km",
                    },
                    {
                        label: "Longest day",
                        value:
                            t.longestDayKm != null ?
                                fmtKm(t.longestDayKm)
                            :   "—",
                        unit:
                            t.longestDayIdx != null ?
                                "km · Day " + (t.longestDayIdx + 1)
                            :   "km",
                    },
                    {
                        label: "N–S span",
                        value: t.nsSpanKm != null ? fmtKm(t.nsSpanKm) : "—",
                        unit: "km",
                    },
                    {
                        label: "E–W span",
                        value: t.ewSpanKm != null ? fmtKm(t.ewSpanKm) : "—",
                        unit: "km",
                    },
                ],
            },
            {
                title: "Elevation",
                cells: [
                    {
                        label: "Elevation gain",
                        value: Math.round(t.gainM),
                        unit: "m",
                    },
                    {
                        label: "Elevation loss",
                        value: Math.round(t.lossM),
                        unit: "m",
                    },
                    {
                        label: "Highest point",
                        value: fmtEle(t.maxEleM),
                        unit: "m",
                    },
                    {
                        label: "Lowest point",
                        value: fmtEle(t.minEleM),
                        unit: "m",
                    },
                    {
                        label: "Start elevation",
                        value: fmtEle(t.startEleM),
                        unit: "m",
                    },
                    {
                        label: "Net change",
                        value: fmtEleSigned(t.netChangeM),
                        unit: "m",
                    },
                    {
                        label: "Longest climb",
                        value:
                            t.longestClimbKm != null ?
                                fmtKm(t.longestClimbKm)
                            :   "—",
                        unit:
                            t.longestClimbDayIdx != null ?
                                "km · Day " + (t.longestClimbDayIdx + 1)
                            :   "km",
                    },
                    {
                        label: "Biggest climb",
                        value:
                            t.biggestClimbGainM != null ?
                                Math.round(t.biggestClimbGainM)
                            :   "—",
                        unit:
                            t.biggestClimbDayIdx != null ?
                                "m · Day " + (t.biggestClimbDayIdx + 1)
                            :   "m",
                    },
                ],
            },
            {
                title: "Time",
                cells: [
                    {
                        label: "Moving time",
                        value: fmtDur(t.movingMs),
                        unit: "",
                    },
                    {
                        label: "Elapsed time",
                        value: fmtDur(t.elapsedMs),
                        unit: "",
                    },
                    { label: "Moving %", value: fmtPct(t.movingPct), unit: "" },
                    {
                        label: "Longest stop",
                        value: fmtDur(t.longestStopMs),
                        unit: "",
                    },
                ],
            },
            {
                title: "Speed",
                cells: [
                    {
                        label: "Avg speed (moving)",
                        value: fmtSpeed(t.avgSpeedMovingKmh),
                        unit: "km/h",
                    },
                    {
                        label: "Avg speed (total)",
                        value: fmtSpeed(t.avgSpeedElapsedKmh),
                        unit: "km/h",
                    },
                    {
                        label: "Max speed",
                        value: fmtSpeed(t.maxSpeedKmh),
                        unit: "km/h",
                    },
                ],
            },
        ];
    }

    // Smaller, curated flat list for the shareable card — the full grouped
    // ledger is great in the app, but a share card reads better as one clean
    // "greatest hits" grid rather than four labeled sections.
    function cardStatCells(t) {
        return [
            { label: "Distance", value: fmtKm(t.distanceKm), unit: "km" },
            { label: "Days", value: days.length, unit: "" },
            { label: "Elevation gain", value: Math.round(t.gainM), unit: "m" },
            { label: "Elevation loss", value: Math.round(t.lossM), unit: "m" },
            { label: "Moving time", value: fmtDur(t.movingMs), unit: "" },
            {
                label: "Avg speed",
                value: fmtSpeed(t.avgSpeedMovingKmh),
                unit: "km/h",
            },
            {
                label: "Max speed",
                value: fmtSpeed(t.maxSpeedKmh),
                unit: "km/h",
            },
            { label: "Highest point", value: fmtEle(t.maxEleM), unit: "m" },
        ];
    }

    function gridRowsHtml(cells, chunkSize) {
        let html = "";
        for (let i = 0; i < cells.length; i += chunkSize) {
            const row = cells.slice(i, i + chunkSize);
            html +=
                `<div class="stat-row" style="grid-template-columns:repeat(${row.length},1fr)">` +
                row
                    .map(
                        (c) => `
        <div class="cell">
          <div class="label">${c.label}</div>
          <div class="value">${c.value}${c.unit ? '<span class="unit">' + c.unit + "</span>" : ""}</div>
        </div>`,
                    )
                    .join("") +
                `</div>`;
        }
        return html;
    }

    function renderLedger() {
        const t = totals();
        const groups = statGroups(t);
        document.getElementById("ledger").innerHTML = groups
            .map(
                (g) => `
      <div class="stat-head">${g.title}</div>
      <div class="ledger">${gridRowsHtml(g.cells, 4)}</div>
    `,
            )
            .join("");
        const dates = days.filter((d) => d.startTime);
        const dateRange =
            dates.length ?
                formatDateRange(
                    dates[0].startTime,
                    dates[dates.length - 1].startTime,
                ) || days.length + " days logged"
            :   days.length + " days logged";
        document.getElementById("cardDates").textContent = dateRange;
    }

    function renderMap() {
        if (!leafletMap) {
            leafletMap = L.map("map", {
                zoomControl: true,
                attributionControl: true,
            });
            L.tileLayer(
                "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                {
                    maxZoom: 18,
                    attribution: "&copy; OpenStreetMap &copy; CARTO",
                },
            ).addTo(leafletMap);
        }
        dayLayers.forEach((l) => leafletMap.removeLayer(l));
        dayLayers = [];
        const allBounds = [];
        days.forEach((day, i) => {
            const latlngs = day.points.map((p) => [p.lat, p.lon]);
            const routeColor = colorRouteByDay ? day.color : "#E9E3D0";

            const line = L.polyline(latlngs, {
                color: routeColor,
                weight: 3.5,
                opacity: 0.95,
            }).addTo(leafletMap);
            dayLayers.push(line);
            const start = latlngs[0];
            const marker = L.marker(start, {
                icon: L.divIcon({
                    className: "",
                    html: `<div class="day-pin" style="background:${day.color}">${i + 1}</div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11],
                }),
            }).addTo(leafletMap);
            dayLayers.push(marker);
            allBounds.push(...latlngs);
        });
        if (allBounds.length)
            leafletMap.fitBounds(allBounds, { padding: [24, 24] });
        setTimeout(() => {
            try {
                leafletMap.invalidateSize();
            } catch (e) {}
        }, 200);
    }

    function buildSeries() {
        let cum = 0;
        const series = [];
        const dayBoundaries = [0];
        const dayIndexRanges = [];
        days.forEach((day) => {
            const smWindow = elevationSmoothingWindow(day.points);
            const elevs = smooth(
                day.points.map((p) => p.ele || 0),
                smWindow,
            );
            const startIdx = series.length;
            let prev = null;
            day.points.forEach((p, i) => {
                if (prev) cum += haversine(prev.lat, prev.lon, p.lat, p.lon);
                series.push({ dist: cum, ele: elevs[i] });
                prev = p;
            });
            dayIndexRanges.push({ start: startIdx, end: series.length - 1 });
            dayBoundaries.push(cum);
        });
        return { series, dayBoundaries, dayIndexRanges, total: cum };
    }

    function drawElevationInto(svgEl, opts) {
        opts = opts || {};
        const vb = svgEl.viewBox.baseVal;
        const W = vb.width,
            H = vb.height;
        const pad = {
            left: opts.compact ? 4 : 34,
            right: 10,
            top: opts.compact ? 10 : 22,
            bottom: opts.compact ? 4 : 26,
        };
        const { series, dayBoundaries, dayIndexRanges, total } = buildSeries();
        if (!series.length || total <= 0) {
            svgEl.innerHTML = "";
            return;
        }

        const eles = series.map((p) => p.ele);
        let minE = arrMin(eles),
            maxE = arrMax(eles);
        if (maxE - minE < 20) {
            const mid = (maxE + minE) / 2;
            minE = mid - 10;
            maxE = mid + 10;
        }
        const pb = (maxE - minE) * 0.12;
        minE -= pb;
        maxE += pb;

        const x = (d) => pad.left + (d / total) * (W - pad.left - pad.right);
        const y = (e) =>
            H -
            pad.bottom -
            ((e - minE) / (maxE - minE)) * (H - pad.top - pad.bottom);

        const maxPts = 500;
        const stride = Math.max(1, Math.floor(series.length / maxPts));

        let svg = "";
        days.forEach((day, di) => {
            const range = dayIndexRanges[di];
            if (!range) return;
            const segPts = [];
            for (let i = range.start; i <= range.end; i += stride)
                segPts.push(series[i]);
            if (segPts[segPts.length - 1] !== series[range.end])
                segPts.push(series[range.end]);
            if (segPts.length < 2) return;

            // Color elevation by day or use one neutral color
            const color =
                colorElevationByDay ? PALETTE[di % PALETTE.length] : "#E9E3D0";

            let path = "M " + x(segPts[0].dist) + " " + y(segPts[0].ele);
            segPts.forEach((p) => {
                path += " L " + x(p.dist) + " " + y(p.ele);
            });
            const areaPath =
                path +
                ` L ${x(segPts[segPts.length - 1].dist)} ${H - pad.bottom} L ${x(segPts[0].dist)} ${H - pad.bottom} Z`;
            svg += `<path d="${areaPath}" fill="${color}" opacity="0.16"></path>`;
            svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${opts.compact ? 2 : 2.2}" stroke-linejoin="round" stroke-linecap="round"></path>`;
        });

        if (!opts.compact) {
            for (let i = 1; i < dayBoundaries.length - 1; i++) {
                const xd = x(dayBoundaries[i]);
                svg += `<line x1="${xd}" y1="${pad.top}" x2="${xd}" y2="${H - pad.bottom}" stroke="#3A4038" stroke-dasharray="3,4"></line>`;
            }
            days.forEach((d, i) => {
                const mid = (dayBoundaries[i] + dayBoundaries[i + 1]) / 2;
                svg += `<text x="${x(mid)}" y="${pad.top - 8}" fill="${d.color}" font-family="IBM Plex Mono, monospace" font-size="11" text-anchor="middle" font-weight="600">${i + 1}</text>`;
            });
            svg += `<text x="${pad.left - 6}" y="${y(maxE - pb) + 4}" fill="#9AA096" font-family="IBM Plex Mono, monospace" font-size="10" text-anchor="end">${Math.round(maxE - pb)}m</text>`;
            svg += `<text x="${pad.left - 6}" y="${y(minE + pb) + 4}" fill="#9AA096" font-family="IBM Plex Mono, monospace" font-size="10" text-anchor="end">${Math.round(minE + pb)}m</text>`;
        }

        svgEl.innerHTML = svg;
    }

    function renderElevation() {
        drawElevationInto(document.getElementById("elevSvg"), {
            compact: false,
        });
        const legend = document.getElementById("elevLegend");
        legend.innerHTML = days
            .map(
                (d, i) =>
                    `<div class="item"><span class="swatch" style="background:${d.color}"></span>Day ${i + 1} · ${d.name}</div>`,
            )
            .join("");
    }

    function renderDayTable() {
        const tbody = document.getElementById("dayRows");
        const spansYears = daysSpanMultipleYears();
        tbody.innerHTML = days
            .map(
                (d, i) => `
      <tr>
        <td><span class="day-num" style="background:${d.color}">${i + 1}</span></td>
        <td>${fmtDate(d.startTime, spansYears)}<div class="filename">${d.name}</div></td>
        <td>${fmtKm(d.distanceKm)} km</td>
        <td><span class="up-txt">+${Math.round(d.gainM)}</span> / <span class="down-txt">&minus;${Math.round(d.lossM)}</span> m</td>
        <td>${fmtDur(d.movingMs)}</td>
        <td>${fmtSpeed(d.avgSpeedMovingKmh != null ? d.avgSpeedMovingKmh : d.avgSpeedElapsedKmh)} km/h</td>
        <td>${fmtSpeed(d.maxSpeedKmh)} km/h</td>
        <td>
          <div class="row-actions">
            <button data-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
            <button data-act="down" data-i="${i}" ${i === days.length - 1 ? "disabled" : ""}>↓</button>
            <button data-act="del" data-i="${i}" class="danger">×</button>
          </div>
        </td>
      </tr>
    `,
            )
            .join("");
        tbody.querySelectorAll("button").forEach((btn) => {
            btn.addEventListener("click", () => {
                const i = parseInt(btn.dataset.i, 10);
                const act = btn.dataset.act;
                if (act === "up" && i > 0) {
                    [days[i - 1], days[i]] = [days[i], days[i - 1]];
                }
                if (act === "down" && i < days.length - 1) {
                    [days[i + 1], days[i]] = [days[i], days[i + 1]];
                }
                if (act === "del") {
                    days.splice(i, 1);
                }
                days.forEach(
                    (d, idx) => (d.color = PALETTE[idx % PALETTE.length]),
                );
                if (!days.length) {
                    dashboard.classList.remove("show");
                    dropzoneWrap.style.display = "block";
                    return;
                }
                renderAll();
            });
        });
    }

    // Real basemap for the shareable card — drawn by hand onto a plain <canvas>
    // instead of embedding a live Leaflet map. A live Leaflet map positions its
    // tiles with CSS transforms and loads them asynchronously, and html2canvas
    // does not reliably capture that (it's a well-known source of maps coming
    // out shifted, cropped, or the wrong zoom in the exported image — no matter
    // how carefully the live map's own fit/invalidate timing is tuned). Drawing
    // the tiles and route ourselves with the same Web Mercator math real tile
    // servers use means the canvas *is* the export — there's no live view that
    // can go stale, and html2canvas just has to copy a canvas's pixels, which
    // it does reliably.
    const TILE_SIZE = 256;
    function mercatorProject(lat, lon, zoom) {
        const scale = TILE_SIZE * Math.pow(2, zoom);
        const sinLat = Math.min(
            Math.max(Math.sin((lat * Math.PI) / 180), -0.9999),
            0.9999,
        );
        const x = ((lon + 180) / 360) * scale;
        const y =
            (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
            scale;
        return { x, y };
    }
    function chooseMapZoom(latMin, latMax, lonMin, lonMax, availW, availH) {
        for (let z = 17; z >= 1; z--) {
            const nw = mercatorProject(latMax, lonMin, z);
            const se = mercatorProject(latMin, lonMax, z);
            if (
                Math.abs(se.x - nw.x) <= availW &&
                Math.abs(se.y - nw.y) <= availH
            )
                return z;
        }
        return 1;
    }
    function loadTileImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null); // one bad tile shouldn't sink the whole map
            img.src = src;
        });
    }
    const TILE_SUBDOMAINS = ["a", "b", "c", "d"];
    let tileSubIdx = 0;
    function cartoTileUrl(z, x, y) {
        const s = TILE_SUBDOMAINS[tileSubIdx++ % TILE_SUBDOMAINS.length];
        return `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}@2x.png`;
    }

    let cardMapDrawToken = 0; // lets a fast re-render cancel a slower in-flight draw

    async function drawCardMap() {
        const canvas = document.getElementById("cardMapCanvas");
        const loadingEl = document.getElementById("cardMapLoading");
        if (!canvas) return;
        const myToken = ++cardMapDrawToken;
        if (loadingEl) loadingEl.classList.remove("hidden");

        // The map area's own shape now depends on the chosen card format (a
        // 9:16 story leaves it tall, a landscape card leaves it short and
        // wide) — read the actual rendered box rather than assuming a fixed
        // 1000x440, and fall back to that only if the container isn't
        // laid out yet for some reason.
        const wrapEl = canvas.parentElement;
        const rect = wrapEl ? wrapEl.getBoundingClientRect() : null;
        const aspect =
            rect && rect.width > 0 && rect.height > 0 ?
                rect.height / rect.width
            :   0.44;
        const logicalW = 1000,
            logicalH = Math.round(logicalW * aspect),
            dpr = 2;
        const ctx = canvas.getContext("2d");
        canvas.width = logicalW * dpr;
        canvas.height = logicalH * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0E1416";
        ctx.fillRect(0, 0, logicalW, logicalH);

        const dayPointSets = days.map((day) =>
            day.points.filter((p, idx) => idx % 4 === 0),
        );
        const lats = [],
            lons = [];
        dayPointSets.forEach((pts) =>
            pts.forEach((p) => {
                lats.push(p.lat);
                lons.push(p.lon);
            }),
        );
        if (!lats.length) {
            if (loadingEl) loadingEl.classList.add("hidden");
            return;
        }

        const latMin = arrMin(lats),
            latMax = arrMax(lats);
        const lonMin = arrMin(lons),
            lonMax = arrMax(lons);
        const pad = 26;
        const zoom = chooseMapZoom(
            latMin,
            latMax,
            lonMin,
            lonMax,
            logicalW - pad * 2,
            logicalH - pad * 2,
        );
        const centerLat = (latMin + latMax) / 2,
            centerLon = (lonMin + lonMax) / 2;
        const centerPx = mercatorProject(centerLat, centerLon, zoom);
        const leftPx = centerPx.x - logicalW / 2;
        const topPx = centerPx.y - logicalH / 2;

        const worldTiles = Math.pow(2, zoom);
        const txStart = Math.floor(leftPx / TILE_SIZE);
        const txEnd = Math.floor((leftPx + logicalW) / TILE_SIZE);
        const tyStart = Math.floor(topPx / TILE_SIZE);
        const tyEnd = Math.floor((topPx + logicalH) / TILE_SIZE);

        const jobs = [];
        for (let tx = txStart; tx <= txEnd; tx++) {
            for (let ty = tyStart; ty <= tyEnd; ty++) {
                if (ty < 0 || ty >= worldTiles) continue;
                let wx = tx % worldTiles;
                if (wx < 0) wx += worldTiles;
                jobs.push({ tx, ty, wx });
            }
        }

        const loaded = await Promise.all(
            jobs.map((j) =>
                loadTileImage(cartoTileUrl(zoom, j.wx, j.ty)).then((img) => ({
                    ...j,
                    img,
                })),
            ),
        );
        if (myToken !== cardMapDrawToken) return; // a newer render superseded this one

        loaded.forEach(({ tx, ty, img }) => {
            if (!img) return;
            const dx = tx * TILE_SIZE - leftPx;
            const dy = ty * TILE_SIZE - topPx;
            try {
                ctx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE);
            } catch (e) {}
        });

        const toCanvasXY = (p) => {
            const proj = mercatorProject(p.lat, p.lon, zoom);
            return [proj.x - leftPx, proj.y - topPx];
        };
        days.forEach((day, i) => {
            const pts = dayPointSets[i];
            if (pts.length < 2) return;
            const drawPath = () => {
                ctx.beginPath();
                const [x0, y0] = toCanvasXY(pts[0]);
                ctx.moveTo(x0, y0);
                pts.forEach((p) => {
                    const [x, y] = toCanvasXY(p);
                    ctx.lineTo(x, y);
                });
            };
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            drawPath();
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = "#0B0F10";
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.globalAlpha = 1;
            drawPath();
            ctx.strokeStyle = colorRouteByDay ? day.color : "#E9E3D0";
            ctx.lineWidth = 3.2;
            ctx.stroke();
        });

        if (loadingEl) loadingEl.classList.add("hidden");
    }

    function renderCard() {
        const t = totals();
        const title =
            document.getElementById("tripTitle").value || "Untitled Trip";
        document.getElementById("cardTitle").textContent = title;
        const subtitle = document.getElementById("tripSubtitle").value;
        const subEl = document.getElementById("cardSubtitle");
        subEl.textContent = subtitle;
        subEl.style.display = subtitle ? "block" : "none";
        document.getElementById("cardGrid").innerHTML = gridRowsHtml(
            cardStatCells(t),
            4,
        );
        drawCardMap();
        drawElevationInto(document.getElementById("cardElevSvg"), {
            compact: true,
        });
    }

    function downloadCard() {
        const btn = document.getElementById("downloadBtn");
        const originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Preparing…";

        // The canvas map is drawn from scratch (tiles fetched, route stroked) on
        // every renderCard() call, so just re-run it and wait for it to finish —
        // there's no live map view that can be "stale," it's whatever's actually
        // been painted onto the canvas.
        drawCardMap()
            .catch(() => {})
            .then(() => {
                const el = document.getElementById("tripCard");
                html2canvas(el, {
                    backgroundColor: "#12181A",
                    scale: 2,
                    useCORS: true,
                })
                    .then((canvas) => {
                        const link = document.createElement("a");
                        link.download =
                            (
                                document.getElementById("tripTitle").value ||
                                "trip"
                            )
                                .trim()
                                .replace(/\s+/g, "-")
                                .toLowerCase() + ".png";
                        link.href = canvas.toDataURL("image/png");
                        link.click();
                    })
                    .catch((err) => {
                        console.error("Card export failed:", err);
                    })
                    .finally(() => {
                        btn.disabled = false;
                        btn.textContent = originalLabel;
                    });
            });
    }

    const helpButton = document.querySelector(".help-button");
    const helpPopover = document.querySelector(".help-popover");

    if (helpButton && helpPopover) {
        helpButton.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = helpPopover.classList.toggle("show");
            helpButton.classList.toggle("active", isOpen);
        });

        document.addEventListener("click", () => {
            helpPopover.classList.remove("show");
            helpButton.classList.remove("active");
        });

        helpPopover.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    window.__tripline_internal = {
        handleFiles,
        parseGPX,
        computeStats,
        gainLoss,
        smooth,
        haversine,
        buildSeries,
        arrMin,
        arrMax,

        getDays: () => days,

        setDays: (newDays) => {
            days = newDays;
        },

        showLoading,
        hideLoading,

        finalizeAndRender,
    };
})();