export function createOptimizerClient({
  workerUrl = new URL("./optimizer-worker.mjs", import.meta.url),
  timeoutMs = 15000,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Optimizer timeout must be greater than zero.");
  let active = null, nextId = 0, disposed = false;
  const error = (name, message) => Object.assign(new Error(message), { name });
  const finish = (job, failure, result) => {
    if (active !== job) return;
    active = null;
    clearTimeout(job.timer);
    job.worker?.terminate();
    if (failure) job.reject(failure);
    else job.resolve(result);
  };
  const cancel = () => {
    if (active)
      finish(active, error("AbortError", "Pack mix calculation cancelled."));
  };
  return {
    run(products, base, target) {
      if (disposed)
        return Promise.reject(error("AbortError", "Optimizer has been closed."));
      cancel();
      return new Promise((resolve, reject) => {
        const job = { id: ++nextId, resolve, reject, worker: null, timer: null };
        active = job;
        try {
          job.worker = new Worker(workerUrl, { type: "module" });
          job.worker.onmessage = ({ data }) => {
            if (data?.id !== job.id) return;
            finish(job, data.error ? error(data.error.name || "Error", data.error.message) : null, data.result);
          };
          job.worker.onerror = (event) => {
            event.preventDefault();
            finish(job, error("Error", "Could not run the pack mix calculation. Please retry."));
          };
          job.worker.onmessageerror = () =>
            finish(job, error("Error", "Could not read the pack mix result. Please retry."));
          job.timer = setTimeout(() => finish(job, error(
            "TimeoutError", "Pack mix calculation took too long. Try a smaller target or fewer alternatives.",
          )), timeoutMs);
          job.worker.postMessage({ id: job.id, products, base, target });
        } catch (failure) {
          finish(job, failure);
        }
      });
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
