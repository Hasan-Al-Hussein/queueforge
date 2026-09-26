from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any


TARGET_I = -16.8
TARGET_TP = -2.2
TARGET_LRA = 11.0
SCENE_IDS = [
    "problem",
    "solution",
    "roles",
    "admin-tour",
    "submit",
    "approve",
    "process-deliver",
    "result",
    "pipeline",
    "close",
]


def find_binary(repo_root: Path, name: str) -> Path:
    matches = sorted(
        repo_root.glob(
            "node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@*/"
            f"node_modules/@remotion/compositor-win32-x64-msvc/{name}.exe"
        )
    )
    if not matches:
        raise FileNotFoundError(f"Could not find the Remotion {name} executable.")
    return matches[-1]


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, capture_output=True, text=True)


def loudness_json(stderr: str) -> dict[str, Any]:
    matches = re.findall(r"\{\s*\"input_i\".*?\}", stderr, flags=re.DOTALL)
    if not matches:
        raise ValueError("ffmpeg did not return loudness JSON.")
    return json.loads(matches[-1])


def analyze(ffmpeg: Path, source: Path) -> dict[str, Any]:
    result = run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-nostats",
            "-i",
            str(source),
            "-af",
            f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
            "-f",
            "null",
            "NUL",
        ]
    )
    return loudness_json(result.stderr)


def probe(ffprobe: Path, source: Path) -> dict[str, Any]:
    result = run(
        [
            str(ffprobe),
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,channels,sample_rate,bit_rate:format=duration",
            "-of",
            "json",
            str(source),
        ]
    )
    return json.loads(result.stdout)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    narration_root = repo_root / "demo-video/remotion/public/narration-v3"
    ffmpeg = find_binary(repo_root, "ffmpeg")
    ffprobe = find_binary(repo_root, "ffprobe")
    report_scenes: list[dict[str, Any]] = []

    for identifier in SCENE_IDS:
        source = narration_root / f"{identifier}.mp3"
        destination = narration_root / f"{identifier}.m4a"
        first_pass = analyze(ffmpeg, source)
        loudnorm_filter = (
            f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:"
            f"measured_I={first_pass['input_i']}:"
            f"measured_TP={first_pass['input_tp']}:"
            f"measured_LRA={first_pass['input_lra']}:"
            f"measured_thresh={first_pass['input_thresh']}:"
            f"offset={first_pass['target_offset']}:"
            "linear=true:print_format=summary"
        )
        run(
            [
                str(ffmpeg),
                "-hide_banner",
                "-nostats",
                "-y",
                "-i",
                str(source),
                "-af",
                loudnorm_filter,
                "-ac",
                "1",
                "-ar",
                "48000",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-f",
                "mp4",
                str(destination),
            ]
        )
        output_loudness = analyze(ffmpeg, destination)
        report_scenes.append(
            {
                "id": identifier,
                "source": str(source.relative_to(repo_root)).replace("\\", "/"),
                "output": str(destination.relative_to(repo_root)).replace("\\", "/"),
                "firstPass": first_pass,
                "outputLoudness": output_loudness,
                "probe": probe(ffprobe, destination),
            }
        )
        print(f"Normalized {identifier}.m4a")

    report = {
        "method": "two-pass ffmpeg loudnorm",
        "target": {"I": TARGET_I, "TP": TARGET_TP, "LRA": TARGET_LRA},
        "codec": "AAC",
        "channels": 1,
        "sampleRate": 48_000,
        "scenes": report_scenes,
    }
    (narration_root / "loudness-report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
