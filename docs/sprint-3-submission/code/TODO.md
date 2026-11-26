Nic runs this at the end of the sprint, after the last PR merges (not before), from the repo root:

```
git fetch origin
mkdir -p /tmp/al-sprint3 && git archive --format=tar origin/main | tar -x -C /tmp/al-sprint3
betterleaks dir /tmp/al-sprint3      # must report no leaks
git archive --format=zip -o "docs/sprint-3-submission/code/sprint3-code.zip" origin/main
```

`PROJECT GUIDELINES/` and `.env` files are gitignored, so they are not in the archive. Note in the retrospective which PRs were still open at the cut, since unmerged work is not in the zip.
