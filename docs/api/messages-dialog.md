# `require("messages/dialog")`

> Warning: this reference is large for AI-agent processing. Use the contents list. Source dialogs are `IServerPluginHelpers::CreateMessage()` KeyValues payloads, not browser windows or main-menu UI. Keep selected-SDK dialog capabilities, per-player language selection, client-command ownership, and nested menu records synchronized with the native `messages.CreateDialog()` contract.

`messages/dialog` creates in-game notification, text, entry, menu, and optional connection dialogs. Every `SendMessage()` call resolves each human recipient's language independently, renders template tokens, consumes the next module-local priority level for that player, and calls [`messages.CreateDialog()`](messages.md#createdialog).

The module lives at `packages/sourcejs/messages/dialog.js`. Loading it requires native `messages.GetDialogTypes()`. Missing `messages.GetBaseMessageConstants()` does not disable the independent dialog classes; if that getter exists and throws, its failure propagates while loading the message dependencies. Sending requires a running server and connected recipients; fake clients are skipped. For queued radio and ESC menus with direct selection callbacks, use [`menus`](menus.md).

## Contents

- [Import](#import)
- [Exports](#exports)
- [Runtime model](#runtime-model)
- [`DialogBase`](#dialogbase)
- [Notification and text](#notification-and-text)
- [Interactive dialogs](#interactive-dialogs)
- [Per-player translation](#per-player-translation)
- [`DialogAskConnect`](#dialogaskconnect)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	DialogAskConnect,
	DialogBase,
	DialogEntry,
	DialogMenu,
	DialogNotification,
	DialogText,
	DIALOG_TYPE,
	SendDialogMessage,
} = require("messages/dialog");

const g_vecMandatoryDialogClasses = [DialogBase, DialogEntry, DialogMenu, DialogNotification, DialogText];
const g_bCanSendDialogMessage = typeof SendDialogMessage === "function";
const g_bHasDialogTypeConstants = (DIALOG_TYPE !== null) && (typeof DIALOG_TYPE === "object");
const g_bAskConnectAvailable = g_bHasDialogTypeConstants && Object.hasOwn(DIALOG_TYPE, "ASK_CONNECT");

for (const DialogClass of g_vecMandatoryDialogClasses) {
	if (typeof DialogClass !== "function") {
		throw new Error("The messages/dialog module did not expose every mandatory dialog class.");
	}
}

if (!g_bCanSendDialogMessage) {
	throw new Error("The messages/dialog module did not expose SendDialogMessage().");
}

if (!g_bHasDialogTypeConstants) {
	throw new Error("The messages/dialog module did not expose DIALOG_TYPE.");
}

if ((typeof DialogAskConnect === "function") !== g_bAskConnectAvailable) {
	throw new Error("DialogAskConnect did not match the selected SDK capability.");
}
```

## Exports

| Export | Kind | Availability | Signature |
| --- | --- | --- | --- |
| [`DialogAskConnect`](#dialogaskconnect) | Class | SDK declares `DIALOG_ASKCONNECT` | `new DialogAskConnect(DialogTitle, unDisplayTime = 10)` |
| [`DialogBase`](#dialogbase) | Abstract class | Always | `new DialogBase(strDialogName, DialogFields)` |
| [`DialogEntry`](#dialogentry) | Class | Always | `new DialogEntry(DialogTitle, DialogMessage, strDialogCommand, DialogOptions = {})` |
| [`DialogMenu`](#dialogmenu) | Class | Always | `new DialogMenu(DialogTitle, DialogMessage, strDialogCommand, DialogOptions)` |
| [`DialogNotification`](#dialognotification) | Class | Always | `new DialogNotification(DialogTitle, DialogOptions = {})` |
| `DialogText` | Class | Always | `new DialogText(DialogTitle, DialogMessage, DialogOptions = {})` |
| `DIALOG_TYPE` | Constant object | Always | Selected-SDK dialog type values. |
| `SendDialogMessage` | Function | Always | `SendDialogMessage(TargetReferences, DialogTitle, DialogMessage, DialogOptions = {})` |

`DialogAskConnect` is omitted when the selected SDK lacks that enum value. Destructuring the missing property produces `undefined`; no replacement class is installed.

## Runtime model

- `DIALOG_TYPE` always has `MESSAGE`, `MENU`, `TEXT`, and `ENTRY`; `ASK_CONNECT` is capability-conditioned.
- `DialogTitle`, `DialogMessage`, and menu-option text accept a string or an object with `GetString(strLanguageCode, TranslationTokens)`.
- String fields replace `{Token}` placeholders using string, number, or boolean token values.
- `SendMessage()` skips fake clients and returns `false` when no human send was attempted or any native send returned `false`. A `false` result does not stop later recipients; an exception does. Earlier sends are not rolled back.
- Levels run from `1` through `1024` per player index and then wrap to `1`. Every successful `BuildDialogValues()` call consumes one level, including previews; a later failed send does not restore it. The SDK gives lower levels higher priority, so an increasing level does not guarantee that newer UI replaces older UI.
- Colors are user-schema `{ Red, Green, Blue, Alpha }` objects with integer components from `0` through `255`.
- The package accepts `Time` as a non-negative safe integer in seconds. The SDK documents a client display range of `10` through `200` seconds; use supported values rather than assuming every package-accepted value is displayed unchanged.

Native `messages.CreateDialog()` synchronously calls the SDK's void `CreateMessage()` function and returns `true` after that call. This is not a client-display acknowledgement. Names of non-nullish native fields reject empty strings, NUL, and `/` before SDK field dispatch; represent nested fields with objects. Dialog names and string values still use UTF-8 C-string transport: embedded NUL truncates them, so exclude it from dialog titles, bodies, commands, and option keys.

```js
const { DialogAskConnect, DIALOG_TYPE } = require("messages/dialog");

const g_vecMandatoryDialogTypeNames = ["ENTRY", "MENU", "MESSAGE", "TEXT"];
const g_setMandatoryDialogTypeValues = new Set();
const g_bAskConnectAvailable = Object.hasOwn(DIALOG_TYPE, "ASK_CONNECT");

for (const strDialogTypeName of g_vecMandatoryDialogTypeNames) {
	const unDialogTypeValue = DIALOG_TYPE[strDialogTypeName];
	if (!Number.isSafeInteger(unDialogTypeValue)) {
		throw new Error(`DIALOG_TYPE.${strDialogTypeName} was not a safe integer.`);
	}

	if (g_setMandatoryDialogTypeValues.has(unDialogTypeValue)) {
		throw new Error(`DIALOG_TYPE.${strDialogTypeName} reused a selected-SDK value.`);
	}

	g_setMandatoryDialogTypeValues.add(unDialogTypeValue);
}

if (g_bAskConnectAvailable !== (typeof DialogAskConnect === "function")) {
	throw new Error("DialogAskConnect availability did not match DIALOG_TYPE.ASK_CONNECT.");
}
```

## `DialogBase`

`DialogBase` extends [`CustomUserMessageCreator`](messages-types.md#customusermessagecreator). It adds the following contract:

| Member | Description |
| --- | --- |
| `GetDialogType()` | Returns a selected-SDK `DIALOG_TYPE` value; an override is required. |
| `GetKeyValuesName()` | Returns the abstract root KeyValues name. |
| `BuildDialogValues(unPlayerIndex, DialogFields)` | Builds at least `Level`, `Time`, and rendered `Title`; consumes the next per-player level without sending. |
| `BuildMessagePayload(TargetReferences, TranslationTokens = {}, strLanguageCode = null)` | Returns `DialogType`, translated `Fields`, normalized `RecipientIndexes`, `LanguageCode`, and `TranslationTokens`. |
| `TranslateMessageFields(strLanguageCode = null, TranslationTokens = {})` | Uses the inherited `TranslateUserMessageFields()` method to translate the dialog fields. |
| `SendMessage(TargetReferences, TranslationTokens = {})` | Renders and sends one native dialog per human recipient. |

A custom dialog implements both abstract methods and extends `BuildDialogValues()`. Fields reach this method after translation and token substitution.

```js
const { DialogBase, DIALOG_TYPE } = require("messages/dialog");

const g_unObjectiveDisplayTime = 12;
const g_unTargetPlayerIndex = 1;

class ObjectiveDialog extends DialogBase {
	static TRANSLATABLE_FIELDS = Object.freeze(["Message", "Title"]);

	constructor(strDialogTitle, strDialogMessage) {
		super("ObjectiveDialog", { Message: strDialogMessage, Time: g_unObjectiveDisplayTime, Title: strDialogTitle });
	}

	GetDialogType() {
		return DIALOG_TYPE.TEXT;
	}

	GetKeyValuesName() {
		return "objective";
	}

	BuildDialogValues(unPlayerIndex, DialogFields) {
		return {
			...super.BuildDialogValues(unPlayerIndex, DialogFields),
			Color: { Red: 80, Green: 220, Blue: 80, Alpha: 255 },
			Msg: DialogFields.Message,
		};
	}
}

const g_TranslationTokens = { Number: 2, Place: "the extraction point" };
const g_ObjectiveDialogInstance = new ObjectiveDialog("Objective {Number}", "Reach {Place}");
const g_ObjectivePayload = g_ObjectiveDialogInstance.BuildMessagePayload(g_unTargetPlayerIndex, g_TranslationTokens, "en");
const g_ObjectiveValues = g_ObjectiveDialogInstance.BuildDialogValues(g_unTargetPlayerIndex, g_ObjectivePayload.Fields);
const g_bHasExpectedDialogType = g_ObjectivePayload.DialogType === DIALOG_TYPE.TEXT;
const g_bHasExpectedDialogTitle = g_ObjectivePayload.Fields.Title === "Objective 2";
const g_bHasExpectedDialogMessage = g_ObjectivePayload.Fields.Message === "Reach the extraction point";
const g_bHasValidDialogLevel = Number.isSafeInteger(g_ObjectiveValues.Level);
const g_bHasExpectedDisplayTime = g_ObjectiveValues.Time === g_unObjectiveDisplayTime;
const g_bHasExpectedDialogValueTitle = g_ObjectiveValues.Title === "Objective 2";
const g_bHasExpectedDialogValueMessage = g_ObjectiveValues.Msg === "Reach the extraction point";
if (!g_bHasExpectedDialogType || !g_bHasExpectedDialogTitle || !g_bHasExpectedDialogMessage) {
	throw new Error("The custom dialog payload was not translated correctly.");
}

if (!g_bHasValidDialogLevel || !g_bHasExpectedDisplayTime || !g_bHasExpectedDialogValueTitle || !g_bHasExpectedDialogValueMessage) {
	throw new Error("The custom dialog did not build the expected KeyValues fields.");
}

if (!g_ObjectiveDialogInstance.SendMessage(g_unTargetPlayerIndex, g_TranslationTokens)) {
	throw new Error("ObjectiveDialog.SendMessage() did not deliver the custom dialog.");
}
```

`DialogBase` is intended only for subclassing; calling either abstract capability method on a direct instance throws `TypeError`.

## Notification and text

### `DialogNotification`

`DialogNotification` sends `DIALOG_TYPE.MESSAGE` with KeyValues name `msg`. It displays colored top text without an ESC body.

```js
const { DialogNotification, DIALOG_TYPE } = require("messages/dialog");

const g_unMaximumColorComponent = 255;
const g_unNotificationDisplayTime = 12;
const g_vecNotificationRecipientIndexes = [1, 2];
const g_NotificationColor = { Red: g_unMaximumColorComponent, Green: 80, Blue: 40, Alpha: g_unMaximumColorComponent };
const g_NotificationDialog = new DialogNotification("Threat detected near {Location}", { Color: g_NotificationColor, Time: g_unNotificationDisplayTime });
const g_TranslatedNotificationFields = g_NotificationDialog.TranslateMessageFields("en", { Location: "the warehouse" });
const g_NotificationValues = g_NotificationDialog.BuildDialogValues(g_vecNotificationRecipientIndexes[0], g_TranslatedNotificationFields);
const g_bHasNotificationDialogType = g_NotificationDialog.GetDialogType() === DIALOG_TYPE.MESSAGE;
const g_bHasNotificationKeyValuesName = g_NotificationDialog.GetKeyValuesName() === "msg";
const g_bHasExpectedNotificationTitle = g_NotificationValues.Title === "Threat detected near the warehouse";
const g_bHasExpectedNotificationTime = g_NotificationValues.Time === g_unNotificationDisplayTime;
const g_bHasExpectedNotificationRed = g_NotificationValues.Color.Red === g_unMaximumColorComponent;
if (!g_bHasNotificationDialogType || !g_bHasNotificationKeyValuesName) {
	throw new Error("DialogNotification selected the wrong native dialog contract.");
}

if (!g_bHasExpectedNotificationTitle || !g_bHasExpectedNotificationTime || !g_bHasExpectedNotificationRed) {
	throw new Error("DialogNotification built unexpected KeyValues fields.");
}

if (!g_NotificationDialog.SendMessage(g_vecNotificationRecipientIndexes, { Location: "the warehouse" })) {
	throw new Error("DialogNotification.SendMessage() did not deliver the notification.");
}
```

### `DialogText` and `SendDialogMessage()`

`DialogText` sends `DIALOG_TYPE.TEXT` with KeyValues name `text`, colored top text, and an ESC message body. The user-schema property `DialogOptions.Fields` adds reusable template fields to the creator. `SendDialogMessage()` constructs this class and sends it immediately.

```js
const { DialogText, DIALOG_TYPE, SendDialogMessage } = require("messages/dialog");

const g_ServerRulesDialog = new DialogText("Server rules", "Welcome {Player}. Rule set: {RuleSet}", {
	Color: { Red: 80, Green: 220, Blue: 255, Alpha: 255 },
	Fields: { RuleSet: "competitive" },
	Time: 15,
});
const g_TranslatedServerRulesFields = g_ServerRulesDialog.TranslateMessageFields("en", { Player: "Ren" });
const g_ServerRulesValues = g_ServerRulesDialog.BuildDialogValues(1, g_TranslatedServerRulesFields);
const g_bHasTextDialogType = g_ServerRulesDialog.GetDialogType() === DIALOG_TYPE.TEXT;
const g_bHasTextKeyValuesName = g_ServerRulesDialog.GetKeyValuesName() === "text";
const g_bHasExpectedServerRulesMessage = g_ServerRulesValues.Msg === "Welcome Ren. Rule set: competitive";
if (!g_bHasTextDialogType || !g_bHasTextKeyValuesName || !g_bHasExpectedServerRulesMessage) {
	throw new Error("DialogText built an unexpected native payload.");
}

if (!g_ServerRulesDialog.SendMessage(1, { Player: "Ren" })) {
	throw new Error("DialogText.SendMessage() did not deliver the text dialog.");
}

if (!SendDialogMessage(2, "Round state", "Wave {Wave} is active", { Fields: { Wave: 4 }, Time: 10 })) {
	throw new Error("SendDialogMessage() did not deliver the immediate text dialog.");
}
```

## Interactive dialogs

Each interactive example is a separate plugin fragment with its own client command and case-sensitive SourceJS-owned `exports.Unload`; no lowercase alias is installed. Keep the registered callback while the plugin is active; the examples remove it and clear their state if startup fails. Cleanup is idempotent after success. If cleanup itself fails, `AggregateError` retains both failures and the unload hook remains available for retry. Unregistering a command does not dismiss UI already sent to a client.

### `DialogEntry`

`DialogEntry` sends `DIALOG_TYPE.ENTRY` with KeyValues name `entry`. When the player submits text, the client executes `strDialogCommand` followed by the entered value. Register that client command with `RegisterCommand()` and remove it when the plugin unloads.

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { DialogEntry, DIALOG_TYPE } = require("messages/dialog");

const g_mapLoadoutNames = new Map();
const g_unMaximumLoadoutNameLength = 32;
let g_bLoadoutNameCommandRegistered = false;

function RenameLoadoutCallback(ClientCommand) {
	const ParsedCommand = new Command(ClientCommand);
	const strLoadoutName = ParsedCommand.Arguments.slice(1).join(" ").trim();
	const bHasValidClientIndex = Number.isSafeInteger(ParsedCommand.Index) && (ParsedCommand.Index > 0);
	const bHasValidLoadoutName = (strLoadoutName.length > 0) && (strLoadoutName.length <= g_unMaximumLoadoutNameLength);
	if (!bHasValidClientIndex || !bHasValidLoadoutName) {
		return HANDLED;
	}

	g_mapLoadoutNames.set(ParsedCommand.Index, strLoadoutName);

	return HANDLED;
}

function UnloadPlugin() {
	g_mapLoadoutNames.clear();

	if (!g_bLoadoutNameCommandRegistered) {
		return true;
	}

	if (!UnregisterCommand("sjs_loadout_name", RenameLoadoutCallback)) {
		throw new Error("UnregisterCommand() could not remove the loadout-name command.");
	}

	g_bLoadoutNameCommandRegistered = false;

	return true;
}

exports.Unload = UnloadPlugin;

if (RegisterCommand("sjs_loadout_name", RenameLoadoutCallback) !== true) {
	throw new Error("RegisterCommand() failed to register the loadout-name callback.");
}

g_bLoadoutNameCommandRegistered = true;

try {
	const LoadoutEntryDialog = new DialogEntry("Loadout", "Enter a loadout name", "sjs_loadout_name", {
		Color: { Red: 80, Green: 220, Blue: 80, Alpha: 255 },
		Time: 20,
	});
	const TranslatedLoadoutEntryFields = LoadoutEntryDialog.TranslateMessageFields("en");
	const LoadoutEntryValues = LoadoutEntryDialog.BuildDialogValues(1, TranslatedLoadoutEntryFields);
	const bHasEntryDialogType = LoadoutEntryDialog.GetDialogType() === DIALOG_TYPE.ENTRY;
	const bHasEntryKeyValuesName = LoadoutEntryDialog.GetKeyValuesName() === "entry";
	const bHasExpectedLoadoutCommand = LoadoutEntryValues.Command === "sjs_loadout_name";
	if (!bHasEntryDialogType || !bHasEntryKeyValuesName || !bHasExpectedLoadoutCommand) {
		throw new Error("DialogEntry built an unexpected client-command payload.");
	}

	if (!LoadoutEntryDialog.SendMessage(1)) {
		throw new Error("DialogEntry.SendMessage() did not deliver the entry dialog.");
	}
} catch (CaughtError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "loadout-name startup and command cleanup failed.");
	}

	throw CaughtError;
}
```

The entered text is client-controlled input. Validate it before using it in files, SQL, Redis, or server commands.

### `DialogMenu`

`DialogMenu` sends `DIALOG_TYPE.MENU` with KeyValues name `menu`. Selecting an option executes `<strDialogCommand> <strOptionValue>`. The user-schema property `DialogOptions.Options` may be:

- a plain object mapping stable command values to display text;
- an array of strings, where each string is both value and text;
- an array of user-schema `{ Value, Text }` objects.

Values must be non-empty and unique. Display text may be translated; values remain stable command arguments. `TranslateMessageFields(strLanguageCode, TranslationTokens)` translates every option text, while `BuildDialogValues(unPlayerIndex, DialogFields)` creates one own-property nested KeyValues record per stable option value.

These dynamic option keys retain the supplied command-value spelling; they are not fixed API member names. Reserved root names `Level`, `Time`, `Title`, `Color`, and `Msg` are compared without ASCII letter case, so values such as `title` and `MSG` are also rejected with `TypeError`. Option values differing only in ASCII case are duplicates. Non-ASCII characters are not case-folded, and accepted command values are never rewritten. Values containing NUL or `/` are rejected: KeyValues treats `/` as a nested-path separator rather than part of one option name. These checks prevent root-field collisions, native key aliases, C-string truncation, and path interpretation. Avoid whitespace and command separators in stable values; treat client commands as untrusted input, not proof that the client selected a displayed option.

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { DialogMenu, DIALOG_TYPE } = require("messages/dialog");

const g_strRifleLoadout = "rifle";
const g_strShotgunLoadout = "shotgun";
const g_strSniperLoadout = "sniper";
const g_setAllowedLoadouts = new Set([g_strRifleLoadout, g_strShotgunLoadout, g_strSniperLoadout]);
const g_mapSelectedLoadouts = new Map();
let g_bLoadoutSelectionCommandRegistered = false;

function ChooseLoadoutCallback(ClientCommand) {
	const ParsedCommand = new Command(ClientCommand);
	const strLoadoutName = ParsedCommand.GetArgument(1);
	const bHasValidClientIndex = Number.isSafeInteger(ParsedCommand.Index) && (ParsedCommand.Index > 0);
	const bIsAllowedLoadout = g_setAllowedLoadouts.has(strLoadoutName);
	if (bHasValidClientIndex && bIsAllowedLoadout) {
		g_mapSelectedLoadouts.set(ParsedCommand.Index, strLoadoutName);
	}

	return HANDLED;
}

function UnloadPlugin() {
	g_mapSelectedLoadouts.clear();

	if (!g_bLoadoutSelectionCommandRegistered) {
		return true;
	}

	if (!UnregisterCommand("sjs_choose_loadout", ChooseLoadoutCallback)) {
		throw new Error("UnregisterCommand() could not remove the loadout-selection command.");
	}

	g_bLoadoutSelectionCommandRegistered = false;

	return true;
}

exports.Unload = UnloadPlugin;

if (RegisterCommand("sjs_choose_loadout", ChooseLoadoutCallback) !== true) {
	throw new Error("RegisterCommand() failed to register the loadout-selection callback.");
}

g_bLoadoutSelectionCommandRegistered = true;

try {
	const LoadoutDialogMenu = new DialogMenu("Choose loadout", "Select equipment for wave {Wave}", "sjs_choose_loadout", {
		Color: { Red: 80, Green: 220, Blue: 80, Alpha: 255 },
		Options: {
			[g_strRifleLoadout]: "Rifle",
			[g_strShotgunLoadout]: "Shotgun",
			[g_strSniperLoadout]: "Sniper rifle",
		},
		Time: 20,
	});
	const TranslatedLoadoutDialogFields = LoadoutDialogMenu.TranslateMessageFields("en", { Wave: 5 });
	const LoadoutDialogValues = LoadoutDialogMenu.BuildDialogValues(1, TranslatedLoadoutDialogFields);
	const bHasMenuDialogType = LoadoutDialogMenu.GetDialogType() === DIALOG_TYPE.MENU;
	const bHasMenuKeyValuesName = LoadoutDialogMenu.GetKeyValuesName() === "menu";
	const bHasExpectedMenuMessage = LoadoutDialogValues.Msg === "Select equipment for wave 5";
	const bHasExpectedRifleCommand = LoadoutDialogValues[g_strRifleLoadout].Command === `sjs_choose_loadout ${g_strRifleLoadout}`;
	const bHasExpectedRifleMessage = LoadoutDialogValues[g_strRifleLoadout].Msg === "Rifle";
	if (!bHasMenuDialogType || !bHasMenuKeyValuesName || !bHasExpectedMenuMessage) {
		throw new Error("DialogMenu built an unexpected root payload.");
	}

	if (!bHasExpectedRifleCommand || !bHasExpectedRifleMessage) {
		throw new Error("DialogMenu built an unexpected option payload.");
	}

	if (!LoadoutDialogMenu.SendMessage(1, { Wave: 5 })) {
		throw new Error("DialogMenu.SendMessage() did not deliver the menu dialog.");
	}
} catch (CaughtError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "loadout-selection startup and command cleanup failed.");
	}

	throw CaughtError;
}
```

Unlike [`menus/esc`](menus-esc.md), `DialogMenu` does not own a queue or selection callback. The registered client command owns interaction and validation.

## Per-player translation

A translation object's `GetString()` method is called for each translated field or menu option of each human recipient, with that player's language and the supplied tokens. Reusing one translation object in several fields or options therefore calls it more than once per recipient.

```js
const { Command, HANDLED } = require("commands");
const { RegisterCommand, UnregisterCommand } = require("commands/client");
const { DialogMenu } = require("messages/dialog");

function CreateDialogTranslation(strEnglishText, strRussianText) {
	return {
		GetString(strLanguageCode, TranslationTokens) {
			const strSelectedTemplate = (strLanguageCode === "ru") ? strRussianText : strEnglishText;

			return strSelectedTemplate.replace("{Wave}", String(TranslationTokens.Wave));
		},
	};
}

const g_WaveTitleTranslation = CreateDialogTranslation("Wave {Wave}", "Volna {Wave}");
const g_WeaponMessageTranslation = CreateDialogTranslation("Choose a weapon", "Vyberite oruzhie");
const g_RifleOptionTranslation = CreateDialogTranslation("Rifle", "Vintovka");
const g_ShotgunOptionTranslation = CreateDialogTranslation("Shotgun", "Drobovik");
const g_strRifleLoadout = "rifle";
const g_strShotgunLoadout = "shotgun";
const g_unLocalizedDialogDisplayTime = 15;
const g_setAllowedWeapons = new Set([g_strRifleLoadout, g_strShotgunLoadout]);
const g_mapSelectedWeapons = new Map();
let g_bWeaponCommandRegistered = false;

function ChooseWeaponCallback(ClientCommand) {
	const ParsedCommand = new Command(ClientCommand);
	const strWeaponName = ParsedCommand.GetArgument(1);
	const bHasValidClientIndex = Number.isSafeInteger(ParsedCommand.Index) && (ParsedCommand.Index > 0);
	const bIsAllowedWeapon = g_setAllowedWeapons.has(strWeaponName);
	if (bHasValidClientIndex && bIsAllowedWeapon) {
		g_mapSelectedWeapons.set(ParsedCommand.Index, strWeaponName);
	}

	return HANDLED;
}

function UnloadPlugin() {
	g_mapSelectedWeapons.clear();

	if (!g_bWeaponCommandRegistered) {
		return true;
	}

	if (!UnregisterCommand("sjs_choose_weapon", ChooseWeaponCallback)) {
		throw new Error("UnregisterCommand() could not remove the weapon-selection command.");
	}

	g_bWeaponCommandRegistered = false;

	return true;
}

exports.Unload = UnloadPlugin;

if (RegisterCommand("sjs_choose_weapon", ChooseWeaponCallback) !== true) {
	throw new Error("RegisterCommand() failed to register the weapon-selection callback.");
}

g_bWeaponCommandRegistered = true;

try {
	const LocalizedWeaponDialog = new DialogMenu(g_WaveTitleTranslation, g_WeaponMessageTranslation, "sjs_choose_weapon", {
		Options: {
			[g_strRifleLoadout]: g_RifleOptionTranslation,
			[g_strShotgunLoadout]: g_ShotgunOptionTranslation,
		},
		Time: g_unLocalizedDialogDisplayTime,
	});
	if (!LocalizedWeaponDialog.SendMessage([1, 2, 3], { Wave: 6 })) {
		throw new Error("DialogMenu.SendMessage() did not deliver the localized dialog to any human recipient.");
	}
} catch (CaughtError) {
	try {
		UnloadPlugin();
	} catch (CleanupError) {
		throw new AggregateError([CaughtError, CleanupError], "weapon-selection startup and command cleanup failed.");
	}

	throw CaughtError;
}
```

Each human receives a separate KeyValues tree translated before native delivery. A fake client in the target set is skipped.

## `DialogAskConnect`

When available, `DialogAskConnect` requests that the player accept a connection to the server address in `DialogTitle`, conventionally through `askconnect_accept`.

```js
const { DialogAskConnect, DIALOG_TYPE } = require("messages/dialog");

const g_bAskConnectAvailable = Object.hasOwn(DIALOG_TYPE, "ASK_CONNECT");
if (g_bAskConnectAvailable) {
	const AskConnectDialog = new DialogAskConnect("203.0.113.10:27015", 10);
	const bHasAskConnectDialogType = AskConnectDialog.GetDialogType() === DIALOG_TYPE.ASK_CONNECT;
	const bHasAskConnectKeyValuesName = AskConnectDialog.GetKeyValuesName() === "askconnect";
	if (!bHasAskConnectDialogType || !bHasAskConnectKeyValuesName) {
		throw new Error("DialogAskConnect selected an unexpected native contract.");
	}

	if (!AskConnectDialog.SendMessage(1)) {
		throw new Error("DialogAskConnect.SendMessage() did not deliver the connection request.");
	}

} else if (DialogAskConnect !== undefined) {
	throw new Error("DialogAskConnect was exported without selected-SDK support.");
}
```

Only use this flow for an intentional, visible server transfer. The client decides whether and how the request is presented.

## Errors

- Constructors reject missing required strings, invalid translatable objects, malformed colors, negative time values, and unsupported option shapes.
- `DialogMenu` rejects empty, duplicate, NUL-containing, `/`-containing, or reserved root-field values before native delivery. Uniqueness and reserved-name checks ignore ASCII letter case without rewriting accepted values. Validation also applies when translating or building fields modified after construction.
- `DialogBase.GetDialogType()` and `DialogBase.GetKeyValuesName()` throw `TypeError` until a subclass implements them.
- `SendMessage()` returns `false` when no human recipient remains or a native dialog call returns `false`; exceptions and non-boolean native results propagate as errors. Already completed sends and consumed levels are not rolled back.
- Translation callbacks must return strings; callback exceptions propagate to the plugin.

```js
const { DialogMenu } = require("messages/dialog");

const g_vecInvalidDialogOptionValues = ["Level", "Time", "Title", "Color", "Msg", "rifle\x00suffix"];
for (const strDialogOptionValue of g_vecInvalidDialogOptionValues) {
	let ReceivedError = null;

	try {
		new DialogMenu("Options", "Choose an option", "sjs_dialog_option", {
			Options: [{ Text: "Invalid option", Value: strDialogOptionValue }],
		});
	} catch (CaughtError) {
		ReceivedError = CaughtError;
	}

	if ((ReceivedError === null) || (ReceivedError.constructor !== TypeError)) {
		throw new Error("DialogMenu did not reject an invalid stable option value.");
	}
}
```

## Lifecycle

Dialog objects require no manual disposal. SourceJS owns each temporary native KeyValues tree and attempts `deleteThis()` during cleanup; the deleter suppresses cleanup exceptions, so this is best-effort cleanup rather than a client-side lifetime guarantee. The shared per-player level map lasts for the module lifetime, not one dialog instance or command registration.

Interactive examples own client command registrations and mutable plugin state; `UnloadPlugin()` unregisters only a command acquired by that example and clears its state. It neither resets the shared level map nor withdraws a dialog already displayed. If combining fragments into one plugin, combine their ownership and unload logic rather than replacing one `exports.Unload` with another.

## Related modules

- [`messages`](messages.md) exposes native `GetDialogTypes()` discovery and dialog transport.
- [Typed message creators](messages-types.md#customusermessagecreator) provide the `CustomUserMessageCreator` base class, its `MessageFields` record, and the translation contract.
- [`menus`](menus.md) provides queued menu ownership and direct selection callbacks.
- [`commands/client`](commands-client.md) owns the command registrations used by entry and menu dialogs and their unload cleanup.
