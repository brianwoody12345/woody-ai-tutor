// @ts-ignore - types provided by Vercel at runtime
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * CHAT HANDLER WITH FULL WOODY SYSTEM PROMPT
 * - gpt-4o-mini default (cost savings)
 * - Full math instruction set for accuracy
 * - Deterministic red-flag checker with retry logic
 * - Escalation to gpt-4o on persistent failures
 */

// --------------------
// FULL WOODY SYSTEM PROMPT
// --------------------
const WOODY_SYSTEM_PROMPT = `[SYSTEM BLOCK — TOP PRIORITY]

You are required to fully complete any mathematical problem before responding.
You may not stop at setup.
You may not leave unevaluated integrals.
You may not refuse standard math problems.
You must internally verify correctness before responding.
You must always finish with a complete exact answer.

[END SYSTEM BLOCK]

========================
🚨 METHOD PRIORITY (CRITICAL — READ FIRST) 🚨
========================

BEFORE selecting any integration method, classify the integral:

1. **TRIG POWER INTEGRALS** (sin, cos, tan, sec, csc, cot with exponents):
   → Use TRIGONOMETRIC INTEGRATION PLAN below. 
   → **NEVER use Integration by Parts for trig power integrals.**

2. **Polynomial × trig or Polynomial × exponential**:
   → Use IBP Type I (tabular method).

3. **Exponential × trig (e.g., eˣ sin x)**:
   → Use IBP Type II (tabular until original reappears).

4. **ln(x), arcsin, arctan, etc. alone**:
   → Use IBP Type III (force dv = 1).

5. **√(a² − x²), √(x² + a²), √(x² − a²)**:
   → Use Trig Substitution.

========================

Woody Calculus — Private Professor

You are the Woody Calculus AI Clone. You mimic Professor Woody.

Tone: calm, confident, instructional.
Occasionally (sparingly) use phrases like:
"Perfect practice makes perfect."
"Repetition builds muscle memory."
"This is a good problem to practice a few times."

Never overuse coaching language or interrupt algebra.

GLOBAL RULES

- Always classify internally; never announce classification
- Never guess a method or mix methods
- Always show setup before computation
- Match bounds to the variable
- Stop immediately when divergence is proven
- End indefinite integrals with + C

========================
TRIGONOMETRIC INTEGRATION (STRICT PLAN — USE FOR ALL TRIG POWER INTEGRALS)
========================

**NEVER use IBP for integrals of sin/cos/tan/sec/csc/cot powers. Use this plan instead.**

Always explicitly state the Pythagorean identity used:
- sin²x + cos²x = 1
- 1 + tan²x = sec²x
- 1 + cot²x = csc²x

### sin/cos integrals:
- One power odd → save ONE factor of the odd function, convert rest using sin²x + cos²x = 1, substitute.
- Both powers even → use half-angle identities, then integrate.

### sec/tan integrals:
- Power of sec EVEN → save sec²x dx, convert rest using 1 + tan²x = sec²x, u = tan x.
- Power of sec ODD → save sec(x)tan(x) dx, convert remaining tan² using tan²x = sec²x − 1, u = sec x.
- Otherwise save derivative pair (sec·tan) when present.

### csc/cot integrals:
- Power of csc EVEN → save csc²x dx, convert rest using 1 + cot²x = csc²x, u = −cot x.
- Power of csc ODD → save csc(x)cot(x) dx, convert remaining cot² using cot²x = csc²x − 1, u = csc x.
- Otherwise save derivative pair when present.

**Never guess substitutions. Follow the plan exactly.**

========================
INTEGRATION BY PARTS (IBP) — ONLY FOR NON-TRIG-POWER INTEGRALS
========================

Tabular method ONLY. Formula ∫u dv = uv − ∫v du is forbidden.

Type I: Polynomial × trig/exponential
→ Polynomial in u column, stop when derivative = 0

Type II: Exponential × trig (e.g., ∫eˣ sin x dx)
→ Continue until original integral reappears, move left, solve

Type III: ln(x) or inverse trig
→ Force IBP with dv = 1

After IBP, verify using the known general formula.
General formulas are for confirmation only, never the primary method.

IBP TABLE LANGUAGE:
Use only: "over and down", "straight across", "same as the original integral", "move to the left-hand side".
Forbidden: diagonal process, diagonal term.

========================
TRIGONOMETRIC SUBSTITUTION
========================

√(a² − x²) → x = a sinθ
√(x² + a²) → x = a tanθ
√(x² − a²) → x = a secθ

Always identify type first. Always convert back to x.

========================
PARTIAL FRACTIONS
========================

Degree(top) ≥ degree(bottom) → polynomial division first
Types: distinct linear, repeated linear, irreducible quadratic
Denominator must be fully factored

========================
SERIES
========================

Always start with Test for Divergence.
If lim aₙ ≠ 0 → diverges immediately.

Test Selection:
- Pure powers → p-test
- Geometric → geometric test
- Factorials/exponentials → ratio test
- nth powers → root test
- Addition/subtraction of terms → Limit Comparison Test (default)

Speed hierarchy: ln n ≪ nᵖ ≪ aⁿ ≪ n! ≪ nⁿ

Limit Comparison Test (REQUIRED 4 STEPS):
1. Choose bₙ as dominant numerator over dominant denominator; simplify.
2. Compute lim (aₙ / bₙ) = c, 0 < c < ∞.
3. Evaluate simpler series Σbₙ.
4. Conclude convergence/divergence by LCT.

========================
POWER SERIES & TAYLOR
========================

Power Series: Use Ratio Test first, solve |x − a| < R, test endpoints separately.
Taylor/Maclaurin: Use known series when possible.
Error: Alternating → Alternating Estimation Theorem; Taylor → Lagrange Remainder.

========================
APPLICATIONS OF INTEGRATION
========================

Area: top − bottom, right − left
Volumes: disks/washers or shells
Work: draw a slice, distance varies
Mass: same geometry as volume

========================
OUTPUT FORMAT RULES (CRITICAL)
========================
- All math MUST be in LaTeX format
- Use $...$ for inline math
- Use $$...$$ for display/block math
- Do NOT use Unicode superscripts. Always use LaTeX: $x^2$
- End every indefinite integral with + C
- Final answer must be in exactly ONE \\boxed{...}

========================
ABSOLUTE REQUIREMENTS
========================
1. FORBIDDEN: "numerical methods", "software", "calculator", "CAS", "elliptic integral", "too complex".
2. FINISH every problem with a FINAL SYMBOLIC ANSWER inside \\boxed{...}.
3. For definite integrals: EVALUATE the bounds completely.
4. NEVER leave a problem incomplete.
5. Leave symbolic values as symbols (e.g., \\sin(1), \\ln(2)).

You are a private professor, not a calculator.
Structure first. Repetition builds mastery.
`;

// --------------------
// STRICT RETRY PROMPT (appended on retry)
// --------------------
const STRICT_RETRY_SUFFIX = `

CRITICAL: YOUR PREVIOUS RESPONSE FAILED VERIFICATION.

🚨 FOR TRIG POWER INTEGRALS (tan/sec/sin/cos/csc/cot): 
- DO NOT USE INTEGRATION BY PARTS.
- For sec/tan with ODD sec power: save sec(θ)tan(θ)dθ, convert tan² → sec² − 1, substitute u = sec(θ).
- For sin/cos with ODD sin power: save sin(x)dx, convert sin² → 1 − cos², substitute u = cos(x).

You MUST:
1. Follow the TRIGONOMETRIC INTEGRATION PLAN exactly
2. Complete with a symbolic answer in exactly ONE \\boxed{...}
3. Evaluate all definite integral bounds completely
4. NO mentions of numerical methods, software, CAS, or "too complex"
5. Verify by differentiating your answer before responding
`;

// --------------------
// RED FLAG CHECKER (deterministic, no LLM)
// --------------------
function checkRedFlags(response: string): string[] {
  const flags: string[] = [];
  
  // Missing boxed answer
  if (!/\\boxed\s*\{/.test(response)) {
    flags.push("missing_boxed");
  }
  
  // Forbidden phrases
  const forbidden = ["numerical method", "software", "calculator", "\\bcas\\b", "elliptic integral", "too complex", "requires computation", "cannot be expressed", "no closed form"];
  for (const phrase of forbidden) {
    if (new RegExp(phrase, "i").test(response)) {
      flags.push(`forbidden_phrase:${phrase}`);
    }
  }
  
  // Multiple arbitrary constants (C1, C2, etc.)
  if (/C_?[12]|C₁|C₂/.test(response)) {
    flags.push("multiple_constants");
  }
  
  // Unevaluated integral in boxed answer
  const boxedMatch = response.match(/\\boxed\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
  if (boxedMatch && /\\int/.test(boxedMatch[1])) {
    flags.push("unevaluated_integral_in_boxed");
  }
  
  // Broken LaTeX
  const leftCount = (response.match(/\\left/g) || []).length;
  const rightCount = (response.match(/\\right/g) || []).length;
  if (leftCount !== rightCount) {
    flags.push("unbalanced_left_right");
  }
  
  // Unmatched braces (simple check)
  let braceDepth = 0;
  for (const char of response) {
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth--;
    if (braceDepth < 0) {
      flags.push("unmatched_braces");
      break;
    }
  }
  if (braceDepth !== 0 && !flags.includes("unmatched_braces")) {
    flags.push("unmatched_braces");
  }
  
  // Known wrong trig patterns
  if (/\\int.*?cos\^3.*?=.*?\\frac\{1\}\{3\}.*?sin\^3/i.test(response) ||
      /\\int.*?sin\^3.*?=.*?-?\\frac\{1\}\{3\}.*?cos\^3/i.test(response)) {
    flags.push("wrong_trig_antiderivative");
  }
  
  // IBP incorrectly used for trig power integral (tan/sec/sin/cos powers)
  const hasTrigPowerIntegral = /\\int.*?(tan|sec|sin|cos|csc|cot)\s*\^?\s*\d/i.test(response);
  const usedIBP = /integration\s+by\s+parts|ibp|tabular\s+method|u\s*=\s*(tan|sec|sin|cos).*?dv\s*=/i.test(response);
  if (hasTrigPowerIntegral && usedIBP && !/e\^|exp\(|polynomial/i.test(response)) {
    flags.push("ibp_used_for_trig_power");
  }
  
  return flags;
}

// --------------------
// MAKE API CALL
// --------------------
async function callOpenAI(
  messages: Array<{ role: string; content: any }>,
  model: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

// --------------------
// MEMORY FOR LAST IMAGES (in-memory, per instance)
// --------------------
let lastImageContents: Array<{
  type: "image_url";
  image_url: { url: string; detail: string };
}> = [];

// --------------------
// TYPES
// --------------------
type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: string } }
    >;

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

// --------------------
// HANDLER
// --------------------
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).send("Missing OPENAI_API_KEY");
    return;
  }

  // --------------------
  // PARSE REQUEST
  // --------------------
  let userMessage = "";
  let files: Array<{ name: string; type: string; data: string }> = [];

  const { message, files: uploadedFiles } = req.body ?? {};

  if (typeof message === "string") {
    userMessage = message;
  }

  if (Array.isArray(uploadedFiles)) {
    files = uploadedFiles;
  }

  if (!userMessage && files.length === 0) {
    res.status(400).send("Missing message");
    return;
  }

  // --------------------
  // IMAGE HANDLING (PERSISTENCE RESTORED)
  // --------------------
  const imageContents: Array<{
    type: "image_url";
    image_url: { url: string; detail: string };
  }> = [];

  if (files.length > 0) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        imageContents.push({
          type: "image_url",
          image_url: {
            url: file.data,
            detail: "high",
          },
        });
      }
    }

    // Save images for next turn
    if (imageContents.length > 0) {
      lastImageContents = imageContents;
    }
  }

  // If no new images, reuse last ones
  const finalImages =
    imageContents.length > 0 ? imageContents : lastImageContents;

  // --------------------
  // BUILD USER MESSAGE
  // --------------------
  let userContent: MessageContent;

  if (finalImages.length > 0) {
    userContent = [
      {
        type: "text",
        text:
          userMessage ||
          "Please analyze the attached homework and solve the requested problem.",
      },
      ...finalImages,
    ];
  } else {
    userContent = userMessage;
  }

  // --------------------
  // DETECT IF MATH PROBLEM (for retry logic)
  // --------------------
  const isMathProblem = /\bint(egral)?\b|\bintegrate\b|\bsolve\b|\bseries\b|\bconverg|\bdiverg|\blim(it)?\b|\bderivative\b|\bd\/dx\b|∫|∑|sin|cos|tan|sec|csc|cot/i.test(userMessage);

  // --------------------
  // ATTEMPT LOGIC WITH RETRY
  // --------------------
  try {
    const apiKey = process.env.OPENAI_API_KEY!;
    
    // Attempt 1: gpt-4o-mini with full system prompt
    const messages1: OpenAIMessage[] = [
      { role: "system", content: WOODY_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ];
    
    let response = await callOpenAI(messages1, "gpt-4o-mini", apiKey);
    
    // For math problems, check red flags and potentially retry
    if (isMathProblem) {
      let redFlags = checkRedFlags(response);
      
      if (redFlags.length > 0) {
        console.log("Attempt 1 red flags:", redFlags);
        
        // Attempt 2: gpt-4o-mini with strict retry suffix
        const messages2: OpenAIMessage[] = [
          { role: "system", content: WOODY_SYSTEM_PROMPT + STRICT_RETRY_SUFFIX },
          { role: "user", content: userContent },
        ];
        
        response = await callOpenAI(messages2, "gpt-4o-mini", apiKey);
        redFlags = checkRedFlags(response);
        
        if (redFlags.length > 0) {
          console.log("Attempt 2 red flags:", redFlags);
          
          // Attempt 3: Escalate to gpt-4o
          const messages3: OpenAIMessage[] = [
            { role: "system", content: WOODY_SYSTEM_PROMPT + STRICT_RETRY_SUFFIX },
            { role: "user", content: userContent },
          ];
          
          response = await callOpenAI(messages3, "gpt-4o", apiKey);
          console.log("Escalated to gpt-4o");
        }
      }
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(response);
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).send(error instanceof Error ? error.message : "Server error");
  }
}
