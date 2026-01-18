// api/chat.ts
export const runtime = "nodejs";

// IMPORTANT: disable Next's bodyParser so we can read the raw body reliably.
export const config = {
  api: {
    bodyParser: false,
  },
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

function extractMessageFromAnySource(opts: {
  query?: any;
  parsed?: any;
  raw?: string;
}): string {
  const { query, parsed, raw } = opts;

  // 1) Querystring fallback (e.g., /api/chat?message=hi)
  const qMsg =
    (typeof query?.message === "string" && query.message) ||
    (typeof query?.content === "string" && query.content);
  if (qMsg) return qMsg;

  // 2) Parsed JSON or parsed form body
  const p = parsed ?? {};
  const m1 = typeof p.message === "string" ? p.message : null;
  if (m1) return m1;

  const m2 = typeof p.content === "string" ? p.content : null;
  if (m2) return m2;

  const m3 =
    Array.isArray(p.messages) && p.messages.length
      ? p.messages
          .map((x: any) => (typeof x?.content === "string" ? x.content : ""))
          .filter(Boolean)
          .join("\n")
      : null;
  if (m3) return m3;

  // 3) Raw body as plain text (last resort)
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  return "";
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Read raw body (works even if client forgot headers)
    const raw = await readRawBody(req);

    // Attempt parse in a robust order
    const parsedJson = raw ? tryParseJson(raw) : null;
    const parsedForm =
      !parsedJson && raw ? tryParseUrlEncoded(raw) : null;

    const parsed = parsedJson ?? parsedForm ?? {};

    // Extract message from query, parsed, or raw
    const message = extractMessageFromAnySource({
      query: req.query,
      parsed,
      raw,
    });

    if (!message) {
      res.status(400).json({
        error: "Missing message",
        debug: {
          method: req.method,
          url: req.url,
          queryKeys: Object.keys(req.query ?? {}),
          contentType: req.headers?.["content-type"] ?? null,
          rawLength: raw?.length ?? 0,
          parsedKeys: Object.keys(parsed ?? {}),
        },
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: "Missing OPENAI_API_KEY" });
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
`;

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
      }),
    });

    const data = await upstream.json();
    const content =
      data?.choices?.[0]?.message?.content ?? "No response from model.";

    res.status(200).json({ content });
  } catch (err: any) {
    res.status(500).json({
      error: "Server error",
      details: err?.message ?? String(err),
    });
  }
}
