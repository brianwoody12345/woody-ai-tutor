// @ts-ignore
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ==========================
// SIMPLE SYSTEM PROMPT
// ==========================
const SYSTEM_PROMPT = `
You are Professor Woody.

Solve calculus problems completely and correctly.
Show clear, logical steps.
Finish every problem.
Do not leave unevaluated integrals.
Give exact symbolic answers.
Use LaTeX for all mathematics.
`;

// ==========================
// MAIN HANDLER
// ==========================
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).send("Missing OPENAI_API_KEY");
    return;
  }

  // Parse input
  const { message, messages, files } = req.body ?? {};

  let userMessage = "";

  if (typeof message === "string") {
    userMessage = message;
  } else if (Array.isArray(messages) && messages.length > 0) {
    userMessage = messages[messages.length - 1]?.content || "";
  }

  if (!userMessage && (!files || files.length === 0)) {
    res.status(400).send("Missing message");
    return;
  }

  // Normalize common unicode artifacts (important)
  const normalizeMathText = (s: string) =>
    String(s ?? "")
      .replace(/\u2061/g, "")
      .replace(
        /\b(cos|sin|tan|sec|csc|cot)\s*([0-9]+)\s*\(/gi,
        (_m, fn, p) => `${fn}^${p}(`
      );

  const textContent = normalizeMathText(userMessage);

  // Build OpenAI messages
  const openaiMessages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: textContent },
  ];

  // Call OpenAI (NON-STREAMING, like Custom GPT)
  try {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0,
          max_tokens: 2048,
          messages: openaiMessages,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).send(err);
      return;
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content ?? "";

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(output);
  } catch (err: any) {
    res.status(500).send(err?.message || "Server error");
  }
}
