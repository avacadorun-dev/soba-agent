# Endurance Benchmark Results

**Date:** 2026-06-15T02:29:42.455Z
**Workload ID:** benchmark-42-300
**Environment:** bun-v24.3.0

## Configuration

```json
{
  "seed": 42,
  "stepsCount": 300,
  "tokensPerStep": 1000,
  "compactionInterval": 5,
  "contextWindow": 128000,
  "maxOutputTokens": 16384
}
```

## Results

| Metric | With Compaction | Baseline |
|--------|----------------|----------|
| Total Tokens | 669,648 | 1,558,395 |
| Inference Input Tokens | 463,475 | 1,522,045 |
| Inference Output Tokens | 36,350 | 36,350 |
| Compaction Cost | 169,823 | 0 |
| Peak Effective Tokens | 11,317 | 40,123 |
| Compactions | 14 | 0 |
| Savings Ratio | 57.03% | N/A |

## Acceptance Criteria

| Criterion | Required | Actual | Status |
|-----------|----------|--------|--------|
| Minimum compactions | ≥10 | 14 | ✓ |
| Overflow errors | 0 | 0 | ✓ |
| Manual restarts | 0 | 0 | ✓ |
| Capsule invariant failures | 0 | 0 | ✓ |
| Savings ratio | ≥20% | 57.03% | ✓ |

## Notes

- This benchmark uses a deterministic scripted workload for reproducibility.
- The baseline runs with a very large context window (1M tokens) to avoid overflow.
- Total token cost = inference input + inference output + compaction cost.
- Inference input tokens = cumulative effective context sent to model across all calls.
- Savings ratio includes compaction overhead (input + output tokens for capsule generation).
- The 6-hour KPI is measured separately on real dogfooding sessions.
