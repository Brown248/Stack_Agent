# Rule table

Every rule we keep correcting agents for, and what enforces it. Highest level first:
architecture > types > guard/lint/CI > test > docs. A rule whose "Enforced by" is only docs is a candidate for `/stack-agent:correct`.

| Rule | Why | Enforced by | Proof it catches a real mistake |
| --- | --- | --- | --- |
| EDIT ME | EDIT ME | guard rule `id` / test name / docs only | commit, PR, or fixture that the check fails on |
