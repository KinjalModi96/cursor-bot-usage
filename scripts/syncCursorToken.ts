import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function cursorStateDbPath(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? "",
      "Cursor/User/globalStorage/state.vscdb",
    );
  }
  return path.join(
    os.homedir(),
    ".config/Cursor/User/globalStorage/state.vscdb",
  );
}

function readSqliteValue(dbPath: string, key: string): string | null {
  if (!fs.existsSync(dbPath)) return null;

  const tmp = path.join(os.tmpdir(), `cursor-state-${process.pid}.vscdb`);
  try {
    fs.copyFileSync(dbPath, tmp);
    const escaped = key.replace(/'/g, "''");
    const out = execFileSync(
      "sqlite3",
      [tmp, `SELECT value FROM ItemTable WHERE key = '${escaped}' LIMIT 1;`],
      { encoding: "utf8" },
    ).trim();
    return out || null;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function userIdFromAccessToken(accessToken: string): string {
  const segment = accessToken.split(".")[1];
  if (!segment) throw new Error("Invalid access token shape.");
  const payload = JSON.parse(
    Buffer.from(
      segment.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8"),
  ) as { sub?: string };
  const sub = payload.sub?.trim();
  if (!sub) throw new Error("Access token is missing sub.");
  return sub.includes("|") ? sub.split("|").pop()! : sub;
}

export function buildSessionTokenFromIde(): {
  email: string;
  userId: string;
  sessionToken: string;
} {
  const dbPath = cursorStateDbPath();
  const accessToken = readSqliteValue(dbPath, "cursorAuth/accessToken");
  const email = readSqliteValue(dbPath, "cursorAuth/cachedEmail");

  if (!accessToken) {
    throw new Error(
      `Cursor IDE access token not found at ${dbPath}. Sign in to the Cursor app first.`,
    );
  }

  const userId = userIdFromAccessToken(accessToken);
  const sessionToken = `${userId}%3A%3A${accessToken}`;

  return {
    email: email ?? "unknown",
    userId,
    sessionToken,
  };
}

function upsertEnvVar(filePath: string, key: string, value: string): void {
  const eol = "\n";
  const line = `${key}=${value}`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${line}${eol}`, "utf8");
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}${eol}${line}${eol}`;
  fs.writeFileSync(filePath, next.endsWith(eol) ? next : `${next}${eol}`, "utf8");
}

async function verifyToken(sessionToken: string): Promise<{
  email: string;
  numericUserId: number;
  membershipType: string;
}> {
  const headers = {
    Accept: "application/json",
    Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    Origin: "https://cursor.com",
    Referer: "https://cursor.com/dashboard",
  };
  const [meRes, summaryRes] = await Promise.all([
    fetch("https://cursor.com/api/auth/me", { headers }),
    fetch("https://cursor.com/api/usage-summary", { headers }),
  ]);
  if (!meRes.ok || !summaryRes.ok) {
    const body = await summaryRes.text().catch(() => "");
    throw new Error(
      `Token verification failed (auth ${meRes.status}, usage ${summaryRes.status}): ${body.slice(0, 160)}`,
    );
  }
  const me = (await meRes.json()) as { email?: string; id?: number };
  const summary = (await summaryRes.json()) as { membershipType?: string };
  if (typeof me.id !== "number") {
    throw new Error("Could not resolve numeric user id from /api/auth/me.");
  }
  return {
    email: me.email ?? "unknown",
    numericUserId: me.id,
    membershipType: summary.membershipType ?? "unknown",
  };
}

async function main() {
  const { sessionToken } = buildSessionTokenFromIde();
  const verified = await verifyToken(sessionToken);

  const envPath = path.join(process.cwd(), ".env");
  upsertEnvVar(envPath, "CURSOR_SESSION_TOKEN", sessionToken);
  upsertEnvVar(envPath, "CURSOR_USER_ID", String(verified.numericUserId));
  if (!fs.readFileSync(envPath, "utf8").includes("CURSOR_TEAM_ID=")) {
    upsertEnvVar(envPath, "CURSOR_TEAM_ID", "0");
  }

  console.log(
    `[sync-token] Synced session for ${verified.email} (${verified.membershipType}, user ${verified.numericUserId}).`,
  );
  console.log("[sync-token] Updated .env — restart `npm run dev` if it is running.");
}

main().catch((err) => {
  console.error("[sync-token] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
