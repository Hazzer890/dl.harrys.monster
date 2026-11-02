import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_JOBS = 3; // ponytail: global cap, per-IP limits if it gets abused
const MAX_ITEMS = 50;
const TIMEOUT_MS = 60 * 60_000;
const COOKIES = process.env.COOKIES ?? "/secrets/cookies.txt"; // burner Google account, see README
const index = Bun.file(join(import.meta.dir, "index.html"));
const theme = Bun.file(join(import.meta.dir, "theme.css"));

type Job = { id: string; dir: string; t: number; pct: number | null; msg: string; title?: string; error?: string; file?: string };
const jobs = new Map<string, Job>();
let running = 0;

const fail = (status: number, error: string) => Response.json({ error }, { status });

async function eachLine(s: ReadableStream<Uint8Array>, f: (l: string) => void) {
  let buf = "";
  for await (const chunk of s.pipeThrough(new TextDecoderStream())) {
    const parts = (buf + chunk).split(/\r?\n|\r/);
    buf = parts.pop()!;
    parts.forEach(f);
  }
  if (buf) f(buf);
}

// Runs cmd in the job dir, feeding every output line to onLine. Returns the last ERROR line, if any.
async function run(job: Job, cmd: string[], onLine: (l: string) => void) {
  const p = Bun.spawn(cmd, { cwd: job.dir, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
  let err = "";
  await Promise.all([
    eachLine(p.stdout, onLine),
    eachLine(p.stderr, (l) => { onLine(l); if (l.startsWith("ERROR")) err = l.replace(/^ERROR:\s*/, ""); }),
  ]);
  const code = await p.exited;
  clearTimeout(timer);
  return code === 0 ? "" : err || (p.signalCode ? "Timed out" : "Conversion failed");
}

export function ytdlpArgs(url: string, format: string) {
  const fmt = format === "mp3"
    ? ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
    : ["-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4"];
  const cookies = existsSync(COOKIES) ? ["--cookies", COOKIES] : [];
  return ["yt-dlp", ...cookies, "--no-playlist", "-I", `:${MAX_ITEMS}`, "--ignore-errors", "--js-runtimes", "bun",
    "--max-filesize", "1G", "--embed-metadata", "--newline", "--no-colors",
    "--progress-template", "download:@@%(info.playlist_index)s|%(info.n_entries)s|%(progress._percent_str)s|%(info.playlist_title)s",
    ...fmt, "-o", "%(playlist_index&{} - |)s%(title).150B.%(ext)s", "--", url];
}

// Turns a yt-dlp output line into job progress.
export function ytdlpProgress(job: Job, l: string) {
  const m = l.match(/^@@(\S+)\|(\S+)\|\s*([\d.]+)%\|(.*)$/);
  if (m) {
    const i = Number(m[1]) || 1, n = Math.min(Number(m[2]) || 1, MAX_ITEMS);
    job.pct = ((i - 1) + Number(m[3]) / 100) / n * 100;
    job.msg = n > 1 ? `Downloading ${i} of ${n}` : "Downloading";
    if (m[4] !== "NA") job.title = m[4];
  } else if (/^\[(ExtractAudio|Merger|VideoConvertor)\]/.test(l)) {
    job.msg = job.msg.replace("Downloading", "Converting");
  }
}

async function finish(job: Job, err: string) {
  const files = (await readdir(job.dir)).filter((f) => f !== "in.bin" && !/\.(part|ytdl|temp\.\w+)$/.test(f));
  if (!files.length) throw new Error(err || "No output produced");
  if (files.length === 1) return (job.file = files[0]);
  job.msg = "Zipping";
  job.pct = null;
  const zip = `${(job.title ?? "playlist").replace(/[\/\\]/g, "_").slice(0, 150)}.zip`;
  await run(job, ["zip", "-0", "-q", zip, "--", ...files], () => {});
  job.file = zip;
}

async function start(job: Job, cmd: string[], onLine: (l: string) => void) {
  running++;
  try {
    await finish(job, await run(job, cmd, onLine));
    job.pct = 100;
    job.msg = "Done";
  } catch (e) {
    job.error = (e as Error).message;
  } finally {
    running--;
  }
}

async function create(req: Request, path: string) {
  if (path === "/api/url") {
    const { url: src, format } = await req.json().catch(() => ({}));
    let u: URL;
    try { u = new URL(src); } catch { return fail(400, "That isn't a valid link"); }
    if (!/^https?:$/.test(u.protocol)) return fail(400, "Link must start with http(s)://");
    if (format !== "mp3" && format !== "mp4") return fail(400, "Pick mp3 or mp4");
    const job = await newJob("Starting");
    start(job, ytdlpArgs(u.href, format), (l) => ytdlpProgress(job, l));
    return job;
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "No file uploaded");
  const base = file.name.replace(/\.[^.]*$/, "").replace(/[\/\\]/g, "_").slice(0, 150) || "audio";
  const job = await newJob("Converting");
  await Bun.write(join(job.dir, "in.bin"), file);
  let dur = 0;
  start(job, ["ffmpeg", "-nostdin", "-nostats", "-i", "in.bin", "-vn", "-c:a", "libmp3lame", "-q:a", "0",
    "-progress", "pipe:1", `${base}.mp3`], (l) => {
    const d = l.match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (d) dur = (+d[1] * 3600 + +d[2] * 60 + +d[3]) * 1e6;
    const t = l.match(/^out_time_us=(\d+)/);
    if (t && dur) job.pct = Math.min(100, (+t[1] / dur) * 100);
  });
  return job;
}

async function newJob(msg: string) {
  const job: Job = { id: crypto.randomUUID(), dir: await mkdtemp(join(tmpdir(), "dl-")), t: Date.now(), pct: null, msg };
  jobs.set(job.id, job);
  return job;
}

function drop(id: string) {
  const job = jobs.get(id);
  jobs.delete(id);
  if (job) void rm(job.dir, { recursive: true, force: true });
}

Bun.serve({
  port: PORT,
  maxRequestBodySize: 1024 ** 3,
  idleTimeout: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/") return new Response(index);
    if (req.method === "GET" && pathname === "/theme.css") return new Response(theme);

    if (req.method === "POST" && (pathname === "/api/url" || pathname === "/api/file")) {
      if (running >= MAX_JOBS) return fail(429, "Busy, try again in a minute");
      const res = await create(req, pathname);
      return res instanceof Response ? res : Response.json({ id: res.id });
    }

    const m = pathname.match(/^\/api\/jobs\/([\w-]+)(\/file)?$/);
    const job = m && jobs.get(m[1]);
    if (req.method !== "GET" || !job) return fail(404, "Not found");
    if (!m[2]) return Response.json({ pct: job.pct, msg: job.msg, error: job.error, done: !!job.file });
    if (!job.file) return fail(409, "Not ready");
    const file = Bun.file(join(job.dir, job.file));
    const body = file.stream().pipeThrough(new TransformStream({ flush: () => drop(m[1]) }));
    return new Response(body, {
      headers: {
        "Content-Type": file.type,
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.file)}`,
      },
    });
  },
});

// Drop jobs nobody collected, and anything older than the timeout.
setInterval(() => {
  for (const [id, job] of jobs) if (Date.now() - job.t > TIMEOUT_MS + 600_000) drop(id);
}, 600_000);

// YouTube breaks old yt-dlp releases often: self-update at boot and daily.
const update = () => Bun.spawn(["yt-dlp", "-U"], { stdout: "inherit", stderr: "inherit" });
update();
setInterval(update, 24 * 3600_000);

console.log(`dl listening on :${PORT}`);
