# Dani-Dex

**Your own AI team, on your own computer.** Tell Dani-Dex what you need in plain words. Its agents
plan the work, use your apps, files and browser, talk to each other, and come back with the job done.

<p align="center">
  <a href="https://github.com/somdipto/dani-dex/releases/latest/download/Dani-Dex-mac-universal.dmg"><img alt="Download for macOS" src="https://img.shields.io/badge/Download_for-macOS-111111?style=for-the-badge&amp;logo=apple&amp;logoColor=white"></a>
  <a href="https://github.com/somdipto/dani-dex/releases/latest/download/Dani-Dex-windows-x64.exe"><img alt="Download for Windows" src="https://img.shields.io/badge/Download_for-Windows-0078D4?style=for-the-badge&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0wIDBoMTEuNHYxMS40SDB6TTEyLjYgMEgyNHYxMS40SDEyLjZ6TTAgMTIuNmgxMS40VjI0SDB6TTEyLjYgMTIuNkgyNFYyNEgxMi42eiIvPjwvc3ZnPg%3D%3D"></a>
  <a href="https://github.com/somdipto/dani-dex/releases/latest/download/Dani-Dex-linux-x86_64.AppImage"><img alt="Download for Linux" src="https://img.shields.io/badge/Download_for-Linux-E95420?style=for-the-badge&amp;logo=linux&amp;logoColor=white"></a>
</p>

<p align="center">
Click your platform and the installer downloads right away, always the newest release.
<br>
<a href="https://github.com/somdipto/dani-dex/releases/latest">All downloads and checksums</a>
</p>

[![CI](https://github.com/somdipto/dani-dex/actions/workflows/ci.yml/badge.svg)](https://github.com/somdipto/dani-dex/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/somdipto/dani-dex?label=latest)](https://github.com/somdipto/dani-dex/releases/latest)
[![License](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue.svg)](LICENSE)

## What you can get done

- **Hand off the busywork.** "Sort these receipts into a spreadsheet." "Rename and file every PDF
  in Downloads." "Turn my meeting notes into a to-do list." The agent does it on your computer,
  with your files, and shows you the result.
- **Research and write.** Ask for a market scan, a competitor comparison, a launch plan or a first
  draft. Agents read the web in their own browser, collect sources and hand back a finished
  document.
- **Build things.** Agents write and run code, fix bugs, make websites and test their own work,
  using the coding tools developers already trust.
- **Run a small team, not one chatbot.** Give each agent a job - researcher, writer, developer,
  assistant. The Chief agent splits a big goal into parts, hands them out, and puts the pieces
  together.
- **Use your computer like you do.** With your permission, agents can see the screen and click and
  type in your apps (Computer Use), so they can work in software that has no API.
- **Talk instead of type.** Speak a request and Dani-Dex turns it into text on your computer.

## Why Dani-Dex

- **It works where your work is.** Your files, your apps and your logins stay on your computer.
  Nothing has to be uploaded to a cloud machine first.
- **Bring the AI you already pay for.** Use ChatGPT (Codex), Claude, Grok or OpenCode, and pick a
  different one for each agent. Dani-Dex uses the login you already have. OpenCode's free models
  work with no account at all.
- **No Dani-Dex account.** Download it, open it, start. No sign-up, no subscription.
- **Source available.** Anyone can read the code and change it for noncommercial use.
- **Updates itself.** From version 0.17.2 on, Dani-Dex offers each new version inside the app and
  restarts into it.

### How it compares

Checked in September 2026 against public pages about each product.

| | Dani-Dex | [Grok Bot](https://x.ai/news/introducing-grok-bot) | [Instinct](https://instinct.com/) |
| --- | --- | --- | --- |
| Where the agent works | Your own computer | A persistent cloud computer, shared by all your bots ([xAI docs](https://docs.x.ai/grok-bot/overview)) | Connected to your email, calendar and messaging, and you talk to it over iMessage and WhatsApp ([WIRED](https://www.wired.com/story/i-finally-found-an-ai-agent-worth-the-risk/)) |
| Runs on your laptop | Yes | No, its bots run on the cloud computer ([xAI docs](https://docs.x.ai/grok-bot/overview)) | Connects to your apps and devices ([instinct.com](https://instinct.com/)) |
| Getting in | Free download, no Dani-Dex account | Through [x.ai/bot](https://x.ai/bot) | Invite-only when WIRED reviewed it |

**Where Dani-Dex is different from Grok Bot:** Grok Bot's bots work on a cloud computer that xAI
runs. Dani-Dex's agents work on your own computer, next to the files and desktop apps you already
have, and they can run on a ChatGPT, Claude, Grok or OpenCode login.

## Our mission

We are building a **self-improving personal assistant**: one that learns how you work, gets better
at your tasks each time it does them, and takes on more of your work as it earns your trust. It
should run where your life already is, with the AI you choose, and stay yours.

Dani-Dex is the first step: a team of agents on your computer that can already do real work.

## Get started

1. Click the download button for your computer above.
2. Install it:
   - **Mac:** open the file and drag Dani-Dex to Applications. The first time, Control-click
     Dani-Dex in Applications and choose **Open**. If macOS still blocks it, go to **System
     Settings > Privacy & Security** and click **Open Anyway**. One app works on both Apple silicon
     and Intel Macs.
   - **Windows:** run the installer. If a blue SmartScreen window appears, click **More info**,
     then **Run anyway**.
   - **Linux:** make the AppImage executable and run it. Some newer Ubuntu and Debian versions need
     one extra step, described in the [Linux notes](docs/DEVELOPMENT.md#linux-launch-details).
3. Open Dani-Dex and pick an AI. OpenCode's free models work right away. For ChatGPT, Claude or
   Grok, click Connect and sign in with that service.
4. Tell the Chief agent what you want, like "Turn these release notes into a launch plan."

Dani-Dex runs on macOS 13 or newer, Windows 10 or newer (x64) and x64 Linux. The apps are not
code-signed yet, which is why Mac and Windows show a warning the first time.

> [!WARNING]
> Dani-Dex is an early preview. Agents can read and change files, run programs, use the internet and
> control the browser on your computer without asking before each step. Give them tasks you trust,
> keep backups, and read [SECURITY.md](SECURITY.md).

## Privacy

Dani-Dex keeps your agents, chats and files on your computer. The AI provider you pick (OpenAI,
Anthropic, xAI or OpenCode) receives what the agent sends it, and web pages the agent visits see
that visit. Dani-Dex never copies your provider passwords. Details are in [PRIVACY.md](PRIVACY.md).

Need help? See [Troubleshooting](docs/TROUBLESHOOTING.md) or [SUPPORT.md](SUPPORT.md).

## For developers

Building from source, commands, architecture, local data paths, releases and shared Mac hosts are
in the [development guide](docs/DEVELOPMENT.md). See also [ARCHITECTURE.md](docs/ARCHITECTURE.md),
[RELEASING.md](docs/RELEASING.md) and [the changelog](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). By contributing, you agree that your contribution is licensed
under PolyForm Noncommercial 1.0.0. Community behavior is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License and attribution

Copyright 2026 Norbert Bodziony.

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and
distribute the code for permitted noncommercial purposes. Commercial use requires a separate license
from the copyright owner. Versions up to and including 0.1.11 remain available under Apache-2.0.
See [NOTICE](NOTICE) for attribution and third-party notices.

Dani-Dex is an independent source-available project and is not affiliated with, endorsed by, or
sponsored by OpenAI. OpenAI, ChatGPT, and Codex are used only to describe compatibility with their
respective products and services.
