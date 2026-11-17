# SourceJS

Write server-side JavaScript plugins for Valve's Source 1 engine. SourceJS
embeds V8 in a Valve Server Plugin (VSP) and exposes the engine through CommonJS
modules such as `events`, `players`, and `cvars`. Plugins run inside the game
server; a separate Node.js process is not required.

[Downloads](https://github.com/RenardDev/SourceJS/releases) ·
[Supported SDKs](docs/sdk-support.md) ·
[JavaScript API](docs/api/README.md) ·
[Build from source](docs/build-l4d2.md)

## What You Can Build

- React to game events and work with players, entities, console commands, and cvars.
- Add server commands, menus, votes, and moderation tools. The package includes
  ready-to-use [administration plugins](docs/server-administration.md) with
  commands such as `sjs_ban` and `sjs_gag`, plus public `!` and hidden `/` chat commands.
- Use [HTTP, Redis, SQL, and sockets](docs/external-libraries.md) from plugins.
  Requests are nonblocking by default and deliver their callbacks on the game
  thread. Use `Blocking: true` only when the server must wait, such as during startup.

## Install

1. Choose a ZIP from [GitHub Releases](https://github.com/RenardDev/SourceJS/releases)
   that matches the server's SDK branch, operating system, and **server process**
   architecture. For example, Left 4 Dead 2 uses `l4d2` and `x86`, even on a
   64-bit host. See the [support matrix](docs/sdk-support.md) for other games.
2. Check the ZIP against the release's `SHA256SUMS.txt`. With the server stopped,
   extract it into the game directory that contains `gameinfo.txt`, not into
   `addons/`. The VDF belongs at `addons/sourcejs.vdf`; the DLL or SO belongs
   under `addons/sourcejs/bin/`.
3. Start the server and run these commands in its console:

   ```text
   sjs version
   sjs plugins list
   ```

If no matching release asset is available, follow the
[build guide](docs/build-l4d2.md). For an existing installation, see the
[upgrade instructions](docs/build-l4d2.md#upgrade-an-existing-installation).

## Your First Plugin

Create `addons/sourcejs/plugins/hello-sourcejs/plugin.json`:

```json
{
  "Name": "hello-sourcejs",
  "Entry": "index.js",
  "Autoload": false
}
```

In the same directory, create `index.js`:

```js
"use strict";

const { GetSourceJSVersion } = require("core");
const { LogInfo } = require("loggers");

LogInfo("Hello from SourceJS %s!", GetSourceJSVersion());
```

Run `sjs plugins load hello-sourcejs` in the server console. The plugin prints
the SourceJS version when loaded. Set `Autoload` to `true` to load it at startup.
See the [plugin guide](docs/api/plugins.md) for lifecycle details and the
[examples](examples/plugins/disabled) for complete plugins.

## Documentation

- [Runtime commands](docs/runtime-commands.md) and [server administration](docs/server-administration.md)
- [JavaScript API](docs/api/README.md), [architecture](docs/architecture.md), and [GameData](docs/api/memory-gamedata.md)
- [Build and test](docs/build-l4d2.md) and [code style](CODE_STYLE_GUIDE.md)

The runtime ZIP contains the JavaScript SDK and examples. To develop native
extensions, clone the repository for the ABI headers and the
[native extension example](examples/extensions/echo/README.md).

## License

[MIT](LICENSE)
