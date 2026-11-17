# SDK Branch Build And Test Notes

> Warning: This file is large for AI-agent processing. Read it by section and
> use the table of contents for navigation.

## Table of Contents

- [External Inputs](#external-inputs)
- [SDK Checkout](#sdk-checkout)
- [V8](#v8)
- [SOCI, redis++ and cpr](#soci-redis-and-cpr)
- [Current SourceJS Configure Shape](#current-sourcejs-configure-shape)
- [GitHub Actions](#github-actions)
- [Full SDK Sweep](#full-sdk-sweep)
- [Upgrade An Existing Installation](#upgrade-an-existing-installation)
- [VSP Smoke Test](#vsp-smoke-test)
- [SSH Workflow](#ssh-workflow)
- [Build Verification Checklist](#build-verification-checklist)

Left 4 Dead 2 using the `l4d2` branch of `alliedmodders/hl2sdk` is the baseline
SourceJS validation target. The manual GitHub workflow and local sweep also
cover the other supported Linux and Windows SDK targets.

## External Inputs

- HL2SDK: <https://github.com/alliedmodders/hl2sdk>, with the known branch list
  in `.github/workflows/build.yml`
- V8 build scripts in this repository: `v8.sh`, `v8.bat`
- Required native libraries: SOCI with SQLite3 and MySQL/MariaDB, redis++ and cpr
- Debian build/test VM: `debian@192.168.159.129`
- Code style: [CODE_STYLE_GUIDE.md](../CODE_STYLE_GUIDE.md)

## SDK Checkout

Recommended local layout on the Debian VM:

```sh
mkdir -p ~/sourcejs/external
cd ~/sourcejs/external
git clone --branch l4d2 https://github.com/alliedmodders/hl2sdk.git hl2sdk-l4d2
```

Branch definitions for the L4D2 target:

```text
ENGINE_BRANCH_L4D2
ENGINE_LEFT4DEAD2
GAME_DLL
```

The current common Linux compile contract is:

```text
Definitions: LINUX _LINUX POSIX GNUC COMPILER_GCC
Language mode: -std=c++20
Options: -Wall -Wextra -fPIC
```

Use `-m32` only for x86 Linux builds. SourceJS builds only architectures
provided by the selected SDK branch: L4D2 is x86-only, while a branch such as
TF2 provides x86 and x64 libraries. Both Linux architectures must link the
mandatory static SOCI, redis++ and cpr archives. Both architectures default to
`SOURCEJS_LINUX_LINKER=lld` for V8 archives containing LLVM bitcode or CREL
relocations. Select `SOURCEJS_LINUX_LINKER=bfd` only with V8 archives containing
standard ELF objects and relocations, without LLVM bitcode or CREL. Linux links
use `-z text`, so a plugin requiring text relocations fails to build. For legacy
x86 SDKs, the build recompiles selected tier1, mathlib, and interfaces objects
with PIC as needed and builds protobuf 2.5 from the selected SDK's sources. The
replacement archives live in the build directory; the SDK checkout is unchanged
and unwind metadata is retained. The SourceJS SOCI vcpkg overlay disables SOCI's
GCC LTO so its static objects can also be linked by `lld`.

The Linux x86 `-m32` flags are initialized before CMake's `project()` call so
package detection sees a 32-bit target and accepts `x86-linux` vcpkg configs
such as SOCI. The SourceJS target also uses the SDK's x86 SSE contract
(`-msse -msse2 -mfpmath=sse`), which is required by modern branches such as
TF2 whose math headers call SSE intrinsics directly.

The L4D2 SDK libraries used by SourceJS are:

```text
lib/linux/mathlib_i486.a
lib/linux/tier1_i486.a
lib/linux/tier2_i486.a
lib/linux/tier3_i486.a
lib/linux/libtier0_srv.so
lib/linux/libvstdlib_srv.so
```

For L4D2 x86, CMake requires `mathlib`, `tier1` and `tier0`, then adds `tier2`,
`tier3` and `vstdlib` when those libraries exist in the selected checkout.
CMake rejects an L4D2 x64 configuration. The same selected-checkout rule applies
to x64-capable branches; libraries are never borrowed from TF2 or another
branch.

V8 requires C++20, while some selected Source SDK headers predate C++20's
rewritten comparison candidates. On GNU C++, CMake conditionally generates
overlays from the selected branch's headers under
`build/<configuration>/sourcejs-hl2sdk-cxx20`. These make ambiguous `CUtlSymbol`
and `CUtlStringMap` conversions explicit, adapt `CUtlMemory` swap/aligned-allocation
calls, and supply a missing `V_swap` utility when needed. Other selected-header
repairs cover a missing `CCollisionProperty` virtual declaration, checked
address-sized `MyOffsetOf` arithmetic and the case-sensitive `IAppSystem.h`
include spelling. SDK API spellings are preserved; the selected checkout is not
modified and classes are not reimplemented. Stale files are removed only from
this generated overlay family when requirements change. Linked libraries still
come from the selected branch, never another SDK checkout.

## V8

The repository scripts currently build V8 `14.4.230` with:

- monolithic V8
- no i18n data file
- no external startup data
- x86 and x64
- debug and release

For local Linux builds, run the V8 script from the SourceJS repository root
before configuring SourceJS. Its default output is relative to that working
directory:

```sh
./v8.sh
```

On a smaller VM, build one configuration at a time and cap Ninja parallelism:

```sh
SOURCEJS_V8_CONFIGS=x64.release SOURCEJS_V8_JOBS=8 ./v8.sh
```

The default script configuration writes artifacts under:

```text
v8/out/x86.release/
v8/out/x86.debug/
v8/out/x64.release/
v8/out/x64.debug/
```

Linux V8 builds set `v8_monolithic_for_shared_library=true` because SourceJS is
a VSP `.so` and links `libv8_monolith.a` into that shared object. Without that
GN arg, V8 uses Linux `local-exec` TLS relocations that cannot be linked into a
dynamically loaded plugin.

The V8 build scripts also set `v8_expose_public_symbols=true`. This exposes
the public V8 C++ API from the SourceJS binary so native extensions can link
to the same V8 engine. Rebuild older V8 archives before linking an extension
that uses out-of-line V8 calls. Extension builds must use the same V8
configuration as the host; the runtime packages do not ship extension SDK
headers or Windows import libraries.

CMake accepts explicit paths instead of assuming V8 lives in the repository
root:

```text
-DV8_ROOT=/path/to/v8
-DV8_CONFIG=x86.release
```

CMake requires `V8_ROOT/out/V8_CONFIG/v8_build_config.json` from the same build
as the selected monolith. It reads the pointer-compression, shared-cage, sandbox
and direct-handle flags to match the embedder ABI; missing metadata, missing
features or non-boolean values stop configuration. Keep this file with the V8
archive when transferring a build. Metadata changes trigger reconfiguration.

The isolated extension contract test in
[`tools/fixtures/extension-isolate`](../tools/fixtures/extension-isolate/CMakeLists.txt)
uses the same `V8_ROOT` and `V8_CONFIG` options. On x86, select the Win32
generator architecture or pass `-DCMAKE_CXX_FLAGS=-m32` on Linux. Build it
and run CTest to check that native callbacks copy data between isolates and
that delayed references stay revoked after unload and reload.
After rebuilding V8 with exported symbols, pass
`-DSOURCEJS_TEST_V8_IMPORTS=ON` to also test calls through the host's
out-of-line V8 exports.

## SOCI, redis++ and cpr

SourceJS requires SOCI, redis++ and cpr. Local builds should install them with
the same package manager used for configuration and pass its CMake toolchain or
package prefix to CMake.

SOCI must provide both SQLite3 and MySQL backend targets. CI installs
`soci[mysql,sqlite3]`; SourceJS requires the exported SQLite3 and MySQL targets
and links them into the native binary, so the native `soci` module can open
SQLite, MySQL and MariaDB sessions directly.

The GitHub workflow uses vcpkg and passes:

```text
-DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake
-DVCPKG_TARGET_TRIPLET=<triplet>
```

Dependency installation also passes:

```text
--overlay-ports <repo>/cmake/vcpkg-ports
```

The `fmt` 12.2.0 overlay supplies the missing bitwise-not operator for
`fmt::detail::uint128`. Without that patch, its `long double` formatting path
can fail to compile for `x86-linux`. The dependency remains mandatory.

The SOCI overlay disables LTO so Linux x64 can link its static objects together
with LLVM-bitcode V8. The libmysql overlay selects `global-dynamic` TLS instead
of the upstream `initial-exec` model, which cannot be loaded after the L4D2
server has exhausted its small static TLS reserve.

Linux defaults to `lld` for V8 archives containing LLVM bitcode or ELF CREL
compact relocations. Linux x86 embeds libstdc++ and libgcc behind a version
script so Valve's older runtime remains in use by the engine while the plugin
uses its own compatible C++ runtime.

Both Linux x86 and x64 link the compiler's matching static `libatomic.a`.
CMake queries the compiler with `-m32` or `-m64` and fails configuration if the
archive is unavailable. This resolves atomic operations required by the native
dependencies without adding a runtime dependency on `libatomic.so`.

If the linker still reports a relocation in a read-only section, identify the
reported archive and object and rebuild that dependency from matching sources
with PIC. Do not use `-z notext` or strip SDK/V8 unwind sections. Before publishing
a Linux package, use `readelf -d addons/sourcejs/bin/sourcejs.so` to verify it has no `TEXTREL`
tag or flag.

## Current SourceJS Configure Shape

The L4D2 build command uses explicit SDK, platform, architecture and V8 paths:

```sh
cmake -S . -B build/linux-l4d2-release \
	-DSOURCEJS_PLATFORM=linux \
	-DSOURCEJS_ARCH=x86 \
	-DSOURCEJS_SDK_BRANCH=l4d2 \
	-DHL2SDK_ROOT="$HOME/sourcejs/external/hl2sdk-l4d2" \
	-DV8_ROOT="$PWD/v8" \
	-DV8_CONFIG=x86.release \
	-DCMAKE_TOOLCHAIN_FILE="$HOME/sourcejs/external/vcpkg/scripts/buildsystems/vcpkg.cmake" \
	-DVCPKG_TARGET_TRIPLET=x86-linux \
	-DCMAKE_BUILD_TYPE=Release

cmake --build build/linux-l4d2-release -j"$(nproc)"
cmake --install build/linux-l4d2-release --prefix package/sourcejs-linux-l4d2-x86
```

Windows TF2 x64 local smoke build:

This example assumes Visual Studio 18 2026. Use a generator listed by the local
`cmake --help` output; the reusable GitHub workflow currently requests Visual
Studio 17 2022.

```powershell
cmake -S . -B build/win-tf2-x64-msvc -G "Visual Studio 18 2026" -A x64 `
	-DSOURCEJS_PLATFORM=windows `
	-DSOURCEJS_ARCH=x64 `
	-DSOURCEJS_SDK_BRANCH=tf2 `
	-DHL2SDK_ROOT=C:/path/to/hl2sdk-tf2 `
	-DV8_ROOT=C:/path/to/v8 `
	-DV8_CONFIG=x64.release `
	-DCMAKE_TOOLCHAIN_FILE=C:/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake `
	-DVCPKG_TARGET_TRIPLET=x64-windows-static `
	-DCMAKE_BUILD_TYPE=Release

cmake --build build/win-tf2-x64-msvc --config Release --target sourcejs --parallel
```

## GitHub Actions

The repository contains two workflow files:

- `.github/workflows/build.yml`
- `.github/workflows/build-sdk-branch.yml`

`build.yml` does not run on pushes or pull requests. In **Actions → Build
SourceJS → Run workflow**, select the SDK, platform and architecture for one
Release package. An unsupported combination fails validation before either V8
preparation or the SDK build starts.

The architecture policy is explicit and branch-specific. Targets are available only when
the pinned SDK contains the required platform/ABI libraries. For example,
L4D2 and CS:GO have only x86 jobs, while TF2 has x86/x64 jobs. Source 2 branches
are excluded because their SDKs do not expose the Source 1 VSP callbacks used by
SourceJS. A directory containing a partial client library set does not qualify as
a server target; the SDK must provide a complete `tier0`, `tier1` and `mathlib`
set for that platform and ABI.

| SDK branch | Linux | Windows |
| --- | --- | --- |
| `bgt` | x86 | x86 |
| `blade` | x86, x64 | x86, x64 |
| `bms` | x86 | x86 |
| `contagion` | x86 | x86 |
| `csgo` | x86 | x86 |
| `css` | x86, x64 | x86, x64 |
| `darkm` | - | x86 |
| `dods` | x86, x64 | x86, x64 |
| `doi` | x86 | x86, x64 |
| `episode1` | - | x86 |
| `eye` | x86 | x86 |
| `gmod` | x86 | x86 |
| `hl2dm` | x86, x64 | x86, x64 |
| `insurgency` | x86 | x86, x64 |
| `l4d` | x86 | x86 |
| `l4d2` | x86 | x86 |
| `mcv` | x86, x64 | x86, x64 |
| `nucleardawn` | x86 | x86 |
| `orangebox` | x86 | x86 |
| `portal2` | - | x86 |
| `pvkii` | x86 | x86 |
| `sdk2013` | x86 | x86 |
| `swarm` | - | x86 |
| `tf2` | x86, x64 | x86, x64 |

The current explicit branch set is:

```text
bgt
blade
bms
contagion
csgo
css
darkm
dods
doi
episode1
eye
gmod
hl2dm
insurgency
l4d
l4d2
mcv
nucleardawn
orangebox
portal2
pvkii
sdk2013
swarm
tf2
```

The selected build passes both `sdk_branch` and a pinned `sdk_ref` SHA.
The branch name selects SourceJS compile definitions and artifact naming; the
SHA pins the exact `alliedmodders/hl2sdk` commit that is built. This keeps CI
stable if an upstream SDK branch moves.

The selected job calls `build-sdk-branch.yml`, which:

- checks out `alliedmodders/hl2sdk` at the configured pinned commit;
- installs mandatory `soci[mysql,sqlite3]`, redis++ and cpr dependencies with
  vcpkg for the job's target triplet;
- configures SourceJS with `SOURCEJS_SDK_BRANCH=<branch>`;
- passes `SOURCEJS_ARCH`, `HL2SDK_ROOT`, `V8_ROOT` and the matching
  `V8_CONFIG` to CMake;
- builds SourceJS;
- runs `cmake --install` into a package directory;
- verifies that the package contains the required runtime layout;
- uploads the package as a GitHub Actions artifact.

Download the package from **Artifacts** on the successful run. Artifact names:

```text
sourcejs-linux-<sdk-branch>-<arch>
sourcejs-windows-<sdk-branch>-<arch>
```

## Full SDK Sweep

`tools/build_sdk_sweep.py` performs the same branch and architecture coverage
locally without reducing it to the L4D2, CS:GO or TF2 smoke targets. It reads
the pinned refs and supported-target matrix used by the project verifier,
checks out isolated HL2SDK worktrees, builds targets concurrently and writes a
separate log and JSON result for every target. Successful temporary build
trees are removed after recording the binary size; failed build trees can be
retained with `--keep-failed-builds`. Use a dedicated build root; cleanup
rejects redirected worker paths.

Linux example:

```sh
python3 tools/build_sdk_sweep.py \
	--platform linux \
	--source-root "$PWD" \
	--v8-root "$PWD/v8" \
	--vcpkg-root "$HOME/sourcejs/external/vcpkg" \
	--sdk-repository "$HOME/sourcejs/sweep/hl2sdk" \
	--worktree-root "$HOME/sourcejs/sweep/worktrees" \
	--build-root "$HOME/sourcejs/sweep/build" \
	--log-root "$HOME/sourcejs/sweep/logs/linux" \
	--result-root "$HOME/sourcejs/sweep/results/linux" \
	--workers 4 \
	--jobs 8 \
	--resume
```

Windows example:

```powershell
python tools/build_sdk_sweep.py `
	--platform windows `
	--source-root "$PWD" `
	--v8-root "$PWD\v8" `
	--vcpkg-root "$PWD\external\vcpkg" `
	--sdk-repository "$PWD\external\hl2sdk-sweep" `
	--worktree-root "$PWD\build\sdk-worktrees" `
	--build-root "$PWD\build\sdk-sweep" `
	--log-root "$PWD\artifacts\sdk-sweep\logs\windows" `
	--result-root "$PWD\artifacts\sdk-sweep\results\windows" `
	--workers 4 `
	--jobs 4 `
	--resume
```

Without `--branches` and `--architectures`, every target supported on the
selected platform is built. `--resume` skips only successful results whose
source fingerprint still matches the native source, CMake files and Detours
files under `--source-root`, and whose recorded platform, branch, architecture
and pinned HL2SDK revision match the requested target. Changing the pinned
revision invalidates its cached result automatically. The fingerprint does
not hash external SDK, V8 or vcpkg file contents; omit `--resume` after changing
these inputs in place, even at the same SDK revision. The sweep checks the
native binary, not installation or a running game server; perform the package
and VSP checks below separately.

Malformed JSON, non-object JSON, invalid UTF-8, result-file read errors and
missing or mismatched target/revision fields are treated as cache misses.

Run the sweep helper regression check without network requests, builds or
filesystem deletion:

```sh
python3 tools/smoke_sdk_sweep.py
```

Use `python` instead of `python3` on Windows.

Only the selected platform's V8 preparation job runs. The cache key includes
the platform, architecture, V8 version and build script hash. On a miss,
`v8.sh` or `v8.bat` builds only the selected `<arch>.release` configuration.
Enable `build_v8` to force a rebuild with a fresh cache key for that run.

On Linux, execute `v8.sh`; sourcing it is rejected without changing the caller's
shell options. `-h` and `--help` print usage without dependency or installer
actions. Invalid arguments, configurations or job counts exit with status `2`
before build actions and without a build-result marker. Configuration names and
decimal job counts follow the same selections described below for Windows.
A build ends with exactly one `V8_BUILD_SUCCESS` or `V8_BUILD_FAILURE` line;
success exits `0`, and command failures retain their original nonzero status.
Cleanup attempts to restore the script's working directory, including handled
interrupts and termination signals. Real V8 dependencies and the Linux installer
are only invoked after validation.

On Windows, `v8.bat` uses the caller's current directory as its dependency
workspace; it does not switch to the script's directory. Windows PowerShell
validates `SOURCEJS_V8_CONFIGS` and `SOURCEJS_V8_JOBS` before dependency commands.
Configurations are selected from `x86.debug`, `x86.release`, `x64.debug` and
`x64.release`, separated by spaces or tabs. Jobs must contain decimal digits;
`0` is preserved as `-j 0`. With no overrides, all four configurations are built.

Use `v8.bat --help` or `v8.bat -h` for usage without build actions. Unsupported
arguments or settings exit with status `2` and no build-result marker. A valid
build exits with status `0` or `1` and ends with exactly one `V8_BUILD_SUCCESS`
or `V8_BUILD_FAILURE` line. Every build exit attempts to restore the caller's
directory, environment and captured console code page; a restoration failure
also fails the build. Headless sessions leave an unavailable code page unchanged.

The installed package for every branch must contain:

```text
addons/sourcejs.vdf
addons/sourcejs/bin/sourcejs.dll  # Windows packages
addons/sourcejs/bin/sourcejs.so   # Linux packages
addons/sourcejs/data/
addons/sourcejs/docs/sourcejs/
addons/sourcejs/extensions/
addons/sourcejs/gamedata/
addons/sourcejs/package-manifest.json
addons/sourcejs/packages/sourcejs/
addons/sourcejs/plugins/
cfg/sourcejs/
logs/sourcejs/
resource/sourcejs/
sound/sourcejs/
```

`addons/sourcejs/package-manifest.json` records the SourceJS name and version,
SDK branch, platform, architecture, V8 runtime, native entrypoint and the package,
documentation, plugin and extension roots. Its project-owned keys use PascalCase:
`Name`, `Version`, `SDKBranch`, `Platform`, `Architecture`, `Runtime`, `Entrypoint`,
`Packages`, `Docs`, `Plugins` and `Extensions`. CI validates the required paths
separately and runs `tools/verify_package_copy.py` against the installed CommonJS
tree. These checks validate package layout and source-copy freshness, not native
loading or gameplay.

The runtime ZIP includes the JavaScript plugin SDK and examples. It does not
include native extension headers or the `echo` extension example. To develop
native extensions, clone the repository; install only the resulting extension
binary and its manifest under `addons/sourcejs/extensions/`.

### Upgrade An Existing Installation

Stop the server before extracting the new package over the existing
installation. Replace `addons/sourcejs.vdf` and remove the obsolete
`addons/sourcejs.dll` or `addons/sourcejs.so` if present. Keep your configuration,
plugins and native extensions.

## VSP Smoke Test

Run the commands from the server console before a map starts, then repeat the
`sjs` queries after the map loads:

```text
plugin_load addons/sourcejs/bin/sourcejs
plugin_print
sjs version
sjs plugins list
sjs extensions list
```

Representative successful log lines are shown below. Console-command
registration may appear before or after interface connection depending on
whether the selected SDK exposes `ICvar` through the early factory call.
Interface names, addresses and paths below are placeholders, not fixed SDK
values or results from a live-server test.

```text
[SourceJS] [INFO] SourceJSPlugin.RegisterConsoleCommands completed: sjs registered.
[SourceJS] [INFO] EngineInterfaces.LoadOptionalInterface loaded Interface="VEngineServer..." Address=....
[SourceJS] [INFO] EngineInterfaces.Connect completed.
[SourceJS] [INFO] Load resolved game root Path="..."
[SourceJS] [INFO] V8Runtime.Initialize completed.
[SourceJS] [INFO] Load succeeded.
```

The bundled `server-administration` plugin autoloads. Run `sjs_help gag` to
confirm that its console commands are registered. The `hello` demonstration is
installed under `addons/sourcejs/plugins/disabled`. To test it, move its directory
out of `disabled`, then run `sjs plugins load hello` explicitly. To test `echo`,
clone the repository and follow [the native extension example](../examples/extensions/echo/README.md).
Query both lists again after the map starts.

For a live gameplay and SQLite regression check, use a disposable server copy.
Install SourceJS there, then copy [the stock player-actions fixture](../tools/fixtures/stock-player-actions/)
under `addons/sourcejs/plugins/stock-player-actions-test`. Start this loopback
listener on the same host before launching the server:

```sh
node -e "require('node:net').createServer(() => {}).listen(27352, '127.0.0.1')"
```

Start `c1m1_hotel` in the disposable server. The fixture changes test ConVars,
creates test bots and checks movement transitions, angle-only teleport without
changing position or velocity, and additive velocity. It verifies slap damage,
the death event, and frag preservation. It checks that
`sjs_burn` attaches a flame for the requested duration and that the flame
expires, recording health before and after without assuming that this source
of ignition deals damage. It then checks the timebomb carrier's death,
distance-based damage to a teammate, and the teammate's upward impulse. It also
verifies SQL group cleanup and persistence across a SQLite reopen. The fixture
logs `Stock player actions test passed` and quits the server. Do not install
this fixture on a running or production server.

To check temporary IP-filter expiry, use [the stock IP-ban fixture](../tools/fixtures/stock-ip-ban/)
instead of the player-actions fixture. Copy its `index.js` and `plugin.json` into
`addons/sourcejs/plugins/stock-ip-ban-test`, run `node tools/fixtures/stock-ip-ban/probe.js`
on the server host, and start the isolated server on `127.0.0.1:27362` with
`c1m1_hotel`. The fixture adds a one-minute filter for `127.0.0.2`. The companion
sends local Source status queries before and after the deadline. Confirm that the
first `listip` contains the one-minute filter and the second reports an empty list.
This checks expiry on network traffic, not successful admission of a game client.
Do not install the fixture on a running or production server; it sets test ConVars
and quits the server.

## SSH Workflow

From this workspace:

```sh
ssh debian@192.168.159.129
```

Suggested remote workspace:

```sh
mkdir -p ~/sourcejs
```

After the one-time dependency, V8 and CMake configuration, the normal remote
validation loop below assumes a clean, committed checkout at `~/sourcejs`.
`git pull --ff-only` does not transfer uncommitted changes from the local
workspace. When validating local edits, first synchronize the changed owned
source, CMake, dependency integration, package, template, test and documentation
files to the configured remote checkout and compare their hashes. Complete that
transfer before building; preserve remote dependencies, build trees and local
configuration rather than blindly deleting unmatched files.

```sh
cd ~/sourcejs
git pull --ff-only
cmake --build build/linux-l4d2-release -j"$(nproc)"
cmake --install build/linux-l4d2-release --prefix package/sourcejs-linux-l4d2-x86
rsync -an --exclude='/cfg/' "package/sourcejs-linux-l4d2-x86/" "/path/to/l4d2/left4dead2/"
```

Stop the server and review the dry-run output before updating managed files.
Keep configuration out of that update. Seed the configuration tree only on a
first installation, when no existing path or link already occupies it:

```sh
rsync -a --exclude='/cfg/' "package/sourcejs-linux-l4d2-x86/" "/path/to/l4d2/left4dead2/"

if [ ! -L "/path/to/l4d2/left4dead2/cfg" ] &&
	[ ! -e "/path/to/l4d2/left4dead2/cfg/sourcejs" ] &&
	[ ! -L "/path/to/l4d2/left4dead2/cfg/sourcejs" ]; then
	mkdir -p "/path/to/l4d2/left4dead2/cfg/sourcejs/"
	rsync -r --ignore-existing "package/sourcejs-linux-l4d2-x86/cfg/sourcejs/" "/path/to/l4d2/left4dead2/cfg/sourcejs/"
fi
```

Existing configuration trees and links are left unchanged; merge new defaults
manually when upgrading. The configuration step also skips a linked `cfg`
directory, whose layout must be managed explicitly.

## Build Verification Checklist

1. Configure with explicit `SOURCEJS_SDK_BRANCH`, `SOURCEJS_ARCH`, `HL2SDK_ROOT`,
   `V8_ROOT`, `V8_CONFIG` and vcpkg triplet values.
2. Build the `sourcejs` target and confirm that branch-specific SDK libraries,
   V8, SOCI SQLite/MySQL, redis++ and cpr all link into the VSP binary.
3. Run `cmake --install` and verify the package manifest, modules, examples,
   extensions, GameData, data and runtime directories. Run
   `python tools/verify_package_copy.py --package-root package/sourcejs-linux-l4d2-x86/addons/sourcejs/packages/sourcejs`
   for the installed example above; substitute the actual installation path.
4. Run `python tools/verify_project.py`; it includes the focused package/API
   smoke tests and checks existing package copies under `package/` and
   `artifacts/`. It does not install a package or replace native compilation and
   live-server checks.
5. Deploy the package and verify `plugin_load addons/sourcejs/bin/sourcejs`, `sjs`, plugin
   loading and extension loading before and after a map starts. Test autoload
   with deliberately enabled manifests and a compiled extension binary.
