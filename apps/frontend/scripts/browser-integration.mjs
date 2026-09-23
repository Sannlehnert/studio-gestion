import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runBrowserTests } from "./run-browser.mjs";
const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const require = createRequire(backend + "/package.json");
const envFile = backend + "/.env.test";
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Falta TEST_DATABASE_URL; nunca se usa desarrollo como fallback.",
  );
const url = new URL(process.env.TEST_DATABASE_URL);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !url.pathname.endsWith("_test")
)
  throw new Error("Se requiere base *_test.");
const schema = "frontend_" + randomUUID().replaceAll("-", "");
url.searchParams.set("schema", schema);
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: url.toString(),
  FRONTEND_ORIGIN: "http://localhost:5173",
  FRONTEND_ORIGINS: "http://localhost:5173",
  API_ORIGIN: "http://localhost:3100",
  COOKIE_SECURE: "false",
  SWAGGER_ENABLED: "true",
  TRUST_PROXY: "false",
  RATE_API_LIMIT: "1000",
  RATE_LOGIN_LIMIT: "100",
  RATE_ACTIVATION_LIMIT: "100",
});
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient({ datasourceUrl: url.toString() });
let ready = false;
let app;
try {
  await prisma.$connect();
  ready = true;
  execFileSync(
    process.execPath,
    [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
    { cwd: backend, env: process.env, stdio: "inherit" },
  );
  const { NestFactory } = require("@nestjs/core");
  const compiled = fileURLToPath(
    new URL("../.openapi-build/", import.meta.url),
  );
  const { AppModule } = require(compiled + "/app.module.js");
  const { configureApp } = require(compiled + "/common/http/configure-app.js");
  const { PasswordService } = require(
    compiled + "/auth/services/password.service.js",
  );
  app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  await configureApp(app);
  await app.listen(3100, "localhost");
  const password = randomBytes(24).toString("base64url");
  const email = "browser-" + randomUUID() + "@example.test";
  await prisma.admin.create({
    data: {
      email,
      passwordHash: await app.get(PasswordService).hash(password),
    },
  });
  console.log(
    "Browser integration: backend aislado en localhost:3100; base *_test, schema efímero.",
  );
  process.exitCode = await runBrowserTests(
    {
      E2E_API_ORIGIN: "http://localhost:3100",
      E2E_ADMIN_EMAIL: email,
      E2E_ADMIN_PASSWORD: password,
    },
    process.argv.slice(2),
  );
} finally {
  if (app) await app.close();
  if (ready)
    await prisma.$executeRaw(
      Prisma.sql`DROP SCHEMA IF EXISTS ${Prisma.raw('"' + schema + '"')} CASCADE`,
    );
  await prisma.$disconnect();
}
