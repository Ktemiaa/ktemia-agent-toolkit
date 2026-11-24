// npx tsx examples/generate-text.ts
// Needs KTEMIA_API_KEY and AI_GATEWAY_API_KEY (or swap in any provider model).
import { generateText, isStepCount } from "ai";
import { ktemiaTools } from "@ktemia/ai-sdk";

const { text, steps } = await generateText({
  model: "openai/gpt-5-mini",
  tools: ktemiaTools(),
  stopWhen: isStepCount(5),
  prompt: "What is the cheapest flight from Los Angeles to London on March 14?",
});

console.log(steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)).join(" -> "));
console.log(text);
