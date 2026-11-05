import type { ChildProcess } from 'node:child_process';

const KILL_GRACE_MS = 2_000;

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Tracks spawned child processes and provides idempotent, graceful termination
 * (SIGTERM with a 2-second SIGKILL fallback) to protect against leaked or orphaned children.
 */
export class ChildRegistry {
  private readonly children = new Set<ChildProcess>();
  private disposingPromise: Promise<void> | null = null;

  add(child: ChildProcess): void {
    if (!isAlive(child)) return;
    this.children.add(child);
    child.once('exit', () => {
      this.children.delete(child);
    });
  }

  size(): number {
    for (const child of this.children) {
      if (!isAlive(child)) {
        this.children.delete(child);
      }
    }
    return this.children.size;
  }

  async disposeAll(): Promise<void> {
    if (this.disposingPromise) {
      await this.disposingPromise;
      return;
    }

    const aliveChildren = Array.from(this.children).filter(isAlive);
    if (aliveChildren.length === 0) {
      this.children.clear();
      return;
    }

    this.disposingPromise = (async () => {
      for (const child of aliveChildren) {
        try {
          child.kill('SIGTERM');
        } catch {
          // Process might already be dead
        }
      }

      const exitPromises = aliveChildren.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (!isAlive(child)) {
              resolve();
              return;
            }
            child.once('exit', () => resolve());
          }),
      );

      let timer: NodeJS.Timeout | undefined;
      const gracePromise = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          for (const child of aliveChildren) {
            if (isAlive(child)) {
              try {
                child.kill('SIGKILL');
              } catch {
                // Ignore
              }
            }
          }
          resolve();
        }, KILL_GRACE_MS);
        timer.unref();
      });

      await Promise.race([Promise.all(exitPromises), gracePromise]);
      if (timer) clearTimeout(timer);
      await Promise.all(exitPromises);

      this.children.clear();
    })().finally(() => {
      this.disposingPromise = null;
    });

    await this.disposingPromise;
  }
}

export const defaultChildRegistry = new ChildRegistry();
