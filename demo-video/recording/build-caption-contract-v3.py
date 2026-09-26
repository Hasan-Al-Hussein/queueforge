from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Any


FPS = 30
AUDIO_START_FRAMES = 8
SCENE_PLAN = [
    ("problem", "The problem", 690),
    ("solution", "What QueueForge does", 450),
    ("roles", "People and roles", 810),
    ("admin-tour", "Workspace tour", 1_740),
    ("submit", "Start and submit", 990),
    ("approve", "Independent decision", 690),
    ("process-deliver", "Process and deliver", 1_020),
    ("result", "Result and history", 840),
    ("pipeline", "Behind the screen", 630),
    ("close", "Close", 420),
]


def find_ffprobe(repo_root: Path) -> Path:
    matches = sorted(
        repo_root.glob(
            "node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@*/"
            "node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe"
        )
    )
    if not matches:
        raise FileNotFoundError("Could not find the Remotion ffprobe executable.")
    return matches[-1]


def audio_duration(ffprobe: Path, audio_path: Path) -> float:
    result = subprocess.run(
        [
            str(ffprobe),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def srt_timestamp(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    narration_root = repo_root / "demo-video/remotion/public/narration-v3"
    narration_manifest = json.loads(
        (narration_root / "narration-source.json").read_text(encoding="utf-8")
    )
    ffprobe = find_ffprobe(repo_root)

    scene_start_frame = 0
    global_captions: list[dict[str, Any]] = []
    contract_scenes: list[dict[str, Any]] = []

    for identifier, label, scene_duration_frames in SCENE_PLAN:
        scene_duration_seconds = scene_duration_frames / FPS
        audio_path = narration_root / f"{identifier}.mp3"
        caption_path = narration_root / f"{identifier}.captions.json"
        duration_seconds = audio_duration(ffprobe, audio_path)
        local_captions = json.loads(caption_path.read_text(encoding="utf-8"))
        global_audio_start_frame = scene_start_frame + AUDIO_START_FRAMES
        global_audio_start_ms = round(global_audio_start_frame / FPS * 1_000)

        for caption in local_captions:
            global_captions.append(
                {
                    **caption,
                    "startMs": global_audio_start_ms + int(caption["startMs"]),
                    "endMs": global_audio_start_ms + int(caption["endMs"]),
                    "sceneId": identifier,
                }
            )

        tail_hold_seconds = (
            scene_duration_seconds - AUDIO_START_FRAMES / FPS - duration_seconds
        )
        if tail_hold_seconds < 0.25:
            raise ValueError(
                f"Narration leaves only {tail_hold_seconds:.3f}s after scene {identifier}."
            )

        contract_scenes.append(
            {
                "id": identifier,
                "label": label,
                "startFrame": scene_start_frame,
                "endFrame": scene_start_frame + scene_duration_frames,
                "durationFrames": scene_duration_frames,
                "startSeconds": round(scene_start_frame / FPS, 3),
                "endSeconds": round((scene_start_frame + scene_duration_frames) / FPS, 3),
                "audioStartFrame": global_audio_start_frame,
                "audioDurationFrames": math.ceil(duration_seconds * FPS),
                "audioDurationSeconds": round(duration_seconds, 3),
                "tailHoldSeconds": round(tail_hold_seconds, 3),
                "audioFile": f"narration-v3/{identifier}.mp3",
                "captionFile": f"narration-v3/{identifier}.captions.json",
                "captionCueCount": len(local_captions),
            }
        )
        scene_start_frame += scene_duration_frames

    contract = {
        "fps": FPS,
        "voice": narration_manifest["voice"],
        "rate": narration_manifest["rate"],
        "pitch": narration_manifest["pitch"],
        "audioStartFramesWithinScene": AUDIO_START_FRAMES,
        "totalNarrationSeconds": round(
            sum(scene["audioDurationSeconds"] for scene in contract_scenes), 3
        ),
        "recommendedDurationFrames": scene_start_frame,
        "recommendedDurationSeconds": round(scene_start_frame / FPS, 3),
        "captionCueCount": len(global_captions),
        "scenes": contract_scenes,
    }
    (repo_root / "demo-video/recording/narration-v3-timing-contract.json").write_text(
        json.dumps(contract, indent=2) + "\n", encoding="utf-8"
    )

    srt_blocks = []
    for index, caption in enumerate(global_captions, start=1):
        srt_blocks.append(
            f"{index}\n{srt_timestamp(int(caption['startMs']))} --> "
            f"{srt_timestamp(int(caption['endMs']))}\n"
            f"{str(caption['text']).strip()}"
        )
    (repo_root / "demo-video/recording/narration-v3-timing-contract.srt").write_text(
        "\n\n".join(srt_blocks) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
