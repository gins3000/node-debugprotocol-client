import { DebugProtocol } from "vscode-debugprotocol";

export const TWO_CRLF = "\r\n\r\n";
export const CONTENT_LENGTH_HEADER = "Content-Length";

export type MESSAGE_TYPE = "request" | "response" | "event";

export type REQUEST_COMMAND
  = "attach"
  | "breakpointLocations"
  | "completions"
  | "configurationDone"
  | "continue"
  | "dataBreakpointInfo"
  | "disassemble"
  | "disconnect"
  | "evaluate"
  | "exceptionInfo"
  | "goto"
  | "gotoTargets"
  | "initialize"
  | "launch"
  | "loadedSources"
  | "modules"
  | "next"
  | "pause"
  | "readMemory"
  | "restart"
  | "restartFrame"
  | "reverseContinue"
  | "scopes"
  | "setBreakpoints"
  | "setDataBreakpoints"
  | "setExceptionBreakpoints"
  | "setExpression"
  | "setFunctionBreakpoints"
  | "setVariable"
  | "source"
  | "stackTrace"
  | "stepBack"
  | "stepIn"
  | "stepInTargets"
  | "stepOut"
  | "terminate"
  | "terminateThreads"
  | "threads"
  | "variables"
  ;

export type EVENT_TYPE
  = "breakpoint"
  | "capabilities"
  | "continued"
  | "exited"
  | "initialized"
  | "loadedSource"
  | "module"
  | "output"
  | "process"
  | "stopped"
  | "terminated"
  | "thread"
  ;

export type REVERSE_REQUEST_COMMAND
  = "runInTerminal"
  ;

export function isRequest(message: DebugProtocol.ProtocolMessage): message is DebugProtocol.Request {
  const request = message as DebugProtocol.Request;
  return request.type === "request"
    && typeof request.command === "string"
    && typeof request.seq === "number";
}

export function isResponse(message: DebugProtocol.ProtocolMessage): message is DebugProtocol.Response {
  const response = message as DebugProtocol.Response;
  return response.type === "response"
    && typeof response.request_seq === "number"
    && typeof response.success === "boolean";
}

export function isEvent(message: DebugProtocol.ProtocolMessage): message is DebugProtocol.Event {
  const event = message as DebugProtocol.Event;
  return event.type === "event"
    && typeof event.event === "string"
    && typeof event.seq === "number";
}

export function encodeMessage(message: DebugProtocol.ProtocolMessage): string {
  const body = JSON.stringify(message);
  const header = `${CONTENT_LENGTH_HEADER}: ${body.length}`;

  return `${header}${TWO_CRLF}${body}`;
}
