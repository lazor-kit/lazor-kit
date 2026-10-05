#!/usr/bin/env node
// npm side of .github/workflows/release.yml. Plain Node with no dependencies, so the
// publish job can run it without installing the workspace.
//
//   check
//       Lists public workspace packages whose current version is not finished: not on
//       npm yet, or on npm without its <name>@<version> tag on origin (a publish that
//       failed before tagging). Writes `pending=true|false` and
//       `packages=<name@version ...>` to $GITHUB_OUTPUT.
//   pack <dir>
//       For each package in $PACKAGES (the `packages` output of `check`): runs its
//       prepublishOnly script, then `pnpm pack` into <dir>, and records the tarballs in
//       <dir>/manifest.json. This is what `pnpm publish` did before it handed the
//       tarball to npm.
//   publish <dir> [--dry-run]
//       Runs `npm publish <tarball> --ignore-scripts --provenance` for each package in
//       <dir>/manifest.json that is not on npm yet. Authentication is npm trusted
//       publishing (OIDC); no token is read. Then, for each of those packages that is on
//       npm but has no tag on origin, it creates the git tag <name>@<version> and prints
//       `New tag: <name>@<version>`, which changesets/action reads to push the tag and
//       create the GitHub release. A package that fails does not stop the others.
//   sync-dist-tags <dir> [--dry-run]
//       Points dist-tags that must follow a stable release (wallet's `beta`) at the
//       local version once that version is on npm. Waits for the registry only when
//       `publish <dir>` published that version in this job.
//   oidc-check <name...>
//       Proves that npm trusted publishing works in this job without publishing: packs
//       the latest published version of each package and runs `npm publish --dry-run`
//       on it. npm exchanges the OIDC token before it notices the version exists.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dist-tags that are kept on the latest stable version after each release.
const FOLLOW_STABLE = [{ name: "@lazorkit/wallet", dir: "packages/react", tags: ["beta"] }];

// How long to wait for a just-published version to show up in `npm view`.
const VISIBILITY_ATTEMPTS = 20;
const VISIBILITY_DELAY_MS = 15_000;

// Written by `publish`: the versions npm accepted in this job.
const ACCEPTED_FILE = "npm-published.json";

const log = (...args) => console.error(...args);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const specOf = (pkg) => `${pkg.name}@${pkg.version}`;

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

// Trusted publishing needs npm 11.5.1+, and `npm dist-tag` only uses OIDC from 11.21.0
// (or 12.2.0) on. Node 24 bundles an older npm, so the workflow installs 11.21.0.
function assertNpmSupportsOidc() {
  const version = capture("npm", ["--version"]).stdout.trim();
  const [major, minor] = version.split(".").map(Number);
  const ok = major === 11 ? minor >= 21 : major === 12 ? minor >= 2 : major > 12;
  if (!ok) throw new Error(`npm ${version} cannot use trusted publishing for dist-tags (need 11.21.0+ or 12.2.0+)`);
  log(`npm ${version}`);
}

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
      log(`${specOf(pkg)} is not visible on npm yet; retrying (${attempt}/${VISIBILITY_ATTEMPTS})`);
      await new Promise((r) => setTimeout(r, VISIBILITY_DELAY_MS));
    }
  }
  return false;
}

// Release tags are <name>@<version>, as `changeset publish` created them.
function hasRemoteTag(tag) {
  const r = capture("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`]);
  if (r.status === 0) return true;
  if (r.status === 2) return false; // --exit-code: no matching ref
  throw new Error(`git ls-remote origin refs/tags/${tag} failed (exit ${r.status}): ${r.stderr.trim()}`);
}

function publicPackages() {
  const r = capture("pnpm", ["ls", "-r", "--depth", "-1", "--json"]);
  if (r.status !== 0) throw new Error(`pnpm ls failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout)
    .map((p) => ({ dir: path.relative(ROOT, p.path), manifest: readJson(path.join(p.path, "package.json")) }))
    .filter(({ manifest }) => !manifest.private && manifest.name && manifest.version)
    .map(({ dir, manifest }) => ({ name: manifest.name, version: manifest.version, dir }));
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
    throw new Error(`${what} is ${actual.name}@${actual.version}, expected ${specOf(pkg)}`);
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
  const pending = [];
  for (const pkg of publicPackages()) {
    const onNpm = isPublished(pkg);
    const tagged = hasRemoteTag(specOf(pkg));
    log(`${specOf(pkg)}: ${onNpm ? "on npm" : "not on npm"}, ${tagged ? "tagged on origin" : "no tag on origin"}`);
    if (!onNpm || !tagged) pending.push(pkg);
  }
  setOutput("pending", pending.length > 0 ? "true" : "false");
  setOutput("packages", pending.map(specOf).join(" "));
}

function pack(outDir) {
  if (!outDir) throw new Error("usage: PACKAGES='<name@version ...>' pack <dir>");
  const wanted = (process.env.PACKAGES ?? "").split(/\s+/).filter(Boolean);
  if (wanted.length === 0) throw new Error("PACKAGES lists no packages");
  outDir = path.resolve(outDir);
  mkdirSync(outDir, { recursive: true });
  const workspace = new Map(publicPackages().map((p) => [specOf(p), p]));
  const manifest = [];
  for (const spec of wanted) {
    const pkg = workspace.get(spec);
    if (!pkg) throw new Error(`${spec} is not the current version of a public workspace package`);
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
  if (!dryRun) assertNpmSupportsOidc();
  dir = path.resolve(dir);
  const manifest = readJson(path.join(dir, "manifest.json"));
  const tag = preReleaseTag();
  const onNpm = []; // on npm now: published here, or earlier (e.g. by a failed attempt of this job)
  const accepted = []; // published by this run
  const failed = [];

  // One package's failure (a publish error, or a transient `npm view` error) must not keep
  // the others from being published or tagged.
  for (const pkg of manifest) {
    try {
      expectSame(`${pkg.dir}/package.json`, readJson(path.join(ROOT, pkg.dir, "package.json")), pkg);
      if (isPublished(pkg)) {
        log(`${specOf(pkg)} is already on npm; not publishing it again`);
        onNpm.push(pkg);
        continue;
      }
      const file = path.join(dir, pkg.tarball);
      expectSame(`${pkg.tarball}/package/package.json`, tarballManifest(file), pkg);
      const args = ["publish", file, "--ignore-scripts", "--access", "public", "--provenance"];
      if (tag) args.push("--tag", tag);
      if (dryRun) args.push("--dry-run");
      const { code, output } = await execTee("npm", args);
      if (code === 0) {
        accepted.push(pkg);
        onNpm.push(pkg);
      } else if (/previously published version/i.test(output)) {
        log(`${specOf(pkg)} was published already (stale registry read)`);
        onNpm.push(pkg);
      } else {
        failed.push(pkg);
      }
    } catch (err) {
      log(`${specOf(pkg)}: ${err instanceof Error ? err.message : err}`);
      failed.push(pkg);
    }
  }

  writeFileSync(path.join(dir, ACCEPTED_FILE), `${JSON.stringify(accepted.map(specOf))}\n`);

  // Tag what is on npm but not tagged on origin. That includes versions an earlier attempt
  // published but did not tag, so re-running the job finishes the tags and the releases. A
  // tag missing on origin also means changesets/action has not created its release yet.
  for (const pkg of onNpm) {
    const gitTag = specOf(pkg);
    try {
      if (hasRemoteTag(gitTag)) {
        log(`${gitTag} is already tagged on origin`);
        continue;
      }
      if (dryRun) {
        log(`[dry-run] would create git tag ${gitTag} and print New tag: ${gitTag}`);
        continue;
      }
      if (capture("git", ["tag", "-l", gitTag]).stdout.trim() === "") {
        // Annotated, like `changeset publish` creates them.
        exec("git", ["tag", gitTag, "-m", gitTag]);
      }
      // changesets/action matches this line to push the tag and create the GitHub release.
      console.log(`New tag: ${gitTag}`);
    } catch (err) {
      log(`${gitTag}: ${err instanceof Error ? err.message : err}`);
      failed.push(pkg);
    }
  }

  if (failed.length > 0) {
    log(`failed: ${failed.map(specOf).join(", ")}`);
    process.exitCode = 1;
  }
}

async function syncDistTags(dir, { dryRun }) {
  if (!dryRun) assertNpmSupportsOidc();
  const acceptedFile = dir ? path.join(path.resolve(dir), ACCEPTED_FILE) : undefined;
  const accepted = acceptedFile && existsSync(acceptedFile) ? readJson(acceptedFile) : [];
  for (const { name, dir: pkgDir, tags } of FOLLOW_STABLE) {
    const { version } = readJson(path.join(ROOT, pkgDir, "package.json"));
    const spec = `${name}@${version}`;
    if (version.includes("-")) {
      log(`${spec} is a pre-release; leaving ${tags.join(", ")} alone`);
      continue;
    }
    if (!isPublished({ name, version })) {
      // Only wait for the registry when this job published the version; otherwise (say,
      // the publish failed) there is nothing to wait for.
      if (!accepted.includes(spec)) {
        log(`${spec} is not on npm and was not published by this job; nothing to sync`);
        continue;
      }
      if (dryRun) {
        log(`[dry-run] would wait for ${spec} to appear on npm`);
        continue;
      }
      if (!(await waitUntilPublished({ name, version }))) {
        throw new Error(
          `${spec} was published but is still not visible on npm; re-run this job to sync ${tags.join(", ")}`,
        );
      }
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
        log(`[dry-run] npm dist-tag add ${spec} ${tag} (currently ${current ?? "unset"})`);
      } else {
        exec("npm", ["dist-tag", "add", spec, tag]);
      }
    }
  }
}

async function oidcCheck(names) {
  if (names.length === 0) throw new Error("usage: oidc-check <name...>");
  assertNpmSupportsOidc();
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error("no GitHub OIDC token available; run this in a job with `id-token: write`");
  }
  const tmp = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), "oidc-check-"));
  const failed = [];
  for (const name of names) {
    // The latest version is already on npm, so the dry run stops with "cannot publish over
    // the previously published versions", after the OIDC token exchange.
    const packed = npmJson(["pack", `${name}@latest`, "--pack-destination", tmp, "--ignore-scripts"]);
    const filename = unwrap(packed.data)?.filename;
    if (packed.status !== 0 || !filename) throw new Error(`npm pack ${name}@latest failed: ${packed.stderr.trim()}`);
    const file = path.join(tmp, filename);
    const { output } = await execTee("npm", [
      "publish", file, "--dry-run", "--ignore-scripts", "--access", "public", "--provenance", "--loglevel", "verbose",
    ]);
    if (/Successfully retrieved and set token/.test(output)) {
      log(`${name}: OIDC token exchange succeeded; npm accepts this job as a trusted publisher`);
    } else {
      log(`${name}: OIDC token exchange did not succeed; check the trusted publisher settings on npmjs.com`);
      failed.push(name);
    }
  }
  if (failed.length > 0) {
    log(`trusted publishing does not work for: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

const [command, ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");
const args = rest.filter((a) => a !== "--dry-run");

try {
  switch (command) {
    case "check":
      check();
      break;
    case "pack":
      pack(args[0]);
      break;
    case "publish":
      await publish(args[0], { dryRun });
      break;
    case "sync-dist-tags":
      await syncDistTags(args[0], { dryRun });
      break;
    case "oidc-check":
      await oidcCheck(args);
      break;
    default:
      throw new Error(
        "usage: npm-release.mjs check | pack <dir> | publish <dir> [--dry-run] | " +
          "sync-dist-tags <dir> [--dry-run] | oidc-check <name...>",
      );
  }
} catch (err) {
  log(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
