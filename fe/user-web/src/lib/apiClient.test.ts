import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node 26 introduces an experimental global `localStorage` accessor that shadows jsdom's
// working implementation (see the "--localstorage-file was not provided" warning). Vitest's
// jsdom environment only overrides globals it already knows about, so this pre-existing
// broken accessor wins and `localStorage` resolves to `undefined` in this test file unless
// we install a working in-memory polyfill ourselves.
if (typeof (globalThis as any).localStorage === "undefined") {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();

    get length() {
      return this.store.size;
    }

    clear(): void {
      this.store.clear();
    }

    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null;
    }

    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }

    removeItem(key: string): void {
      this.store.delete(key);
    }

    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

import {
  ApiError,
  apiGet,
  apiPost,
  apiPostForm,
  apiPut,
  clearStoredSession,
  getStoredSession,
  setStoredSession,
  type AppSession,
} from "./apiClient";

const SESSION_STORAGE_KEY = "auto-grading.session";

const sampleSession: AppSession = {
  token: "token-123",
  user: { id: "user-1", email: "alice@school.edu", role: "student" },
};

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: "",
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("stored session helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getStoredSession returns null when nothing is stored", () => {
    expect(getStoredSession()).toBeNull();
  });

  it("setStoredSession persists the session as JSON, and getStoredSession reads it back", () => {
    setStoredSession(sampleSession);

    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(JSON.stringify(sampleSession));
    expect(getStoredSession()).toEqual(sampleSession);
  });

  it("clearStoredSession removes the stored session", () => {
    setStoredSession(sampleSession);
    clearStoredSession();

    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("getStoredSession returns null and does not throw when stored value is malformed JSON", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "{not-json");

    expect(getStoredSession()).toBeNull();
  });
});

describe("ApiError", () => {
  it("shapes status, message, and body", () => {
    const error = new ApiError(404, "Not found", { detail: "missing" });

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Not found");
    expect(error.body).toEqual({ detail: "missing" });
  });

  it("defaults body to null when omitted", () => {
    const error = new ApiError(500, "Server error");

    expect(error.body).toBeNull();
  });
});

describe("apiGet/apiPost/apiPut/apiPostForm", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apiGet issues a GET request and returns parsed JSON on success", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ hello: "world" }));

    const result = await apiGet<{ hello: string }>("/some/path");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/some/path");
    expect(options?.method).toBe("GET");
  });

  it("apiPost sends a JSON-stringified body with Content-Type application/json", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const result = await apiPost<{ ok: boolean }>("/things", { a: 1 });

    expect(result).toEqual({ ok: true });
    const [, options] = fetchMock.mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(JSON.stringify({ a: 1 }));
    const headers = options?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("apiPost omits body when no body is passed", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiPost("/things");

    const [, options] = fetchMock.mock.calls[0];
    expect(options?.body).toBeUndefined();
    const headers = options?.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("apiPut sends a JSON-stringified body via PUT", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ updated: true }));

    const result = await apiPut<{ updated: boolean }>("/things/1", { name: "x" });

    expect(result).toEqual({ updated: true });
    const [, options] = fetchMock.mock.calls[0];
    expect(options?.method).toBe("PUT");
    expect(options?.body).toBe(JSON.stringify({ name: "x" }));
  });

  it("apiPostForm sends FormData without setting Content-Type", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ uploaded: true }));

    const form = new FormData();
    form.set("file", "content");

    const result = await apiPostForm<{ uploaded: boolean }>("/upload", form);

    expect(result).toEqual({ uploaded: true });
    const [, options] = fetchMock.mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(form);
    const headers = options?.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("injects Authorization header from stored session token", async () => {
    setStoredSession(sampleSession);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiGet("/secure");

    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("does not set Authorization header when there is no stored session", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiGet("/insecure");

    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("returns undefined for a 204 No Content response", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(null, { status: 204 }));

    const result = await apiGet("/no-content");

    expect(result).toBeUndefined();
  });

  it("throws ApiError with parsed JSON message/body on a non-ok JSON error response", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "Bad request details" }, { status: 400, ok: false }),
    );

    await expect(apiGet("/bad")).rejects.toMatchObject({
      status: 400,
      message: "Bad request details",
      body: { message: "Bad request details" },
    });
  });

  it("falls back to the 'title' field for the error message when 'message' is absent", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({ title: "Validation failed" }, { status: 422, ok: false }),
    );

    await expect(apiGet("/invalid")).rejects.toMatchObject({
      status: 422,
      message: "Validation failed",
    });
  });

  it("falls back to statusText and null body when the error response is not JSON", async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    } as unknown as Response;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response);

    await expect(apiGet("/broken")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
      body: null,
    });
  });

  it("rejected promise is actually an instance of ApiError", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, { status: 403, ok: false }));

    let caught: unknown;
    try {
      await apiGet("/forbidden");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
  });
});
