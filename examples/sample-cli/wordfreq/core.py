import re
from collections import Counter

WORD = re.compile(r"[a-z']+")


def top_words(text, n):
    if n < 1:
        raise ValueError("n must be at least 1")
    words = WORD.findall(text.lower())
    return Counter(words).most_common(n)
