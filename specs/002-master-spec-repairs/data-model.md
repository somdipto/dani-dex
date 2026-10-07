# State and authority

PendingBatch v2: accountId (null for local signed-out use), serverId=local, agentId, batchId,
entries with stable IDs and redacted text. Text equality identifies content; completion removes only
entries in its own snapshot. Storage keys and stored scope must agree. Invalid data is held.
All staging and completion mutations use the origin's Web Locks shared across windows. Staging adds
to the latest batch; it never replaces another window's newer entries. Missing lock support blocks
import writes and sends without removing data. The lock is released before main IPC work.
Legacy global arrays have no authority or destination; explicit redacted content review rebinds them.

ImportLocalContext: bounded texts plus immutable scope. Main validates account before any write,
performs synchronous local database writes and readback, and returns saved count/failed texts.
Existing SQLite duplicate folding and durable records make lost-response replay safe while a memory exists.
An explicit deletion is a new owner action; no automatic retry resurrects it.

Voice requests use an opaque request ID for owned cancellation. Raw audio stays temporary;
provider credentials and transcript text are excluded from diagnostics and analytics.
