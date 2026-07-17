export class GeodeWorker {
  constructor(workerUrl, config = {}, hooks = {}) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.config = config;
    this.onWarn = hooks.onWarn ?? ((m) => console.warn('[geodepdf]', m));
    this.jobs = new Map();
    this.seq = 0;

    this.worker.postMessage({ type: 'init', init: config });

    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'warn') { this.onWarn(m.message); return; }
      const job = this.jobs.get(m.id);
      if (!job) return;
      if (m.type === 'progress') { job.onProgress?.(m); return; }
      this.jobs.delete(m.id);
      if (m.type === 'done') {
        job.resolve({
          bytes: m.bytes !== undefined ? new Uint8Array(m.bytes) : undefined,
          files: m.files?.map((f) => ({ ...f, bytes: new Uint8Array(f.bytes) })),
          text: m.text,
          ms: m.ms,
          summary: m.summary,
        });
      }
      else if (m.type === 'cancelled') job.reject(Object.assign(new Error('cancelled'), { name: 'Cancelled' }));
      else job.reject(Object.assign(new Error(m.message), { workerStack: m.stack }));
    };

    this.worker.addEventListener('error', (e) => {
      const err = new Error('worker failed: ' + (e.message || 'script failed to load or parse'));
      for (const [, j] of this.jobs) j.reject(err);
      this.jobs.clear();
    });
  }

  run(op, input, opts = {}, onProgress) {
    const id = ++this.seq;

    const job = { op, opts };
    const transfers = [];
    if (Array.isArray(input)) {
      job.files = input.map((f) => {
        const buf = f.bytes.slice().buffer;
        transfers.push(buf);
        return { name: f.name, bytes: buf };
      });
    } else if (input) {
      job.bytes = input.slice().buffer;
      transfers.push(job.bytes);
    }

    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.jobs.set(id, { resolve, reject, onProgress });

    this.worker.postMessage({ type: 'run', id, job }, transfers);

    return { promise, cancel: () => this.worker.postMessage({ type: 'cancel', id }) };
  }

  compress(bytes, preset = 'email', onProgress) {
    return this.run('compress', bytes, { preset }, onProgress);
  }

  redact(bytes, redactions, method = 'auto', onProgress) {
    return this.run('redact', bytes, { redactions, method }, onProgress);
  }

  merge(files, onProgress) {
    return this.run('merge', files, {}, onProgress);
  }

  imagesToPdf(files, opts = {}, onProgress) {
    return this.run('images-to-pdf', files, opts, onProgress);
  }

  terminate() { this.worker.terminate(); }
}

