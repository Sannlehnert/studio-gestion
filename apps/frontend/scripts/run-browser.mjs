import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
export async function runBrowserTests(extraEnv = {}, args = []) {
  process.env.VITE_API_BASE_URL =
    extraEnv.E2E_API_ORIGIN ?? "http://localhost:3000";
  const root = fileURLToPath(new URL("../", import.meta.url));
  const frontend = await createServer({
    root,
    server: { host: "localhost", port: 5173, strictPort: true },
  });
  try {
    await frontend.listen();
    const child = spawn(
      process.execPath,
      [require.resolve("@playwright/test/cli"), "test", ...args],
      {
        cwd: root,
        env: { ...process.env, ...extraEnv, E2E_FRONTEND_MANAGED: "true" },
        stdio: "inherit",
      },
    );
    return await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await frontend.close();
  }
}
