import async, { AsyncCargo } from "async";
import azure, { ServiceResponse, StorageError } from "azure-storage";
import { TransformableInfo } from "logform";
import { MESSAGE } from "triple-beam";
import TransportStream from "winston-transport";

export interface IAzureBlobTransportOptions extends TransportStream.TransportStreamOptions {
    containerUrl: string
    name?: string
    nameFormat?: string
    retention?: number
    trace?: boolean
}

interface ICleanState {
    prefix: string
    now: number
    entries: string[]
}

export const DEFAULT_NAME_FORMAT = "{yyyy}/{MM}/{dd}/{hh}/node.log";
const MS_IN_DAY = 24 * 60 * 60 * 1000;

export class AzureBlobTransport extends TransportStream {
    public name: string
    private trace: boolean
    private cargo: AsyncCargo
    private containerName: string
    private nameFormat: string
    private retention?: number
    private blobService: azure.BlobService

    constructor(opts: IAzureBlobTransportOptions) {
        super(opts);

        if (!opts.containerUrl) {
            throw new Error("The containerUrl property must be specified");
        }

        this.name = opts.name || "AzureBlobTransport";
        this.trace = opts.trace === true;
        this.buildCargo();
        this.createSas(opts.containerUrl);
        this.nameFormat = opts.nameFormat || DEFAULT_NAME_FORMAT,
        this.retention = opts.retention;

        if (this.retention) {
            setTimeout(this.cleanOldLogs, 1);
        }
    }

    private debug(msg: string) {
        if (this.trace) {
            console.log(msg);
        }
    }

    private createSas(containerUrl: string) {
        const url = new URL(containerUrl);

        let sas = url.search;
        if (sas.startsWith("?")) {
            sas = sas.substr(1);
        }

        this.debug(`create SAS for ${url.protocol}//${url.host}, sasToken=${sas}`);
        this.blobService = azure.createBlobServiceWithSas(
            `${url.protocol}//${url.host}`,
            sas);
        this.containerName = url.pathname;
        if (this.containerName.startsWith("/")) {
            this.containerName = this.containerName.substr(1);
        }

        // console.log(`create blob container ${url.protocol}//${url.host}/${this.containerName}`);
        // this.blobService.createContainerIfNotExists(this.containerName, (error, result, response) => {
        //     if (error) {
        //         console.error(`creating the blob container ${this.containerName} ` +
        //             `failed with ${JSON.stringify(error, null, 2)}`);
        //     }
        // });
    }

    public log(info: TransformableInfo, callback: () => void) {
        this.cargo.push({
            line: info[MESSAGE],
            callback
        });
    }

    private getBlobName() {
        const now = new Date();

        const M = "" + (now.getMonth() + 1);
        const d = "" + now.getDate();
        const h = "" + now.getHours();
        const m = "" + now.getMinutes();

        const name = this.nameFormat
            .replace("{yyyy}", "" + now.getFullYear())
            .replace("{MM}", M.padStart(2, "0"))
            .replace("{M}", M)
            .replace("{dd}", d.padStart(2, "0"))
            .replace("{d}", d)
            .replace("{hh}", h.padStart(2, "0"))
            .replace("{h}", h)
            .replace("{mm}", m.padStart(2, "0"))
            .replace("{m}", m);
        this.debug(`using log name ${name} based on format ${this.nameFormat}`);
        return name;
    }

    private nextClean?: number

    private parseName(name: string): number {
        // tslint:disable-next-line:one-variable-per-declaration
        let y = -1, M = 1, d = 1, h = 0, m = 0;
        // tslint:disable-next-line:one-variable-per-declaration
        let formatPos = 0, namePos = 0;
        let ok = true;

        while (namePos < name.length &&
               formatPos < this.nameFormat.length) {

            let formatChar = this.nameFormat.charAt(formatPos++);
            if (formatChar !== '{') {
                const nameChar = name.charAt(namePos++);
                if (nameChar !== formatChar) {
                    ok = false;
                    break;
                }
                continue;
            }
            let num = "";
            for (; namePos < name.length; ++namePos) {
                const numChar = name.charAt(namePos);
                if (numChar < '0' || numChar > '9') {
                    break;
                }
                num += numChar;
            }
            if (num.length === 0) {
                ok = false;
                break;
            }
            let format = "";
            while (formatPos < this.nameFormat.length) {
                formatChar = this.nameFormat.charAt(formatPos++);
                if (formatChar === '}') {
                    break;
                }
                format += formatChar;
            }
            if (formatChar !== '}') {
                ok = false;
                break;
            }
            const inum = parseInt(num, 10);
            if (format === "yyyy" || format === "y") {
                y = inum;
            } else if (format === "MM" || format === "M") {
                M = inum;
            } else if (format === "dd" || format === "d") {
                d = inum;
            } else if (format === "hh" || format === "h") {
                h = inum;
            } else if (format === "mm" || format === "m") {
                m = inum;
            } else {
                ok = false;
                break;
            }
        }

        if (!ok || y === -1) {
            this.debug(`the blob name ${name} does not match the name format ${this.nameFormat}` +
                `- parsed y = ${y}, M = ${m}, d = ${d}, h = ${h}, m = ${m}.`);
            return -1;
        }
        return new Date(y, M - 1, d, h, m).getTime();
    }

    private listBlobsCallback(
        state: ICleanState,
        error: StorageError,
        result: azure.BlobService.ListBlobDirectoriesResult,
        response: ServiceResponse
    ) {
        if (error) {
            console.error(`listing storage blobs failed with ${JSON.stringify(error, null, 2)}`);
            return;
        }

        const retention = this.retention! * MS_IN_DAY;

        for (const entry of result.entries) {
            const timestamp = this.parseName(entry.name);
            if (timestamp > 0) {
                this.debug(`parsed name ${entry.name} giving timestamp ${new Date(timestamp).toISOString()}` +
                    ` (ms = ${timestamp}, retention = ${retention},` +
                    ` expires = ${timestamp + retention}, now = ${state.now})`);
            }
            if (timestamp + retention < state.now) {
                this.debug(`clean old blob ${entry.name}`);
                state.entries.push(entry.name);
            }
        }

        if (result.continuationToken) {
            this.listBlobs(state, result.continuationToken);
        } else {
            this.listBlobsComplete(state);
        }
    }

    private listBlobs(state: ICleanState, token: azure.common.ContinuationToken | null) {
        this.blobService.listBlobsSegmentedWithPrefix(this.containerName, state.prefix, token!,
            (err: StorageError, res: azure.BlobService.ListBlobDirectoriesResult,
             resp: ServiceResponse) =>
                this.listBlobsCallback(state, err, res, resp));
    }

    private deleteBlobComplete(name: string, err: StorageError, result: boolean) {
        if (err) {
            console.error(`deleting old log {name} failed with ${JSON.stringify(err, null, 2)}`);
        } else {
            this.debug(`deleting old log ${name} ${result ? "succeeded" : "failed"}`);
        }
    }

    private listBlobsComplete(state: ICleanState) {
        for (const entry of state.entries) {
            this.debug(`deleting old log ${entry}`);
            this.blobService.deleteBlobIfExists(this.containerName, entry,
                (err: StorageError, result: boolean) =>
                    this.deleteBlobComplete(entry, err, result));
        }
    }

    private cleanOldLogs = () => {
        // only once per day
        const now = Date.now();
        if (this.nextClean && now < this.nextClean) {
            setTimeout(this.cleanOldLogs, this.nextClean - now);
            return;
        }

        const nowDate = new Date(now);
        this.nextClean = new Date(nowDate.getFullYear(),
            nowDate.getMonth(), nowDate.getDate()).getTime() + 86400000;

        const prefixIndex = this.nameFormat.indexOf('{');
        if (prefixIndex < 0) { // we can't clean if we can't get a date out of the file!
            this.debug(`unable to find a date in the name format ` +
                `${this.nameFormat} - unable to clean logs`);
            return;
        }
        const prefix = this.nameFormat.substr(0, prefixIndex);
        this.listBlobs({ now, prefix, entries: [] }, null);

        setTimeout(this.cleanOldLogs, this.nextClean - now);
        this.debug(`next clean at ${new Date(this.nextClean)}, `+
            `retention is ${this.retention} day${this.retention! > 1 ? "s" : ""}`);
    }

    private createBlockComplete(err: azure.StorageError, blobName: string, blockDone: () => void) {
        if (err) {
            console.error(`BlobService.createAppendBlobFromText(` +
                `${this.containerName}/${blobName}) failed with = ` +
                `${JSON.stringify(err,null,2)}`);
        }
        blockDone();
    }

    private writeBlockComplete(err: azure.StorageError, blobName: string,
        block: string, blockDone: () => void) {
        if (err) {
            if (err.code === "BlobNotFound") {
                // The cast here is because the docs differ from the typescript
                // bindings (there are other TS bugs, so go with the docs)
                const blobRequestOptions = {
                    absorbConditionalErrorsOnRetry: true
                } as azure.BlobService.CreateBlobRequestOptions;

                this.debug(`creating new blob ${this.containerName}/${blobName}`);
                this.blobService.createAppendBlobFromText(
                    this.containerName, blobName, block, blobRequestOptions,
                    (cerr: azure.StorageError) =>
                        this.createBlockComplete(cerr, blobName, blockDone)
                );
                return;
            }
            console.error(`BlobService.appendBlockFromText(` +
                `${this.containerName}/${blobName}) failed with ` +
                `error = ${JSON.stringify(err,null,2)}`);
        }
        blockDone();
    }

    private writeBlock(blobName: string, block: string, blockDone: () => void) {
        this.debug(`writing block of size ${block.length} = ${block}`);
        const blobRequestOptions = { absorbConditionalErrorsOnRetry: true };
        this.blobService.appendBlockFromText(
            this.containerName, blobName, block, blobRequestOptions,
            (err: azure.StorageError) =>
                this.writeBlockComplete(err, blobName, block, blockDone)
        );
    }

    private buildCargo() {
        this.cargo = async.cargo((tasks: any[], completed: async.ErrorCallback<Error>) => {
            this.debug(`logging ${tasks.length} line${tasks.length > 1 ? "s" : ""}`);
            const lines = tasks.reduce((pv, v) => pv + v.line + "\n", "");
            // The cast is because the typescript typings are wrong
            const blockSize = (azure.Constants.BlobConstants as any).MAX_APPEND_BLOB_BLOCK_SIZE;
            const blocks = this.chunk(lines, blockSize);
            const blobName = this.getBlobName();

            const completeTasks = (err: Error) => {
                for (const task of tasks) {
                    if (task.callback) {
                        task.callback();
                    }
                }
                completed();
            }

            const writeBlock = (block: string, blockDone: () => void) =>
                this.writeBlock(blobName, block, blockDone);

            async.eachSeries(blocks, writeBlock, completeTasks);
        });
    }

    private chunk(str: string, size: number) {
        const numChunks = Math.ceil(str.length / size);
        const chunks = new Array(numChunks);
        for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
          chunks[i] = str.substr(o, size);
        }
        return chunks;
      }
}
