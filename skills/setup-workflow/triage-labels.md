# Triage labels

The `triage` skill and the skills that file tickets speak in five roles. This file maps each role to the label string this repo's tracker uses. For a local Markdown tracker, the string is the value of the `Status:` line.

| Role | Default label | Label in this repo | Meaning |
| ---- | ------------- | ------------------ | ------- |
| needs evaluation | `needs-triage` | `needs-triage` | A maintainer still has to evaluate this issue |
| waiting on reporter | `needs-info` | `needs-info` | Waiting on the reporter for more information |
| agent can take it | `ready-for-agent` | `ready-for-agent` | Fully specified; an agent can implement it without a human present |
| human must take it | `ready-for-human` | `ready-for-human` | Needs a human to implement |
| will not be done | `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role (for example "apply the label for agent-ready"), use the string from the "Label in this repo" column.

Edit that column to match the vocabulary the tracker really uses. Keep the Role and Default label columns as they are, so the mapping stays readable.
