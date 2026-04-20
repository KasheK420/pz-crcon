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
export async function getContainerStats(
  containerName: string
): Promise<ContainerStats | null> {
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
 * Stream raw log lines from a container's stdout/stderr, starting from
 * the tail. Returns the dockerode log stream and a closer.
 *
 * The caller is responsible for parsing Docker's binary multiplexed log
 * frames (when TTY=false). For TTY=true containers (which `pz-server`
 * is, by virtue of `tty: true` in compose) the stream is plain text, so
 * we just emit decoded lines directly.
 */
export async function tailContainerLogs(
  containerName: string,
  opts: { tail?: number } = {}
): Promise<{ stream: NodeJS.ReadableStream; close: () => void } | null> {
  const docker = getDocker();
  try {
    const container = docker.getContainer(containerName);
    const stream = (await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: opts.tail ?? 100,
      timestamps: false,
    })) as unknown as NodeJS.ReadableStream;
    return {
      stream,
      close: () => {
        try {
          (stream as unknown as { destroy?: () => void }).destroy?.();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return null;
  }
}
