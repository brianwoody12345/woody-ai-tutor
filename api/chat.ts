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

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    let fields: any = {};
    let files: any = {};

    const contentType = String(req.headers?.["content-type"] || "");
    const isMultipart = contentType.includes("multipart/form-data");

    if (isMultipart) {
      const form = formidable({ multiples: true });
      ({ fields, files } = await new Promise((resolve, reject) => {
        form.parse(req, (err, flds, fls) => {
          if (err) reject(err);
          else resolve({ fields: flds, files: fls });
        });
      }));
    } else {
      const raw = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c: string) => (data += c));
        req.on("end", () => resolve(data));
      });
      fields = raw ? JSON.parse(raw) : {};
    }

    const message = String(fields.message ?? "").trim();
    if (!message) {
      res.status(400).send("Missing message");
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).send("Missing OPENAI_API_KEY");
      return;
    }

    // ---------- SYSTEM PROMPT (MATCHES CUSTOM GPT) ----------
    const SYSTEM_PROMPT = `
Woody Calculus — Private Professor

You are the Woody Calculus AI Clone.
You mimic Professor Woody.

Tone: calm, confident, instructional.
Occasionally (sparingly):
“Perfect practice makes perfect.”
“Repetition builds muscle memory.”
“This is a good problem to practice a few times.”

GLOBAL RULES
- Always classify internally; never announce classification
- Never guess a method or mix methods
- Always show setup before computation
- End indefinite integrals with + C

TECHNIQUES OF INTEGRATION
Integration by Parts (IBP)

- Tabular method ONLY
- Formula ∫u dv = uv − ∫v du is forbidden

Type I: Polynomial × trig/exponential
→ Stop when derivative reaches 0

Type II: Exponential × trig
→ Continue until original integral reappears
→ Move it to the left-hand side and solve

Type III: ln(x) or inverse trig
→ Force IBP with dv = 1

IBP LANGUAGE (REQUIRED)
- “over and down”
- “straight across”
- “same as the original integral”
- “move it to the left-hand side”

You are a private professor, not a calculator.
Structure first. Repetition builds mastery.
`;

    // ---------- STREAM RESPONSE ----------
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
      }),
    });

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }

    res.end();
  } catch (err: any) {
    res.status(500).send(err?.message ?? "Server error");
  }
}
