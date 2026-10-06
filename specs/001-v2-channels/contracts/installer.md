# Installer contract

Manifest format: SHA256, whitespace, optional GNU `*`, safe Dani-Dex basename, LF or CRLF.
Platform suffix: -universal.dmg, -x86_64.AppImage, or -x64.exe.
Reject missing/empty/ambiguous manifests, invalid hashes, path components and wrong architecture.
Verify downloaded bytes before starting the platform installer.
Node/Bash failure: nonzero process exit, no successful completion message, preserved prior app.
PowerShell failure: terminating error with finally cleanup. Native execution remains unverified.
