import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Toggle mock mode here ─────────────────────────────────
const MOCK = false;
// ─────────────────────────────────────────────────────────

const MOCK_CONTENT_ROOT = `[FACTS]
{"Founded": "753 BC", "Location": "Italian Peninsula", "At its peak": "5 million km²", "Official language": "Latin", "Religion": "Roman polytheism"}
[/FACTS]

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

## Origins and History

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Key Characteristics

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam eaque ipsa quae ab illo inventore veritatis. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.

## Cultural Significance

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint.`;

const MOCK_CONTENT_SUB = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

## Background

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Significance

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint.`;

const MOCK_TOPICS = [
  "Topic Alpha",
  "Topic Beta",
  "Topic Gamma",
  "Topic Delta",
  "Topic Epsilon",
  "Topic Zeta",
  "Topic Eta",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "../client/dist");

const app = express();
const port = process.env.PORT || 3001;

// In dev allow the Vite dev server; in production same-origin so CORS isn't needed
if (process.env.NODE_ENV !== "production") {
  app.use(cors({ origin: "http://localhost:5173" }));
}
app.use(express.json());

// Serve built frontend
app.use(express.static(clientDist));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/explore", async (req, res) => {
  const { topic, path = [] } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const contextLine =
    path.length > 0
      ? `\nThis topic is being explored in the context of: ${path.join(" > ")}.`
      : "";

  const isRoot = path.length === 0;

  const factsInstruction = isRoot ? `First, output a facts block in this exact format:
[FACTS]
{"Key": "Value", "Key": "Value", ...}
[/FACTS]
Include 4-6 concise quick facts (e.g. dates, locations, classifications, notable figures, key numbers). Values should be brief — a few words each.

Then write ` : `Write `;

  const prompt = `You are a factual encyclopedia. Write in a neutral, informative tone — clear and precise, like Britannica or Wikipedia. No flowery language, no narrative hooks, no dramatic phrasing. State facts directly.

Write about the topic: "${topic}"${contextLine}

${factsInstruction}one opening paragraph (3-4 sentences) that defines and summarizes the topic. State what it is, its significance, and key context.

Then 2-4 sections, each starting with a heading on its own line formatted exactly as: ## Heading Title
Each section has 2-4 sentences of factual, specific information covering a distinct aspect of the topic.
Do not use bullet points or any other markdown. Only ## headings and plain prose paragraphs.

After your content, output exactly the following delimiter on its own line:
---TOPICS---
Then output a JSON array of short subtopic strings (2-5 words each) that would be interesting to explore further. Choose between 3 and 10 subtopics — usually around 5 or 6, sometimes more for broad topics, rarely fewer than 5. Output ONLY the JSON array with no other text after it.

Example of the required ending format:
---TOPICS---
["First Subtopic", "Second Subtopic", "Third Subtopic", "Fourth Subtopic", "Fifth Subtopic"]`;

  if (MOCK) {
    const mockContent = isRoot ? MOCK_CONTENT_ROOT : MOCK_CONTENT_SUB;
    const words =
      `${mockContent}\n---TOPICS---\n${JSON.stringify(MOCK_TOPICS)}`.split(
        " ",
      );
    for (const word of words) {
      res.write(`data: ${JSON.stringify({ content: word + " " })}\n\n`);
      await new Promise((r) => setTimeout(r, 18));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? "";
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("OpenAI error:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// SPA catch-all — must come after API routes
app.get("*", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
