"""Download the chosen ASR model once, separately from processing user media."""
import argparse
from huggingface_hub import snapshot_download

parser = argparse.ArgumentParser()
parser.add_argument("destination", nargs="?")
args = parser.parse_args()
patterns = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"]
try:
    prepared = snapshot_download("Systran/faster-whisper-small", local_files_only=True,
                                 allow_patterns=patterns)
except FileNotFoundError:
    prepared = snapshot_download("Systran/faster-whisper-small", local_dir=args.destination,
                                 allow_patterns=patterns)
print(prepared)
