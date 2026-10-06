# Installer state

Manifest entry: exactly one platform artifact basename and a 64-digit hexadecimal SHA256.
Download: unique temporary directory, outside owner profiles.
Update: exclusive destination lock; same-filesystem staging/next and optional staging/previous.
Copy completes before the old app moves. Failed activation restores previous.
Failed restoration retains previous and the lock for manual recovery.

No database entities, credentials, channel grants or provider state were added.
