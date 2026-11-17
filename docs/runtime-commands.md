# Runtime Commands

> Warning: This file is dense for AI-agent processing. Read it by section and
> use the table of contents for navigation.

## Table of Contents

- [Command Tree](#command-tree)
- [Client Console View](#client-console-view)
- [Root Commands](#root-commands)
- [Authorization](#authorization)
- [Plugins](#plugins)
- [Extensions](#extensions)
- [Name And Index Resolution](#name-and-index-resolution)
- [Persistent State](#persistent-state)
- [Errors](#errors)

SourceJS exposes one server command root:

```text
sjs
```

The command is registered by the native core during VSP `Load()`. The complete
administrative tree is available from the server console and RCON before,
during and after map loads. A connected client receives a separate read-only
view.

## Command Tree

```text
sjs
sjs version
sjs modules
sjs auth
sjs auth permission player add <network-id> <permission>
sjs auth permission player remove <network-id> <permission>
sjs auth permission player test <network-id> <permission>
sjs plugins
sjs plugins list
sjs plugins load <name>
sjs plugins unload <name/index>
sjs plugins unload_all
sjs plugins reload <name/index>
sjs plugins reload_all
sjs plugins disable <name/index>
sjs plugins enable <name/index>
sjs extensions
sjs extensions list
sjs extensions load <name>
sjs extensions unload <name/index>
sjs extensions unload_all
sjs extensions reload <name/index>
sjs extensions reload_all
sjs extensions disable <name/index>
sjs extensions enable <name/index>
```

## Client Console View

Entering `sjs` in a connected game client's console prints the SourceJS version
and only the read-only client commands:

```text
sjs version
sjs plugins list [0|10|20|...]
sjs extensions list [0|10|20|...]
```

`sjs version` is also accepted as a compact version-only query. Administrative
operations such as load, unload, reload, enable, disable, and native-module
listing are never dispatched from this client view.

Plugin and extension lists are sent one compact line at a time and contain at
most ten records. The optional value is a zero-based page offset, in multiples
of ten. Entries inside each page retain the one-based indices of the current
loaded list:

```text
sjs plugins list
sjs plugins list 10
sjs plugins list 20

sjs extensions list
sjs extensions list 10
```

The footer names the previous and next command when another page exists. Client
rows contain only their current list index and runtime name; filesystem paths
and administrative state details remain in the server-console view.
Unloading a preceding record changes later indices; query the list again before
using an index. A client page offset is not an administrative selector.

## Root Commands

`sjs`

Prints a compact help page, SourceJS status, loaded plugin count and loaded
extension count.

`sjs version`

Prints:

- SourceJS version.
- Platform and architecture.
- SDK branch.
- Runtime family.

`sjs modules`

Lists native V8 module contracts in registration order. CommonJS-only packages
are not part of this native registry.

## Authorization

`sjs auth` lists the authorization commands. Use them from the server console
or authorized RCON, not the ordinary client console. See
[Add an administrator](server-administration.md#add-an-administrator) for
examples, configuration paths, and the distinction between direct grants and
the all-permissions list in `simple.txt`.

When the engine identifies a command as coming from a player, SourceJS routes
it as a client command on both dedicated and listen servers. It does not fall
back to server-console handlers when there is no client handler. The SDK
callback and native command dispatch do not both run the same SourceJS command.

## Plugins

`sjs plugins`

Prints the same active-plugin view as `sjs plugins list`.

`sjs plugins list`

Lists loaded plugins. SourceJS loads enabled plugin directories from
`addons/sourcejs/plugins` during startup unless their manifest sets
`"Autoload": false`. Unloaded plugins are removed from the runtime list.
The packaged `hello` example has autoload disabled; the following row is
illustrative and requires explicitly loading or enabling that example:

```text
1. hello [loaded, enabled] <game>/addons/sourcejs/plugins/hello/index.js
```

`sjs plugins load <name>`

Loads `addons/sourcejs/plugins/<name>` from disk. `<name>` accepts:

- plugin directory name.

No discovery registry is consulted or retained.

`sjs plugins unload <name/index>`

Unloads a loaded plugin and calls its unload lifecycle. This does not disable
the plugin permanently. This command accepts the plugin directory name or the
numeric index from `sjs plugins list`.

`sjs plugins unload_all`

Unloads all loaded plugins in current list order.

`sjs plugins reload <name/index>`

Unloads and loads the selected plugin.

`sjs plugins reload_all`

Unloads all loaded plugins, scans `addons/sourcejs/plugins`, and loads every
enabled plugin directory whose manifest permits autoload.

`sjs plugins disable <name/index>`

Unloads the plugin if currently loaded, then marks it disabled and attempts to
save that state. An unload failure prevents the disabled-state update.
Disabled plugins are skipped by startup load and
`sjs plugins reload_all`; a failed state write may leave the disk unchanged.

`sjs plugins enable <name/index>`

Clears the disabled flag, attempts to save it, and attempts to load the plugin
immediately. A failed load does not restore the disabled flag.

## Extensions

`sjs extensions`

Prints the same active-extension view as `sjs extensions list`.

`sjs extensions list`

Lists loaded extensions. SourceJS loads enabled extension directories from
`addons/sourcejs/extensions` during startup unless their manifest sets
`"Autoload": false`. Legacy `binary` or `autoload` controls reject the manifest;
rename them to `Binary` and `Autoload`. Unloaded extensions are removed from the runtime list.
The repository's `echo` example sets `Autoload: false`. The following row
assumes a matching native binary has been built from the repository, installed,
and explicitly loaded:

```text
1. echo [loaded, enabled] <game>/addons/sourcejs/extensions/echo/bin/windows-x86/echo.dll
```

`sjs extensions load <name>`

Loads `addons/sourcejs/extensions/<name>` from disk. `<name>` accepts:

- extension directory name.

No discovery registry is consulted or retained.

`sjs extensions unload <name/index>`

Revokes the extension's bindings, runs its cleanup callback, destroys its V8
isolate, and closes the native library. Existing plugin references throw on
use. If a binding is active on the game thread, retry after it returns. If
cleanup fails, the bindings stay revoked and SourceJS retains the library
for another unload attempt.

`sjs extensions unload_all`

Attempts to unload every loaded extension in current list order, continuing
after individual failures. This command does not unload plugins first; normal
SourceJS shutdown does.

`sjs extensions reload <name/index>`

Unloads and loads the selected extension. Require its module again to get the
new bindings; no previously held function is reactivated.

`sjs extensions reload_all`

Unloads all loaded extensions, scans `addons/sourcejs/extensions`, and loads
every enabled extension directory whose manifest permits autoload. This command
does not alter loaded plugins; SourceJS shutdown unloads plugins before
extensions.

`sjs extensions disable <name/index>`

Unloads the extension if currently loaded, then marks it disabled and attempts
to save that state. An unload failure prevents the disabled-state update.
Disabled extensions are skipped by startup load and
`sjs extensions reload_all`; a failed state write may leave the disk unchanged.
See the extension-state reader limitation below before relying on persistence.

`sjs extensions enable <name/index>`

Clears the disabled flag, attempts to save it, and immediately attempts to load
the extension from disk. A failed load does not restore the disabled flag.

## Name And Index Resolution

Managers resolve `<name/index>` in this order:

1. numeric index from the current loaded list view, except for `load`;
2. exact loaded runtime name;
3. for `load` and name-based `enable` or `disable`, the directory name on disk.

Loaded runtime names are compared byte-for-byte on every platform. Use the exact
directory spelling even when the Windows filesystem would accept another case.

Numeric indices are one-based positions in the current loaded list, not stable
IDs. They can change after unload or reload and must not be stored in
configuration files. Names resolve to directory names, not a manifest's
descriptive `Name` field.

## Persistent State

Disable/enable state is stored under:

```text
addons/sourcejs/data/PluginsState.json
addons/sourcejs/data/ExtensionsState.json
```

Each file contains a `Disabled` array of plugin or extension directory names,
not list indices or descriptive manifest fields.

`PluginsState.json` is manager-generated state, not a general configuration
document. Its schema is exactly `{ "Disabled": ["PluginDirectoryName"] }`:
valid directory names are stored literally without JSON escapes. The plugin
manager rejects malformed state, extra fields, escaped names, and legacy
lowercase keys rather than treating arbitrary quoted text as disabled names.
Names such as `Disabled` and `disabled` remain valid array values. Use the
enable/disable commands to update the file; failed writes produce a warning.

`ExtensionsState.json` is manager-generated with the same `Disabled` array
schema. Both managers use a shared strict parser; extension names `Disabled`
and `disabled` remain valid array values and restore their disabled state.
Duplicate extension names load once. Use the commands rather than editing the
file by hand. Each load clears the old list first: missing, unreadable or invalid
state leaves an empty in-memory disabled list, and invalid schema emits a warning.
This is not a fail-closed security control. Failed extension-state writes emit
an error, not the plugin manager's warning.

## Errors

Server-console syntax errors never invoke the requested manager action.
Missing or surplus arguments and unknown actions show root help; an empty
selector shows action-specific usage. Root queries accept no operands. Bare
`sjs plugins` and `sjs extensions` remain aliases for their list queries.
These engine-console callbacks have no process exit status or standalone CLI
result marker; operation outcomes use the console diagnostics described below.

Representative diagnostics are shown below; ABI numbers are placeholders, not
results from a live-server test:

```text
[SourceJS] [WARNING] Plugin not found: admin
[SourceJS] [WARNING] ExtensionManager.Load rejected numeric Selector="1".
[SourceJS] [ERROR] ExtensionManager.Load ABI mismatch Extension="echo" ExpectedABI=... ActualABI=....
```

Messages are emitted through the Source console/spew path. While a JavaScript
client or say command callback is running, native `INFO`, `WARNING`, and `ERROR`
lines are also mirrored to the issuing client's console. SourceJS does not write
a separate command trace file under `logs/sourcejs`; V8 compile and runtime
failures are formatted and emitted with the `[ERROR]` severity marker.

Multi-step commands are not transactional. `enable` attempts to persist the
removed disabled flag before attempting to load from disk. `reload` unloads the current
record before attempting the replacement load, and `reload_all` may load only a
subset when one directory fails. Correct the disk, ABI or script error and retry
the command.
