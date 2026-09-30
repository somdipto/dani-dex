/** A single bounded provider run. Ordinary cancellation and approval gates remain in force. */
export function loopCommandInstructions(text: string): string | null {
  const match = /^\/(loop|goals?)(?:\s+([\s\S]+))?$/.exec(text.trim());
  if (!match) return null;
  if (!match[2]?.trim()) throw new Error("Use /loop or /goal followed by the task and its completion checks.");
  return [
    "Run a bounded gauntlet for the task below. Use relevant installed skills before starting.",
    "Define testable completion checks. Work in small steps: reproduce or measure, change, test, inspect the actual result, then improve.",
    "Stop when every completion check is proven, when the user cancels, at a missing approval, or after five cycles. Never claim success from build/test exit codes alone when real behavior can be checked.",
    "Do not widen the task, spend money, send messages, or make destructive changes without the ordinary permission gates. No new recurring jobs. If blocked, report the exact missing input and completed evidence. At the cycle limit, report what remains instead of silently looping forever.",
    match[1] === "loop" ? "Task:" : "Goal: report remaining work explicitly; do not claim unattended future monitoring unless it is actually configured.", match[2].trim(),
  ].join("\n");
}
