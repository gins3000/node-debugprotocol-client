import { EventEmitter } from "events";
import { DebugProtocol } from "vscode-debugprotocol";

import { isEvent, isRequest, isResponse } from "./protocol";
import { Unsubscribable } from "./utils";

export type EventHandler<T extends DebugProtocol.Event> = (event: T["body"]) => void;

export type ReverseRequestHandler<T extends DebugProtocol.Request, R extends DebugProtocol.Response> = (args: T["arguments"]) => Promise<R["body"]>;

export enum LogLevel {
  Off = 0,
  On = 1,
  Verbose = 2,
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
    logger: console.log,
  };

  protected config: Required<BaseDebugClientConfig>;

  private nextSeq = 1;
  private pendingRequests = new Map<number, (response: DebugProtocol.Response) => void>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private reverseRequestHandlers = new Map<string, ReverseRequestHandler<any, any>>();
  private eventEmitter = new EventEmitter();

  constructor(config: BaseDebugClientConfig) {
    this.config = Object.assign({}, BaseDebugClient.DEFAULT_CONFIG, config);
  }

  private getNextSeq() {
    return this.nextSeq++;
  }

  protected handleMessage(message: DebugProtocol.ProtocolMessage): void {
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

  protected log(message: string, detail?: unknown): void {
    if (this.config.logLevel === LogLevel.Off) { return; }

    const detailMessage = this.config.logLevel !== LogLevel.Verbose || typeof detail === "undefined"
      ? undefined
      : typeof detail === "string"
        ? detail
        : JSON.stringify(detail, undefined, 2);

    this.config.logger(`[${this.config.loggerName}] ${message}${detailMessage ? ` ${detailMessage}` : ""}`);
  }

  public async sendRequest<T extends DebugProtocol.Request>(command: T["command"], args?: T["arguments"]): Promise<DebugProtocol.Response["body"]> {
    const seq = this.getNextSeq();

    const request: DebugProtocol.Request = {
      seq,
      type: "request",
      command,
      arguments: args,
    };

    this.log(`sending request '${request.command}' (${request.seq})`, request.arguments);

    const responsePromise = new Promise<DebugProtocol.Response>((resolve, reject) => {
      this.pendingRequests.set(seq, (response) => {
        if (response.success) {
          this.log(`received response for '${response.command}' (${response.request_seq})`, response);
          resolve(response.body);
        } else {
          this.log(`received error response for '${response.command}' (${response.request_seq})`, response);
          reject(new Error(response.message));
        }
      });
    });

    this.sendMessage(request);

    return responsePromise;
  }

  public async sendResponse(request: DebugProtocol.Request, responseBody: DebugProtocol.Response["body"]): Promise<void> {
    const response = {
      type: "response",
      seq: this.getNextSeq(),

      command: request.command,
      request_seq: request.seq,
      success: true,

      body: responseBody,
    };

    this.log(`sending response '${response.command}' (${response.seq})`, response.body);

    this.sendMessage(response);
  }

  public async sendErrorResponse(request: DebugProtocol.Request, message: string, error?: DebugProtocol.Message): Promise<void> {
    const response: DebugProtocol.ErrorResponse = {
      type: "response",
      seq: this.getNextSeq(),

      command: request.command,
      request_seq: request.seq,
      success: false,

      message,
      body: {
        error,
      },
    };

    this.log(`sending error response '${response.command}' (${response.seq}) ${response.message}`, response.body);

    this.sendMessage(response);
  }

  public onEvent<T extends DebugProtocol.Event>(event: T["event"], callback: EventHandler<T>, once = false): Unsubscribable {
    once
      ? this.eventEmitter.once(event, callback)
      : this.eventEmitter.on(event, callback);

    return {
      unsubscribe: () => this.eventEmitter.off(event, callback),
    };
  }

  public onReverseRequest<T extends DebugProtocol.Request, R extends DebugProtocol.Response>(command: T["command"], callback: ReverseRequestHandler<T, R>): Unsubscribable {
    this.reverseRequestHandlers.set(command, callback);

    return {
      unsubscribe: () => {
        if (this.reverseRequestHandlers.get(command) === callback) {
          this.reverseRequestHandlers.delete(command);
        }
      },
    };
  }

  protected abstract sendMessage<T extends DebugProtocol.ProtocolMessage>(message: T): void;

  // Requests
  /** Attach request; value of command field is 'attach'.
        The attach request is sent from the client to the debug adapter to attach to a debuggee that is already running. Since attaching is debugger/runtime specific, the arguments for this request are not part of this specification.
    */
  public attach<T extends DebugProtocol.AttachRequest["arguments"]>(args: T): Promise<DebugProtocol.AttachResponse["body"]> {
    return this.sendRequest("attach", args) as Promise<DebugProtocol.AttachResponse["body"]>;
  }

  /** BreakpointLocations request; value of command field is 'breakpointLocations'.
        The 'breakpointLocations' request returns all possible locations for source breakpoints in a given range.
    */
  public breakpointLocations(args: DebugProtocol.BreakpointLocationsRequest["arguments"]): Promise<DebugProtocol.BreakpointLocationsResponse["body"]> {
    return this.sendRequest("breakpointLocations", args) as Promise<DebugProtocol.BreakpointLocationsResponse["body"]>;
  }

  /** Completions request; value of command field is 'completions'.
        Returns a list of possible completions for a given caret position and text.
        The CompletionsRequest may only be called if the 'supportsCompletionsRequest' capability exists and is true.
    */
  public completions(args: DebugProtocol.CompletionsRequest["arguments"]): Promise<DebugProtocol.CompletionsResponse["body"]> {
    return this.sendRequest("completions", args) as Promise<DebugProtocol.CompletionsResponse["body"]>;
  }

  /** ConfigurationDone request; value of command field is 'configurationDone'.
        The client of the debug protocol must send this request at the end of the sequence of configuration requests (which was started by the 'initialized' event).
    */
  public configurationDone(args: DebugProtocol.ConfigurationDoneRequest["arguments"]): Promise<DebugProtocol.ConfigurationDoneResponse["body"]> {
    return this.sendRequest("configurationDone", args) as Promise<DebugProtocol.ConfigurationDoneResponse["body"]>;
  }

  /** Continue request; value of command field is 'continue'.
        The request starts the debuggee to run again.
    */
  public continue(args: DebugProtocol.ContinueRequest["arguments"]): Promise<DebugProtocol.ContinueResponse["body"]> {
    return this.sendRequest("continue", args) as Promise<DebugProtocol.ContinueResponse["body"]>;
  }

  /** DataBreakpointInfo request; value of command field is 'dataBreakpointInfo'.
        Obtains information on a possible data breakpoint that could be set on an expression or variable.
    */
  public dataBreakpointInfo(args: DebugProtocol.DataBreakpointInfoRequest["arguments"]): Promise<DebugProtocol.DataBreakpointInfoResponse["body"]> {
    return this.sendRequest("dataBreakpointInfo", args) as Promise<DebugProtocol.DataBreakpointInfoResponse["body"]>;
  }

  /** Disassemble request; value of command field is 'disassemble'.
        Disassembles code stored at the provided location.
    */
  public disassemble(args: DebugProtocol.DisassembleRequest["arguments"]): Promise<DebugProtocol.DisassembleResponse["body"]> {
    return this.sendRequest("disassemble", args) as Promise<DebugProtocol.DisassembleResponse["body"]>;
  }

  /** Disconnect request; value of command field is 'disconnect'.
        The 'disconnect' request is sent from the client to the debug adapter in order to stop debugging. It asks the debug adapter to disconnect from the debuggee and to terminate the debug adapter. If the debuggee has been started with the 'launch' request, the 'disconnect' request terminates the debuggee. If the 'attach' request was used to connect to the debuggee, 'disconnect' does not terminate the debuggee. This behavior can be controlled with the 'terminateDebuggee' argument (if supported by the debug adapter).
    */
  public disconnect(args: DebugProtocol.DisconnectRequest["arguments"]): Promise<DebugProtocol.DisconnectResponse["body"]> {
    return this.sendRequest("disconnect", args) as Promise<DebugProtocol.DisconnectResponse["body"]>;
  }

  /** Evaluate request; value of command field is 'evaluate'.
        Evaluates the given expression in the context of the top most stack frame.
        The expression has access to any variables and arguments that are in scope.
    */
  public evaluate(args: DebugProtocol.EvaluateRequest["arguments"]): Promise<DebugProtocol.EvaluateResponse["body"]> {
    return this.sendRequest("evaluate", args) as Promise<DebugProtocol.EvaluateResponse["body"]>;
  }

  /** ExceptionInfo request; value of command field is 'exceptionInfo'.
        Retrieves the details of the exception that caused this event to be raised.
    */
  public exceptionInfo(args: DebugProtocol.ExceptionInfoRequest["arguments"]): Promise<DebugProtocol.ExceptionInfoResponse["body"]> {
    return this.sendRequest("exceptionInfo", args) as Promise<DebugProtocol.ExceptionInfoResponse["body"]>;
  }

  /** Goto request; value of command field is 'goto'.
        The request sets the location where the debuggee will continue to run.
        This makes it possible to skip the execution of code or to executed code again.
        The code between the current location and the goto target is not executed but skipped.
        The debug adapter first sends the response and then a 'stopped' event with reason 'goto'.
    */
  public goto(args: DebugProtocol.GotoRequest["arguments"]): Promise<DebugProtocol.GotoResponse["body"]> {
    return this.sendRequest("goto", args) as Promise<DebugProtocol.GotoResponse["body"]>;
  }

  /** GotoTargets request; value of command field is 'gotoTargets'.
        This request retrieves the possible goto targets for the specified source location.
        These targets can be used in the 'goto' request.
        The GotoTargets request may only be called if the 'supportsGotoTargetsRequest' capability exists and is true.
    */
  public gotoTargets(args: DebugProtocol.GotoTargetsRequest["arguments"]): Promise<DebugProtocol.GotoTargetsResponse["body"]> {
    return this.sendRequest("gotoTargets", args) as Promise<DebugProtocol.GotoTargetsResponse["body"]>;
  }

  /** Initialize request; value of command field is 'initialize'.
        The 'initialize' request is sent as the first request from the client to the debug adapter in order to configure it with client capabilities and to retrieve capabilities from the debug adapter.
        Until the debug adapter has responded to with an 'initialize' response, the client must not send any additional requests or events to the debug adapter. In addition the debug adapter is not allowed to send any requests or events to the client until it has responded with an 'initialize' response.
        The 'initialize' request may only be sent once.
    */
  public initialize(args: DebugProtocol.InitializeRequest["arguments"]): Promise<DebugProtocol.InitializeResponse["body"]> {
    return this.sendRequest("initialize", args) as Promise<DebugProtocol.InitializeResponse["body"]>;
  }

  /** Launch request; value of command field is 'launch'.
        The launch request is sent from the client to the debug adapter to start the debuggee with or without debugging (if 'noDebug' is true). Since launching is debugger/runtime specific, the arguments for this request are not part of this specification.
    */
  public launch<T extends DebugProtocol.LaunchRequest["arguments"]>(args: T): Promise<DebugProtocol.LaunchResponse["body"]> {
    return this.sendRequest("launch", args) as Promise<DebugProtocol.LaunchResponse["body"]>;
  }

  /** LoadedSources request; value of command field is 'loadedSources'.
        Retrieves the set of all sources currently loaded by the debugged process.
    */
  public loadedSources(args: DebugProtocol.LoadedSourcesRequest["arguments"]): Promise<DebugProtocol.LoadedSourcesResponse["body"]> {
    return this.sendRequest("loadedSources", args) as Promise<DebugProtocol.LoadedSourcesResponse["body"]>;
  }

  /** Modules request; value of command field is 'modules'.
        Modules can be retrieved from the debug adapter with the ModulesRequest which can either return all modules or a range of modules to support paging.
    */
  public modules(args: DebugProtocol.ModulesRequest["arguments"]): Promise<DebugProtocol.ModulesResponse["body"]> {
    return this.sendRequest("modules", args) as Promise<DebugProtocol.ModulesResponse["body"]>;
  }

  /** Next request; value of command field is 'next'.
        The request starts the debuggee to run again for one step.
        The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed.
    */
  public next(args: DebugProtocol.NextRequest["arguments"]): Promise<DebugProtocol.NextResponse["body"]> {
    return this.sendRequest("next", args) as Promise<DebugProtocol.NextResponse["body"]>;
  }

  /** Pause request; value of command field is 'pause'.
        The request suspends the debuggee.
        The debug adapter first sends the response and then a 'stopped' event (with reason 'pause') after the thread has been paused successfully.
    */
  public pause(args: DebugProtocol.PauseRequest["arguments"]): Promise<DebugProtocol.PauseResponse["body"]> {
    return this.sendRequest("pause", args) as Promise<DebugProtocol.PauseResponse["body"]>;
  }

  /** ReadMemory request; value of command field is 'readMemory'.
        Reads bytes from memory at the provided location.
    */
  public readMemory(args: DebugProtocol.ReadMemoryRequest["arguments"]): Promise<DebugProtocol.ReadMemoryResponse["body"]> {
    return this.sendRequest("readMemory", args) as Promise<DebugProtocol.ReadMemoryResponse["body"]>;
  }

  /** Restart request; value of command field is 'restart'.
        Restarts a debug session. If the capability 'supportsRestartRequest' is missing or has the value false,
        the client will implement 'restart' by terminating the debug adapter first and then launching it anew.
        A debug adapter can override this default behaviour by implementing a restart request
        and setting the capability 'supportsRestartRequest' to true.
    */
  public restart(args: DebugProtocol.RestartRequest["arguments"]): Promise<DebugProtocol.RestartResponse["body"]> {
    return this.sendRequest("restart", args) as Promise<DebugProtocol.RestartResponse["body"]>;
  }

  /** RestartFrame request; value of command field is 'restartFrame'.
        The request restarts execution of the specified stackframe.
        The debug adapter first sends the response and then a 'stopped' event (with reason 'restart') after the restart has completed.
    */
  public restartFrame(args: DebugProtocol.RestartFrameRequest["arguments"]): Promise<DebugProtocol.RestartFrameResponse["body"]> {
    return this.sendRequest("restartFrame", args) as Promise<DebugProtocol.RestartFrameResponse["body"]>;
  }

  /** ReverseContinue request; value of command field is 'reverseContinue'.
        The request starts the debuggee to run backward. Clients should only call this request if the capability 'supportsStepBack' is true.
    */
  public reverseContinue(args: DebugProtocol.ReverseContinueRequest["arguments"]): Promise<DebugProtocol.ReverseContinueResponse["body"]> {
    return this.sendRequest("reverseContinue", args) as Promise<DebugProtocol.ReverseContinueResponse["body"]>;
  }

  /** Scopes request; value of command field is 'scopes'.
        The request returns the variable scopes for a given stackframe ID.
    */
  public scopes(args: DebugProtocol.ScopesRequest["arguments"]): Promise<DebugProtocol.ScopesResponse["body"]> {
    return this.sendRequest("scopes", args) as Promise<DebugProtocol.ScopesResponse["body"]>;
  }

  /** SetBreakpoints request; value of command field is 'setBreakpoints'.
        Sets multiple breakpoints for a single source and clears all previous breakpoints in that source.
        To clear all breakpoint for a source, specify an empty array.
        When a breakpoint is hit, a 'stopped' event (with reason 'breakpoint') is generated.
    */
  public setBreakpoints(args: DebugProtocol.SetBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetBreakpointsResponse["body"]> {
    return this.sendRequest("setBreakpoints", args) as Promise<DebugProtocol.SetBreakpointsResponse["body"]>;
  }

  /** SetDataBreakpoints request; value of command field is 'setDataBreakpoints'.
        Replaces all existing data breakpoints with new data breakpoints.
        To clear all data breakpoints, specify an empty array.
        When a data breakpoint is hit, a 'stopped' event (with reason 'data breakpoint') is generated.
    */
  public setDataBreakpoints(args: DebugProtocol.SetDataBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetDataBreakpointsResponse["body"]> {
    return this.sendRequest("setDataBreakpoints", args) as Promise<DebugProtocol.SetDataBreakpointsResponse["body"]>;
  }

  /** SetExceptionBreakpoints request; value of command field is 'setExceptionBreakpoints'.
        The request configures the debuggers response to thrown exceptions. If an exception is configured to break, a 'stopped' event is fired (with reason 'exception').
    */
  public setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetExceptionBreakpointsResponse["body"]> {
    return this.sendRequest("setExceptionBreakpoints", args) as Promise<DebugProtocol.SetExceptionBreakpointsResponse["body"]>;
  }

  /** SetExpression request; value of command field is 'setExpression'.
        Evaluates the given 'value' expression and assigns it to the 'expression' which must be a modifiable l-value.
        The expressions have access to any variables and arguments that are in scope of the specified frame.
    */
  public setExpression(args: DebugProtocol.SetExpressionRequest["arguments"]): Promise<DebugProtocol.SetExpressionResponse["body"]> {
    return this.sendRequest("setExpression", args) as Promise<DebugProtocol.SetExpressionResponse["body"]>;
  }

  /** SetFunctionBreakpoints request; value of command field is 'setFunctionBreakpoints'.
        Replaces all existing function breakpoints with new function breakpoints.
        To clear all function breakpoints, specify an empty array.
        When a function breakpoint is hit, a 'stopped' event (with reason 'function breakpoint') is generated.
    */
  public setFunctionBreakpoints(args: DebugProtocol.SetFunctionBreakpointsRequest["arguments"]): Promise<DebugProtocol.SetFunctionBreakpointsResponse["body"]> {
    return this.sendRequest("setFunctionBreakpoints", args) as Promise<DebugProtocol.SetFunctionBreakpointsResponse["body"]>;
  }

  /** SetVariable request; value of command field is 'setVariable'.
        Set the variable with the given name in the variable container to a new value.
    */
  public setVariable(args: DebugProtocol.SetVariableRequest["arguments"]): Promise<DebugProtocol.SetVariableResponse["body"]> {
    return this.sendRequest("setVariable", args) as Promise<DebugProtocol.SetVariableResponse["body"]>;
  }

  /** Source request; value of command field is 'source'.
        The request retrieves the source code for a given source reference.
    */
  public source(args: DebugProtocol.SourceRequest["arguments"]): Promise<DebugProtocol.SourceResponse["body"]> {
    return this.sendRequest("source", args) as Promise<DebugProtocol.SourceResponse["body"]>;
  }

  /** StackTrace request; value of command field is 'stackTrace'.
        The request returns a stacktrace from the current execution state.
    */
  public stackTrace(args: DebugProtocol.StackTraceRequest["arguments"]): Promise<DebugProtocol.StackTraceResponse["body"]> {
    return this.sendRequest("stackTrace", args) as Promise<DebugProtocol.StackTraceResponse["body"]>;
  }

  /** StepBack request; value of command field is 'stepBack'.
        The request starts the debuggee to run one step backwards.
        The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed. Clients should only call this request if the capability 'supportsStepBack' is true.
    */
  public stepBack(args: DebugProtocol.StepBackRequest["arguments"]): Promise<DebugProtocol.StepBackResponse["body"]> {
    return this.sendRequest("stepBack", args) as Promise<DebugProtocol.StepBackResponse["body"]>;
  }

  /** StepIn request; value of command field is 'stepIn'.
        The request starts the debuggee to step into a function/method if possible.
        If it cannot step into a target, 'stepIn' behaves like 'next'.
        The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed.
        If there are multiple function/method calls (or other targets) on the source line,
        the optional argument 'targetId' can be used to control into which target the 'stepIn' should occur.
        The list of possible targets for a given source line can be retrieved via the 'stepInTargets' request.
    */
  public stepIn(args: DebugProtocol.StepInRequest["arguments"]): Promise<DebugProtocol.StepInResponse["body"]> {
    return this.sendRequest("stepIn", args) as Promise<DebugProtocol.StepInResponse["body"]>;
  }

  /** StepInTargets request; value of command field is 'stepInTargets'.
        This request retrieves the possible stepIn targets for the specified stack frame.
        These targets can be used in the 'stepIn' request.
        The StepInTargets may only be called if the 'supportsStepInTargetsRequest' capability exists and is true.
    */
  public stepInTargets(args: DebugProtocol.StepInTargetsRequest["arguments"]): Promise<DebugProtocol.StepInTargetsResponse["body"]> {
    return this.sendRequest("stepInTargets", args) as Promise<DebugProtocol.StepInTargetsResponse["body"]>;
  }

  /** StepOut request; value of command field is 'stepOut'.
        The request starts the debuggee to run again for one step.
        The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed.
    */
  public stepOut(args: DebugProtocol.StepOutRequest["arguments"]): Promise<DebugProtocol.StepOutResponse["body"]> {
    return this.sendRequest("stepOut", args) as Promise<DebugProtocol.StepOutResponse["body"]>;
  }

  /** Terminate request; value of command field is 'terminate'.
        The 'terminate' request is sent from the client to the debug adapter in order to give the debuggee a chance for terminating itself.
    */
  public terminate(args: DebugProtocol.TerminateRequest["arguments"]): Promise<DebugProtocol.TerminateResponse["body"]> {
    return this.sendRequest("terminate", args) as Promise<DebugProtocol.TerminateResponse["body"]>;
  }

  /** TerminateThreads request; value of command field is 'terminateThreads'.
        The request terminates the threads with the given ids.
    */
  public terminateThreads(args: DebugProtocol.TerminateThreadsRequest["arguments"]): Promise<DebugProtocol.TerminateThreadsResponse["body"]> {
    return this.sendRequest("terminateThreads", args) as Promise<DebugProtocol.TerminateThreadsResponse["body"]>;
  }

  /** Threads request; value of command field is 'threads'.
        The request retrieves a list of all threads.
    */
  public threads(args: DebugProtocol.ThreadsRequest["arguments"]): Promise<DebugProtocol.ThreadsResponse["body"]> {
    return this.sendRequest("threads", args) as Promise<DebugProtocol.ThreadsResponse["body"]>;
  }

  /** Variables request; value of command field is 'variables'.
        Retrieves all child variables for the given variable reference.
        An optional filter can be used to limit the fetched children to either named or indexed children.
    */
  public variables(args: DebugProtocol.VariablesRequest["arguments"]): Promise<DebugProtocol.VariablesResponse["body"]> {
    return this.sendRequest("variables", args) as Promise<DebugProtocol.VariablesResponse["body"]>;
  }



  // Events
  /** Event message for 'breakpoint' event type.
        The event indicates that some information about a breakpoint has changed.
    */
  public onBreakpoint(callback: EventHandler<DebugProtocol.BreakpointEvent>, once = false): Unsubscribable {
    return this.onEvent("breakpoint", callback, once);
  }

  /** Event message for 'capabilities' event type.
        The event indicates that one or more capabilities have changed.
        Since the capabilities are dependent on the frontend and its UI, it might not be possible to change that at random times (or too late).
        Consequently this event has a hint characteristic: a frontend can only be expected to make a 'best effort' in honouring individual capabilities but there are no guarantees.
        Only changed capabilities need to be included, all other capabilities keep their values.
    */
  public onCapabilities(callback: EventHandler<DebugProtocol.CapabilitiesEvent>, once = false): Unsubscribable {
    return this.onEvent("capabilities", callback, once);
  }

  /** Event message for 'continued' event type.
        The event indicates that the execution of the debuggee has continued.
        Please note: a debug adapter is not expected to send this event in response to a request that implies that execution continues, e.g. 'launch' or 'continue'.
        It is only necessary to send a 'continued' event if there was no previous request that implied this.
    */
  public onContinued(callback: EventHandler<DebugProtocol.ContinuedEvent>, once = false): Unsubscribable {
    return this.onEvent("continued", callback, once);
  }

  /** Event message for 'exited' event type.
        The event indicates that the debuggee has exited and returns its exit code.
    */
  public onExited(callback: EventHandler<DebugProtocol.ExitedEvent>, once = false): Unsubscribable {
    return this.onEvent("exited", callback, once);
  }

  /** Event message for 'initialized' event type.
        This event indicates that the debug adapter is ready to accept configuration requests (e.g. SetBreakpointsRequest, SetExceptionBreakpointsRequest).
        A debug adapter is expected to send this event when it is ready to accept configuration requests (but not before the 'initialize' request has finished).
        The sequence of events/requests is as follows:
        - adapters sends 'initialized' event (after the 'initialize' request has returned)
        - frontend sends zero or more 'setBreakpoints' requests
        - frontend sends one 'setFunctionBreakpoints' request
        - frontend sends a 'setExceptionBreakpoints' request if one or more 'exceptionBreakpointFilters' have been defined (or if 'supportsConfigurationDoneRequest' is not defined or false)
        - frontend sends other future configuration requests
        - frontend sends one 'configurationDone' request to indicate the end of the configuration.
    */
  public onInitialized(callback: EventHandler<DebugProtocol.InitializedEvent>, once = false): Unsubscribable {
    return this.onEvent("initialized", callback, once);
  }

  /** Event message for 'loadedSource' event type.
        The event indicates that some source has been added, changed, or removed from the set of all loaded sources.
    */
  public onLoadedSource(callback: EventHandler<DebugProtocol.LoadedSourceEvent>, once = false): Unsubscribable {
    return this.onEvent("loadedSource", callback, once);
  }

  /** Event message for 'module' event type.
        The event indicates that some information about a module has changed.
    */
  public onModule(callback: EventHandler<DebugProtocol.ModuleEvent>, once = false): Unsubscribable {
    return this.onEvent("module", callback, once);
  }

  /** Event message for 'output' event type.
        The event indicates that the target has produced some output.
    */
  public onOutput(callback: EventHandler<DebugProtocol.OutputEvent>, once = false): Unsubscribable {
    return this.onEvent("output", callback, once);
  }

  /** Event message for 'process' event type.
        The event indicates that the debugger has begun debugging a new process. Either one that it has launched, or one that it has attached to.
    */
  public onProcess(callback: EventHandler<DebugProtocol.ProcessEvent>, once = false): Unsubscribable {
    return this.onEvent("process", callback, once);
  }

  /** Event message for 'stopped' event type.
        The event indicates that the execution of the debuggee has stopped due to some condition.
        This can be caused by a break point previously set, a stepping action has completed, by executing a debugger statement etc.
    */
  public onStopped(callback: EventHandler<DebugProtocol.StoppedEvent>, once = false): Unsubscribable {
    return this.onEvent("stopped", callback, once);
  }

  /** Event message for 'terminated' event type.
        The event indicates that debugging of the debuggee has terminated. This does **not** mean that the debuggee itself has exited.
    */
  public onTerminated(callback: EventHandler<DebugProtocol.TerminatedEvent>, once = false): Unsubscribable {
    return this.onEvent("terminated", callback, once);
  }

  /** Event message for 'thread' event type.
        The event indicates that a thread has started or exited.
    */
  public onThread(callback: EventHandler<DebugProtocol.ThreadEvent>, once = false): Unsubscribable {
    return this.onEvent("thread", callback, once);
  }



  // Reverse Requests
  /** RunInTerminal request; value of command field is 'runInTerminal'.
      This request is sent from the debug adapter to the client to run a command in a terminal. This is typically used to launch the debuggee in a terminal provided by the client.
  */
  public onRunInTerminalRequest(callback: ReverseRequestHandler<DebugProtocol.RunInTerminalRequest, DebugProtocol.RunInTerminalResponse>): Unsubscribable {
    return this.onReverseRequest("runInTerminal", callback);
  }
}
