async function loadDemo() {
    const {
        parseGPX,
        computeStats,
        setDays,
        showLoading,
        hideLoading,
        finalizeAndRender,
    } = window.__tripline_internal;

    const files = [
        "Morning_Ride.gpx",
        "Morning_Ride(1).gpx",
        "Morning_Ride(2).gpx",
        "Morning_Ride(3).gpx",
        "Lunch_Ride.gpx",
    ];

    const days = [];
    const failed = [];

    const errorBanner = document.getElementById("errorBanner");

    errorBanner.innerHTML = "";

    showLoading("Loading demo GPX files…");

    for (let i = 0; i < files.length; i++) {
        const fileName = files[i];

        showLoading(`Reading demo GPX file ${i + 1} of ${files.length}…`);

        try {
            const response = await fetch(
                `./demo/${encodeURIComponent(fileName)}`,
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const gpxText = await response.text();

            const points = parseGPX(gpxText);

            if (points.length < 2) {
                throw new Error("No usable track points found");
            }

            const stats = computeStats(points);

            days.push({
                id: `demo-${i}`,
                name: fileName.replace(/\.gpx$/i, ""),
                ...stats,
                points,
            });
        } catch (err) {
            console.error("Could not load demo GPX:", fileName, err);

            failed.push(fileName);
        }
    }

    hideLoading();

    if (!days.length) {
        errorBanner.innerHTML =
            `<b>Couldn't load demo GPX files.</b><br>` +
            `Make sure the GPX files are in the <code>./demo/</code> folder.`;

        return;
    }

    if (failed.length) {
        errorBanner.innerHTML =
            `<b>Skipped ${failed.length} demo file${failed.length > 1 ? "s" : ""}:</b> ` +
            failed.join(", ");
    }

    setDays(days);

    document.getElementById("tripTitle").value = "Praha to Lipno";

    document.getElementById("tripSubtitle").value =
        "A scenic ride through the Czech countryside";

    finalizeAndRender();
}

document.getElementById("demoBtn").addEventListener("click", loadDemo);
