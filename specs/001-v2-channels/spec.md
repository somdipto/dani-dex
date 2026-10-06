# Issue 15: installer cleanup slice

Source: https://github.com/somdipto/dani-dex/issues/15
Owner request: fix bugs and reduce overhead in the available source.

1. V205/A1: require one valid platform checksum entry before downloading an artifact.
2. V205/A2: verify bytes before installation; incomplete or corrupt downloads must fail.
3. V205/A3: stage updates before replacing an app; preserve the previous app on failure.
4. V205/A4: preserve owner data and recovery copies; reject concurrent installation.
5. V205/A5: report process failures and remove temporary downloads.
6. V205/A6: reduce memory use and repeated setup output without adding dependencies.

BUILT: this installer slice. LIVE-VERIFIED: none of V201–V212.
V205 is not complete: native Mac/Windows, release packaging, lifecycle and rollback acceptance remain.
The issue's unpublished Telegram/client candidate is unavailable here. No replacement gateway was invented.
Slack, team actions, WhatsApp, phone, meetings and duplex voice remain outside this cleanup slice.
