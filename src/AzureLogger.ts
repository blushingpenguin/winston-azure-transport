import { AppendBlobClient } from "@azure/storage-blob";

export interface ILogger {
    append(text: string): Promise<void>;
    flush(): Promise<void>;
}

const LOG_BUFFER_LENGTH = 4 * 1024 * 1024;
const textEncoder = new TextEncoder();

export class AzureLogger implements ILogger {
    // private _logFile: fs.promises.FileHandle;
    private _blob: AppendBlobClient;
    private _buffer = new Uint8Array(LOG_BUFFER_LENGTH); // 4 * 1024 * 1024)
    private _bufferUsed = 0;
    private _isOpen = false;
    private _written = 0;

    constructor(blob: AppendBlobClient) {
        this._blob = blob;
    }

    public async append(text: string) {
        if (!this._isOpen) {
            // this._logFile = await fs.promises.open("/tmp/log.txt", "a");
            await this._blob.createIfNotExists();
            this._isOpen = true;
        }

        const bytes = textEncoder.encode(text);
        // console.log(`write ${bytes}`);
        const space = this._buffer.length - this._bufferUsed;
        // simple case of the new data fits
        if (bytes.length < space) {
            this._buffer.set(bytes, this._bufferUsed);
            this._bufferUsed += bytes.length;
            // console.log(`save ${bytes.length} at position ${this._bufferUsed}, buffer ${this._buffer}`);
            return;
        }
        // more fiddly case: fill the buffer up + write first chunk
        let pos = 0;
        if (this._bufferUsed > 0 && space > 0) {
            this._buffer.set(bytes.slice(0, space), this._bufferUsed);
            // console.log(`flush full buffer ${this._buffer}; written so far ${this._written}`);
            // await this._logFile.write(this._buffer, 0, this._buffer.length, this._written);
            await this._blob.appendBlock(this._buffer, this._buffer.length);
            pos += space;
            this._written += this._buffer.length;
            // console.log(`flushed full buffer; written so far ${this._written}`);
        }
        for (; ;) {
            let chunk = Math.min(bytes.length - pos, this._buffer.length);
            if (chunk >= this._buffer.length) {
                // console.log(`from ${pos}, write ${chunk} bytes; written so far ${this._written}`);
                // await this._logFile.write(bytes, pos, this._buffer.length, this._written);
                await this._blob.appendBlock(bytes.slice(pos, pos + this._buffer.length), this._buffer.length);
                pos += this._buffer.length;
                this._written += this._buffer.length;
            } else {
                // save last chunk
                this._buffer.set(bytes.slice(pos, pos + chunk));
                this._bufferUsed = chunk;
                // console.log(`from ${pos}, save ${chunk} bytes ${this._buffer}`);
                break;
            }
        }
    }

    async flush(): Promise<void> {
        if (this._bufferUsed) {
            // await this._logFile.write(this._buffer, 0, this._bufferUsed, this._written);
            await this._blob.appendBlock(this._buffer.slice(0, this._bufferUsed), this._bufferUsed);
            this._written += this._bufferUsed;
        }
        this._bufferUsed = 0;
    }
}
