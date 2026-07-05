import express, { type Express } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import type { Kysely } from "kysely";
import type { Database } from "@scheduler/db";
import type { Server as SocketServer } from "socket.io";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./routes/auth";
import { projectsRouter } from "./routes/projects";
import { queuesRouter } from "./routes/queues";
import { jobsRouter } from "./routes/jobs";
import { schedulesRouter } from "./routes/schedules";
import { workersRouter } from "./routes/workers";
import { dlqRouter } from "./routes/dlq";
import { metricsRouter } from "./routes/metrics";

export function createApp(db: Kysely<Database>, io: SocketServer): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger, genReqId: () => randomUUID(), autoLogging: process.env.NODE_ENV !== "test" }));

  // A job-scheduler API is exactly the kind of service someone could hammer
  // with job-creation requests, so this sits in front of everything rather
  // than being an afterthought bolted onto one route.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  app.use("/api/auth", authRouter(db));
  app.use("/api/projects", projectsRouter(db));
  app.use("/api/queues", queuesRouter(db));
  app.use("/api/jobs", jobsRouter(db, io));
  app.use("/api/schedules", schedulesRouter(db));
  app.use("/api/workers", workersRouter(db));
  app.use("/api/dlq", dlqRouter(db, io));
  app.use("/api/metrics", metricsRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
