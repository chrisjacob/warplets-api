# Accepted business replay after normal V2 recovery

B11-70 uses the genuine `modern-pending` adoption profile from B11-67: one settled historical admission, a new fulfilled normalized mint, another accepted pending normalized mint, and a later published stage. It follows only normal V2 start/step/finish calls into private ready state. No semantic prerequisite proof or checkpoint phase is injected.

The fresh target then disables all operator scopes, appends a synthetic collection-mint pause and evaluates beyond all original stage closing times. The source artifact store is discarded. Reissuing the wallet's original mint command must return the exact retained receipt and result. A changed body under the same key conflicts; a fresh key is rejected with `operator-pause`. Every business table is compared before and after those commands, after the pause is installed. The pending commitment remains unchanged, and transaction intents remain absent.

This wallet command does not require an operator scope. Revocation is additional fixture context, not an assertion that the wallet was authorized through an operator grant. The explicit pause is the demonstrated fresh-command denial. Source loss means the source capture objects are absent; independently restored target objects remain available.

Node uses the production mint service/repository through the existing private dispatch helper. The separate workerd fixture delegates recovery to the unchanged B11-67 fixture, then invokes the same production mint service/repository with a D1 driver. The private test route is not mounted by the product Worker. Financial execution remains false.

This acceptance covers the supported pending normalized mint profile. It does not extend legacy adoption to pending original admissions, pre-adoption progression histories, or missing original evidence. Existing progression reservation recovery tests retain their separate scope.
