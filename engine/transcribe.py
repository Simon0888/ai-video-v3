"""Local CPU transcription. Model preparation is explicit; jobs never download weights."""
import argparse
import json
import wave
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    print("Loading prepared local speech model", flush=True)
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=6,
                         num_workers=1, local_files_only=True)
    import numpy as np
    with wave.open(args.input, "rb") as audio:
        if audio.getnchannels() != 1 or audio.getframerate() != 16000 or audio.getsampwidth() != 2:
            raise ValueError("Expected canonical 16 kHz mono PCM audio")
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    segments, info = model.transcribe(samples, language=args.language, beam_size=5,
                                     word_timestamps=True, vad_filter=False,
                                     condition_on_previous_text=False)
    result = {"engine": "faster-whisper", "model": Path(args.model).name,
              "language": info.language, "duration": info.duration, "segments": []}
    for i, seg in enumerate(segments):
        result["segments"].append({"id": i, "start": round(seg.start, 3),
                                   "end": round(seg.end, 3), "text": seg.text.strip(),
                                   "words": [{"start": round(w.start, 3),
                                              "end": round(w.end, 3), "text": w.word,
                                              "probability": round(w.probability, 4)}
                                             for w in seg.words or []]})
        print(f"Transcribed {seg.end:.1f}s", flush=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Transcription saved", flush=True)


if __name__ == "__main__":
    main()
