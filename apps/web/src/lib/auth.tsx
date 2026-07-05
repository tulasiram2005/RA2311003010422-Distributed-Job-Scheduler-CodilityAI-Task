"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "./api";

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, organizationName: string) => Promise<void>;
  enterDemo: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("user") : null;
    if (stored) setUser(JSON.parse(stored));
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ user: AuthUser; accessToken: string }>("/api/auth/login", { email, password });
    setToken(res.accessToken);
    window.localStorage.setItem("user", JSON.stringify(res.user));
    setUser(res.user);
    router.push("/");
  }

  async function register(name: string, email: string, password: string, organizationName: string) {
    const res = await api.post<{ user: AuthUser; accessToken: string }>("/api/auth/register", {
      name,
      email,
      password,
      organizationName,
    });
    setToken(res.accessToken);
    window.localStorage.setItem("user", JSON.stringify(res.user));
    setUser(res.user);
    router.push("/");
  }

  function logout() {
    setToken(null);
    window.localStorage.removeItem("user");
    setUser(null);
    router.push("/login");
  }

  function enterDemo() {
    const demoUser = { id: "demo-user", name: "Alex Morgan", email: "demo@orbit.dev" };
    window.localStorage.setItem("user", JSON.stringify(demoUser));
    window.localStorage.setItem("scheduler-demo", "true");
    setUser(demoUser);
    router.push("/");
  }

  return <AuthContext.Provider value={{ user, loading, login, register, enterDemo, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
