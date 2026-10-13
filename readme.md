# wrontend

this is an [Ollama](https://github.com/ollama/ollama)-powered [Electron](https://github.com/electron/electron) app that leverages [ACPs](https://github.com/agentclientprotocol/agent-client-protocol) to combine multiple different agent harnesses into one, unified experience.

## what is here

wrontend's window opens empty: its renderer is a bare React root. everything wrontend does lives in its main process, and the page reaches all of it through one typed bridge, `window.wrontend`, whose every channel is listed in `src/shared/ipc.ts`:

- **sessions** — a harness process per session, spoken to over ACP, with its transcript built and kept in the main process: messages, thinking, tool calls, plans, permission requests, and the files each turn changed as one diff per file. a UI mirrors it with `session:list` and `session:changed`.
- **the proxy** — every harness reaches Ollama through it, so the model and the effort can change mid-session, side requests are answered or passed on by policy, and every request is measured.
- **models** — Ollama's models and their status, copies of thinking models with a renderer so they keep their earlier reasoning, GGUF repos on Hugging Face with what fits on this machine, and downloads into Ollama.
- **components** — Claude Code installs the first time it is picked, through npm, into wrontend's own data folder.
- **the updater** — harnesses, models and Ollama itself, checked on launch and every few hours.
- **settings** — wrontend's own, and Ollama's server settings, stored where Ollama reads them, with a restart that applies them.

## running it

wrontend is portable and has no installer: unpack the zip anywhere and start `wrontend.exe`. it is not signed, so Windows SmartScreen asks on the first start — *More info*, then *Run anyway*. Ollama itself is yours to install.

its settings, sessions and installed harnesses live in `%APPDATA%\wrontend`, so replacing or moving the app's folder keeps them. to keep them beside the app instead — on a USB stick, say — put an empty file named `portable.txt` (or just `portable`) next to `wrontend.exe`; the data then goes into a `data` folder there.

## building

```
npm install
npm run dist
```

the zip lands in `dist/`. `npm run dev` starts wrontend from source, `npm test` runs the unit tests and `npm run smoke` drives the built app through a scripted session with a fake agent, over the same bridge a UI uses. `npx electron scripts/render-icon.mjs` renders `build/icon.svg` into the `build/icon.ico` the zip takes; with neither there, it takes Electron's own icon.

## license

wrontend is free software under the [GNU Affero General Public License](LICENSE), version 3 or any later version.
