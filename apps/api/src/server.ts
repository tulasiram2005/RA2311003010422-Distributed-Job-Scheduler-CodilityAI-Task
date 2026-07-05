import "dotenv/config";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { createDb } from "@scheduler/db";
import { createApp } from "./app";
import { logger } from "./lib/logger";

const db = createDb();
const httpServer = createServer();
const io = new SocketServer(httpServer, { cors: { origin: "*" } });
const app = createApp(db, io);

httpServer.on("request", app);

io.on("connection", (socket) => {
  socket.on("subscribe:queue", (queueId: string) => socket.join(`queue:${queueId}`));
  socket.on("unsubscribe:queue", (queueId: string) => socket.leave(`queue:${queueId}`));
});

const port = Number(process.env.PORT ?? 4000);
httpServer.listen(port, () => {
  logger.info(`api listening on :${port}`);
});

async function shutdown(signal: string) {
  logger.info(`received ${signal}, shutting down`);
  httpServer.close(() => logger.info("http server closed"));
  await db.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
