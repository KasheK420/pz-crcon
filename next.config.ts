import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // dockerode pulls ssh2 + cpu-features (native bindings) for an SSH
  // transport we never use. Treat them as runtime externals so Webpack
  // doesn't try to bundle the .node binaries during `next build`.
  serverExternalPackages: ["dockerode", "ssh2", "cpu-features"],
};

export default config;
