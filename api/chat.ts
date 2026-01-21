// @ts-ignore - types provided by Vercel at runtime
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ==========================
// SHORT BASE SYSTEM PROMPT (~250 tokens)
// ==========================
const BASE_SYSTEM_PROMPT = `You are Professor Woody, a calm, confident calculus instructor.

ABSOLUTE RULES:
1. Always finish every problem completely. Never stop at setup.
2. Never mention "numerical methods", "software", "CAS", "calculator", or "computational tools".
3. Output clean LaTeX: $...$ inline, $$...$$ display.
4. Every problem MUST end with exactly ONE \\boxed{final answer}.
5. Evaluate all bounds for definite integrals. No unevaluated integrals remain.
6. Keep symbolic values (e.g., \\sin(1), \\cos(e)) as exact—do not convert to decimals.
7. End indefinite integrals with + C.
8. Verify internally: differentiate your antiderivative to confirm it matches the integrand.

Tone: instructional, occasionally say "Perfect practice makes perfect" or "Repetition builds muscle memory."`;

// ==========================
// METHOD CARDS (injected dynamically)
// ==========================
const METHOD_CARD_TRIG_POWER = `
TRIG POWER INTEGRAL METHOD:
1. Identify odd/even powers of sin and cos.
2. ODD POWER RULE (mandatory):
   - If sin has odd power: save ONE sin(t)dt, convert remaining sin^(2k) using sin²=1−cos², set u=cos(t), du=−sin(t)dt.
   - If cos has odd power: save ONE cos(t)dt, convert remaining cos^(2k) using cos²=1−sin², set u=sin(t), du=cos(t)dt.
3. After substitution, integrand MUST become polynomial in u.
4. FORBIDDEN: Do NOT rewrite sin³ or cos³ as (1−u²)^(3/2). No fractional powers.
5. Integrate the polynomial, substitute back, evaluate bounds if definite.
`;

const METHOD_CARD_IBP_TYPE2 = `
IBP TYPE II (exp × trig):
Use tabular method with exactly 3 rows:
| sign | u (exp or trig) | dv (the other) |
Row 1 & 2: read "over and down"
Row 3: read "straight across" — this yields the ORIGINAL integral.
Move that integral to the left side, solve algebraically: 2I = ... → I = .../2
You MUST finish with a closed-form answer in \\boxed{}.
`;

const METHOD_CARD_SERIES = `
SERIES TEST PROTOCOL:
1. Always start with Test for Divergence: if lim aₙ ≠ 0, diverges immediately.
2. Test selection:
   - Pure powers → p-test
   - Geometric → geometric test
   - Factorials/exponentials → ratio test
   - nth powers → root test
   - Addition/subtraction → Limit Comparison Test
   - Alternating (−1)ⁿ → alternating series test
   - Telescoping → partial fractions + limits
3. State the test, show the limit/comparison, conclude converges/diverges.
`;

const METHOD_CARD_STRICT_RETRY = `
STRICT RETRY MODE — Previous attempt had errors.
You MUST:
- Complete the problem fully with NO shortcuts.
- Use the correct standard method for trig integrals (save one factor, substitute).
- Ensure your final \\boxed{} contains a fully evaluated symbolic answer.
- No unevaluated integrals. No escape phrases.
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
// CLASSIFICATION (regex-based)
// ==========================
function classifyProblem(text: string): {
  isMath: boolean;
  isTrigPower: boolean;
  isIBPType2: boolean;
  isSeries: boolean;
} {
  const t = String(text || "").toLowerCase();
  
  const isMath = /∫|\\int|integral|series|\\sum|σ|sum\b|converge|diverge|derivative|limit|∂|d\/dx/i.test(t);
  
  // Trig power: sin^n, cos^n, tan^n, etc. with powers
  const isTrigPower = /(sin|cos|tan|sec|csc|cot)\s*[\^⁰¹²³⁴⁵⁶⁷⁸⁹]+|\(sin|\(cos/i.test(t) ||
    /(sin|cos|tan|sec|csc|cot)\s*\^\s*\d+/i.test(t) ||
    /sin\^|cos\^|tan\^|sec\^|csc\^|cot\^/i.test(t);
  
  // IBP Type II: e^x * sin/cos or similar
  const isIBPType2 = /(e\^|exp).*?(sin|cos)|(\bsin\b|\bcos\b).*?(e\^|exp)/i.test(t);
  
  // Series
  const isSeries = /series|\\sum|Σ|converge|diverge|∑|a_n|a_\{n\}/i.test(t);
  
  return { isMath, isTrigPower, isIBPType2, isSeries };
}

function needsNonStreamedVerification(text: string): boolean {
  return /∫|\\int\b|integral\b|series\b|\\sum\b|Σ|\bsum\b|\bconverge\b|\bdiverge\b/i.test(text);
}

// ==========================
// RED FLAG CHECKER (deterministic, no LLM)
// ==========================
interface RedFlagResult {
  hasRedFlag: boolean;
  flags: string[];
}

function checkRedFlags(response: string): RedFlagResult {
  const flags: string[] = [];
  const t = response;
  const tLower = t.toLowerCase();
  
  // 1. Missing \boxed{
  if (!t.includes("\\boxed{")) {
    flags.push("missing_boxed");
  }
  
  // 2. Forbidden phrases
  const forbidden = ["numerical methods", "software", "cas", "elliptic", "computational tools", "calculator"];
  for (const phrase of forbidden) {
    if (tLower.includes(phrase)) {
      flags.push(`forbidden_phrase:${phrase}`);
    }
  }
  
  // 3. Multiple arbitrary constants (C1, C2, etc.)
  if (/\bC_?[12]\b|C_1|C_2/.test(t)) {
    flags.push("multiple_constants");
  }
  
  // 4. Unevaluated integral inside boxed
  const boxedMatch = t.match(/\\boxed\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
  if (boxedMatch) {
    const boxedContent = boxedMatch[1];
    if (/\\int|∫/.test(boxedContent)) {
      flags.push("unevaluated_integral_in_boxed");
    }
  }
  
  // 5. Broken LaTeX: unmatched \left without \right
  const leftCount = (t.match(/\\left/g) || []).length;
  const rightCount = (t.match(/\\right/g) || []).length;
  if (leftCount !== rightCount) {
    flags.push("unmatched_left_right");
  }
  
  // 6. Unmatched braces (simple check)
  let braceDepth = 0;
  for (const char of t) {
    if (char === "{") braceDepth++;
    if (char === "}") braceDepth--;
    if (braceDepth < 0) {
      flags.push("unmatched_braces");
      break;
    }
  }
  if (braceDepth !== 0 && !flags.includes("unmatched_braces")) {
    flags.push("unmatched_braces");
  }
  
  // 7. Known wrong trig antiderivative patterns
  // e.g., claiming ∫cos³(u)du = (1/3)sin³(u) is WRONG
  if (/\\int.*?cos\^?\{?3\}?.*?=.*?\\frac\{1\}\{3\}.*?sin\^?\{?3\}?/i.test(t) ||
      /\\int.*?sin\^?\{?3\}?.*?=.*?\\frac\{1\}\{3\}.*?cos\^?\{?3\}?/i.test(t)) {
    flags.push("wrong_trig_antiderivative");
  }
  
  // 8. Setup-only bailout language
  if (/focus on the structure|setup correctly|too complex|requires.*tools|typically evaluated/i.test(t)) {
    flags.push("bailout_language");
  }
  
  return {
    hasRedFlag: flags.length > 0,
    flags
  };
}

// ==========================
// OPENAI CALL (NON-STREAM)
// ==========================
async function openaiChatOnce(
  messages: OpenAIMessage[],
  model: string = "gpt-4o-mini",
  maxTokens: number = 3000
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      stream: false,
      messages,
    }),
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
// BUILD SYSTEM PROMPT (with dynamic method cards)
// ==========================
function buildSystemPrompt(classification: ReturnType<typeof classifyProblem>, isRetry: boolean = false): string {
  let prompt = BASE_SYSTEM_PROMPT;
  
  if (classification.isTrigPower) {
    prompt += "\n\n" + METHOD_CARD_TRIG_POWER;
  }
  
  if (classification.isIBPType2) {
    prompt += "\n\n" + METHOD_CARD_IBP_TYPE2;
  }
  
  if (classification.isSeries) {
    prompt += "\n\n" + METHOD_CARD_SERIES;
  }
  
  if (isRetry) {
    prompt += "\n\n" + METHOD_CARD_STRICT_RETRY;
  }
  
  return prompt;
}

// ==========================
// NORMALIZE MATH TEXT
// ==========================
function normalizeMathText(s: string): string {
  return String(s ?? "")
    .replace(/\u2061/g, "") // invisible function application
    .replace(
      /\b(cos|sin|tan|sec|csc|cot)\s*([0-9]+)\s*\(/gi,
      (_m, fn, p) => `${fn}^${p}(`
    )
    .replace(
      /\b(cos|sin|tan|sec|csc|cot)\s*\^\s*([0-9]+)\s*\(/gi,
      (_m, fn, p) => `${fn}^${p}(`
    );
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

  if (!userMessage && files.length === 0) {
    res.status(400).send("Missing message");
    return;
  }

  const textContent = normalizeMathText(userMessage);
  const classification = classifyProblem(textContent);

  // Build messages with vision support
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
    res.status(422).send(
      "We received your file(s), but couldn't process them for analysis. Please try re-uploading, using an image/photo instead of PDF, or a smaller PDF."
    );
    return;
  }

  // Build user content
  let userContent: MessageContent;
  if (imageContents.length > 0) {
    userContent = [
      {
        type: "text",
        text: textContent || "Please analyze this image and solve any math problems shown.",
      },
      ...imageContents,
    ];
  } else {
    userContent = textContent || "Please help me with math.";
  }

  try {
    const needsVerification = needsNonStreamedVerification(textContent);

    // ===========================
    // PATH A: NON-STREAMED with red-flag checking for integrals/series
    // ===========================
    if (needsVerification) {
      const systemPrompt = buildSystemPrompt(classification, false);
      
      const openaiMessages: OpenAIMessage[] = [
        { role: "system", content: systemPrompt },
      ];

      // Add conversation history
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

      openaiMessages.push({ role: "user", content: userContent });

      // ATTEMPT 1: gpt-4o-mini (default)
      console.log("[chat] Attempt 1: gpt-4o-mini with method cards:", {
        isTrigPower: classification.isTrigPower,
        isIBPType2: classification.isIBPType2,
        isSeries: classification.isSeries,
      });

      let response = await openaiChatOnce(openaiMessages, "gpt-4o-mini", 3000);
      let redFlagCheck = checkRedFlags(response);

      console.log("[chat] Attempt 1 red flags:", redFlagCheck.flags);

      // ATTEMPT 2: Retry with strict method card if red flags
      if (redFlagCheck.hasRedFlag) {
        console.log("[chat] Attempt 2: gpt-4o-mini with STRICT RETRY");
        
        const retrySystemPrompt = buildSystemPrompt(classification, true);
        const retryMessages: OpenAIMessage[] = [
          { role: "system", content: retrySystemPrompt },
        ];

        if (conversationHistory.length > 1) {
          for (const msg of conversationHistory.slice(0, -1)) {
            if (msg.role === "user" || msg.role === "assistant") {
              retryMessages.push({
                role: msg.role as "user" | "assistant",
                content: msg.content,
              });
            }
          }
        }

        retryMessages.push({ role: "user", content: userContent });

        response = await openaiChatOnce(retryMessages, "gpt-4o-mini", 3500);
        redFlagCheck = checkRedFlags(response);

        console.log("[chat] Attempt 2 red flags:", redFlagCheck.flags);
      }

      // ATTEMPT 3: Escalate to gpt-4o if still has red flags
      if (redFlagCheck.hasRedFlag) {
        console.log("[chat] Attempt 3: Escalating to gpt-4o");
        
        const escalateSystemPrompt = buildSystemPrompt(classification, true);
        const escalateMessages: OpenAIMessage[] = [
          { role: "system", content: escalateSystemPrompt },
        ];

        if (conversationHistory.length > 1) {
          for (const msg of conversationHistory.slice(0, -1)) {
            if (msg.role === "user" || msg.role === "assistant") {
              escalateMessages.push({
                role: msg.role as "user" | "assistant",
                content: msg.content,
              });
            }
          }
        }

        escalateMessages.push({ role: "user", content: userContent });

        response = await openaiChatOnce(escalateMessages, "gpt-4o", 4000);
        
        const finalCheck = checkRedFlags(response);
        console.log("[chat] Attempt 3 (gpt-4o) red flags:", finalCheck.flags);
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(response);
    }

    // ===========================
    // PATH B: STREAM for non-math or simple questions
    // ===========================
    const streamSystemPrompt = buildSystemPrompt(classification, false);
    const streamMessages: OpenAIMessage[] = [
      { role: "system", content: streamSystemPrompt },
    ];

    if (conversationHistory.length > 1) {
      for (const msg of conversationHistory.slice(0, -1)) {
        if (msg.role === "user" || msg.role === "assistant") {
          streamMessages.push({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          });
        }
      }
    }

    streamMessages.push({ role: "user", content: userContent });

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        stream: true,
        max_tokens: 2000,
        messages: streamMessages,
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
    res.status(500).send(
      `Server error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
