import { describe, it, expect } from "vitest";
import { redactError } from "@/lib/redact";

describe("redactError", () => {
  it("redacts the host:port from a Prisma 'can't reach database server' error", () => {
    const message = "Can't reach database server at 'ep-cool-lab-12345.us-east-1.aws.neon.tech:5432'";
    const redacted = redactError(message);
    expect(redacted).not.toContain("neon.tech");
    expect(redacted).not.toContain("5432");
    expect(redacted).toBe("Can't reach database server at [redacted]");
  });

  it("redacts a user:pass@host:port connection-string credential chunk", () => {
    const message =
      "connect ECONNREFUSED postgresql://neondb_owner:supersecret@ep-cool-lab-12345.us-east-1.aws.neon.tech:5432/neondb?sslmode=require";
    const redacted = redactError(message);
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("neon.tech");
    expect(redacted).toContain("[redacted]");
  });

  it("leaves an ordinary pipeline message unchanged", () => {
    const message = "unknown theatre (AMC/amc-metreon-16); skipping";
    expect(redactError(message)).toBe(message);
  });
});
