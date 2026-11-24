import { startWorker } from './worker';

// Entry point for webhook and notification delivery, auto-archive, cycle upkeep and
// the upload and trashed-project cleanup.
// The api applies database migrations on startup.
console.log('[worker] worker starting');
const worker = startWorker();

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, stopping`);
  worker.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
