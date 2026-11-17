# `require("settings/menu")`

> AI processing note: this page documents a JavaScript menu adapter over live settings registries. Keep menu
> construction, callback-based value loading, cached rendering, queued delivery and registry ownership as separate phases.

`settings/menu` builds a top-level `PagedMenu` whose rows are either registered `PlayerSettings` groups or standalone
`SettingsType` values. It owns each generated menu and row, but it does not own or unregister the settings placed in
those rows. Construction and row replacement are synchronous metadata operations. Loading standalone values requires
`Options` and `Callback`; rendering never starts storage I/O.

## Contents

- [Import](#import)
- [Exports](#exports)
- [SettingsMenu](#settingsmenu)
- [Create And Send An Explicit Menu](#create-and-send-an-explicit-menu)
- [Build With A Custom Selection](#build-with-a-custom-selection)
- [Send Registered Settings](#send-registered-settings)
- [Replace Rows](#replace-rows)
- [Row And Selection Behavior](#row-and-selection-behavior)
- [Errors And Lifecycle](#errors-and-lifecycle)
- [Related Modules](#related-modules)

## Import

```js
const {
	SettingsMenu,
	BuildSettingsMenu,
	SendSettingsMenu,
} = require("settings/menu");
```

## Exports

| Export | Result | Purpose |
| --- | --- | --- |
| [`SettingsMenu`](#settingsmenu) | Class | Specialized `PagedMenu` for one player value and a current settings-row array. |
| `BuildSettingsMenu(Player, Options?)` | `SettingsMenu` | Constructs one unsent menu. |
| `SendSettingsMenu(Player, Options, Callback)` | `undefined` | Constructs a menu, loads values, then calls `Callback(RequestError, bSent)`; errors use a `null` result. |

## SettingsMenu

### Constructor

`new SettingsMenu(Player, Options = {})`

The constructor stores `Player` unchanged and does not load values. `RefreshValues()` resolves that player's unique ID
before calling each standalone setting's `Get(strPlayerUniqueID, Options, Callback)`. Sending separately validates the
target through the inherited menu API: use a positive player index or a player object with `Index`. A unique ID string
is valid for value loading but is not itself a menu delivery target.

| Option | Default | Purpose |
| --- | --- | --- |
| `Title` | `"Settings"` | Inherited menu title. |
| `Description` | `""` | Inherited text above the rows. |
| `ItemsPerPage` | `7` | Positive integer row count per page. |
| `Settings` | Current registries | `SettingsDictionary` or `SettingsType` array; explicit `null` is invalid. |
| `SelectCallback` | Nested-menu callback | Function that replaces the default selection behavior. Explicit `null` is invalid. |

Only those presentation/callback values are forwarded into `PagedMenu`. Other inherited constructor options keep the
defaults established by `PagedMenu` and `BaseMenu`, including queued delivery and close-after-selection behavior.

### Own Members

| Member | Kind | Purpose |
| --- | --- | --- |
| `Player` | Getter | Current `ValuePlayer`, initialized to the exact constructor value without copying or normalization. |
| `RefreshOptions(vecSettingsEntries?)` | Method | Replaces rows with selectable `PagedMenuOption` instances, clears cached values, invalidates earlier loads and returns this menu. |
| `RefreshValues(Options, Callback)` | Method | Loads standalone values, publishes a complete snapshot, then calls `Callback(RequestError, SettingsMenuInstance)`; errors use `null`. Returns `undefined`. |
| `ValueSettingsValues` | Field | Current `Map` keyed by the exact setting instances, not by their names. A successful load replaces the map. |
| `ValuePlayerUniqueID` | Field | Identity associated with the published snapshot; `null` before loading or after row replacement. |
| `ValueRefreshToken` | Field | Opaque request-generation token used to reject superseded loads. |

Both request APIs require a non-array `Options` object and a function `Callback`. `Options.Blocking` may be omitted or
boolean; omitted means `false`. The mode is captured once, and each standalone entry receives its own normalized
`{ Blocking: bBlocking }` record. Other fields are ignored by `RefreshValues()`; `SendSettingsMenu()` also uses the
constructor's presentation and `Settings` fields.

`Blocking: true` retains the callback and waits through the delegated storage API. Default requests may complete later,
but cached or empty/group-only loads can complete inline. The menu adapter creates no worker or callback-thread switch;
execution and serialization belong to the setting/storage backend. See [`settings/storage`](settings-storage.md) for
its FIFO, pending-Blocking restrictions and lifecycle. These APIs are for the JavaScript runtime thread.

Treat the writable `Value*` fields as implementation state, not cache-editing APIs. Use `RefreshOptions()` and
`RefreshValues()` to keep rows, cached values, identity and request generation consistent.

The class inherits `Items`, `Length`, presentation fields, callbacks, paging, rendering, `SendMenu()`,
`SelectMenuOption()`, `RefreshMenu()` and `CloseMenu()` from [`PagedMenu`](menus-objects.md#pagedmenu).

## Create And Send An Explicit Menu

Pass a caller-owned array when a command should show only settings controlled by that plugin. The settings remain live
objects, while displayed values come from a loaded snapshot. This helper requires `Options` and `Callback`, returns
`undefined`, and passes the retained menu to the callback only after loading and queue acceptance:

```js
const { SettingsMenu } = require("settings/menu");

function ShowExplicitSettingsMenu(Player, vecSettings, Options, Callback) {
	if (!Array.isArray(vecSettings) || (vecSettings.length === 0)) {
		throw new TypeError("At least one explicit setting is required.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Callback must be a function.");
	}

	const SettingsMenuInstance = new SettingsMenu(Player, { Description: "Current values for this player", Settings: vecSettings, Title: "Combat Preferences" });
	SettingsMenuInstance.RefreshValues(Options, (RefreshError) => {
		if (RefreshError !== null) {
			Callback(RefreshError, null);
			return;
		}

		let SendError = null;
		try {
			if (SettingsMenuInstance.SendMenu(Player) !== true) {
				throw new Error("The explicit settings menu was not accepted by the player queue.");
			}
		} catch (MenuError) {
			SendError = (MenuError === null) ? new Error("SettingsMenu send threw null.", { cause: MenuError }) : MenuError;
		}

		Callback(SendError, (SendError === null) ? SettingsMenuInstance : null);
	});
}

module.exports = { ShowExplicitSettingsMenu };
```

Pass `{ Blocking: false }` for ordinary requests or `{ Blocking: true }` when startup must wait. Success uses
`Callback(null, SettingsMenuInstance)`; loading or sending errors use `Callback(RequestError, null)`. Caller callback
exceptions are not caught as menu failures or retried by this helper; an asynchronous backend/runtime callback boundary may handle them separately.

Queued `SendMenu()` returning `true` means queue acceptance, not confirmed game delivery. Rendering and delivery may
occur after the request callback. The queue reuses the loaded snapshot; it does not reload storage on refresh.

## Build With A Custom Selection

`BuildSettingsMenu()` is useful when the caller needs to retain or customize the unsent menu. A custom callback
receives the complete inherited `(unPlayerIndex, SettingsEntry, MenuItem, SettingsMenuInstance)` tuple:

```js
const { BuildSettingsMenu } = require("settings/menu");

function BuildAuditedSettingsMenu(Player, vecSettings, RecordSelection) {
	if (!Array.isArray(vecSettings)) {
		throw new TypeError("vecSettings must be an array.");
	}

	if (typeof RecordSelection !== "function") {
		throw new TypeError("RecordSelection must be a function.");
	}

	return BuildSettingsMenu(Player, {
		SelectCallback(unPlayerIndex, SettingsEntry, MenuItem, SettingsMenuInstance) {
			RecordSelection({ MenuItem, PlayerIndex: unPlayerIndex, SettingsEntry, SettingsMenu: SettingsMenuInstance });
		},
		Settings: vecSettings,
		Title: "Plugin Settings",
	});
}

module.exports = { BuildAuditedSettingsMenu };
```

Providing `SelectCallback` replaces the nested-menu default completely. The inherited `SelectMenuOption()` method still returns
`true` after invoking a valid row callback; it does not use the callback's return value.

This builder remains synchronous and unsent. Standalone rows initially display only their names. Call
`SettingsMenuInstance.RefreshValues(Options, Callback)` before sending when values should be shown; callback success
returns the same menu instance. Inherited `RefreshMenu()` only refreshes presentation, not stored values.

## Send Registered Settings

Omitting `Options.Settings` reads current group registry entries from `settings/player.GetPlayerSettings()` and standalone
entries from `settings/types.ListSettings()`, then fixes group-first row membership in the new menu. These are the registries visible to this module's imports, not cross-plugin discovery. This
controller keeps a registered group alive until plugin unload and invokes `SendSettingsMenu()` only from an explicit
command/event path:

```js
const { SendSettingsMenu } = require("settings/menu");
const { PlayerSettings } = require("settings/player");

function CreateInterfaceSettingsController() {
	let SettingsGroup = null;

	return {
		Load() {
			if (SettingsGroup !== null) {
				throw new Error("Interface settings are already loaded.");
			}

			SettingsGroup = new PlayerSettings("Interface", "interface", "Interface Settings");
			SettingsGroup.AddBooleanSetting("Show Damage", true);
			SettingsGroup.AddIntegerSetting("Message Duration", 5, { Maximum: 30, Minimum: 1 });

			return SettingsGroup;
		},
		Show(Player, Options, Callback) {
			if (SettingsGroup === null) {
				throw new Error("Interface settings are not loaded.");
			}

			if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
				throw new TypeError("Options must be an object.");
			}

			SendSettingsMenu(Player, { ...Options, Title: "Server Settings" }, Callback);
		},
		Unload() {
			if (SettingsGroup === null) {
				return false;
			}

			const bSettingsGroupUnregistered = SettingsGroup.Unregister();
			SettingsGroup = null;

			return bSettingsGroupUnregistered;
		},
	};
}

module.exports = { CreateInterfaceSettingsController };
```

The group remains registered while menus can be built from the global registry. Unregister it during the plugin's
unload path, not immediately after a successful queued send.

`Show(Player, Options, Callback)` returns `undefined` and forwards `Callback(RequestError, bSent)` from
`SendSettingsMenu()`. `bSent === false` is an unsuccessful inherited send result, not a successful delivery. A
group-only top-level menu performs no typed value reads; selecting it opens the group's own nested menu.

## Replace Rows

Use `RefreshOptions(vecSettings)` to replace an existing menu's row objects. Calling it without an argument reads both
live registries again:

```js
const { SettingsMenu } = require("settings/menu");

function ReplaceSettingsRows(SettingsMenuInstance, vecSettings) {
	if (!(SettingsMenuInstance instanceof SettingsMenu)) {
		throw new TypeError("SettingsMenuInstance must be a SettingsMenu.");
	}

	if (!Array.isArray(vecSettings)) {
		throw new TypeError("vecSettings must be an array.");
	}

	const RefreshedSettingsMenu = SettingsMenuInstance.RefreshOptions(vecSettings);
	if (RefreshedSettingsMenu !== SettingsMenuInstance) {
		throw new Error("SettingsMenu.RefreshOptions() changed object identity.");
	}

	return { Menu: SettingsMenuInstance, RowCount: SettingsMenuInstance.Length };
}

module.exports = { ReplaceSettingsRows };
```

The method validates the array and every row before replacing the existing menu items. A failed validation leaves the
current rows and snapshot unchanged, apart from any caller getter side effects. This is not a rollback guarantee for overridden menu methods or later item-append failures. A successful replacement clears the snapshot and invalidates pending loads.
Call `RefreshValues(Options, Callback)` again to load the replacement values. Row replacement does not send the menu.

## Row And Selection Behavior

- A `SettingsDictionary` instance is a group row. Rendering reads its live `Text` field, or its live `Name` when
  `Text` is exactly `null`.
- A `SettingsType` instance is a standalone row. Rendering reads its live `Name`, then uses the cached value for that
  exact instance. Before a successful load it shows only the name; afterward it shows `"Name: Value"`. It never calls
  `Get()` while rendering, including queued presentation refreshes.
- A value load captures each current `Get` method once and preserves its setting receiver. All entries use the same
  resolved player identity. A snapshot is published only after every standalone read succeeds; a failed load preserves
  the previous snapshot without exposing partial results.
- A `RefreshValues()` request that reaches value-load setup, or a successful `RefreshOptions()`, invalidates an earlier pending load.
  Such a load completes with an error and `null`, rather than overwriting newer values. The adapter does not cancel
  already submitted backend work; late completions after a failed request and repeated entry completions are ignored.
- A player identity mismatch at publication rejects the snapshot. If rendering resolves a different valid player identity after loading, it
  hides the previous player's cached values and shows names only; an invalid or throwing identity lookup raises a rendering error instead. Changes to setting definitions themselves are not
  automatically tracked: do not mutate definitions during a load, and explicitly reload after changing storage/keys.
- Registry defaults are composed in group-first order: all current `PlayerSettings` groups, followed by all current
  standalone registered types.
- Constructing or refreshing a menu fixes the current registry membership in `Items`; later registrations appear only
  in a new menu or after argument-free `RefreshOptions()`.
- The default callback leaves standalone rows unchanged. For a group row it invokes the live nested
  `Menu.SendMenu(unPlayerIndex)` method with its original receiver and requires an exact `true` result.

## Errors And Lifecycle

- Constructor `Options` must be a non-array object. Only own presentation/row option fields are read. `SelectCallback` must be a
  function, and `ItemsPerPage` must be a positive integer.
- Omitting `Settings`, passing `undefined`, or calling `RefreshOptions()` without an argument selects current
  registries. Explicit `null` is invalid.
- Every row must be a `SettingsDictionary` or `SettingsType` instance. Malformed names/text fail during rendering;
  malformed `Get()` fails during value-load validation; malformed nested menus/results fail during selection.
- Invalid request options/callbacks, item records, `Get` methods or the initial player identity throw before scheduling
  reads. Once loading starts, read/scheduling errors raised before invoking an entry callback and final stale/identity validation errors complete the callback
  once with `null` as its result. When reporting such a failure through the callback, a caught operation throwing `null` is represented by an `Error` with `cause: null`, because `null` in the callback's error slot means success. Other thrown values are preserved. The JavaScript adapter does not catch or retry user callback exceptions; their ultimate handling belongs to the backend/runtime callback boundary.
- If a custom `Get()` throws after invoking its entry callback inline, the adapter rethrows the exact value, including `null` or `undefined`, rather than risk catching a caller-callback exception. It does not retry a menu callback or roll back a published snapshot. If the batch was not complete, the menu-level callback may never run and later reads are not started. Custom `Get()` implementations must not throw after completion.
- Row/method preflight runs before the request token changes, but initial player-identity validation follows token installation. An identity failure can therefore supersede an older pending load even before submitting new reads; the previous value snapshot remains unchanged. Empty or group-only loads skip player-identity lookup and can complete inline.
- A nested menu returning `false` raises an error because the selected group was not accepted for delivery. Any
  non-boolean nested result violates the menu contract and raises `TypeError`.
- `BuildSettingsMenu()` creates no global menu registration. `SendSettingsMenu()` creates a new menu on every call,
  returns `undefined`, and reports the send result through the callback; loading failure prevents sending. Retain a
  `SettingsMenu` directly when later value loads, presentation refreshes or closing control are needed.
- Closing a menu does not cancel a pending value load. Coordinate plugin unload with outstanding callbacks and owned
  storage lifetime, and never close shared storage while another menu/settings owner still needs it.
- Plugin-owned `PlayerSettings` and standalone registry entries must be unregistered by their owning plugin. Menu
  destruction does not alter either registry.

## Related Modules

- [`settings/player`](settings-player.md) defines `PlayerSettings`, its nested menu and registry lifecycle.
- [`settings/types`](settings-types.md) defines standalone typed setting values and their registry.
- [`settings/storage`](settings-storage.md) defines callback requests, cached reads and backend lifecycle.
- [`menus`](menus-objects.md) documents all inherited paging, queueing, rendering and callback members.
- [`menus/queue`](menus-queue.md) documents accepted versus active queued menus.
