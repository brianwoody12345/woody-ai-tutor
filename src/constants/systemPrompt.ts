// api/chat.ts
import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";

export const config = {
  api: {
    bodyParser: false,
  },
};

// 🔒 YOUR EXACT SYSTEM PROMPT — VERBATIM
const WOODY_SYSTEM_PROMPT = `
Woody Calculus Clone AI — Private Professor

You teach Calculus 2 using structure, repetition, and method selection, not shortcuts. 
For other math subject, use your best judgement. 
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

Always identify type first.
Always convert back to x.

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

Always use Ratio Test first to find radius
Solve |x − a| < R
Test endpoints separately

Taylor formula:
f(x) = Σ f⁽ⁿ⁾(a)/n! · (x−a)ⁿ

APPLICATIONS OF INTEGRATION

Area:
w.r.t. x → top − bottom
w.r.t. y → right − left

Volumes:
Disks/Washers and Shells per standard rules

Work and Mass:
Use correct geometry and setup

IBP TABLE — REQUIRED LANGUAGE

Use “over and down” and “straight across”
Forbidden phrases:
“diagonal process”, “last diagonal”, “remaining diagonal term”

Required language:
“over and down”
“straight across”
“same as the original integral”
“move to the left-hand side”

You are a private professor, not a calculator.
Structure first. Repetition builds mastery.
`;

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const MAX_FILES = 5;
    const MAX_FILE_SIZE = 3 * 1024 * 1024;
    const MAX_TOKENS = 2500;

    let fields: any = {};
    let files: any = {};

    const isMultipart =
      String(req.headers["content-type"] || "").includes("multipart/form-data");

    if (isMultipart) {
      const form = formidable({
        multiples: true,
        maxFiles: MAX_FILES,
        maxFileSize: MAX_FILE_SIZE,
      });

      ({ fields, files } = await new Promise<{ fields: any; files: any }>(
        (resolve, reject) => {
          form.parse(req, (err, flds, fls) => {
            if (err) reject(err);
            else resolve({ fields: flds, files: fls });
          });
        }
      ));
    } else {
      const raw = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      fields = raw ? JSON.parse(raw) : {};
    }

    const message = String(fields.message || "").trim();
    if (!message) {
      res.status(400).send("Missing message");
      return;
    }

    let extractedText = "";

    const fileList: any[] = [];
    for (const key in files) {
      const f = files[key];
      if (Array.isArray(f)) fileList.push(...f);
      else if (f) fileList.push(f);
    }

    for (const f of fileList) {
      if (f.mimetype === "application/pdf" && f.filepath) {
        const buffer = fs.readFileSync(f.filepath);
        const pdf = await pdfParse(buffer);
        extractedText += `\n\n${pdf.text}`;
      }
    }

    const match = message.match(/problem\s+(\d+)/i);
    const routingInstruction =
      match && extractedText
        ? `Find and solve problem ${match[1]} from the uploaded homework.`
        : "";

    const userContent = `
${routingInstruction}

Student question:
${message}

Homework text:
${extractedText}
`;

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
    });

    const upstream = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4-0125-preview", // closest to GPT-5.2 behavior
          stream: true,
          temperature: 0.0,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: "system", content: WOODY_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      }
    );

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const line = chunk
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!line) continue;

        const data = line.replace("data:", "").trim();
        if (data === "[DONE]") {
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch {}
      }
    }

    res.end();
  } catch (err: any) {
    res.status(500).send(`Server error: ${err.message}`);
  }
}
