# Feature map

What a user of the wordfreq CLI does, and where it lives. Checked by `node .stack-agent/bin/feature-map.mjs` (see `templates/common/feature-map.md` for the format).

| Feature | Where | How a user reaches it | Check |
| --- | --- | --- | --- |
| Show the most common words | wordfreq/cli.py#"--top", wordfreq/core.py#def top_words | `python -m wordfreq FILE --top N` | main-path, rejects-bad-top |
| Explain a file that cannot be read | wordfreq/cli.py#cannot read | `python -m wordfreq MISSING_FILE` | rejects-missing-file |
| Print usage | wordfreq/cli.py#prog="wordfreq" | `python -m wordfreq --help` | help |
