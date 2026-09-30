import pc from 'picocolors';
import { err } from './format.js';

/**
 * A single updating status line on a TTY stderr; periodic plain lines when
 * piped, so logs stay readable in cron and CI.
 */
export class Progress {
  private readonly tty = !!process.stderr.isTTY;
  private lastPlain = 0;
  private active = false;

  update(done: number, total: number, label: string): void {
    const pct = total ? Math.floor((done / total) * 100) : 100;
    if (this.tty) {
      const barWidth = 24;
      const filled = Math.round((pct / 100) * barWidth);
      const bar =
        pc.cyan('█'.repeat(filled)) + pc.dim('░'.repeat(barWidth - filled));
      const cols = process.stderr.columns || 80;
      const line = `${bar} ${done}/${total} ${label}`;
      process.stderr.write(`\r\u001b[2K${line.slice(0, cols + 20)}`);
      this.active = true;
    } else if (done === total || Date.now() - this.lastPlain > 5000) {
      this.lastPlain = Date.now();
      err(`${done}/${total} (${pct}%) ${label}`);
    }
  }

  /** Clear the status line so a normal log line can be printed. */
  clear(): void {
    if (this.tty && this.active) {
      process.stderr.write('\r\u001b[2K');
      this.active = false;
    }
  }
}
