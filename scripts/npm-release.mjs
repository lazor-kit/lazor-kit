#!/usr/bin/env node
// npm side of .github/workflows/release.yml. Plain Node with no dependencies, so the
// publish job can run it without installing the workspace.
//
//   check
//       Lists public workspace packages whose version is not on npm yet. Writes
//       `unpublished=true|false` and `packages=<name@version ...>` to $GITHUB_OUTPUT.
//   pack <dir>
//       For each unpublished package: runs its prepublishOnly script, then `pnpm pack`
//       into <dir>, and records the tarballs in <dir>/manifest.json. This is what
//       `pnpm publish` did before it handed the tarball to npm.
//   publish <dir> [--dry-run]
//       Runs `npm publish <tarball> --ignore-scripts --provenance` for each tarball in
//       <dir>/manifest.json that is still unpublished. Authentication is npm trusted
//       publishing (OIDC); no token is read. For each published package it creates the
//       git tag <name>@<version> and prints `New tag: <name>@<version>`, which
//       changesets/action reads to push the tag and create the GitHub release.
//   sync-dist-tags [--dry-run]
//       Points dist-tags that must follow a stable release (wallet's `beta`) at the
//       local version once that version is on npm.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dist-tags that are kept on the latest stable version after each release.
const FOLLOW_STABLE = [{ name: "@lazorkit/wallet", dir: "packages/react", tags: ["beta"] }];

// How long to wait for a just-published version to show up in `npm view`.
const VISIBILITY_ATTEMPTS = 20;
const VISIBILITY_DELAY_MS = 15_000;

const log = (...args) => console.error(...args);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function exec(cmd, args, { cwd = ROOT } = {}) {
  log(`$ ${cmd} ${args.join(" ")}${cwd === ROOT ? "" : `  (in ${path.relative(ROOT, cwd)})`}`);
  // stdout goes to stderr so that only `New tag:` lines reach this script's stdout.
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", process.stderr, "inherit"] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function capture(cmd, args, { cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw r.error;
  return r;
}

// Like exec, but also returns the combined output and does not throw on failure.
function execTee(cmd, args) {
  log(`$ ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output += chunk;
        process.stderr.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function npmJson(args) {
  const r = capture("npm", [...args, "--json"]);
  let data;
  try {
    data = r.stdout.trim() ? JSON.parse(r.stdout) : undefined;
  } catch {
    data = undefined;
  }
  return { status: r.status, data, stderr: r.stderr };
}

// npm 12 wraps successful `npm view --json` output in an array; npm 11 does not.
const unwrap = (data) => (Array.isArray(data) ? data[0] : data);

function isPublished({ name, version }) {
  const r = npmJson(["view", `${name}@${version}`, "version", "--prefer-online"]);
  if (r.status === 0) return unwrap(r.data) === version;
  // E404 covers both "no such version" and "no such package".
  if (r.data?.error?.code === "E404") return false;
  throw new Error(
    `npm view ${name}@${version} failed (exit ${r.status}): ${r.data?.error?.summary ?? r.stderr.trim()}`,
  );
}

async function waitUntilPublished(pkg) {
  for (let attempt = 1; attempt <= VISIBILITY_ATTEMPTS; attempt++) {
    if (isPublished(pkg)) return true;
    if (attempt < VISIBILITY_ATTEMPTS) {
      log(`${pkg.name}@${pkg.version} is not visible on npm yet; retrying (${attempt}/${VISIBILITY_ATTEMPTS})`);
      await new Promise((r) => setTimeout(r, VISIBILITY_DELAY_MS));
    }
  }
  return false;
}

function publicPackages() {
  const r = capture("pnpm", ["ls", "-r", "--depth", "-1", "--json"]);
  if (r.status !== 0) throw new Error(`pnpm ls failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout)
    .map((p) => ({ dir: path.relative(ROOT, p.path), manifest: readJson(path.join(p.path, "package.json")) }))
    .filter(({ manifest }) => !manifest.private && manifest.name && manifest.version)
    .map(({ dir, manifest }) => ({ name: manifest.name, version: manifest.version, dir }));
}

function unpublishedPackages() {
  const pending = [];
  for (const pkg of publicPackages()) {
    const published = isPublished(pkg);
    log(`${pkg.name}@${pkg.version}: ${published ? "already on npm" : "not on npm"}`);
    if (!published) pending.push(pkg);
  }
  return pending;
}

function setOutput(key, value) {
  log(`output: ${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function tarballManifest(file) {
  const r = capture("tar", ["-xzOf", file, "package/package.json"]);
  if (r.status !== 0) throw new Error(`cannot read package/package.json from ${file}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

function expectSame(what, actual, pkg) {
  if (actual.name !== pkg.name || actual.version !== pkg.version) {
    throw new Error(`${what} is ${actual.name}@${actual.version}, expected ${pkg.name}@${pkg.version}`);
  }
}

// The dist-tag for new versions: the pre-release tag in Changesets pre mode, otherwise
// npm's default (`latest`). Not passing --tag for `latest` keeps npm's own check that
// refuses to move `latest` back to a lower version.
function preReleaseTag() {
  const file = path.join(ROOT, ".changeset", "pre.json");
  if (!existsSync(file)) return undefined;
  const state = readJson(file);
  return state.mode === "pre" ? state.tag : undefined;
}

// Compares X.Y.Z[-pre] versions; enough for dist-tag ordering.
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split("+")[0].split(/-(.*)/s);
    return { nums: core.split(".").map(Number), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === undefined) return 1;
  if (pb.pre === undefined) return -1;
  return pa.pre.localeCompare(pb.pre, "en", { numeric: true });
}

function check() {
  const pending = unpublishedPackages();
  setOutput("unpublished", pending.length > 0 ? "true" : "false");
  setOutput("packages", pending.map((p) => `${p.name}@${p.version}`).join(" "));
}

function pack(outDir) {
  if (!outDir) throw new Error("usage: pack <dir>");
  outDir = path.resolve(outDir);
  mkdirSync(outDir, { recursive: true });
  const manifest = [];
  for (const pkg of unpublishedPackages()) {
    const cwd = path.join(ROOT, pkg.dir);
    exec("pnpm", ["run", "--if-present", "prepublishOnly"], { cwd });
    exec("pnpm", ["pack", "--pack-destination", outDir], { cwd });
    const tarball = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
    const file = path.join(outDir, tarball);
    if (!existsSync(file)) throw new Error(`pnpm pack did not produce ${file}`);
    expectSame(`${tarball}/package/package.json`, tarballManifest(file), pkg);
    manifest.push({ ...pkg, tarball });
  }
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`packed ${manifest.length} package(s) into ${outDir}`);
}

async function publish(dir, { dryRun }) {
  if (!dir) throw new Error("usage: publish <dir> [--dry-run]");
  dir = path.resolve(dir);
  const manifest = readJson(path.join(dir, "manifest.json"));
  const tag = preReleaseTag();
  const published = [];
  const failed = [];

  for (const pkg of manifest) {
    const file = path.join(dir, pkg.tarball);
    expectSame(`${pkg.dir}/package.json`, readJson(path.join(ROOT, pkg.dir, "package.json")), pkg);
    expectSame(`${pkg.tarball}/package/package.json`, tarballManifest(file), pkg);
    if (isPublished(pkg)) {
      log(`${pkg.name}@${pkg.version} is already on npm; skipping`);
      continue;
    }
    const args = ["publish", file, "--ignore-scripts", "--access", "public", "--provenance"];
    if (tag) args.push("--tag", tag);
    if (dryRun) args.push("--dry-run");
    const { code, output } = await execTee("npm", args);
    if (code === 0) {
      published.push(pkg);
    } else if (/previously published version/i.test(output)) {
      log(`${pkg.name}@${pkg.version} was published already (stale registry read); skipping`);
    } else {
      failed.push(pkg);
    }
  }

  for (const pkg of published) {
    const gitTag = `${pkg.name}@${pkg.version}`;
    if (dryRun) {
      log(`[dry-run] would create git tag ${gitTag}`);
      continue;
    }
    if (capture("git", ["tag", "-l", gitTag]).stdout.trim() === "") {
      // Annotated, like `changeset publish` creates them.
      exec("git", ["tag", gitTag, "-m", gitTag]);
    }
    // changesets/action matches this line to push the tag and create the GitHub release.
    console.log(`New tag: ${gitTag}`);
  }

  if (failed.length > 0) {
    log(`failed to publish: ${failed.map((p) => `${p.name}@${p.version}`).join(", ")}`);
    process.exitCode = 1;
  }
}

async function syncDistTags({ dryRun }) {
  for (const { name, dir, tags } of FOLLOW_STABLE) {
    const { version } = readJson(path.join(ROOT, dir, "package.json"));
    if (version.includes("-")) {
      log(`${name}@${version} is a pre-release; leaving ${tags.join(", ")} alone`);
      continue;
    }
    if (!(await waitUntilPublished({ name, version }))) {
      log(`${name}@${version} is not on npm; nothing to sync`);
      continue;
    }
    const r = npmJson(["view", name, "dist-tags", "--prefer-online"]);
    if (r.status !== 0) throw new Error(`npm view ${name} dist-tags failed: ${r.stderr.trim()}`);
    const distTags = unwrap(r.data) ?? {};
    for (const tag of tags) {
      const current = distTags[tag];
      if (current === version) {
        log(`${name}: ${tag} is already ${version}`);
      } else if (current && compareVersions(current, version) > 0) {
        log(`${name}: ${tag} is ${current}, ahead of ${version}; leaving it`);
      } else if (dryRun) {
        log(`[dry-run] npm dist-tag add ${name}@${version} ${tag} (currently ${current ?? "unset"})`);
      } else {
        exec("npm", ["dist-tag", "add", `${name}@${version}`, tag]);
      }
    }
  }
}

const [command, ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");
const [arg] = rest.filter((a) => a !== "--dry-run");

try {
  switch (command) {
    case "check":
      check();
      break;
    case "pack":
      pack(arg);
      break;
    case "publish":
      await publish(arg, { dryRun });
      break;
    case "sync-dist-tags":
      await syncDistTags({ dryRun });
      break;
    default:
      throw new Error("usage: npm-release.mjs check | pack <dir> | publish <dir> [--dry-run] | sync-dist-tags [--dry-run]");
  }
} catch (err) {
  log(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
