const state = {
    info: null,
    episodeData: null,
    currentEpisode: null,
    currentFrame: 0,
    isPlaying: false,
    playbackSpeed: 1.0,
    videoElements: [],
    animFrameId: null,
    playStartTime: 0,
    playStartFrame: 0,
};

const CHART_LAYOUT_BASE = {
    template: "plotly_dark",
    paper_bgcolor: "#16213e",
    plot_bgcolor: "#0f1a2e",
    margin: { l: 60, r: 20, t: 30, b: 60 },
    height: 200,
    legend: { orientation: "h", y: -0.35, font: { size: 9 }, traceorder: "normal" },
    xaxis: { title: "", gridcolor: "#1a2744" },
    yaxis: { gridcolor: "#1a2744" },
    shapes: [],
};

function cursorShape(frame) {
    return {
        type: "line",
        x0: frame, x1: frame,
        y0: 0, y1: 1,
        yref: "paper",
        line: { color: "#ff4444", width: 2, dash: "dash" },
    };
}

// Left arm color palette (blues/cyans)
const LEFT_COLORS = [
    "#00d4ff", "#00a8cc", "#0088aa", "#006688",
    "#00bbdd", "#0099bb", "#007799",
];
// Right arm color palette (oranges/yellows)
const RIGHT_COLORS = [
    "#ff8c00", "#ffaa33", "#ffcc66", "#ff7700",
    "#ffbb44", "#ff9922", "#ffdd77",
];
const BASE_COLORS = ["#00ff88", "#ff44aa"];

async function init() {
    try {
        const resp = await fetch("/api/info");
        state.info = await resp.json();
    } catch (e) {
        document.body.innerHTML = '<div style="color:#ff4444;padding:40px;text-align:center;">' +
            '<h2>Cannot connect to server</h2>' +
            '<p>Make sure the server is running: <code>python server.py --dataset /path/to/data</code></p></div>';
        return;
    }

    populateEpisodeSelector();
    setupControls();
    setupKeyboard();

    // Load first available episode
    if (state.info.available_episodes.length > 0) {
        const firstIdx = state.info.available_episodes[0].episode_index;
        document.getElementById("episode-select").value = firstIdx;
        await loadEpisode(firstIdx);
    }
}

function populateEpisodeSelector() {
    const select = document.getElementById("episode-select");
    select.innerHTML = "";
    for (const ep of state.info.available_episodes) {
        const opt = document.createElement("option");
        opt.value = ep.episode_index;
        opt.textContent = `Episode ${ep.episode_index} (${ep.length} frames)`;
        select.appendChild(opt);
    }
    select.addEventListener("change", () => {
        loadEpisode(parseInt(select.value));
    });
}

async function loadEpisode(episodeIndex) {
    pausePlayback();
    state.currentEpisode = episodeIndex;

    // Fetch episode data and video list in parallel
    const [dataResp, videosResp] = await Promise.all([
        fetch(`/api/episode/${episodeIndex}`),
        fetch(`/api/videos/${episodeIndex}`),
    ]);

    state.episodeData = await dataResp.json();
    const videos = await videosResp.json();

    // Update episode info
    const ep = state.info.available_episodes.find(e => e.episode_index === episodeIndex);
    document.getElementById("episode-info").textContent =
        ep ? `${ep.length} frames, ${(ep.length / state.info.fps).toFixed(1)}s` : "";

    // Create video elements
    createVideoElements(videos);

    // Set timeline range
    const timeline = document.getElementById("timeline");
    timeline.max = state.episodeData.length - 1;
    timeline.value = 0;

    // Render charts
    renderCharts();

    // Seek to start
    seekToFrame(0);
}

function createVideoElements(videos) {
    const container = document.getElementById("video-container");
    container.innerHTML = "";
    state.videoElements = [];

    // Reorder: put cam_high in the center position
    const highIdx = videos.findIndex(v => v.label === "cam_high");
    if (highIdx >= 0 && videos.length === 3) {
        const high = videos.splice(highIdx, 1)[0];
        videos.splice(1, 0, high);
    }

    for (const v of videos) {
        const wrapper = document.createElement("div");
        wrapper.className = "video-wrapper";

        const label = document.createElement("div");
        label.className = "video-label";
        label.textContent = v.label;
        wrapper.appendChild(label);

        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = v.url;
        wrapper.appendChild(video);

        container.appendChild(wrapper);
        state.videoElements.push(video);
    }

    // Wait for all videos to be ready
    return Promise.all(
        state.videoElements.map(
            v => new Promise(resolve => {
                if (v.readyState >= 2) resolve();
                else v.addEventListener("loadeddata", resolve, { once: true });
            })
        )
    );
}

function renderCharts() {
    const d = state.episodeData;
    const frames = d.frame_indices;
    const names = d.state_names;
    const actionNames = d.action_names;

    // Split into left arm (0-6), right arm (7-13), base (14-15)
    const leftJointIndices = [];
    const rightJointIndices = [];
    const baseIndices = [];

    for (let i = 0; i < names.length; i++) {
        if (names[i] === "linear_vel" || names[i] === "angular_vel") {
            baseIndices.push(i);
        } else if (names[i].startsWith("left_")) {
            leftJointIndices.push(i);
        } else if (names[i].startsWith("right_")) {
            rightJointIndices.push(i);
        }
    }

    // Joint Positions chart
    const stateTraces = [];
    leftJointIndices.forEach((idx, ci) => {
        stateTraces.push({
            x: frames,
            y: d.observation_state.map(row => row[idx]),
            name: names[idx],
            line: { color: LEFT_COLORS[ci % LEFT_COLORS.length], width: 1.5 },
            type: "scattergl",
            mode: "lines",
        });
    });
    rightJointIndices.forEach((idx, ci) => {
        stateTraces.push({
            x: frames,
            y: d.observation_state.map(row => row[idx]),
            name: names[idx],
            line: { color: RIGHT_COLORS[ci % RIGHT_COLORS.length], width: 1.5 },
            type: "scattergl",
            mode: "lines",
        });
    });

    Plotly.newPlot("chart-state", stateTraces, {
        ...CHART_LAYOUT_BASE,
        margin: { ...CHART_LAYOUT_BASE.margin, t: 10 },
        yaxis: { ...CHART_LAYOUT_BASE.yaxis, title: "Position (rad)" },
        shapes: [cursorShape(0)],
    }, { responsive: true, displayModeBar: false });

    // Commanded Actions chart
    const actionTraces = [];
    leftJointIndices.forEach((idx, ci) => {
        actionTraces.push({
            x: frames,
            y: d.action.map(row => row[idx]),
            name: actionNames[idx],
            line: { color: LEFT_COLORS[ci % LEFT_COLORS.length], width: 1.5 },
            type: "scattergl",
            mode: "lines",
        });
    });
    rightJointIndices.forEach((idx, ci) => {
        actionTraces.push({
            x: frames,
            y: d.action.map(row => row[idx]),
            name: actionNames[idx],
            line: { color: RIGHT_COLORS[ci % RIGHT_COLORS.length], width: 1.5 },
            type: "scattergl",
            mode: "lines",
        });
    });

    Plotly.newPlot("chart-action", actionTraces, {
        ...CHART_LAYOUT_BASE,
        margin: { ...CHART_LAYOUT_BASE.margin, t: 10 },
        yaxis: { ...CHART_LAYOUT_BASE.yaxis, title: "Position (rad)" },
        shapes: [cursorShape(0)],
    }, { responsive: true, displayModeBar: false });

    // Base Velocity chart
    const baseTraces = [];
    baseIndices.forEach((idx, ci) => {
        baseTraces.push({
            x: frames,
            y: d.observation_state.map(row => row[idx]),
            name: `${names[idx]} (state)`,
            line: { color: BASE_COLORS[ci], width: 1.5 },
            type: "scattergl",
            mode: "lines",
        });
        baseTraces.push({
            x: frames,
            y: d.action.map(row => row[idx]),
            name: `${actionNames[idx]} (action)`,
            line: { color: BASE_COLORS[ci], width: 1.5, dash: "dash" },
            type: "scattergl",
            mode: "lines",
        });
    });

    Plotly.newPlot("chart-base", baseTraces, {
        ...CHART_LAYOUT_BASE,
        margin: { ...CHART_LAYOUT_BASE.margin, t: 10 },
        yaxis: { ...CHART_LAYOUT_BASE.yaxis, title: "Velocity" },
        shapes: [cursorShape(0)],
    }, { responsive: true, displayModeBar: false });

    // Click-to-seek on charts
    for (const chartId of ["chart-state", "chart-action", "chart-base"]) {
        document.getElementById(chartId).on("plotly_click", (data) => {
            if (data.points.length > 0) {
                seekToFrame(Math.round(data.points[0].x));
            }
        });
    }

    // Resize Plotly charts when collapsible sections are toggled
    for (const details of document.querySelectorAll(".chart-section")) {
        details.addEventListener("toggle", () => {
            if (details.open) {
                const chart = details.querySelector(".chart-container");
                if (chart) Plotly.Plots.resize(chart);
            }
        });
    }
}

function updateChartCursor(frame) {
    const shape = [cursorShape(frame)];
    for (const chartId of ["chart-state", "chart-action", "chart-base"]) {
        const el = document.getElementById(chartId);
        if (el && el.closest("details[open]")) {
            Plotly.relayout(chartId, { shapes: shape });
        }
    }
}

function seekToFrame(frame) {
    if (!state.episodeData) return;
    frame = Math.max(0, Math.min(frame, state.episodeData.length - 1));
    state.currentFrame = frame;

    const time = frame / state.info.fps;
    for (const video of state.videoElements) {
        video.currentTime = time;
    }

    document.getElementById("timeline").value = frame;
    document.getElementById("frame-display").textContent =
        `Frame: ${frame} / ${state.episodeData.length - 1}`;

    updateChartCursor(frame);
}

function startPlayback() {
    if (state.isPlaying) return;
    if (!state.episodeData) return;

    // If at end, restart
    if (state.currentFrame >= state.episodeData.length - 1) {
        seekToFrame(0);
    }

    state.isPlaying = true;
    state.playStartTime = performance.now();
    state.playStartFrame = state.currentFrame;

    document.getElementById("btn-play").textContent = "\u23F8"; // pause icon

    for (const video of state.videoElements) {
        video.playbackRate = state.playbackSpeed;
        video.play().catch(() => {});
    }

    state.animFrameId = requestAnimationFrame(syncLoop);
}

function pausePlayback() {
    if (!state.isPlaying) return;
    state.isPlaying = false;

    document.getElementById("btn-play").textContent = "\u25B6"; // play icon

    cancelAnimationFrame(state.animFrameId);

    for (const video of state.videoElements) {
        video.pause();
    }
}

function syncLoop(timestamp) {
    if (!state.isPlaying) return;

    const elapsed = (timestamp - state.playStartTime) / 1000;
    const expectedFrame = state.playStartFrame +
        Math.floor(elapsed * state.info.fps * state.playbackSpeed);
    const maxFrame = state.episodeData.length - 1;

    if (expectedFrame >= maxFrame) {
        seekToFrame(maxFrame);
        pausePlayback();
        return;
    }

    if (expectedFrame !== state.currentFrame) {
        state.currentFrame = expectedFrame;
        document.getElementById("timeline").value = expectedFrame;
        document.getElementById("frame-display").textContent =
            `Frame: ${expectedFrame} / ${maxFrame}`;
        updateChartCursor(expectedFrame);
    }

    // Drift correction every ~60 frames
    if (expectedFrame % 60 === 0) {
        const expectedTime = state.currentFrame / state.info.fps;
        for (const video of state.videoElements) {
            if (Math.abs(video.currentTime - expectedTime) > 0.1) {
                video.currentTime = expectedTime;
            }
        }
    }

    state.animFrameId = requestAnimationFrame(syncLoop);
}

function setupControls() {
    document.getElementById("btn-play").addEventListener("click", () => {
        if (state.isPlaying) pausePlayback();
        else startPlayback();
    });

    document.getElementById("btn-prev").addEventListener("click", () => {
        pausePlayback();
        seekToFrame(state.currentFrame - 1);
    });

    document.getElementById("btn-next").addEventListener("click", () => {
        pausePlayback();
        seekToFrame(state.currentFrame + 1);
    });

    document.getElementById("btn-first").addEventListener("click", () => {
        pausePlayback();
        seekToFrame(0);
    });

    document.getElementById("btn-last").addEventListener("click", () => {
        if (state.episodeData) {
            pausePlayback();
            seekToFrame(state.episodeData.length - 1);
        }
    });

    document.getElementById("timeline").addEventListener("input", (e) => {
        pausePlayback();
        seekToFrame(parseInt(e.target.value));
    });

    document.getElementById("speed-select").addEventListener("change", (e) => {
        state.playbackSpeed = parseFloat(e.target.value);
        if (state.isPlaying) {
            for (const video of state.videoElements) {
                video.playbackRate = state.playbackSpeed;
            }
            // Reset sync baseline
            state.playStartTime = performance.now();
            state.playStartFrame = state.currentFrame;
        }
    });
}

function setupKeyboard() {
    document.addEventListener("keydown", (e) => {
        // Ignore if typing in a select/input
        if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;

        switch (e.code) {
            case "Space":
                e.preventDefault();
                if (state.isPlaying) pausePlayback();
                else startPlayback();
                break;
            case "ArrowLeft":
                e.preventDefault();
                pausePlayback();
                seekToFrame(state.currentFrame - (e.shiftKey ? 10 : 1));
                break;
            case "ArrowRight":
                e.preventDefault();
                pausePlayback();
                seekToFrame(state.currentFrame + (e.shiftKey ? 10 : 1));
                break;
            case "Home":
                e.preventDefault();
                pausePlayback();
                seekToFrame(0);
                break;
            case "End":
                e.preventDefault();
                if (state.episodeData) {
                    pausePlayback();
                    seekToFrame(state.episodeData.length - 1);
                }
                break;
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
