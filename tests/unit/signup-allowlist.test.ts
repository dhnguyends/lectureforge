import { describe, expect, it } from "vitest";
import { signupAllowed } from "@/server/services/users";

describe("signupAllowed", () => {
  it("is open when no allowlist is set", () => {
    expect(signupAllowed("anyone@example.com", "")).toBe(true);
    expect(signupAllowed("anyone@example.com", " , ")).toBe(true);
  });

  it("matches listed addresses and domains, ignoring case and spaces", () => {
    const list = "Owner@Example.com, @school.edu";
    expect(signupAllowed("owner@example.com", list)).toBe(true);
    expect(signupAllowed(" OWNER@example.com ", list)).toBe(true);
    expect(signupAllowed("student@school.edu", list)).toBe(true);
    expect(signupAllowed("intruder@example.com", list)).toBe(false);
    expect(signupAllowed("x@notschool.edu.evil.com", list)).toBe(false);
  });
});
