# Local context import

agent:import-local-context accepts explicit accountId, serverId=local, agentId and up to 64 texts,
each at most 500 characters. Missing account binding or a remote destination fails before writes.
Unresolved account state blocks; a signed-out local account is valid. Main redacts all input again.
Result: saved count and failedTexts; only read-back database rows count as saved.
No new remote Team API meaning or endpoint is introduced.
Existing memory APIs gain an optional fixed server argument; omitted calls retain their released behavior.
The memories port captures its destination once instead of reading selectedServerId on each operation.
