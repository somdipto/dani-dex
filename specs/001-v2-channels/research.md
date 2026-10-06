# Source findings, 2026-10-06

Base: 9e5d7027fbb1bbf65d1dd6b53be03475306ba648 (published main).
Remote prod-2 / 395efae was unavailable. That candidate was not inspected or reconciled.

All three installers allowed unverifiable downloads. Node hashed the complete file in memory.
Node exited before cleanup, ignored Windows installer exit codes, and did not await Mac unmount.
Mac installers deleted the previous app before copying. Linux overwrote the installed file directly.
PowerShell selected a stable alias although checksum manifests contain versioned filenames.

Use platform tools already present. Reject fallback installation and new installer dependencies.
Bundled spec-kit pin remains github/spec-kit@67ab049e8d43d59d7092531fd0f1ff56943ad015 (MIT).
No extension file was found at root. No external price or eligibility claim was made.
