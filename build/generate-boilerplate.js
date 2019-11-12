// @ts-check

const fs = require("mz/fs");
const gulp = require("gulp");

function lowerFirst(str) {
  return str[0].toLocaleLowerCase() + str.slice(1);
}

function extractRequestNames() {
  return extractNames(/interface (\w+)Request extends Request/g, [
    "RunInTerminal",
    "Cancel"
  ]);
}

function extractEventNames() {
  return extractNames(/interface (\w+)Event extends Event/g, []);
}

async function extractNames(regex, blacklist) {
  const fileContent = await fs.readFile("node_modules/vscode-debugprotocol/lib/debugProtocol.d.ts", "utf-8");

  let match;
  const result = [];
  while (match = regex.exec(fileContent)) {
    if (!blacklist.includes(match[1])) {
      result.push(match[1]);
    }
  }

  return result.sort();
}

async function generateRequestMethods() {
  const requests = await extractRequestNames();

  return "  // Requests\n" + requests.map((x) => {
    const firstLower = lowerFirst(x);
    if (["Attach", "Launch"].includes(x)) {
      return `  public ${firstLower}<T extends DebugProtocol.${x}Request["arguments"]>(args: T): Promise<DebugProtocol.${x}Response> {
    return this.sendRequest("${firstLower}", args) as Promise<DebugProtocol.${x}Response>;
  }`;
    }

    return `  public ${firstLower}(args: DebugProtocol.${x}Request["arguments"]): Promise<DebugProtocol.${x}Response> {
    return this.sendRequest("${firstLower}", args) as Promise<DebugProtocol.${x}Response>;
  }`;
  }).join("\n\n");
}

//   public abstract onEvent<T extends DebugProtocol.Event>(event: T["event"], callback: EventHandler<T>, once: boolean): Unsubscribable;

async function generateEventMethods() {
  const events = await extractEventNames();

  return "  // Events\n" + events.map((event) => {
    const firstLower = lowerFirst(event);
    return `  public on${event}(callback: EventHandler<DebugProtocol.${event}Event>, once = false): Unsubscribable {
    return this.onEvent("${firstLower}", callback, once);
  }`;
  }).join("\n\n");
}

gulp.task("extract-request-names", async () => console.log((await extractRequestNames()).join("\n")));
gulp.task("extract-event-names", async () => console.log((await extractEventNames()).join("\n")));
gulp.task("generate-request-methods", async () => console.log(await generateRequestMethods()));
gulp.task("generate-event-methods", async () => console.log(await generateEventMethods()));
