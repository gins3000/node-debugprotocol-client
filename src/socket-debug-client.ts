import * as net from "net";

import { BaseDebugClientConfig } from "./base-debug-client";
import { StreamDebugClient } from "./stream-debug-client";

export enum ConnectionState {
  Disconnected = 0,
  Connecting = 1,
  Connected = 2
}

export interface SocketDebugAdapterClientConfig extends BaseDebugClientConfig {
  port: number;
  host?: string;
}

export class SocketDebugClient extends StreamDebugClient {

  static DEFAULT_CONFIG: Required<SocketDebugAdapterClientConfig> = Object.assign({}, {
    host: "0.0.0.0",
    port: 12345,
    loggerName: "SocketDebugAdapterClient"
  }, StreamDebugClient.DEFAULT_CONFIG);

  protected config: Required<SocketDebugAdapterClientConfig>;

  protected state: ConnectionState;
  protected socket?: net.Socket;

  constructor(config: SocketDebugAdapterClientConfig) {
    const fullConfig = Object.assign({}, SocketDebugClient.DEFAULT_CONFIG, config);

    super(fullConfig);

    this.config = fullConfig;
    this.state = ConnectionState.Disconnected;
  }

  public async connectAdapter() {
    try {
      if (this.state !== ConnectionState.Disconnected) {
        throw new Error(`already '${ConnectionState[this.state]}'`);
      }

      this.log("Connecting...");
      this.state = ConnectionState.Connecting;
      this.socket = await new Promise((resolve, reject) => {
        const socket = net.createConnection(this.config.port, this.config.host, () => {
          super.connectAdapter(socket, socket);
          resolve(socket);
        });

        socket.on("error", (e) => {
          this.log(`Socket error: ${e.message}`, e);
          reject(e);
        });
      });

      this.log("Connected");
      this.state = ConnectionState.Connected;

    } finally {
      if (this.state === ConnectionState.Connecting) {
        this.state = ConnectionState.Disconnected;
      }
    }
  }

  public disconnectAdapter() {
    if (this.socket) {
      super.disconnectAdapter();
      this.socket.destroy();
      delete this.socket;
    }
  }

  // tslint:disable-next-line:no-any
  public async sendRequest(command: string, args?: any) {
    if (this.state !== ConnectionState.Connected) {
      throw new Error("not connected");
    }

    return super.sendRequest(command, args);
  }
}
