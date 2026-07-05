"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useSWRConfig } from "swr";
import { API_BASE } from "./api";

let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(API_BASE, { transports: ["websocket", "polling"] });
  }
  return sharedSocket;
}

/**
 * Joins a queue's room and revalidates the SWR keys that show that queue's
 * data whenever the API emits a job/batch/dlq event into it. This is the
 * client half of the Socket.IO wiring — the server has emitted these events
 * since the API was first built, but nothing was listening on the frontend
 * until this hook existed. Polling (via each page's refreshInterval) stays
 * on as a fallback, so a dropped socket connection degrades to "slightly
 * less live" rather than "silently stale."
 */
export function useQueueLiveUpdates(queueId: string | undefined, onEvent?: () => void) {
  const { mutate } = useSWRConfig();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!queueId) return;
    const socket = getSocket();
    socketRef.current = socket;
    socket.emit("subscribe:queue", queueId);

    const revalidate = () => {
      mutate((key) => typeof key === "string" && key.includes(queueId));
      onEvent?.();
    };

    socket.on("job:created", revalidate);
    socket.on("batch:created", revalidate);
    socket.on("job:retried", revalidate);
    socket.on("job:requeued-from-dlq", revalidate);

    return () => {
      socket.emit("unsubscribe:queue", queueId);
      socket.off("job:created", revalidate);
      socket.off("batch:created", revalidate);
      socket.off("job:retried", revalidate);
      socket.off("job:requeued-from-dlq", revalidate);
    };
  }, [queueId, mutate, onEvent]);
}

/** Subscribes to every currently-known queue at once — used by pages (overview, job explorer) that aren't scoped to a single queue. */
export function useAllQueuesLiveUpdates(queueIds: string[]) {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (queueIds.length === 0) return;
    const socket = getSocket();
    queueIds.forEach((id) => socket.emit("subscribe:queue", id));

    const revalidateAll = () => mutate(() => true);
    socket.on("job:created", revalidateAll);
    socket.on("job:retried", revalidateAll);
    socket.on("job:requeued-from-dlq", revalidateAll);

    return () => {
      queueIds.forEach((id) => socket.emit("unsubscribe:queue", id));
      socket.off("job:created", revalidateAll);
      socket.off("job:retried", revalidateAll);
      socket.off("job:requeued-from-dlq", revalidateAll);
    };
  }, [queueIds.join(","), mutate]);
}
