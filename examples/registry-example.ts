// The exact snippet published in Vercel's AI SDK tools registry
// (content/tools-registry/registry.ts, slug `ktemia`). It lives here so CI
// typechecks it on every commit: the registry copy is the first code most
// people run, and nothing else would tell us if a change broke it.
//
// Run: AI_GATEWAY_API_KEY=... KTEMIA_API_KEY=... npx tsx examples/registry-example.ts
import { generateText, gateway, isStepCount } from 'ai';
import { ktemiaTools } from '@ktemia/ai-sdk';

const { text } = await generateText({
  model: gateway('openai/gpt-5-mini'),
  prompt: 'Find the cheapest flight from Los Angeles to London on March 14.',
  tools: ktemiaTools(),
  stopWhen: isStepCount(5),
});

console.log(text);
