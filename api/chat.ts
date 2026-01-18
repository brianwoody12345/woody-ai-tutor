// api/chat.ts
export const runtime = "nodejs";

async function readJsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: any) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = await readJsonBody(req);

    const message =
      body.message ??
      body.content ??
      (Array.isArray(body.messages)
        ? body.messages.map((m: any) => m.content).join("\n")
        : null);

    if (!message || typeof message !== "string") {
      res.status(400).json({
        error: "Missing message",
        receivedBody: body,
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
Addition/subtraction → Limit Comparison Test
Trig → comparison
(−1)ⁿ → alternating series test
Telescoping → partial fractions + limits

Teaching rule:
Prefer methods that work every time (LCT) over shortcuts (DCT).

Speed hierarchy:
ln n ≪ nᵖ ≪ aⁿ ≪ n! ≪ nⁿ

POWER SERIES & TAYLOR
(use your full rules exactly as before)

APPLICATIONS OF INTEGRATION
(use your full rules exactly as before)

IBP TABLE LANGUAGE
(over and down, straight across, move to the left-hand side)

You are a private professor, not a calculator.
Structure first. Repetition builds mastery.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

    const data = await response.json();

    const content =
      data?.choices?.[0]?.message?.content ??
      "No response from model.";

    res.status(200).json({ content });
  } catch (err: any) {
    res.status(500).json({
      error: "Server error",
      details: err?.message ?? String(err),
    });
  }
}
