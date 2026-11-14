# AL-131: As a data scientist, the valuation endpoint returns how much each house feature added to or took off the estimate

## What was built

I added exact Shapley values to the valuation endpoint, so every estimate comes with a baseline and a euro piece for each of the six inputs. There are only six inputs, so it's just 64 combinations and I could work them out exactly instead of approximating. If the breakdown fails the estimate still comes back with a warning.

## Pull requests

| PR | Title | Merged | By |
|---|---|---|---|
| [#106](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/106) | AL-134 Add exact Shapley contributions for each estimate | 2026-10-27 | Nic |
| [#109](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/109) | AL-135 Add the breakdown to the valuation response | 2026-10-27 | Nic |
| [#123](https://github.com/CS3-Agentic-Lender/agentic-lender/pull/123) | AL-135 Put the background sample in the Docker image | 2026-10-29 | Nic |
