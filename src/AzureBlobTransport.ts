import { cargo } from "async";
import { MESSAGE } from "triple-beam";
import TransportStream from "winston-transport";

import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";

import { AsyncLock } from "./asyncLock";
import { AzureLogger } from "./AzureLogger";

import type { QueueObject } from "async";
import type { LogEntry } from "winston";
export interface IAzureBlobTransportOptions extends TransportStream.TransportStreamOptions {
    containerUrl: string
    name?: string
    nameFormat?: string
    retention?: number
    trace?: boolean
    clientId?: string
    clientSecret?: string
    tenantId?: string
    flushTimeout?: number
}

export const DEFAULT_NAME_FORMAT = "{yyyy}/{MM}/{dd}/{hh}/node.log";
const MS_IN_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_FLUSH_TIMEOUT = 5; // minutes

interface IQueuedLogMessage {
    line: string
    callback?: () => void
}

export class AzureBlobTransport extends TransportStream {
    public name: string
    private trace: boolean
    private cargo: QueueObject<IQueuedLogMessage>
    private containerName: string
    private nameFormat: string
    private retention?: number
    private blobServiceClient: BlobServiceClient
    private containerClient: ContainerClient
    private loggerLock: AsyncLock
    private activeLogger?: AzureLogger
    private activeLoggerName?: string
    private flushTimeout: number
    private flushTimeoutHandle: NodeJS.Timeout | undefined

    constructor(opts: IAzureBlobTransportOptions) {
        super(opts);

        if (!opts.containerUrl) {
            throw new Error("The containerUrl property must be specified");
        }

        this.name = opts.name || "AzureBlobTransport";
        this.loggerLock = new AsyncLock();
        this.trace = opts.trace === true;
        this.buildCargo();
        this.nameFormat = opts.nameFormat || DEFAULT_NAME_FORMAT,
        this.retention = opts.retention;
        this.flushTimeout = (opts.flushTimeout || DEFAULT_FLUSH_TIMEOUT) * 60 * 1000;
        this.flushTimeoutHandle = setTimeout(() => void this.flushOnInterval(), this.flushTimeout);

        const url = new URL(opts.containerUrl);
        let sas = url.search;

        this.containerName = url.pathname;
        if (this.containerName.startsWith("/")) {
            this.containerName = this.containerName.substr(1);
        }

        if (sas.startsWith("?")) {
            sas = sas.substring(1);
            this.debug(`create SAS for ${url.protocol}//${url.host}, sasToken=${sas}`);
            this.blobServiceClient = new BlobServiceClient(`${url.protocol}//${url.host}${sas}`);
        } else {
            let credential;
            if (opts.clientId && opts.clientSecret && opts.tenantId) {
                credential = new ClientSecretCredential(opts.tenantId, opts.clientId, opts.clientSecret)
            } else {
                credential = new DefaultAzureCredential();
            }
            this.blobServiceClient = new BlobServiceClient(`${url.protocol}//${url.host}`, credential);
        }
        this.containerClient = this.blobServiceClient.getContainerClient(this.containerName);

        if (this.retention) {
            setTimeout(this.cleanOldLogs, 1);
        }
    }

    private debug(msg: string) {
        if (this.trace) {
            console.log(msg);
        }
    }

    public log(entry: LogEntry, callback: () => void) {
        this.cargo.push({
            line: (entry as any)[MESSAGE],
            callback
        });
        this.emit('logged', entry);
    }

    public async closeAsync(cb?: () => void) {
        if (this.flushTimeoutHandle) {
            clearTimeout(this.flushTimeoutHandle);
            this.flushTimeoutHandle = undefined;
        }
        if (this.activeLogger) {
            this.debug(`flushing active logger on close`);
            await this.loggerLock.runLocked(() => this.activeLogger!.flush());
            this.debug(`flushed active logger on close`);
        }
        cb?.();
        this.emit('flush');
        this.emit('closed');
    }

    public close(cb?: () => void) {
        this.debug(`closing azure logger`);
        void this.closeAsync(cb);
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

    private async tryCleanOldLogs(now: number, prefix: string) {
        const toDelete : string[] = [];
        const retention = this.retention! * MS_IN_DAY;

        for await (const response of this.containerClient.listBlobsFlat({ prefix }).byPage()) {
            if (response.segment.blobItems) {
                for (const blob of response.segment.blobItems) {
                    const timestamp = this.parseName(blob.name);
                    if (timestamp > 0) {
                        this.debug(`parsed name ${blob.name} giving timestamp ${new Date(timestamp).toISOString()}` +
                            ` (ms = ${timestamp}, retention = ${retention},` +
                            ` expires = ${timestamp + retention}, now = ${now})`);
                    }
                    if (timestamp + retention < now) {
                        this.debug(`clean old blob ${blob.name}`);
                        toDelete.push(blob.name);
                    }
                }
            }
        }

        for (const name of toDelete) {
            this.debug(`deleting old log ${name}`);
            try {
                await this.containerClient.deleteBlob(name);
            }
            catch (error) {
                if (!(error.statusCode === 404 && error.code === "BlobNotFound")) {
                    console.error(`deleted the blob ${name} failed with ${JSON.stringify(error, null, 2)}`);
                }
            }
        }
    }

    private cleanOldLogs = () => {
        void this.cleanOldLogsAsync();
    }

    private async cleanOldLogsAsync() {
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
        try {
            await this.tryCleanOldLogs(now, prefix);
        }
        catch (error) {
            console.error(`Failed to clean old azure logs: ${JSON.stringify(error, null, 2)}`);
        }

        setTimeout(this.cleanOldLogs, this.nextClean - now);
        this.debug(`next clean at ${new Date(this.nextClean)}, `+
            `retention is ${this.retention} day${this.retention! > 1 ? "s" : ""}`);
    }

    private async flushOnInterval() {
        this.debug("flushing on timeout");
        this.flushTimeoutHandle = undefined;
        await this.loggerLock.runLocked(async () => {
            try {
                if (this.activeLogger) {
                    await this.activeLogger.flush();
                }
            }
            catch (error) {
                console.error(`Flushing the log failed with error = ${JSON.stringify(error, null, 2)}`);
            }
        });
        this.flushTimeoutHandle = setTimeout(() => void this.flushOnInterval(), this.flushTimeout);
    }

    private async handleCargo(tasks: IQueuedLogMessage[], callback: () => void) {
        await this.loggerLock.runLocked(async (tasks: IQueuedLogMessage[]) => {
            const blobName = this.getBlobName();
            if (this.activeLoggerName != blobName) {
                if (this.activeLogger) {
                    try {
                        await this.activeLogger.flush();
                    }
                    catch (error) {
                        console.error(`Flushing the logger for ${this.activeLoggerName} ` +
                            `failed with error = ${JSON.stringify(error, null, 2)}`);
                    }
                }
                const appendBlobClient = this.containerClient.getAppendBlobClient(blobName);
                this.activeLoggerName = blobName;
                this.activeLogger = new AzureLogger(appendBlobClient);
            }

            const lines = tasks.reduce((pv, v) => pv + v.line + "\n", "");
            try {
                await this.activeLogger?.append(lines);
            }
            catch (error) {
                console.error(`Writing to the log ${this.activeLoggerName} ` +
                    `failed with error = ${JSON.stringify(error, null, 2)}`);
            }

            for (const task of tasks) {
                task.callback?.();
            }
        }, tasks)
        callback();
    }

    private buildCargo() {
        this.cargo = cargo((tasks: IQueuedLogMessage[], callback) => {
            void this.handleCargo(tasks, callback);
        });
    }
}
