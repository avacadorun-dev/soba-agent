# Proof Bundle v1 contract

Proof Bundle v1 is the persisted trust contract written to `.soba/evidence/*.soba-proof.json`. Runtime-internal ledger
objects are drafts; only a sealed persisted bundle is a portable receipt.

## Required contract metadata

- `version: 1` selects the schema and compatibility rules.
- `runId` is deterministically derived from the `sessionId` + `turnId` identity, so repeated sealing of one turn is
  stable while different turns in the same session cannot collide.
- `proofId` is content-addressed as `proof_` plus the first 24 hexadecimal characters of the proof digest.
- `integrity.algorithm` is `sha256`.
- `integrity.digest` covers canonical, recursively redacted JSON while omitting `proofId` and `integrity`.

Canonical JSON recursively sorts object keys, preserves array order, and omits properties whose value is `undefined`.
The persisted file is written with mode `0600` where POSIX permissions are available.

The optional `metrics` object records the turn's model-call count and input, output, and total token usage. Each value
must be a non-negative integer. Consumers must preserve absence as unknown instead of converting it to zero.

## Stable identifiers

Evidence, command, check, claim, risk, session, turn, run, and proof identifiers are explicit fields. Consumers must join
records by these identifiers and must not infer relationships from array order, prose summaries, timestamps, or file
names. IDs are immutable inside a sealed proof.

When accepted completion criteria omit explicit evidence IDs, the runtime may link them only to successful mutation,
verification, and inspection evidence already recorded in the same turn. If no such evidence exists, the claim remains
unverified; producers must not synthesize references merely to obtain a verified outcome.

## Validation and policy outcomes

`soba verify` first validates schema, references, redaction, content integrity, mutation ordering, command outcomes,
diff completeness, and permission consistency. A structurally valid proof is accepted only when its terminal status is
`verified`.

| Outcome | Stable reason | Exit code |
| --- | --- | ---: |
| `verified` | `proof_verified` | 0 |
| invalid contract or evidence | first validation issue code | 1 |
| `partially_verified` | `proof_partially_verified` | 2 |
| `unverified` | `proof_unverified` | 3 |
| `blocked` | `proof_blocked` | 4 |

Issue codes are machine-readable compatibility surface. Existing codes are not repurposed for a different condition.

## Compatibility policy

- Readers for version 1 accept additive unknown fields.
- Required-field removal, field meaning changes, or enum narrowing require a new proof version.
- Pre-integrity v1 receipts remain structurally readable but are not policy-accepted as verified: they produce
  `legacy_unsealed_proof`, outcome `partially_verified`, and exit code 2 because they are not tamper-evident.
- Unknown proof versions fail with `invalid_version`; consumers must not silently coerce them.
- A future migration must preserve the original receipt and produce a new sealed artifact with explicit provenance.

## Security and redaction

Secret-bearing keys and recognizable credentials are replaced with `[REDACTED]` before hashing and persistence.
Validation rejects recognizable unredacted secrets even when the receipt is otherwise well-formed. Command output
digests cover the redacted command output; the proof digest covers the entire redacted receipt.

Redaction reduces accidental persistence risk but is not a general secret scanner. Producers must avoid placing raw
credentials in prompts, command arguments, outputs, environment snapshots, claims, or custom extension fields.

## Release corpus

The deterministic release corpus must reject at least these false-completion classes:

- verification recorded before the last code mutation;
- a passed command with a missing or non-zero exit status;
- claims or changed files referencing unknown evidence;
- a diff that omits or invents changed files;
- successful evidence produced by a denied tool call;
- content changed after the receipt was sealed;
- unredacted secret-bearing content.

The corpus is implemented in `tests/evals/proof/adversarial-proof-corpus.test.ts`.
