// Restart-proof tasks: anything the journal still shows as queued or running
// belongs to a process that died. Re-kick it once, on boot, before new work.
// runTask routes by task kind, so computer tasks resume through their worker.
export function resumeInterrupted(store, runTask) {
  if (typeof runTask !== "function") return [];
  const resumed = [];
  for (const t of store.tasks.values()) {
    if (t.state !== "queued" && t.state !== "running") continue;
    store.log(t.id, "resumed after restart");
    queueMicrotask(() => runTask(t.id));
    resumed.push(t.id);
  }
  return resumed;
}
