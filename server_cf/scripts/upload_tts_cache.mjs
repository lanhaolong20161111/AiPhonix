/** Upload only the pre-generated TTS cache to production R2.
 * Usage:
 *   node scripts/upload_tts_cache.mjs --dry-run
 *   node scripts/upload_tts_cache.mjs
 *
 * The script deliberately does not use scripts/upload_r2.ps1 because that script
 * uploads all shared/data (several GB of unrelated media). This uploader is
 * limited to data/tts_char, data/tts_english, and the English index.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const serverDir = process.cwd();
const aip = path.resolve(serverDir, "..");
const sharedData = path.join(aip, "shared", "data");
const bucket = process.env.R2_BUCKET ?? "aiphonix-files";
const concurrency = Math.max(1, Number(process.env.UPLOAD_CONCURRENCY ?? 8));
const dryRun = process.argv.includes("--dry-run");

const jobs = [];
function addDir(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (!st.isFile()) continue;
    if (!name.endsWith(".mp3") && name !== "index.json") continue;
    jobs.push({ file: p, key: `${prefix}/${name}`, bytes: st.size });
  }
}
addDir(path.join(sharedData, "tts_char"), "data/tts_char");
addDir(path.join(sharedData, "tts_english", "words"), "data/tts_english/words");
addDir(path.join(sharedData, "tts_english", "sentences"), "data/tts_english/sentences");
addDir(path.join(sharedData, "tts_english"), "data/tts_english"); // index.json only; mp3 are in subdirs
const unique = new Map(jobs.map((j) => [j.key, j]));
const work = [...unique.values()].sort((a, b) => a.key.localeCompare(b.key));
const totalBytes = work.reduce((n, j) => n + j.bytes, 0);

console.log(`R2 bucket: ${bucket}`);
console.log(`任务: ${work.length} 个 / ${(totalBytes / 1024 / 1024).toFixed(2)} MB / 并发 ${concurrency}`);
if (dryRun) {
  for (const j of work.slice(0, 10)) console.log(`  ${j.key} (${j.bytes} B)`);
  console.log(work.length > 10 ? `  ... 其余 ${work.length - 10} 个` : "");
  process.exit(0);
}

const wranglerJs = path.join(serverDir, "node_modules", "wrangler", "bin", "wrangler.js");
if (!fs.existsSync(wranglerJs)) throw new Error(`找不到 Wrangler: ${wranglerJs}`);

let next = 0;
let done = 0;
let failed = [];
function upload(job) {
  return new Promise((resolve) => {
    const args = [wranglerJs, "r2", "object", "put", `${bucket}/${job.key}`, "--file", job.file, "--remote", "--content-type", job.key.endsWith(".json") ? "application/json" : "audio/mpeg"];
    const child = spawn(process.execPath, args, { cwd: serverDir, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("close", (code) => {
      done++;
      if (code !== 0) failed.push({ job, code, err: err.trim().slice(-500) });
      if (done % 100 === 0 || code !== 0) console.log(`[${done}/${work.length}] ${code === 0 ? "✓" : "✗"} ${job.key}`);
      resolve();
    });
    child.on("error", (e) => {
      done++;
      failed.push({ job, code: -1, err: e.message });
      console.log(`[${done}/${work.length}] ✗ ${job.key} (${e.message})`);
      resolve();
    });
  });
}
async function worker() {
  while (true) {
    const i = next++;
    if (i >= work.length) return;
    await upload(work[i]);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
console.log(`完成: ${done}/${work.length}，失败: ${failed.length}`);
if (failed.length) {
  fs.writeFileSync(path.join(serverDir, "tts_upload_failures.json"), JSON.stringify(failed, null, 2));
  console.log("失败清单: tts_upload_failures.json");
  process.exit(1);
}
