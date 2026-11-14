# Historical Genesis governance support

The in-app Genesis advisory ballot was retired on 2026-11-14. Community timing feedback can be gathered through social or Discord polls; this change does not create a polling integration or send messages.

The current app, legacy web fallback, public Node/Worker API, capability discovery and generated SDK do not provide ballot reads or vote submission. NFTs and Genesis detail pages show published release stages instead. Current policy and collection responses omit the retired vote duration, choices and one-vote limit. The historical PRD policy object remains unchanged for recorded economics and recovery.

Founder approval, published stage notice, collection eligibility, economic policy checks and release gates remain mandatory. Removing advisory voting does not approve a launch, open a sale, move funds or change mint prices.

Retained compatibility infrastructure:

- Historical `genesis_ballots`, `genesis_voters`, `genesis_votes`, `genesis_decisions`, publication bindings, receipts and migrations remain intact.
- Governance domain repositories, read models, internal operator commands and historical fixture handlers remain for replay, audit validation and recovery. They are not mounted in either product runtime.
- Governance and collection/recovery fixtures continue testing immutable decisions, source bindings, bounded writes, legacy adoption, founder authority and stage-opening safeguards. The public route parity test now verifies retirement, while the internal D1 fault tests remain.
- Historical inbox preferences and notice types remain readable for compatibility. Voting is no longer advertised or selectable; the app filters old voting notices. Saving current topics omits the retired topic without changing consent automatically on read.

Acceptance evidence is recorded by `platform/edge/test/governance.test.mjs` (Node/Worker API retirement and retained records) and `platform/site/tests/navigation-qa.mjs` (no ballot UI or requests). Historical test reports describe earlier behavior and are not current product instructions.
