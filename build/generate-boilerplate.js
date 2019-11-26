// @ts-check

const fs = require("mz/fs");
const gulp = require("gulp");

function lowerFirst(str) {
  return str[0].toLocaleLowerCase() + str.slice(1);
}

function extractRequestTypes() {
  // matches /** <Documentation> */ interface <Command>Request extends Request)
  return extractTypes(/(?:(\/\*\*(?:(?!\*\/)[\s\S])+\*\/)[\s]*)?interface (\w*)Request extends Request/gm, [
    "RunInTerminal",
    "Cancel"
  ]);
}

function extractEventTypes() {
  // matches /** <Documentation> */ interface <Command>Event extends Event)
  return extractTypes(/(?:(\/\*\*(?:(?!\*\/)[\s\S])+\*\/)[\s]*)?interface (\w+)Event extends Event/g, []);
}

async function extractTypes(regex, blacklist) {
  const fileContent = await fs.readFile("node_modules/vscode-debugprotocol/lib/debugProtocol.d.ts", "utf-8");

  let match;
  const result = [];
  while (match = regex.exec(fileContent)) {
    if (!blacklist.includes(match[2])) {
      result.push({
        docs: match[1],
        name: match[2]
      });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function generateRequestMethods() {
  const requests = await extractRequestTypes();
  let result = "  // Requests\n";

  requests.forEach(({ docs, name }) => {
    const firstLower = lowerFirst(name);
    if (docs) {
      result += `  ${docs}\n`
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
      result += `  ${docs}\n`
    }

    result += `  public on${name}(callback: EventHandler<DebugProtocol.${name}Event>, once = false): Unsubscribable {
    return this.onEvent("${firstLower}", callback, once);
  }\n\n`;
  });

  return result;
}

gulp.task("extract-request-names", async () => console.log((await extractRequestTypes()).map((t) => t.name).join("\n")));
gulp.task("extract-event-names", async () => console.log((await extractEventTypes()).map((t) => t.name).join("\n")));
gulp.task("generate-request-methods", async () => console.log(await generateRequestMethods()));
gulp.task("generate-event-methods", async () => console.log(await generateEventMethods()));
