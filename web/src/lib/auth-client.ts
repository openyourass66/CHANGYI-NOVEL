"use client";
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { apiFetch } from "@/lib/client-api";

export const authClient = createAuthClient({
  ...(typeof window !== "undefined" && window.changyi ? { baseURL: "https://desktop.local", basePath: "/api/v1/auth" } : {}),
  fetchOptions: { customFetchImpl: apiFetch },
  plugins: [emailOTPClient()],
});
