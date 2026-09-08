/**
 * A small pool of worker threads running bookProcessorWorker.
 *
 * Keeps metadata extraction off the main thread so the API stays responsive
 * while the library is being scanned. Workers are spawned on first use and
 * restarted if one dies, so a crash inside a processor costs one book rather
 * than the whole server.
 */
const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'bookProcessorWorker.js');
const DEFAULT_SIZE = Number(process.env.PROCESSOR_WORKERS) || 2;

class BookProcessorPool {
  constructor(size = DEFAULT_SIZE) {
    this.size = Math.max(1, size);
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;

    for (let i = 0; i < this.size; i++) {
      this.spawn();
    }

    console.log(`🧵 Book processor pool started with ${this.size} worker(s)`);
  }

  spawn() {
    const worker = new Worker(WORKER_PATH);

    worker.on('message', ({ id, result }) => {
      const job = this.pending.get(id);
      if (!job) return;

      this.pending.delete(id);
      job.resolve(result);
      this.release(worker);
    });

    // A worker that dies takes its in-flight job with it. Fail that one job and
    // replace the worker so the queue keeps draining.
    worker.on('error', (error) => this.retire(worker, error));
    worker.on('exit', (code) => {
      if (code !== 0) this.retire(worker, new Error(`Worker exited with code ${code}`));
    });

    this.workers.push(worker);
    this.idle.push(worker);
    this.drain();
  }

  retire(worker, error) {
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);

    for (const [id, job] of this.pending) {
      if (job.worker !== worker) continue;
      this.pending.delete(id);
      job.resolve({ success: false, error: error.message });
    }

    worker.terminate().catch(() => {});

    if (this.started && this.workers.length < this.size) {
      this.spawn();
    }
  }

  release(worker) {
    if (this.workers.includes(worker) && !this.idle.includes(worker)) {
      this.idle.push(worker);
    }
    this.drain();
  }

  drain() {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const worker = this.idle.pop();
      const job = this.queue.shift();

      job.worker = worker;
      this.pending.set(job.id, job);
      worker.postMessage({ id: job.id, filePath: job.filePath });
    }
  }

  /**
   * Extract metadata for one book. Always resolves — failures come back as
   * { success: false, error } rather than rejecting, so a bad file cannot
   * interrupt a scan.
   */
  process(filePath) {
    this.start();

    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, filePath, resolve });
      this.drain();
    });
  }

  async shutdown() {
    this.started = false;
    const workers = this.workers.slice();
    this.workers = [];
    this.idle = [];
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
  }
}

module.exports = new BookProcessorPool();
