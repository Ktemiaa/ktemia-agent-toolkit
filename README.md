# Ktemia Agent Toolkit

Live flight, hotel, and rental car prices from 100+ providers for AI agents and TypeScript apps, from [Ktemia](https://www.ktemia.com/).

| Package | For | |
|---|---|---|
| [`ktemia`](packages/ktemia) | Any TypeScript or JavaScript app | [![npm](https://img.shields.io/npm/v/ktemia)](https://www.npmjs.com/package/ktemia) |
| [`@ktemia/ai-sdk`](packages/ai-sdk) | [Vercel AI SDK](https://ai-sdk.dev/) agents | [![npm](https://img.shields.io/npm/v/@ktemia/ai-sdk)](https://www.npmjs.com/package/@ktemia/ai-sdk) |

Using Claude, Cursor, or ChatGPT instead? See the [Ktemia MCP server](https://github.com/Ktemiaa/ktemia-mcp).

## Quick start

```bash
npm install @ktemia/ai-sdk ai zod
export KTEMIA_API_KEY=your-key   # free at https://app.ktemia.com/api-keys
```

```ts
import { generateText, isStepCount } from 'ai';
import { ktemiaTools } from '@ktemia/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  tools: ktemiaTools(),
  stopWhen: isStepCount(5),
  prompt: 'Cheapest flight from Los Angeles to London on March 14?',
});
```

Guide: [ktemia.com/docs/vercel-ai-sdk](https://www.ktemia.com/docs/vercel-ai-sdk/)

## Development

```bash
npm install
npm test            # build, then unit tests (mocked HTTP, mock model)
npm run test:live   # real API and a real model; needs .env (see .env.example)
```

- `packages/ktemia` is the client. It has no runtime dependencies and must stay that way.
- `packages/ai-sdk` wraps it as AI SDK tools.
- Tool descriptions come from `packages/ktemia/src/tools.json`, shared with the MCP server. Update it with `npm run sync-spec`.

Releases: bump both package versions, then push a `v*` tag. GitHub Actions publishes with npm provenance.

## License

MIT
