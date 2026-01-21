// @ts-ignore - types provided by Vercel at runtime
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * SIMPLE, STABLE CHAT HANDLER
 * - GPT-4o only
 * - Short system prompt
 * - Persistent image support
 * - No retries, no verification loops
 * - Let the model do math naturally
 */

// --------------------
// SYSTEM PROMPT
// --------------------
const SYSTEM_PROMPT = `
You are Professor Woody, a calm, confident university calculus instructor.

Rules:
- Fully solve every math problem. Never stop at setup.
- Finish with a final exact answer.
- Evaluate all bounds for definite integrals.
- Keep answers symbolic when appropriate (e.g. sin(1), sin(e)).
- Use clean LaTeX formatting.
- Do not mention numerical methods, software, or calculators.

Tone: instructional, clear, supportive.
`;

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

  const messages: OpenAIMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  // --------------------
  // OPENAI CALL (SINGLE, CLEAN)
  // --------------------
  try {
    const upstream = await fetch(
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
          max_tokens: 3000,
          messages,
        }),
      }
    );

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "Unknown error");
      return res
        .status(upstream.status)
        .send(`OpenAI API error: ${errorText}`);
    }

    const json = await upstream.json();
    const content = json?.choices?.[0]?.message?.content ?? "";

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(content);
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).send("Server error");
  }
}
