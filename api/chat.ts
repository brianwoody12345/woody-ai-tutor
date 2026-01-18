// api/chat.ts
import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";
import { WOODY_SYSTEM_PROMPT } from "../src/constants/systemPrompt";

export const runtime = "nodejs";

export const config = {
  api: {
    bodyParser: false,
  },
};

function collectFiles(files: any): any[] {
  const out: any[] = [];
  for (const key of Object.keys(files || {})) {
    const v = files[key];
    if (Array.isArray(v)) out.push(...v);
    else if (v) out.push(v);
  }
  return out;
}

/**
 * Extract a single numbered problem from plaintext.
 * Looks for "16)" or "16." at the start of a line and grabs until the next "17)" etc.
 */
function extractProblemBlock(text: string, n: number): string | "" {
  const escaped = String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`(^|\\n)\\s*${escaped}\\s*[\\)\\.]\\s*`, "m");
  const m = text.match(start);
  if (!m || m.index == null) return "";

  const startIdx = m.index + (m[1] ? m[1].length : 0);
  const rest = text.slice(startIdx);

  // Next problem: newline + spaces + digits + ) or .
  const next = rest.slice(1).search(/\n\s*\d+\s*[\)\.]\s*/m);
  const endIdx = next === -1 ? text.length : startIdx + 1 + next;

  return text.slice(startIdx, endIdx).trim();
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return;
    }

    const MAX_FILES = 5;
    const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB each
    const MAX_OUTPUT_TOKENS = 2500;

    let fields: any = {};
    let files: any = {};

    const contentType = String(req.headers?.["content-type"] || "");
    const isMultipart = contentType.includes("multipart/form-data");

    if (isMultipart) {
      const form = formidable({
        multiples: true,
        maxFiles: MAX_FILES,
        maxFileSize: MAX_FILE_SIZE_BYTES,
        allowEmptyFiles: true,
      });

      ({ fields, files } = await new Promise<{ fields: any; files: any }>(
        (resolve, reject) => {
          form.parse(req, (err: any, flds: any, fls: any) => {
            if (err) reject(err);
            else resolve({ fields: flds, files: fls });
          });
        }
      ));
    } else {
      const raw = await new Promise<string>((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });

      try {
        fields = raw ? JSON.parse(raw) : {};
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid JSON body");
        return;
      }
    }

    const message = String(fields.message ?? "").trim();
    if (!message) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Missing message");
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Server missing OPENAI_API_KEY");
      return;
    }

    // -------------------------
    // Extract PDF text from uploads
    // -------------------------
    const fileList = collectFiles(files);

    let pdfText = "";
    for (const f of fileList) {
      if (!f) continue;

      const size = f.size || 0;
      if (size > MAX_FILE_SIZE_BYTES) continue;

      if (f.mimetype === "application/pdf" && f.filepath) {
        const buf = fs.readFileSync(f.filepath);
        const parsed = await pdfParse(buf);
        pdfText += `\n\n${parsed.text || ""}`;
      }
    }

    // -------------------------
    // If user said "do problem 16", pull ONLY that problem
    // -------------------------
    const probMatch =
      message.match(/\bproblem\s+(\d+)\b/i) ||
      message.match(/\bdo\s+problem\s+(\d+)\b/i) ||
      message.match(/\b#\s*(\d+)\b/i);

    let extractedProblem = "";
    if (probMatch && pdfText) {
      const n = Number(probMatch[1]);
      if (Number.isFinite(n)) extractedProblem = extractProblemBlock(pdfText, n);
    }

    // Fallback: if we didn't find a clean block, still include some text
    const contextToSend =
      extractedProblem ||
      (pdfText ? pdfText.slice(0, 80_000) : ""); // clip to keep requests sane

    const routingInstruction = probMatch
      ? `The student requested problem ${probMatch[1]}. If the homework text contains that problem, solve it directly without asking for clarification.`
      : "";

    const userContent =
      `${routingInstruction}\n\n` +
      `Student message:\n${message}\n\n` +
      (contextToSend ? `Homework text (relevant):\n${contextToSend}\n` : "");

    // -------------------------
    // Stream response
    // -------------------------
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");

    const model = process.env.OPENAI_MODEL || "gpt-4o"; // set OPENAI_MODEL on Vercel if you want a specific one

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.0,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: WOODY_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      res.write(
        `Upstream error (${upstream.status}). ${text ? text.slice(0, 800) : ""}`
      );
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part
          .split("\n")
          .map((s) => s.trim())
          .find((s) => s.startsWith("data:"));
        if (!line) continue;

        const data = line.replace(/^data:\s*/, "");
        if (data === "[DONE]") {
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            res.write(delta);
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    res.end();
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Server error: ${err?.message || "unknown"}`);
  }
}
