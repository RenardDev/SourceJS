# Echo Extension

The [C++ implementation](Echo.cpp) includes `v8.h`. It registers `Echo` as a
native V8 callback. SourceJS runs it inside a separate isolate for each load;
there is no JavaScript source embedded in the library.

## Build and install

Build with the same V8 checkout and configuration that was used for SourceJS.
The runtime package does not include extension headers, sample libraries or
Windows import libraries; build extensions from a repository checkout.

For Windows x86:

```powershell
cmake -S examples/extensions/echo -B build/echo -A Win32 "-DV8_ROOT=external/v8" "-DV8_CONFIG=x86.release"
cmake --build build/echo --config Release
```

For Linux x86:

```bash
cmake -S examples/extensions/echo -B build/echo -DCMAKE_CXX_FLAGS=-m32 -DV8_ROOT=external/v8 -DV8_CONFIG=x86.release
cmake --build build/echo
```

Use the matching compiler architecture and V8 configuration for x64.
Copy `extension.json` and the compiled library under
`addons/sourcejs/extensions/echo`, with the library in `bin/echo.dll` or
`bin/echo.so`. Do not link a second V8 engine into the extension.

By default, the sample calls only inline V8 APIs. Setting
`SOURCEJS_EXTENSION_HOST_LIBRARY` also builds `GetV8Version()` to demonstrate
an out-of-line V8 call. Set it to the matching build's
`sourcejs.lib` (Windows) or `sourcejs.so` (Linux). Build V8 with the project
scripts to export its public symbols from SourceJS. On Linux make sure the
binary links to the installation's SourceJS library, not a second copy;
use a relative loader search path for deployment.

## Load and call

```text
sjs extensions load echo
sjs extensions list
```

```js
const { Echo } = require("extensions/echo/echo");
const { LogInfo } = require("loggers");

LogInfo("%s", Echo("SourceJS"));
```

`Echo` returns a copy of its first argument when present. Copyable data can
include `BigInt`, typed arrays and cyclic references. Functions, promises and
live game objects cannot cross the isolate boundary.

Run `sjs extensions unload echo` to destroy the isolated runtime and release
the library. Saved functions throw from that point on, including after
`sjs extensions reload echo`; use a fresh `require()` after loading again.
See the [lifecycle and ABI contract](../../../docs/api/extensions.md) for
cleanup obligations when writing your own extension.
