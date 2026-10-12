# wrontend

this is an [Ollama](https://github.com/ollama/ollama)-powered [Electron](https://github.com/electron/electron) app that leverages [ACPs](https://github.com/agentclientprotocol/agent-client-protocol) to combine multiple different agent harnesses into one, unified experience.

## running it

wrontend is portable and has no installer: unpack the zip anywhere and start `wrontend.exe`. it is not signed, so Windows SmartScreen asks on the first start — *More info*, then *Run anyway*. everything else arrives where it is first needed: a harness installs the first time you pick it, and models come from the model browser. Ollama itself is yours to install.

its settings, sessions and installed harnesses live in `%APPDATA%\wrontend`, so replacing or moving the app's folder keeps them. to keep them beside the app instead — on a USB stick, say — put an empty file named `portable.txt` (or just `portable`) next to `wrontend.exe`; the data then goes into a `data` folder there.

## building

```
npm install
npm run dist
```

the zip lands in `dist/`. `npm run dev` starts wrontend from source, `npm test` runs the unit tests and `npm run smoke` drives the built app through a scripted session. the icon is rendered from `build/icon.svg` with `npx electron scripts/render-icon.mjs`.

## license

wrontend is free software under the [GNU Affero General Public License](LICENSE), version 3 or any later version.
