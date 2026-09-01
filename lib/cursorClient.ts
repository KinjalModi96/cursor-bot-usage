const CURSOR_BASE = "https://cursor.com";

interface FetchOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULTS: Required<Omit<FetchOptions, "signal">> = {
  retries: 3,
  retryDelayMs: 600,
  timeoutMs: 12_000,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeSessionToken(raw: string): string {
  let token = raw.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  const prefix = "WorkosCursorSessionToken=";
  if (token.toLowerCase().startsWith(prefix.toLowerCase())) {
    token = token.slice(prefix.length).trim();
  }
  return token;
}

export function cursorCookie(): string | null {
  const token = process.env.CURSOR_SESSION_TOKEN?.trim();
  if (!token) return null;
  if (token.includes("=") && !token.startsWith("user_")) return token;
  return `WorkosCursorSessionToken=${normalizeSessionToken(token)}`;
}

export function requireCursorCookie(): string {
  const cookie = cursorCookie();
  if (!cookie) {
    throw new Error(
      "CURSOR_SESSION_TOKEN is not set. Copy the WorkosCursorSessionToken cookie value from cursor.com.",
    );
  }
  return cookie;
}

async function cursorRequest<T>(
  method: "GET" | "POST",
  path: string,
  options: FetchOptions = {},
  body?: unknown,
): Promise<T> {
  const cookie = requireCursorCookie();
  const cfg = { ...DEFAULTS, ...options };
  const url = `${CURSOR_BASE}${path}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    options.signal?.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Cookie: cookie,
        "User-Agent":
          "CursorUsageDashboard/1.0 (+https://github.com/vivek-kubvt/CUDashboard)",
      };
      if (method === "POST") {
        headers["Content-Type"] = "application/json";
        headers.Origin = "https://cursor.com";
        headers.Referer = "https://cursor.com/dashboard/usage";
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Cursor returned ${res.status}. The session token is missing/expired — refresh CURSOR_SESSION_TOKEN.`,
        );
      }
      if (!res.ok) {
        throw new Error(`Cursor ${path} returned ${res.status} ${res.statusText}`);
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Cursor ${path} returned non-JSON (${contentType || "no content-type"}). ` +
            `First 120 chars: ${text.slice(0, 120)}`,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < cfg.retries) {
        await sleep(cfg.retryDelayMs * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to fetch ${path}`);
}

export function cursorGet<T>(path: string, options?: FetchOptions): Promise<T> {
  return cursorRequest<T>("GET", path, options);
}

export function cursorPost<T>(
  path: string,
  body: unknown,
  options?: FetchOptions,
): Promise<T> {
  return cursorRequest<T>("POST", path, options, body);
}
