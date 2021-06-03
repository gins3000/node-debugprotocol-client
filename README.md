# node-debugprotocol-client
A standalone node client for the VSCode Debug Adapter Protocol

> This project is a work in progress and should be used in production only with caution! Breaking changes can and will be made.

There exist a lot of implementations of the [VSCode Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/), both serverside and clientside, but there don't seem to be a lot of standalone client implementations.

This repository hosts a standalone NodeJS client library for the Debug Adapter Protocol, maybe enabling smaller node-based IDEs to get a piece of that cake too.

## Targeted [vscode-debugprotocol](https://www.npmjs.com/package/vscode-debugprotocol) version
v1.47.0

## Features
- An abstract base client (`BaseDebugClient`)
  - Use boilerplate methods to conveniently send requests, listen to events or handle reverse requests
  - Await `Request`s to receive the `Response` or catch `ErrorResponses` as `Error`s
  - Register convenient async reverse-request handlers
  - Set log level (`Off`, `On` or `Verbose`)
- Stream-based implementation (`StreamDebugClient`)
  - Connect with `stream.Readable` and `stream.Writable`
- Socket-based implementation (`SocketDebugClient`)
  - Connect with `net.Socket`


## Usage example

Install to your node project:
```shell
npm install node-debugprotocol-client
```


Instantiate a socket client:
```ts
import { SocketDebugClient, LogLevel } from "node-debugprotocol-client";

// create a client instance
const client = new SocketDebugClient({
  port: 12345,
  host: "localhost",
  logLevel: LogLevel.Verbose,
  loggerName: "My Debug Adapter Client"
});

// connect
await client.connectAdapter();
```

Or a stream client, if you want to handle the streams yourself:
```ts
import { StreamDebugClient, LogLevel } from "node-debugprotocol-client";

// create a client instance
const client = new StreamDebugClient({
  logLevel: LogLevel.Verbose,
  loggerName: "My Debug Adapter Client"
});

const { reader, writer } = magicallyGetStreams();

// connect
client.connectAdapter(reader, writer);
```

Then just use the client:
```ts
// initialize first
await client.initialize({
  adapterId: "java",
  // ...
})

// tell the debug adapter to attach to a debuggee which is already running somewhere
// SpecificAttachArguments has to extend DebugProtocol.AttachRequestArguments
await client.attach<SpecificAttachArguments>({
  // ...
});

// set some breakpoints
await client.setBreakpoints({
  breakpoints: [
    { line: 1337 },
    { line: 42 },
    // ...
  ],
  source: {
    path: "/path/to/file.java"
  }
})

// listen to events such as "stopped"
const unsubscribable = client.onStopped((stoppedEvent) => {
  if (stoppedEvent.reason === "breakpoint") { 
    // we hit a breakpoint!

    // do some debugging

    // continue all threads
    await client.continue({ threadId: 0 });
  }
});

// send 'configuration done' (in some debuggers this will trigger 'continue' if attach was awaited)
await client.configurationDone();

// ...

// Event subscriptions can be unsubscribed
unsubscribable.unsubscribe();

// disconnect the from adapter when done
client.disconnectAdapter();
```

## Build for development

```shell
git clone https://github.com/gins3000/node-debugprotocol-client.git
cd node-debugprotocol-client
npm install
npm run build
```

## Issues and Feature requests
Please create an issue if you find this useful (or useless ;_;) and have ideas, suggestions or issues!
