# Private local operator console

From the platform directory run `node operator/console.mjs`. Open the printed loopback address and enter its one-time code. Sessions expire within two hours; logout, process restart or trusted code rotation revokes them. Member wallet sessions cannot authorize operator commands.

Startup is read-only by default. Set `OPERATOR_ID` to a stable local operator identity and `OPERATOR_COMMANDS` to an explicit comma-separated subset of the kinds below. This does not create database grants: that identity also needs the enabled scope in `app_operator_scopes`. Only explicit fixture setup supplies grants; the console never grants itself permissions. The CLI uses the existing `.local/preview.sqlite` and private `.local/artifacts` directory. Use a disposable fixture through `createOperatorApp` for isolated acceptance testing.

## Command and scope matrix

All routes require a current local operator session with the exact allowed kind. Consequential standard commands use `/ops/commands/preview`, `/execute` and `/receipt`; the shared prefix is `/ops/commands`.

| Kind | Database scope | Channel and effect |
| --- | --- | --- |
| `ops.configure-workload.v1` | `operations` | Standard; staffing and admission capacity |
| `ops.change-scope.v1` | `operations` | Standard; explicit scoped pause/resume |
| `earn.final-review.v1` | `earn-review` | Standard; immutable final moderation |
| `earn.configure-action.v1` | `earn-action-policy` | Standard; future-only action policy |
| `collection.validate-whitelist.v1` | `collection-import` | Read-only `/ops/drafts/whitelist`; no receipt or write |
| `collection.stage-record.v1` | `collection-import` | Private upload; source record bytes |
| `collection.stage-cut-record.v1` | `collection-evidence` | Private upload; fixed-cut record bytes |
| `collection.seal-list.v1` | `collection-import` | Standard; immutable list seal |
| `collection.seal-source.v1` | `collection-import` | Standard; validated source closure seal |
| `collection.materialize-eligibility-page.v1` | `collection-import` | Standard; bounded eligibility index |
| `collection.publish-stage.v1` | `collection-publication`; also `collection-founder` for public/founder stage or inventory override | Standard; immutable local stage terms |
| `collection.begin-free-cut.v1` | `collection-evidence` | Standard; begin exact-opening snapshot validation |
| `collection.validate-cut-page.v1` | `collection-evidence` | Standard; bounded retained evidence validation |
| `collection.seal-free-cut.v1` | `collection-evidence` | Standard; seal complete fixed-cut evidence |
| `collection.observe-asset.v1` | `collection-evidence` | Standard; retained synthetic reveal/transfer evidence |
| `governance.publish-ballot.v1` | `governance-publication` | Standard; immutable advisory electorate |
| `governance.record-decision.v1` | `governance-decision` | Standard; explicit advisory decision and notice |

Standard command bodies are limited to16KiB. Private upload routes `/ops/uploads/preview`, `/execute` and `/receipt` use octet bytes with exact bounded `x-operator-upload` metadata: source records at most128KiB, cut records64KiB. Read-only draft JSON is at most512KiB and10,000 entries. These kinds cannot bypass their dedicated routes through the standard dispatcher.

## Review, execution and recovery

Preview and confirmation bind the complete request, principal and revisions, while historical business digests remain unchanged. Business changes, audit event and receipt commit atomically. Identical accepted retries recover the original receipt after a later pause or database scope revocation, but still require a current session authorized for that kind. Changed-body retries fail. Receipt lookup resolves a saved command without executing a new change.

The local command journal retains original command identity for unknown results. Upload journals contain metadata and digests, never file bytes or filenames: reload checks the receipt first; a missing receipt requires deliberate reselection of the exact file. Draft entries and results stay only in page memory and clear on reload, expiry and logout. Explicit logout clears private state even when the server session already expired.

Claim, principal and recovery scopes cannot be paused. Final moderation cannot edit a published decision. Held source evidence is displayed separately from content scores. Permanent observation conflict means accepted evidence remains unresolved; an accepted receipt does not clear that hold. Observations require retained verified fixture evidence; no chain fetch or signer exists.

Stage publication supports whitelist, free, public and founder types with explicit type-specific approval fields. Price and UTC schedule fields have no launch defaults. Later Genesis first-stage publication binds its advisory ballot; preview exposes previous fixture allocations, decision timing and first-admission holds. Publication may precede the final decision. An explicit scoped inventory exception removes only the remaining-inventory hold, never decision/notice timing. Later stages cannot amend the retained first-stage policy. Fixture allocations are not verified sales, and approval does not authorize spending.

Free snapshots always target the published `stage.opensAt`, never UI acceptance time. Missing lists, source records or tranche prerequisites remain held. Draft exports distinguish the local whitelist digest from the codec list ID; copying that ID does not seal or publish records and leaves prices/schedules unchanged.

Approval packets are private local review artifacts, not release authorization. Safe result projections omit retained hidden asset state, raw record bytes and wallet arrays. Operator-supplied transfer addresses remain explicit review inputs. The original receipt output digest commits the underlying result, not the separately labeled safe summary. No automatic external publication or notification delivery occurs.

The synchronous session guard is specific to the local Node transaction driver: it checks authority before statements and commit and rejects outer transactions. It is not a hosted identity provider. Financial execution remains disabled; production operator identity and independent audit retention require release review.

## Acceptance

Run `node --test platform/operator/*.test.mjs` for the private boundary. Browser scripts require installed `PLAYWRIGHT_MODULE` and `BROWSER_EXE`; each uses disposable fixtures and closes browser/server afterward. `browser-qa.mjs` covers shared session, keyboard, confirmation and recovery behavior. The stage, governance, cut, source, upload, observation, action and draft browser scripts cover their named journeys at360/390/768/1440px. Detailed observed results, limits and source hashes are retained in `platform/validation/runs/2026-11-06-overnight/B12-*.json`; passing local checks do not establish production readiness.
