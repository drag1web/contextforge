# Stage 6.2 — Claude API provider + animated provider selector

## Changed
- Added Anthropic Claude API as an internal AI provider.
- Added server-side settings fields for Claude API base URL, model id, API key configured state, and key clearing.
- Added Claude API status/model listing/generation support through Anthropic Messages API.
- Fixed assisted-generation provider model selection so OpenAI-compatible, Claude API, Gemini and Ollama each use their own configured model.
- Updated Integrations UI provider selector into a smooth sliding card selector inspired by the existing segmented filter animation.
- Clarified wording: internal AI providers are separate from exported coding-agent targets.

## Build checks run
- npm run build -w @contextforge/server
- npx tsc -b apps/desktop/renderer

## Not touched
- Task file selector logic
- Context selection/fallback logic
- Context quality scoring
- Project Memory backend/flow
