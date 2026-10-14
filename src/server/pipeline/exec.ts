import { spawn } from "node:child_process";
import { PipelineError, toolMissing } from "./errors";

export type ExecResult = { stdout: string; stderr: string };

/**
 * Runs an external tool without a shell (arguments are never interpolated
 * into a command line, so file names cannot inject commands). Captures a
 * bounded amount of output and enforces a timeout.
 */
export function run(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxOutputBytes?: number; maxStderrBytes?: number } = {},
): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const max = opts.maxOutputBytes ?? 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < max) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      // Keep the tail of stderr: that is where tools report the real error.
      stderr = (stderr + d.toString("utf8")).slice(-(opts.maxStderrBytes ?? 16_384));
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new PipelineError("Processing took too long and was stopped.", { retryable: true, detail: `${command} timed out after ${timeoutMs} ms` }));
    }, timeoutMs);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? toolMissing(command) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new PipelineError("A processing step failed on this file.", {
            retryable: false,
            detail: `${command} exited with ${code}: ${stderr.slice(-2000)}`,
          }),
        );
    });
  });
}
