// api/chat.ts
import formidable from "formidable";
import fs from "fs";
import { createRequire } from "module";

export const runtime = "nodejs";

export const config = {
  api: { bodyParser: false },
};

const require = createRequire(import.meta.url);

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
 * Extract a single numbered problem block from text.
 * Finds "16)" or "16." at the start of a line and captures until next numbered item.
 */
function extractProblemBlock(text: string, n: number): string {
  const escaped = String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`(^|\\n)\\s*${escaped}\\s*[\\)\\.]\\s*`, "m");
  const m = startRe.exec(text);
  if (!m || m.index == null) return "";

  const startIdx = m.index + (m[1] ? m[1].length : 0);
  const rest = text.slice(startIdx);

  const nextIdx = rest.slice(1).search(/\n\s*\d+\s*[\)\.]\s*/m);
  const endIdx = nextIdx === -1 ? text.length : startIdx + 1 + nextIdx;

  return text.slice(startIdx, endIdx).trim();
}

// Conservative trigger for allowing IBP-table mode
function shouldAllowIbpTable(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("integration by parts") || m.includes("ibp") || m.includes("tabular")) return true;

  const hasTrig = /\bsin\b|\bcos\b|\btan\b|\bsec\b|\bcsc\b|\bcot\b/.test(m);
  const hasExp = /\be\^|\bexp\b/.test(m);
  const hasLn = /\bln\b|\blog\b/.test(m);
  const hasPoly = /\bx\s*\^?\s*\d*\b/.test(m) || /\bx\b/.test(m);

  return (hasExp && hasTrig) || (hasPoly && (hasTrig || hasExp || hasLn));
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
    const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;

    // Cost control:
    const MAX_OUTPUT_TOKENS = 1400;
    const MAX_PDF_CHARS_IF_NO_PROBLEM_NUMBER = 0;
    const MAX_PDF_CHARS_IF_PROBLEM_NUMBER = 60_000;

    // ✅ Inline prompt (safe for Vercel)
    const WOODY_SYSTEM_PROMPT = `Woody Calculus — Private Professor

IDENTITY (STRICT)
- Display name: Professor Woody AI Clone
- You are not ChatGPT. You are not a generic tutor.

GREETING RULE (CRITICAL)
- ONLY greet if the student’s message is ONLY a greeting (examples: "hi", "hello", "hey", "good morning", "what’s up").
- If the student asks ANY math question, DO NOT greet. Begin immediately with method + setup.
- If you DO greet, say exactly: "Welcome to Woody Calculus Clone AI."
- Never say: "Welcome to Calculus II"
- Never say: "How can I help you today?"

Tone: calm, confident, instructional.
Sparingly: "Perfect practice makes perfect." / "Repetition builds muscle memory."

ABSOLUTE OUTPUT RULES
- All math must be in LaTeX: $...$ inline and $$...$$ for display.
- Do NOT use unicode superscripts like x². Use LaTeX: $x^2$.
- End every indefinite integral with + C.

IBP RULES (always)
- Tabular reasoning only. Never state the IBP formula.
- MUST begin by naming the IBP type explicitly (Type I / II / III).
- Required language: “over and down”, “straight across”, “same as the original integral”, “move to the left-hand side”.
`;

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

      ({ fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
        form.parse(req, (err: any, flds: any, fls: any) => {
          if (err) reject(err);
          else resolve({ fields: flds, files: fls });
        });
      }));
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
    // Parse PDFs (only if present)
    // -------------------------
    const fileList = collectFiles(files);
    const hasPdf = fileList.some((f) => f?.mimetype === "application/pdf" && f?.filepath);

    let pdfText = "";

    if (hasPdf) {
      let pdfParse: ((data: Buffer) => Promise<{ text: string }>) | null = null;
      try {
        pdfParse = require("pdf-parse");
      } catch (e: any) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(
          `Server error: could not load pdf-parse.\n` +
            `Make sure it exists in dependencies.\n` +
            `${e?.message || e}`
        );
        return;
      }

      for (const f of fileList) {
        try {
          if (!f) continue;
          if (typeof f.size === "number" && f.size > MAX_FILE_SIZE_BYTES) continue;
          if (f.mimetype !== "application/pdf" || !f.filepath) continue;

          const buf = fs.readFileSync(f.filepath);
          const parsed = await pdfParse(buf);
          if (parsed?.text) pdfText += `\n\n${parsed.text}`;
        } catch {
          // ignore per-file parse errors
        }
      }
    }

    // -------------------------
    // If user asked for "problem ##", extract only that block.
    // -------------------------
    const probMatch =
      message.match(/\bdo\s+problem\s+(\d+)\b/i) ||
      message.match(/\bproblem\s+(\d+)\b/i);

    let extractedProblem = "";
    if (probMatch && pdfText) {
      const n = Number(probMatch[1]);
      if (Number.isFinite(n)) extractedProblem = extractProblemBlock(pdfText, n);
    }

    const allowIbpTable = shouldAllowIbpTable(message);

    // ✅ THIS is the important fix: enforce YOUR Type II table semantics
    const tableModeGuardrails = allowIbpTable
      ? `
IBP TABLE MODE (ONLY if you actually use IBP):
- You may include AT MOST ONE table total.
- If you use IBP, you MUST state the IBP type first.

TYPE II (exponential × trig) — REQUIRED TABLE FORMAT (Woody standard):
- Output EXACTLY ONE 3-row table with columns: sign | u | dv
- The sign column must be exactly: + then − then + (plain symbols only).
- u column must be the exponential factor repeated each row (example: e^x, e^{3x}, etc.).
- dv column must be the INTEGRATED trig sequence (v-values), NOT the original dv.
  Examples:
  - If trig is cos(ax), dv column must start with sin(ax)/a, then -cos(ax)/a^2, then -sin(ax)/a^3.
  - If trig is sin(ax), dv column must start with -cos(ax)/a, then -sin(ax)/a^2, then cos(ax)/a^3.
- ABSOLUTELY FORBIDDEN in the dv column: any "dx", any "\\,dx", any "d x".
- Do NOT label anything as "dv = ... dx" in the table. The dv column is the v-sequence only.

After the single table, you must say:
- “Multiply over and down on the first row.”
- “Multiply over and down on the second row.”
- “Multiply straight across on the third row to get the last integral.”
- “That last integral is the same as the original integral. Move it to the left-hand side and solve.”

TYPE I and TYPE III:
- If you include a table, one table max. No recursion tables. No extra junk.

`
      : `
HARD OUTPUT CONSTRAINTS:
- Do NOT output any tables (no Markdown tables, no ASCII tables, no columns).
`;

    const routingInstruction = probMatch
      ? `The student requested problem ${probMatch[1]}. If the homework text contains that problem, solve it directly without asking for clarification.`
      : hasPdf
        ? `A homework PDF is attached. For cost control, do NOT summarize the entire PDF. If the student did not specify a problem number, ask them to say "do problem ##" (or paste the exact problem text).`
        : ``;

    let contextToSend = "";
    if (extractedProblem) {
      contextToSend = extractedProblem.slice(0, MAX_PDF_CHARS_IF_PROBLEM_NUMBER);
    } else if (pdfText && MAX_PDF_CHARS_IF_NO_PROBLEM_NUMBER > 0) {
      contextToSend = pdfText.slice(0, MAX_PDF_CHARS_IF_NO_PROBLEM_NUMBER);
    }

    const userContent =
      `${tableModeGuardrails}\n` +
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

    const model = process.env.OPENAI_MODEL || "gpt-4o";

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
      res.write(`Upstream error (${upstream.status}): ${text.slice(0, 1200)}`);
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
    res.end(`Server error: ${err?.message || "unknown"}\n${err?.stack || ""}`);
  }
}
