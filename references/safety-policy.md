# Safety policy

## Credentials

- Credentials belong only in deployment Secrets or a pre-provisioned encrypted Profile.
- Role Skills receive only a Profile name during business operations. The explicit `admin init` setup flow may accept one strict account JSON through stdin in a private one-to-one test conversation.
- Use one dedicated account per role and Profile. Do not share a Profile across roles.
- `admin init` must verify the fixed test origin and `WEB_ADMIN` identity before atomically saving Profile `web-admin`. Credentials must never enter argv, stdout, stderr, audit, source, or package; failure leaves the prior active Profile unchanged.

## Read scope

- Use IDs and ranges explicitly supplied or unambiguously established in the current request.
- Do not enumerate customers, contracts, tenants, branches, users, or files to discover a target.
- Stop on 401/403. Do not switch role, Profile, endpoint, or identity to gain access.

## Writes

1. Construct the exact request with `--dry-run`; this performs zero network activity.
2. Show only the redacted method, path, scope, and effect. Ask for specific confirmation in the current turn.
3. After confirmation, repeat the same request with `--yes --reason <test-reason>`.
4. For DELETE or a high-risk path, also use the current five-minute single-use `--plan-id`.
5. If Profile, method, path, query, headers, body, files, output, overwrite, or reason changes, discard the plan and dry-run again.

Never interpret a prior confirmation, deployment switch, `activeRole`, or available CLI capability as permission for a new write.
