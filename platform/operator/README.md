# Private local operator console

From the platform directory run `node operator/console.mjs`. Open the printed loopback address and enter its one-time code. Sessions expire within two hours; logout, process restart or trusted code rotation revokes them. Member wallet sessions cannot authorize operator commands.

Startup is read-only by default. Set `OPERATOR_ID` to the stable local operator identity and `OPERATOR_COMMANDS` to an explicit comma-separated subset of `ops.configure-workload.v1,ops.change-scope.v1`. This does not create database grants: the identity must separately have an existing enabled `operations` row in `app_operator_scopes`. Fixture setup may supply that grant; the console never grants itself permissions.

Staffing and scoped pause changes require an exact preview and confirmation. The immutable command binds its operator, input, request key and expected revisions; business changes, audit event and receipt commit together. Identical accepted retries recover the original receipt even after a later database scope revocation, but still require a current authorized session. Claim, principal and recovery scopes cannot be paused. Review writes are unavailable until audited final moderation is implemented; the existing queue remains readable.

The synchronous session guard is specific to the local Node transaction driver. It checks authority before statements and before commit, and rejects outer transactions. This is not a hosted or D1 identity provider. Financial execution remains disabled. There is no signer, shell/SQL endpoint or external publication operation.

`node operator/browser-qa.mjs` runs the local journey when `PLAYWRIGHT_MODULE` and `BROWSER_EXE` point to installed Playwright and Chromium-compatible paths. It uses a disposable fixture database and closes its browser and HTTP server afterward.
