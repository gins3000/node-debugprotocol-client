// @ts-check
'use strict';

const fs = require("mz/fs");

/**
 * @param {string} str 
 * @returns {string}
 */
function lowerFirst(str) {
  return str[0].toLocaleLowerCase() + str.slice(1);
}

function extractRequestTypes() {
  // matches /** <Documentation> */ interface <Command>Request extends Request)
  return extractTypes(/(?:(\/\*\*(?:(?!\*\/)[\s\S])+\*\/)[\s]*)?interface (\w*)Request extends Request/gm, [
    "RunInTerminal",
    "Cancel",
  ]);
}

function extractEventTypes() {
  // matches /** <Documentation> */ interface <Command>Event extends Event)
  return extractTypes(/(?:(\/\*\*(?:(?!\*\/)[\s\S])+\*\/)[\s]*)?interface (\w+)Event extends Event/g, []);
}

/**
 * @param {RegExp} regex 
 * @param {string[]} blocklist 
 */
async function extractTypes(regex, blocklist) {
  const fileContent = await fs.readFile("node_modules/vscode-debugprotocol/lib/debugProtocol.d.ts", "utf-8");

  let match;
  const result = [];
  while (match = regex.exec(fileContent)) {
    if (!blocklist.includes(match[2])) {
      result.push({
        docs: match[1],
        name: match[2],
      });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function extractRequestNames() {
  return (await extractRequestTypes()).map((t) => t.name).join("\n");
}

async function extractEventNames() {
  return (await extractEventTypes()).map((t) => t.name).join("\n");
}

async function generateRequestMethods() {
  const requests = await extractRequestTypes();
  let result = "  // Requests\n";

  requests.forEach(({ docs, name }) => {
    const firstLower = lowerFirst(name);
    if (docs) {
      result += `  ${docs}\n`;
    }

    if (["Attach", "Launch"].includes(name)) {
      result += `  public ${firstLower}<T extends DebugProtocol.${name}Request["arguments"]>(args: T): Promise<DebugProtocol.${name}Response["body"]> {
    return this.sendRequest("${firstLower}", args) as Promise<DebugProtocol.${name}Response["body"]>;
  }\n\n`;
    } else {
      result += `  public ${firstLower}(args: DebugProtocol.${name}Request["arguments"]): Promise<DebugProtocol.${name}Response["body"]> {
    return this.sendRequest("${firstLower}", args) as Promise<DebugProtocol.${name}Response["body"]>;
  }\n\n`;
    }

  });

  return result;
}

async function generateEventMethods() {
  const events = await extractEventTypes();
  let result = "  // Events\n";

  events.forEach(({ docs, name }) => {
    const firstLower = lowerFirst(name);
    if (docs) {
      result += `  ${docs}\n`;
    }

    result += `  public on${name}(callback: EventHandler<DebugProtocol.${name}Event>, once = false): Unsubscribable {
    return this.onEvent("${firstLower}", callback, once);
  }\n\n`;
  });

  return result;
}

const availableTasks = {
  "extract-request-names": extractRequestNames,
  "extract-event-names": extractEventNames,
  "generate-request-methods": generateRequestMethods,
  "generate-event-methods": generateEventMethods,
};

async function run() {
  const taskName = process.argv[2];
  const task = availableTasks[taskName];
  if (!task) {
    console.error(`usage: node build/generate-boilerplate.js <task name>\nAvailable tasks:\n  ${Object.keys(availableTasks).join('\n  ')}`);
    return 1;
  }

  console.log(await task());
}

run();
