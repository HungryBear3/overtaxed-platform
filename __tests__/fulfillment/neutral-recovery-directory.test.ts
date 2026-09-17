/** @jest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openPrivateRecoveryArtifact,
  sealPrivateRecoveryArtifact,
} from "@/lib/fulfillment/neutral-recovery-directory";

describe("private recovery artifact creation", () => {
  test("is deterministic under a permissive umask", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-private-artifact-"),
    );
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, "database.dump.gpg");
    const prior = process.umask(0o000);
    try {
      const descriptor = openPrivateRecoveryArtifact(file);
      expect(fs.fstatSync(descriptor).mode & 0o777).toBe(0o600);
      fs.writeFileSync(descriptor, Buffer.from("encrypted fixture"));
      sealPrivateRecoveryArtifact(descriptor, file);
      expect(fs.fstatSync(descriptor).mode & 0o777).toBe(0o400);
      fs.closeSync(descriptor);
      expect(fs.lstatSync(file).mode & 0o777).toBe(0o400);
    } finally {
      process.umask(prior);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each(["symlink", "hardlink"])("refuses an existing %s path", (kind) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-private-artifact-"),
    );
    fs.chmodSync(directory, 0o700);
    const target = path.join(directory, "target");
    const file = path.join(directory, "database.dump.gpg");
    fs.writeFileSync(target, "protected", { mode: 0o600 });
    if (kind === "symlink") fs.symlinkSync(target, file);
    else fs.linkSync(target, file);
    try {
      expect(() => openPrivateRecoveryArtifact(file)).toThrow();
      expect(fs.readFileSync(target, "utf8")).toBe("protected");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses a post-open rename swap before sealing", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-private-artifact-"),
    );
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, "database.dump.gpg");
    const displaced = path.join(directory, "displaced.gpg");
    try {
      const descriptor = openPrivateRecoveryArtifact(file);
      fs.writeFileSync(descriptor, "held ciphertext");
      fs.renameSync(file, displaced);
      fs.writeFileSync(file, "replacement", { mode: 0o600 });
      expect(() => sealPrivateRecoveryArtifact(descriptor, file)).toThrow(
        "identity changed",
      );
      fs.closeSync(descriptor);
      expect(fs.readFileSync(displaced, "utf8")).toBe("held ciphertext");
      expect(fs.readFileSync(file, "utf8")).toBe("replacement");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses to replace an existing path", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "ot-private-artifact-"),
    );
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, "database.dump.gpg");
    fs.writeFileSync(file, "existing", { mode: 0o600 });
    try {
      expect(() => openPrivateRecoveryArtifact(file)).toThrow();
      expect(fs.readFileSync(file, "utf8")).toBe("existing");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
