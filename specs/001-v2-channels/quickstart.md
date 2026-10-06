# Review and use this source patch

Apply changes.patch to the recorded main base with `git apply --check changes.patch`, then `git apply changes.patch`.
Preview without downloads: `node onboard/bin/dani-dex-onboard.js --dry-run --no-launch`.
Preview Bash: `bash scripts/onboard.sh --dry-run --no-launch`.
Run either local script without --dry-run to install a release after checksum verification.
Windows candidate: `powershell -File scripts/onboard.ps1 -DryRun`; native tests remain required.
The npm package is still unpublished. These changes are not released or on remote main.

--no-launch skips the bootstrap launcher; the Windows installer has its own launch checkbox.
Installer runs in the foreground. Stop only its process; never kill by executable pattern.
An interrupted update may leave an install-lock and a .dani-dex-install-* recovery directory.
Inspect that installer process and recovery copy before manual recovery; do not blindly remove a lock.
Remove an installed app manually to uninstall. Leave owner profiles intact.
Versioned CLI packaging, supported update/rollback lifecycle and clean-machine acceptance remain pending.
