# Dani-Dex computer-use lessons

Each entry: wall seen, root cause, fix, regression check (`node test/computer-use.regression.mjs`).

1. Re-opening a page erased the form. Agents called browser_open again on the page they were on. Fix: open on the current URL returns the page state instead. Check 2.
2. Agents looped on the same call (find, click). Fix: repeat-call breaker after 3 identical calls, find falls back to the full page. Check 6. Scheduler also aborts an agent after 130 calls in one launch (counted from the launch, not the whole log).
3. Embedded forms were invisible (a vendor site: embedded survey in a cross-site iframe, agent reported "form absent"). Fix: browser_read appends the exact frame URL to open top-level. Check 1 and 5.
4. Custom dropdowns (a vendor site looped 95+ calls). Fix: browser_select handles non-select widgets: click, type, pick the matching option. If it does not take in 2 tries, report a wall. Check 4.
5. Plain "I'm not a robot" checkbox (a vendor site). Fix: browser_captcha_checkbox does a real mouse move, press and release on the checkbox frame, waits, and reports passed, unknown, or WALL if a puzzle appears. Read output says when the checkbox is present. Puzzles and image challenges are never solved: stop and report a wall.
6. Model stalls: free models other than deepseek hang for minutes with no tool call; deepseek stalls about every 4 minutes. Fix: watchdog aborts and re-prompts after 180s of silence; keepalive re-prompts idle sessions after transient 503s.
7. Text-only agents tried to open screenshots and hung. Fix: browser_screenshot tells them it is for the operator only; use browser_read.
8. Missing facts (City, company address). Fix: entity address in the value pack. A required field with no known value is still a wall; never invent.
9. Scheduling: 2 GB RAM allows 2 Chrome agents. scripts/queue.sh keeps at most MAXRUN agents running, launches the next from the queue file, and ledgers every finished result. Finished agents print "done:" after a session prefix, so match "done: " anywhere in the line.
10. Native OS dialogs and non-browser windows: desktop_call (driver, text-only AT-SPI and coordinate actions) is the fallback. Not yet used on a real form.
11. Cloud browser has a daily minute budget; the local headless Chrome bridge is the fallback.
12. Remote control: monitor page behind a 6-digit code with pause, stop agent and add-to-queue.
13. Checkbox verdict is slow on a loaded box (click registers, spinner shows for 10-60s when load is high). The tool polls up to 25s for a verdict. Agents must call it first on a "confirm you're human" box; a vendor site's agent clicked the frame by ref instead and reported "did not register". Real fix for speed is RAM: keep Chromes at 2.
14. Date inputs (a vendor site: "required date field would not retain a value"). Typed text does not set input[type=date]. Fix: browser_fill detects date/month/time fields, converts dd/mm/yyyy to ISO, sets the value through the native setter and fires input and change. Check 5 (7 checks total).
15. Required facts we do not hold stay walls. Never invent a URL or value; report the missing fact.
16. Custom opencode agent profiles break the free route: a non-built-in agent gets 403 "free tier can only be used from within OpenCode". Use the default agent; tune through the prompt template, not a profile.
17. Free model routes drift: deepseek hung 30s+ on a trivial prompt while nemotron-3.5-lightning-free and beam-free answered in 1-4s and called browser tools. Probe routes with a one-word prompt before assigning a model.
18. Leaked Chromes: aborting or finishing an agent without browser_release left Chromes running (5 live, load 25, kswapd thrash). Bridge now reaps sessions idle for 8 minutes.
19. RAM per agent: two form agents plus opencode exceed 2 GB on heavy pages (load 19, CDP timeouts). Bridge blocks images, media and fonts (BLOCK_HEAVY=0 to disable) and trims Chrome background features. Queue runs MAXRUN=1 until the measured memory allows 2.

20. Per-site memory: docs/site-memory.json hints are injected into browser_read by host. Add an entry after every wall.

21. queue.sh crashed silently when /tmp/base-<app> was empty (arithmetic error) and nothing restarted it. Fixed with a default of 0; manager pass must check pgrep queue.sh.

22. A tool hint worded like a page notice was reported by the agent as a WALL (a vendor site). Hints are now labelled TOOL INSTRUCTION and the prompt forbids quoting them as walls.

23. A single browser_open hung 250s (several 30s CDP timeouts in series) and froze the agent. Every call now has a 60s overall deadline that returns an instruction instead of hanging.

24. Desktop control needs: a session bus + AT-SPI bus (else the tree is degraded to window titles), a window manager (xfwm4) for keyboard focus, element_token (not bare index), and delivery_mode foreground for keys. scripts/desktop-up.sh sets all of it; test/desktop-control.regression.mjs checks screen read, mouse/keyboard, launch, window switch, file dialog.
