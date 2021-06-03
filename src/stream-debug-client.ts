import { Readable, Writable } from "stream";
import { DebugProtocol } from "vscode-debugprotocol";

import { BaseDebugClient, BaseDebugClientConfig } from "./base-debug-client";
import { CONTENT_LENGTH_HEADER, encodeMessage, TWO_CRLF } from "./protocol";

export class StreamDebugClient extends BaseDebugClient {

  static DEFAULT_CONFIG: Required<BaseDebugClientConfig> = Object.assign({}, BaseDebugClient.DEFAULT_CONFIG, {
    loggerName: "StreamDebugAdapterClient",
  });

  protected connection?: {
    outStream: Writable;
    inStream: Readable;
    handleData: (data: Buffer) => void;
  };

  protected buffer = Buffer.alloc(0);
  protected contentLength = -1;

  public connectAdapter(readable: Readable, writable: Writable): void {
    if (this.connection) {
      throw new Error("already connected");
    }

    this.connection = {
      inStream: readable,
      outStream: writable,
      handleData: this.handleData.bind(this),
    };

    readable.on("data", this.connection.handleData);
  }

  public disconnectAdapter(): void {
    if (this.connection) {
      this.log("Disconnecting");
      this.connection.inStream.off("data", this.connection.handleData);
      delete this.connection;

      this.buffer = Buffer.alloc(0);
      this.contentLength = -1;
    }
  }

  public sendRequest<T extends DebugProtocol.Request>(command: T["command"], args?: T["arguments"]): Promise<DebugProtocol.Response> {
    if (!this.connection) { throw new Error("not connected"); }
    return super.sendRequest(command, args);
  }

  public sendResponse(request: DebugProtocol.Request, responseBody: DebugProtocol.Response["body"]): Promise<void> {
    if (!this.connection) { throw new Error("not connected"); }
    return super.sendResponse(request, responseBody);
  }

  public sendErrorResponse(request: DebugProtocol.Request, message: string, error?: DebugProtocol.Message): Promise<void> {
    if (!this.connection) { throw new Error("not connected"); }
    return super.sendErrorResponse(request, message, error);
  }

  public sendMessage<T extends DebugProtocol.ProtocolMessage>(message: T): void {
    if (!this.connection) { throw new Error("not connected"); }

    this.connection.outStream.write(encodeMessage(message));
  }

  protected handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    for (;;) {
      if (this.contentLength >= 0) {
        if (this.buffer.length >= this.contentLength) {
          const body = this.buffer.toString("utf8", 0, this.contentLength);
          this.buffer = this.buffer.slice(this.contentLength);
          this.contentLength = -1;
          if (body.length > 0) {
            try {
              this.handleMessage(JSON.parse(body));
            } catch (e) {
              this.log(`Error handling message '${body}'`, e);
            }
          }
          continue;	// there may be more complete messages to process
        }
      } else {
        const idx = this.buffer.indexOf(TWO_CRLF);
        if (idx !== -1) {
          const header = this.buffer.toString("utf8", 0, idx);
          const lines = header.split("\r\n");
          for (let i = 0; i < lines.length; i++) {
            const pair = lines[i].split(/: +/);
            if (pair[0] === CONTENT_LENGTH_HEADER) {
              this.contentLength = +pair[1];
            }
          }
          this.buffer = this.buffer.slice(idx + TWO_CRLF.length);
          continue;
        }
      }
      break;
    }
  }
}
