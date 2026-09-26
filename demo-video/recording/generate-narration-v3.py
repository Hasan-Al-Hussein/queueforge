from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Any

import edge_tts


def normalize_word(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z'-]", "", value).lower()


def group_caption_words(
    *, text: str, boundaries: list[dict[str, Any]], phrases: list[dict[str, str]]
) -> list[dict[str, Any]]:
    source_words = text.split()
    boundary_words = [str(boundary["text"]) for boundary in boundaries]
    use_source_punctuation = len(source_words) == len(boundary_words) and all(
        normalize_word(source) == normalize_word(boundary)
        for source, boundary in zip(source_words, boundary_words, strict=True)
    )
    if not use_source_punctuation:
        raise ValueError("TTS word boundaries do not reconstruct the narration source.")
    if " ".join(phrase["spoken"] for phrase in phrases) != text:
        raise ValueError("Hand-authored captions do not reconstruct the narration source.")

    captions: list[dict[str, Any]] = []
    source_index = 0
    for phrase in phrases:
        spoken_phrase = phrase["spoken"]
        display_phrase = phrase["text"]
        phrase_words = spoken_phrase.split()
        phrase_source_words = source_words[source_index : source_index + len(phrase_words)]
        if phrase_words != phrase_source_words:
            raise ValueError(f"Caption phrase does not align with source text: {spoken_phrase}")
        phrase_boundaries = boundaries[source_index : source_index + len(phrase_words)]
        if not phrase_boundaries:
            raise ValueError(f"Caption phrase has no timing boundaries: {spoken_phrase}")
        first_boundary = phrase_boundaries[0]
        last_boundary = phrase_boundaries[-1]
        start_ms = round(float(first_boundary["offset"]) / 10_000)
        end_ms = round(
            (float(last_boundary["offset"]) + float(last_boundary["duration"])) / 10_000
        )
        captions.append(
            {
                "text": " " + display_phrase,
                "startMs": start_ms,
                "endMs": end_ms,
                "timestampMs": None,
                "confidence": None,
            }
        )
        source_index += len(phrase_words)

    if source_index != len(source_words):
        raise ValueError("Hand-authored captions do not cover all narration words.")

    for index, caption in enumerate(captions):
        next_start = captions[index + 1]["startMs"] if index + 1 < len(captions) else None
        readable_end = int(caption["endMs"]) + 250
        caption["endMs"] = min(readable_end, int(next_start) - 50) if next_start else readable_end
    return captions


def captions_to_srt(captions: list[dict[str, Any]]) -> str:
    def timestamp(milliseconds: int) -> str:
        hours, remainder = divmod(milliseconds, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        seconds, millis = divmod(remainder, 1_000)
        return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"

    blocks = []
    for index, caption in enumerate(captions, start=1):
        blocks.append(
            f"{index}\n{timestamp(int(caption['startMs']))} --> "
            f"{timestamp(int(caption['endMs']))}\n{str(caption['text']).strip()}"
        )
    return "\n\n".join(blocks) + "\n"


async def generate_scene(
    *,
    identifier: str,
    text: str,
    caption_phrases: list[dict[str, str]],
    destination: Path,
    voice: str,
    rate: str,
    pitch: str,
    volume: str,
) -> None:
    audio_path = destination / f"{identifier}.mp3"
    communicator = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
        boundary="WordBoundary",
    )
    boundaries: list[dict[str, Any]] = []

    with audio_path.open("wb") as audio_file:
        async for chunk in communicator.stream():
            if chunk["type"] == "audio":
                audio_file.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                boundaries.append(dict(chunk))

    captions = group_caption_words(
        text=text, boundaries=boundaries, phrases=caption_phrases
    )
    (destination / f"{identifier}.captions.json").write_text(
        json.dumps(captions, indent=2) + "\n", encoding="utf-8"
    )
    (destination / f"{identifier}.srt").write_text(
        captions_to_srt(captions), encoding="utf-8"
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="Generate QueueForge v3 narration")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", required=True)
    parser.add_argument("--pitch", required=True)
    parser.add_argument("--volume", default="+0%")
    parser.add_argument("--only", action="append", default=[])
    arguments = parser.parse_args()

    scenes = json.loads(arguments.input.read_text(encoding="utf-8"))
    arguments.output.mkdir(parents=True, exist_ok=True)

    selected_ids = set(arguments.only)
    selected_scenes = [
        scene for scene in scenes if not selected_ids or str(scene["id"]) in selected_ids
    ]
    if selected_ids != {str(scene["id"]) for scene in selected_scenes}:
        raise ValueError("One or more --only scene IDs do not exist.")

    for scene in selected_scenes:
        identifier = str(scene["id"])
        text = str(scene["text"])
        caption_phrases = [
            {"spoken": str(phrase), "text": str(phrase)}
            if isinstance(phrase, str)
            else {"spoken": str(phrase["spoken"]), "text": str(phrase["text"])}
            for phrase in scene["captions"]
        ]
        await generate_scene(
            identifier=identifier,
            text=text,
            caption_phrases=caption_phrases,
            destination=arguments.output,
            voice=arguments.voice,
            rate=arguments.rate,
            pitch=arguments.pitch,
            volume=arguments.volume,
        )
        print(f"Generated {identifier}.mp3")

    manifest = {
        "voice": arguments.voice,
        "rate": arguments.rate,
        "pitch": arguments.pitch,
        "volume": arguments.volume,
        "scenes": scenes,
    }
    (arguments.output / "narration-source.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    asyncio.run(main())
