# AWS setup and custom stacks

## Root cause

The reference script is `/home/shyam/aws-setup/configure.sh`. It runs `ssocreds -p VerteilDeveloper-683455398069`, reads that profile's temporary credentials, and requests a CodeArtifact token in `ap-south-1`.

DevDeck instead defaulted to `sdd`, looked for `~/awsconfig/configure.sh`, and omitted the region from direct CodeArtifact calls. Its script fallback could silently switch to a hardcoded profile and suppress errors. `aws configure get` alone does not resolve native SSO credentials. Concurrent refresh callers returned before the refresh finished. Status assumed a fixed token lifetime, did not check session credential expiration, and labeled every missing or failed token as “Token Expired”. Profile changes were not persisted or exposed in the dashboard.

## Changes

- Dashboard AWS settings persist profile and region, defaulting to the reference script's values. Saved settings take precedence over environment defaults.
- Resolve credentials through `aws configure export-credentials --format process`, with the reference script's `ssocreds` sequence as a compatibility fallback. Retry expired static credentials using that fallback. Commands use argument arrays and never source a script with a hardcoded profile.
- Retrieve CodeArtifact token and expiration as JSON, isolate inherited credentials, await shared refreshes, clear cached credentials on profile changes, and publish success and failure status. Child processes receive the selected profile, region, and fresh credentials. Refresh is required five minutes before expiration; legacy credentials lacking expiry metadata are rechecked hourly.
- Add persistent custom stacks with ordered repositories, edit/delete/start controls, repository validation, progress reporting, port readiness checks and stop-all cancellation. Keep V1/V3 presets available.

## Validation scope

Targeted Node tests cover AWS profile isolation, native/legacy SSO, expired static credentials, concurrent refreshes, failures, settings persistence/validation, ordered startup, readiness failure and cancellation. No airline/XML response mapping is changed, so the airline V1 response schema is not applicable. AWS login and live account authorization require a valid local SSO session; automated tests use fake credentials and do not contact AWS or launch workspace services.

Validation result: all 12 tests passed with `DEVDECK_DATA_DIR=/tmp/devdeck-validation npm test`, including API persistence across server restarts. JavaScript/Bash syntax, unique HTML IDs, frontend element references and `git diff --check` passed. The API test required permission to bind its isolated localhost listener outside the sandbox. Browser rendering and live AWS authentication were not verified.

AWS references: [credential export](https://docs.aws.amazon.com/cli/latest/reference/configure/export-credentials.html), [CodeArtifact authorization and expiration](https://docs.aws.amazon.com/cli/latest/reference/codeartifact/get-authorization-token.html).
