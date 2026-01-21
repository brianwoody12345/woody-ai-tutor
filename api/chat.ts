// @ts-ignore - types provided by Vercel at runtime
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * CHAT HANDLER (Woody Calculus)
 * Goals:
 * - Fix method selection reliability (especially trig power integrals)
 * - Reduce latency/cost by sending short base prompt + only relevant method card(s)
 * - Deterministic red-flag checker + one retry + one escalation
 *
 * IMPORTANT: Do not change UI; this file only controls /api/chat.
 */

// --------------------
// SHORT BASE PROMPT (keep tokens low)
// --------------------
const BASE_SYSTEM_PROMPT = `Woody Calculus — Private Professor.

You are the Woody Calculus AI Clone. Tone: calm, confident, instructional.

RULES (non-negotiable):
- Always fully complete math problems; never stop at setup.
- Never mention numerical methods, software, calculators, CAS, or elliptic integrals.
- Use clean LaTeX only: inline $...$, display $$...$$.
- Indefinite integrals MUST end with + C.
- Final answer MUST contain exactly one \\boxed{...}.
- Verify correctness internally before responding.
`;

// --------------------
// METHOD CARDS (injected only when relevant)
// --------------------
const CARD_TRIG_POWER = `TRIGONOMETRIC INTEGRATION (STRICT PLAN)

Always state the identity used:
- $\sin^2x+\cos^2x=1$  or  $1+\tan^2x=\sec^2x$  or  $1+\cot^2x=\csc^2x$.

sin/cos:
- One power odd: save ONE factor of the odd function, convert the rest with $\sin^2x+\cos^2x=1$, substitute.
- Both even: use half-angle identities.

sec/tan:
- If sec power even: save $\sec^2x\,dx$, convert with $1+\tan^2x=\sec^2x$, $u=\tan x$.
- If sec power odd: save $\sec x\tan x\,dx$, convert remaining $\tan^2x=\sec^2x-1$, $u=\sec x$.

csc/cot:
- If csc power even: save $\csc^2x\,dx$, convert with $1+\cot^2x=\csc^2x$, $u=-\cot x$.
- If csc power odd: save $\csc x\cot x\,dx$, convert remaining $\cot^2x=\csc^2x-1$, $u=\csc x$.

ABSOLUTE: Do NOT use Integration by Parts for trig power integrals.`;

const CARD_IBP_TYPE2 = `INTEGRATION BY PARTS (TABULAR) — TYPE II (exp × trig)

Use tabular method only.
Continue until the original integral reappears; then it is the "same as the original integral" — move it to the left-hand side and solve algebraically.
Use the language: "over and down", "straight across".`;

const CARD_SERIES = `SERIES

Start with Test for Divergence.
If it is a sum/difference of terms, default to Limit Comparison Test (LCT) in 4 steps:
1) pick dominant $b_n$; 2) compute $\lim a_n/b_n=c$; 3) analyze $\sum b_n$; 4) conclude for $\sum a_n$.`;

// --------------------
// STRICT RETRY (append only after deterministic failure)
// --------------------
const STRICT_RETRY_SUFFIX = `CRITICAL: Your previous response failed verification.
Re-solve from scratch and obey the relevant Method Card exactly.
Final answer must be exactly one \\boxed{...} and no forbidden phrases.`;

// --------------------
// REQUEST CLASSIFICATION (deterministic)
// --------------------
function classify(userText: string) {
  const t = userText || "";
  const isSeries = /\bseries\b|\bconverg|\bdiverg|\bsum\b|∑/i.test(t);

  // trig power integral: presence of trig functions and a power OR multiple factors
  const isTrigPowerIntegral = /\bint(egral)?\b|∫/i.test(t) && /(sin|cos|tan|sec|csc|cot)/i.test(t) &&
    (/(sin|cos|tan|sec|csc|cot)\s*\^\s*\d+/i.test(t) || /(sin|cos|tan|sec|csc|cot)\s*\d+/i.test(t));

  // IBP type II (exp × trig): e^x / exp(x) paired with trig
  const isIbpType2 = /(e\^|exp\()/.test(t) && /(sin|cos)/i.test(t) && /\bint(egral)?\b|∫/i.test(t);

  return { isSeries, isTrigPowerIntegral, isIbpType2 };
}

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
  
  // IBP incorrectly used for trig power integral (tan/sec/sin/cos/sec/csc/cot powers)
  const hasTrigPowerInResponse =
    /\\int[\s\S]*?(sin|cos|tan|sec|csc|cot)\s*\^\s*\d+/i.test(response) ||
    /\\int[\s\S]*?(sin|cos|tan|sec|csc|cot)(?:\s*\(|\s*[a-zA-Z])/i.test(response);
  const usedIBP =
    /integration\s+by\s+parts|\bibp\b|tabular\s+method|\buv\b\s*-\s*\\int|u\s*=.*?dv\s*=/i.test(
      response
    );
  if (hasTrigPowerInResponse && usedIBP) {
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
      max_tokens: 4096,
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

  // Optional conversation history from frontend
  const priorMessages: Array<{ role: string; content: string }> = Array.isArray(
    (req.body as any)?.messages
  )
    ? (req.body as any).messages
    : [];

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
  const isMathProblem = /\bint(egral)?\b|\bintegrate\b|\bseries\b|\bconverg|\bdiverg|\blim(it)?\b|\bderivative\b|\bd\/dx\b|∫|∑|sin|cos|tan|sec|csc|cot/i.test(
    userMessage
  );

  const cls = classify(userMessage);

  const methodCards: string[] = [];
  if (cls.isTrigPowerIntegral) methodCards.push(CARD_TRIG_POWER);
  if (cls.isIbpType2) methodCards.push(CARD_IBP_TYPE2);
  if (cls.isSeries) methodCards.push(CARD_SERIES);

  const systemPrompt = [BASE_SYSTEM_PROMPT, ...methodCards].join("\n\n");

  // --------------------
  // ATTEMPT LOGIC WITH RETRY
  // --------------------
  try {
    const apiKey = process.env.OPENAI_API_KEY!;

    // USE GPT-4O BY DEFAULT — same model as your working custom GPT
    const baseModel = (process.env.OPENAI_MODEL || "gpt-4o").trim();
    
    // Build messages: system + (optional) prior conversation + current user
    const history: OpenAIMessage[] = priorMessages
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      // keep history small to control tokens
      .slice(-10)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Attempt 1
    const messages1: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userContent },
    ];
    
    let response = await callOpenAI(messages1, baseModel, apiKey);
    
    // For math problems, check red flags and potentially retry
    if (isMathProblem) {
      let redFlags = checkRedFlags(response);
      
      // Extra deterministic enforcement: if request is trig-power, IBP mention is a hard fail
      if (cls.isTrigPowerIntegral && /integration\s+by\s+parts|\bibp\b|tabular\s+method|\buv\b\s*-\s*\\int/i.test(response)) {
        redFlags = Array.from(new Set([...redFlags, "ibp_used_for_trig_power_request"]));
      }

      if (redFlags.length > 0) {
        console.log("Attempt 1 red flags:", redFlags);
        
        // Attempt 2: retry with strict suffix (same short base + cards)
        const messages2: OpenAIMessage[] = [
          { role: "system", content: systemPrompt + "\n\n" + STRICT_RETRY_SUFFIX },
          ...history,
          { role: "user", content: userContent },
        ];
        
        response = await callOpenAI(messages2, baseModel, apiKey);
        redFlags = checkRedFlags(response);

        if (cls.isTrigPowerIntegral && /integration\s+by\s+parts|\bibp\b|tabular\s+method|\buv\b\s*-\s*\\int/i.test(response)) {
          redFlags = Array.from(new Set([...redFlags, "ibp_used_for_trig_power_request"]));
        }
        
        if (redFlags.length > 0) {
          console.log("Attempt 2 red flags:", redFlags);
          
          // Attempt 3: Escalate once to gpt-4o
          const messages3: OpenAIMessage[] = [
            { role: "system", content: systemPrompt + "\n\n" + STRICT_RETRY_SUFFIX },
            ...history,
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
