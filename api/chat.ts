// api/chat.ts
import formidable from "formidable";
import fs from "fs";

export const runtime = "nodejs";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Vercel Node Serverless Function
// Streams plain text (frontend concatenates chunks)
export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return;
    }

    const MAX_FILES = 5;
    const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB
    const MAX_TEXT_FROM_FILE = 50_000; // chars
    const MAX_OUTPUT_TOKENS = 2500;

    // -----------------------------
    // Parse request body
    // -----------------------------
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
    const systemPrompt = String(fields.systemPrompt ?? "").trim();
    const topic = String(fields.topic ?? "").trim();
    const showSetupFirst = String(fields.showSetupFirst ?? "false") === "true";
    const woodyCoaching = String(fields.woodyCoaching ?? "true") === "true";

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

    // -----------------------------
    // Gather uploaded files (text only)
    // -----------------------------
    const fileList: any[] = [];
    for (const key of Object.keys(files || {})) {
      const v = files[key];
      if (Array.isArray(v)) fileList.push(...v);
      else if (v) fileList.push(v);
    }

    if (fileList.length > MAX_FILES) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`Too many files (max ${MAX_FILES})`);
      return;
    }

    let fileContext = "";
    for (const f of fileList) {
      if (!f) continue;

      const filename = f.originalFilename || "upload";
      const mimetype = f.mimetype || "application/octet-stream";
      const size = f.size || 0;

      if (size > MAX_FILE_SIZE_BYTES) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`File too large: ${filename}`);
        return;
      }

      if (String(mimetype).startsWith("text/") && f.filepath) {
        try {
          const raw = fs.readFileSync(f.filepath, "utf8");
          const clipped = raw.slice(0, MAX_TEXT_FROM_FILE);
          fileContext += `\n\n[File: ${filename}]\n${clipped}`;
          if (raw.length > clipped.length) fileContext += "\n[...truncated...]";
        } catch {
          fileContext += `\n\n[File: ${filename}] (Could not read contents)`;
        }
      }
    }

    // -----------------------------
    // Build user content
    // -----------------------------
    const coachingLine = woodyCoaching
      ? "Coaching phrases allowed (sparingly)."
      : "Do not include coaching phrases.";

    const setupLine = showSetupFirst
      ? "Show setup clearly before computation."
      : "Still show setup before computation.";

    const userContent =
      `Topic: ${topic || "general"}\n` +
      `${setupLine}\n` +
      `${coachingLine}\n\n` +
      `Student question:\n${message}` +
      (fileContext ? `\n\nUploads:\n${fileContext}` : "");

    // -----------------------------
    // Prepare streaming response
    // -----------------------------
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,

        // 🔒 CRITICAL FIX
        temperature: 0.0,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,

        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: systemPrompt || "You are a helpful tutor." },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      res.write(`Upstream error (${upstream.status}): ${text.slice(0, 500)}`);
      res.end();
      return;
    }

    // -----------------------------
    // Stream OpenAI SSE → client
    // -----------------------------
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
          // Ignore malformed chunks
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
