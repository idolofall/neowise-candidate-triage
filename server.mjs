import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const MODEL_TIMEOUT_MS = 300;
const TOPICS = new Set(["delivery", "pricing", "other"]);
const manualReview = { status: "manual_review", topic: null, draft: null };

export function parseInput(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const text = data.text;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text.trim();
}

export function interpretModel(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return manualReview;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return manualReview;
  const { topic, draft } = data;
  if (!TOPICS.has(topic)) return manualReview;
  if (typeof draft !== "string" || draft.trim() === "") return manualReview;
  return { status: "ready", topic, draft: draft.trim() };
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function classifyWithTimeout(text) {
  const controller = new AbortController();
  let settled = false;
  let timer;
  return new Promise((resolve, reject) => {
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    };
    timer = setTimeout(() => {
      controller.abort();
      finish(reject, new Error("timeout"));
    }, MODEL_TIMEOUT_MS);
    classify(text, { signal: controller.signal }).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

async function handleTriage(request, response) {
  const text = parseInput(await readBody(request));
  if (text === null) return json(response, 400, { status: "invalid_input" });
  try {
    const modelRaw = await classifyWithTimeout(text);
    return json(response, 200, interpretModel(modelRaw));
  } catch {
    return json(response, 200, manualReview);
  }
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      if (!response.headersSent) json(response, 500, { status: "server_error" });
    }
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
