import { describe, expect, test } from "bun:test";
import { hashText, type ToolchainOperation } from "@keelson/core";
import { applyToolchain, parseToolchain } from "../src/index.ts";

const BASE = `# platform
version: 1

services:
  # the image registry
  nexus:
    tool: nexus # internal
    url: https://nexus.example.org

  vault:
    tool: vault

integrations:
  - job: build
    service: nexus
    kind: push

# end
`;

type Draft = ToolchainOperation extends infer O
  ? O extends ToolchainOperation
    ? Omit<O, "v" | "baseHash">
    : never
  : never;

function run(text: string, draft: Draft) {
  return applyToolchain(text, { v: 1, baseHash: hashText(text), ...draft } as ToolchainOperation);
}

function edited(text: string, draft: Draft): string {
  const result = run(text, draft);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.text;
}

function code(text: string, draft: Draft): string | null {
  const result = run(text, draft);
  return result.ok ? null : result.error.code;
}

const add = { kind: "addService", tool: "harbor", url: null, environment: null } as const;

describe("services", () => {
  test("adding creates the file from scratch", () => {
    expect(edited("", { ...add, id: "harbor" })).toBe(
      "version: 1\nservices:\n  harbor:\n    tool: harbor\n",
    );
  });

  test("adding keeps everything else, at the end of the section, at the indentation found", () => {
    const text = edited(BASE, { ...add, id: "harbor", url: "https://h", environment: "prod" });
    expect(text).toContain(
      "  vault:\n    tool: vault\n  harbor:\n    tool: harbor\n    url: https://h\n    environment: prod\n",
    );
    expect(text).toContain("# the image registry");
    expect(text).toContain("# end");
  });

  test("adding under an empty section or [] / {}", () => {
    for (const empty of ["services:\n", "services: {}\n"]) {
      expect(edited(`version: 1\n${empty}`, { ...add, id: "h" })).toBe(
        "version: 1\nservices:\n  h:\n    tool: harbor\n",
      );
    }
  });

  test("adding to a file without a trailing newline, and in CRLF", () => {
    expect(edited("version: 1", { ...add, id: "h" })).toBe(
      "version: 1\nservices:\n  h:\n    tool: harbor\n",
    );
    expect(edited("version: 1\r\n", { ...add, id: "h" })).toBe(
      "version: 1\r\nservices:\r\n  h:\r\n    tool: harbor\r\n",
    );
  });

  test("a booby-trapped URL stays a string", () => {
    const text = edited("", { ...add, id: "h", url: "a: b #c\nd" });
    expect(parseToolchain(text).toolchain.services[0]?.url).toBe("a: b #c\nd");
  });

  test("an integer id can be added: YAML does not keep that order in an object", () => {
    const text = edited(BASE, { ...add, id: "8080" });
    expect(parseToolchain(text).toolchain.services.map((service) => service.id)).toContain("8080");
  });

  test("a hand-written integer key can be edited and removed", () => {
    const text = "version: 1\nservices:\n  8080:\n    tool: x\n";
    expect(
      parseToolchain(edited(text, { kind: "updateService", id: "8080", url: "u" })).toolchain
        .services[0]?.url,
    ).toBe("u");
    expect(
      parseToolchain(edited(text, { kind: "removeService", id: "8080" })).toolchain.services,
    ).toEqual([]);
  });

  test("an id already taken or illegal is rejected", () => {
    expect(code(BASE, { ...add, id: "nexus" })).toBe("NAME_CONFLICT");
    expect(code(BASE, { ...add, id: "Bad Name" })).toBe("INVALID_NAME");
  });

  test("updating replaces the value and keeps the comment", () => {
    const text = edited(BASE, { kind: "updateService", id: "nexus", tool: "harbor" });
    expect(text).toContain("    tool: harbor # internal\n");
  });

  test("updating adds a missing field, and null removes it", () => {
    const text = edited(BASE, {
      kind: "updateService",
      id: "nexus",
      url: null,
      environment: "staging",
    });
    expect(text).toContain("    tool: nexus # internal\n    environment: staging\n");
    expect(text).not.toContain("url:");
  });

  test("updating a field without a value", () => {
    const text = "version: 1\nservices:\n  a:\n    tool: x\n    url:\n";
    expect(edited(text, { kind: "updateService", id: "a", url: "u" })).toBe(
      "version: 1\nservices:\n  a:\n    tool: x\n    url: u\n",
    );
  });

  test("changing nothing touches nothing", () => {
    const result = run(BASE, { kind: "updateService", id: "vault" });
    expect(result.ok && result.value.text).toBe(BASE);
    expect(result.ok && result.value.touched).toEqual([]);
  });

  test("removing deletes the block, not the neighbours' comments", () => {
    const text = edited(BASE.replace("    service: nexus\n", "    service: vault\n"), {
      kind: "removeService",
      id: "nexus",
    });
    expect(text).toContain("# the image registry\n\n  vault:");
    expect(text).not.toContain("nexus");
  });

  test("removing a linked service is rejected, naming the jobs", () => {
    const result = run(BASE, { kind: "removeService", id: "nexus" });
    expect(result.ok ? null : result.error).toEqual({
      code: "SERVICE_REFERENCED",
      params: { service: "nexus", jobs: ["build"] },
    });
  });

  test("an unknown service is rejected", () => {
    expect(code(BASE, { kind: "removeService", id: "x" })).toBe("SERVICE_NOT_FOUND");
    expect(code(BASE, { kind: "updateService", id: "x" })).toBe("SERVICE_NOT_FOUND");
  });
});

describe("integrations", () => {
  const link = {
    kind: "addIntegration",
    job: "b",
    service: "vault",
    integration: "notify",
  } as const;

  test("adding at the end of the list", () => {
    expect(edited(BASE, link)).toContain(
      "    kind: push\n  - job: b\n    service: vault\n    kind: notify\n",
    );
  });

  test("adding creates the missing section", () => {
    const text = "version: 1\nservices:\n  vault:\n    tool: vault\n";
    expect(edited(text, link)).toBe(
      `${text}integrations:\n  - job: b\n    service: vault\n    kind: notify\n`,
    );
  });

  test("keeps the indentation of a list at column zero", () => {
    const text =
      "version: 1\nservices:\n  vault:\n    tool: vault\nintegrations:\n- job: a\n  service: vault\n  kind: push\n";
    expect(edited(text, link)).toBe(`${text}- job: b\n  service: vault\n  kind: notify\n`);
  });

  test("a job with a booby-trapped name stays readable", () => {
    const text = edited(BASE, { ...link, job: "deploy: prod" });
    expect(parseToolchain(text).toolchain.integrations.at(-1)?.job).toBe("deploy: prod");
  });

  test("rejects an unknown service and a duplicate", () => {
    expect(code(BASE, { ...link, service: "x" })).toBe("SERVICE_NOT_FOUND");
    expect(
      code(BASE, { kind: "addIntegration", job: "build", service: "nexus", integration: "push" }),
    ).toBe("INTEGRATION_EXISTS");
  });

  test("removing deletes the item", () => {
    const text = edited(BASE, {
      kind: "removeIntegration",
      job: "build",
      service: "nexus",
      integration: "push",
    });
    expect(parseToolchain(text).toolchain.integrations).toEqual([]);
    expect(text).toContain("# end");
  });

  test("removing a missing item is rejected", () => {
    expect(code(BASE, { ...link, kind: "removeIntegration" })).toBe("INTEGRATION_NOT_FOUND");
  });

  test("dismissing then restoring an inference", () => {
    const dismiss = {
      kind: "dismissIntegration",
      job: "b",
      tool: "sentry",
      integration: "notify",
    } as const;
    const text = edited(BASE, dismiss);
    expect(parseToolchain(text).toolchain.dismissed).toEqual([
      { job: "b", tool: "sentry", kind: "notify" },
    ]);
    expect(code(text, dismiss)).toBe("INTEGRATION_EXISTS");
    expect(edited(text, { ...dismiss, kind: "restoreIntegration" })).toContain("dismissed:");
    expect(
      parseToolchain(edited(text, { ...dismiss, kind: "restoreIntegration" })).toolchain.dismissed,
    ).toEqual([]);
  });
});

describe("refusals", () => {
  test("a stale hash", () => {
    const result = applyToolchain(BASE, {
      v: 1,
      baseHash: "a".repeat(64),
      kind: "removeService",
      id: "vault",
    });
    expect(result.ok ? null : result.error.code).toBe("STALE_DOCUMENT");
  });

  test("an invalid file is not edited", () => {
    const result = run("version: 2\n", { ...add, id: "h" });
    expect(result.ok ? null : result.error).toEqual({
      code: "INVALID_OPERATION",
      params: { reason: "invalidToolchain" },
    });
  });

  test("a non-empty flow section is not rewritten", () => {
    const result = run("version: 1\nservices: {a: {tool: x}}\n", { ...add, id: "h" });
    expect(result.ok ? null : result.error).toEqual({
      code: "INVALID_OPERATION",
      params: { reason: "flowStyleToolchain", section: "services" },
    });
  });

  test("a flow service is not rewritten", () => {
    const text = "version: 1\nservices:\n  a: {tool: x}\n";
    expect(code(text, { kind: "updateService", id: "a", url: "u" })).toBe("INVALID_OPERATION");
  });

  test("an alias value is not rewritten", () => {
    const text = "version: 1\nservices:\n  a:\n    tool: &t x\n  b:\n    tool: *t\n";
    expect(code(text, { kind: "updateService", id: "b", tool: "y" })).toBe("INVALID_OPERATION");
  });
});

describe("hand-written files", () => {
  const BLOCK =
    "version: 1\nservices:\n  a:\n    tool: nexus\n    url: |\n      https://a\n  b:\n    tool: harbor\nintegrations:\n  - job: x\n    service: b\n    kind: push\n";

  test("removing a service with a block value keeps its neighbour", () => {
    const text = edited(BLOCK, { kind: "removeService", id: "a" });
    const { services, integrations } = parseToolchain(text).toolchain;
    expect(services.map((service) => service.id)).toEqual(["b"]);
    expect(integrations).toHaveLength(1);
  });

  test("removing the last service with a block value keeps the next section", () => {
    const text =
      "version: 1\nservices:\n  a:\n    tool: x\n    url: |\n      u\nintegrations:\n  - job: j\n    service: z\n    kind: push\n";
    expect(edited(text, { kind: "removeService", id: "a" })).toContain("integrations:");
  });

  test("a field removed after a block value does not touch the neighbour", () => {
    const text = edited(BLOCK, { kind: "updateService", id: "a", url: null });
    expect(parseToolchain(text).toolchain.services.map((service) => service.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("a field added after a block value stays in its service", () => {
    const text = edited(BLOCK, { kind: "updateService", id: "a", environment: "prod" });
    const [first, second] = parseToolchain(text).toolchain.services;
    expect(first?.environment).toBe("prod");
    expect(second?.environment).toBeNull();
  });

  test("replacing a block value keeps the following comment", () => {
    const text =
      "version: 1\nservices:\n  a:\n    tool: x\n    url: |\n      u\n    # note\n    environment: e\n";
    expect(edited(text, { kind: "updateService", id: "a", url: "v" })).toContain("    # note\n");
  });

  test("a list item with a block value keeps the next one", () => {
    const text = edited(
      BLOCK.replace("  - job: x\n", "  - job: |-\n      x\n").concat(
        "  - job: y\n    service: b\n    kind: push\n",
      ),
      {
        kind: "removeIntegration",
        job: "x",
        service: "b",
        integration: "push",
      },
    );
    expect(parseToolchain(text).toolchain.integrations.map((entry) => entry.job)).toEqual(["y"]);
  });

  test.each(["~", "null", "!!null", "&s"])("a section equal to %s is replaced", (token) => {
    const text = edited(`version: 1\nservices: ${token}\n`, { ...add, id: "h" });
    expect(parseToolchain(text).toolchain.services).toEqual([
      { id: "h", tool: "harbor", url: null, environment: null },
    ]);
    expect(text).not.toContain(token);
  });

  test("a comment on the section's line stays there", () => {
    expect(edited("version: 1\nservices: # platform\n", { ...add, id: "h" })).toBe(
      "version: 1\nservices: # platform\n  h:\n    tool: harbor\n",
    );
  });

  test("a space before the colon does not prevent writing", () => {
    const text = edited("version: 1\nservices :\n", { ...add, id: "h" });
    expect(parseToolchain(text).toolchain.services).toHaveLength(1);
  });

  test("touching an anchored value would change its aliases: rejected", () => {
    const text = "version: 1\nservices:\n  a: &base\n    tool: x\n  b: *base\n";
    const result = run(text, { kind: "updateService", id: "a", environment: "e" });
    expect(result.ok ? null : result.error).toMatchObject({
      code: "INVALID_OPERATION",
      params: { reason: "sharedValue" },
    });
    const scalar =
      "version: 1\nservices:\n  a:\n    tool: x\n    url: &u y\n  b:\n    tool: z\n    url: *u\n";
    expect(run(scalar, { kind: "updateService", id: "a", url: "w" })).toMatchObject({
      error: { params: { reason: "sharedValue" } },
    });
  });

  test("what the patch would change unintentionally is rejected on read-back", () => {
    const text = "version: 1\nservices:\n  a:\n    tool: x\n    url: |+\n      u\n\n";
    const result = run(text, { kind: "updateService", id: "a", environment: "e" });
    expect(result.ok ? null : result.error).toMatchObject({
      params: { reason: "wouldBreakYaml", operation: "updateService" },
    });
  });

  test("removing an anchor an alias depends on is rejected", () => {
    const text = "version: 1\nservices:\n  a: &base\n    tool: x\n  b: *base\n";
    expect(code(text, { kind: "removeService", id: "a" })).toBe("INVALID_OPERATION");
  });

  test("an alias service is not reported as flow", () => {
    const text = "version: 1\nservices:\n  a: &base\n    tool: x\n  b: *base\n";
    const result = run(text, { kind: "updateService", id: "b", url: "u" });
    expect(result.ok ? null : result.error).toMatchObject({ params: { reason: "sharedValue" } });
  });

  test.each(["a\u00a0", "--- x", "...", "x ".repeat(60).trim(), "\ufeffx", "- a", "1", "true"])(
    "value %j reads back identically",
    (value) => {
      const text = edited("", { ...add, id: "h", url: value });
      expect(parseToolchain(text).toolchain.services[0]?.url).toBe(value);
    },
  );

  test("two fields added without a final newline leave no blank line", () => {
    expect(
      edited("version: 1\nservices:\n  a:\n    tool: x", {
        kind: "updateService",
        id: "a",
        url: "u",
        environment: "e",
      }),
    ).toBe("version: 1\nservices:\n  a:\n    tool: x\n    url: u\n    environment: e\n");
  });
});

describe("splice and inverse", () => {
  test("a range outside the text is rejected", () => {
    expect(code("abc", { kind: "splice", start: 2, end: 9, text: "" })).toBe("RANGE_OUT_OF_BOUNDS");
  });

  test("the inverse restores the bytes", () => {
    const first = run(BASE, { ...add, id: "harbor" });
    if (!first.ok) {
      throw new Error("rejected");
    }
    const back = applyToolchain(first.value.text, first.value.inverse);
    expect(back.ok && back.value.text).toBe(BASE);
  });

  test("touched bounds the change", () => {
    const result = run(BASE, { ...add, id: "harbor" });
    const range = result.ok ? result.value.touched[0] : undefined;
    expect(result.ok && result.value.text.slice(range?.start, range?.end)).toBe(
      "  harbor:\n    tool: harbor\n",
    );
  });
});
