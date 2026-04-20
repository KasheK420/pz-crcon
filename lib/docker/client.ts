/**
 * Lazy dockerode client. Connects to the host's Docker socket via
 * `/var/run/docker.sock` (mounted read-only into the pz-crcon container).
 *
 * The mount itself is documented in SECURITY.md: even read-only socket
 * access exposes the full Docker API, so the file is owned by `root:docker`
 * on the host and the container only needs read permission. We never call
 * any mutating endpoint (create/start/stop/exec). This module enforces that
 * by only exporting non-mutating helpers.
 */

import Docker from "dockerode";

let _docker: Docker | null = null;

const SOCKET_PATH = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";

export function getDocker(): Docker {
  if (_docker) return _docker;
  _docker = new Docker({ socketPath: SOCKET_PATH });
  return _docker;
}

export interface ContainerStats {
  /** Container name (without leading slash) */
  name: string;
  /** Memory used in bytes (RSS-ish) */
  memBytes: number;
  /** Memory limit in bytes */
  memLimitBytes: number;
  /** CPU usage as a percent of the host CPUs (0..100*nCPU). */
  cpuPercent: number;
  /** True if the container exists and is running. */
  running: boolean;
}

interface DockerStats {
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: { cache?: number };
  };
  cpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
}

function computeCpuPercent(s: DockerStats): number {
  const cur = s.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const prev = s.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const sysCur = s.cpu_stats?.system_cpu_usage ?? 0;
  const sysPrev = s.precpu_stats?.system_cpu_usage ?? 0;
  const cpus = s.cpu_stats?.online_cpus ?? 1;
  const cpuDelta = cur - prev;
  const sysDelta = sysCur - sysPrev;
  if (cpuDelta <= 0 || sysDelta <= 0) return 0;
  return (cpuDelta / sysDelta) * cpus * 100;
}

function computeMemUsed(s: DockerStats): number {
  const usage = s.memory_stats?.usage ?? 0;
  const cache = s.memory_stats?.stats?.cache ?? 0;
  // Docker's "usage" includes page cache; subtract for a more honest figure.
  return Math.max(0, usage - cache);
}

/**
 * Fetch a single non-streaming snapshot of a container's stats.
 * Returns `null` if the container does not exist or is not running.
 */
export async function getContainerStats(containerName: string): Promise<ContainerStats | null> {
  const docker = getDocker();
  let container;
  try {
    container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    if (!inspect.State?.Running) {
      return {
        name: containerName,
        memBytes: 0,
        memLimitBytes: 0,
        cpuPercent: 0,
        running: false,
      };
    }
  } catch {
    return null;
  }
  try {
    const raw = (await container.stats({ stream: false })) as DockerStats;
    return {
      name: containerName,
      memBytes: computeMemUsed(raw),
      memLimitBytes: raw.memory_stats?.limit ?? 0,
      cpuPercent: computeCpuPercent(raw),
      running: true,
    };
  } catch {
    return {
      name: containerName,
      memBytes: 0,
      memLimitBytes: 0,
      cpuPercent: 0,
      running: true,
    };
  }
}

/**
 * Inspect a container and return the raw dockerode payload (or null
 * if the container does not exist). Used by the startup-config page
 * and the config reader to discover the SERVERNAME env var.
 */
export interface ContainerInspect {
  Id: string;
  Name: string;
  State?: { Running?: boolean; Status?: string; StartedAt?: string };
  Config?: {
    Image?: string;
    Env?: string[];
    Cmd?: string[];
    Entrypoint?: string[] | null;
    WorkingDir?: string;
    Labels?: Record<string, string>;
  };
  HostConfig?: {
    Binds?: string[];
    PortBindings?: Record<string, unknown>;
    RestartPolicy?: { Name?: string };
  };
  NetworkSettings?: {
    Networks?: Record<string, { IPAddress?: string }>;
  };
}

export async function inspectContainer(containerName: string): Promise<ContainerInspect | null> {
  const docker = getDocker();
  try {
    const c = docker.getContainer(containerName);
    const info = (await c.inspect()) as unknown as ContainerInspect;
    return info;
  } catch {
    return null;
  }
}

/**
 * Read the env-var map from a container by parsing `Config.Env` (which
 * is delivered as `KEY=value` strings).
 */
export function envMapFrom(info: ContainerInspect): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of info.Config?.Env ?? []) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

/**
 * Read a file from inside a running container by spawning a one-shot
 * `cat <path>` via the Docker exec API. Returns the file contents as a
 * UTF-8 string, or null if the container does not exist or the read failed.
 *
 * Note: this uses dockerode's container.exec API (Docker daemon RPC),
 * NOT Node's child_process module — there is no shell involved.
 */
export async function readContainerFile(
  containerName: string,
  filePath: string,
): Promise<string | null> {
  const docker = getDocker();
  try {
    const container = docker.getContainer(containerName);
    const session = await container.exec({
      Cmd: ["cat", filePath],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = (await session.start({ hijack: true, stdin: false })) as
      | NodeJS.ReadableStream
      | (NodeJS.ReadableStream & { setEncoding: (e: string) => void });

    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);

    // For non-TTY exec, dockerode returns a stream of multiplexed frames.
    // Each frame is 8 bytes: [stream_type, 0,0,0, size_be_4]. We strip
    // those headers and concat the payloads.
    const out: Buffer[] = [];
    let i = 0;
    while (i + 8 <= raw.length) {
      const type = raw[i];
      // Bail to "raw mode" if header doesn't look like the std multiplex
      // sentinel (stream type is 0,1,2 — 1=stdout, 2=stderr).
      if (type !== 0 && type !== 1 && type !== 2) {
        return raw.toString("utf8");
      }
      const size = raw.readUInt32BE(i + 4);
      const start = i + 8;
      const end = start + size;
      if (end > raw.length) break;
      // We accept stdout (1) and stderr (2) — most tools write to stdout.
      if (type === 1 || type === 2) {
        out.push(raw.subarray(start, end));
      }
      i = end;
    }
    return Buffer.concat(out).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Stream raw log lines from a container's stdout/stderr, starting from
 * the tail. Returns a tagged result distinguishing socket-missing vs
 * container-missing so the log-streamer can publish a specific diagnostic.
 *
 * The caller is responsible for parsing Docker's binary multiplexed log
 * frames (when TTY=false). For TTY=true containers (which `pz-server`
 * is, by virtue of `tty: true` in compose) the stream is plain text, so
 * we just emit decoded lines directly.
 */
export type TailFailure = "socket" | "container" | "other";

export interface TailHandle {
  stream: NodeJS.ReadableStream;
  close: () => void;
}

export async function tailContainerLogs(
  containerName: string,
  opts: { tail?: number } = {},
): Promise<{ ok: true; handle: TailHandle } | { ok: false; reason: TailFailure; detail: string }> {
  const docker = getDocker();
  try {
    await docker.ping();
  } catch (e) {
    return { ok: false, reason: "socket", detail: e instanceof Error ? e.message : String(e) };
  }
  try {
    const container = docker.getContainer(containerName);
    const inspect = await container.inspect();
    if (!inspect.State?.Running) {
      return {
        ok: false,
        reason: "container",
        detail: `not running (status=${inspect.State?.Status})`,
      };
    }
    const stream = (await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: opts.tail ?? 100,
      timestamps: false,
    })) as unknown as NodeJS.ReadableStream;
    return {
      ok: true,
      handle: {
        stream,
        close: () => {
          try {
            (stream as unknown as { destroy?: () => void }).destroy?.();
          } catch {
            // ignore
          }
        },
      },
    };
  } catch (e) {
    return { ok: false, reason: "container", detail: e instanceof Error ? e.message : String(e) };
  }
}
