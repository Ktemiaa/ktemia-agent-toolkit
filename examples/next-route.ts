// Next.js App Router: app/api/chat/route.ts
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from "ai";
import { ktemiaTools } from "@ktemia/ai-sdk";

// Create once per server, not per request.
const tools = ktemiaTools();

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "openai/gpt-5-mini",
    system: `You find live travel prices with the Ktemia tools. Today is ${new Date().toISOString().slice(0, 10)}. Ask for missing dates or places instead of guessing.`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(8),
  });

  return result.toUIMessageStreamResponse();
}
