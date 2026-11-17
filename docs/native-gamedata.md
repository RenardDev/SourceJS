# Native GameData

Native GameData identifies methods in the loaded binary. It is separate from the JavaScript API and does not change a game's vtables. SourceJS associates each profile with a live library address, such as the vtable of an interface supplied by the engine.

## Native address resolver

The resolver searches the currently loaded libraries. A query for one library stops at the first matching module; listing binaries still enumerates all modules. Symbol lookup uses the platform export lookup first. On Linux, lookup can also use verified local ELF symbols. Repeated ELF lookups reuse an immutable file image if its identity, size, and modification metadata still match. The resolver does not keep the library loaded or cache its addresses.

## Virtual method patches

The entity animation bindings read `addons/sourcejs/gamedata/main/VirtualMethodPatches/server.json`. They select the `CBaseAnimating` table for the current platform, architecture, and SDK. The profile's `Version` is `1`.

- Windows records `Slots`, `BaseClass`, `BaseOverrides`, and zero-based `Methods` indices. `+` indicates an overridden base slot; `-` indicates an unchanged slot. The patcher checks inheritance, table sizes, and the override pattern. These checks are not proof of method identity after every engine update.
- Linux records `Slots`, the Itanium RTTI `TypeName`, and a `Methods` object. Each method starts with `Slot`, followed by its exact ELF `Symbol`. When only the vtable symbol is missing, the patcher uses verified method addresses to find candidate primary tables and checks their RTTI name and configured slots. A slot is unavailable if its method symbol is missing or its address does not match.

The format does not use byte signatures, fixed library-relative addresses, or binary checksums. If a rebuild changes the symbols or table layout, verify and update the affected GameData.

The entity animation bindings cache verified method addresses and, on Linux, the results of other animation symbol lookups. Runtime shutdown clears both caches, including cached misses. Reload SourceJS to pick up an edited profile, or restart the server if hot reload is unavailable.
