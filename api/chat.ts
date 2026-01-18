// api/chat.ts
// Vercel Serverless Function (works without @vercel/node)
// Returns PLAIN TEXT (not JSON) because your frontend is currently displaying raw JSON as "garbage".

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

Type I
Multiply over and down row by row until u reaches 0
Final answer is the sum of over-and-down products
No remaining integral

Type II
Row 1: over and down
Row 2: over and down
Row 3: straight across
Straight-across term is the original integral
Move it to the left-hand side and solve algebraically

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

OUTPUT REQUIREMENTS (IMPORTANT)
- When you use IBP tabular method, you MUST print a markdown table with a FIRST COLUMN named "sign".
- The sign column MUST explicitly alternate +, −, +, − ... starting with +.
- For Type II, stop at exactly 3 rows (so the third row is the straight-across repeated integral).
- When you form the straight-across term, include the SIGN and the coefficient correctly.
- Use the exact section headings:
  "We are integrating", "Method", "Setup (IBP Table)", "Read the table", "Write the equation",
  "Move the repeated integral to the left-hand side", "Solve", "Final Answer:"
`;

// Read raw body safely (fixes your: Missing message / receivedBody {} )
async function readJsonBody(req: any): Promise<any> {
  try {
    if (req.body && typeof req.body === "object") return req.body;

    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (c: Uint8Array) => chunks.push(c));
      req.on("end", () => resolve());
      req.on("error", (e: any) => reject(e));
    });

    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Extract a user prompt from many possible frontend shapes
function extractUserMessage(body: any): string {
  // Common patterns:
  // { message: "..." }
  // { prompt: "..." }
  // { input: "..." }
  // { messages: [{role, content}, ...] }
  // { messages: [...], message: "..." }
  if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body?.prompt === "string" && body.prompt.trim()) return body.prompt.trim();
  if (typeof body?.input === "string" && body.input.trim()) return body.input.trim();

  if (Array.isArray(body?.messages) && body.messages.length) {
    // take last user message
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const m = body.messages[i];
      if (m?.role === "user" && typeof m?.content === "string" && m.content.trim()) {
        return m.content.trim();
      }
    }
    // fallback: any last content string
    const last = body.messages[body.messages.length - 1];
    if (typeof last?.content === "string" && last.content.trim()) return last.content.trim();
  }

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

    const body = await readJsonBody(req);
    const userMessage = extractUserMessage(body);

    if (!userMessage) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "Missing message",
          receivedKeys: body ? Object.keys(body) : [],
          receivedBody: body ?? null,
        })
      );
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Server misconfigured: missing OPENAI_API_KEY");
      return;
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-2024-08-06";

    // Call OpenAI Responses API (simple, stable)
    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        // Keep it deterministic-ish (helps match your custom GPT more closely)
        temperature: 0.2,
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text().catch(() => "");
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`OpenAI error (${openaiResp.status}): ${errText}`);
      return;
    }

    const data: any = await openaiResp.json();

    // Extract text safely from Responses API
    let text = "";

    // Preferred: output_text if present
    if (typeof data?.output_text === "string") {
      text = data.output_text;
    } else if (Array.isArray(data?.output)) {
      // Fallback: walk output blocks
      for (const item of data.output) {
        if (item?.type === "message" && Array.isArray(item?.content)) {
          for (const c of item.content) {
            if (c?.type === "output_text" && typeof c?.text === "string") {
              text += c.text;
            }
          }
        }
      }
    }

    text = (text || "").trim();

    if (!text) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("OpenAI returned no text.");
      return;
    }

    // IMPORTANT: return plain text (your UI currently shows JSON as text)
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Server error: ${e?.message || "unknown error"}`);
  }
}
