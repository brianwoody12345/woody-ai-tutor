// api/chat.ts
export const runtime = "nodejs";

// IMPORTANT: disable Next's bodyParser so we can reliably read the raw body
export const config = {
  api: { bodyParser: false },
};

function readRawBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function tryParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tryParseUrlEncoded(raw: string): Record<string, string> | null {
  try {
    const params = new URLSearchParams(raw);
    const obj: Record<string, string> = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return Object.keys(obj).length ? obj : null;
  } catch {
    return null;
  }
}

function extractMessage(body: any, raw: string, query: any): string {
  // Querystring fallback: /api/chat?message=...
  if (typeof query?.message === "string" && query.message.trim()) return query.message.trim();
  if (typeof query?.content === "string" && query.content.trim()) return query.content.trim();

  // Common JSON shapes
  if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body?.content === "string" && body.content.trim()) return body.content.trim();

  // Chat-style array
  if (Array.isArray(body?.messages) && body.messages.length) {
    const joined = body.messages
      .map((m: any) => (typeof m?.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (joined) return joined;
  }

  // Last resort: raw body as plain text
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  return "";
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Missing OPENAI_API_KEY");
      return;
    }

    // Read raw body, then parse as JSON or form data if possible
    const raw = await readRawBody(req);
    const parsedJson = raw ? tryParseJson(raw) : null;
    const parsedForm = !parsedJson && raw ? tryParseUrlEncoded(raw) : null;
    const body = parsedJson ?? parsedForm ?? {};

    const message = extractMessage(body, raw, req.query);

    if (!message) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "Missing message",
          debug: {
            contentType: req.headers?.["content-type"] ?? null,
            rawLength: raw?.length ?? 0,
            queryKeys: Object.keys(req.query ?? {}),
            parsedKeys: Object.keys(body ?? {}),
          },
        })
      );
      return;
    }

    const SYSTEM_PROMPT = `
Woody Calculus — Private Professor

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

REQUIRED IBP TABLE FORMAT (CRITICAL)
- Whenever you show a tabular IBP setup, the table MUST include a LEFTMOST sign column.
- The signs MUST alternate +, −, +, −, ... starting with +.
- For Type II (exponential × trig), show EXACTLY 3 rows: +, −, +.
- The table MUST be rendered as a LaTeX array so it displays nicely:

$$
\\begin{array}{c|c|c}
\\text{sign} & \\text{differentiate} & \\text{integrate} \\\\
\\hline
+ & \\cdots & \\cdots \\\\
- & \\cdots & \\cdots \\\\
+ & \\cdots & \\cdots
\\end{array}
$$

TYPE II READING RULE (CRITICAL)
- Row 1 (over and down): multiply the sign, the differentiate entry, and the integrate entry.
- Row 2 (over and down): multiply the sign, the differentiate entry, and the integrate entry.
  If there is a negative in the integrate entry, show the simplification: negative × negative = positive.
- Row 3 (straight across): this must produce the repeated integral term:
  (coefficient) · \\int (original integrand) \\, dx
  The coefficient MUST include the sign from Row 3 AND the numeric coefficient coming from the third integrate entry.
- Then say: “That last integral is the same as the original integral. Move it to the left-hand side and solve.”
`;

    // Stream response as plain text (so your UI shows it correctly)
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-2024-08-06",
        stream: true,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message },
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
