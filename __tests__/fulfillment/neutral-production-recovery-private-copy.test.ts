/** @jest-environment node */
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  materializePrivateCopy,
  privateCopyReadStream,
} from "@/scripts/neutral-production-recovery-gate";

describe("private recovery copy descriptor ownership", () => {
  test("normal stream completion leaves the identity descriptor for cleanup", async () => {
    const copy = materializePrivateCopy(Buffer.from("encrypted fixture"));
    const directory = path.dirname(copy.file);
    const stream = privateCopyReadStream(copy);
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.from(chunk));
    });
    await Promise.all([once(stream, "end"), once(stream, "close")]);

    expect(Buffer.concat(chunks).toString("utf8")).toBe("encrypted fixture");
    expect(fs.fstatSync(copy.descriptor).isFile()).toBe(true);
    copy.cleanup();
    expect(fs.existsSync(directory)).toBe(false);
    expect(() => fs.fstatSync(copy.descriptor)).toThrow(
      expect.objectContaining({ code: "EBADF" }),
    );
  });

  test("multiple restore passes reuse the anchor without transferring ownership", async () => {
    const copy = materializePrivateCopy(Buffer.from("repeatable ciphertext"));
    const directory = path.dirname(copy.file);
    for (let pass = 0; pass < 4; pass += 1) {
      const stream = privateCopyReadStream(copy);
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.from(chunk));
      });
      await Promise.all([once(stream, "end"), once(stream, "close")]);
      expect(Buffer.concat(chunks).toString("utf8")).toBe(
        "repeatable ciphertext",
      );
      expect(fs.fstatSync(copy.descriptor).isFile()).toBe(true);
    }
    copy.cleanup();
    expect(fs.existsSync(directory)).toBe(false);
  });

  test("early stream teardown does not steal the cleanup-owned descriptor", async () => {
    const copy = materializePrivateCopy(Buffer.alloc(1024 * 1024, 7));
    const directory = path.dirname(copy.file);
    const stream = privateCopyReadStream(copy);
    const closed = once(stream, "close");
    stream.destroy();
    await closed;

    expect(fs.fstatSync(copy.descriptor).isFile()).toBe(true);
    copy.cleanup();
    expect(fs.existsSync(directory)).toBe(false);
    expect(() => fs.fstatSync(copy.descriptor)).toThrow(
      expect.objectContaining({ code: "EBADF" }),
    );
  });

  test("stream errors remain observable while cleanup closes the descriptor", async () => {
    const copy = materializePrivateCopy(Buffer.from("encrypted fixture"));
    const directory = path.dirname(copy.file);
    const stream = privateCopyReadStream(copy);
    const error = new Promise<Error>((resolve) =>
      stream.once("error", resolve),
    );
    const closed = new Promise<void>((resolve) =>
      stream.once("close", resolve),
    );
    stream.destroy(new Error("synthetic stream failure"));
    await expect(error).resolves.toEqual(
      expect.objectContaining({ message: "synthetic stream failure" }),
    );
    await closed;

    expect(fs.fstatSync(copy.descriptor).isFile()).toBe(true);
    copy.cleanup();
    expect(fs.existsSync(directory)).toBe(false);
  });

  test("cleanup is repeat-safe after closing and removing its private directory", () => {
    const copy = materializePrivateCopy(Buffer.from("encrypted fixture"));
    const directory = path.dirname(copy.file);
    copy.cleanup();
    expect(() => copy.cleanup()).not.toThrow();
    expect(fs.existsSync(directory)).toBe(false);
  });

  test("close-then-EIO relinquishes ownership and never closes a reused descriptor", () => {
    const copy = materializePrivateCopy(Buffer.from("encrypted fixture"));
    const directory = path.dirname(copy.file);
    const copyDescriptor = copy.descriptor;
    const failure = Object.assign(new Error("injected close failure"), {
      code: "EIO",
    });
    const realClose = fs.closeSync;
    const close = jest
      .spyOn(fs, "closeSync")
      .mockImplementationOnce((descriptor) => {
        realClose(descriptor);
        throw failure;
      });
    try {
      expect(() => copy.cleanup()).toThrow(failure);
      expect(fs.existsSync(directory)).toBe(false);
    } finally {
      close.mockRestore();
    }

    const unrelated: number[] = [];
    try {
      for (let attempt = 0; attempt < 256; attempt += 1) {
        const descriptor = fs.openSync("/dev/null", "r");
        unrelated.push(descriptor);
        if (descriptor === copyDescriptor) break;
      }
      expect(unrelated).toContain(copyDescriptor);
      expect(() => copy.cleanup()).not.toThrow();
      expect(fs.fstatSync(copyDescriptor).isCharacterDevice()).toBe(true);
    } finally {
      for (const descriptor of unrelated) realClose(descriptor);
    }
  });
});
