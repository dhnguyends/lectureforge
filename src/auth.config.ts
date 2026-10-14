import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration (no database, no bcrypt). Used by the
 * middleware; the full configuration in src/auth.ts extends it.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/study-sets", "/settings"];

export default {
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const needsAuth = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
      return needsAuth ? Boolean(auth?.user) : true;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
