/** @jest-environment node */
import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  assertExpectedGpgTermination,
  observeRecoveryStreamErrors,
  recordRecoveryEndpointErrors,
  settleRecoveryArchivePipeline,
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
    const deferredInput = recordRecoveryEndpointErrors(consumer.stdin!);
    consumer.stdin!.emit(
      "error",
      transportError("EARBITRARY", "secret early producer detail"),
    );
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
    expect(deferredInput.observed()).toBe(true);
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

  test("defers arbitrary TOC stdin errors until complete output and zero consumer authority", async () => {
    const producer = child(`
      const chunk = Buffer.alloc(65536, 7);
      const pump = () => { while (process.stdout.write(chunk)) {} };
      process.stdout.on("drain", pump);
      pump();
      setInterval(() => undefined, 1000);
    `);
    const consumer = child(
      'process.stdin.once("data", () => process.stdout.end("TOC COMPLETE", () => process.exit(0))); process.stdin.resume();',
    );
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    const stop = () => stopPipeline(producer, consumer);
    const transportCodes: string[] = [];
    consumer.stdin!.on("error", (error: NodeJS.ErrnoException) => {
      transportCodes.push(error.code ?? "");
    });
    const tocInputErrors = recordRecoveryEndpointErrors(consumer.stdin!);
    consumer.stdin!.emit(
      "error",
      transportError(
        "ETOCLATE",
        "customer-row-secret@example.invalid arbitrary transport detail",
      ),
    );
    producer.stdout!.pipe(consumer.stdin!);
    let tocOutput = "";
    consumer.stdout!.setEncoding("utf8");
    consumer.stdout!.on("data", (chunk: string) => {
      tocOutput += chunk;
    });
    const outputEnded = new Promise<void>((resolve) =>
      consumer.stdout!.once("end", resolve),
    );
    consumer.stdout!.resume();

    await settleRecoveryArchivePipeline({
      producer,
      producerClosed,
      consumer,
      consumerClosed,
      consumerProgress: Promise.all([consumerClosed, outputEnded]).then(
        ([status]) => status,
      ),
      failures: [],
      consumerFailureMessage: "pg_restore archive TOC failed",
      producerEarlyFailureMessage:
        "gpg archive failed before pg_restore completed",
      stop,
      disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
    });

    expect(
      transportCodes.some((code) => ["EPIPE", "ECONNRESET"].includes(code)),
    ).toBe(true);
    expect(tocInputErrors.acceptAfterAuthority()).toBe(true);
    expect(tocInputErrors.observed()).toBe(false);
    expect(tocOutput).toBe("TOC COMPLETE");
    await expect(consumerClosed).resolves.toEqual([0, null]);
    const [producerCode, producerSignal] = await producerClosed;
    expect(
      producerCode === 0 ||
        ["SIGTERM", "SIGKILL", "SIGPIPE"].includes(producerSignal ?? ""),
    ).toBe(true);
  });

  test("treats a nonzero consumer as fatal and terminates the producer", async () => {
    const producer = child(
      'process.stdout.write("archive"); setInterval(() => undefined, 1000);',
    );
    const consumer = child("process.stdin.resume(); process.exit(9);");
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    const stop = () => stopPipeline(producer, consumer);
    const tocInputErrors = recordRecoveryEndpointErrors(consumer.stdin!);
    consumer.stdin!.emit(
      "error",
      transportError("EARBITRARY", "secret nonzero consumer detail"),
    );
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
        stop,
        disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
      }),
    ).rejects.toThrow("consumer failed");
    await expect(consumerClosed).resolves.toEqual([9, null]);
    const [, producerSignal] = await producerClosed;
    expect(["SIGTERM", "SIGKILL"]).toContain(producerSignal);
    expect(tocInputErrors.observed()).toBe(true);
  });

  test("a deferred TOC stdin error cannot authorize incomplete output or leave orphans", async () => {
    const producer = child(
      'setInterval(() => process.stdout.write("archive"), 10);',
    );
    const consumer = child(
      "process.stdin.resume(); setInterval(() => undefined, 1000);",
    );
    const producerClosed = childClose(producer);
    const consumerClosed = childClose(consumer);
    const stop = () => stopPipeline(producer, consumer);
    const tocInputErrors = recordRecoveryEndpointErrors(consumer.stdin!);
    consumer.stdin!.emit(
      "error",
      transportError("EARBITRARY", "secret incomplete output detail"),
    );
    producer.stdout!.pipe(consumer.stdin!);

    await expect(
      settleRecoveryArchivePipeline({
        producer,
        producerClosed,
        consumer,
        consumerClosed,
        consumerProgress: new Promise(() => undefined),
        failures: [],
        consumerFailureMessage: "pg_restore archive TOC failed",
        producerEarlyFailureMessage:
          "gpg archive failed before pg_restore completed",
        progressTimeoutMs: 50,
        progressTimeoutMessage: "pg_restore archive TOC timed out",
        stop,
        disconnect: () => producer.stdout!.unpipe(consumer.stdin!),
      }),
    ).rejects.toThrow("pg_restore archive TOC timed out");
    expect(tocInputErrors.observed()).toBe(true);
    const [, producerSignal] = await producerClosed;
    const [, consumerSignal] = await consumerClosed;
    expect(["SIGTERM", "SIGKILL"]).toContain(producerSignal);
    expect(["SIGTERM", "SIGKILL"]).toContain(consumerSignal);
  });
});
