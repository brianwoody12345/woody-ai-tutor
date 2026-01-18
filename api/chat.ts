// api/chat.ts
import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const MAX_FILES = 5;
    const MAX_FILE_SIZE = 3 * 1024 * 1024;
    const MAX_TOKENS = 2500;

    let fields: any = {};
    let files: any = {};

    // -------------------------
    // Parse request
    // -------------------------
    const isMultipart =
      String(req.headers["content-type"] || "").includes("multipart/form-data");

    if (isMultipart) {
      const form = formidable({
        multiples: true,
        maxFiles: MAX_FILES,
        maxFileSize: MAX_FILE_SIZE,
      });

      ({ fields, files } = await new Promise((resolve, reject) => {
        form.parse(req, (err, flds, fls) => {
          if (err) reject(err);
          else resolve({ fields: flds, files: fls });
        });
      }));
    } else {
      const raw = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      fields = raw ? JSON.parse(raw) : {};
    }

    const message = String(fields.message || "").trim();
    const systemPrompt = String(fields.systemPrompt || "").trim();

    if (!message) {
      res.status(400).send("Missing message");
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).send("Missing OPENAI_API_KEY");
      return;
    }

    // -------------------------
    // Extract PDF text
    // -------------------------
    let extractedText = "";

    const fileList: any[] = [];
    for (const key in files) {
      const f = files[key];
      if (Array.isArray(f)) fileList.push(...f);
      else if (f) fileList.push(f);
    }

    for (const f of fileList) {
      if (
        f.mimetype === "application/pdf" &&
        f.filepath &&
        f.size <= MAX_FILE_SIZE
      ) {
        const buffer = fs.readFileSync(f.filepath);
        const pdf = await pdfParse(buffer);
        extractedText += `\n\n--- PDF CONTENT (${f.originalFilename}) ---\n${pdf.text}`;
      }
    }

    // -------------------------
    // Problem-number routing
    // -------------------------
    let routingInstruction = "";
    const match = message.match(/problem\s+(\d+)/i);

    if (match && extractedText) {
      routingInstruction = `
The student asked for problem ${match[1]}.

Search the uploaded PDF text for the problem labeled "${match[1]})" or "${match[1]}.".
Extract ONLY that problem.
Solve it completely.
Do NOT ask for clarification.
`;
    }

    // -------------------------
    // Build GPT input
    // -------------------------
    const userContent = `
STUDENT QUESTION:
${message}

${routingInstruction}

UPLOADED FILE TEXT:
${extractedText}
`;

    // -------------------------
    // Stream response
    // -------------------------
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
    });

    const upstream = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          stream: true,
          temperature: 0.0,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: "system",
              content:
                systemPrompt ||
                "You are a private math professor. Use LaTeX for all math.",
            },
            { role: "user", content: userContent },
          ],
        }),
      }
    );

    if (!upstream.body) {
      res.end("No response from OpenAI");
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const line = chunk
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!line) continue;

        const data = line.replace("data:", "").trim();
        if (data === "[DONE]") {
          res.end();
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch {}
      }
    }

    res.end();
  } catch (err: any) {
    res.status(500).send(`Server error: ${err.message}`);
  }
}
