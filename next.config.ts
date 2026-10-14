import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production image (deploy/Dockerfile).
  output: "standalone",
  // Server-only packages that must not be bundled into route handlers.
  serverExternalPackages: ["bullmq", "ioredis", "pino", "unpdf"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // In development the admin page (control service) is proxied under /admin.
  // In production Caddy routes /admin to the control service directly, so it
  // stays reachable while the app is shut down.
  async rewrites() {
    const control = process.env.CONTROL_URL;
    return control
      ? [
          { source: "/admin", destination: `${control}/admin` },
          { source: "/admin/:path*", destination: `${control}/admin/:path*` },
        ]
      : [];
  },
};

export default nextConfig;
