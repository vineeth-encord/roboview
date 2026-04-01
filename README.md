# roboview

Web viewer for [LeRobot](https://github.com/huggingface/lerobot) episode data. Shows synchronized multi-camera video feeds alongside time-series plots for joint positions, actions, and base velocity.

<!-- To add a screenshot: open the viewer, take a screenshot, then edit this README on GitHub and drag the image in -->

## Features

- Synchronized playback of all camera feeds (e.g. cam_high, cam_left_wrist, cam_right_wrist)
- Time-series charts for joint positions, commanded actions, and base velocity
- Red cursor line tracks current frame across all charts
- Click on any chart to seek to that frame
- Play/pause, frame stepping, speed control (0.25x–2x)
- Keyboard shortcuts: Space (play/pause), Left/Right (frame step), Shift+Left/Right (10 frames), Home/End
- Collapsible chart sections
- Episode selector dropdown
- Supports LeRobot v2.1 standard directory layout

## Install

```bash
pip install git+https://github.com/vineeth-encord/roboview.git
```

## Usage

```bash
roboview --dataset /path/to/lerobot/dataset
```

Then open http://localhost:8000 in your browser.

### Options

```
roboview --dataset /path/to/data    # required: path to LeRobot dataset
         --port 8000                # default: 8000
         --host 0.0.0.0            # default: 0.0.0.0 (accessible on LAN)
```

## Expected dataset structure

Standard LeRobot v2.1 layout:

```
dataset/
├── meta/
│   ├── info.json
│   ├── episodes.jsonl
│   └── ...
├── data/
│   └── chunk-000/
│       ├── episode_000000.parquet
│       └── ...
└── videos/
    └── chunk-000/
        ├── observation.images.cam_high/
        │   ├── episode_000000.mp4
        │   └── ...
        ├── observation.images.cam_left_wrist/
        │   └── ...
        └── observation.images.cam_right_wrist/
            └── ...
```

Only episodes that have both parquet data and all camera videos will appear in the viewer.

## Requirements

- Python 3.9+
- A browser that supports AV1 video (Chrome, Firefox, Edge)
