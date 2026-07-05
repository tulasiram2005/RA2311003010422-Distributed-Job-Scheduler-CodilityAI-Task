"use client";

import useSWR from "swr";
import { api } from "./api";

export interface Project {
  id: string;
  name: string;
  organization_id: string;
}

export function useProjects() {
  const { data, isLoading, mutate } = useSWR("projects", () => api.get<{ data: Project[] }>("/api/projects"));
  return { projects: data?.data ?? [], isLoading, mutate };
}
