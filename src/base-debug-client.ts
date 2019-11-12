import { EventEmitter } from "events";
import { DebugProtocol } from "vscode-debugprotocol";

import { isEvent, isRequest, isResponse } from "./protocol";
import { Unsubscribable } from "./utils";

export type EventHandler<T extends DebugProtocol.Event> = (event: T["body"]) => void;

export type ReverseRequestHandler<T extends DebugProtocol.Request, R extends DebugProtocol.Response> = (args: T["arguments"]) => Promise<R>;

export enum LogLevel {
  Off = 0,
  On = 1,
  Verbose = 2
}

export interface BaseDebugClientConfig {
  loggerName?: string;
  logLevel?: LogLevel;
  logger?: (message: string) => void;
}

export abstract class BaseDebugClient {

  static DEFAULT_CONFIG: Required<BaseDebugClientConfig> = {
    loggerName: "DebugAdapterClient",
    logLevel: LogLevel.Off,
    logger: console.log
  };

  protected config: Required<BaseDebugClientConfig>;

  private nextSeq = 1;
  private pendingRequests = new Map<number, (response: DebugProtocol.Response) => void>();
  // tslint:disable-next-line:no-any
  private reverseRequestHandlers = new Map<string, ReverseRequestHandler<any, any>>();
  private eventEmitter = new EventEmitter();

  constructor(config: BaseDebugClientConfig) {
    this.config = Object.assign({}, BaseDebugClient.DEFAULT_CONFIG, config);
  }

  private getNextSeq() {
    return this.nextSeq++;
  }

  protected handleMessage(message: DebugProtocol.ProtocolMessage) {
    if (isResponse(message)) {
      // send response back to sender
      const callback = this.pendingRequests.get(message.request_seq);
      if (callback) {
        this.pendingRequests.delete(message.request_seq);
        callback(message);
      } else {
        this.log(`Received response '${message.command}' with request_seq not matching any request ${message.request_seq}`, message);
      }

    } else if (isEvent(message)) {
      // forward to subscribed event handlers
      this.log(`Received event '${message.event}' (${message.seq})`, message);
      this.eventEmitter.emit(message.event, message.body);

    } else if (isRequest(message)) {
      // forward to reverse request handler and send back the response
      const handler = this.reverseRequestHandlers.get(message.command);
      if (handler) {
        this.log(`Received request '${message.command}' (${message.seq})`, message);
        handler(message.arguments)
          .then((success) => this.sendResponse(message, success))
          .catch((error) => this.sendErrorResponse(message, error.message));
      } else {
        this.log(`Received request '${message.command}' (${message.seq}) but no handler is registered`, message);
      }

    } else {
      this.log(`Received message of unknown type '${message.type}'`, message);
    }
  }

  // tslint:disable-next-line:no-any
  protected log(message: string, detail?: any) {
    if (this.config.logLevel === LogLevel.Off) { return; }

    const detailMessage = this.config.logLevel !== LogLevel.Verbose || typeof detail === "undefined"
      ? undefined
      : typeof detail === "string"
        ? detail
        : JSON.stringify(detail, undefined, 2);

    this.config.logger(`[${this.config.loggerName}] ${message}${detailMessage ? ` ${detailMessage}` : ""}`);
  }

  public async sendRequest<T extends DebugProtocol.Request>(command: T["command"], args?: T["arguments"]): Promise<DebugProtocol.Response> {
    const seq = this.getNextSeq();

    const request: DebugProtocol.Request = {
      seq,
      type: "request",
      command,
      arguments: args
    };

    this.log(`sending request '${request.command}' (${request.seq})`, request.arguments);

    const responsePromise = new Promise<DebugProtocol.Response>((resolve, reject) => {
      this.pendingRequests.set(seq, (response) => {
        if (response.success) {
          this.log(`received response for '${response.command}' (${response.request_seq})`, response);
          resolve(response);
        } else {
          this.log(`received error response for '${response.command}' (${response.request_seq})`, response);
          reject(new Error(response.message));
        }
      });
    });

    this.sendMessage(request);

    return responsePromise;
  }

  public async sendResponse(request: DebugProtocol.Request, responseBody: DebugProtocol.Response["body"]) {
    const response = {
      type: "response",
      seq: this.getNextSeq(),

      command: request.command,
      request_seq: request.seq,
      success: true,

      body: responseBody
    };

    this.log(`sending response '${response.command}' (${response.seq})`, response.body);

    this.sendMessage(response);
  }

  public async sendErrorResponse(request: DebugProtocol.Request, message: string, error?: DebugProtocol.Message) {
    const response: DebugProtocol.ErrorResponse = {
      type: "response",
      seq: this.getNextSeq(),

      command: request.command,
      request_seq: request.seq,
      success: false,

      message,
      body: {
        error
      }
    };

    this.log(`sending error response '${response.command}' (${response.seq}) ${response.message}`, response.body);

    this.sendMessage(response);
  }

  public onEvent<T extends DebugProtocol.Event>(event: T["event"], callback: EventHandler<T>, once = false): Unsubscribable {
    once
      ? this.eventEmitter.once(event, callback)
      : this.eventEmitter.on(event, callback);

    return {
      unsubscribe: () => this.eventEmitter.off(event, callback)
    };
  }

  public onReverseRequest<T extends DebugProtocol.Request, R extends DebugProtocol.Response>(command: T["command"], callback: ReverseRequestHandler<T, R>): Unsubscribable {
    this.reverseRequestHandlers.set(command, callback);

    return {
      unsubscribe: () => {
        if (this.reverseRequestHandlers.get(command) === callback) {
          this.reverseRequestHandlers.delete(command);
        }
      }
    };
  }

  protected abstract sendMessage<T extends DebugProtocol.ProtocolMessage>(message: T): void;

  // Requests
  public attach<T extends DebugProtocol.AttachRequest["arguments"]>(args: T): Promise<DebugProtocol.AttachResponse> {
    return this.sendRequest("attach", args) as Promise<DebugProtocol.AttachResponse>;
  }

  public breakpointLocations(args: DebugProtocol.BreakpointLocationsRequest["arguments"]): Promise<DebugProtocol.BreakpointLocationsResponse> {
    return this.sendRequest("breakpointLocations", args) as Promise<DebugProtocol.BreakpointLocationsResponse>;
  }

  public completions(args: DebugProtocol.CompletionsRequest["arguments"]): Promise<DebugProtocol.CompletionsResponse> {
    return this.sendRequest("completions", args) as Promise<DebugProtocol.CompletionsResponse>;
  }

  public configurationDone(args: DebugProtocol.ConfigurationDoneRequest["arguments"]): Promise<DebugProtocol.ConfigurationDoneResponse> {
    return this.sendRequest("configurationDone", args) as Promise<DebugProtocol.ConfigurationDoneResponse>;
  }

  public continue(args: DebugProtocol.ContinueRequest["arguments"]): Promise<DebugProtocol.ContinueResponse> {
    return this.sendRequest("continue", args) as Promise<DebugProtocol.ContinueResponse>;
  }

  public dataBreakpointInfo(args: DebugProtocol.DataBreakpointInfoRequest["arguments"]): Promise<DebugProtocol.DataBreakpointInfoResponse> {
    return this.sendRequest("dataBreakpointInfo", args) as Promise<DebugProtocol.DataBreakpointInfoResponse>;
  }

  public disassemble(args: DebugProtocol.DisassembleRequest["arguments"]): Promise<DebugProtocol.DisassembleResponse> {
    return this.sendRequest("disassemble", args) as Promise<DebugProtocol.DisassembleResponse>;
  }

  public disconnect(args: DebugProtocol.DisconnectRequest["arguments"]): Promise<DebugProtocol.DisconnectResponse> {
    return this.sendRequest("disconnect", args) as Promise<DebugProtocol.DisconnectResponse>;
  }

  public evaluate(args: DebugProtocol.EvaluateRequest["arguments"]): Promise<DebugProtocol.EvaluateResponse> {
    return this.sendRequest("evaluate", args) as Promise<DebugProtocol.EvaluateResponse>;
  }

  public exceptionInfo(args: DebugProtocol.ExceptionInfoRequest["arguments"]): Promise<DebugProtocol.ExceptionInfoResponse> {
    return this.sendRequest("exceptionInfo", args) as Promise<DebugProtocol.ExceptionInfoResponse>;
  }

  public goto(args: DebugProtocol.GotoRequest["arguments"]): Promise<DebugProtocol.GotoResponse> {
    return this.sendRequest("goto", args) as Promise<DebugProtocol.GotoResponse>;
  }

  public gotoTargets(args: DebugProtocol.GotoTargetsRequest["arguments"]): Promise<DebugProtocol.GotoTargetsResponse> {
    return this.sendRequest("gotoTargets", args) as Promise<DebugProtocol.GotoTargetsResponse>;
  }

  public initialize(args: DebugProtocol.InitializeRequest["arguments"]): Promise<DebugProtocol.InitializeResponse> {
    return this.sendRequest("initialize", args) as Promise<DebugProtocol.InitializeResponse>;
  }

  public launch<T extends DebugProtocol.LaunchRequest["arguments"]>(args: T): Promise<DebugProtocol.LaunchResponse> {
    return this.sendRequest("launch", args) as Promise<DebugProtocol.LaunchResponse>;
  }

  public loadedSources(args: DebugProtocol.LoadedSourcesRequest["arguments"]): Promise<DebugProtocol.LoadedSourcesResponse> {
    return this.sendRequest("loadedSources", args) as Promise<DebugProtocol.LoadedSourcesResponse>;
  }

  public modules(args: DebugProtocol.ModulesRequest["arguments"]): Promise<DebugProtocol.ModulesResponse> {
    return this.sendRequest("modules", args) as Promise<DebugProtocol.ModulesResponse>;
  }

  public next(args: DebugProtocol.NextRequest["arguments"]): Promise<DebugProtocol.NextResponse> {
    return this.sendRequest("next", args) as Promise<DebugProtocol.NextResponse>;
  }

  public pause(args: DebugProtocol.PauseRequest["arguments"]): Promise<DebugProtocol.PauseResponse> {
    return this.sendRequest("pause", args) as Promise<DebugProtocol.PauseResponse>;
  }

  public readMemory(args: DebugProtocol.ReadMemoryRequest["arguments"]): Promise<DebugProtocol.ReadMemoryResponse> {
    return this.sendRequest("readMemory", args) as Promise<DebugProtocol.ReadMemoryResponse>;
  }

  public restart(args: DebugProtocol.RestartRequest["arguments"]): Promise<DebugProtocol.RestartResponse> {
    return this.sendRequest("restart", args) as Promise<DebugProtocol.RestartResponse>;
  }

  public restartFrame(args: DebugProtocol.RestartFrameRequest["arguments"]): Promise<DebugProtocol.RestartFrameResponse> {
    return this.sendRequest("restartFrame", args) as Promise<DebugProtocol.RestartFrameResponse>;
  }

  public reverseContinue(args: DebugProtocol.ReverseContinueRequest["arguments"]): Promise<DebugProtocol.ReverseContinueResponse> {
    return this.sendRequest("reverseContinue", args) as Promise<DebugProtocol.ReverseContinueResponse>;
  }

  public scopes(args: DebugProtocol.ScopesRequest["arguments"]): Promise<DebugProtocol.ScopesResponse> {
    return this.sendRequest("scopes", args) as Promise<DebugProtocol.ScopesResponse>;
  }

  public setBreakpoints(args: DebugProtocol.SetBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetBreakpointsResponse> {
    return this.sendRequest("setBreakpoints", args) as Promise<DebugProtocol.SetBreakpointsResponse>;
  }

  public setDataBreakpoints(args: DebugProtocol.SetDataBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetDataBreakpointsResponse> {
    return this.sendRequest("setDataBreakpoints", args) as Promise<DebugProtocol.SetDataBreakpointsResponse>;
  }

  public setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetExceptionBreakpointsResponse> {
    return this.sendRequest("setExceptionBreakpoints", args) as Promise<DebugProtocol.SetExceptionBreakpointsResponse>;
  }

  public setExpression(args: DebugProtocol.SetExpressionRequest["arguments"]): Promise<DebugProtocol.SetExpressionResponse> {
    return this.sendRequest("setExpression", args) as Promise<DebugProtocol.SetExpressionResponse>;
  }

  public setFunctionBreakpoints(args: DebugProtocol.SetFunctionBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetFunctionBreakpointsResponse> {
    return this.sendRequest("setFunctionBreakpoints", args) as Promise<DebugProtocol.SetFunctionBreakpointsResponse>;
  }

  public setVariable(args: DebugProtocol.SetVariableRequest["arguments"]): Promise<DebugProtocol.SetVariableResponse> {
    return this.sendRequest("setVariable", args) as Promise<DebugProtocol.SetVariableResponse>;
  }

  public source(args: DebugProtocol.SourceRequest["arguments"]): Promise<DebugProtocol.SourceResponse> {
    return this.sendRequest("source", args) as Promise<DebugProtocol.SourceResponse>;
  }

  public stackTrace(args: DebugProtocol.StackTraceRequest["arguments"]): Promise<DebugProtocol.StackTraceResponse> {
    return this.sendRequest("stackTrace", args) as Promise<DebugProtocol.StackTraceResponse>;
  }

  public stepBack(args: DebugProtocol.StepBackRequest["arguments"]): Promise<DebugProtocol.StepBackResponse> {
    return this.sendRequest("stepBack", args) as Promise<DebugProtocol.StepBackResponse>;
  }

  public stepIn(args: DebugProtocol.StepInRequest["arguments"]): Promise<DebugProtocol.StepInResponse> {
    return this.sendRequest("stepIn", args) as Promise<DebugProtocol.StepInResponse>;
  }

  public stepInTargets(args: DebugProtocol.StepInTargetsRequest["arguments"]): Promise<DebugProtocol.StepInTargetsResponse> {
    return this.sendRequest("stepInTargets", args) as Promise<DebugProtocol.StepInTargetsResponse>;
  }

  public stepOut(args: DebugProtocol.StepOutRequest["arguments"]): Promise<DebugProtocol.StepOutResponse> {
    return this.sendRequest("stepOut", args) as Promise<DebugProtocol.StepOutResponse>;
  }

  public terminate(args: DebugProtocol.TerminateRequest["arguments"]): Promise<DebugProtocol.TerminateResponse> {
    return this.sendRequest("terminate", args) as Promise<DebugProtocol.TerminateResponse>;
  }

  public terminateThreads(args: DebugProtocol.TerminateThreadsRequest["arguments"]): Promise<DebugProtocol.TerminateThreadsResponse> {
    return this.sendRequest("terminateThreads", args) as Promise<DebugProtocol.TerminateThreadsResponse>;
  }

  public threads(args: DebugProtocol.ThreadsRequest["arguments"]): Promise<DebugProtocol.ThreadsResponse> {
    return this.sendRequest("threads", args) as Promise<DebugProtocol.ThreadsResponse>;
  }

  public variables(args: DebugProtocol.VariablesRequest["arguments"]): Promise<DebugProtocol.VariablesResponse> {
    return this.sendRequest("variables", args) as Promise<DebugProtocol.VariablesResponse>;
  }



  // === Events ===
  public onBreakpoint(callback: EventHandler<DebugProtocol.BreakpointEvent>, once = false): Unsubscribable {
    return this.onEvent("breakpoint", callback, once);
  }

  public onCapabilities(callback: EventHandler<DebugProtocol.CapabilitiesEvent>, once = false): Unsubscribable {
    return this.onEvent("capabilities", callback, once);
  }

  public onContinued(callback: EventHandler<DebugProtocol.ContinuedEvent>, once = false): Unsubscribable {
    return this.onEvent("continued", callback, once);
  }

  public onExited(callback: EventHandler<DebugProtocol.ExitedEvent>, once = false): Unsubscribable {
    return this.onEvent("exited", callback, once);
  }

  public onInitialized(callback: EventHandler<DebugProtocol.InitializedEvent>, once = false): Unsubscribable {
    return this.onEvent("initialized", callback, once);
  }

  public onLoadedSource(callback: EventHandler<DebugProtocol.LoadedSourceEvent>, once = false): Unsubscribable {
    return this.onEvent("loadedSource", callback, once);
  }

  public onModule(callback: EventHandler<DebugProtocol.ModuleEvent>, once = false): Unsubscribable {
    return this.onEvent("module", callback, once);
  }

  public onOutput(callback: EventHandler<DebugProtocol.OutputEvent>, once = false): Unsubscribable {
    return this.onEvent("output", callback, once);
  }

  public onProcess(callback: EventHandler<DebugProtocol.ProcessEvent>, once = false): Unsubscribable {
    return this.onEvent("process", callback, once);
  }

  public onStopped(callback: EventHandler<DebugProtocol.StoppedEvent>, once = false): Unsubscribable {
    return this.onEvent("stopped", callback, once);
  }

  public onTerminated(callback: EventHandler<DebugProtocol.TerminatedEvent>, once = false): Unsubscribable {
    return this.onEvent("terminated", callback, once);
  }

  public onThread(callback: EventHandler<DebugProtocol.ThreadEvent>, once = false): Unsubscribable {
    return this.onEvent("thread", callback, once);
  }



  // === Reverse Requests ===
  public onRunInTerminalRequest(callback: ReverseRequestHandler<DebugProtocol.RunInTerminalRequest, DebugProtocol.RunInTerminalResponse>): Unsubscribable {
    return this.onReverseRequest("runInTerminal", callback);
  }
}
