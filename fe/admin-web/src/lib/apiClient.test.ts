import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  apiPostForm,
  apiPut,
  clearStoredSession,
  getStoredSession,
  setStoredSession,
  type AdminSession,
} from "./apiClient";

const SESSION_STORAGE_KEY = "auto-grading-admin.session";

// jsdom's own localStorage getter is broken under this Node/jsdom combination
// (Node's experimental built-in `localStorage` global collides with jsdom's Storage
// implementation, so `window.localStorage` silently resolves to `undefined`). Stub a
// minimal in-memory Storage so the code under test (which references the bare
// `localStorage` global) has something functional to read/write.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  get length() {
    return this.store.size;
  }
}

const session: AdminSession = {
  token: "token-123",
  user: { id: "user-1", email: "a@b.com", role: "admin" },
};

function mockFetchOnce(response: Partial<Response> & { ok: boolean; status: number }) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("session storage helpers", () => {
  it("returns null when nothing is stored", () => {
    expect(getStoredSession()).toBeNull();
  });

  it("round-trips a session through localStorage", () => {
    setStoredSession(session);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(JSON.stringify(session));
    expect(getStoredSession()).toEqual(session);
  });

  it("returns null when stored value is not valid JSON", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "{not json");
    expect(getStoredSession()).toBeNull();
  });

  it("clears the stored session", () => {
    setStoredSession(session);
    clearStoredSession();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("ApiError", () => {
  it("carries status and message", () => {
    const error = new ApiError(404, "Not found");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Not found");
  });
});

describe("apiGet", () => {
  it("issues a GET request and returns parsed JSON", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    });

    const result = await apiGet<{ hello: string }>("/foo");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/foo");
    expect(init.method).toBe("GET");
  });

  it("attaches the Authorization header when a session token is stored", async () => {
    setStoredSession(session);
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiGet("/foo");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${session.token}`);
  });

  it("does not attach an Authorization header when there is no session", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiGet("/foo");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("returns undefined for a 204 No Content response without reading the body", async () => {
    const json = vi.fn();
    mockFetchOnce({ ok: true, status: 204, json });

    const result = await apiGet("/foo");

    expect(result).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("throws an ApiError with the parsed message on failure", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ message: "Invalid input" }),
    });

    await expect(apiGet("/foo")).rejects.toEqual(new ApiError(400, "Invalid input"));
  });

  it("falls back to title when message is absent", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ title: "Bad title" }),
    });

    await expect(apiGet("/foo")).rejects.toMatchObject({ status: 400, message: "Bad title" });
  });

  it("joins the errors array when present", async () => {
    mockFetchOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable",
      json: async () => ({ errors: ["Field A required", "Field B required"] }),
    });

    await expect(apiGet("/foo")).rejects.toMatchObject({
      status: 422,
      message: "Field A required\nField B required",
    });
  });

  it("falls back to statusText when the error body has no message/title/errors", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({}),
    });

    await expect(apiGet("/foo")).rejects.toMatchObject({ status: 500, message: "Server Error" });
  });

  it("falls back to statusText when the error body is not valid JSON", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });

    await expect(apiGet("/foo")).rejects.toMatchObject({ status: 500, message: "Server Error" });
  });
});

describe("apiPost / apiPatch / apiPut", () => {
  it("apiPost sends JSON body with Content-Type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "1" }) });

    const result = await apiPost<{ id: string }>("/things", { name: "abc" });

    expect(result).toEqual({ id: "1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/things");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "abc" }));
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("apiPost omits the body when none is provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiPost("/things");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("apiPatch sends a PATCH request with JSON body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await apiPatch("/things/1", { name: "xyz" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/things/1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "xyz" }));
  });

  it("apiPut sends a PUT request with JSON body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await apiPut("/things/1", { name: "xyz" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/things/1");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ name: "xyz" }));
  });
});

describe("apiPostForm", () => {
  it("sends FormData without setting Content-Type", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({ id: "1" }) });
    const form = new FormData();
    form.set("File", new Blob(["abc"]), "a.txt");

    const result = await apiPostForm<{ id: string }>("/upload", form);

    expect(result).toEqual({ id: "1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(form);
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });
});

describe("apiGetBlob", () => {
  it("returns a blob on success", async () => {
    const blob = new Blob(["file contents"]);
    const fetchMock = mockFetchOnce({ ok: true, status: 200, blob: async () => blob });

    const result = await apiGetBlob("/files/1");

    expect(result).toBe(blob);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5500/files/1");
    expect(init.headers).toBeInstanceOf(Headers);
  });

  it("attaches Authorization header when a session is stored", async () => {
    setStoredSession(session);
    const fetchMock = mockFetchOnce({ ok: true, status: 200, blob: async () => new Blob([]) });

    await apiGetBlob("/files/1");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${session.token}`);
  });

  it("throws ApiError on failure", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ message: "File missing" }),
    });

    await expect(apiGetBlob("/files/missing")).rejects.toEqual(new ApiError(404, "File missing"));
  });
});
