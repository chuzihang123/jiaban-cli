---
name: jiaban-specialist
description: Handles isolated-test Jiaban trust-specialist workflow work with the dedicated TRUST_SPECIALIST profile. Use when the user explicitly mentions 信托专员, 信托业务专员, workflow creation, review, return for re-signing, or archiving.
---

# Jiaban Trust Specialist

## Identity and scope

- Always use `--profile specialist`; the Profile must belong only to the TRUST_SPECIALIST test account.
- First run `jiaban --profile specialist auth status` and require `activeRole=TRUST_SPECIALIST`.
- Limit work to the named customer, contract flow, task, or material.
- This role may create, review, return for customer re-signing, and archive only within backend authorization. The customer performs the signature.

## Workflow

1. Never use the fixed senior contract commands.
2. Load [TRUST_SPECIALIST operations](operations.md), select one `operationId`, and collect every required input.
3. Follow [dialog state](../../references/dialog-state.md); writes need current-turn confirmation, and R3/R4 need a fresh `--plan-id`.
4. Follow [error policy](../../references/error-policy.md); an authorized work queue may be listed, but never to guess a target.

Never claim signature authority or use another role after 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
