export class AsyncLock {
    private locked = false;
    private lockedAction : Promise<unknown> = Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async runLocked<T>(action: (...args: any[]) => Promise<T>, ...args: unknown[]): Promise<T> {
        if (this.locked) {
            while (this.locked) {
                try {
                    await this.lockedAction;
                }
                catch {
                    // only report the error to the primary caller
                }
            }
        }
        try {
            this.locked = true;
            this.lockedAction = action(...args);
            return (await this.lockedAction) as T;
        }
        finally {
            this.locked = false;
        }
    }
}
