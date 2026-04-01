import argparse
import importlib.resources
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from roboview.dataset_reader import DatasetReader

_PACKAGE_DIR = Path(__file__).parent

app = FastAPI(title="Robotics Data Viewer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

reader: DatasetReader = None


@app.get("/api/info")
def get_info():
    return reader.get_info_summary()


@app.get("/api/episode/{episode_index}")
def get_episode(episode_index: int):
    data = reader.get_episode_data(episode_index)
    if data is None:
        raise HTTPException(404, f"Episode {episode_index} not found")
    return data


@app.get("/api/videos/{episode_index}")
def get_video_list(episode_index: int):
    """Return list of {key, url} for this episode's videos."""
    paths = reader.get_video_paths_for_episode(episode_index)
    if not paths:
        raise HTTPException(404, f"No videos for episode {episode_index}")
    videos = []
    for i, (key, path) in enumerate(sorted(paths.items())):
        videos.append({
            "key": key,
            "label": key.split(".")[-1],  # e.g. "cam_high"
            "url": f"/api/video/{episode_index}/{i}",
        })
    return videos


@app.get("/api/video/{episode_index}/{video_idx}")
def get_video(episode_index: int, video_idx: int):
    paths = reader.get_video_paths_for_episode(episode_index)
    if not paths:
        raise HTTPException(404, f"No videos for episode {episode_index}")
    sorted_paths = sorted(paths.items())
    if video_idx < 0 or video_idx >= len(sorted_paths):
        raise HTTPException(404, f"Video index {video_idx} out of range")
    _, filepath = sorted_paths[video_idx]
    if not os.path.exists(filepath):
        raise HTTPException(404, f"Video file not found: {filepath}")
    return FileResponse(filepath, media_type="video/mp4")


@app.delete("/api/episode/{episode_index}")
def delete_episode(episode_index: int):
    """Delete an episode and all its files from disk."""
    # Check episode exists
    available = [e["episode_index"] for e in reader.get_available_episodes()]
    if episode_index not in available:
        raise HTTPException(404, f"Episode {episode_index} not found")
    reader.delete_episode(episode_index)
    return reader.get_info_summary()


@app.get("/")
def serve_index():
    return FileResponse(_PACKAGE_DIR / "static" / "index.html")


# Mount static files after API routes
app.mount("/static", StaticFiles(directory=_PACKAGE_DIR / "static"), name="static")


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description="Robotics Data Viewer")
    parser.add_argument(
        "--dataset", required=True, help="Path to LeRobot dataset directory"
    )
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    global reader
    reader = DatasetReader(args.dataset)

    available = reader.get_available_episodes()
    print(f"Dataset: {args.dataset}")
    print(f"Version: {reader.codebase_version}, FPS: {reader.fps}")
    print(f"Available episodes: {len(available)} / {len(reader.episodes)}")
    print(f"Video keys: {reader.video_keys}")
    print(f"State dims: {reader.state_shape}, Action dims: {reader.action_shape}")
    print(f"\nStarting server at http://localhost:{args.port}")

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
