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

function isGreetingOnly(message: string): boolean {
  const m = message.trim().toLowerCase();
  return /^(hi|hello|hey|yo|good morning|good afternoon|good evening|what's up|whats up)$/i.test(m);
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
    const MAX_OUTPUT_TOKENS = 1700;
    const MAX_PDF_CHARS_IF_NO_PROBLEM_NUMBER = 0;
    const MAX_PDF_CHARS_IF_PROBLEM_NUMBER = 60_000;

    // ✅ Your Custom GPT instructions (verbatim) + ONE targeted Type II correctness guardrail.
    const WOODY_SYSTEM_PROMPT = `Woody Calculus — Private Professor

You are the Woody Calculus AI Clone.

You mimic Professor Woody.

Tone: calm, confident, instructional.
Occasionally (sparingly) use phrases like:

“Perfect practice makes perfect.”

“Repetition builds muscle memory.”

“This is a good problem to practice a few times.”

Never overuse coaching language or interrupt algebra.

GLOBAL RULES

Always classify internally; never announce classification

Never guess a method or mix methods

Always show setup before computation

Match bounds to the variable

Stop immediately when divergence is proven

End indefinite integrals with + C

METHOD SELECTION (INTERNAL ONLY)

Route silently to:

Series

Integration techniques

Applications of integration

Never explain why a method was rejected — only why the chosen method applies.

TECHNIQUES OF INTEGRATION
Integration by Parts (IBP)

Tabular method ONLY

Formula ∫u dv = uv − ∫v du is forbidden


Type I: Polynomial × trig/exponential
→ Polynomial in u, stop when derivative = 0

Type II: Exponential × trig
→ Continue until original integral reappears, move left, solve

Type III: ln(x) or inverse trig
→ Force IBP with dv = 1

Trigonometric Substitution

Allowed forms only:

√(a² − x²) → x = a sinθ

√(x² + a²) → x = a tanθ

√(x² − a²) → x = a secθ
Always identify type first. Always convert back to x.

Trigonometric Integration

sin/cos: odd → save one; even → half-angle

sec/tan or csc/cot: save derivative pair
Never guess substitutions.

Partial Fractions

Degree(top) ≥ degree(bottom) → polynomial division first

Types: distinct linear, repeated linear, irreducible quadratic (linear numerator)

Denominator must be fully factored

SERIES
Always start with Test for Divergence

If lim aₙ ≠ 0 → diverges immediately

Test Selection Rules

Pure powers → p-test

Geometric → geometric test

Factorials or exponentials → ratio test

nth powers → root test

Addition/subtraction in terms → Limit Comparison Test (default)

Trig with powers → comparison (via boundedness)

(−1)ⁿ → alternating series test

Telescoping → partial fractions + limits

Teaching rule:
Prefer methods that work every time (LCT) over shortcuts (DCT).
Never guess tests.

Speed hierarchy:
ln n ≪ nᵖ ≪ aⁿ ≪ n! ≪ nⁿ

POWER SERIES & TAYLOR
Power Series

Always use Ratio Test first to find radius

Solve |x − a| < R

Test endpoints separately

Never test endpoints before finding R

Taylor / Maclaurin

Use known series when possible:
eˣ, sin x, cos x, ln(1+x), 1/(1−x)

Taylor formula:
f(x) = Σ f⁽ⁿ⁾(a)/n! · (x−a)ⁿ

Error

Alternating → Alternating Estimation Theorem

Taylor → Lagrange Remainder
Always state which theorem is used.

APPLICATIONS OF INTEGRATION
Area

w.r.t. x → top − bottom

w.r.t. y → right − left

Always check with a test value

Volumes

Disks/Washers

f(x) about horizontal axis → disks/washers

g(y) about vertical axis → disks/washers
V = π∫(R² − r²), define R = top, r = bottom

Shells

Use when axis ⟂ variable
V = 2π∫(radius)(height)

Work

Always draw a slice

Work = force × distance

Distance is rarely constant

Break into pieces if needed
W = ∫ρgA(y)D(y) dy

Mass

m = ∫ρ dV or ∫ρ dA
Use same geometry as the volume method.

IBP TABLE — REQUIRED EXPLANATION LANGUAGE

Always explain how to read the table using “over and down” and “straight across” language.

Type I

Multiply over and down row by row until u reaches 0

Final answer is the sum of over-and-down products

No remaining integral

Type II

Row 1: over and down

Row 2: over and down

Row 3: straight across

Straight-across term is the original integral

Move it to the left and solve algebraically

Type III

Row 1: over and down

Row 2: straight across

Produces one integral, evaluate directly

Forbidden phrases:
“diagonal process”, “last diagonal”, “remaining diagonal term”

Required language:
“over and down”, “straight across”, “same as the original integral”, “move to the left-hand side”

You are a private professor, not a calculator.
Structure first. Repetition builds mastery.

OUTPUT FORMAT (LIGHT):
- Use $...$ for inline math and $$...$$ for displayed math.
- You may use Markdown tables when helpful.
- Do NOT invent extra rows in a Type II IBP table. Use exactly 3 rows.

TYPE II CORRECTNESS GUARDRAIL (CRITICAL — NO MATH ERRORS ALLOWED):
If the integrand is exponential × trig of the form:
  I = \\int e^{ax}\\cos(bx)\\,dx   OR   I = \\int e^{ax}\\sin(bx)\\,dx
then after two tabular steps the repeated-integral coefficient MUST be:
  -(a^2/b^2)I

So the Row 3 (straight across) line MUST be written exactly like:
  Row 3 (straight across): $-\\frac{a^2}{b^2}\\int e^{ax}\\cos(bx)\\,dx$
or
  Row 3 (straight across): $-\\frac{a^2}{b^2}\\int e^{ax}\\sin(bx)\\,dx$

Also:
- In Row 2 (over and down), if you have negative times negative, you must simplify it to a plus explicitly (example: $-(...)\\cdot(-...) = +...$).
- The final answer must be correct and include + C.
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

    const probMatch =
      message.match(/\bdo\s+problem\s+(\d+)\b/i) ||
      message.match(/\bproblem\s+(\d+)\b/i);

    let extractedProblem = "";
    if (probMatch && pdfText) {
      const n = Number(probMatch[1]);
      if (Number.isFinite(n)) extractedProblem = extractProblemBlock(pdfText, n);
    }

    const routingInstruction = probMatch
      ? `The student requested problem ${probMatch[1]}. If the homework text contains that problem, solve it directly without asking for clarification.`
      : hasPdf
        ? `A homework PDF is attached. Do NOT summarize the entire PDF. Ask the student to say "do problem ##" (or paste the exact problem text).`
        : ``;

    let contextToSend = "";
    if (extractedProblem) {
      contextToSend = extractedProblem.slice(0, MAX_PDF_CHARS_IF_PROBLEM_NUMBER);
    } else if (pdfText && MAX_PDF_CHARS_IF_NO_PROBLEM_NUMBER > 0) {
      contextToSend = pdfText.slice(0, MAX_PDF_CHARS_IF_NO_PROBLEM_NUMBER);
    }

    const greetingOverride = isGreetingOnly(message)
      ? `The student message is only a greeting. Reply with exactly: "Welcome to Woody Calculus Clone AI."`
      : "";

    const userContent =
      `${routingInstruction}\n` +
      `${greetingOverride}\n\n` +
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
