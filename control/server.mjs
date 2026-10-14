// LectureForge control service: the admin page (AI settings, start / restart /
// shut down). Deliberately tiny and dependency-free so it can stay up while
// the rest of the stack is stopped (about 40 MB of memory, no CPU when idle).
//
// What it manages:
//  - Docker containers of one Compose project (label com.docker.compose.project),
//    through the Docker Engine API — never containers of other projects.
//  - Optionally (development) local processes: the Next.js dev server and the worker.
//  - Optionally (development) unloading the models of a local Ollama on shutdown.
//
// Run: node control/server.mjs   (reads ./.env when present)
import { spawn, execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// ───────────────────────────── configuration ─────────────────────────────

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
const PROJECT_DIR = path.resolve(process.env.CONTROL_PROJECT_DIR || process.cwd());
loadDotEnv(path.join(PROJECT_DIR, ".env"));

const cfg = {
  host: process.env.CONTROL_HOST || "127.0.0.1",
  port: Number(process.env.CONTROL_PORT || 3200),
  key: (process.env.LECTURE_ACCESS_KEY || "").trim(),
  project: process.env.CONTROL_COMPOSE_PROJECT || "lectureforge",
  dockerSocket: process.env.CONTROL_DOCKER_SOCKET || (process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock"),
  exclude: new Set((process.env.CONTROL_EXCLUDE || "control,migrate,clamav").split(",").map((s) => s.trim()).filter(Boolean)),
  localProcesses: (process.env.CONTROL_LOCAL_PROCESSES || "").split(",").map((s) => s.trim()).filter(Boolean),
  ollamaUnload: process.env.CONTROL_OLLAMA_UNLOAD || "",
  settingsPath: process.env.APP_SETTINGS_PATH || path.join(PROJECT_DIR, ".data", "settings.json"),
  appUrl: process.env.CONTROL_APP_URL || "/",
  // Where this service reaches the app server-to-server (account management).
  appInternalUrl: (process.env.CONTROL_APP_INTERNAL_URL || "http://127.0.0.1:3000").replace(/\/$/, ""),
  // For the "restart from a terminal" instructions: the project directory as seen
  // on the host (inside a container PROJECT_DIR is not the host path) and how to log in.
  hostDir: process.env.CONTROL_HOST_DIR || "",
  sshCommand: process.env.CONTROL_SSH_COMMAND || "",
};

/** Commands that bring the service back from a terminal, for the current setup. */
function restartInstructions() {
  if (cfg.localProcesses.length) {
    const dir = cfg.hostDir || PROJECT_DIR;
    return {
      where: "On this computer",
      dir,
      steps: [
        {
          text: process.platform === "win32" ? "Open a terminal (PowerShell) in the project directory — in cmd.exe use cd /d" : "Open a terminal in the project directory",
          command: `cd "${dir}"`,
        },
        { text: "Start the database, storage and speech-to-text containers (Docker Desktop must be running)", command: "docker compose start" },
        { text: "Start the web application (leave this terminal open)", command: "npm run dev" },
        { text: "In a second terminal, in the same directory, start the background worker", command: "npm run worker" },
      ],
      alternative: "Or, if this admin page is still open, press Start: it runs the same steps for you. If the admin page itself is not running, start it with: npm run control",
    };
  }
  const dir = cfg.hostDir || "/opt/lectureforge";
  return {
    where: "On the server",
    dir,
    steps: [
      ...(cfg.sshCommand ? [{ text: "Connect to the server", command: cfg.sshCommand }] : []),
      { text: "Go to the project directory", command: `cd ${dir}` },
      { text: "Start every LectureForge container", command: "sudo docker compose --env-file .env.production start" },
      { text: "Check that everything is running", command: "sudo docker compose --env-file .env.production ps" },
    ],
    alternative: "Or press Start on this admin page: it does the same thing.",
  };
}

/** Containers start in this order (dependencies first) and stop in reverse. */
const START_ORDER = ["postgres", "redis", "storage", "embed", "stt", "web", "worker"];
const rank = (name) => {
  const i = START_ORDER.indexOf(name);
  return i === -1 ? START_ORDER.indexOf("web") - 0.5 : i; // unknown services: after infrastructure, before the app
};

const AI_MODELS = { "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-opus-5-5": "Claude Opus 5.5" };
const AI_EFFORTS = { medium: "Medium", high: "High" };
const DEFAULT_SETTINGS = { aiModel: "claude-sonnet-5-5", aiEffort: "medium" };

// ───────────────────────────── settings file ─────────────────────────────

function readSettings() {
  try {
    const raw = JSON.parse(readFileSync(cfg.settingsPath, "utf8"));
    return {
      aiModel: raw.aiModel in AI_MODELS ? raw.aiModel : DEFAULT_SETTINGS.aiModel,
      aiEffort: raw.aiEffort in AI_EFFORTS ? raw.aiEffort : DEFAULT_SETTINGS.aiEffort,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, updatedAt: null };
  }
}

function writeSettings(s) {
  mkdirSync(path.dirname(cfg.settingsPath), { recursive: true });
  const tmp = `${cfg.settingsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o644 });
  renameSync(tmp, cfg.settingsPath); // atomic: readers never see a half-written file
}

// ───────────────────────────── Docker Engine API ─────────────────────────────

function docker(method, apiPath, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: cfg.dockerSocket, path: apiPath, method, headers: { Host: "docker" }, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`Docker ${method} ${apiPath.split("?")[0]}: ${res.statusCode} ${body.slice(0, 200)}`));
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch {
          resolve(body);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Docker API timed out")));
    req.on("error", (err) => reject(new Error(`Docker is not reachable (${err.code || err.message}). Is Docker running?`)));
    req.end();
  });
}

async function listContainers() {
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${cfg.project}`] }));
  const all = await docker("GET", `/containers/json?all=true&filters=${filters}`);
  return all
    .map((c) => ({ id: c.Id, name: c.Labels["com.docker.compose.service"] || c.Names[0], state: c.State, status: c.Status }))
    .filter((c) => !cfg.exclude.has(c.name))
    .sort((a, b) => rank(a.name) - rank(b.name));
}

async function containerUsage(id) {
  try {
    const s = await docker("GET", `/containers/${id}/stats?stream=false`, { timeoutMs: 8000 });
    const mem = s.memory_stats || {};
    const cache = mem.stats?.inactive_file ?? mem.stats?.total_inactive_file ?? 0;
    const memory = mem.usage ? Math.max(0, mem.usage - cache) : 0;
    const cpuDelta = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const sysDelta = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
    const cpus = s.cpu_stats?.online_cpus || 1;
    return { memory, cpu: sysDelta > 0 && cpuDelta >= 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0 };
  } catch {
    return { memory: null, cpu: null };
  }
}

async function waitHealthy(c, log) {
  for (let i = 0; i < 60; i++) {
    const info = await docker("GET", `/containers/${c.id}/json`);
    const health = info.State?.Health?.Status;
    if (!health || health === "healthy") return;
    if (i === 0) log(`Waiting for ${c.name} to be ready…`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  log(`${c.name} did not report healthy within a minute; continuing.`);
}

// ───────────────────────────── local processes (development) ─────────────────────────────

const norm = (s) => s.replace(/\//g, "\\").toLowerCase();
const DIR = norm(PROJECT_DIR) + "\\";
const LOCAL = {
  web: {
    label: "web (Next.js dev server)",
    command: "npm run dev",
    match: (cmd) => cmd.includes(DIR) && cmd.includes("next") && (/\snext\s+dev|\\next\\dist\\bin\\next"?\s+dev/.test(cmd) || cmd.includes("start-server.js")),
  },
  worker: {
    label: "worker",
    command: "npm run worker",
    match: (cmd) => cmd.includes(DIR) && cmd.includes("src\\worker\\index.ts"),
  },
};

function run(file, args) {
  return new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );
}

/** node processes of this project: [{ pid, memory, cmd }] */
async function nodeProcesses() {
  if (process.platform === "win32") {
    const out = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress",
    ]);
    const rows = out.trim() ? JSON.parse(out) : [];
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({ pid: r.ProcessId, memory: Number(r.WorkingSetSize) || 0, cmd: norm(r.CommandLine || "") }));
  }
  const out = await run("ps", ["-eo", "pid=,rss=,args="]);
  return out
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), memory: Number(m[2]) * 1024, cmd: norm(m[3]) }))
    .filter((p) => p.cmd.includes("node"));
}

async function localStatus() {
  if (!cfg.localProcesses.length) return [];
  const procs = await nodeProcesses().catch(() => []);
  return cfg.localProcesses
    .filter((n) => LOCAL[n])
    .map((n) => {
      const mine = procs.filter((p) => LOCAL[n].match(p.cmd) && p.pid !== process.pid);
      return { name: n, label: LOCAL[n].label, kind: "process", running: mine.length > 0, memory: mine.reduce((s, p) => s + p.memory, 0), cpu: null, pids: mine.map((p) => p.pid) };
    });
}

async function stopLocal(name, log) {
  const s = (await localStatus()).find((x) => x.name === name);
  if (!s?.running) return;
  for (const pid of s.pids) {
    if (process.platform === "win32") await run("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
    else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
  log(`Stopped ${LOCAL[name].label}.`);
}

function startLocal(name, log) {
  const logDir = path.join(PROJECT_DIR, ".data", "logs");
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${name}.log`);
  const cmd = LOCAL[name].command;
  const child =
    process.platform === "win32"
      ? // Verbatim, wrapped in one pair of quotes that cmd /s strips: Node's default
        // argument quoting (\") is not understood by cmd.exe.
        spawn("cmd.exe", ["/d", "/s", "/c", `"${cmd} >> "${logFile}" 2>&1"`], {
          cwd: PROJECT_DIR,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          windowsVerbatimArguments: true,
        })
      : spawn("sh", ["-c", `exec ${cmd} >> "${logFile}" 2>&1`], { cwd: PROJECT_DIR, detached: true, stdio: "ignore" });
  child.unref();
  log(`Started ${LOCAL[name].label} (log: .data/logs/${name}.log).`);
}

// ───────────────────────────── Ollama (development) ─────────────────────────────

async function unloadOllama(log) {
  if (!cfg.ollamaUnload) return;
  const base = cfg.ollamaUnload.replace(/\/$/, "");
  try {
    const ps = await (await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(5000) })).json();
    for (const m of ps.models ?? []) {
      // keep_alive 0 unloads the model and frees its RAM/VRAM; embedding-only models reject /api/generate.
      const r = await fetch(`${base}/api/generate`, { method: "POST", body: JSON.stringify({ model: m.name, keep_alive: 0 }) }).catch(() => null);
      if (!r?.ok) await fetch(`${base}/api/embed`, { method: "POST", body: JSON.stringify({ model: m.name, input: "", keep_alive: 0 }) }).catch(() => null);
      log(`Unloaded ${m.name} from Ollama.`);
    }
  } catch {
    log("Ollama is not running (nothing to unload).");
  }
}

async function ollamaLoaded() {
  if (!cfg.ollamaUnload) return null;
  try {
    const ps = await (await fetch(`${cfg.ollamaUnload.replace(/\/$/, "")}/api/ps`, { signal: AbortSignal.timeout(3000) })).json();
    return (ps.models ?? []).map((m) => ({ name: m.name, memory: (m.size_vram || 0) + Math.max(0, (m.size || 0) - (m.size_vram || 0)) }));
  } catch {
    return [];
  }
}

// ───────────────────────────── actions ─────────────────────────────

const job = { action: null, lastAction: null, startedAt: null, finishedAt: null, log: [], error: null };

function logLine(text) {
  job.log.push({ at: new Date().toISOString(), text });
  if (job.log.length > 60) job.log.shift();
}

async function shutDown() {
  // App first (it holds connections to the rest), then infrastructure.
  for (const n of [...cfg.localProcesses].reverse()) if (LOCAL[n]) await stopLocal(n, logLine);
  const containers = (await listContainers()).reverse();
  for (const c of containers) {
    if (c.state !== "running" && c.state !== "restarting") continue;
    logLine(`Stopping ${c.name}…`);
    // Grace period before Docker kills the process: the database gets time for a clean shutdown;
    // services that ignore SIGTERM (e.g. speech-to-text) are not waited on for long.
    const grace = c.name === "postgres" ? 30 : 10;
    await docker("POST", `/containers/${c.id}/stop?t=${grace}`, { timeoutMs: (grace + 30) * 1000 });
  }
  await unloadOllama(logLine);
}

async function startUp() {
  const containers = await listContainers();
  if (!containers.length && !cfg.localProcesses.length) throw new Error(`No containers found for Compose project “${cfg.project}”. Create them once with docker compose up -d.`);
  for (const c of containers) {
    if (c.state !== "running") {
      logLine(`Starting ${c.name}…`);
      await docker("POST", `/containers/${c.id}/start`);
    }
    if (c.name === "postgres") await waitHealthy(c, logLine);
  }
  const local = await localStatus();
  for (const n of cfg.localProcesses) if (LOCAL[n] && !local.find((x) => x.name === n)?.running) startLocal(n, logLine);
}

async function runAction(action) {
  if (job.action) throw Object.assign(new Error(`“${job.action}” is still running.`), { status: 409 });
  Object.assign(job, { action, startedAt: new Date().toISOString(), finishedAt: null, log: [], error: null });
  logLine(action === "stop" ? "Shutting down…" : action === "start" ? "Starting…" : "Restarting…");
  (async () => {
    try {
      if (action === "stop" || action === "restart") await shutDown();
      if (action === "start" || action === "restart") await startUp();
      logLine(action === "stop" ? "Shut down. Memory and CPU are released." : "Running.");
    } catch (err) {
      job.error = err.message;
      logLine(`Error: ${err.message}`);
    } finally {
      job.finishedAt = new Date().toISOString();
      job.lastAction = action;
      job.action = null;
    }
  })();
}

async function status() {
  const [containers, local, ollama] = await Promise.all([
    listContainers().catch((err) => ({ error: err.message })),
    localStatus(),
    ollamaLoaded(),
  ]);
  const services = [];
  let dockerError = null;
  if (Array.isArray(containers)) {
    const usage = await Promise.all(containers.map((c) => (c.state === "running" ? containerUsage(c.id) : { memory: 0, cpu: 0 })));
    containers.forEach((c, i) => services.push({ name: c.name, label: c.name, kind: "container", running: c.state === "running", state: c.state, detail: c.status, ...usage[i] }));
  } else dockerError = containers.error;
  for (const p of local) services.push({ ...p, state: p.running ? "running" : "stopped", detail: p.running ? `${p.pids.length} process${p.pids.length === 1 ? "" : "es"}` : "" });
  const running = services.filter((s) => s.running).length;
  return {
    overall: running === 0 ? "stopped" : running === services.length ? "running" : "partial",
    services,
    ollama,
    dockerError,
    host: { totalMemory: os.totalmem(), freeMemory: os.freemem(), cpus: os.cpus().length, load: os.loadavg()[0] },
    job: { ...job, log: job.log.slice(-25) },
    restart: restartInstructions(),
    settings: readSettings(),
  };
}

// ───────────────────────────── auth ─────────────────────────────

const ADMIN_COOKIE = "lf_admin";
const SESSION_MS = 8 * 3600_000;
const sign = (payload) => createHmac("sha256", cfg.key).update(`lectureforge-admin/v1:${payload}`).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
}

function isAdmin(req) {
  if (!cfg.key) return false;
  const v = cookies(req)[ADMIN_COOKIE];
  const [exp, mac] = (v || "").split(".");
  return Boolean(exp && mac && Number(exp) > Date.now() && safeEqual(mac, sign(exp)));
}

const secure = (req) => (req.headers["x-forwarded-proto"] || "").includes("https");
function sessionCookie(req) {
  const exp = String(Date.now() + SESSION_MS);
  return `${ADMIN_COOKIE}=${exp}.${sign(exp)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure(req) ? "; Secure" : ""}`;
}

const attempts = new Map(); // ip → timestamps of failed logins
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  attempts.set(ip, recent);
  return recent.length >= 10;
}
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

/** Cross-site requests cannot add custom headers without a preflight we never grant. */
const fromPage = (req) => req.headers["x-requested-with"] === "lectureforge-admin";

// ───────────────────────────── accounts (via the app) ─────────────────────────────

const hmacHex = (label) => createHmac("sha256", cfg.key).update(label).digest("hex");

/**
 * Calls the app's /api/admin routes. The site access cookie gets the request
 * past the app's password gate; the admin token authorizes the admin route.
 * Both are derived from LECTURE_ACCESS_KEY (src/lib/access-gate.ts).
 */
async function appAdmin(method, apiPath, body) {
  let res;
  try {
    res = await fetch(`${cfg.appInternalUrl}${apiPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: `lf_access=${hmacHex("lectureforge-access/v1")}`,
        "X-Admin-Token": hmacHex("lectureforge-admin-api/v1"),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw Object.assign(new Error("The app is not running. Start the web service first."), { status: 503 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `The app answered ${res.status}.`), { status: res.status });
  return data;
}

// ───────────────────────────── HTTP ─────────────────────────────

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (d) => {
      data += d;
      if (data.length > limit) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://control");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (p === "/admin/health") return send(res, 200, { ok: true });
    if (p === "/_control/stopped") return send(res, 503, stoppedPage(), { "Retry-After": "30" });

    if (p === "/admin/login" && req.method === "POST") {
      const ip = clientIp(req);
      if (!cfg.key) return send(res, 503, page(loginBody("LECTURE_ACCESS_KEY is not set on this server, so the admin page is disabled.")));
      if (tooManyAttempts(ip)) return send(res, 429, page(loginBody("Too many attempts. Wait a few minutes and try again.")));
      const password = new URLSearchParams(await readBody(req)).get("password") || "";
      if (!safeEqual(password, cfg.key)) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, page(loginBody("That password is not correct.")));
      }
      attempts.delete(ip);
      return send(res, 303, "", { Location: "/admin", "Set-Cookie": sessionCookie(req) });
    }
    if (p === "/admin/logout" && req.method === "POST") {
      return send(res, 303, "", { Location: "/admin", "Set-Cookie": `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0` });
    }

    if (p === "/admin") return send(res, 200, page(isAdmin(req) ? dashboardBody() : loginBody()));

    if (p.startsWith("/admin/api/")) {
      if (!isAdmin(req)) return send(res, 401, { error: "Sign in to the admin page first." });
      if (p === "/admin/api/status" && req.method === "GET") return send(res, 200, await status());
      // Accounts, profiles and disciplines live in the app's database: pass
      // through to its /api/admin routes (admin token added by appAdmin).
      if (p.startsWith("/admin/api/app/")) {
        const sub = p.slice("/admin/api/app/".length);
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/i.test(sub)) return send(res, 400, { error: "Bad path." });
        if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) return send(res, 405, { error: "Method not allowed." });
        if (req.method !== "GET" && !fromPage(req)) return send(res, 403, { error: "Forbidden." });
        const raw = req.method === "POST" || req.method === "PATCH" ? await readBody(req, 16_384) : "";
        return send(res, 200, await appAdmin(req.method, `/api/admin/${sub}`, raw ? JSON.parse(raw) : undefined));
      }
      if (req.method !== "POST" || !fromPage(req)) return send(res, 403, { error: "Forbidden." });
      const body = JSON.parse((await readBody(req)) || "{}");
      if (p === "/admin/api/settings") {
        if (!(body.aiModel in AI_MODELS) || !(body.aiEffort in AI_EFFORTS)) return send(res, 400, { error: "Unknown model or effort." });
        writeSettings({ aiModel: body.aiModel, aiEffort: body.aiEffort });
        return send(res, 200, { settings: readSettings() });
      }
      if (p === "/admin/api/action") {
        if (!["start", "stop", "restart"].includes(body.action)) return send(res, 400, { error: "Unknown action." });
        await runAction(body.action);
        return send(res, 202, { ok: true });
      }
    }
    return send(res, 404, page(`<main class="card"><h1>Not found</h1><p><a href="/admin">Admin page</a></p></main>`));
  } catch (err) {
    return send(res, err.status || 500, p.startsWith("/admin/api/") ? { error: err.message } : page(`<main class="card"><h1>Error</h1><p>${esc(err.message)}</p></main>`));
  }
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`LectureForge control on http://${cfg.host}:${cfg.port}/admin (project “${cfg.project}”${cfg.localProcesses.length ? `, local: ${cfg.localProcesses.join(", ")}` : ""})`);
  if (!cfg.key) console.warn("LECTURE_ACCESS_KEY is not set: the admin page refuses all sign-ins.");
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));

// ───────────────────────────── pages ─────────────────────────────

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1.2" fill="currentColor"/><rect x="6" y="10" width="12" height="4" rx="1.2" fill="currentColor" opacity=".7"/><rect x="9" y="16" width="6" height="4" rx="1.2" fill="currentColor" opacity=".45"/></svg>`;

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Admin · LectureForge</title><style>
:root{--bg:#f7f6f2;--card:#fff;--fg:#1c2428;--muted:#66727a;--border:#e2e0d8;--primary:#1d5a66;--primary-fg:#fff;--ok:#2f7a4f;--ok-bg:#e5f3ea;--warn:#946200;--warn-bg:#fbf1dc;--bad:#b3261e;--bad-bg:#fbe9e7;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#14191c;--card:#1b2226;--fg:#e8ecee;--muted:#9aa6ad;--border:#2c353a;--primary:#7cc4cf;--primary-fg:#0d1a1d;--ok:#7fd3a0;--ok-bg:#16301f;--warn:#e9c46a;--warn-bg:#2f2812;--bad:#ff8a80;--bad-bg:#3a1b19;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--fg);text-decoration:none}.brand svg{color:var(--primary)}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}p{margin:0}.muted{color:var(--muted);font-size:13px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:4px}
select,input[type=password]{width:100%;height:38px;border:1px solid var(--border);border-radius:8px;padding:0 10px;background:var(--card);color:var(--fg);font:inherit}
.row{display:grid;gap:12px;grid-template-columns:1fr 1fr}@media (max-width:560px){.row{grid-template-columns:1fr}}
button{height:38px;padding:0 16px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--fg);font:inherit;font-weight:600;cursor:pointer}
button.primary{background:var(--primary);color:var(--primary-fg);border-color:transparent}button.danger{color:var(--bad);border-color:var(--bad)}
button:disabled{opacity:.5;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
.pill.running{background:var(--ok-bg);color:var(--ok)}.pill.stopped{background:var(--bad-bg);color:var(--bad)}.pill.partial,.pill.busy{background:var(--warn-bg);color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--border)}th{font-size:12px;color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.log{margin-top:12px;font:12px/1.6 ui-monospace,Consolas,monospace;color:var(--muted);max-height:180px;overflow:auto;white-space:pre-wrap}
.msg{margin-top:10px;font-size:13px}.msg.err{color:var(--bad)}.msg.ok{color:var(--ok)}a{color:var(--primary)}
.meter{height:6px;border-radius:99px;background:var(--border);overflow:hidden;margin-top:6px}.meter>div{height:100%;background:var(--primary)}
dialog{border:1px solid var(--border);border-radius:12px;background:var(--card);color:var(--fg);padding:20px 22px;width:min(640px,calc(100vw - 32px))}
dialog::backdrop{background:rgb(0 0 0 / .45)}
code{font:13px ui-monospace,Consolas,monospace;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:1px 6px;word-break:break-all}
.steps{margin:0;padding-left:20px;display:grid;gap:10px}.steps li{font-size:14px}
button.small{height:30px;padding:0 10px;font-size:12px}
td select{height:32px;min-width:150px}
.profiles{display:grid;gap:12px}.profile{border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.profile-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.profile-head button{margin-left:auto}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.chip{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--border);border-radius:999px;padding:2px 4px 2px 10px;font-size:13px;background:var(--bg)}
.chip button{height:22px;width:22px;padding:0;border:0;background:none;color:var(--muted);font-size:15px;line-height:1}
.chip button:hover{color:var(--bad)}
.add-disc{display:flex;gap:8px}.add-disc input{height:32px;max-width:280px;width:100%;border:1px solid var(--border);border-radius:8px;padding:0 10px;background:var(--card);color:var(--fg);font:inherit}
input[type=text],input[type=email],input:not([type]){width:100%;height:38px;border:1px solid var(--border);border-radius:8px;padding:0 10px;background:var(--card);color:var(--fg);font:inherit}
.cmd{display:flex;align-items:center;gap:8px;margin-top:4px}.cmd code{flex:1;padding:6px 8px}.cmd button{height:30px;padding:0 10px;font-size:12px}
</style></head><body><header><a class="brand" href="${esc(cfg.appUrl)}">${ICON} LectureForge</a><span class="muted">Administration</span></header>${body}</body></html>`;
}

function loginBody(error = "") {
  return `<main><form class="card" method="post" action="/admin/login" style="max-width:420px;margin:8vh auto 0;width:100%">
<h1>Admin</h1><p class="muted" style="margin-bottom:14px">Enter the access password (LECTURE_ACCESS_KEY).</p>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
${error ? `<p class="msg err" role="alert">${esc(error)}</p>` : ""}
<div class="actions"><button class="primary" type="submit">Sign in</button></div></form></main>`;
}

function stoppedPage() {
  return page(`<main><div class="card" style="max-width:520px;margin:8vh auto 0;width:100%"><h1>LectureForge is stopped</h1>
<p class="muted" style="margin:6px 0 14px">The service has been shut down by an administrator to free the server's resources.</p>
<a href="/admin">Open the admin page to start it</a></div></main>`);
}

function dashboardBody() {
  const opt = (map) => Object.entries(map).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  return `<main>
<section class="card" aria-labelledby="svc-h">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><h2 id="svc-h">Web service</h2><p class="muted">Shutting down stops every LectureForge service and releases its memory and CPU. The admin page stays available to start it again.</p></div>
    <span id="overall" class="pill busy">…</span>
  </div>
  <div class="actions">
    <button id="b-start" class="primary" data-action="start">Start</button>
    <button id="b-restart" data-action="restart">Restart</button>
    <button id="b-stop" class="danger" data-action="stop">Shut down</button>
    <button id="b-howto" type="button" hidden>How to restart from a terminal</button>
  </div>
  <div id="host" class="muted" style="margin-top:14px"></div>
  <table aria-label="Services"><thead><tr><th>Service</th><th>State</th><th class="num">Memory</th><th class="num">CPU</th></tr></thead><tbody id="rows"></tbody></table>
  <div id="log" class="log" aria-live="polite"></div>
</section>

<section class="card" aria-labelledby="ai-h">
  <h2 id="ai-h">AI generation</h2>
  <p class="muted" style="margin-bottom:12px">Used for study guides, flashcards, quizzes and exercises (via Claude). Changes apply to the next generation; nothing needs to restart.</p>
  <form id="ai" class="row">
    <div><label for="aiModel">Model</label><select id="aiModel" name="aiModel">${opt(AI_MODELS)}</select></div>
    <div><label for="aiEffort">Effort</label><select id="aiEffort" name="aiEffort">${opt(AI_EFFORTS)}</select></div>
  </form>
  <p class="muted" style="margin-top:8px">Sonnet with medium effort is faster and cheaper; Opus with high effort is more thorough on difficult material.</p>
  <div class="actions"><button class="primary" id="save" form="ai" type="submit">Save</button></div>
  <p id="ai-msg" class="msg" role="status"></p>
</section>

<section class="card" aria-labelledby="acc-h">
  <h2 id="acc-h">Accounts</h2>
  <p class="muted" style="margin-bottom:12px">Sign-up is not open to the public: create each account here, then give the person their email and password. They can sign in at once. The profile decides which disciplines their study sets can use.</p>
  <form id="acc" class="row" autocomplete="off">
    <div><label for="acc-name">Name</label><input id="acc-name" name="name" required maxlength="100"></div>
    <div><label for="acc-email">Email</label><input id="acc-email" name="email" type="email" required maxlength="254"></div>
    <div><label for="acc-pw">Password <span class="muted" style="font-weight:400">(at least 10 characters)</span></label><input id="acc-pw" name="password" type="text" required minlength="10" maxlength="200" autocomplete="new-password" spellcheck="false"></div>
    <div><label for="acc-profile">Profile</label><select id="acc-profile" name="profileId" required></select></div>
  </form>
  <div class="actions"><button class="primary" form="acc" type="submit" id="acc-create">Create account</button><button type="button" id="acc-gen">Generate password</button></div>
  <p id="acc-msg" class="msg" role="status"></p>
  <div style="overflow-x:auto"><table aria-label="Accounts"><thead><tr><th>Email</th><th>Name</th><th>Profile</th><th>Created</th><th class="num">Study sets</th><th></th></tr></thead><tbody id="acc-rows"><tr><td colspan="6" class="muted">Loading…</td></tr></tbody></table></div>
</section>

<section class="card" aria-labelledby="prof-h">
  <h2 id="prof-h">Profiles &amp; disciplines</h2>
  <p class="muted" style="margin-bottom:12px">Each account belongs to one profile. Its users can only create study sets in the profile's disciplines, unless the profile allows any discipline.</p>
  <div id="prof-list" class="profiles"><p class="muted">Loading…</p></div>
  <form id="prof-new" class="row" style="margin-top:16px" autocomplete="off">
    <div><label for="prof-name">New profile</label><input id="prof-name" required minlength="2" maxlength="80" placeholder="e.g. Medicine"></div>
    <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0 0 9px"><input type="checkbox" id="prof-any"> Any discipline</label>
      <button type="submit">Create profile</button>
    </div>
  </form>
  <p id="prof-msg" class="msg" role="status"></p>
</section>

<form method="post" action="/admin/logout" style="text-align:right"><button type="submit">Sign out</button></form>
</main>

<dialog id="restart-dlg" aria-labelledby="dlg-h">
  <h2 id="dlg-h">LectureForge is shut down</h2>
  <p class="muted" style="margin:4px 0 12px">All its services are stopped and their memory and CPU are released. To start it again from a terminal:</p>
  <p style="margin-bottom:10px"><strong id="dlg-where"></strong> — project directory: <code id="dlg-dir"></code></p>
  <ol id="dlg-steps" class="steps"></ol>
  <p class="muted" id="dlg-alt" style="margin-top:10px"></p>
  <div class="actions" style="justify-content:flex-end"><button class="primary" id="dlg-close" type="button">Close</button></div>
</dialog>
<script>
const H = { "Content-Type": "application/json", "X-Requested-With": "lectureforge-admin" };
const $ = (id) => document.getElementById(id);
const mb = (b) => b == null ? "—" : b >= 1073741824 ? (b / 1073741824).toFixed(2) + " GB" : Math.round(b / 1048576) + " MB";
let settingsLoaded = false, busy = false;

async function refresh() {
  let s;
  try {
    const r = await fetch("/admin/api/status", { cache: "no-store" });
    if (r.status === 401) return location.reload();
    s = await r.json();
  } catch { return; }
  busy = Boolean(s.job.action);
  const label = busy ? s.job.action + "…" : s.overall;
  $("overall").textContent = { running: "Running", stopped: "Stopped", partial: "Partly running" }[label] || label.charAt(0).toUpperCase() + label.slice(1);
  $("overall").className = "pill " + (busy ? "busy" : s.overall);
  $("b-start").disabled = busy || s.overall === "running";
  $("b-restart").disabled = busy || s.overall === "stopped";
  $("b-stop").disabled = busy || s.overall === "stopped";
  const used = s.services.reduce((n, x) => n + (x.running && x.memory ? x.memory : 0), 0) + (s.ollama || []).reduce((n, m) => n + m.memory, 0);
  const h = s.host;
  $("host").innerHTML = "Server memory: " + mb(h.totalMemory - h.freeMemory) + " used of " + mb(h.totalMemory) + " (" + mb(h.freeMemory) + " free) · " + h.cpus + " CPUs" +
    " · LectureForge uses " + mb(used) + '<div class="meter"><div style="width:' + Math.round((1 - h.freeMemory / h.totalMemory) * 100) + '%"></div></div>';
  const rows = s.services.map((x) => "<tr><td>" + x.label + (x.detail ? ' <span class="muted">' + x.detail + "</span>" : "") + '</td><td><span class="pill ' + (x.running ? "running" : "stopped") + '">' + (x.running ? "running" : "stopped") + '</span></td><td class="num">' + (x.running ? mb(x.memory) : "—") + '</td><td class="num">' + (x.running && x.cpu != null ? x.cpu.toFixed(1) + " %" : "—") + "</td></tr>");
  for (const m of s.ollama || []) rows.push('<tr><td>Ollama model ' + m.name + ' <span class="muted">unloaded on shutdown</span></td><td><span class="pill running">loaded</span></td><td class="num">' + mb(m.memory) + '</td><td class="num">—</td></tr>');
  if (s.dockerError) rows.unshift('<tr><td colspan="4" class="msg err">' + s.dockerError + "</td></tr>");
  $("rows").innerHTML = rows.join("") || '<tr><td colspan="4" class="muted">No services found.</td></tr>';
  $("log").textContent = s.job.log.map((l) => new Date(l.at).toLocaleTimeString() + "  " + l.text).join("\\n");
  renderRestart(s.restart);
  $("b-howto").hidden = !(s.overall === "stopped" && !busy);
  // Pop up the restart instructions once, when a shutdown has just finished.
  const done = s.job.lastAction === "stop" && !s.job.error && s.job.finishedAt;
  // Counted as seen only once the user closes it (Close or Escape), so it is
  // shown even if the page was in the background when the shutdown finished.
  shutdownAt = done ? s.job.finishedAt : null;
  if (done && s.overall === "stopped" && !busy && seenShutdown() !== s.job.finishedAt) openRestart();
  if (!settingsLoaded) {
    $("aiModel").value = s.settings.aiModel;
    $("aiEffort").value = s.settings.aiEffort;
    settingsLoaded = true;
  }
}

for (const b of document.querySelectorAll("[data-action]")) {
  b.addEventListener("click", async () => {
    const a = b.dataset.action;
    if (a !== "start" && !confirm(a === "stop" ? "Shut down LectureForge? Everyone using it is disconnected until it is started again." : "Restart LectureForge? Users are disconnected for about a minute.")) return;
    const r = await fetch("/admin/api/action", { method: "POST", headers: H, body: JSON.stringify({ action: a }) });
    if (!r.ok) alert((await r.json()).error);
    refresh();
  });
}

$("ai").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/admin/api/settings", { method: "POST", headers: H, body: JSON.stringify({ aiModel: $("aiModel").value, aiEffort: $("aiEffort").value }) });
  const j = await r.json();
  $("ai-msg").className = "msg " + (r.ok ? "ok" : "err");
  $("ai-msg").textContent = r.ok ? "Saved. New generations use " + $("aiModel").selectedOptions[0].text + " with " + $("aiEffort").value + " effort." : j.error;
});

function seenShutdown() {
  try { return sessionStorage.getItem("lf-shutdown-seen"); } catch { return window.__lfSeen || null; }
}
function markShutdownSeen(v) {
  window.__lfSeen = v;
  try { sessionStorage.setItem("lf-shutdown-seen", v); } catch {}
}
let restartKey = "";
function renderRestart(r) {
  const key = JSON.stringify(r);
  if (key === restartKey) return; // keep the dialog stable while it is open
  restartKey = key;
  $("dlg-where").textContent = r.where;
  $("dlg-dir").textContent = r.dir;
  $("dlg-alt").textContent = r.alternative;
  $("dlg-steps").innerHTML = r.steps.map((st, i) =>
    "<li>" + escHtml(st.text) + '<div class="cmd"><code>' + escHtml(st.command) + '</code><button type="button" data-copy="' + i + '">Copy</button></div></li>').join("");
  for (const b of $("dlg-steps").querySelectorAll("[data-copy]")) {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.steps[Number(b.dataset.copy)].command);
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy"), 1500);
      } catch { b.textContent = "Select and copy"; }
    });
  }
}
function openRestart() {
  const d = $("restart-dlg");
  if (!d.open) d.showModal();
}
let shutdownAt = null;
const dismissRestart = () => {
  if (shutdownAt) markShutdownSeen(shutdownAt);
  $("restart-dlg").close();
};
$("b-howto").addEventListener("click", openRestart);
$("dlg-close").addEventListener("click", dismissRestart);
$("restart-dlg").addEventListener("cancel", () => shutdownAt && markShutdownSeen(shutdownAt)); // Escape

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let profiles = [];

/** Calls the app's admin routes through this service. */
async function app(method, path, body) {
  const r = await fetch("/admin/api/app/" + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ").");
  return j;
}
function say(id, ok, text) {
  $(id).className = "msg " + (ok ? "ok" : "err");
  $(id).textContent = text;
}

function profileOptions(selected) {
  return profiles.map((p) => '<option value="' + p.id + '"' + (p.id === selected ? " selected" : "") + ">" + escHtml(p.name) + "</option>").join("");
}

async function loadProfiles() {
  try {
    profiles = (await app("GET", "profiles")).profiles;
  } catch (err) {
    $("prof-list").innerHTML = '<p class="muted">' + escHtml(err.message) + "</p>";
    return;
  }
  const keep = $("acc-profile").value;
  $("acc-profile").innerHTML = '<option value="">Choose…</option>' + profileOptions(keep);
  $("prof-list").innerHTML = profiles
    .map(
      (p) =>
        '<div class="profile"><div class="profile-head"><strong>' + escHtml(p.name) + '</strong> <span class="muted">' + p.users + " account" + (p.users === 1 ? "" : "s") + "</span>" +
        (p.anyDiscipline ? ' <span class="pill running">Any discipline</span>' : "") +
        '<button type="button" class="small" data-del-profile="' + p.id + '"' + (p.users ? ' disabled title="Move its accounts to another profile first"' : "") + ">Delete profile</button></div>" +
        '<div class="chips">' +
        (p.disciplines.length
          ? p.disciplines.map((d) => '<span class="chip">' + escHtml(d.name) + '<button type="button" aria-label="Remove ' + escHtml(d.name) + '" data-del-disc="' + d.id + '">×</button></span>').join("")
          : '<span class="muted">' + (p.anyDiscipline ? "No list: users may enter any discipline; the other profiles' disciplines are offered as suggestions." : "No disciplines yet.") + "</span>") +
        "</div>" +
        '<form class="add-disc" data-profile="' + p.id + '"><input name="d" required minlength="2" maxlength="120" placeholder="Add a discipline" aria-label="Add a discipline to ' + escHtml(p.name) + '"><button type="submit" class="small">Add</button></form></div>',
    )
    .join("");
}

async function loadAccounts() {
  let accounts;
  try {
    accounts = (await app("GET", "users")).accounts;
  } catch (err) {
    $("acc-rows").innerHTML = '<tr><td colspan="6" class="muted">' + escHtml(err.message) + "</td></tr>";
    return;
  }
  $("acc-rows").innerHTML =
    accounts
      .map(
        (a) =>
          "<tr><td>" + escHtml(a.email) + "</td><td>" + escHtml(a.name) + "</td>" +
          '<td><select data-user-profile="' + a.id + '" aria-label="Profile of ' + escHtml(a.email) + '">' + (a.profile ? "" : '<option value="">—</option>') + profileOptions(a.profile && a.profile.id) + "</select></td>" +
          "<td>" + new Date(a.createdAt).toLocaleDateString() + '</td><td class="num">' + a.studySets + "</td>" +
          '<td><button type="button" class="small danger" data-del-user="' + a.id + '" data-email="' + escHtml(a.email) + '" data-sets="' + a.studySets + '">Delete</button></td></tr>',
      )
      .join("") || '<tr><td colspan="6" class="muted">No accounts yet.</td></tr>';
}

async function loadAll() {
  await loadProfiles();
  await loadAccounts();
}

$("acc-gen").addEventListener("click", () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  $("acc-pw").value = Array.from(bytes, (b) => abc[b % abc.length]).join("");
});

$("acc").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("acc-create").disabled = true;
  try {
    const j = await app("POST", "users", { name: $("acc-name").value.trim(), email: $("acc-email").value.trim(), password: $("acc-pw").value, profileId: $("acc-profile").value });
    say("acc-msg", true, "Account created for " + j.email + ". Share the password with them securely.");
    $("acc").reset();
    await loadAll();
  } catch (err) {
    say("acc-msg", false, err.message);
  } finally {
    $("acc-create").disabled = false;
  }
});

// Delegated handlers: the tables are re-rendered after each change.
document.addEventListener("change", async (e) => {
  const sel = e.target.closest && e.target.closest("[data-user-profile]");
  if (!sel || !sel.value) return;
  try {
    await app("PATCH", "users/" + sel.dataset.userProfile, { profileId: sel.value });
    say("acc-msg", true, "Profile changed.");
    await loadAll();
  } catch (err) {
    say("acc-msg", false, err.message);
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target.closest && e.target.closest("[data-del-user],[data-del-profile],[data-del-disc]");
  if (!t) return;
  try {
    if (t.dataset.delUser) {
      const sets = Number(t.dataset.sets);
      if (!confirm("Delete the account " + t.dataset.email + "?\\n\\nThis permanently deletes the account" + (sets ? ", its " + sets + " study set" + (sets === 1 ? "" : "s") + " and all their uploaded files" : "") + ". It cannot be undone.")) return;
      const j = await app("DELETE", "users/" + t.dataset.delUser);
      say("acc-msg", true, "Deleted " + (j.email || "the account") + (j.objectsRemoved ? " and " + j.objectsRemoved + " stored file" + (j.objectsRemoved === 1 ? "" : "s") : "") + ".");
    } else if (t.dataset.delProfile) {
      if (!confirm("Delete this profile and its disciplines?")) return;
      await app("DELETE", "profiles/" + t.dataset.delProfile);
      say("prof-msg", true, "Profile deleted.");
    } else {
      await app("DELETE", "disciplines/" + t.dataset.delDisc);
      say("prof-msg", true, "Discipline removed. Existing study sets keep their discipline.");
    }
    await loadAll();
  } catch (err) {
    say(t.dataset.delUser ? "acc-msg" : "prof-msg", false, err.message);
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target.closest && e.target.closest(".add-disc");
  if (!f) return;
  e.preventDefault();
  try {
    await app("POST", "profiles/" + f.dataset.profile + "/disciplines", { name: f.elements.d.value.trim() });
    say("prof-msg", true, "Discipline added.");
    await loadProfiles();
  } catch (err) {
    say("prof-msg", false, err.message);
  }
});

$("prof-new").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await app("POST", "profiles", { name: $("prof-name").value.trim(), anyDiscipline: $("prof-any").checked });
    say("prof-msg", true, "Profile created. Add its disciplines below.");
    $("prof-new").reset();
    await loadAll();
  } catch (err) {
    say("prof-msg", false, err.message);
  }
});

refresh();
loadAll();
setInterval(() => refresh(), busy ? 1500 : 4000);
setInterval(() => busy && refresh(), 1500);
</script>`;
}
