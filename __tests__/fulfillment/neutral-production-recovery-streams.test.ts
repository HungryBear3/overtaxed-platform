/** @jest-environment node */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  assertRecoverySelectionAnchor,
  assertRecoverySelectionFile,
  assertExpectedGpgTermination,
  closeRecoverySelectionAnchor,
  materializeRecoverySelectionFile,
  observeRecoveryStreamErrors,
  openRecoverySelectionAnchor,
  recoverySelectionChildPath,
  removeRecoverySelectionFile,
  settleRecoveryArchivePipeline,
  unlinkRecoverySelectionPath,
} from "@/scripts/rehearse-neutral-production-recovery";

function transportError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function childClose(
  child: ChildProcess,
): Promise<[number | null, NodeJS.Signals | null]> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve([code, signal]));
  });
}

function child(script: string): ChildProcess {
  return spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "pipe", "ignore"],
  });
}

function stopPipeline(producer: ChildProcess, consumer: ChildProcess): void {
  producer.stdout!.unpipe(consumer.stdin!);
  producer.stdin!.destroy();
  producer.stdout!.destroy();
  consumer.stdin!.destroy();
  if (producer.exitCode === null && producer.signalCode === null)
    producer.kill("SIGTERM");
  if (consumer.exitCode === null && consumer.signalCode === null)
    consumer.kill("SIGTERM");
}

function privateDirectory(): string {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ot-selection-test-")),
  );
  fs.chmodSync(directory, 0o700);
  return directory;
}

describe("neutral recovery child-stream errors", () => {
  test("observes expected early-close transport errors without converting them into failure", async () => {
    const stream = new PassThrough();
    const cleanup = jest.fn();
    const observer = observeRecoveryStreamErrors(
      stream,
      "bounded transport failure",
      ["EPIPE", "ECONNRESET"],
      cleanup,
    );

    stream.emit("error", transportError("EPIPE", "secret pipe detail"));
    stream.emit("error", transportError("ECONNRESET", "secret reset detail"));

    await expect(
      Promise.race([
        observer.failure.then(
          () => "failed",
          () => "failed",
        ),
        Promise.resolve("pending"),
      ]),
    ).resolves.toBe("pending");
    expect(cleanup).not.toHaveBeenCalled();
    stream.destroy();
  });

  test("fails closed with a fixed diagnostic for every unapproved stream error", async () => {
    const stream = new PassThrough();
    const cleanup = jest.fn();
    const observer = observeRecoveryStreamErrors(
      stream,
      "encrypted recovery archive read failed",
      ["EPIPE", "ECONNRESET"],
      cleanup,
    );

    stream.emit(
      "error",
      transportError("EIO", "customer-row-secret@example.invalid"),
    );

    await expect(observer.failure).rejects.toThrow(
      "encrypted recovery archive read failed",
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    try {
      await observer.failure;
    } catch (error) {
      expect(String(error)).not.toContain(
        "customer-row-secret@example.invalid",
      );
    }
  });

  test("does not ignore EPIPE or ECONNRESET unless the caller explicitly authorizes them", async () => {
    for (const code of ["EPIPE", "ECONNRESET"]) {
      const stream = new PassThrough();
      const cleanup = jest.fn();
      const observer = observeRecoveryStreamErrors(
        stream,
        "strict recovery stream failed",
        [],
        cleanup,
      );
      stream.emit("error", transportError(code, "private transport detail"));
      await expect(observer.failure).rejects.toThrow(
        "strict recovery stream failed",
      );
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  });

  test("turns a source EIO into a bounded fixed rejection even when cleanup throws", async () => {
    const stream = new PassThrough();
    const observer = observeRecoveryStreamErrors(
      stream,
      "encrypted recovery archive read failed",
      [],
      () => {
        stream.destroy();
        throw new Error("cleanup-secret@example.invalid");
      },
    );
    stream.emit(
      "error",
      transportError("EIO", "source-secret@example.invalid"),
    );

    let timer: NodeJS.Timeout | undefined;
    try {
      await expect(
        Promise.race([
          observer.failure,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("observer did not settle")),
              250,
            );
          }),
        ]),
      ).rejects.toThrow("encrypted recovery archive read failed");
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  test("accepts only controlled GPG completion statuses after downstream authority", () => {
    expect(() => assertExpectedGpgTermination([0, null])).not.toThrow();
    for (const signal of ["SIGTERM", "SIGKILL", "SIGPIPE"] as const)
      expect(() => assertExpectedGpgTermination([null, signal])).not.toThrow();
    expect(() => assertExpectedGpgTermination([2, null])).toThrow(
      "gpg archive termination was unexpected",
    );
  });

  test("allows a producer zero exit before the consumer finishes EOF processing", async () => {
    const producer = child('process.stdout.end("archive");');
    const consumer = child(
      'process.stdin.resume(); process.stdin.on("end", () => setTimeout(() => process.exit(0), 75));',
    );
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    producer.stdout!.pipe(consumer.stdin!);

    await settleRecoveryArchivePipeline({
      producer,
      producerClosed,
      consumer,
      consumerClosed,
      consumerProgress: consumerClosed,
      failures: [],
      consumerFailureMessage: "consumer failed",
      producerEarlyFailureMessage: "producer failed early",
      stop: () => stopPipeline(producer, consumer),
      disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
    });

    await expect(producerClosed).resolves.toEqual([0, null]);
    await expect(consumerClosed).resolves.toEqual([0, null]);
  });

  test("fails on an early nonzero producer and leaves no live consumer", async () => {
    const producer = child("setTimeout(() => process.exit(7), 10);");
    const consumer = child(
      "process.stdin.resume(); setInterval(() => undefined, 1000);",
    );
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    producer.stdout!.pipe(consumer.stdin!);

    await expect(
      settleRecoveryArchivePipeline({
        producer,
        producerClosed,
        consumer,
        consumerClosed,
        consumerProgress: consumerClosed,
        failures: [],
        consumerFailureMessage: "consumer failed",
        producerEarlyFailureMessage: "producer failed early",
        stop: () => stopPipeline(producer, consumer),
        disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
      }),
    ).rejects.toThrow("producer failed early");
    await expect(producerClosed).resolves.toEqual([7, null]);
    const [, consumerSignal] = await consumerClosed;
    expect(["SIGTERM", "SIGKILL"]).toContain(consumerSignal);
  });

  test("actively tears down a real pipeline on source EIO without leaking or hanging", async () => {
    const source = new PassThrough();
    const producer = child(
      "process.stdin.pipe(process.stdout); setInterval(() => undefined, 1000);",
    );
    const consumer = child(
      "process.stdin.resume(); setInterval(() => undefined, 1000);",
    );
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    const stop = () => {
      source.unpipe(producer.stdin!);
      source.destroy();
      stopPipeline(producer, consumer);
    };
    const sourceErrors = observeRecoveryStreamErrors(
      source,
      "encrypted recovery archive read failed",
      [],
      stop,
    );
    source.pipe(producer.stdin!);
    producer.stdout!.pipe(consumer.stdin!);
    const settled = settleRecoveryArchivePipeline({
      producer,
      producerClosed,
      consumer,
      consumerClosed,
      consumerProgress: consumerClosed,
      failures: [sourceErrors.failure],
      consumerFailureMessage: "consumer failed",
      producerEarlyFailureMessage: "producer failed early",
      stop,
      disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
    });
    source.emit(
      "error",
      transportError("EIO", "customer-row-secret@example.invalid"),
    );

    await expect(settled).rejects.toThrow(
      "encrypted recovery archive read failed",
    );
    await expect(producerClosed).resolves.toEqual([null, "SIGTERM"]);
    await expect(consumerClosed).resolves.toEqual([null, "SIGTERM"]);
  });

  test("permits an approved transport close only when both child statuses succeed", async () => {
    const producer = child(
      'setTimeout(() => process.stdout.end("archive"), 20);',
    );
    const consumer = child(
      'process.stdin.resume(); process.stdin.on("end", () => setTimeout(() => process.exit(0), 50));',
    );
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    const stop = () => stopPipeline(producer, consumer);
    const transport = observeRecoveryStreamErrors(
      producer.stdout!,
      "producer transport failed",
      ["EPIPE", "ECONNRESET"],
      stop,
    );
    producer.stdout!.pipe(consumer.stdin!);
    producer.stdout!.emit(
      "error",
      transportError("EPIPE", "private transport detail"),
    );

    await settleRecoveryArchivePipeline({
      producer,
      producerClosed,
      consumer,
      consumerClosed,
      consumerProgress: consumerClosed,
      failures: [transport.failure],
      consumerFailureMessage: "consumer failed",
      producerEarlyFailureMessage: "producer failed early",
      stop,
      disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
    });
    await expect(producerClosed).resolves.toEqual([0, null]);
    await expect(consumerClosed).resolves.toEqual([0, null]);
  });

  test("materializes and revalidates an exact protected TOC selection", () => {
    const directory = privateDirectory();
    try {
      const bytes = Buffer.from("1; 0 0 TABLE DATA public exact owner\n");
      const selection = materializeRecoverySelectionFile(
        directory,
        "selection-0.list",
        bytes,
      );
      expect(fs.readFileSync(selection.file)).toEqual(bytes);
      expect(fs.statSync(selection.file).mode & 0o777).toBe(0o600);
      expect(() => assertRecoverySelectionFile(selection)).not.toThrow();
      const anchor = openRecoverySelectionAnchor(selection);
      expect(() => assertRecoverySelectionAnchor(anchor)).not.toThrow();
      closeRecoverySelectionAnchor(anchor);
      removeRecoverySelectionFile(selection);
      expect(fs.existsSync(selection.file)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each(["truncated", "mode", "hardlink", "symlink", "path-swap"])(
    "rejects a %s TOC selection before pg_restore spawn",
    (mutation) => {
      const directory = privateDirectory();
      try {
        const bytes = Buffer.from(
          "1; 0 0 TABLE DATA public valid_prefix owner\n2; 0 0 TABLE DATA public required owner\n",
        );
        const selection = materializeRecoverySelectionFile(
          directory,
          "selection-0.list",
          bytes,
        );
        if (mutation === "truncated")
          fs.writeFileSync(selection.file, bytes.subarray(0, 45), {
            mode: 0o600,
          });
        if (mutation === "mode") fs.chmodSync(selection.file, 0o640);
        if (mutation === "hardlink")
          fs.linkSync(selection.file, path.join(directory, "alias.list"));
        if (mutation === "symlink") {
          fs.unlinkSync(selection.file);
          fs.symlinkSync(path.join(directory, "missing.list"), selection.file);
        }
        if (mutation === "path-swap") {
          const moved = path.join(directory, "moved.list");
          fs.renameSync(selection.file, moved);
          fs.copyFileSync(moved, selection.file);
          fs.chmodSync(selection.file, 0o600);
        }
        expect(() => assertRecoverySelectionFile(selection)).toThrow();
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  test("binds the child to the unlinked validated inode despite a same-UID path replacement", async () => {
    const directory = privateDirectory();
    let unrelated: number | undefined;
    try {
      const original = Buffer.from("original validated selection\n");
      const replacement = Buffer.from("attacker replacement selection\n");
      const selection = materializeRecoverySelectionFile(
        directory,
        "selection-0.list",
        original,
      );
      const anchor = openRecoverySelectionAnchor(selection);
      unlinkRecoverySelectionPath(anchor);
      expect(fs.existsSync(selection.file)).toBe(false);
      const reader = spawn(
        process.execPath,
        ["-e", 'process.stdout.write(require("fs").readFileSync(3))'],
        {
          stdio: ["ignore", "pipe", "ignore", anchor.descriptor],
        },
      );
      const chunks: Buffer[] = [];
      reader.stdout!.on("data", (chunk: Buffer) =>
        chunks.push(Buffer.from(chunk)),
      );
      fs.writeFileSync(selection.file, replacement, { mode: 0o600 });
      await expect(childClose(reader)).resolves.toEqual([0, null]);
      expect(Buffer.concat(chunks)).toEqual(original);
      expect(() => assertRecoverySelectionAnchor(anchor)).not.toThrow();
      expect(fs.readFileSync(selection.file)).toEqual(replacement);

      closeRecoverySelectionAnchor(anchor);
      unrelated = fs.openSync("/dev/null", fs.constants.O_RDONLY);
      closeRecoverySelectionAnchor(anchor);
      expect(() => fs.fstatSync(unrelated!)).not.toThrow();
    } finally {
      if (unrelated !== undefined) fs.closeSync(unrelated);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("uses the validated inherited descriptor on Darwin and Linux", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts/rehearse-neutral-production-recovery.ts",
      ),
      "utf8",
    );
    expect(recoverySelectionChildPath()).toBe("/dev/fd/3");
    expect(source).toContain("`--use-list=${recoverySelectionChildPath()}`");
    expect(source).toContain(
      '["pipe", "pipe", "pipe", selectionAnchor.descriptor]',
    );
    expect(
      source.indexOf("unlinkRecoverySelectionPath(selectionAnchor)"),
    ).toBeLessThan(source.indexOf("const restore = track("));
    expect(source).toContain('process.platform !== "darwin"');
    expect(source).toContain('process.platform !== "linux"');
    expect(source).not.toContain("recordRecoveryEndpointErrors");
  });
});
