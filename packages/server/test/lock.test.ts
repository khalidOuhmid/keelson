import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { lockPathFor, withFileLock } from "../src/lock.ts";

let root = "";
let file = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "keelson-lock-"));
  file = join(root, ".gitlab-ci.yml");
  writeFileSync(file, "stages: [build]\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const lockFile = () => join(root, "..gitlab-ci.yml.keelson-lock");

const deadPid = (): number => {
  const child = spawnSync("node", ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  return Number(child.stdout);
};

describe("withFileLock", () => {
  test("returns the guarded value and leaves no lock file behind", async () => {
    expect(await withFileLock(root, file, async () => 42)).toBe(42);
    expect(readdirSync(root)).toEqual([".gitlab-ci.yml"]);
  });

  test("the lock file lives next to the target, hidden", async () => {
    expect(await lockPathFor(root, file)).toBe(lockFile());
    await withFileLock(root, file, async () => {
      expect(existsSync(lockFile())).toBe(true);
    });
  });

  test("a link and its target share one lock", async () => {
    const link = join(root, "link.yml");
    symlinkSync(file, link);
    expect(await lockPathFor(root, link)).toBe(lockFile());
  });

  test("an absent file in an absent directory is locked in that directory, created", async () => {
    const absent = join(root, ".devsecops", "toolchain.yaml");
    expect(await lockPathFor(root, absent)).toBe(
      join(root, ".devsecops", ".toolchain.yaml.keelson-lock"),
    );
    await withFileLock(root, absent, async () => undefined);
    expect(readdirSync(join(root, ".devsecops"))).toEqual([]);
  });

  test("a file outside the root gets no lock, and the guarded work still runs", async () => {
    const outside = mkdtempSync(join(tmpdir(), "keelson-lock-outside-"));
    symlinkSync(outside, join(root, "escape"));
    try {
      expect(await lockPathFor(root, join(root, "escape", "a.yml"))).toBeNull();
      expect(await withFileLock(root, join(root, "escape", "a.yml"), async () => "ran")).toBe(
        "ran",
      );
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("the lock is released when the guarded work throws", async () => {
    await expect(
      withFileLock(root, file, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockFile())).toBe(false);
  });

  test("two holders in one process run one after the other", async () => {
    const order: string[] = [];
    let release = () => {};
    const first = withFileLock(root, file, async () => {
      order.push("first:start");
      await new Promise<void>((settle) => {
        release = settle;
      });
      order.push("first:end");
    });
    await new Promise((settle) => setTimeout(settle, 20));
    const second = withFileLock(root, file, async () => {
      order.push("second");
    });
    await new Promise((settle) => setTimeout(settle, 60));
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  test("a lock left by a process that no longer exists is recovered", async () => {
    writeFileSync(
      lockFile(),
      JSON.stringify({ pid: deadPid(), host: hostname(), token: "dead", at: Date.now() }),
    );
    expect(await withFileLock(root, file, async () => "recovered", { timeoutMs: 500 })).toBe(
      "recovered",
    );
    expect(existsSync(lockFile())).toBe(false);
  });

  test("a lock older than the age limit is recovered even if its process is alive", async () => {
    writeFileSync(
      lockFile(),
      JSON.stringify({ pid: process.pid, host: hostname(), token: "old", at: 0 }),
    );
    const old = new Date(Date.now() - 120_000);
    utimesSync(lockFile(), old, old);
    expect(await withFileLock(root, file, async () => "recovered", { timeoutMs: 500 })).toBe(
      "recovered",
    );
  });

  test("an unreadable lock file is recovered once it is old", async () => {
    writeFileSync(lockFile(), "garbage");
    const old = new Date(Date.now() - 120_000);
    utimesSync(lockFile(), old, old);
    expect(await withFileLock(root, file, async () => "recovered", { timeoutMs: 500 })).toBe(
      "recovered",
    );
  });

  test("a fresh lock held by a live process is waited for, then times out", async () => {
    const holder = spawn(
      "node",
      [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(lockFile())}, JSON.stringify({ pid: process.pid, host: require("node:os").hostname(), token: "live", at: Date.now() })); process.stdout.write("held"); setTimeout(() => {}, 10000);`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((settle) => holder.stdout?.once("data", () => settle()));
      let ran = false;
      await expect(
        withFileLock(
          root,
          file,
          async () => {
            ran = true;
          },
          { timeoutMs: 200 },
        ),
      ).rejects.toThrow(/locked/);
      expect(ran).toBe(false);
      expect(existsSync(lockFile())).toBe(true);
    } finally {
      holder.kill();
    }
  });
});
