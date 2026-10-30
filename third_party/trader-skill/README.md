# Trader Skill attribution

Upstream: https://github.com/Jakeschincariol/trader-skill

Reviewed revision: `5189e79b9a480755a3733ac9713f5353981dbe18` (30 October 2026).
Copyright (c) 2026 Jake Schincariol. MIT license reproduced in `LICENSE`.

This is a focused JavaScript adaptation, not an installation of the eleven
Claude skills or a claim that Claude is running inside LEVI INVEST.

| Upstream | Local adaptation |
| --- | --- |
| `trader-news/news.py` | Yahoo Finance RSS source, dates and deduplication in `lib/trader-research-service.mjs` |
| `trader-analyst/facts.py` | SEC ticker/CIK lookup, US-GAAP concept priorities, exact reported periods and latest restatements in `lib/trader-fundamentals.mjs` |
| `trader-budget/size.py`, `trader-risk/check.py` | Budget/cash/position-cap workflow informs the new, local long-only scenario calculator in `lib/trader-planner.mjs` |

Differences: no inferred fourth quarter or EPS, no currency fallback, no claim
of a live account check, no broker connection, no investment-copying, Congress
monitor, tax logic, scheduled alerts, screener or rebalancer. A report is a
current research snapshot with explicit period/filing timestamps, not a
point-in-time backtesting dataset. Headlines and SEC readings can fail
independently. The existing application's execution and protections are not
modified.
