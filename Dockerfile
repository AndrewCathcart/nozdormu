# The image Railway runs. There's no build step: Node runs the TypeScript directly.
FROM node:26.10.0-slim

WORKDIR /app
COPY . .

# pnpm's version comes from package.json, so Renovate keeps the two in step. Install scripts are
# skipped: no runtime dependency needs one, and the root "prepare" script is for local git hooks.
RUN npm install --global "pnpm@$(node --print "require('./package.json').packageManager.split('@')[1]")" \
  && pnpm install --frozen-lockfile --prod --ignore-scripts

USER node

# Exec form, so Node is PID 1 and gets Railway's SIGTERM directly.
CMD ["node", "apps/bot/src/main.ts"]
