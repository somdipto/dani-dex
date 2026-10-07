# Open Instinct acceptance ledger

The master issue received this additional plan while PR 18 was in progress:
https://github.com/somdipto/dani-dex/issues/1#issuecomment-6043695471.
The rows below track that comment's requirements. They are requirements, not claims of source or live verification.
Adoption needs the existing V2 source and the specified owner, audience, permission and receipt boundaries.

| Item | Required result | Current gate |
| --- | --- | --- |
| OI-01 phone/message entry | Authenticated intake and one reviewed reply to the exact conversation; durable replay protection | Adapter, owner account, eligibility and budget |
| OI-02 email identity | Complete thread/attachments; reviewed account, recipients and body; correct-thread receipt | Adapter and approved email pilot; From is not owner authority |
| OI-03 channel indicators | Supported reaction reaches the intended message once; typing stops on finish/cancel | External transport capabilities and receipt reliability |
| OI-04 content/audience hydration | Bounded media; versioned audience; participant changes invalidate pending private disclosures | External intake, audience model, URL/MIME/path threat tests |
| OI-05 verified contacts | Distinct people with duplicate names; verified identifier changes; effective revoke/delete | Contact identity and provenance model |
| OI-06 scoped grants | Explicit person/purpose/action/audience/destination/expiry; execution rejects missing or revoked authority | Grant model and external enforcement; relationship labels do not grant access |
| OI-07 peer requests | Two independent owners exchange a verified, scoped, versioned request/result | Protocol and consented counterpart; interoperability proof |
| OI-08 invitations | Pending/declined/revoked invitations disclose nothing; reviewed fallback recipient/channel | Verified peer binding and invitation adapter |
| OI-09 scheduling negotiation | Minimized free/busy exchange; resolved timezone/date; separate approval/readback for calendar writes | Calendar account/pilot and typed intent schemas |
| OI-10 group planning | Independent grants/routes; missing or declined reply stays unresolved; restart and audience-change safety | Peer routing and three-person pilot |
| OI-11 resumable peer work | Durable original target/generation; ordered receipts; cancellation prevents later sends | Peer inbox/outbox and uncertain-effect reconciliation |
| OI-12 owner approval | Exact immutable continuation; authenticated owner; one consumed approval; changed payload invalidates it | External approval delivery and token/payload threat tests |
| OI-13 app connection | Owner-bound OAuth callback refreshes tools; real permitted read; disconnect stops use | Catalog over existing MCP/OAuth and selected account |
| OI-14 connector coverage | Current schemas/status; honest unavailable result; real workflow for each claimed connector | Supported/tested matrix and owner-selected pilot |
| OI-15 sensitive-action guard | Explicit effect metadata; inspect every batch member; enforce across harnesses at execution | General effect boundary beyond the existing harmless receipt pilot |
| OI-16 hosted worker | Harmless permitted task finishes with laptop off; isolated durable state and effective teardown/cost cap | Optional infrastructure, account and budget decision |
| OI-17 cloud actions | Verified coordinates/pixels; stale resize cannot misclick; failure stops bounded batch | Optional hosted adapter and native evidence |
| OI-18 remote takeover | Short-lived owner-only access; protected credentials; expired/wrong owner denied; checked resume | Hosted access/session design and real takeover proof |
| OI-19 provisioning | Two isolated tenants; durable limits/dedupe; no duplicate resources; partial setup cleans up | Optional hosted service and resource/budget approval |
| OI-20 one-shot delivery | One execution across restart/DST/catch-up; delete prevents run; route cannot widen authority | Existing scheduler extension, external delivery and hosted wake |
| OI-21 portable memory | Scoped export/import/edit/delete; provenance and correction; approved preference projection | Import privacy path repaired here; journal/projection and peer disclosure remain pending |
| OI-22 persona/skills | Owner style applies to intended turn; private instructions excluded; demonstrated real tool use | Extend existing editing/export only where needed; no runtime/provider replacement |
| OI-23 research/files | Rendered export and reviewed attachment with checksum/receipt; private-network and file escape denial | Real export/delivery adapter and fetch/path threat tests |
| OI-24 purchase rail | Region-valid route; secure exact-total approval; executor-only secrets; reconciled uncertain order | Optional rail/account choice; sandbox first, live purchase separately approved |
| OI-25 spending policy | Typed merchant/currency/minor units; atomic pending reservations; concurrent cap enforcement | General policy/accounting; no implicit spend authority |
| OI-26 owner audit | Request/task/proposal/effect/readback joined; blocked and uncertain distinct; redacted scoped export | Owner activity UI and retention/reconciliation policy |
| OI-27 ingress defenses | Auth before model; durable replay rejection; isolation; private-network/redirect/path/injection denial | Actual adapters and adversarial restart/concurrency tests |
| OI-28 CLI/backup | Versioned checksum install; secret-free setup; retained data on rollback; backup/restore/teardown | V205 artifact plus external setup and optional hosting support |
| OI-29 playbooks | Consented real outcome with receipt or honest handoff | Selected tools/vendor/pilot; a playbook alone is not an integration |

Ordered tasks OI-T01 through OI-T15 remain open. The context-import repair supplies the source fix
for OI-T04 and part of OI-21; the full external integration and live acceptance are still pending.
Identity/audience/grant/effect schemas precede new external channels. Telegram and one approved app
workflow precede peer coordination, optional hosting and optional purchases.

No upstream code is extracted in this PR. Any future extraction must retain the upstream attribution
and license in a scoped third-party record while preserving Dani-Dex LICENSE and NOTICE.
Accounts, external messages, paid resources and purchases require the specified owner choices.
Issue 1 stays open until these requirements and the V1/V2/PTT ledger have verified results.
