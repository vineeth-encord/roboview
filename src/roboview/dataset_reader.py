import json
import os
import glob
import pandas as pd


# Flat folder camera mapping: filename suffix -> video key
FLAT_CAMERA_MAP = {
    "": "observation.images.cam_left_wrist",
    " (1)": "observation.images.cam_right_wrist",
    " (2)": "observation.images.cam_high",
}


class DatasetReader:
    def __init__(self, dataset_path: str):
        self.dataset_path = os.path.abspath(dataset_path)

        # Load info.json
        info_path = os.path.join(self.dataset_path, "info.json")
        if not os.path.exists(info_path):
            # Try meta/ subdirectory (standard LeRobot layout)
            info_path = os.path.join(self.dataset_path, "meta", "info.json")
        with open(info_path) as f:
            self.info = json.load(f)

        self.fps = self.info["fps"]
        self.codebase_version = self.info.get("codebase_version", "v2.1")

        # Detect layout: standard (has data/ dir) vs flat
        self.is_standard = os.path.isdir(os.path.join(self.dataset_path, "data"))

        # Extract features
        features = self.info["features"]

        # Video keys
        self.video_keys = sorted(
            k for k, v in features.items() if v.get("dtype") == "video"
        )

        # Joint/action names
        self.state_names = features.get("observation.state", {}).get("names", [])
        self.action_names = features.get("action", {}).get("names", [])
        self.state_shape = features.get("observation.state", {}).get("shape", [0])[0]
        self.action_shape = features.get("action", {}).get("shape", [0])[0]

        # Load episodes
        self.episodes = self._load_episodes()

        # For flat layout, build a mapping of episode_index -> {video_key: filepath}
        if not self.is_standard:
            self._build_flat_video_map()

    def _load_episodes(self) -> list:
        # Try episodes.jsonl at root or meta/
        for subdir in ["", "meta"]:
            path = os.path.join(self.dataset_path, subdir, "episodes.jsonl")
            if os.path.exists(path):
                episodes = []
                with open(path) as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            episodes.append(json.loads(line))
                return episodes
        return []

    def _build_flat_video_map(self):
        """Build mapping for flat folder layout."""
        self._flat_video_map = {}
        for ep in self.episodes:
            idx = ep["episode_index"]
            base = f"episode_{idx:06d}"
            mapping = {}
            for suffix, video_key in FLAT_CAMERA_MAP.items():
                filename = f"{base}{suffix}.mp4"
                filepath = os.path.join(self.dataset_path, filename)
                if os.path.exists(filepath):
                    mapping[video_key] = filepath
            if mapping:
                self._flat_video_map[idx] = mapping

    def get_available_episodes(self) -> list:
        """Return episodes that have both data and all video files available."""
        num_cameras = len(self.video_keys)
        available = []
        for ep in self.episodes:
            idx = ep["episode_index"]
            parquet_path = self._get_parquet_path(idx)
            if not parquet_path or not os.path.exists(parquet_path):
                continue
            video_paths = self.get_video_paths_for_episode(idx)
            if len(video_paths) >= num_cameras:
                available.append(ep)
        return available

    def _get_parquet_path(self, episode_index: int) -> str:
        if self.is_standard:
            chunk = episode_index // self.info.get("chunks_size", 1000)
            return os.path.join(
                self.dataset_path,
                "data",
                f"chunk-{chunk:03d}",
                f"episode_{episode_index:06d}.parquet",
            )
        else:
            path = os.path.join(
                self.dataset_path, f"episode_{episode_index:06d}.parquet"
            )
            return path if os.path.exists(path) else None

    def get_episode_data(self, episode_index: int) -> dict:
        parquet_path = self._get_parquet_path(episode_index)
        if not parquet_path or not os.path.exists(parquet_path):
            return None

        df = pd.read_parquet(parquet_path)

        # Filter to this episode if multi-episode file
        if "episode_index" in df.columns:
            df = df[df["episode_index"] == episode_index].reset_index(drop=True)

        # Convert list columns to nested Python lists
        state_data = [list(map(float, row)) for row in df["observation.state"]]
        action_data = [list(map(float, row)) for row in df["action"]]
        timestamps = df["timestamp"].astype(float).tolist()
        frame_indices = df["frame_index"].astype(int).tolist()

        return {
            "episode_index": episode_index,
            "length": len(df),
            "fps": self.fps,
            "timestamps": timestamps,
            "frame_indices": frame_indices,
            "observation_state": state_data,
            "action": action_data,
            "state_names": self.state_names,
            "action_names": self.action_names,
        }

    def get_video_paths_for_episode(self, episode_index: int) -> dict:
        """Returns {video_key: absolute_path} for this episode."""
        if self.is_standard:
            template = self.info.get("video_path", "")
            chunk = episode_index // self.info.get("chunks_size", 1000)
            paths = {}
            for vk in self.video_keys:
                path = template.format(
                    episode_chunk=chunk,
                    video_key=vk,
                    episode_index=episode_index,
                )
                full_path = os.path.join(self.dataset_path, path)
                if os.path.exists(full_path):
                    paths[vk] = full_path
            return paths
        else:
            return self._flat_video_map.get(episode_index, {})

    def get_info_summary(self) -> dict:
        available = self.get_available_episodes()
        return {
            "codebase_version": self.codebase_version,
            "fps": self.fps,
            "robot_type": self.info.get("robot_type", "unknown"),
            "total_episodes": len(self.episodes),
            "available_episodes": [
                {
                    "episode_index": e["episode_index"],
                    "length": e.get("length", 0),
                    "tasks": e.get("tasks", []),
                }
                for e in available
            ],
            "video_keys": self.video_keys,
            "state_names": self.state_names,
            "action_names": self.action_names,
            "state_shape": self.state_shape,
            "action_shape": self.action_shape,
        }
