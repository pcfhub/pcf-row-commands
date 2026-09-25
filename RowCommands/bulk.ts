/**
 * Deleting a selection, one record at a time — a decision module: the delete
 * itself is handed in, so the suite can drive the order, a failure halfway and
 * a Stop without a platform.
 *
 * **Sequential on purpose.** One request in flight means a Stop takes effect
 * at the next record rather than after a burst already sent, a failure names
 * one record rather than a batch, and the user's own service-protection budget
 * is spent at the pace of one. `$batch` was considered and declined: faster
 * past fifty rows, and a multipart request and response nobody here has
 * measured, for a page that holds at most 250.
 */

export interface BulkItem {
    id: string;
    label: string;
}

export interface BulkFailure extends BulkItem {
    detail: string;
}

export interface BulkResult {
    deleted: BulkItem[];
    failed: BulkFailure[];
    /** True when a Stop or a teardown ended the run with records left. */
    stopped: boolean;
    /** How many were never attempted. */
    remaining: number;
}

export interface BulkOptions {
    /** Asked before each record. A Stop, or the control being destroyed. */
    shouldStop: () => boolean;
    /** After each record, with how many are done. */
    onProgress: (done: number, total: number) => void;
    /** A rejection as text — a Web API rejection is a plain object, not an Error. */
    describe: (error: unknown) => string;
}

/**
 * Run `remove` over `items` in order. **Never rejects**: every failure is a
 * row in the result, because the caller's job afterwards — refresh once, say
 * what happened — is the same whichever records failed.
 */
export function runSequential(
    items: BulkItem[],
    remove: (id: string) => Promise<unknown>,
    options: BulkOptions,
): Promise<BulkResult> {
    const result: BulkResult = { deleted: [], failed: [], stopped: false, remaining: 0 };

    const step = (index: number): Promise<BulkResult> => {
        if (index >= items.length) {
            return Promise.resolve(result);
        }

        if (options.shouldStop()) {
            result.stopped = true;
            result.remaining = items.length - index;

            return Promise.resolve(result);
        }

        const item = items[index];

        let attempt: Promise<unknown>;

        try {
            attempt = Promise.resolve(remove(item.id));
        } catch (error) {
            // A remove that throws synchronously is a failure of this record,
            // not of the run.
            attempt = Promise.reject(error);
        }

        return attempt
            .then(
                () => {
                    result.deleted.push(item);
                },
                (error: unknown) => {
                    result.failed.push({ ...item, detail: options.describe(error) });
                },
            )
            .then(() => {
                options.onProgress(index + 1, items.length);

                return step(index + 1);
            });
    };

    return step(0);
}
