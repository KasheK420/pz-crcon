import { createServer } from "node:http";
import next from "next";
import { parse } from "node:url";
import { attachWs } from "@/lib/ws/server";
import { installLogStreamer } from "@/lib/ws/log-streamer";
import { getLogger } from "@/lib/logger";

const log = getLogger().child({ mod: "server" });

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
      const parsed = parse(req.url ?? "/", true);
      handle(req, res, parsed);
    });
    attachWs(httpServer);
    installLogStreamer();
    httpServer.listen(port, () => {
      log.info({ port }, "pz-crcon listening");
    });
  })
  .catch((e) => {
    log.error({ err: e }, "next.prepare() failed");
    process.exit(1);
  });
