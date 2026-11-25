// A LangChain.js agent with every Ktemia tool.
import { createAgent } from "langchain";
import { ktemiaTools } from "@ktemia/langchain";

const agent = createAgent({
  model: "openai:gpt-5-mini",
  tools: ktemiaTools(),
  systemPrompt: `Today is ${new Date().toISOString().slice(0, 10)}. Ask for missing dates or places instead of guessing.`,
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "What is the cheapest flight from Los Angeles to London on 2027-03-14?" }],
});
console.log(result.messages.at(-1)?.content);
