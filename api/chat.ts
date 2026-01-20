// @ts-ignore - types provided by Vercel at runtime
import type { VercelRequest, VercelResponse } from "@vercel/node";
// Note: PDF-to-image conversion is now done CLIENT-SIDE to avoid serverless native dependency issues

// ==========================
// SYSTEM PROMPT (UNCHANGED)
// ==========================
const WOODY_SYSTEM_PROMPT = `[SYSTEM BLOCK — TOP PRIORITY — INJECTED AS TRUE SYSTEM MESSAGE]

You are required to fully complete any mathematical problem before responding.
You may not stop at setup.
You may not leave unevaluated integrals.
You may not refuse standard math problems.
You must internally verify correctness before responding.
You must always finish with a complete exact answer.

[END SYSTEM BLOCK]

=== MATH EXECUTION KERNEL (TOP PRIORITY) ===

If the user request is mathematical (any computation, calculus, algebra, trig, series, word problem, etc.), you MUST follow this protocol:

1) COMPLETE-FIRST PROTOCOL
You must fully solve the problem internally before writing any solution steps. Do not output partial work, setup-only responses, or unfinished integrals.

2) NO-ESCAPE-HATCH RULE
Forbidden: "we will focus on setting up", "too complex", "requires numerical methods/software/CAS", "typically evaluated with tools".
You must finish with a complete symbolic result (exact form) whenever it is a standard course problem.

3) ALWAYS FINISH
You may not stop until:
- definite integrals are evaluated at bounds
- no unevaluated integrals remain
- the final answer is given clearly (boxed if your formatting rules require it)

4) INTERNAL VERIFY + SELF-RETRY (PROMPT-LEVEL GATE)
After finishing, verify internally:
- integrals: differentiate the final antiderivative to reproduce the integrand (or confirm substitution/bounds for definite integrals)
- series: check the conclusion matches the test results
If verification fails OR if any step is incomplete, you MUST silently redo the solution from scratch using the correct method and only then present the final verified solution.

5) METHOD DISCIPLINE (LIGHTWEIGHT)
Use the simplest correct standard method. Prefer substitutions that turn trig-power integrals into a polynomial integral immediately. Do not choose identity expansions that lead to harder integrals unless they still fully complete.

=== END MATH EXECUTION KERNEL ===

Woody Calculus — Private Professor 

You are the Woody Calculus AI Clone.

You mimic Professor Woody. 

Tone: calm, confident, instructional.
Occasionally (sparingly) use phrases like:

"Perfect practice makes perfect."

"Repetition builds muscle memory."

"This is a good problem to practice a few times."

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

After completing an Integration by Parts problem using the tabular method, verify the final answer by comparing it to the known general formula for that IBP type.
The general formula is used only as a confirmation, never as the primary method.

========================
IBP TABLE FORMAT (CRITICAL - FOLLOW EXACTLY)
========================

For ALL IBP problems, you MUST create a table with EXACTLY THREE COLUMNS:
| sign | u | dv |

The sign column alternates: +, -, +, -, ...

TYPE I TABLE (Polynomial × trig/exp):
- Rows continue until u derivative = 0
- Read "over and down" for each row

TYPE II TABLE (Exponential × trig) - EXACTLY 3 ROWS ONLY:
- STOP at exactly 3 rows
- Row 1 & 2: "over and down"  
- Row 3: "straight across" (this gives the repeating integral)

TYPE III TABLE (ln or inverse trig):
- Exactly 2 rows
- Row 1: over and down
- Row 2: straight across

========================
OUTPUT FORMAT RULES (CRITICAL)
========================
- All math MUST be in LaTeX format
- Use $...$ for inline math
- Use $$...$$ for display/block math
- Do NOT use Unicode superscripts like x². Always use LaTeX: $x^2$
- End every indefinite integral with + C
- Tables must use markdown table format with | separators

========================
🚨 ABSOLUTE REQUIREMENTS — READ LAST, OBEY ALWAYS 🚨
========================
1. You are STRICTLY FORBIDDEN from saying "numerical methods", "software", "calculator", "computational tools", or any variation. NEVER.
2. You MUST finish EVERY calculus problem with a FINAL SYMBOLIC ANSWER inside \\boxed{...}.
3. For definite integrals: EVALUATE the bounds completely.
4. NEVER leave a problem incomplete. If you start solving, you MUST reach \\boxed{final answer}.
5. If a problem involves sin, cos, e, ln, etc. at specific values, LEAVE THEM AS SYMBOLS (e.g., \\sin(1), \\sin(e)) — this IS a complete answer.
`;

// ==========================
// TYPES
// ==========================
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

// ==========================
// ROUTING + SAFETY CHECKS
// ==========================
function isIntegralOrSeries(text: string) {
  const t = String(text || "");
  return /∫|\\int\b|integral\b|series\b|\\sum\b|Σ|\bsum\b|\bconverge\b|\bdiverge\b/i.test(
    t
  );
}

function hasForbiddenPhrases(s: string) {
  const t = String(s || "").toLowerCase();
  return (
    t.includes("numerical methods") ||
    t.includes("computational tools") ||
    t.includes("software") ||
    t.includes("calculator") ||
    t.includes("cas") ||
    t.includes("elliptic integral")
  );
}

function looksIncompleteForIntegralOrSeries(s: string) {
  const t = String(s || "");

  // must have a boxed final answer for your requirements
  const missingBox = !t.includes("\\boxed{");

  // leaving an integral symbol is a red flag (some solutions may show intermediate integrals,
  // but you explicitly forbid leaving unevaluated integrals at the end)
  const endsWithIntegral =
    /\\int\b|∫/.test(t) &&
    /\\boxed\{[\s\S]*?(\\int\b|∫)[\s\S]*?\}/.test(t); // boxed answer contains an integral => not allowed

  // common bailout language
  const bailout =
    /focus on the structure|setup correctly|too complex|requires.*tools|typically evaluated/i.test(
      t
    );

  return missingBox || endsWithIntegral || bailout || hasForbiddenPhrases(t);
}

// ==========================
// OPENAI CALL (NON-STREAM)
// ==========================
async function openaiChatOnce(body: any) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "Unknown error");
    throw new Error(`OpenAI API error ${resp.status}: ${errorText}`);
  }

  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  return String(content);
}

// ==========================
// MAIN HANDLER
// ==========================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
    return;
  }

  // Set CORS headers for all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).send("Missing OPENAI_API_KEY");
    return;
  }

  // Parse request body
  let userMessage = "";
  let conversationHistory: Array<{ role: string; content: string }> = [];
  let files: Array<{ name: string; type: string; data: string }> = [];

  const contentType = req.headers["content-type"] || "";
  console.log("[chat] Content-Type:", contentType);

  if (contentType.includes("application/json")) {
    const { message, messages, files: uploadedFiles } = req.body ?? {};

    if (typeof message === "string" && message.trim()) {
      userMessage = message;
    }

    if (Array.isArray(messages) && messages.length > 0) {
      conversationHistory = messages.filter(
        (m: { role: string; content: string }) =>
          m.role === "user" || m.role === "assistant"
      );
      if (!userMessage) {
        userMessage = messages[messages.length - 1]?.content || "";
      }
    }

    if (Array.isArray(uploadedFiles)) {
      files = uploadedFiles;
    }
  } else {
    try {
      const { message, messages } = req.body ?? {};
      if (typeof message === "string") {
        userMessage = message;
      } else if (Array.isArray(messages) && messages.length > 0) {
        userMessage = messages[messages.length - 1]?.content || "";
      }
    } catch {
      // ignore
    }
  }

  console.log(
    "[chat] Final userMessage:",
    userMessage.slice(0, 160),
    "| files.length:",
    files.length
  );

  if (!userMessage && files.length === 0) {
    res.status(400).send("Missing message");
    return;
  }

  // Normalize common copy/paste artifacts like "cos⁡3(" => "cos^3("
  const normalizeMathText = (s: string) => {
    return String(s ?? "")
      .replace(/\u2061/g, "")
      .replace(
        /\b(cos|sin|tan|sec|csc|cot)\s*([0-9]+)\s*\(/gi,
        (_m, fn, p) => `${fn}^${p}(`
      )
      .replace(
        /\b(cos|sin|tan|sec|csc|cot)\s*\^\s*([0-9]+)\s*\(/gi,
        (_m, fn, p) => `${fn}^${p}(`
      );
  };

  let textContent = normalizeMathText(userMessage);

  // Build OpenAI messages (with vision)
  const openaiMessages: OpenAIMessage[] = [
    { role: "system", content: WOODY_SYSTEM_PROMPT },
  ];

  // Add conversation history (excluding the last message which we'll add with files)
  if (conversationHistory.length > 1) {
    for (const msg of conversationHistory.slice(0, -1)) {
      if (msg.role === "user" || msg.role === "assistant") {
        openaiMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }
  }

  // Attach images (PDFs already converted client-side)
  const imageContents: Array<{
    type: "image_url";
    image_url: { url: string; detail: string };
  }> = [];

  if (files.length > 0) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        imageContents.push({
          type: "image_url",
          image_url: { url: file.data, detail: "high" },
        });
      }
    }
  }

  if (files.length > 0 && imageContents.length === 0) {
    res
      .status(422)
      .send(
        "We received your file(s), but couldn't process them for analysis. Please try re-uploading, using an image/photo instead of PDF, or a smaller PDF."
      );
    return;
  }

  if (imageContents.length > 0) {
    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: string } }
    > = [
      {
        type: "text",
        text: textContent || "Please analyze this image and solve any math problems shown.",
      },
      ...imageContents,
    ];

    openaiMessages.push({ role: "user", content: contentParts });
  } else {
    openaiMessages.push({
      role: "user",
      content: textContent || "Please help me with math.",
    });
  }

  try {
    const needsVerification = isIntegralOrSeries(textContent);

    // ===========================
    // PATH A: NUCLEAR VERIFIED (NON-STREAM) for Integrals + Series
    // ===========================
    if (needsVerification) {
      // 1) SOLVER PASS (gpt-4o)
      const solverText = await openaiChatOnce({
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 4096,
        stream: false,
        messages: openaiMessages,
      });

      const solverLooksBad = looksIncompleteForIntegralOrSeries(solverText);

      // 2) VERIFIER PASS (gpt-4o-mini) — re-solve independently and compare
      // IMPORTANT: we only allow VERIFIED if the verifier re-solves and matches.
      const verifierPrompt = `
You are a rigorous mathematics verifier AND re-solver.

You MUST re-solve the problem from scratch (independently), then compare your final boxed answer to the proposed solution's final boxed answer.

Output rules (STRICT):
- If (and ONLY if) your independently solved final boxed answer exactly matches the proposed solution's final boxed answer AND the work is complete:
Output exactly:
VERIFIED

- Otherwise:
Output exactly:
CORRECTED SOLUTION:
followed by a complete, correct, fully finished solution WITH a final answer inside \\boxed{...}.

Additional hard rules:
- Do not use or mention numerical methods/software/CAS.
- Do not leave unevaluated integrals.
- Evaluate definite integral bounds fully.
- Keep symbolic constants like \\sin(1), \\sin(e).

Problem:
${textContent}

Proposed solution:
${solverText}
`.trim();

      const verificationResult = await openaiChatOnce({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 2400,
        stream: false,
        messages: [
          { role: "system", content: "You are a strict math verifier and re-solver." },
          { role: "user", content: verifierPrompt },
        ],
      });

      const vr = verificationResult.trim();

      // If solver already fails obvious rules, we do NOT accept VERIFIED even if mini says it.
      const allowVerified = !solverLooksBad;

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");

      if (allowVerified && vr === "VERIFIED") {
        return res.status(200).send(solverText);
      }

      if (vr.startsWith("CORRECTED SOLUTION:")) {
        const corrected = vr.replace(/^CORRECTED SOLUTION:\s*/i, "").trim();
        // If corrected is empty, force another correction (rare, but nuclear means nuclear)
        if (corrected) {
          return res.status(200).send(corrected);
        }
      }

      // 3) FORCE-CORRECTION FALLBACK (no more passing bad math)
      // If verifier output is unexpected OR solver looked bad OR verifier refused format,
      // we force a correction pass that has NO "VERIFIED" option.
      const forcePrompt = `
You are Professor Woody's math engine.

Solve the problem completely and correctly.
Follow these hard requirements:
- Finish the problem (no setup-only).
- No unevaluated integrals remain.
- Evaluate bounds fully for definite integrals.
- Final answer MUST be inside \\boxed{...}.
- Do NOT mention numerical methods/software/CAS.
- For trig-power integrals, use the standard odd/even strategy (save one factor, convert the rest, substitute) when applicable.
- Keep answers symbolic (e.g., \\sin(1), \\sin(e)).

Problem:
${textContent}
`.trim();

      const forcedCorrection = await openaiChatOnce({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 2400,
        stream: false,
        messages: [
          { role: "system", content: WOODY_SYSTEM_PROMPT },
          { role: "user", content: forcePrompt },
        ],
      });

      return res.status(200).send(forcedCorrection);
    }

    // ===========================
    // PATH B: STREAM for everything else
    // ===========================
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
        max_tokens: 4096,
        messages: openaiMessages,
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "Unknown error");
      console.error("OpenAI API error:", upstream.status, errorText);
      return res.status(upstream.status).send(`OpenAI API error: ${errorText}`);
    }

    if (!upstream.body) {
      return res.status(500).send("No response body from OpenAI");
    }

    // Set headers for streaming
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine === "data: [DONE]") continue;

        if (trimmedLine.startsWith("data: ")) {
          const jsonStr = trimmedLine.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) res.write(content);
          } catch (parseError) {
            console.error("JSON parse error:", parseError);
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
      if (buffer.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(buffer.slice(6));
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) res.write(content);
        } catch {
          // ignore
        }
      }
    }

    res.end();
  } catch (error) {
    console.error("Error in chat handler:", error);
    res
      .status(500)
      .send(
        `Server error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
  }
}
