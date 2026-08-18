# Shared CLI contract

All role Skills invoke the installed `jiaban` binary. They never import or copy `bin/` or `src/`.

## Identity check

```text
jiaban --profile <fixed-profile> auth status
```

The returned `activeRole` must exactly match the role Skill. A Profile is a credential selector, not authorization.

## WEB_ADMIN initialization

`jiaban admin init` is the only credential-provisioning command. It accepts no flags and reads only strict `{phone,password}` JSON from stdin. It always targets the built-in test origin, logs in as `WEB_ADMIN`, verifies `/api/auth/me`, and only then uses a cross-process exclusive store transaction to create and activate encrypted Profile `web-admin`. The transaction rechecks create-only under lock, rejects an existing target, and permits only one concurrent commit. Pre-commit failure leaves prior key/data bytes unchanged and no temp files. All later role calls use explicit `--profile web-admin`.

## Fixed senior reads

These commands are hard-coded to `/api/senior/**`. Only WEB_ADMIN, P9 SENIOR_ADMIN, P8 BRANCH_GENERAL_MANAGER, and P7 SENIOR_MANAGER may use them, and only when backend authorization allows the target:

```text
jiaban --profile <fixed-profile> health
jiaban --profile <fixed-profile> customer get --id <confirmed-id>
jiaban --profile <fixed-profile> contract list --customer-id <confirmed-id>
jiaban --profile <fixed-profile> contract status --id <confirmed-id>
```

MANAGER, TRUST_SPECIALIST, OPERATIONS, and CUSTOMER must not use these fixed commands. They use role-specific generic paths documented by their role Skill.

## Generic request

```text
jiaban --profile <fixed-profile> api request GET /api/<confirmed-path> --dry-run
jiaban --profile <fixed-profile> api request GET /api/<confirmed-path>
```

- Only relative `/api/**` paths are allowed. Never supply authentication, Host, method-override, or rewrite headers.
- Query values use repeated `--query key=value`. JSON uses stdin or an absolute file under the upload root.
- Files stay inside configured upload/download roots. Binary output always uses absolute `--output`.
- stdout is one JSON object. Use results only when `ok=true`; never expose absolute output paths.
- GET/HEAD may re-login once only after a credential-mode 401. Writes and network failures are never replayed.
