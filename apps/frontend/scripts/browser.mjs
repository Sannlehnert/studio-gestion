import { runBrowserTests } from "./run-browser.mjs";
process.exitCode = await runBrowserTests({}, process.argv.slice(2));
