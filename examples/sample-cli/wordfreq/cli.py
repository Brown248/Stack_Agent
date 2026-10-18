import argparse
import sys

from .core import top_words


def main(argv=None):
    parser = argparse.ArgumentParser(prog="wordfreq", description="Print the most common words in a text file.")
    parser.add_argument("file", help="path to a UTF-8 text file")
    parser.add_argument("--top", type=int, default=5, help="how many words to show (default 5)")
    args = parser.parse_args(argv)
    try:
        with open(args.file, encoding="utf-8") as f:
            text = f.read()
    except OSError as err:
        print(f"wordfreq: cannot read {args.file}: {err.strerror}", file=sys.stderr)
        return 1
    try:
        pairs = top_words(text, args.top)
    except ValueError as err:
        print(f"wordfreq: {err}", file=sys.stderr)
        return 2
    for word, count in pairs:
        print(f"{count}\t{word}")
    return 0
