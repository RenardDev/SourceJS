"use strict";

const { deepStrictEqual, doesNotMatch, match, notDeepStrictEqual, notStrictEqual, strictEqual, throws } = require("node:assert");
const { readFileSync, readdirSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { createContext, runInContext } = require("node:vm");

const g_strPluginRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, "../examples/plugins");
const g_strAdministrationRoot = join(g_strPluginRoot, "server-administration");
const g_strCatalogRoot = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, "../packaging/runtime/resource/sourcejs/translations");
const g_mapClientLanguages = new Map();
const g_mapCatalogOverrides = new Map();
let g_strServerLanguage = "en";

const g_vecAutoloadPlugins = readdirSync(g_strPluginRoot, { withFileTypes: true }).filter((Entry) => Entry.isDirectory() && (Entry.name !== "disabled")).map((Entry) => {
	const Manifest = JSON.parse(readFileSync(join(g_strPluginRoot, Entry.name, "plugin.json"), "utf8"));
	strictEqual(Manifest.Name, Entry.name);
	readFileSync(join(g_strPluginRoot, Entry.name, Manifest.Entry));

	return Manifest;
}).filter((Manifest) => Manifest.Autoload !== false).map((Manifest) => Manifest.Name).sort();
deepStrictEqual(g_vecAutoloadPlugins, ["server-administration", "server-protection"]);

const g_strDisabledPluginRoot = join(g_strPluginRoot, "disabled");
for (const Entry of readdirSync(g_strDisabledPluginRoot, { withFileTypes: true })) {
	if (!Entry.isDirectory()) {
		continue;
	}

	const strDirectory = join(g_strDisabledPluginRoot, Entry.name);
	const Manifest = JSON.parse(readFileSync(join(strDirectory, "plugin.json"), "utf8"));
	strictEqual(Manifest.Name, Entry.name);
	strictEqual(Manifest.Autoload, false);
	readFileSync(join(strDirectory, Manifest.Entry));
}

const g_mapClientCommands = new Map();
const g_mapServerCommands = new Map();
const g_mapPlayers = new Map();
const g_mapPermissions = new Map();
const g_mapOfflinePermissions = new Map();
const g_setRejectedEngineCommands = new Set();
let g_ChangeLevelFailure = null;
const g_unCheatConVarFlag = 0x4000;
const g_unProtectedConVarFlag = 0x20;
const g_mapConVars = new Map([["rcon_password", { Exists: true, Flags: g_unProtectedConVarFlag, Value: "not public" }]]);
const g_mapListeners = new Map();
const g_mapEventListeners = new Map();
const g_mapMenus = new Map();
const g_mapSettings = new Map();
let g_PendingPreferenceLoad = null;
let g_bDeferPreferenceLoad = false;
const g_mapSQLGroups = new Map();
const g_mapSQLPlayers = new Map();
let g_bDeferSQLSynchronization = false;
let g_SQLSynchronizationCallback = null;
const g_vecActions = [];
const g_vecReplies = [];
const g_setUnavailableMaps = new Set();
const g_vecChatMessages = [];
const g_vecChatDeliveries = [];
const g_vecDelayed = [];
const g_vecRepeatingTasks = [];
const g_vecMuteReceivers = [];
const g_setRefusingVoiceReceivers = new Set();
let g_bMuteRejected = false;
let g_ChatFilter = null;
let g_EarlyChatFilter = null;
let g_bHasShowMenu = true;
let g_bHasFade = true;
let g_bFadeDeliverySucceeds = true;
let g_InspectFadeSend = null;
let g_InspectGravityWrite = null;
let g_InspectMovementWrite = null;
let g_InspectSoundEmission = null;
let g_bHasHudMsg = true;
let g_bHasTextMsg = true;
let g_bTextMsgDeliveryThrows = false;
let g_bConsoleDeliveryThrows = false;
let g_bChatDeliveryThrows = false;
let g_bHasHintText = true;
const g_setRejectedMenuRecipients = new Set();
const g_setFailingMenuRecipients = new Set();
const g_setFailingMenuClosures = new Set();
let g_bHintDeliveryThrows = false;
let g_bVoteMenuSendSucceeds = true;
let g_strBanReasonsConfiguration = null;
let g_strConfigurationMenu = null;
const g_setInstalledConfigurations = new Set();
let g_unAuthorizationReloads = 0;
let g_unLastVoteMenuTimeout = 0;
let g_bUserMessageReplies = false;
let g_bSoundPrecached = true;
let g_bSoundPrecacheSucceeds = true;
let g_bSoundDispatchThrows = false;
let g_strVoteMenuSoundOverride = null;
let g_strSupportedVoteMenuSound = null;
let g_bCustomMenuSoundPrecached = false;
let g_bBundledMenuSoundPrecached = false;
let g_bDefaultMenuSoundMissing = false;
let g_bBlipMenuSoundMissing = false;
let g_bDefaultMenuExitSoundMissing = false;
let g_bRejectMenuSoundDownload = false;
let g_bUseClientMenuSoundProfile = false;
const g_setPrecachedClientMenuSounds = new Set();
const g_setMenuSoundDownloads = new Set();
let g_bFirstSoundEventThrows = false;
let g_flServerTime = 0;
let g_strCurrentMap = "map_one";
let g_strMapCycle = "map_one\nmap_two // example\nmap_three\n../invalid\n";
let g_vecInstalledMaps = [];
const g_strRecentMapsFile = "/game/data/plugins/server-administration/RecentMaps.txt";
let g_strRecentMapsContents = null;
let g_bRejectRecentMapsWrite = false;

class Command {
	constructor(Payload) {
		this.Index = Payload.Index;
		this.Name = Payload.Arguments[0];
		this.Arguments = Payload.Arguments;
		this.Raw = Payload.Raw ?? Payload.Arguments.join(" ");
		this.Message = Payload.Message ?? "";
		this.TeamOnly = Payload.TeamOnly === true;
	}
}

class MuteManager {
	MutePlayer(unIndex, vecReceivers) {
		if (g_bMuteRejected || vecReceivers.some((unReceiverIndex) => g_setRefusingVoiceReceivers.has(unReceiverIndex))) {
			return false;
		}

		g_vecMuteReceivers.push([unIndex, [...vecReceivers]]);
		g_vecActions.push(["mute", unIndex]);
		return true;
	}

	UnmutePlayer(unIndex) {
		g_vecActions.push(["unmute", unIndex]);
		return true;
	}

	Unload() {
		return true;
	}
}

class TextMessage {
	constructor(strText) {
		this.Text = strText;
	}

	SendUserMessage(unIndex) {
		if (!g_bUserMessageReplies) {
			return false;
		}

		g_vecReplies.push([unIndex, this.Text]);

		return true;
	}
}

const g_HUDDestinations = { Console: 2, Talk: 3, Center: 4 };

class HUDTextMessage extends TextMessage {
	constructor(strText, Options = {}) {
		super(strText);
		this.Destination = Options.Destination ?? g_HUDDestinations.Center;
	}
}

class HUDMessage extends TextMessage {
	constructor(strText, Options) {
		super(strText);
		this.Options = Options;
	}
}

class DialogNotification {
	constructor(strText, Options) {
		this.Text = strText;
		this.Options = Options;
	}

	SendMessage(vecRecipients) {
		g_vecActions.push(["notification", [...vecRecipients], this.Text, this.Options]);

		return true;
	}
}

class VGUIMenu {
	constructor(strPanel, PanelFields) {
		this.Panel = strPanel;
		this.Message = PanelFields.msg;
		this.Title = PanelFields.title;
	}

	SendUserMessage(unIndex) {
		g_vecActions.push(["panel", unIndex, this.Panel, this.Message, this.Title]);

		return true;
	}
}

class Fade {
	constructor(Options) {
		this.Alpha = Options.Color.Alpha;
		this.Flags = Options.Flags;
		this.Duration = Options.Duration;
		this.HoldTime = Options.HoldTime;
	}

	SendUserMessage(Recipients) {
		const unRecipientIndex = Array.isArray(Recipients) ? Recipients[0] : Recipients;
		g_vecActions.push(["fade", unRecipientIndex, this.Alpha, this.Flags, this.Duration, this.HoldTime]);

		if (g_InspectFadeSend) {
			return g_InspectFadeSend(unRecipientIndex);
		}

		return g_bFadeDeliverySucceeds;
	}
}

class HintText extends TextMessage {
	SendUserMessage(unIndex) {
		g_vecActions.push(["hint", unIndex, this.Text]);

		return true;
	}
}

class SimpleRadioOption {
	constructor(unChoiceIndex, strLabel, unValue) {
		this.ChoiceIndex = unChoiceIndex;
		this.Text = strLabel;
		this.Value = unValue;
	}
}

class PagedESCOption {
	constructor(strLabel, Value, Options = {}) {
		this.Text = strLabel;
		this.Value = Value;
		this.Selectable = Options.Selectable ?? true;
	}
}

class SimpleRadioMenu {
	constructor(Options) {
		this.Options = Options;
		this.Items = [];
		this.Timeout = Options.Timeout;
	}

	AppendMenuItem(Item) {
		this.Items.push(Item);
	}

	SendMenu(TargetReferences) {
		const vecTargetIndexes = Array.isArray(TargetReferences) ? TargetReferences : [TargetReferences];
		for (const unTargetIndex of vecTargetIndexes) {
			g_mapMenus.set(unTargetIndex, this);
		}

		return true;
	}

	CloseMenu(unTargetIndex = null) {
		for (const [unIndex, Menu] of g_mapMenus) {
			if ((Menu === this) && ((unTargetIndex === null) || (unIndex === unTargetIndex))) {
				g_mapMenus.delete(unIndex);

				if (g_setFailingMenuClosures.has(unIndex)) {
					throw new Error("Menu closure failed.");
				}

				this.Options.CloseCallback?.(unIndex, this);
			}
		}
	}
}

function RenderMenuText(Text, unClientIndex = 2) {
	return (typeof Text === "function") ? Text(unClientIndex) : Text;
}

function CheckTranslationCatalogs() {
	const vecLanguages = "ar bg cs da de el en es es-419 fi fr hu id it ja ko ms nl no pl pt pt-br ro ru sv th tr uk vi zh-cn zh-tw".split(" ");
	const ReadTokens = (strText) => [...strText.matchAll(/\{(\w+)\}/g)].map((Match) => Match[1]).sort();

	for (const strPlugin of ["server-administration", "server-protection"]) {
		const strDirectory = join(g_strCatalogRoot, strPlugin);
		deepStrictEqual(readdirSync(strDirectory).filter((strName) => strName.endsWith(".json")).sort(), vecLanguages.map((strLanguage) => `${strLanguage}.json`).sort());

		const English = JSON.parse(readFileSync(join(strDirectory, "en.json"), "utf8"));
		const strSourceDirectory = join(g_strPluginRoot, strPlugin);
		for (const strFile of readdirSync(strSourceDirectory).filter((strName) => strName.endsWith(".js"))) {
			const strSource = readFileSync(join(strSourceDirectory, strFile), "utf8");
			for (const Match of strSource.matchAll(/\b(?:Phrase\(\s*|CommandFailure\(\s*|LocalizedLabel\(\s*|Translate\([^,]+,\s*)"([A-Za-z]+)"\s*,\s*"([^"\\\n]*)"/g)) {
				const [, strKey, strFallback] = Match;
				strictEqual(Object.hasOwn(English, strKey), true, `${strPlugin}/${strFile}: ${strKey}`);
				deepStrictEqual(ReadTokens(strFallback), ReadTokens(English[strKey]), `${strPlugin}/${strFile}: ${strKey} placeholders`);
			}

			for (const [, strKey] of strSource.matchAll(/\bLabelValue\("([A-Za-z]+)"/g)) {
				strictEqual(Object.hasOwn(English, strKey), true, `${strPlugin}/${strFile}: ${strKey}`);
				deepStrictEqual(ReadTokens(English[strKey]), [], `${strPlugin}/${strFile}: ${strKey} label`);
			}

			for (const [, strKey] of strSource.matchAll(/\b(?:FormatEffectResult\(|RegisterBomb\("[a-z]+",\s*)"([A-Za-z]+)"/g)) {
				strictEqual(Object.hasOwn(English, strKey), true, `${strPlugin}/${strFile}: ${strKey}`);
				deepStrictEqual(ReadTokens(English[strKey]), [], `${strPlugin}/${strFile}: ${strKey} effect name`);
			}
		}

		for (const strLanguage of vecLanguages) {
			const strJSON = readFileSync(join(strDirectory, `${strLanguage}.json`), "utf8");
			const Catalog = JSON.parse(strJSON);
			const vecProperties = [...strJSON.matchAll(/^\s*"([A-Za-z]+)"\s*:/gm)].map((Match) => Match[1]);
			deepStrictEqual(vecProperties.length, Object.keys(Catalog).length, `${strPlugin}/${strLanguage} duplicate phrase`);
			deepStrictEqual(Object.keys(Catalog), Object.keys(English), `${strPlugin}/${strLanguage} keys and order`);

			for (const [strKey, strText] of Object.entries(Catalog)) {
				strictEqual(typeof strText, "string", strKey);
				strictEqual(strText.trim().length > 0, true, `${strPlugin}/${strLanguage}/${strKey}`);
				deepStrictEqual(ReadTokens(strText), ReadTokens(English[strKey]), `${strPlugin}/${strLanguage}/${strKey} tokens`);
			}
		}
	}
}

CheckTranslationCatalogs();

class PagedESCMenu extends SimpleRadioMenu {}
class SimpleESCMenu extends SimpleRadioMenu {}
class SimpleESCOption extends SimpleRadioOption {}
class PagedRadioOption extends PagedESCOption {}

class PagedRadioMenu extends SimpleRadioMenu {
	constructor(Options) {
		super(Options);
		const Radio = LoadFile(resolve(__dirname, "../packages/sourcejs/menus/radio.js"));
		this.RenderMenu = new Radio.PagedRadioMenu(Options);
		this.RenderOptionType = Radio.PagedRadioOption;
	}

	AppendMenuItem(Item) {
		super.AppendMenuItem(Item);
		this.RenderMenu.AppendMenuItem(new this.RenderOptionType(Item.Text, Item.Value, { Selectable: Item.Selectable }));
	}

	get ItemsPerPage() {
		return this.RenderMenu.ItemsPerPage;
	}

	set ItemsPerPage(unItemsPerPage) {
		this.RenderMenu.ItemsPerPage = unItemsPerPage;
	}

	GetMenuPageCount() {
		return this.RenderMenu.GetMenuPageCount();
	}

	SetPlayerPage(unClientIndex, unPageIndex) {
		return this.RenderMenu.SetPlayerPage(unClientIndex, unPageIndex);
	}

	BuildMenuRenderData(unClientIndex, unPageIndex) {
		return this.RenderMenu.BuildMenuRenderData(unClientIndex, unPageIndex);
	}
}

function SendRadioMenu(unTargetIndex, strTitle, vecOptions, SelectCallback) {
	const Menu = new SimpleRadioMenu({ Title: strTitle, SelectCallback });
	Menu.Items = Array.from(vecOptions, (Option) => (typeof Option === "string") ? { Text: Option, Value: Option } : Option);

	return Menu.SendMenu(unTargetIndex);
}

class TickDelay {
	constructor(unSeconds, Callback) {
		this.Seconds = unSeconds;
		this.Callback = Callback;
		this.TimeRemainingSeconds = unSeconds;
		g_vecDelayed.push(this);
	}

	DisposeTickDelay() {
		this.Callback = null;
		return true;
	}
}

class RepeatingTickTask {
	constructor(Callback) {
		this.Callback = Callback;
	}

	StartRepeatingTickTask(unSeconds) {
		g_vecRepeatingTasks.push(this);
		g_vecActions.push(["repeat-start", unSeconds]);

		return true;
	}

	DisposeRepeatingTickTask() {
		this.Callback = null;
		g_vecActions.push(["repeat-stop"]);

		return true;
	}
}

function AddPlayer(unIndex, unUserID, strName) {
	const Player = {
		Index: unIndex,
		UserID: unUserID,
		Name: strName,
		NetworkID: `STEAM_1:0:${unUserID}`,
		Health: 100,
		Frags: 0,
		Connected: true,
		Dead: false,
		FakeClient: false,
		Origin: { X: unIndex, Y: 0, Z: 0 },
		Team: 2,
		RenderColor: { Red: 9, Green: 8, Blue: 7, Alpha: 255 },
		MovementType: 2,
		MovementFieldSize: 1,
		Gravity: 1,
		Ban(unMinutes, bKick, bPersist) {
			g_vecActions.push(["ban", unUserID, unMinutes, bKick, bPersist]);

			return true;
		},
		Kick(strReason) {
			g_vecActions.push(["kick", unUserID, strReason]);

			return true;
		},
		Slay() {
			this.Dead = true;
			--this.Frags;
			g_vecActions.push(["slay", unUserID]);

			return true;
		},
		SetName(strNewName) {
			this.Name = strNewName;
			g_vecActions.push(["rename", unUserID, strNewName]);

			return true;
		},
		Ignite(flDurationSeconds) {
			g_vecActions.push(["ignite", unUserID, flDurationSeconds]);

			return true;
		},
		SetEntityPropertyInteger(strProperty, nValue) {
			strictEqual(strProperty, "m_iHealth");
			this.Health = nValue;

			return true;
		},
		AddVelocity(Impulse) {
			const unMinimumLateralSpeed = 50;
			const unMaximumLateralSpeed = 229;
			const unMinimumVerticalSpeed = 100;
			const unMaximumVerticalSpeed = 299;

			for (const nValue of [Impulse.X, Impulse.Y]) {
				strictEqual(Number.isInteger(nValue) && (Math.abs(nValue) >= unMinimumLateralSpeed) && (Math.abs(nValue) <= unMaximumLateralSpeed), true);
			}

			strictEqual(Number.isInteger(Impulse.Z) && (Impulse.Z >= unMinimumVerticalSpeed) && (Impulse.Z <= unMaximumVerticalSpeed), true);
			g_vecActions.push(["push", unUserID]);

			return true;
		},
	};
	g_mapPlayers.set(unIndex, Player);

	return Player;
}

function RegisterListener(strName) {
	return function Subscribe(Callback) {
		g_mapListeners.set(strName, Callback);
		return { DisposeListener: () => g_mapListeners.delete(strName) };
	};
}

class SQLBackend {
	Name = "sql";

	CreateSchema(Options, Callback) {
		strictEqual(Options.Blocking, false);
		g_vecActions.push(["sql-schema", "create"]);
		Callback(null, true);
	}

	UpdateSQLiteSchema(Options, Callback) {
		strictEqual(Options.Blocking, false);
		g_vecActions.push(["sql-schema", "update"]);
		Callback(null, true);
	}

	AddParentPermission(strGroupName, strPermission, nServerID, Options, Callback) {
		strictEqual(nServerID, -1);
		strictEqual(Options.Blocking, false);
		g_mapSQLGroups.set(strGroupName, strPermission);
		Callback(null, true);
	}

	ReplacePlayerParents(strPlayerID, vecGroups, Options, Callback) {
		strictEqual(Options.Blocking, false);
		g_mapSQLPlayers.set(strPlayerID, Array.from(vecGroups));
		Callback(null, true);
	}

	DeleteAuthorizationObject(strIdentifier, strType, Options, Callback) {
		strictEqual(strType, "Parent");
		strictEqual(Options.Blocking, false);
		Callback(null, g_mapSQLGroups.delete(strIdentifier));
	}

	Unload(Options, Callback) {
		strictEqual(Options.Blocking, true);
		Callback(null, true);
	}
}

class AuthManager {
	Loaded = false;

	AddBackend(Backend) {
		return Backend;
	}

	IsBackendLoaded() {
		return this.Loaded;
	}

	SetActiveBackend(strName, Options, Callback) {
		strictEqual(strName, "sql");
		strictEqual(Options.Blocking, false);
		this.Loaded = true;
		Callback(null, true);
	}

	Synchronize(Options, Callback) {
		strictEqual(Options.Blocking, false);

		if (g_bDeferSQLSynchronization) {
			strictEqual(g_SQLSynchronizationCallback, null);
			g_SQLSynchronizationCallback = Callback;
			return;
		}

		Callback(null, true);
	}

	IsPlayerAuthorized(unIndex, strPermission) {
		const strPlayerID = (76561197960265728n + BigInt(g_mapPlayers.get(unIndex).UserID * 2)).toString();
		return g_mapSQLPlayers.get(strPlayerID)?.some((strGroup) => g_mapSQLGroups.get(strGroup) === strPermission) ?? false;
	}

	get Players() {
		return new Map([...g_mapSQLPlayers].map(([strSteamID64, vecGroups]) => [strSteamID64, { HasPermission: (strPermission) => vecGroups.some((strGroup) => g_mapSQLGroups.get(strGroup) === strPermission) }]));
	}
}

const g_Modules = {
	auth: {
		HasPlayerPermission: (Subject, strPermission) => ((typeof Subject === "string") ? g_mapOfflinePermissions : g_mapPermissions).get(Subject)?.has(strPermission) ?? false,
		Reload() {
			++g_unAuthorizationReloads;

			return {};
		},
	},
	"auth/backends/sql": { SQLBackend },
	"auth/manager": { AuthManager },
	commands: { BLOCK: 1, CONTINUE: 0, Command },
	"commands/client": {
		RegisterCommand: (strName, Callback) => g_mapClientCommands.set(strName, Callback),
		SendCommand(unIndex, strCommand, bServerSide) {
			g_vecActions.push(["client-command", unIndex, strCommand, bServerSide]);

			if (g_bFirstSoundEventThrows && (unIndex === 1)) {
				throw new Error("Sound event command backend failed.");
			}

			return unIndex !== 2;
		},
	},
	"commands/server": { RegisterCommand: (strName, Callback) => g_mapServerCommands.set(strName, Callback) },
	"commands/say": {
		RegisterCommandFilter(Callback, bEarly = false) {
			if (bEarly) {
				g_EarlyChatFilter = Callback;
			} else {
				g_ChatFilter = Callback;
			}

			return true;
		},
		UnregisterCommandFilter(Callback, bEarly = false) {
			if (bEarly) {
				strictEqual(Callback, g_EarlyChatFilter);
				g_EarlyChatFilter = null;
			} else {
				strictEqual(Callback, g_ChatFilter);
				g_ChatFilter = null;
			}

			return true;
		},
	},
	core: {
		SOURCE_ENGINE_BRANCH: "l4d2",
		Tokenizer: class extends Array {
			constructor(strText) {
				super(...Array.from(strText.matchAll(/"([^"]*)"|(\S+)/g), (Match) => Match[1] ?? Match[2]));
			}
		},
	},
	"core/logger": { LogInfo: (strMessage) => g_vecReplies.push([0, strMessage]), LogWarning: (strMessage) => g_vecReplies.push([0, strMessage]) },
	cvars: {
		FindConVar: (strName) => g_mapConVars.get(strName.toLowerCase()) ?? { Exists: false },
		CreateConVar(strName, strValue) {
			const ConVar = { Exists: true, Flags: 0, Value: strValue, DefaultValue: strValue };
			g_mapConVars.set(strName, ConVar);
			return ConVar;
		},
		SetConVar(strName, strValue) {
			const ConVar = g_mapConVars.get(strName.toLowerCase());
			if (ConVar.RejectWrite) {
				return false;
			}

			ConVar.Value = strValue;

			return true;
		},
		RevertConVarToDefault(strName) {
			const ConVar = g_mapConVars.get(strName.toLowerCase());
			if (typeof ConVar?.DefaultValue !== "string") {
				return false;
			}

			ConVar.Value = ConVar.DefaultValue;

			return true;
		},
	},
	"cvars/flags": { CHEAT: g_unCheatConVarFlag, PROTECTED: g_unProtectedConVarFlag },
	effects: {
		CreateTemporaryEntity(strName, Fields, vecRecipients) {
			g_vecActions.push(["temporary-entity", strName, Fields, [...vecRecipients]]);

			return true;
		},
	},
	"engines/precache": {
		PrecacheModel(strName) {
			return ["materials/sprites/laserbeam.vmt", "materials/sprites/glow01.vmt", "materials/sprites/floorfire4_.vmt"].indexOf(strName) + 1;
		},
	},
	"entities/constants": { MoveType: { None: 0, Walk: 2, Fly: 4, NoClip: 8 } },
	"entities/datamaps": {
		GetEntityDataMapPropertyColor: (Player) => Player.RenderColor,
		SetEntityDataMapPropertyColor(Player, strProperty, Color) {
			strictEqual(strProperty, "m_clrRender");
			Player.RenderColor = Color;
			g_vecActions.push(["tint", Player.Index, Color.Blue]);

			return true;
		},
		GetEntityDataMap: (Player) => ({ Player }),
		FindEntityDataMapField(DataMap, strFieldName) {
			if (strFieldName === "m_iFrags") {
				return { ElementCount: 1, Offset: 12, Path: strFieldName, SizeInBytes: 4, Type: "int" };
			}

			if (strFieldName === "m_flGravity") {
				return { ElementCount: 1, Offset: 8, Path: strFieldName, SizeInBytes: 4, Type: "float" };
			}

			strictEqual(strFieldName, "m_MoveType");
			return { ElementCount: 1, Offset: 4, Path: strFieldName, SizeInBytes: DataMap.Player.MovementFieldSize, Type: "char" };
		},
		GetEntityDataMapPropertyInteger(Player, strFieldName) {
			strictEqual(strFieldName, "m_iFrags");

			return Player.Frags;
		},
		GetEntityDataMapPropertyFloat(Player, strFieldName) {
			strictEqual(strFieldName, "m_flGravity");

			return Player.Gravity;
		},
		GetEntityDataMapPropertyVector(Player, strFieldName) {
			strictEqual(strFieldName, "m_vecViewOffset");

			return Player.ViewOffset ?? null;
		},
		SetEntityDataMapPropertyInteger(Player, strFieldName, nValue) {
			strictEqual(strFieldName, "m_iFrags");
			Player.Frags = nValue;
			g_vecActions.push(["restore-frags", Player.UserID, nValue]);

			return true;
		},
		GetEntityDataMapPropertyUnsignedCharacter(Player, strFieldName) {
			strictEqual(strFieldName, "m_MoveType");
			return Player.MovementType;
		},
		SetEntityDataMapPropertyUnsignedCharacter(Player, strFieldName, unMovementType) {
			strictEqual(strFieldName, "m_MoveType");

			if (g_InspectMovementWrite) {
				return g_InspectMovementWrite(Player, unMovementType);
			}

			Player.MovementType = unMovementType;
			return true;
		},
		SetEntityDataMapPropertyFloat(Player, strFieldName, flGravity) {
			strictEqual(strFieldName, "m_flGravity");

			if (g_InspectGravityWrite) {
				return g_InspectGravityWrite(Player, flGravity);
			}

			Player.Gravity = flGravity;
			return true;
		},
	},
	"engines/server": {
		EmitAmbientSound(unIndex, Position, strSample, flVolume, unSoundLevel, unFlags, unPitch) {
			g_vecActions.push(["ambient", unIndex, strSample, Position.X]);

			if (strSample === "buttons/blip1.wav") {
				g_vecActions.push(["beacon-audio", Position.Z, flVolume, unSoundLevel, unFlags, unPitch]);
			}

			return true;
		},
		ChangeLevel(strMap) {
			g_vecActions.push(["change-map", strMap]);

			if (g_ChangeLevelFailure instanceof Error) {
				throw g_ChangeLevelFailure;
			}

			if (g_ChangeLevelFailure === false) {
				return false;
			}

			return true;
		},
		PrintToClientConsole(unIndex, strMessage) {
			if (g_bConsoleDeliveryThrows) {
				throw new Error("Client console delivery failed.");
			}

			g_vecReplies.push([unIndex, strMessage]);

			return true;
		},
		ExecuteServerCommand(strCommand) {
			g_vecActions.push(["engine", strCommand]);

			return !g_setRejectedEngineCommands.has(strCommand);
		},
		GetGameDirectory: () => "/game/left4dead2",
		GetInstalledMaps: () => g_vecInstalledMaps,
		GetMapName: () => g_strCurrentMap,
		GetMaximumClients: () => 3,
		GetMaximumHumanClients: () => 3,
		GetServerTime: () => g_flServerTime,
		IsMapValid: (strMap) => ["map_one", "map_two", "map_three", "map_four", "map_five"].includes(strMap) && !g_setUnavailableMaps.has(strMap),
	},
	"engines/sound": {
		Attenuation: { NORMAL: 0.8 },
		Channel: { AUTO: 0 },
		SOUND_FROM_LOCAL_PLAYER: -1,
		IsSoundPrecached(strSample) {
			if (strSample.startsWith("UI/menu_")) {
				return g_setPrecachedClientMenuSounds.has(strSample);
			}

			if ((g_bDefaultMenuSoundMissing && (strSample === "buttons/button14.wav")) || (g_bBlipMenuSoundMissing && (strSample === "buttons/blip1.wav"))) {
				return true;
			}

			if (strSample === "buttons/custom.wav") {
				return g_bCustomMenuSoundPrecached;
			}

			if (strSample === "sourcejs/menu-select.wav") {
				return g_bBundledMenuSoundPrecached;
			}

			return g_bSoundPrecached && (!g_bDefaultMenuExitSoundMissing || (strSample !== "buttons/combine_button7.wav"));
		},
		PrecacheSound(strSample, bPreload, bUISound) {
			g_vecActions.push(["precache-sound", strSample, bPreload, bUISound]);

			if (strSample.startsWith("UI/menu_")) {
				if (g_bSoundPrecacheSucceeds) {
					g_setPrecachedClientMenuSounds.add(strSample);
				}

				return g_bSoundPrecacheSucceeds;
			}

			if (strSample === "buttons/custom.wav") {
				g_bCustomMenuSoundPrecached = g_bSoundPrecacheSucceeds;
				return g_bCustomMenuSoundPrecached;
			}

			if (strSample === "sourcejs/menu-select.wav") {
				g_bBundledMenuSoundPrecached = g_bSoundPrecacheSucceeds;
				return g_bBundledMenuSoundPrecached;
			}

			g_bSoundPrecached = g_bSoundPrecacheSucceeds;

			return g_bSoundPrecached;
		},
		EmitSound(Options) {
			if (Options.Sample === "test.wav") {
				strictEqual(Options.Entity, -1);
				strictEqual(Options.Reliable, true);
			}

			if (Options.Sample.startsWith("UI/menu_") || ["buttons/button14.wav", "buttons/combine_button7.wav", "buttons/blip1.wav", "buttons/custom.wav", "sourcejs/menu-select.wav"].includes(Options.Sample)) {
				strictEqual(Options.Reliable, true);
				strictEqual(Options.Recipients.length, 1);
				strictEqual(Options.Entity, -1);
				strictEqual(Options.Origin, undefined);
			}

			if (g_bSoundDispatchThrows) {
				throw new Error("Sound backend unavailable.");
			}

			g_vecActions.push(["sound", Options.Sample, ...Options.Recipients]);

			return g_InspectSoundEmission ? g_InspectSoundEmission(Options) : true;
		},
	},
	"events/listener": {
		RegisterEventListener(strName, Callback) {
			strictEqual(g_mapEventListeners.has(strName), false);
			g_mapEventListeners.set(strName, Callback);

			return true;
		},
		UnregisterEventListener(strName, Callback) {
			strictEqual(g_mapEventListeners.get(strName), Callback);

			return g_mapEventListeners.delete(strName);
		},
	},
	"filters/players": {
		GetAllPlayers: () => Array.from(g_mapPlayers.values(), ({ Team: nTeamNumber, ...Player }) => ({ ...Player, TeamNumber: nTeamNumber })),
	},
	filesystem: {
		DoesFileExist(strPath) {
			if (strPath.startsWith("sound/UI/menu_")) {
				return false;
			}

			if (strPath.startsWith("cfg/")) {
				return g_setInstalledConfigurations.has(strPath);
			}

			return (strPath !== "sound/not_installed.wav") && (!g_bDefaultMenuSoundMissing || (strPath !== "sound/buttons/button14.wav")) && (!g_bBlipMenuSoundMissing || (strPath !== "sound/buttons/blip1.wav")) && (!g_bDefaultMenuExitSoundMissing || (strPath !== "sound/buttons/combine_button7.wav"));
		},
		ReadTextFile(strPath) {
			if (strPath.startsWith("/translations/")) {
				if (g_mapCatalogOverrides.has(strPath)) {
					return g_mapCatalogOverrides.get(strPath);
				}

				return readFileSync(join(g_strCatalogRoot, strPath.slice("/translations/".length)), "utf8");
			}

			if (strPath === g_strRecentMapsFile) {
				return g_strRecentMapsContents;
			}

			if (strPath === "/game/cfg/sourcejs/server-administration/BanReasons.json") {
				return g_strBanReasonsConfiguration;
			}

			if (strPath === "/game/cfg/sourcejs/server-administration/Configurations.json") {
				return g_strConfigurationMenu;
			}

			if (strPath === "/game/left4dead2/mapcycle.txt") {
				return g_strMapCycle;
			}

			if (strPath === "/game/left4dead2/engine-cycle.txt") {
				return "map_one\nmap_three\n";
			}

			if (strPath === "/game/left4dead2/cfg/rotation/custom.txt") {
				return "map_one\nmap_four\n";
			}

			if (strPath === "/game/data/sourcejs/effects/FunCommandAssets.json") {
				return readFileSync(resolve(__dirname, "../packaging/runtime/addons/sourcejs/data/sourcejs/effects/FunCommandAssets.json"), "utf8");
			}

			return null;
		},
		WriteTextFile(strPath, strContents) {
			strictEqual(strPath, g_strRecentMapsFile);

			if (g_bRejectRecentMapsWrite) {
				return false;
			}

			g_strRecentMapsContents = strContents;

			return true;
		},
	},
	globals: { GetGlobalVariables: () => ({ SDKBranch: "l4d2" }) },
	"internal/runtime": {
		GetModule(strModule) {
			if (strModule === "menus") {
				return {};
			}

			strictEqual(strModule, "players");

			return { GetPlayer: (unIndex) => g_mapPlayers.get(unIndex), IsObserver: (unIndex) => g_mapPlayers.get(unIndex)?.Observer === true };
		},
	},
	listeners: {
		RegisterClientActiveListener: RegisterListener("active"),
		RegisterClientDisconnectListener: RegisterListener("disconnect"),
		RegisterLevelEndListener: RegisterListener("level-end"),
		RegisterLevelShutdownListener: RegisterListener("level-end"),
		RegisterServerActivateListener: RegisterListener("level-start"),
		RegisterTickListener: RegisterListener("tick"),
	},
	"listeners/tick": { RepeatingTickTask, TickDelay },
	netchannel: {
		GetPlayerNetChannelInfo(unIndex) {
			const Player = g_mapPlayers.get(unIndex);

			return { TimeConnected: Player.ConnectedSeconds, GetNetChannelAverageLatency: () => Player.Latency };
		},
		NET_FLOW: { Outgoing: 0 },
	},
	"memory/manager": {
		LoadGameDataFile(strFilePath) {
			if (strFilePath === "MenuSounds.json") {
				const strProfilePath = join(__dirname, "../packaging/runtime/addons/sourcejs/gamedata/MenuSounds.json");

				return g_bUseClientMenuSoundProfile ? JSON.parse(readFileSync(strProfilePath, "utf8")) : {};
			}

			if (strFilePath === "core.games/common.games.txt") {
				return {
					Games: {
						"#default": [
							{ Keys: { MenuItemSound: "buttons/button14.wav" } },
							{ "#supported": { game: ["left4dead", "left4dead2"] }, Keys: { MenuItemSound: g_strSupportedVoteMenuSound } },
							{ "#supported": { game: "different_game" }, Keys: { MenuItemSound: "" } },
						],
						left4dead2: { Keys: { MenuItemSound: g_strVoteMenuSoundOverride } },
					},
				};
			}

			if (strFilePath === "sdktools.games/engine.l4d2.txt") {
				return { Games: { "#default": { Keys: { SlapSoundCount: "1", SlapSound1: "player/damage1.wav" } } } };
			}

			if (strFilePath === "sdktools.games/common.games.txt") {
				return { Games: { "#default": { Keys: { m_iFrags: "m_iFrags" } } } };
			}

			strictEqual(strFilePath, "funcommands.games.txt");

			return {
				Games: {
					"#default": [
						{ Keys: { SpriteBeam: "sprites/laser.vmt", SoundBlip: "buttons/blip1.wav", SoundBeep: "buttons/button17.wav", SoundFinal: "weapons/cguard/charging.wav", SoundBoom: "weapons/explode3.wav", SoundFreeze: "physics/glass/glass_impact_bullet4.wav", TeamUnknownBeaconColor: "90,91,92,255" } },
						{ "#supported": { game: ["left4dead", "left4dead2"] }, Keys: { SpriteBeam: "sprites/laserbeam.vmt", SpriteHalo: "sprites/glow01.vmt", SpriteExplosion: "sprites/floorfire4_.vmt", Team2BeaconColor: "75,75,255,255", Team3BeaconColor: "255,75,75,255" } },
						{ "#supported": { game: "unsupported" }, Keys: { SpriteBeam: "wrong.vmt" } },
					],
				},
			};
		},
	},
	"menus/esc": { PagedESCMenu, PagedESCOption, SimpleESCMenu, SimpleESCOption },
	"menus/queue": {
		GetPlayerMenuQueue: (unIndex) => ({
			get ActiveMenu() {
				return g_mapMenus.get(unIndex) ?? null;
			},
			SendMenu(Menu) {
				g_mapMenus.set(unIndex, Menu);
				g_unLastVoteMenuTimeout = Menu.Timeout;

				if (g_setFailingMenuRecipients.has(unIndex)) {
					throw new Error("Menu delivery failed.");
				}

				return g_bVoteMenuSendSucceeds && !g_setRejectedMenuRecipients.has(unIndex);
			},
		}),
	},
	"menus/radio": { PagedRadioMenu, PagedRadioOption, SendRadioMenu, SimpleRadioMenu, SimpleRadioOption },
	messages: {
		FADE_FLAGS: { In: 1, Out: 2, StayOut: 8, Purge: 16 },
		Fade,
		HintText,
		HUD_DESTINATION: { Console: g_HUDDestinations.Console, Talk: g_HUDDestinations.Talk },
		HUDMessage,
		HUDTextMessage,
		GetUserMessageIndex: (strName) => {
			if ((strName === "Fade") && !g_bHasFade) {
				return -1;
			}

			if (((strName === "ShowMenu") && !g_bHasShowMenu) || ((strName === "HudMsg") && !g_bHasHudMsg) || ((strName === "TextMsg") && !g_bHasTextMsg) || ((strName === "HintText") && !g_bHasHintText)) {
				return -1;
			}

			return 1;
		},
		SayText: TextMessage,
		SCREEN_FADE_FRACTION_BITS: 9,
		SendUserMessageValue(vecIndexes, Message) {
			if ((Message instanceof HUDTextMessage) && (Message.Destination === g_HUDDestinations.Talk)) {
				if (g_bTextMsgDeliveryThrows) {
					throw new Error("TextMsg delivery failed.");
				}

				g_vecActions.push(["chat-warning", [...vecIndexes], Message.Text]);
			}

			if (Message instanceof HUDMessage) {
				g_vecActions.push(["hud", [...vecIndexes], Message.Text, Message.Options]);
				return true;
			}

			if ((Message instanceof HUDTextMessage) && (Message.Destination === g_HUDDestinations.Center)) {
				g_vecActions.push(["center", [...vecIndexes], Message.Text]);
				return true;
			}

			if (Message instanceof HintText) {
				if (g_bHintDeliveryThrows) {
					throw new Error("HintText delivery failed.");
				}

				g_vecActions.push(["hint", [...vecIndexes], Message.Text]);
			}

			if (g_bChatDeliveryThrows && ((Message instanceof TextMessage) && !(Message instanceof HUDTextMessage))) {
				throw new Error("Chat delivery failed.");
			}

			g_vecChatMessages.push(Message.Text);
			g_vecChatDeliveries.push([[...vecIndexes], Message.Text]);

			return true;
		},
		VGUIMenu,
	},
	"messages/dialog": { DialogNotification },
	"players/helpers": { GetUserIDFromIndex: (unIndex) => g_mapPlayers.get(unIndex)?.UserID ?? -1 },
	stringtables: {
		DOWNLOADABLES: {
			Add(strPath) {
				if (g_bRejectMenuSoundDownload) {
					throw new Error("Download table rejected the sample.");
				}

				return g_setMenuSoundDownloads.add(strPath);
			},
		},
	},
	"players/voice": { MuteManager },
	paths: { CONFIG_ROOT: "/game/cfg/sourcejs", PLUGIN_DATA_ROOT: "/game/data/plugins", SOURCE_DATA_ROOT: "/game/data/sourcejs", TRANSLATION_ROOT: "/translations" },
	"players/language": { GetClientLanguage: (unClientIndex) => g_mapClientLanguages.get(unClientIndex) ?? "english" },
	translations: { GetDefaultLanguage: () => g_strServerLanguage },
	"settings/storage": {
		CreateStorage() {
			return {
				Loaded: true,
				EnsureLoaded(Options, Callback) {
					strictEqual(Options.Blocking, false);

					if (g_bDeferPreferenceLoad) {
						g_PendingPreferenceLoad = Callback;
						return;
					}

					Callback(null, {});
				},
				GetCachedPlayerValues: (strPlayerID) => g_mapSettings.get(strPlayerID) ?? null,
				SetSetting(strPlayerID, strName, Value, Options, Callback) {
					strictEqual(Options.Blocking, false);
					g_mapSettings.set(strPlayerID, { [strName]: Value });
					Callback(null, true);
				},
				Close(Options, Callback) {
					strictEqual(Options.Blocking, true);
					Callback(null, true);
				},
			};
		},
	},
	steam: {
		SteamID: {
			Parse(strValue) {
				const unSteamID64Base = 76_561_197_960_265_728n;
				const vecMatch = /^STEAM_[01]:([01]):(\d+)$/.exec(strValue);
				const unSteamID64 = vecMatch ? unSteamID64Base + (BigInt(vecMatch[2]) * 2n) + BigInt(vecMatch[1]) : BigInt(strValue);

				return { ConvertSteamIDToUInt64: () => unSteamID64, ConvertSteamIDToSteamID3: () => `[U:1:${unSteamID64 - unSteamID64Base}]` };
			},
		},
	},
};

const g_mapModuleCache = new Map();
const g_Context = createContext({ console: { log() {} } });

function LoadFile(strPath) {
	if (g_mapModuleCache.has(strPath)) {
		return g_mapModuleCache.get(strPath).exports;
	}

	const Module = { exports: {} };
	g_mapModuleCache.set(strPath, Module);
	function Require(strModule) {
		if (strModule.startsWith("./")) {
			return LoadFile(resolve(dirname(strPath), `${strModule}.js`));
		}

		if (!Object.hasOwn(g_Modules, strModule)) {
			if (strModule === "menus") {
				return LoadFile(resolve(__dirname, "../packages/sourcejs/menus/index.js"));
			}

			if (strModule === "translations/catalog") {
				return LoadFile(resolve(__dirname, "../packages/sourcejs/translations/catalog.js"));
			}

			throw new Error(`Missing runtime double: ${strModule}`);
		}

		return g_Modules[strModule];
	}

	const ExecuteModule = runInContext(`(function(module, require) {\n${readFileSync(strPath, "utf8")}\n})`, g_Context, { filename: strPath });
	ExecuteModule(Module, Require);
	return Module.exports;
}

function Chat(unIndex, ...vecArguments) {
	const { BLOCK, CONTINUE } = g_Modules.commands;
	const Payload = { Index: unIndex, Arguments: vecArguments };
	if (g_EarlyChatFilter?.(Payload) === BLOCK) {
		return BLOCK;
	}

	return g_ChatFilter?.(Payload) ?? CONTINUE;
}

function RunServerCommand(strName, ...vecArguments) {
	const strCommand = `sjs_${strName}`;

	return g_mapServerCommands.get(strCommand)({ Index: 0, Arguments: [strCommand, ...vecArguments] });
}

const g_Manifest = JSON.parse(readFileSync(join(g_strAdministrationRoot, "plugin.json"), "utf8"));
strictEqual(g_Manifest.Autoload, true);
strictEqual(JSON.parse(readFileSync(join(g_strPluginRoot, "disabled/hello/plugin.json"), "utf8")).Autoload, false);
const g_Plugin = LoadFile(join(g_strAdministrationRoot, g_Manifest.Entry));

{
	const { Translate, ResetTranslations } = LoadFile(join(g_strAdministrationRoot, "translations.js"));
	const { Translate: TranslateProtection } = LoadFile(join(g_strPluginRoot, "server-protection", "translations.js"));
	const strPath = "/translations/server-administration/ru.server.json";
	g_strServerLanguage = "ru";
	g_mapClientLanguages.set(2, "unsupported");
	g_mapClientLanguages.set(3, "english");
	g_mapCatalogOverrides.set(strPath, JSON.stringify({ NoTarget: "Цель не найдена.", ChangingMap: "Неверная подстановка {Wrong}." }));

	try {
		ResetTranslations();
		strictEqual(Translate(0, "NoTarget", "No matching player."), "Цель не найдена.");
		strictEqual(Translate(2, "NoTarget", "No matching player."), "Цель не найдена.");
		strictEqual(Translate(null, "NoTarget", "No matching player."), "No matching player.");
		strictEqual(Translate(3, "NoTarget", "No matching player."), "No matching player.");
		strictEqual(Translate(2, "ChangingMap", "Changing map to {Map} in {Seconds} seconds.", { Map: "test_{Seconds}", Seconds: 3 }), "Переход на карту test_{Seconds} через 3 сек.");

		g_mapClientLanguages.set(2, "brazilian");
		strictEqual(TranslateProtection(2, "Flood", "You are sending chat messages too quickly."), "Você está enviando mensagens rápido demais.");
		g_mapClientLanguages.set(2, "portuguese");
		strictEqual(TranslateProtection(2, "Flood", "You are sending chat messages too quickly."), "Estás a enviar mensagens demasiado depressa.");

		for (const strLanguage of ["latam", "es-419", "es_419"]) {
			g_mapClientLanguages.set(2, strLanguage);
			strictEqual(TranslateProtection(2, "Flood", "You are sending chat messages too quickly."), "Estás enviando mensajes demasiado rápido.");
		}

		g_mapClientLanguages.set(2, "spanish");
		strictEqual(TranslateProtection(2, "Flood", "You are sending chat messages too quickly."), "Envías mensajes de chat demasiado deprisa.");
	} finally {
		g_strServerLanguage = "en";
		g_mapClientLanguages.clear();
		g_mapCatalogOverrides.clear();
		ResetTranslations();
	}
}

deepStrictEqual([...g_mapServerCommands.keys()], [...g_mapClientCommands.keys()]);
for (const strName of ["ban", "slap", "slay", "gag", "ungag", "mute", "cancelvote", "admin", "kick", "cvar", "votegravity", "beacon"]) {
	strictEqual(g_mapServerCommands.has(`sjs_${strName}`), true);
}

const g_vecExpectedCommands = [
	"abortban",
	"addban",
	"admin",
	"ban",
	"banip",
	"beacon",
	"blind",
	"burn",
	"cancelvote",
	"chat",
	"cookies",
	"create_adm_tables",
	"csay",
	"currentmap",
	"cvar",
	"drug",
	"dsay",
	"execcfg",
	"ff",
	"firebomb",
	"freeze",
	"freezebomb",
	"gag",
	"gravity",
	"help",
	"hsay",
	"kick",
	"listmaps",
	"map",
	"mapchooser_refresh",
	"maphistory",
	"mapvote",
	"motd",
	"msay",
	"mute",
	"nextmap",
	"noclip",
	"nominate",
	"nominate_addmap",
	"play",
	"psay",
	"rcon",
	"reloadadmins",
	"rename",
	"resetcvar",
	"revote",
	"rtv",
	"say",
	"searchcmd",
	"setnextmap",
	"settings",
	"silence",
	"slap",
	"slay",
	"sql_addadmin",
	"sql_addgroup",
	"sql_deladmin",
	"sql_delgroup",
	"sql_reload",
	"sql_setadmingroups",
	"thetime",
	"timebomb",
	"timeleft",
	"tsay",
	"unban",
	"ungag",
	"unmute",
	"unsilence",
	"update_adm_tables",
	"vote",
	"votealltalk",
	"voteban",
	"voteburn",
	"voteff",
	"votefor",
	"votegravity",
	"votekick",
	"votemap",
	"voteslay",
	"who",
];
deepStrictEqual([...g_mapServerCommands.keys()].sort(), g_vecExpectedCommands.map((strName) => `sjs_${strName}`));

AddPlayer(1, 101, "Operator");
const g_Target = AddPlayer(2, 102, "Test Player");
const g_Peer = AddPlayer(3, 103, "Test Peer");
g_mapPermissions.set(1, new Set(["sourcejs.admin", "sourcejs.ban", "sourcejs.chat", "sourcejs.cvar", "sourcejs.kick", "sourcejs.map", "sourcejs.slay", "sourcejs.vote"]));

const g_setPublicCommands = new Set(["cookies", "currentmap", "ff", "help", "listmaps", "motd", "nextmap", "nominate", "revote", "rtv", "searchcmd", "settings", "thetime", "timeleft", "votefor"]);
for (const strName of g_vecExpectedCommands) {
	const strConsoleName = `sjs_${strName}`;
	if (g_setPublicCommands.has(strName)) {
		const unReplyCount = g_vecReplies.length;
		strictEqual(Chat(2, `/${strName}`), 1, `Public command recognition: ${strName}`);
		strictEqual(Chat(2, `!${strName}`), 0, `Public command chat visibility: ${strName}`);
		strictEqual(g_mapClientCommands.get(strConsoleName)({ Index: 2, Arguments: [strConsoleName] }), 1);
		strictEqual(g_vecReplies.slice(unReplyCount).some((Reply) => /do not have permission/.test(Reply[1])), false);
		continue;
	}

	const unPreviousActions = g_vecActions.length;
	const ReplyPattern = (strName.startsWith("sql_") || strName.endsWith("_adm_tables")) ? /restricted to the server console/ : /do not have permission/;
	strictEqual(Chat(2, `/${strName}`), 1, `Private command route: ${strName}`);
	match(g_vecReplies.at(-1)[1], ReplyPattern);
	strictEqual(Chat(2, `!${strName}`), 0, `Public command route: ${strName}`);
	match(g_vecReplies.at(-1)[1], ReplyPattern);
	strictEqual(g_mapClientCommands.get(strConsoleName)({ Index: 2, Arguments: [strConsoleName] }), 1);
	match(g_vecReplies.at(-1)[1], ReplyPattern);
	strictEqual(g_vecActions.length, unPreviousActions);
}

g_vecActions.length = 0;
g_mapMenus.clear();
strictEqual(Chat(2, "/ban", "#101", "10"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
strictEqual(Chat(2, "!ban", "#101", "10"), 0);
strictEqual(Chat(2, "/unknown"), 0);

const g_strHelpChatNotice = "[SourceJS] See your console for the command list.";
g_bUserMessageReplies = true;
const g_unBeforeHelp = g_vecReplies.length;
strictEqual(g_ChatFilter({ Index: 2, Arguments: ['"/help"'], Message: '"/help"' }), 1);
const g_vecHelpReplies = g_vecReplies.slice(g_unBeforeHelp);
match(g_vecHelpReplies[0][1], /Commands \(page 1\/2\)/);
strictEqual(g_vecHelpReplies.filter((Reply) => /\[\d{3}\] sjs_/.test(Reply[1])).length, 10);
deepStrictEqual(g_vecHelpReplies.at(-1), [2, g_strHelpChatNotice]);
strictEqual(g_vecHelpReplies.slice(0, -1).every((Reply) => (Reply[0] === 2) && Reply[1].endsWith("\n")), true);

const g_unBeforeConsoleHelp = g_vecReplies.length;
strictEqual(g_mapClientCommands.get("sjs_help")({ Index: 2, Arguments: ["sjs_help", "2"] }), 1);
const g_vecConsoleHelp = g_vecReplies.slice(g_unBeforeConsoleHelp);
match(g_vecConsoleHelp[1][1], /\[011\] sjs_/);
strictEqual(g_vecConsoleHelp.length, 6);
strictEqual(g_vecConsoleHelp.every((Reply) => (Reply[0] === 2) && Reply[1].endsWith("\n")), true);

strictEqual(Chat(2, "/help", "3"), 1);
match(g_vecReplies.at(-1)[1], /Help page must be in 1\.\.2/);

strictEqual(g_ChatFilter({ Index: 1, Arguments: ['"/help', 'slap"'], Message: '"/help slap"' }), 1);
match(g_vecReplies.at(-2)[1], /\[001\] sjs_slap/);
strictEqual(g_ChatFilter({ Index: 1, Arguments: ["!help"], Message: "!help slap" }), 0);
match(g_vecReplies.at(-2)[1], /\[001\] sjs_slap/);

strictEqual(Chat(2, "/searchcmd", "REVOTE"), 1);
match(g_vecReplies.at(-2)[1], /\[001\] sjs_revote/);
deepStrictEqual(g_vecReplies.at(-1), [2, g_strHelpChatNotice]);
strictEqual(Chat(2, "/searchcmd", "slap"), 1);
deepStrictEqual(g_vecReplies.at(-2), [2, "[SourceJS] No matching commands found.\n"]);
strictEqual(Chat(1, "/searchcmd", "SJS_SLAP"), 1);
match(g_vecReplies.at(-2)[1], /\[001\] sjs_slap <target>/);
strictEqual(Chat(1, "/searchcmd", "noclip"), 1);
match(g_vecReplies.at(-2)[1], /No matching commands/);
strictEqual(Chat(1, "/help", "noclip"), 1);
match(g_vecReplies.at(-2)[1], /No matching commands/);

g_mapPermissions.get(1).add("sourcejs.cheats");
strictEqual(Chat(1, "/searchcmd", "noclip"), 1);
match(g_vecReplies.at(-2)[1], /\[001\] sjs_noclip/);
g_mapPermissions.get(1).delete("sourcejs.cheats");

g_mapPermissions.set(2, new Set(["sourcejs.vote"]));
strictEqual(Chat(2, "/searchcmd", "votemap"), 1);
match(g_vecReplies.at(-2)[1], /No matching commands/);
strictEqual(Chat(2, "/votemap", "map_two"), 1);
match(g_vecReplies.at(-1)[1], /also requires sourcejs\.map/);
strictEqual(g_mapMenus.size, 0);
g_mapPermissions.get(2).add("sourcejs.map");
strictEqual(Chat(2, "/searchcmd", "votemap"), 1);
match(g_vecReplies.at(-2)[1], /\[001\] sjs_votemap/);
g_mapPermissions.delete(2);

for (const [strName, Refusal] of [
	["motd", /available in game only/],
	["nominate", /Only connected players can nominate/],
	["revote", /only available in-game/],
	["rtv", /Only connected players can rock the vote/],
	["settings", /preferences require an in-game player/],
	["votefor", /not eligible for an active vote/],
]) {
	const unActionsBeforeConsoleRefusal = g_vecActions.length;
	const unMenusBeforeConsoleRefusal = g_mapMenus.size;
	const ExactCommand = new RegExp(`\\[\\d{3}\\] sjs_${strName}(?: |$)`);
	let unBeforeConsoleSearch = g_vecReplies.length;
	strictEqual(RunServerCommand("searchcmd", `sjs_${strName}`), 1);
	strictEqual(g_vecReplies.slice(unBeforeConsoleSearch).some(([, strLine]) => ExactCommand.test(strLine)), false);
	unBeforeConsoleSearch = g_vecReplies.length;
	strictEqual(RunServerCommand("help", `sjs_${strName}`), 1);
	strictEqual(g_vecReplies.slice(unBeforeConsoleSearch).some(([, strLine]) => ExactCommand.test(strLine)), false);
	strictEqual(RunServerCommand(strName), 1);
	match(g_vecReplies.at(-1)[1], Refusal);
	strictEqual(g_vecActions.length, unActionsBeforeConsoleRefusal);
	strictEqual(g_mapMenus.size, unMenusBeforeConsoleRefusal);

	strictEqual(Chat(2, "/searchcmd", `sjs_${strName}`), 1);
	match(g_vecReplies.at(-2)[1], new RegExp(`\\[001\\] sjs_${strName}\\b`));
}

strictEqual(RunServerCommand("searchcmd", "sjs_cookies"), 1);
match(g_vecReplies.at(-1)[1], /\[001\] sjs_cookies/);
strictEqual(RunServerCommand("cookies"), 1);
match(g_vecReplies.at(-1)[1], /Available cookies/);
strictEqual(RunServerCommand("searchcmd", "sjs_sql_reload"), 1);
match(g_vecReplies.at(-1)[1], /\[001\] sjs_sql_reload/);
strictEqual(Chat(2, "/searchcmd", "sjs_sql_reload"), 1);
match(g_vecReplies.at(-2)[1], /No matching commands/);

g_bUserMessageReplies = false;
strictEqual(g_mapClientCommands.get("sjs_slay")({ Index: 2, Arguments: ["sjs_slay", "#101"] }), 1);

for (const strCommand of ["freeze", "freezebomb", "firebomb", "timebomb", "burn", "drug"]) {
	strictEqual(Chat(2, `/${strCommand}`, "#103"), 1);
	match(g_vecReplies.at(-1)[1], /do not have permission/);
}

strictEqual(g_Peer.MovementType, 2);
g_bUserMessageReplies = true;
strictEqual(Chat(2, "/ban", "#101", "10"), 1);
deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] You do not have permission to use this command."]);
strictEqual(g_mapClientCommands.get("sjs_slay")({ Index: 2, Arguments: ["sjs_slay", "#101"] }), 1);
deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] You do not have permission to use this command.\n"]);
g_bUserMessageReplies = false;
strictEqual(g_vecActions.length, 0);

const g_unActionsBeforeRcon = g_vecActions.length;
strictEqual(Chat(2, "/rcon", "echo", "denied"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);

g_mapPermissions.set(2, new Set(["sourcejs.rcon"]));
strictEqual(Chat(2, "/rcon"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_rcon/);
strictEqual(Chat(2, "/rcon", "echo", "one;two"), 1);
match(g_vecReplies.at(-1)[1], /without control characters/);
strictEqual(g_vecActions.length, g_unActionsBeforeRcon);

g_setRejectedEngineCommands.add('echo "fixture rejected"');
strictEqual(Chat(2, "/rcon", "echo", '"fixture rejected"'), 1);
match(g_vecReplies.at(-1)[1], /engine did not accept/);
g_setRejectedEngineCommands.delete('echo "fixture rejected"');
strictEqual(Chat(2, "/rcon", "echo", '"fixture accepted"'), 1);
deepStrictEqual(g_vecActions.at(-1), ["engine", 'echo "fixture accepted"']);
match(g_vecReplies.at(-1)[1], /Console command submitted/);
g_mapPermissions.delete(2);

g_mapConVars.set("mp_friendlyfire", { Exists: true, Value: "1" });
strictEqual(Chat(2, "/ff"), 1);
match(g_vecReplies.at(-1)[1], /Friendly fire is enabled/);

g_bUserMessageReplies = true;
const g_ClockFormat = g_mapConVars.get("sjs_datetime_format");
const g_ClockOffset = g_mapConVars.get("sjs_time_adjustment");
strictEqual(g_ClockFormat.Value, "%m/%d/%Y - %H:%M:%S");
strictEqual(g_ClockOffset.Value, "0");
const g_ReadOriginalClock = runInContext("Date.now", g_Context);
try {
	g_Context.Date = class FixtureDate extends Date {
		static now() {
			return new Date(2025, 11, 31, 23, 59, 58).getTime();
		}
	};
	strictEqual(Chat(2, "thetime"), 0);
	deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] Server time: 12/31/2025 - 23:59:58"]);

	g_ClockOffset.Value = "3";
	g_ClockFormat.Value = "%F %I:%M:%S %p %%";
	strictEqual(Chat(2, "/thetime"), 1);
	deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] Server time: 2026-01-01 12:00:01 AM %"]);

	g_ClockOffset.Value = "-59";
	g_ClockFormat.Value = "%F %T";
	strictEqual(RunServerCommand("thetime"), 1);
	match(g_vecReplies.at(-1)[1], /2025-12-31 23:58:59/);

	g_ClockFormat.Value = "%q";
	strictEqual(Chat(2, "/thetime"), 1);
	match(g_vecReplies.at(-1)[1], /Unsupported time format token: %q/);
} finally {
	delete g_Context.Date;
	g_ClockFormat.Value = "%m/%d/%Y - %H:%M:%S";
	g_ClockOffset.Value = "0";
}

strictEqual(runInContext("Date.now", g_Context), g_ReadOriginalClock);

strictEqual(Chat(2, "CuRrEnTmAp"), 0);
deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] Current map: map_one."]);
const g_unBeforeOrdinaryChat = g_vecReplies.length;
strictEqual(Chat(2, "currentmap please"), 0);
strictEqual(Chat(2, "slap"), 0);
strictEqual(g_vecReplies.length, g_unBeforeOrdinaryChat);

g_mapConVars.get("sjs_trigger_show").Value = "1";
strictEqual(Chat(2, "ff"), 0);
deepStrictEqual(g_vecReplies.slice(-3).map(([unIndex]) => unIndex), [1, 2, 3]);
const g_unBeforePrivateFriendlyFire = g_vecReplies.length;
strictEqual(Chat(2, "/ff"), 1);
deepStrictEqual(g_vecReplies.slice(g_unBeforePrivateFriendlyFire), [[2, "[SourceJS] Friendly fire is enabled."]]);
g_mapConVars.get("sjs_trigger_show").Value = "0";
g_mapConVars.delete("mp_friendlyfire");
g_mapConVars.set("z_difficulty", { Exists: true, Value: "Impossible" });
g_mapConVars.set("survivor_friendly_fire_factor_expert", { Exists: true, Value: "0.5" });
strictEqual(Chat(2, "ff"), 0);
match(g_vecReplies.at(-1)[1], /Survivor friendly-fire damage: 50%/);
g_mapConVars.delete("z_difficulty");
g_mapConVars.delete("survivor_friendly_fire_factor_expert");
g_mapConVars.set("mp_friendlyfire", { Exists: true, Value: "1" });
g_bUserMessageReplies = false;

strictEqual(Chat(2, "/motd"), 1);
deepStrictEqual(g_vecActions.at(-1), ["panel", 2, "info", "motd", "Message of the Day"]);
strictEqual(Chat(2, "motd"), 0);
deepStrictEqual(g_vecActions.at(-1), ["panel", 2, "info", "motd", "Message of the Day"]);

const g_ChatBot = AddPlayer(4, 904, "Chat bot");
g_ChatBot.FakeClient = true;
const g_DisconnectedChatPlayer = AddPlayer(5, 905, "Disconnected");
g_DisconnectedChatPlayer.Connected = false;
const g_ShowActivity = g_mapConVars.get("sjs_show_activity");
strictEqual(g_ShowActivity.Value, "13");
g_mapPermissions.set(3, new Set(["sourcejs.admin"]));
const g_unBeforeDefaultAttribution = g_vecChatDeliveries.length;
strictEqual(Chat(1, "@ Visible by role"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeDefaultAttribution), [
	[[1, 3], "[SourceJS] Operator: Visible by role"],
	[[2], "[SourceJS] Admin: Visible by role"],
]);

const g_unBeforeDefaultCenter = g_vecActions.length;
strictEqual(Chat(1, "@@@ Center"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeDefaultCenter), [
	["center", [1, 3], "Operator: Center"],
	["center", [2], "Admin: Center"],
]);

g_ShowActivity.Value = "16";
g_mapPermissions.set(2, new Set(["sourcejs.activity.seenames"]));
const g_unBeforeOverrideAttribution = g_vecActions.length;
strictEqual(Chat(1, "/dsay", "Override"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeOverrideAttribution).map((Action) => Action.slice(0, 3)), [
	["hud", [1, 2], "Operator: Override"],
	["hud", [3], "Admin: Override"],
]);
g_mapPermissions.delete(2);
g_mapPermissions.delete(3);

g_ShowActivity.Value = "7";
g_mapPermissions.set(3, new Set(["sourcejs.chat"]));
const g_unBeforePublicAttribution = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/say", "Public names"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforePublicAttribution), [
	[[1, 2], "[SourceJS] Operator: Public names"],
	[[3], "[SourceJS] Admin: Public names"],
]);
g_mapPermissions.delete(3);

g_ShowActivity.Value = "2";
const g_unBeforeAnonymous = g_vecActions.length;
strictEqual(Chat(1, "/hsay", "Hint"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeAnonymous), [
	["hint", [1], "Operator: Hint"],
	["hint", [2, 3], "Admin: Hint"],
]);

strictEqual(Chat(1, "/msay", "Panel"), 1);
strictEqual(RenderMenuText(g_mapMenus.get(1).Options.Title), "Operator:");
strictEqual(g_mapMenus.get(2), g_mapMenus.get(1));
strictEqual(g_mapMenus.get(3), g_mapMenus.get(1));
g_mapListeners.get("level-end")();
strictEqual(g_mapMenus.size, 0);

g_ShowActivity.Value = "15";
strictEqual(Chat(1, "/dsay", "Watch", "the", "HUD"), 1);
const g_HUDAnnouncement = g_vecActions.at(-1);
deepStrictEqual(g_HUDAnnouncement.slice(0, 3), ["hud", [1, 2, 3], "Operator: Watch the HUD"]);
deepStrictEqual({ ...g_HUDAnnouncement[3], PrimaryColor: { ...g_HUDAnnouncement[3].PrimaryColor } }, { X: -1, Y: 0.25, HoldTime: 3, PrimaryColor: { Red: 0, Green: 255, Blue: 127, Alpha: 255 }, Effect: 1 });

const g_unActionsBeforeMissingHUD = g_vecActions.length;
g_bHasHudMsg = false;
strictEqual(Chat(1, "/dsay", "Missing"), 1);
match(g_vecReplies.at(-1)[1], /does not expose HudMsg/);
strictEqual(g_vecActions.length, g_unActionsBeforeMissingHUD);
g_bHasHudMsg = true;

const g_unActionsBeforeMissingHint = g_vecActions.length;
g_bHasHintText = false;
strictEqual(Chat(1, "/hsay", "Missing"), 1);
match(g_vecReplies.at(-1)[1], /does not expose HintText/);
strictEqual(g_vecActions.length, g_unActionsBeforeMissingHint);
g_bHasHintText = true;

strictEqual(Chat(1, "/tsay", "LIGHTBLUE", "Alert"), 1);
const g_Notification = g_vecActions.at(-1);
deepStrictEqual(g_Notification.slice(0, 3), ["notification", [1, 2, 3], "Operator: Alert"]);
deepStrictEqual({ ...g_Notification[3].Color }, { Red: 0, Green: 128, Blue: 255, Alpha: 255 });
strictEqual(g_Notification[3].Time, 10);

strictEqual(Chat(1, "/tsay", "Unrecognized", "word"), 1);
strictEqual(g_vecActions.at(-1)[2], "Operator: Unrecognized word");
deepStrictEqual({ ...g_vecActions.at(-1)[3].Color }, { Red: 255, Green: 255, Blue: 255, Alpha: 255 });

const g_unDeliveriesBeforePrivate = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/psay", "#102", "Private", "notice"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unDeliveriesBeforePrivate), [[[2, 1], "[Private to Test Player] Operator: Private notice"]]);
strictEqual(Chat(1, "/psay", "@me", "Only", "me"), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[1], "[Private to Operator] Operator: Only me"]);

g_ShowActivity.Value = "0";
strictEqual(Chat(1, "/psay", "#102", "Still attributed"), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[2, 1], "[Private to Test Player] Operator: Still attributed"]);
strictEqual(Chat(1, "/chat", "Staff names remain visible"), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[1], "[Admins] Operator: Staff names remain visible"]);

const g_unBeforeConsoleAnnouncement = g_vecChatDeliveries.length;
strictEqual(RunServerCommand("say", "Console notice"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeConsoleAnnouncement), [[[1, 2, 3], "[SourceJS] Console: Console notice"]]);

g_ShowActivity.Value = "15";
const g_unDeliveriesBeforeDeniedPrivate = g_vecChatDeliveries.length;
strictEqual(Chat(2, "/psay", "#103", "Denied"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(Chat(1, "/psay", "#904", "No", "bots"), 1);
match(g_vecReplies.at(-1)[1], /connected human player/);
strictEqual(g_vecChatDeliveries.length, g_unDeliveriesBeforeDeniedPrivate);

strictEqual(Chat(1, "@ Server announcement"), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[1, 2, 3], "[SourceJS] Operator: Server announcement"]);
strictEqual(Chat(1, '@@"Test Player" Confidential notice'), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[2, 1], "[Private to Test Player] Operator: Confidential notice"]);
strictEqual(Chat(1, "@@@ Round starts"), 1);
deepStrictEqual(g_vecActions.at(-1), ["center", [1, 2, 3], "Operator: Round starts"]);

const g_unBeforeDeniedShortcut = g_vecChatDeliveries.length;
strictEqual(Chat(1, "@@Unknown secret text"), 1);
match(g_vecReplies.at(-1)[1], /No matching player/);
strictEqual(Chat(2, "@@#103 private text"), 1);
match(g_vecReplies.at(-1)[1], /require sourcejs\.chat/);
strictEqual(Chat(2, "@ not an admin announcement"), 0);
strictEqual(g_vecChatDeliveries.length, g_unBeforeDeniedShortcut);

strictEqual(g_ChatFilter({ Index: 2, Arguments: ["@ Assistance requested"], TeamOnly: true }), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[1, 2], "[To admins] Test Player: Assistance requested"]);

g_mapConVars.get("sjs_chat_mode").Value = "0";
const g_unBeforeDisabledAdminChat = g_vecChatDeliveries.length;
strictEqual(g_ChatFilter({ Index: 2, Arguments: ["@ Do not leak"], TeamOnly: true }), 1);
match(g_vecReplies.at(-1)[1], /disabled/);
strictEqual(g_vecChatDeliveries.length, g_unBeforeDisabledAdminChat);
strictEqual(g_ChatFilter({ Index: 1, Arguments: ["@ Staff only"], TeamOnly: true }), 1);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[1], "[Admins] Operator: Staff only"]);
g_mapConVars.get("sjs_chat_mode").Value = "1";

strictEqual(Chat(1, "/gag", "#102"), 1);
const g_unBeforeGaggedShortcut = g_vecChatDeliveries.length;
strictEqual(g_ChatFilter({ Index: 2, Arguments: ["@ Gagged"], TeamOnly: true }), 1);
strictEqual(g_vecChatDeliveries.length, g_unBeforeGaggedShortcut);
strictEqual(Chat(1, "/ungag", "#102"), 1);

const g_unExpectedAnnouncementDurationSeconds = 10;
strictEqual(Chat(1, "/msay", "Line\\nTwo"), 1);
const g_AnnouncementMenu = g_mapMenus.get(1);
strictEqual(g_AnnouncementMenu.constructor, SimpleRadioMenu);
strictEqual(g_AnnouncementMenu.Options.Description, "Line\nTwo");
strictEqual(g_AnnouncementMenu.Options.Timeout, g_unExpectedAnnouncementDurationSeconds);
deepStrictEqual([...g_mapMenus.keys()], [1, 2, 3]);
const g_AnnouncementDelay = g_vecDelayed.at(-1);
strictEqual(g_AnnouncementDelay.Seconds, g_unExpectedAnnouncementDurationSeconds);
g_AnnouncementDelay.Callback();
strictEqual(g_mapMenus.size, 0);

strictEqual(Chat(2, "/msay", "Denied"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(g_mapMenus.size, 0);

g_setRejectedMenuRecipients.add(1);
g_setFailingMenuRecipients.add(2);

try {
	strictEqual(Chat(1, "/msay", "Partial delivery"), 1);
	match(g_vecReplies.at(-1)[1], /Opened the announcement panel for 1 of 3/);
	deepStrictEqual([...g_mapMenus.keys()], [3]);
	const PartialAnnouncementDelay = g_vecDelayed.at(-1);
	PartialAnnouncementDelay.Callback();
	strictEqual(g_mapMenus.size, 0);

	g_setRejectedMenuRecipients.add(3);
	strictEqual(Chat(1, "/msay", "Undelivered"), 1);
	match(g_vecReplies.at(-1)[1], /could not display the announcement panel/);
	strictEqual(g_mapMenus.size, 0);
	strictEqual(g_vecDelayed.at(-1), PartialAnnouncementDelay);
} finally {
	g_setRejectedMenuRecipients.clear();
	g_setFailingMenuRecipients.clear();
}

g_bHasShowMenu = false;
strictEqual(Chat(1, "/msay", "Fallback"), 1);
const g_FallbackAnnouncement = g_mapMenus.get(1);
strictEqual(g_FallbackAnnouncement.constructor, SimpleESCMenu);
strictEqual(RenderMenuText(g_FallbackAnnouncement.Options.CloseText), "Dismiss");
strictEqual(g_FallbackAnnouncement.UseTextDialogFallback, false);
const g_FallbackAnnouncementDelay = g_vecDelayed.at(-1);
g_mapListeners.get("level-end")();
strictEqual(g_FallbackAnnouncementDelay.Callback, null);
strictEqual(g_mapMenus.size, 0);
g_bHasShowMenu = true;
g_mapPlayers.delete(4);
g_mapPlayers.delete(5);

const g_unBeforeSlapActivity = g_vecChatMessages.length;
strictEqual(Chat(1, "/slap", "#102", "9"), 1);
strictEqual(g_Target.Health, 91);
deepStrictEqual(g_vecActions.at(-1), ["ambient", 2, "player/damage1.wav", 2]);
match(g_vecChatMessages.slice(g_unBeforeSlapActivity).join("\n"), /Slapped Test Player\./);

const g_unBeforeSlayActivity = g_vecChatMessages.length;
strictEqual(Chat(1, "!slay", "#102"), 0);
deepStrictEqual(g_vecActions.slice(-3), [["push", 102], ["ambient", 2, "player/damage1.wav", 2], ["slay", 102]]);
match(g_vecChatMessages.slice(g_unBeforeSlayActivity).join("\n"), /Slay submitted for Test Player\./);

strictEqual(Chat(1, "/slay", "#102"), 1);
match(g_vecReplies.at(-1)[1], /No matching player/);
g_Target.Dead = false;
strictEqual(Chat(1, "/slay", "Test"), 1);
match(g_vecReplies.at(-1)[1], /Ambiguous/);

const g_nHealthBeforeUnavailableSlap = g_Target.Health;
const g_OriginalAddVelocity = g_Target.AddVelocity;
g_Target.AddVelocity = () => false;
const g_unActionsBeforeUnavailableSlap = g_vecActions.length;
strictEqual(Chat(1, "/slap", "#102", "5"), 1);
match(g_vecReplies.at(-1)[1], /Could not slap/);
strictEqual(g_Target.Health, g_nHealthBeforeUnavailableSlap);
strictEqual(g_vecActions.length, g_unActionsBeforeUnavailableSlap);
g_Target.AddVelocity = g_OriginalAddVelocity;

g_Target.Frags = 7;
strictEqual(Chat(1, "/slap", "#102", String(g_Target.Health)), 1);
strictEqual(g_Target.Dead, true);
strictEqual(g_Target.Frags, 7);
deepStrictEqual(g_vecActions.at(-1), ["restore-frags", 102, 7]);

const g_ReusedSlapSlot = AddPlayer(7, 108, "Reused slap slot");
g_ReusedSlapSlot.Frags = 12;
g_ReusedSlapSlot.Slay = () => {
	g_ReusedSlapSlot.UserID = 109;
	g_ReusedSlapSlot.Frags = 4;

	return true;
};
const g_unActionsBeforeReusedSlap = g_vecActions.length;
strictEqual(Chat(1, "/slap", "#108", "100"), 1);
strictEqual(g_ReusedSlapSlot.Frags, 4);
strictEqual(g_vecActions.slice(g_unActionsBeforeReusedSlap).some((Action) => Action[0] === "restore-frags"), false);
g_mapPlayers.delete(7);
g_Target.Frags = 0;

const g_RejectingActionBot = AddPlayer(4, 904, "Rejecting action bot");
const g_SucceedingActionBot = AddPlayer(5, 905, "Succeeding action bot");
g_RejectingActionBot.FakeClient = true;
g_SucceedingActionBot.FakeClient = true;
g_RejectingActionBot.Slay = () => false;
g_RejectingActionBot.SetEntityPropertyInteger = () => true;
const g_unBeforeRefusedActionActivity = g_vecChatMessages.length;
strictEqual(Chat(1, "/slay", "#904"), 1);
match(g_vecReplies.at(-1)[1], /Could not slay/);
strictEqual(Chat(1, "/slap", "#904", "5"), 1);
match(g_vecReplies.at(-1)[1], /Could not slap/);
strictEqual(g_RejectingActionBot.Dead, false);
strictEqual(g_RejectingActionBot.Health, 100);
strictEqual(g_vecChatMessages.length, g_unBeforeRefusedActionActivity);

g_RejectingActionBot.SetEntityPropertyInteger = () => {
	throw new Error("Damage failed.");
};
strictEqual(Chat(1, "/slap", "@bots", "5"), 1);
match(g_vecReplies.at(-1)[1], /Slapped 1 of 2/);
strictEqual(g_SucceedingActionBot.Health, 95);

g_RejectingActionBot.Slay = () => {
	throw new Error("Slay failed.");
};
strictEqual(Chat(1, "/slay", "@bots"), 1);
match(g_vecReplies.at(-1)[1], /Slay submitted for 1 of 2/);
strictEqual(g_SucceedingActionBot.Dead, true);
strictEqual(g_RejectingActionBot.Dead, false);
g_mapPlayers.delete(4);
g_mapPlayers.delete(5);

const g_RenameBot = AddPlayer(4, 904, "SingleCharacter");
g_RenameBot.FakeClient = true;
const g_OtherRenameBot = AddPlayer(5, 905, "Other bot");
g_OtherRenameBot.FakeClient = true;
g_OtherRenameBot.Dead = true;
const g_unBeforeRenameActivity = g_vecChatMessages.length;
strictEqual(Chat(1, "/rename", "@bots", '"New name"'), 1);
deepStrictEqual(g_vecActions.slice(-2), [["rename", 904, "New name 1"], ["rename", 905, "New name 2"]]);
match(g_vecReplies.at(-1)[1], /Renamed 2 of 2/);
match(g_vecChatMessages.slice(g_unBeforeRenameActivity).join("\n"), /Renamed 2 players\./);

g_RenameBot.Name = "ЖЖ";
const g_unBeforeUnchangedRename = g_vecActions.length;
const g_unBeforeUnchangedRenameActivity = g_vecChatMessages.length;
strictEqual(Chat(1, "/rename", "#904"), 1);
match(g_vecReplies.at(-1)[1], /No name changes were needed/);
strictEqual(Chat(1, "/rename", "#904", "ЖЖ"), 1);
match(g_vecReplies.at(-1)[1], /No name changes were needed/);
strictEqual(g_vecActions.length, g_unBeforeUnchangedRename);
strictEqual(g_vecChatMessages.length, g_unBeforeUnchangedRenameActivity);

const g_unBeforeDeniedRename = g_vecActions.length;
strictEqual(Chat(2, "/rename", "#904", "Denied"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
strictEqual(Chat(1, "/rename", "#103", "Denied"), 1);
match(g_vecReplies.at(-1)[1], /immune/);
g_mapPermissions.delete(3);

g_OtherRenameBot.SetName = () => false;
strictEqual(Chat(1, "/rename", "#905", "Unavailable"), 1);
match(g_vecReplies.at(-1)[1], /No player was renamed/);
strictEqual(g_OtherRenameBot.Name, "New name 2");
strictEqual(g_vecActions.length, g_unBeforeDeniedRename);
g_RenameBot.SetName = () => true;
strictEqual(Chat(1, "/rename", "#904", "Not applied"), 1);
match(g_vecReplies.at(-1)[1], /No player was renamed/);

const g_ReplacementRenameBot = AddPlayer(6, 906, "Replacement test");
g_ReplacementRenameBot.FakeClient = true;
g_RenameBot.SetName = () => {
	AddPlayer(4, 909, "New occupant");

	return true;
};
strictEqual(Chat(1, "/rename", "@bots", "Partial"), 1);
deepStrictEqual(g_vecActions.at(-1), ["rename", 906, "Partial 3"]);
match(g_vecReplies.at(-1)[1], /Renamed 1 of 3/);
strictEqual(g_mapPlayers.get(4).Name, "New occupant");
g_mapPlayers.delete(4);
g_mapPlayers.delete(5);
g_mapPlayers.delete(6);

strictEqual(Chat(1, "/burn", "#103", "4"), 1);
deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, 4]);
strictEqual(Chat(1, "/burn", "#103", "0.5"), 1);
deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, 0.5]);
g_mapConVars.get("sjs_burn_duration").Value = "12.5";
strictEqual(Chat(1, "/burn", "#103"), 1);
deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, 12.5]);

const g_unIgnitionsBeforeInvalidDuration = g_vecActions.filter((Action) => Action[0] === "ignite").length;
strictEqual(Chat(1, "/burn", "#103", "Infinity"), 1);
strictEqual(g_vecActions.filter((Action) => Action[0] === "ignite").length, g_unIgnitionsBeforeInvalidDuration);
strictEqual(Chat(2, "/burn", "#103", "4"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
g_Peer.Dead = true;
strictEqual(Chat(1, "/burn", "#103", "4"), 1);
match(g_vecReplies.at(-1)[1], /No matching player/);
g_Peer.Dead = false;
strictEqual(g_vecActions.filter((Action) => Action[0] === "ignite").length, g_unIgnitionsBeforeInvalidDuration);

const g_RefusingBurnTarget = AddPlayer(4, 904, "Refusing burn target");
const g_AvailableBurnTarget = AddPlayer(5, 905, "Available burn target");
g_RefusingBurnTarget.FakeClient = true;
g_AvailableBurnTarget.FakeClient = true;
g_RefusingBurnTarget.Ignite = () => {
	throw new Error("Ignition failed.");
};

try {
	const unBeforePartialBurn = g_vecActions.length;
	strictEqual(Chat(1, "/burn", "@bots", "5", "extra"), 1);
	match(g_vecReplies.at(-1)[1], /Usage: sjs_burn/);
	strictEqual(g_vecActions.length, unBeforePartialBurn);

	strictEqual(Chat(1, "/burn", "@bots", "2.5"), 1);
	deepStrictEqual(g_vecActions.slice(unBeforePartialBurn), [["ignite", 905, 2.5]]);
	match(g_vecReplies.at(-1)[1], /Burn submitted for 1 of 2/);
} finally {
	g_mapPlayers.delete(4);
	g_mapPlayers.delete(5);
}

const g_unExpectedBlindFadeMask = 0x0A;
const g_unExpectedClearBlindFadeMask = 0x11;
const g_unExpectedBlindFadeSeconds = 3;
strictEqual(Chat(1, "/blind", "#103", "150"), 1);
deepStrictEqual(g_vecActions.at(-1), ["fade", 3, 150, g_unExpectedBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds]);
strictEqual(Chat(1, "/blind", "#103"), 1);
deepStrictEqual(g_vecActions.at(-1), ["fade", 3, 0, g_unExpectedClearBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds]);
const g_unActionsBeforeDeniedBlind = g_vecActions.length;
strictEqual(Chat(2, "/blind", "#103", "255"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
g_bHasFade = false;
strictEqual(Chat(1, "/blind", "#103", "255"), 1);
match(g_vecReplies.at(-1)[1], /does not support the Fade user message/);
g_bHasFade = true;
strictEqual(g_vecActions.length, g_unActionsBeforeDeniedBlind);

const g_BlindRejectedPlayer = AddPlayer(4, 904, "Rejected fade");
const g_BlindThrowingPlayer = AddPlayer(5, 905, "Throwing fade");

try {
	g_InspectFadeSend = (unIndex) => {
		if (unIndex === g_BlindThrowingPlayer.Index) {
			throw new Error("Fade send failed.");
		}

		return unIndex !== g_BlindRejectedPlayer.Index;
	};
	const unBeforePartialBlind = g_vecActions.length;
	strictEqual(Chat(1, "/blind", "@humans", "999"), 1);
	deepStrictEqual(g_vecActions.slice(unBeforePartialBlind).filter((Action) => Action[0] === "fade"), [1, 3, 4, 5].map((unIndex) => ["fade", unIndex, 255, g_unExpectedBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds]));
	match(g_vecReplies.at(-1)[1], /Screen fade submitted for 2 of 4/);

	g_InspectFadeSend = (unIndex) => {
		if (unIndex === 1) {
			AddPlayer(4, 906, "Replacement fade target");
			g_mapPermissions.set(5, new Set(["sourcejs.immunity"]));
		}

		return true;
	};
	const unBeforeStaleBlind = g_vecActions.length;
	strictEqual(Chat(1, "/blind", "@humans", "-5"), 1);
	deepStrictEqual(g_vecActions.slice(unBeforeStaleBlind).filter((Action) => Action[0] === "fade"), [1, 3].map((unIndex) => ["fade", unIndex, 0, g_unExpectedClearBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds]));
	match(g_vecReplies.at(-1)[1], /Screen fade submitted for 2 of 4/);
} finally {
	g_InspectFadeSend = null;
	g_mapPlayers.delete(4);
	g_mapPlayers.delete(5);
	g_mapPermissions.delete(5);
}

const g_BeaconBot = AddPlayer(4, 604, "Beacon bot");
g_BeaconBot.FakeClient = true;
const g_DisconnectedBeaconRecipient = AddPlayer(5, 605, "Disconnected spectator");
g_DisconnectedBeaconRecipient.Connected = false;
const g_unBeforeDeniedBeacon = g_vecActions.length;
const g_unBeforeBeaconNotices = g_vecChatDeliveries.length;
strictEqual(Chat(2, "/beacon", "#103"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(Chat(1, "/beacon", "#103", "375"), 1);
match(g_vecReplies.at(-1)[1], /sjs_beacon_radius/);
strictEqual(Chat(1, "/beacon", "#103", "1", "375"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_beacon/);
strictEqual(g_vecActions.length, g_unBeforeDeniedBeacon);
strictEqual(g_vecChatDeliveries.length, g_unBeforeBeaconNotices);

const g_strBeaconActivityBefore = g_ShowActivity.Value;
g_ShowActivity.Value = "15";
strictEqual(Chat(1, "/beacon", "#103"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeBeaconNotices), [[[2, 3], "[SourceJS] Operator: beacon: started 1, cancelled 0."]]);
const g_BeaconTask = g_vecRepeatingTasks.at(-1);
deepStrictEqual(g_vecActions.at(-1), ["repeat-start", 1]);
g_Peer.ViewOffset = { X: 0, Y: 0, Z: 64 };
g_BeaconTask.Callback();
const [g_vecOuterRing, g_vecInnerRing, g_vecBlip, g_vecBeaconAudio] = g_vecActions.slice(-4);
deepStrictEqual(g_vecOuterRing.slice(0, 2), ["temporary-entity", "BeamRingPoint"]);
strictEqual(g_vecOuterRing[2].StartRadius, 10);
strictEqual(g_vecOuterRing[2].EndRadius, 375);
strictEqual(g_vecOuterRing[2].Center.Z, 10);
strictEqual(g_vecOuterRing[2].Model, 1);
strictEqual(g_vecOuterRing[2].Halo, 2);
deepStrictEqual(g_vecOuterRing[3], [1, 2, 3, 4]);
deepStrictEqual(g_vecInnerRing[3], [1, 2, 3, 4]);
strictEqual(g_vecInnerRing[2].Color.Blue, 255);
strictEqual(g_vecInnerRing[2].LifeTime, 0.6);
deepStrictEqual(g_vecBlip, ["ambient", 3, "buttons/blip1.wav", 3]);
deepStrictEqual(g_vecBeaconAudio, ["beacon-audio", 64, 1, 140, 0, 100]);

g_mapConVars.get("sjs_beacon_radius").Value = "450";
g_Peer.Team = 3;
g_BeaconTask.Callback();
strictEqual(g_vecActions.at(-3)[2].Color.Red, 255);
strictEqual(g_vecActions.at(-3)[2].Color.Blue, 75);
strictEqual(g_vecActions.at(-3)[2].EndRadius, 450);

g_Peer.Team = 0;
g_BeaconTask.Callback();
strictEqual(g_vecActions.at(-3)[2].Color.Red, 90);
strictEqual(g_vecActions.at(-3)[2].Color.Blue, 92);

g_mapConVars.get("sjs_beacon_radius").Value = "375";
delete g_Peer.ViewOffset;
g_Peer.Team = 2;
strictEqual(Chat(1, "/beacon", "#103", "1"), 1);
strictEqual(g_vecRepeatingTasks.at(-1), g_BeaconTask);
strictEqual(g_vecChatDeliveries.length, g_unBeforeBeaconNotices + 1);
strictEqual(Chat(1, "/beacon", "#103", "0"), 1);
deepStrictEqual(g_vecActions.at(-1), ["repeat-stop"]);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[2, 3], "[SourceJS] Operator: beacon: started 0, cancelled 1."]);

g_ShowActivity.Value = "0";
const g_unBeforeSilentBeacon = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/beacon", "#103"), 1);
const g_DeathBeacon = g_vecRepeatingTasks.at(-1);
strictEqual(g_vecChatDeliveries.length, g_unBeforeSilentBeacon);
g_ShowActivity.Value = g_strBeaconActivityBefore;
g_Peer.Dead = true;
const g_unActionsBeforeBeaconDeath = g_vecActions.length;
g_DeathBeacon.Callback();
strictEqual(g_DeathBeacon.Callback, null);
deepStrictEqual(g_vecActions.slice(g_unActionsBeforeBeaconDeath), [["repeat-stop"]]);
strictEqual(Chat(1, "/beacon", "#103", "1"), 1);
match(g_vecReplies.at(-1)[1], /No matching player/);
g_Peer.Dead = false;

strictEqual(Chat(1, "/beacon", "#103"), 1);
const g_ReusedSlotBeacon = g_vecRepeatingTasks.at(-1);
const g_DrawOldBeacon = g_ReusedSlotBeacon.Callback;
g_Peer.UserID = 203;
const g_unActionsBeforeBeaconSlotReuse = g_vecActions.length;
strictEqual(Chat(1, "/beacon", "#203"), 1);
const g_ReplacementBeacon = g_vecRepeatingTasks.at(-1);
g_DrawOldBeacon();
strictEqual(g_ReusedSlotBeacon.Callback, null);
strictEqual(typeof g_ReplacementBeacon.Callback, "function");
deepStrictEqual(g_vecActions.slice(g_unActionsBeforeBeaconSlotReuse), [["repeat-stop"], ["repeat-start", 1]]);
g_ReplacementBeacon.Callback();
deepStrictEqual(g_vecActions.at(-2), ["ambient", 3, "buttons/blip1.wav", 3]);
strictEqual(Chat(1, "/beacon", "#203", "0"), 1);
strictEqual(g_ReplacementBeacon.Callback, null);
g_Peer.UserID = 103;
g_mapPlayers.delete(4);
g_mapPlayers.delete(5);
g_mapListeners.get("level-end")();

g_bBlipMenuSoundMissing = true;

try {
	strictEqual(Chat(1, "/beacon", "#103", "1"), 1);
	g_vecRepeatingTasks.at(-1).Callback();
	deepStrictEqual(g_vecActions.at(-1), ["ambient", 3, "buttons/button14.wav", 3]);
	strictEqual(Chat(1, "/beacon", "#103", "0"), 1);
} finally {
	g_bBlipMenuSoundMissing = false;
	g_mapListeners.get("level-end")();
}

strictEqual(Chat(1, "/noclip", "#103"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs\.cheats/);
strictEqual(g_Peer.MovementType, 2);
g_mapPermissions.get(1).add("sourcejs.cheats");
strictEqual(Chat(1, "/noclip", "#103"), 1);
strictEqual(g_Peer.MovementType, 8);

g_mapConVars.get("sjs_freeze_duration").Value = "5";
const g_unActionsBeforeFreeze = g_vecActions.length;
strictEqual(Chat(1, "/freeze", "#103"), 1);
strictEqual(g_Peer.MovementType, 0);
strictEqual(g_Peer.RenderColor.Alpha, 192);
const g_FreezeTask = g_vecRepeatingTasks.at(-1);
const g_unExpectedFreezeTicksBeforeThaw = 4;
for (let unTick = 0; unTick < g_unExpectedFreezeTicksBeforeThaw; ++unTick) {
	g_FreezeTask.Callback();
	strictEqual(g_Peer.MovementType, 0);
	strictEqual(g_Peer.RenderColor.Alpha, 135);
}

g_FreezeTask.Callback();
strictEqual(g_FreezeTask.Callback, null);
strictEqual(g_Peer.MovementType, 8);
deepStrictEqual({ ...g_Peer.RenderColor }, { Red: 9, Green: 8, Blue: 7, Alpha: 255 });
const g_vecFreezeActions = g_vecActions.slice(g_unActionsBeforeFreeze);
deepStrictEqual(g_vecFreezeActions.filter((Action) => Action[0] === "hint"), [
	["hint", [3], "Unfrozen in 5s."],
	["hint", [3], "Unfrozen in 4s."],
	["hint", [3], "Unfrozen in 3s."],
	["hint", [3], "Unfrozen in 2s."],
	["hint", [3], "Unfrozen in 1s."],
	["hint", [3], "You are no longer frozen."],
]);
strictEqual(g_vecFreezeActions.filter((Action) => Action[1] === "GlowSprite").length, g_unExpectedFreezeTicksBeforeThaw);
deepStrictEqual(g_vecFreezeActions.filter((Action) => Action[0] === "ambient").map((Action) => Action[2]), Array(2).fill("physics/glass/glass_impact_bullet4.wav"));

strictEqual(Chat(1, "/freeze", "#103"), 1);
const g_ToggledFreezeTask = g_vecRepeatingTasks.at(-1);
strictEqual(g_Peer.MovementType, 0);
strictEqual(Chat(2, "/freeze", "#103"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(g_Peer.MovementType, 0);
strictEqual(Chat(1, "/freeze", "#103"), 1);
strictEqual(g_ToggledFreezeTask.Callback, null);
strictEqual(g_Peer.MovementType, 8);
deepStrictEqual({ ...g_Peer.RenderColor }, { Red: 9, Green: 8, Blue: 7, Alpha: 255 });
match(g_vecReplies.at(-1)[1], /Freeze updated for 1 of 1/);

const g_unBeforeRejectedFreeze = g_vecActions.length;
const g_unBeforeRejectedFreezeActivity = g_vecChatDeliveries.length;
const g_ColorBeforeRejectedFreeze = { ...g_Peer.RenderColor };
try {
	g_InspectMovementWrite = () => true;
	strictEqual(Chat(1, "/freeze", "#103", "1"), 1);
	match(g_vecReplies.at(-1)[1], /Could not update freeze/);
	strictEqual(g_Peer.MovementType, 8);
	strictEqual(g_vecRepeatingTasks.at(-1).Callback, null);
	deepStrictEqual({ ...g_Peer.RenderColor }, g_ColorBeforeRejectedFreeze);
	deepStrictEqual(g_vecActions.slice(g_unBeforeRejectedFreeze), [["repeat-start", 1], ["repeat-stop"]]);
	strictEqual(g_vecChatDeliveries.length, g_unBeforeRejectedFreezeActivity);

	g_InspectMovementWrite = null;
	strictEqual(Chat(1, "/freeze", "#103", "1"), 1);
	const PendingThaw = g_vecRepeatingTasks.at(-1);
	const unBeforeRejectedThaw = g_vecActions.length;
	g_InspectMovementWrite = () => true;
	strictEqual(Chat(1, "/freeze", "#103", "0"), 1);
	match(g_vecReplies.at(-1)[1], /Could not update freeze/);
	strictEqual(g_Peer.MovementType, 0);
	strictEqual(typeof PendingThaw.Callback, "function");
	throws(() => PendingThaw.Callback(), /Could not restore the player's movement/);
	strictEqual(g_Peer.MovementType, 0);
	strictEqual(typeof PendingThaw.Callback, "function");
	strictEqual(g_vecActions.length, unBeforeRejectedThaw);

	g_InspectMovementWrite = null;
	PendingThaw.Callback();
	strictEqual(PendingThaw.Callback, null);
	strictEqual(g_Peer.MovementType, 8);
	deepStrictEqual({ ...g_Peer.RenderColor }, g_ColorBeforeRejectedFreeze);
	deepStrictEqual(g_vecActions.at(-1), ["hint", [3], "You are no longer frozen."]);
} finally {
	g_InspectMovementWrite = null;
}

g_Peer.MovementFieldSize = 4;
strictEqual(Chat(1, "/noclip", "#103"), 1);
strictEqual(g_Peer.MovementType, 8);
g_Peer.MovementFieldSize = 1;
strictEqual(Chat(1, "/noclip", "#103"), 1);
strictEqual(g_Peer.MovementType, 2);

const g_unBeforeNoClipRejection = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/noclip", "#103", "extra"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_noclip/);
strictEqual(g_Peer.MovementType, 2);

const g_RejectingNoClipBot = AddPlayer(4, 904, "Unchanged movement target");
const g_SucceedingNoClipBot = AddPlayer(5, 905, "Changed movement target");
g_RejectingNoClipBot.FakeClient = true;
g_SucceedingNoClipBot.FakeClient = true;

try {
	g_InspectMovementWrite = (Player, unMovementType) => {
		if (Player.Index !== g_RejectingNoClipBot.Index) {
			Player.MovementType = unMovementType;
		}

		return true;
	};
	strictEqual(Chat(1, "/noclip", "#904"), 1);
	match(g_vecReplies.at(-1)[1], /Could not update no-clip/);
	strictEqual(g_vecChatDeliveries.length, g_unBeforeNoClipRejection);

	strictEqual(Chat(1, "/noclip", "@bots"), 1);
	match(g_vecReplies.at(-1)[1], /No-clip updated for 1 of 2/);
	strictEqual(g_RejectingNoClipBot.MovementType, 2);
	strictEqual(g_SucceedingNoClipBot.MovementType, 8);
} finally {
	g_InspectMovementWrite = null;
	g_mapPlayers.delete(4);
	g_mapPlayers.delete(5);
}

strictEqual(Chat(1, "/gravity", "#103", "0.5"), 1);
strictEqual(g_Peer.Gravity, 0.5);
strictEqual(Chat(1, "/gravity", "#103", "-2"), 1);
strictEqual(g_Peer.Gravity, 0);
strictEqual(Chat(1, "/gravity", "#103", "1.5e1"), 1);
strictEqual(g_Peer.Gravity, 15);
strictEqual(Chat(1, "/gravity", "#103", "1e100"), 1);
match(g_vecReplies.at(-1)[1], /finite numeric multiplier/);
strictEqual(g_Peer.Gravity, 15);
strictEqual(Chat(1, "/gravity", "#103"), 1);
strictEqual(g_Peer.Gravity, 1);
strictEqual(Chat(1, "/gravity", "#103", "0.5"), 1);
const g_unBeforeGravityNoOpActivity = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/gravity", "#103", "0.5"), 1);
match(g_vecReplies.at(-1)[1], /Gravity was already set/);
strictEqual(g_vecChatDeliveries.length, g_unBeforeGravityNoOpActivity);

const g_RejectingGravityBot = AddPlayer(4, 904, "Failed gravity target");
const g_SucceedingGravityBot = AddPlayer(5, 905, "Successful gravity target");
g_RejectingGravityBot.FakeClient = true;
g_SucceedingGravityBot.FakeClient = true;

try {
	g_InspectGravityWrite = (Player, flGravity) => {
		if (Player.Index === g_RejectingGravityBot.Index) {
			return true;
		}

		Player.Gravity = flGravity;

		return true;
	};

	strictEqual(Chat(1, "/gravity", "#904", "0.1"), 1);
	match(g_vecReplies.at(-1)[1], /Could not update gravity/);
	strictEqual(g_vecChatDeliveries.length, g_unBeforeGravityNoOpActivity);

	strictEqual(Chat(1, "/gravity", "@bots", "0.1"), 1);
	match(g_vecReplies.at(-1)[1], /Gravity updated for 1 of 2/);
	strictEqual(g_RejectingGravityBot.Gravity, 1);
	strictEqual(g_SucceedingGravityBot.Gravity, Math.fround(0.1));
} finally {
	g_InspectGravityWrite = null;
	g_mapPlayers.delete(4);
	g_mapPlayers.delete(5);
}

const g_strPreviousFunActivity = g_ShowActivity.Value;
g_ShowActivity.Value = "13";
g_mapPermissions.set(3, new Set(["sourcejs.admin"]));

for (const [vecArguments, strNotice, CheckAction] of [
	[["/blind", "#103", "150"], "Set blindness to opacity 150 for 1 player(s).", () => deepStrictEqual(g_vecActions.at(-1), ["fade", 3, 150, g_unExpectedBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds])],
	[["/blind", "#103", "0"], "Cleared blindness for 1 player(s).", () => deepStrictEqual(g_vecActions.at(-1), ["fade", 3, 0, g_unExpectedClearBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds])],
	[["/gravity", "#103", "-2"], "Set gravity to 0 for 1 player(s).", () => strictEqual(g_Peer.Gravity, 0)],
	[["/noclip", "#103"], "No-clip updated for 1 of 1 player(s).", () => strictEqual(g_Peer.MovementType, 8)],
	[["/freeze", "#103"], "Freeze updated for 1 of 1 player(s).", () => strictEqual(g_Peer.MovementType, 0)],
	[["/drug", "#103", "1"], "drug: started 1, cancelled 0.", () => strictEqual(typeof g_vecRepeatingTasks.at(-1).Callback, "function")],
	[["/burn", "#103", "4"], "Ignited 1 player(s) for 4 seconds.", () => deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, 4])],
]) {
	const unBeforeDeniedActivity = g_vecChatDeliveries.length;
	const unBeforeDeniedAction = g_vecActions.length;
	strictEqual(Chat(2, ...vecArguments), 1);
	match(g_vecReplies.at(-1)[1], /do not have permission/);
	strictEqual(g_vecActions.length, unBeforeDeniedAction);
	strictEqual(g_vecChatDeliveries.length, unBeforeDeniedActivity);

	strictEqual(Chat(1, ...vecArguments), 1);
	CheckAction();
	deepStrictEqual(g_vecChatDeliveries.slice(unBeforeDeniedActivity).filter(([, strText]) => strText.startsWith("[SourceJS] ")), [
		[[3], `[SourceJS] Operator: ${strNotice}`],
		[[2], `[SourceJS] Admin: ${strNotice}`],
	]);
}

const g_unBeforeUnchangedActivity = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/drug", "#103", "1"), 1);
strictEqual(Chat(1, "/noclip", "#103"), 1);
match(g_vecReplies.at(-1)[1], /No-clip was not changed for frozen players/);
strictEqual(g_Peer.MovementType, 0);
g_bFadeDeliverySucceeds = false;
strictEqual(Chat(1, "/blind", "#103", "255"), 1);
match(g_vecReplies.at(-1)[1], /did not accept the screen fade/);
g_bFadeDeliverySucceeds = true;
strictEqual(g_vecChatDeliveries.length, g_unBeforeUnchangedActivity);

g_bChatDeliveryThrows = true;

try {
	strictEqual(Chat(1, "/gravity", "#103", "0.25"), 1);
	strictEqual(g_Peer.Gravity, 0.25);
	match(g_vecReplies.at(-1)[1], /Gravity updated for 1 of 1/);
} finally {
	g_bChatDeliveryThrows = false;
}

g_ShowActivity.Value = "0";
strictEqual(Chat(1, "/drug", "#103", "0"), 1);
strictEqual(g_vecRepeatingTasks.at(-1).Callback, null);
strictEqual(Chat(1, "/freeze", "#103", "0"), 1);
strictEqual(g_Peer.MovementType, 8);
strictEqual(Chat(1, "/noclip", "#103"), 1);
strictEqual(g_Peer.MovementType, 2);
strictEqual(Chat(1, "/gravity", "#103", "0.5"), 1);
strictEqual(g_Peer.Gravity, 0.5);
strictEqual(g_vecChatDeliveries.slice(g_unBeforeUnchangedActivity).some(([, strText]) => strText.startsWith("[SourceJS] ")), false);
g_ShowActivity.Value = g_strPreviousFunActivity;
g_mapPermissions.delete(3);

const g_unBombFixtureFuseTicks = 5;
const g_unExpectedBombCountdownTicks = g_unBombFixtureFuseTicks - 1;
const g_unExpectedDefaultBlastRadius = 600;
const g_flExpectedFireBlastHeightOffset = 55;
const g_flExpectedFireBombDurationSeconds = 12.5;
g_mapConVars.get("sjs_firebomb_ticks").Value = String(g_unBombFixtureFuseTicks);
strictEqual(Chat(1, "/firebomb", "#103", "1"), 1);
const g_FireBomb = g_vecRepeatingTasks.at(-1);
const g_unActionsBeforeFireBomb = g_vecActions.length;
for (let unTick = 0; unTick < g_unExpectedBombCountdownTicks; ++unTick) {
	g_FireBomb.Callback();
}

strictEqual(g_vecActions.slice(g_unActionsBeforeFireBomb).filter((Action) => Action[0] === "center").length, g_unExpectedBombCountdownTicks);
strictEqual(g_Peer.RenderColor.Green, 0);
strictEqual(g_Peer.RenderColor.Blue, 0);
strictEqual(g_vecActions.slice(g_unActionsBeforeFireBomb).some((Action) => Action[0] === "ignite"), false);

const g_unActionsBeforeFireBlast = g_vecActions.length;
g_FireBomb.Callback();
strictEqual(g_FireBomb.Callback, null);
strictEqual(g_Peer.RenderColor.Blue, 7);
const g_vecFireBlast = g_vecActions.slice(g_unActionsBeforeFireBlast);
strictEqual(g_vecFireBlast.find((Action) => Action[1] === "Explosion")[2].Scale, 0.1);
deepStrictEqual(g_vecFireBlast.filter((Action) => Action[1] === "BeamRingPoint").map((Action) => Action[2].StartRadius), [50, 40, 30, 20]);
deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, g_flExpectedFireBombDurationSeconds]);

const { SendFireBombRings } = LoadFile(join(g_strAdministrationRoot, "fun-effects.js"));
const g_FireBombOrigin = { X: 10, Y: 20, Z: 30 };
const g_FireBombEyePosition = { X: 10, Y: 20, Z: 94 };
const g_unActionsBeforeHeadlessFireBomb = g_vecActions.length;
const g_BlastOriginWithoutRecipients = SendFireBombRings({ Beam: 1, Halo: 2 }, g_FireBombOrigin, g_FireBombEyePosition, g_unExpectedDefaultBlastRadius, []);
strictEqual(g_BlastOriginWithoutRecipients.Z, g_FireBombOrigin.Z + g_flExpectedFireBlastHeightOffset);
strictEqual(g_vecActions.length, g_unActionsBeforeHeadlessFireBomb);

const g_VisibleBlastOrigin = SendFireBombRings({ Beam: 1, Halo: 2 }, g_FireBombOrigin, g_FireBombEyePosition, g_unExpectedDefaultBlastRadius, [1]);
strictEqual(g_VisibleBlastOrigin.Z, g_BlastOriginWithoutRecipients.Z);
strictEqual(SendFireBombRings({ Beam: 0, Halo: 2 }, g_FireBombOrigin, g_FireBombEyePosition, g_unExpectedDefaultBlastRadius, [1]), g_FireBombEyePosition);

const g_Operator = g_mapPlayers.get(1);
g_Operator.Team = 3;
g_Target.Dead = false;
g_mapConVars.get("sjs_firebomb_mode").Value = "1";
const g_flExpectedSecondaryBurn = g_flExpectedFireBombDurationSeconds * (1 - (Math.hypot(1, 0, g_flExpectedFireBlastHeightOffset) / g_unExpectedDefaultBlastRadius));

for (const bBotsOnly of [false, true]) {
	for (const Player of [g_Operator, g_Target, g_Peer]) {
		Player.FakeClient = bBotsOnly;
	}

	const DisconnectedBombRecipient = AddPlayer(4, 604, "Disconnected bomb recipient");
	DisconnectedBombRecipient.Connected = false;
	const unActionsBeforeBlast = g_vecActions.length;
	strictEqual(RunServerCommand("firebomb", "#103", "1"), 1);
	const AreaFireBomb = g_vecRepeatingTasks.at(-1);
	for (let unTick = 0; unTick < g_unBombFixtureFuseTicks; ++unTick) {
		AreaFireBomb.Callback();
	}

	const vecBlastActions = g_vecActions.slice(unActionsBeforeBlast);
	deepStrictEqual(vecBlastActions.filter((Action) => Action[0] === "ignite"), [["ignite", 103, g_flExpectedFireBombDurationSeconds], ["ignite", 102, g_flExpectedSecondaryBurn]]);
	deepStrictEqual(vecBlastActions.find((Action) => Action[1] === "BeamRingPoint")[3], [1, 2, 3]);
	const vecCountdowns = vecBlastActions.filter((Action) => Action[0] === "center");
	strictEqual(vecCountdowns.length, bBotsOnly ? 0 : g_unExpectedBombCountdownTicks);

	if (!bBotsOnly) {
		deepStrictEqual(vecCountdowns[0][1], [1, 2, 3]);
	}

	g_mapPlayers.delete(4);
}

for (const Player of [g_Operator, g_Target, g_Peer]) {
	Player.FakeClient = false;
}

const g_OriginalTargetOrigin = g_Target.Origin;
g_mapConVars.get("sjs_firebomb_mode").Value = "2";

for (const [flOffset, bWithinRadius] of [[500, true], [g_unExpectedDefaultBlastRadius, false]]) {
	g_Target.Origin = { ...g_OriginalTargetOrigin, X: g_Peer.Origin.X + flOffset, Z: g_Peer.Origin.Z + g_flExpectedFireBlastHeightOffset };
	const unActionsBeforeBlast = g_vecActions.length;
	strictEqual(RunServerCommand("firebomb", "#103", "1"), 1);
	const AreaFireBomb = g_vecRepeatingTasks.at(-1);
	for (let unTick = 0; unTick < g_unBombFixtureFuseTicks; ++unTick) {
		AreaFireBomb.Callback();
	}

	const vecExpectedIgnitions = [["ignite", 103, g_flExpectedFireBombDurationSeconds], ["ignite", 101, g_flExpectedFireBombDurationSeconds * (1 - (Math.hypot(2, 0, g_flExpectedFireBlastHeightOffset) / g_unExpectedDefaultBlastRadius))]];
	if (bWithinRadius) {
		vecExpectedIgnitions.push(["ignite", 102, g_flExpectedFireBombDurationSeconds * (1 - (flOffset / g_unExpectedDefaultBlastRadius))]);
	}

	deepStrictEqual(g_vecActions.slice(unActionsBeforeBlast).filter((Action) => Action[0] === "ignite"), vecExpectedIgnitions);
}

g_Target.Origin = g_OriginalTargetOrigin;
g_Operator.Team = 2;
g_Target.Dead = true;
g_mapConVars.get("sjs_firebomb_mode").Value = "0";

const g_unFreezeBombThawDurationSeconds = 12;
g_mapConVars.get("sjs_freezebomb_ticks").Value = String(g_unBombFixtureFuseTicks);
g_mapConVars.get("sjs_freezebomb_mode").Value = "1";
g_mapConVars.get("sjs_freeze_duration").Value = String(g_unFreezeBombThawDurationSeconds);
g_Target.Team = 3;
strictEqual(Chat(1, "/freezebomb", "#103", "1"), 1);
const g_CancelledFreezeBomb = g_vecRepeatingTasks.at(-1);
g_CancelledFreezeBomb.Callback();
strictEqual(g_Peer.RenderColor.Blue, 255);
strictEqual(Chat(1, "/freezebomb", "#103", "0"), 1);
strictEqual(g_CancelledFreezeBomb.Callback, null);
strictEqual(g_Peer.RenderColor.Blue, 7);
strictEqual(g_Peer.MovementType, 2);

strictEqual(Chat(1, "/freezebomb", "#103"), 1);
const g_FreezeBomb = g_vecRepeatingTasks.at(-1);
const g_unActionsBeforeFreezeBomb = g_vecActions.length;
for (let unTick = 0; unTick < g_unExpectedBombCountdownTicks; ++unTick) {
	g_FreezeBomb.Callback();
}

strictEqual(g_vecActions.slice(g_unActionsBeforeFreezeBomb).filter((Action) => Action[0] === "center").length, g_unExpectedBombCountdownTicks);
strictEqual(g_Peer.MovementType, 2);

const g_unTasksBeforeFreezeBlast = g_vecRepeatingTasks.length;
const g_unActionsBeforeFreezeBlast = g_vecActions.length;
g_FreezeBomb.Callback();
strictEqual(g_FreezeBomb.Callback, null);
strictEqual(g_Peer.RenderColor.Blue, 255);
strictEqual(g_Peer.MovementType, 0);
strictEqual(g_Target.MovementType, 2);
strictEqual(g_mapPlayers.get(1).MovementType, 0);
strictEqual(g_vecActions.slice(g_unActionsBeforeFreezeBlast).filter((Action) => Action[1] === "BeamPoints").length, 1);
const g_vecThawTasks = g_vecRepeatingTasks.slice(g_unTasksBeforeFreezeBlast);
strictEqual(g_vecThawTasks.length, 2);

for (let unTick = 0; unTick < (g_unFreezeBombThawDurationSeconds - 1); ++unTick) {
	for (const Task of g_vecThawTasks) {
		Task.Callback();
	}

	strictEqual(g_Peer.MovementType, 0);
}

for (const Task of g_vecThawTasks) {
	Task.Callback();
}

strictEqual(g_Peer.MovementType, 2);
strictEqual(g_Peer.RenderColor.Blue, 7);
strictEqual(g_mapPlayers.get(1).MovementType, 2);

const g_OriginalFreezeBombOrigin = g_Target.Origin;
g_Target.Dead = false;
g_Target.Origin = { X: g_Peer.Origin.X + g_unExpectedDefaultBlastRadius, Y: g_Peer.Origin.Y, Z: g_Peer.Origin.Z };
g_mapConVars.get("sjs_freezebomb_mode").Value = "2";

for (const [flEyeOffset, bFrozen] of [[0, true], [64, false]]) {
	g_Target.ViewOffset = { X: 0, Y: 0, Z: flEyeOffset };
	strictEqual(Chat(1, "/freezebomb", "#103", "1"), 1);
	const BoundaryFreezeBomb = g_vecRepeatingTasks.at(-1);
	for (let unTick = 0; unTick < g_unBombFixtureFuseTicks; ++unTick) {
		BoundaryFreezeBomb.Callback();
	}

	strictEqual(g_Target.MovementType, bFrozen ? 0 : 2);

	for (const strSelector of ["#101", "#102", "#103"]) {
		strictEqual(Chat(1, "/freeze", strSelector, "0"), 1);
	}
}

delete g_Target.ViewOffset;
g_Target.Origin = g_OriginalFreezeBombOrigin;
g_Target.Dead = true;
g_mapConVars.get("sjs_freezebomb_mode").Value = "1";
strictEqual(Chat(1, "/freeze", "#103", "60"), 1);
const g_ExistingFreeze = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/freeze", "#101", "60"), 1);
const g_ExistingTeammateFreeze = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/freezebomb", "#103", "1"), 1);
const g_ThawBomb = g_vecRepeatingTasks.at(-1);
for (let unTick = 0; unTick < g_unBombFixtureFuseTicks; ++unTick) {
	g_ThawBomb.Callback();
}

strictEqual(g_ThawBomb.Callback, null);
strictEqual(g_ExistingFreeze.Callback, null);
strictEqual(g_ExistingTeammateFreeze.Callback, null);
strictEqual(g_Peer.MovementType, 2);
strictEqual(g_Peer.RenderColor.Blue, 7);
strictEqual(g_mapPlayers.get(1).MovementType, 2);

g_Peer.MovementType = 0;
const g_ExternalFreezeTint = g_Peer.RenderColor;
g_mapConVars.get("sjs_freezebomb_mode").Value = "0";
strictEqual(Chat(1, "/freezebomb", "#103", "1"), 1);
const g_ExternalFreezeBomb = g_vecRepeatingTasks.at(-1);
const g_unTaskCountWithExternalFreeze = g_vecRepeatingTasks.length;
for (let unTick = 0; unTick < g_unBombFixtureFuseTicks; ++unTick) {
	g_ExternalFreezeBomb.Callback();
}

strictEqual(g_ExternalFreezeBomb.Callback, null);
strictEqual(g_vecRepeatingTasks.length, g_unTaskCountWithExternalFreeze);
strictEqual(g_Peer.MovementType, 0);
deepStrictEqual(g_Peer.RenderColor, g_ExternalFreezeTint);

g_Peer.MovementType = 2;
g_mapConVars.get("sjs_freezebomb_mode").Value = "1";
g_Target.Team = 2;
strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
const g_CancelledBomb = g_vecRepeatingTasks.at(-1);
g_CancelledBomb.Callback();
deepStrictEqual(g_vecActions.at(-4), ["tint", 3, 115]);
strictEqual(Chat(1, "/timebomb", "#103"), 1);
strictEqual(g_CancelledBomb.Callback, null);
strictEqual(g_Peer.RenderColor.Blue, 7);

const g_OriginalBombColor = g_Peer.RenderColor;
strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
const g_LayeredTimeBomb = g_vecRepeatingTasks.at(-1);
g_LayeredTimeBomb.Callback();
const g_TimeBombColor = g_Peer.RenderColor;
strictEqual(Chat(1, "/firebomb", "#103", "1"), 1);
const g_LayeredFireBomb = g_vecRepeatingTasks.at(-1);
g_LayeredFireBomb.Callback();
const g_FireBombColor = g_Peer.RenderColor;
strictEqual(Chat(1, "/timebomb", "#103", "0"), 1);
deepStrictEqual(g_Peer.RenderColor, g_FireBombColor);
strictEqual(Chat(1, "/firebomb", "#103", "0"), 1);
deepStrictEqual(g_Peer.RenderColor, g_OriginalBombColor);

strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
const g_BombUnderFreeze = g_vecRepeatingTasks.at(-1);
g_BombUnderFreeze.Callback();
deepStrictEqual(g_Peer.RenderColor, g_TimeBombColor);
strictEqual(Chat(1, "/freeze", "#103", "10"), 1);
const g_FreezeColor = g_Peer.RenderColor;
g_BombUnderFreeze.Callback();
deepStrictEqual(g_Peer.RenderColor, g_FreezeColor);
strictEqual(Chat(1, "/freeze", "#103", "0"), 1);
strictEqual(g_Peer.RenderColor.Red, 255);
strictEqual(g_Peer.RenderColor.Green, 128);
strictEqual(Chat(1, "/timebomb", "#103", "0"), 1);
deepStrictEqual(g_Peer.RenderColor, g_OriginalBombColor);

strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
const g_ExternallyTintedBomb = g_vecRepeatingTasks.at(-1);
g_ExternallyTintedBomb.Callback();
const g_ExternalColor = { Red: 12, Green: 34, Blue: 56, Alpha: 78 };
g_Peer.RenderColor = g_ExternalColor;
g_ExternallyTintedBomb.Callback();
deepStrictEqual(g_Peer.RenderColor, g_ExternalColor);
strictEqual(Chat(1, "/timebomb", "#103", "0"), 1);
deepStrictEqual(g_Peer.RenderColor, g_ExternalColor);
g_Peer.RenderColor = g_OriginalBombColor;

strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
const g_DisconnectedBomb = g_vecRepeatingTasks.at(-1);
g_DisconnectedBomb.Callback();
const g_unBeforeBombDisconnect = g_vecActions.length;
g_mapListeners.get("disconnect")(3);
strictEqual(g_DisconnectedBomb.Callback, null);
strictEqual(g_vecActions.slice(g_unBeforeBombDisconnect).some((Action) => Action[0] === "tint"), false);
g_Peer.RenderColor = g_OriginalBombColor;

const g_strBombActivityBefore = g_ShowActivity.Value;
g_ShowActivity.Value = "15";

for (const strBomb of ["timebomb", "firebomb", "freezebomb"]) {
	const unTasksBefore = g_vecRepeatingTasks.length;
	const unNoticesBefore = g_vecChatDeliveries.length;
	strictEqual(Chat(2, `/${strBomb}`, "#103", "1"), 1);
	match(g_vecReplies.at(-1)[1], /do not have permission/);
	strictEqual(Chat(1, `/${strBomb}`, "#103", "10"), 1);
	match(g_vecReplies.at(-1)[1], new RegExp(`sjs_${strBomb}_ticks`));
	strictEqual(Chat(1, `/${strBomb}`, "#103", "1", "10"), 1);
	match(g_vecReplies.at(-1)[1], /Usage:/);
	strictEqual(g_vecRepeatingTasks.length, unTasksBefore);
	strictEqual(g_vecChatDeliveries.length, unNoticesBefore);

	strictEqual(Chat(1, `/${strBomb}`, "#103", "1"), 1);
	const ActivityBomb = g_vecRepeatingTasks.at(-1);
	deepStrictEqual(g_vecChatDeliveries.slice(unNoticesBefore), [[[2, 3], `[SourceJS] Operator: ${strBomb}: started 1, cancelled 0.`]]);
	strictEqual(Chat(1, `/${strBomb}`, "#103", "1"), 1);
	strictEqual(g_vecRepeatingTasks.at(-1), ActivityBomb);
	strictEqual(g_vecChatDeliveries.length, unNoticesBefore + 1);
	strictEqual(Chat(1, `/${strBomb}`, "#103", "0"), 1);
	strictEqual(ActivityBomb.Callback, null);
	deepStrictEqual(g_vecChatDeliveries.at(-1), [[2, 3], `[SourceJS] Operator: ${strBomb}: started 0, cancelled 1.`]);
}

g_ShowActivity.Value = "0";
const g_unNoticesBeforeSilentBomb = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
strictEqual(Chat(1, "/timebomb", "#103", "0"), 1);
strictEqual(g_vecChatDeliveries.length, g_unNoticesBeforeSilentBomb);
g_ShowActivity.Value = g_strBombActivityBefore;

for (const strBomb of ["timebomb", "firebomb", "freezebomb"]) {
	strictEqual(Chat(1, `/${strBomb}`, "#103", "1"), 1);
	const PreviousBomb = g_vecRepeatingTasks.at(-1);
	const PreviousCallback = PreviousBomb.Callback;
	PreviousCallback();
	const Replacement = { ...g_Peer, UserID: 903, RenderColor: g_OriginalBombColor };
	g_mapPlayers.set(3, Replacement);
	strictEqual(Chat(1, `/${strBomb}`, "#903"), 1);
	match(g_vecReplies.at(-1)[1], /started 1, cancelled 0/);
	const ReplacementBomb = g_vecRepeatingTasks.at(-1);
	strictEqual(PreviousBomb.Callback, null);
	const unBeforeStaleCallback = g_vecActions.length;
	PreviousCallback();
	strictEqual(g_vecActions.length, unBeforeStaleCallback);

	ReplacementBomb.Callback();
	notDeepStrictEqual(Replacement.RenderColor, g_OriginalBombColor);

	Replacement.Dead = true;
	ReplacementBomb.Callback();
	strictEqual(ReplacementBomb.Callback, null);
	deepStrictEqual(Replacement.RenderColor, g_OriginalBombColor);
	g_mapPlayers.set(3, g_Peer);
	g_Peer.RenderColor = g_OriginalBombColor;
}

g_mapConVars.get("sjs_timebomb_ticks").Value = String(g_unBombFixtureFuseTicks);
strictEqual(Chat(1, "/timebomb", "#103"), 1);
const g_TimeBombTask = g_vecRepeatingTasks.at(-1);
const g_unActionsBeforeCountdown = g_vecActions.length;
for (let unTick = 0; unTick < g_unExpectedBombCountdownTicks; ++unTick) {
	g_TimeBombTask.Callback();
}

const g_vecCountdown = g_vecActions.slice(g_unActionsBeforeCountdown);
deepStrictEqual(g_vecCountdown.filter((Action) => Action[0] === "center").map((Action) => Action[2]), [
	"Test Peer will explode in 4 seconds!",
	"Test Peer will explode in 3 seconds!",
	"Test Peer will explode in 2 seconds!",
	"Test Peer will explode in 1 second!",
]);
strictEqual(g_vecCountdown.filter((Action) => Action[1] === "BeamRingPoint").length, 8);
deepStrictEqual(g_vecCountdown.filter((Action) => Action[0] === "ambient").map((Action) => Action[2]), [
	"weapons/hegrenade/beep.wav", "weapons/hegrenade/beep.wav", "weapons/hegrenade/beep.wav", "ui/beep22.wav",
]);

g_TimeBombTask.Callback();
strictEqual(g_TimeBombTask.Callback, null);
strictEqual(g_Peer.RenderColor.Blue, 7);
const [g_vecExplosion, g_vecBoom, g_vecSlay] = g_vecActions.slice(-3);
strictEqual(g_vecExplosion[1], "Explosion");
strictEqual(g_vecExplosion[2].Radius, g_unExpectedDefaultBlastRadius);
deepStrictEqual(g_vecBoom, ["ambient", 3, "weapons/hegrenade/explode3.wav", 3]);
deepStrictEqual(g_vecSlay, ["slay", 103]);

g_Peer.Dead = false;
const g_BlastPeer = AddPlayer(4, 104, "Blast Peer");
g_BlastPeer.Origin = { X: 300, Y: 0, Z: 0 };
const g_DistantTeammate = AddPlayer(7, 107, "Distant teammate");
g_DistantTeammate.Origin = { X: 503, Y: 0, Z: 0 };
const g_Opponent = AddPlayer(5, 105, "Opponent");
g_Opponent.Team = 3;
g_Opponent.Origin = { X: 300, Y: 0, Z: 0 };
const g_DisconnectedBlastPlayer = AddPlayer(6, 106, "Disconnected blast player");
g_DisconnectedBlastPlayer.Connected = false;
g_mapConVars.get("sjs_timebomb_mode").Value = "1";
const g_unActionsBeforeTeamBomb = g_vecActions.length;
strictEqual(Chat(1, "/timebomb", "#103", "1"), 1);
const g_TeamBomb = g_vecRepeatingTasks.at(-1);
for (let unTick = 0; unTick < g_unBombFixtureFuseTicks; ++unTick) {
	g_TeamBomb.Callback();
}

strictEqual(g_BlastPeer.Dead, true);
strictEqual(g_BlastPeer.Frags, 0);
strictEqual(g_DistantTeammate.Dead, false);
strictEqual(g_DistantTeammate.Health, 64);
strictEqual(g_Opponent.Dead, false);
strictEqual(g_Opponent.Health, 100);
strictEqual(g_DisconnectedBlastPlayer.Health, 100);
const g_vecTeamBombActions = g_vecActions.slice(g_unActionsBeforeTeamBomb);
strictEqual(g_vecTeamBombActions.some((Action) => (Action[0] === "push") && (Action[1] === 104)), true);
strictEqual(g_vecTeamBombActions.some((Action) => (Action[0] === "push") && (Action[1] === 107)), true);
strictEqual(g_vecTeamBombActions.some((Action) => (Action[0] === "ambient") && (Action[2] === "player/damage1.wav")), false);

g_mapPlayers.delete(4);
g_mapPlayers.delete(5);
g_mapPlayers.delete(6);
g_mapPlayers.delete(7);
g_Peer.Dead = false;
g_mapConVars.get("sjs_timebomb_mode").Value = "0";

const g_UnreadableBombTarget = AddPlayer(4, 804, "Unreadable blast target");
const g_ReusedBombTarget = AddPlayer(5, 805, "Reused blast target");
const g_SurvivingBlastTarget = AddPlayer(6, 806, "Final blast target");
const g_StableBlastOrigin = { X: 500, Y: 0, Z: 0 };
const g_OriginalSlayCarrier = g_Peer.Slay;

try {
	for (const strBomb of ["timebomb", "firebomb", "freezebomb"]) {
		g_mapConVars.get(`sjs_${strBomb}_mode`).Value = "2";
		const unBeforeDeniedBomb = g_vecRepeatingTasks.length;
		strictEqual(Chat(2, `/${strBomb}`, "#103", "1"), 1);
		match(g_vecReplies.at(-1)[1], /do not have permission/);
		strictEqual(g_vecRepeatingTasks.length, unBeforeDeniedBomb);

		strictEqual(RunServerCommand(strBomb, "#103", "1"), 1);
		const Bomb = g_vecRepeatingTasks.at(-1);
		for (let unTick = 0; unTick < g_unExpectedBombCountdownTicks; ++unTick) {
			Bomb.Callback();
		}

		Object.defineProperty(g_UnreadableBombTarget, "Origin", {
			configurable: true,
			enumerable: false,
			get() {
				throw new Error("Player origin unavailable.");
			},
		});
		Object.defineProperty(g_ReusedBombTarget, "Origin", {
			configurable: true,
			enumerable: false,
			get() {
				const Replacement = AddPlayer(5, 905, "Replacement during blast");
				Replacement.Origin = g_StableBlastOrigin;

				return g_StableBlastOrigin;
			},
		});
		g_SurvivingBlastTarget.Origin = g_StableBlastOrigin;
		g_Peer.Slay = () => {
			throw new Error("Carrier slay unavailable.");
		};

		const unBeforeBlast = g_vecActions.length;
		Bomb.Callback();
		strictEqual(Bomb.Callback, null);
		strictEqual(g_Peer.Dead, false);
		const Replacement = g_mapPlayers.get(5);
		strictEqual(Replacement.UserID, 905);
		strictEqual(Replacement.Health, 100);
		strictEqual(Replacement.MovementType, 2);
		const vecBlastActions = g_vecActions.slice(unBeforeBlast);
		strictEqual(vecBlastActions.some((Action) => ((Action[0] === "push") || (Action[0] === "ignite")) && [804, 805, 905].includes(Action[1])), false);
		strictEqual(g_UnreadableBombTarget.MovementType, 2);
		strictEqual(g_ReusedBombTarget.MovementType, 2);

		if (strBomb === "timebomb") {
			const unMaximumTimeBombDamage = 220;
			const flDistance = Math.hypot(g_StableBlastOrigin.X - g_Peer.Origin.X, 0, g_Peer.ViewOffset?.Z ?? 0);
			strictEqual(g_SurvivingBlastTarget.Health, 100 - Math.floor(unMaximumTimeBombDamage * (1 - (flDistance / g_unExpectedDefaultBlastRadius))));
		} else if (strBomb === "firebomb") {
			strictEqual(vecBlastActions.some((Action) => (Action[0] === "ignite") && (Action[1] === 806) && (Action[2] > 0)), true);
		} else {
			strictEqual(g_SurvivingBlastTarget.MovementType, 0);
			g_mapEventListeners.get("round_end")();
			strictEqual(g_SurvivingBlastTarget.MovementType, 2);
		}

		Object.defineProperty(g_UnreadableBombTarget, "Origin", { configurable: true, enumerable: true, writable: true, value: g_StableBlastOrigin });
		Object.defineProperty(g_ReusedBombTarget, "Origin", { configurable: true, enumerable: true, writable: true, value: g_StableBlastOrigin });
		g_mapPlayers.set(5, g_ReusedBombTarget);
		g_mapConVars.get(`sjs_${strBomb}_mode`).Value = "0";
	}
} finally {
	g_Peer.Slay = g_OriginalSlayCarrier;
	g_mapPlayers.delete(4);
	g_mapPlayers.delete(5);
	g_mapPlayers.delete(6);
}

strictEqual(Chat(3, "/settings", "off"), 1);
strictEqual(g_mapSettings.get(g_Peer.NetworkID).AdminSounds, false);
strictEqual(Chat(1, "/play", "#103", "test.wav"), 1);
match(g_vecReplies.at(-1)[1], /No human recipients/);

const g_unBeforeMutedSoundEvent = g_vecActions.length;
strictEqual(Chat(1, "/play", "#103", "UI.ButtonClick"), 1);
match(g_vecReplies.at(-1)[1], /No human recipients/);
strictEqual(g_vecActions.length, g_unBeforeMutedSoundEvent);

strictEqual(Chat(3, "/cookies", "on"), 1);
const g_unBeforeSoundActivity = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/play", "#103", "test.wav"), 1);
deepStrictEqual(g_vecActions.at(-1), ["sound", "test.wav", 3]);
match(g_vecReplies.at(-1)[1], /Sound submitted to 1 player/);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeSoundActivity), [[[2, 3], "[SourceJS] Operator: Submitted a sound to 1 player."]]);

const g_unBeforeDeniedSounds = g_vecActions.length;
const g_unBeforeDeniedSoundActivity = g_vecChatDeliveries.length;
strictEqual(Chat(2, "/play", "#103", "test.wav"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
strictEqual(Chat(2, "/play", "#103", "UI.ButtonClick"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
strictEqual(Chat(1, "/play", "#103", "not_installed.wav"), 1);
match(g_vecReplies.at(-1)[1], /could not find that sound/);
strictEqual(Chat(1, "/play", "#103", "sound/../test.wav"), 1);
match(g_vecReplies.at(-1)[1], /relative/);
strictEqual(Chat(1, "/play", "#103", "test.wav;quit"), 1);
match(g_vecReplies.at(-1)[1], /relative/);

for (const strUnsafeEvent of ["UI.ButtonClick;quit", '"UI.ButtonClick\\quit"', "UI..ButtonClick"]) {
	strictEqual(Chat(1, "/play", "#103", strUnsafeEvent), 1);
	match(g_vecReplies.at(-1)[1], /relative/);
}

const g_setPeerPermissionsBeforeSoundTest = g_mapPermissions.get(3);
g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
strictEqual(Chat(1, "/play", "#103", "test.wav"), 1);
match(g_vecReplies.at(-1)[1], /immune player/);
strictEqual(Chat(1, "/play", "#103", "UI.ButtonClick"), 1);
match(g_vecReplies.at(-1)[1], /immune player/);
g_mapPermissions.set(3, g_setPeerPermissionsBeforeSoundTest);
strictEqual(Chat(1, "/play", "@bots", "test.wav"), 1);
match(g_vecReplies.at(-1)[1], /No matching player/);
strictEqual(g_vecActions.length, g_unBeforeDeniedSounds);
strictEqual(g_vecChatDeliveries.length, g_unBeforeDeniedSoundActivity);

const g_SoundTargetBot = AddPlayer(4, 104, "Test Peer");
g_SoundTargetBot.FakeClient = true;
strictEqual(Chat(1, "/play", "\"Test Peer\"", "sound/test.wav"), 1);
deepStrictEqual(g_vecActions.at(-1), ["sound", "test.wav", 3]);
strictEqual(Chat(3, "/settings", "off"), 1);
strictEqual(Chat(1, "/play", "@all", "test.wav"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["sound", "test.wav", 1], ["sound", "test.wav", 2]]);

const g_unBeforeSoundEvent = g_vecActions.length;
strictEqual(Chat(1, "/play", "@all", "UI.ButtonClick"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeSoundEvent), [["client-command", 1, 'playgamesound "UI.ButtonClick"', false], ["client-command", 2, 'playgamesound "UI.ButtonClick"', false]]);
match(g_vecReplies.at(-1)[1], /Sound submitted to 1 of 2 eligible player/);
strictEqual(Chat(1, "/play", "#102", "UI.ButtonClick"), 1);
match(g_vecReplies.at(-1)[1], /did not accept the sound/);

strictEqual(Chat(3, "/settings", "on"), 1);
const g_unBeforePartialSoundFile = g_vecActions.length;

try {
	g_InspectSoundEmission = (Options) => {
		if (Options.Recipients[0] === 1) {
			throw new Error("Sound delivery failed.");
		}

		return Options.Recipients[0] !== 2;
	};
	strictEqual(Chat(1, "/play", "@all", "test.wav"), 1);
	deepStrictEqual(g_vecActions.slice(g_unBeforePartialSoundFile), [1, 2, 3].map((unIndex) => ["sound", "test.wav", unIndex]));
	match(g_vecReplies.at(-1)[1], /Sound submitted to 1 of 3 eligible player/);

	g_InspectSoundEmission = (Options) => {
		if (Options.Recipients[0] === 1) {
			AddPlayer(2, 902, "Replacement sound target");
			g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
		}

		return true;
	};
	const unBeforeStaleSoundFile = g_vecActions.length;
	strictEqual(Chat(1, "/play", "@all", "test.wav"), 1);
	deepStrictEqual(g_vecActions.slice(unBeforeStaleSoundFile), [["sound", "test.wav", 1]]);
	match(g_vecReplies.at(-1)[1], /Sound submitted to 1 of 3 eligible player/);
} finally {
	g_InspectSoundEmission = null;
	g_mapPlayers.set(2, g_Target);
	g_mapPermissions.set(3, g_setPeerPermissionsBeforeSoundTest);
}

const g_unBeforeSoundEventFailure = g_vecActions.length;
const g_unBeforeSoundEventActivity = g_vecChatDeliveries.length;
g_bFirstSoundEventThrows = true;
strictEqual(Chat(1, "/play", "@all", "UI.ButtonClick"), 1);
g_bFirstSoundEventThrows = false;
deepStrictEqual(g_vecActions.slice(g_unBeforeSoundEventFailure), [
	["client-command", 1, 'playgamesound "UI.ButtonClick"', false],
	["client-command", 2, 'playgamesound "UI.ButtonClick"', false],
	["client-command", 3, 'playgamesound "UI.ButtonClick"', false],
]);

match(g_vecReplies.at(-1)[1], /Sound submitted to 1 of 3 eligible player/);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeSoundEventActivity), [[[2, 3], "[SourceJS] Operator: Submitted a sound to 1 player."]]);

strictEqual(Chat(1, "/play", "#102", '"custom/test sample.wav"'), 1);
deepStrictEqual(g_vecActions.at(-1), ["sound", "custom/test sample.wav", 2]);

const g_unBeforeSoundFailure = g_vecActions.length;
g_bSoundPrecached = false;
g_bSoundPrecacheSucceeds = false;
strictEqual(Chat(1, "/play", "#102", "test.wav"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeSoundFailure), [["precache-sound", "test.wav", false, true]]);
match(g_vecReplies.at(-1)[1], /did not accept the sound/);
g_bSoundPrecacheSucceeds = true;
g_bSoundPrecached = true;
strictEqual(Chat(3, "/settings", "on"), 1);
g_mapPlayers.delete(4);

g_bHasShowMenu = false;
strictEqual(Chat(3, "/settings"), 1);
const g_ESCPreferences = g_mapMenus.get(3);
strictEqual(g_ESCPreferences.constructor, PagedESCMenu);
strictEqual(g_ESCPreferences.UseTextDialogFallback, false);

g_bVoteMenuSendSucceeds = false;
strictEqual(Chat(3, "/settings"), 1);
match(g_vecReplies.at(-1)[1], /Use \/settings on or \/settings off/);
g_bVoteMenuSendSucceeds = true;
g_bHasShowMenu = true;

strictEqual(Chat(3, "/cookies"), 1);
match(g_vecReplies.at(-1)[1], /Available cookies:[\s\S]*AdminSounds/);
strictEqual(Chat(3, "/cookies", "AdminSounds", "off"), 1);
strictEqual(Chat(3, "/cookies", "adminsounds"), 1);
match(g_vecReplies.at(-1)[1], /AdminSounds = off/);
strictEqual(Chat(3, "/cookies", "private"), 1);
match(g_vecReplies.at(-1)[1], /Unknown cookie/);

strictEqual(Chat(3, "/settings"), 1);
const g_OldPreferenceMenu = g_mapMenus.get(3);
strictEqual(g_OldPreferenceMenu.constructor, PagedRadioMenu);
strictEqual(g_OldPreferenceMenu.Items[0].Value, true);
strictEqual(Chat(3, "/settings", "off"), 1);
g_OldPreferenceMenu.Options.SelectCallback(3, true);
strictEqual(g_mapSettings.get(g_Peer.NetworkID).AdminSounds, false);

g_bDeferPreferenceLoad = true;
strictEqual(Chat(3, "/settings"), 1);
g_mapListeners.get("disconnect")(3);
g_Peer.UserID = 903;
const g_unRepliesBeforeStaleLoad = g_vecReplies.length;
g_PendingPreferenceLoad(null);
g_PendingPreferenceLoad = null;
g_bDeferPreferenceLoad = false;
strictEqual(g_vecReplies.length, g_unRepliesBeforeStaleLoad);
strictEqual(g_mapMenus.has(3), false);

strictEqual(Chat(3, "/cookies", "AdminSounds"), 1);
match(g_vecReplies.at(-1)[1], /AdminSounds = off/);
strictEqual(Chat(3, "/settings"), 1);
const g_ReconnectedPreferenceMenu = g_mapMenus.get(3);
strictEqual(g_ReconnectedPreferenceMenu.Items[0].Value, true);
g_ReconnectedPreferenceMenu.Options.SelectCallback(3, true);
strictEqual(g_mapSettings.get(g_Peer.NetworkID).AdminSounds, true);
g_ReconnectedPreferenceMenu.CloseMenu(3);
g_Peer.UserID = 103;
strictEqual(Chat(3, "/settings", "on"), 1);

strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "kick");
const g_KickAction = g_mapMenus.get(1).Items.find((Option) => Option.Value?.Name === "kick");
strictEqual(g_KickAction.Text, "Kick a player");
g_mapMenus.get(1).Options.SelectCallback(1, g_KickAction.Value);
const g_KickMenu = g_mapMenus.get(1);
strictEqual(g_KickMenu.constructor, PagedRadioMenu);
g_KickMenu.Options.SelectCallback(1, 103);
deepStrictEqual(g_vecActions.at(-1), ["kick", 103, "Kicked by an administrator."]);
strictEqual(g_mapMenus.get(1).Options.Title, "Kick a player");

const g_unBeforeStaleKick = g_vecActions.length;
const g_unDeliveriesBeforeDeniedKick = g_vecChatDeliveries.length;
g_KickMenu.Options.SelectCallback(1, 103);
strictEqual(g_vecActions.length, g_unBeforeStaleKick);
g_mapMenus.delete(1);

strictEqual(Chat(2, "/kick"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(g_mapMenus.has(2), false);

g_mapPermissions.set(2, new Set(["sourcejs.kick"]));
g_bHasShowMenu = false;
strictEqual(Chat(2, "/kick"), 1);
const g_DirectKickMenu = g_mapMenus.get(2);
strictEqual(g_DirectKickMenu.constructor, PagedESCMenu);
strictEqual(g_DirectKickMenu.Items.some((Option) => Option.Value === null), false);
g_mapPermissions.get(2).delete("sourcejs.kick");
g_DirectKickMenu.Options.SelectCallback(2, 103);
strictEqual(g_vecActions.length, g_unBeforeStaleKick);

g_mapPermissions.get(2).add("sourcejs.kick");
g_Peer.UserID = 903;
g_DirectKickMenu.Options.SelectCallback(2, 103);
match(g_vecReplies.at(-1)[1], /No matching player/);
strictEqual(g_vecActions.length, g_unBeforeStaleKick);
g_Peer.UserID = 103;

strictEqual(Chat(2, "/kick"), 1);
const g_ImmunityKickMenu = g_mapMenus.get(2);
g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
g_ImmunityKickMenu.Options.SelectCallback(2, 103);
match(g_vecReplies.at(-1)[1], /immune player/);
strictEqual(Chat(2, "/kick", "@all", "fixture"), 1);
strictEqual(g_vecActions.length, g_unBeforeStaleKick);
strictEqual(g_vecChatDeliveries.length, g_unDeliveriesBeforeDeniedKick);
g_mapPermissions.delete(3);
g_mapMenus.get(2).CloseMenu(2);
g_mapPermissions.delete(2);
g_bHasShowMenu = true;

const g_unBeforeGroupKick = g_vecActions.length;
const g_unBeforeGroupKickActivity = g_vecChatDeliveries.length;
g_ShowActivity.Value = "13";
g_mapPermissions.set(3, new Set(["sourcejs.admin"]));
strictEqual(Chat(1, "/kick", "@all", "fixture reason"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeGroupKick), [
	["kick", 102, "fixture reason"],
	["kick", 103, "fixture reason"],
	["kick", 101, "fixture reason"],
]);
match(g_vecReplies.at(-1)[1], /3 of 3 players/);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeGroupKickActivity), [
	[[3], "[SourceJS] Operator: Kicked 3 players."],
	[[2], "[SourceJS] Admin: Kicked 3 players."],
]);

g_mapPermissions.delete(3);
const g_OriginalKickPeer = g_Peer.Kick;
g_Peer.Kick = () => false;
const g_unBeforeRefusedKick = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/kick", "#103"), 1);
match(g_vecReplies.at(-1)[1], /not accepted for any target/);
strictEqual(g_vecChatDeliveries.length, g_unBeforeRefusedKick);
strictEqual(Chat(1, "/kick", "@!me"), 1);
match(g_vecReplies.at(-1)[1], /1 of 2 players/);
g_Peer.Kick = g_OriginalKickPeer;

g_ShowActivity.Value = "0";
const g_unBeforeHiddenKick = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/kick", "#103"), 1);
strictEqual(g_vecChatDeliveries.length, g_unBeforeHiddenKick);

g_ShowActivity.Value = "16";
g_mapPermissions.set(2, new Set(["sourcejs.activity.seenames"]));
strictEqual(Chat(1, "/kick", "#103"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeHiddenKick), [[[2], "[SourceJS] Operator: Kicked Test Peer."]]);
g_mapPermissions.delete(2);

g_ShowActivity.Value = "13";
g_bChatDeliveryThrows = true;
strictEqual(Chat(1, "/kick", "#103"), 1);
deepStrictEqual(g_vecActions.at(-1), ["kick", 103, "Kicked by an administrator."]);
match(g_vecReplies.at(-1)[1], /Kick submitted/);
g_bChatDeliveryThrows = false;
g_ShowActivity.Value = "15";

strictEqual(g_mapClientCommands.get("sjs_kick")({ Index: 1, Arguments: ["sjs_kick"] }), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_kick/);

function OpenBanReasonMenu(strMinutes) {
	strictEqual(Chat(1, "/admin"), 1);
	g_mapMenus.get(1).Options.SelectCallback(1, "ban");
	const ActionMenu = g_mapMenus.get(1);
	ActionMenu.Options.SelectCallback(1, ActionMenu.Items.find((Option) => Option.Value?.Name === "ban").Value);

	const TargetMenu = g_mapMenus.get(1);
	strictEqual(TargetMenu.Items.some((Option) => Option.Value === 904), false);
	TargetMenu.Options.SelectCallback(1, 103);

	const DurationMenu = g_mapMenus.get(1);
	strictEqual(DurationMenu.Items.some((Option) => Option.Value === strMinutes), true);
	DurationMenu.Options.SelectCallback(1, strMinutes);

	return g_mapMenus.get(1);
}

const g_unActionsBeforeBanMenu = g_vecActions.length;
const g_BanMenuBot = AddPlayer(4, 904, "Ban menu bot");
g_BanMenuBot.FakeClient = true;
OpenBanReasonMenu("30").Options.SelectCallback(1, "");
g_mapPlayers.delete(4);
match(g_vecReplies.at(-1)[1], /\/abortban/);
strictEqual(Chat(1, "/abortban"), 1);
match(g_vecReplies.at(-1)[1], /Pending ban cancelled/);
strictEqual(Chat(1, "not a ban reason anymore"), 0);
strictEqual(g_vecActions.length, g_unActionsBeforeBanMenu);

OpenBanReasonMenu("10").Options.SelectCallback(1, "");
strictEqual(Chat(1, "/help"), 1);
strictEqual(g_ChatFilter({ Index: 1, Arguments: ["@ Admin note, not the ban reason"], TeamOnly: true }), 1);
strictEqual(Chat(1, "Custom test reason"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["ban", 103, 10, false, false], ["kick", 103, "Custom test reason"]]);

OpenBanReasonMenu("60").Options.SelectCallback(1, "Cheating");
deepStrictEqual(g_vecActions.slice(-2), [["ban", 103, 60, false, false], ["kick", 103, "Cheating"]]);

g_strBanReasonsConfiguration = '["Fixture policy"]';
const g_ConfiguredBanMenu = OpenBanReasonMenu("240");
deepStrictEqual(g_ConfiguredBanMenu.Items.map((Option) => Option.Value), ["", "Fixture policy", null]);
g_ConfiguredBanMenu.Options.SelectCallback(1, "Fixture policy");
deepStrictEqual(g_vecActions.slice(-2), [["ban", 103, 240, false, false], ["kick", 103, "Fixture policy"]]);
g_strBanReasonsConfiguration = null;

const g_unActionsAfterBan = g_vecActions.length;
OpenBanReasonMenu("0").Options.SelectCallback(1, "");
g_mapPermissions.get(1).delete("sourcejs.ban");
strictEqual(Chat(1, "Do not publish this reason"), 1);
match(g_vecReplies.at(-1)[1], /no longer have permission/);
strictEqual(g_vecActions.length, g_unActionsAfterBan);
g_mapPermissions.get(1).add("sourcejs.ban");

OpenBanReasonMenu("0").Options.SelectCallback(1, "");
g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
strictEqual(Chat(1, "Do not ban an immune target"), 1);
match(g_vecReplies.at(-1)[1], /immune/);
strictEqual(g_vecActions.length, g_unActionsAfterBan);
g_mapPermissions.delete(3);

OpenBanReasonMenu("0").Options.SelectCallback(1, "");
g_mapPlayers.set(3, { ...g_Peer, UserID: 903 });
strictEqual(Chat(1, "Do not ban the replacement"), 1);
match(g_vecReplies.at(-1)[1], /no longer connected/);
strictEqual(g_vecActions.length, g_unActionsAfterBan);
g_mapPlayers.set(3, g_Peer);

OpenBanReasonMenu("0").Options.SelectCallback(1, "");
g_mapListeners.get("level-end")();
strictEqual(Chat(1, "/abortban"), 1);
match(g_vecReplies.at(-1)[1], /No ban is waiting/);
strictEqual(g_vecActions.length, g_unActionsAfterBan);
g_mapMenus.delete(1);

strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "slay");
const g_FunActionsMenu = g_mapMenus.get(1);
for (const strAction of ["beacon", "timebomb", "burn", "firebomb", "freeze", "freezebomb", "gravity", "blind", "noclip", "drug"]) {
	strictEqual(g_FunActionsMenu.Items.some((Option) => Option.Value?.Name === strAction), true, strAction);
}

strictEqual(g_FunActionsMenu.Items.find((Option) => Option.Value?.Name === "beacon").Text, "Toggle player beacon");

const g_NoClipAction = g_FunActionsMenu.Items.find((Option) => Option.Value?.Name === "noclip");
g_FunActionsMenu.Options.SelectCallback(1, g_NoClipAction.Value);
const g_NoClipTargetMenu = g_mapMenus.get(1);
g_mapPermissions.get(1).delete("sourcejs.cheats");
g_NoClipTargetMenu.Options.SelectCallback(1, 103);
strictEqual(g_Peer.MovementType, 2);
g_mapPermissions.get(1).add("sourcejs.cheats");
g_NoClipTargetMenu.Options.SelectCallback(1, 103);
strictEqual(g_Peer.MovementType, 8);
strictEqual(Chat(1, "/noclip", "#103"), 1);
strictEqual(g_Peer.MovementType, 2);

const g_GravityAction = g_FunActionsMenu.Items.find((Option) => Option.Value?.Name === "gravity");
strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "slay");
g_mapMenus.get(1).Options.SelectCallback(1, g_GravityAction.Value);
g_mapMenus.get(1).Options.SelectCallback(1, 103);
const g_GravityPresetMenu = g_mapMenus.get(1);
const g_LowGravity = g_GravityPresetMenu.Items.find((Option) => Option.Value === "0.1");
g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
const g_unRepliesBeforeImmunity = g_vecReplies.length;
g_GravityPresetMenu.Options.SelectCallback(1, g_LowGravity.Value);
strictEqual(g_vecReplies.slice(g_unRepliesBeforeImmunity).some((Reply) => /immune/.test(Reply[1])), true);
strictEqual(g_Peer.Gravity, 0.5);
g_mapPermissions.delete(3);

strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "slay");
g_mapMenus.get(1).Options.SelectCallback(1, g_GravityAction.Value);
g_mapMenus.get(1).Options.SelectCallback(1, 103);
const g_AllowedGravityMenu = g_mapMenus.get(1);
g_mapPermissions.get(1).delete("sourcejs.slay");
g_AllowedGravityMenu.Options.SelectCallback(1, g_LowGravity.Value);
strictEqual(g_Peer.Gravity, 0.5);
g_mapPermissions.get(1).add("sourcejs.slay");
g_AllowedGravityMenu.Options.SelectCallback(1, g_LowGravity.Value);
strictEqual(g_Peer.Gravity, Math.fround(0.1));
g_mapMenus.get(1).Options.SelectCallback(1, null);
strictEqual(g_mapMenus.get(1).Items.some((Option) => Option.Value?.Name === "freezebomb"), true);

const g_BlindAction = g_mapMenus.get(1).Items.find((Option) => Option.Value?.Name === "blind");
g_bHasFade = false;
strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "slay");
strictEqual(g_mapMenus.get(1).Items.some((Option) => Option.Value?.Name === "blind"), false);

g_bHasFade = true;
strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "slay");
const g_BlindMenuBot = AddPlayer(4, 904, "Blind menu bot");
g_BlindMenuBot.FakeClient = true;
AddPlayer(5, 905, "Live blind target");
g_Peer.Dead = true;
g_mapMenus.get(1).Options.SelectCallback(1, g_BlindAction.Value);
const g_BlindTargets = g_mapMenus.get(1);
strictEqual(g_BlindTargets.Items.some((Option) => Option.Value === 905), true);
strictEqual(g_BlindTargets.Items.some((Option) => Option.Value === 904), false);
strictEqual(g_BlindTargets.Items.some((Option) => Option.Value === 103), false);
g_Peer.Dead = false;
g_mapPlayers.delete(4);
g_mapPlayers.delete(5);

g_BlindTargets.Options.SelectCallback(1, null);
g_mapMenus.get(1).Options.SelectCallback(1, g_BlindAction.Value);
g_mapMenus.get(1).Options.SelectCallback(1, 103);
const g_BlindPresetMenu = g_mapMenus.get(1);
deepStrictEqual(g_BlindPresetMenu.Items.map((Option) => Option.Value), ["255", "240", "0", null]);

const g_unActionsBeforeUnavailableBlind = g_vecActions.length;
g_bHasFade = false;
g_BlindPresetMenu.Options.SelectCallback(1, "240");
strictEqual(g_vecActions.length, g_unActionsBeforeUnavailableBlind);
g_bHasFade = true;
g_BlindPresetMenu.Options.SelectCallback(1, "240");
deepStrictEqual(g_vecActions.at(-1), ["fade", 3, 240, g_unExpectedBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds]);
g_mapMenus.get(1).Options.SelectCallback(1, null);

const g_FreezeBombAction = g_mapMenus.get(1).Items.find((Option) => Option.Value?.Name === "freezebomb");
g_mapMenus.get(1).Options.SelectCallback(1, g_FreezeBombAction.Value);
const g_FreezeBombTargets = g_mapMenus.get(1);
strictEqual(g_FreezeBombTargets.Items.some((Option) => Option.Value === 102), false);
g_FreezeBombTargets.Options.SelectCallback(1, 103);
const g_MenuFreezeBomb = g_vecRepeatingTasks.at(-1);
g_MenuFreezeBomb.Callback();
strictEqual(g_Peer.RenderColor.Blue, 255);
strictEqual(Chat(1, "/freezebomb", "#103", "0"), 1);
strictEqual(g_MenuFreezeBomb.Callback, null);
strictEqual(g_Peer.RenderColor.Blue, 7);
g_mapMenus.get(1).Options.SelectCallback(1, null);

const g_SlapAction = g_mapMenus.get(1).Items.find((Option) => Option.Value?.Name === "slap");
g_mapMenus.get(1).Options.SelectCallback(1, g_SlapAction.Value);
const g_SlapDamageMenu = g_mapMenus.get(1);
deepStrictEqual(g_SlapDamageMenu.Items.map((Option) => Option.Value), ["0", "1", "5", "10", "20", "50", "99", null]);
g_SlapDamageMenu.Options.SelectCallback(1, "5");
const g_SlapTargets = g_mapMenus.get(1);
strictEqual(g_SlapTargets.Options.Title, "Slap player: 5 damage");
strictEqual(g_SlapTargets.Items.some((Option) => Option.Value === 102), false);
const g_nHealthBeforeMenuSlap = g_Peer.Health;
g_mapPermissions.get(1).delete("sourcejs.slay");
g_SlapTargets.Options.SelectCallback(1, 103);
strictEqual(g_Peer.Health, g_nHealthBeforeMenuSlap);
g_mapPermissions.get(1).add("sourcejs.slay");
g_SlapTargets.Options.SelectCallback(1, 103);
strictEqual(g_Peer.Health, g_nHealthBeforeMenuSlap - 5);
g_Peer.Health = g_nHealthBeforeMenuSlap;
g_mapMenus.get(1).Options.SelectCallback(1, null);
strictEqual(g_mapMenus.get(1).Options.Title, "Slap damage");
g_mapMenus.get(1).Options.SelectCallback(1, null);

const g_RenameAction = g_mapMenus.get(1).Items.find((Option) => Option.Value?.Name === "rename");
g_mapMenus.get(1).Options.SelectCallback(1, g_RenameAction.Value);
strictEqual(g_mapMenus.get(1).Items.some((Option) => Option.Value === 102), true);
g_mapMenus.delete(1);

g_Target.Dead = false;
strictEqual(Chat(1, "/beacon", "#103", "1"), 1);
const g_RoundBeacon = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/freeze", "#103", "10"), 1);
const g_RoundFreeze = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/timebomb", "#102", "1"), 1);
const g_RoundTimeBomb = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/firebomb", "#102", "1"), 1);
const g_RoundFireBomb = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/freezebomb", "#102", "1"), 1);
const g_RoundFreezeBomb = g_vecRepeatingTasks.at(-1);

const g_unBeforeDeniedDrug = g_vecRepeatingTasks.length;
strictEqual(Chat(2, "/drug", "#103", "1"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(g_vecRepeatingTasks.length, g_unBeforeDeniedDrug);

const g_vecDrugRolls = [];
g_Peer.GetEyeAngles = () => ({ Pitch: -10, Yaw: 270, Roll: 0 });
g_Peer.Teleport = (Position, Angles, Velocity) => {
	strictEqual(Position, null);
	strictEqual(Velocity, null);
	strictEqual(Angles.Pitch, -10);
	strictEqual(Angles.Yaw, 270);
	g_vecDrugRolls.push(Angles.Roll);

	return true;
};

strictEqual(Chat(1, "/drug", "#103", "1"), 1);
const g_DrugTask = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/drug", "#103", "1"), 1);
strictEqual(g_vecRepeatingTasks.at(-1), g_DrugTask);

const g_unDrugFixturePulseCount = 10;
const g_flExpectedDrugPulseSeconds = 255 / 512;
const g_vecExpectedDrugPulseFade = ["fade", 3, 128, 0x02, g_flExpectedDrugPulseSeconds, g_flExpectedDrugPulseSeconds];
const g_vecExpectedDrugClearFade = ["fade", 3, 0, 0x11, 3, 3];
for (let unPulse = 0; unPulse < g_unDrugFixturePulseCount; ++unPulse) {
	g_DrugTask.Callback();
	deepStrictEqual(g_vecActions.at(-1), g_vecExpectedDrugPulseFade);
}

strictEqual(g_vecDrugRolls.length, g_unDrugFixturePulseCount);
strictEqual(g_vecDrugRolls.every((flRollDegrees) => Number.isInteger(flRollDegrees) && ((flRollDegrees % 5) === 0) && (Math.abs(flRollDegrees) <= 25)), true);

strictEqual(Chat(1, "/drug", "#103", "0"), 1);
strictEqual(g_DrugTask.Callback, null);
strictEqual(g_vecDrugRolls.at(-1), 0);
deepStrictEqual(g_vecActions.at(-1), g_vecExpectedDrugClearFade);

strictEqual(Chat(1, "/drug", "#103", "1"), 1);
const g_DeathDrug = g_vecRepeatingTasks.at(-1);
g_DeathDrug.Callback();
g_Peer.Dead = true;
g_DeathDrug.Callback();
strictEqual(g_DeathDrug.Callback, null);
strictEqual(g_vecDrugRolls.at(-1), 0);
deepStrictEqual(g_vecActions.at(-1), g_vecExpectedDrugClearFade);
g_Peer.Dead = false;

strictEqual(Chat(1, "/drug", "#103"), 1);
const g_RoundDrug = g_vecRepeatingTasks.at(-1);
g_RoundDrug.Callback();
strictEqual(g_Peer.MovementType, 0);
const g_unActionsBeforeRoundEnd = g_vecActions.length;
g_mapEventListeners.get("round_end")();

for (const Task of [g_RoundBeacon, g_RoundFreeze, g_RoundTimeBomb, g_RoundFireBomb, g_RoundFreezeBomb, g_RoundDrug]) {
	strictEqual(Task.Callback, null);
}

strictEqual(g_Peer.MovementType, 2);
strictEqual(g_Peer.RenderColor.Blue, 7);
deepStrictEqual(g_vecActions.slice(g_unActionsBeforeRoundEnd).find((Action) => Action[0] === "fade"), g_vecExpectedDrugClearFade);
strictEqual(g_vecDrugRolls.at(-1), 0);

strictEqual(Chat(1, "/beacon", "#102", "1"), 1);
const g_FailingBeacon = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/beacon", "#103", "1"), 1);
const g_LaterBeacon = g_vecRepeatingTasks.at(-1);
const g_ColorBeforeFailedCleanup = { ...g_Target.RenderColor };
strictEqual(Chat(1, "/timebomb", "#102", "1"), 1);
const g_FailingBomb = g_vecRepeatingTasks.at(-1);
g_FailingBomb.Callback();
notDeepStrictEqual({ ...g_Target.RenderColor }, g_ColorBeforeFailedCleanup);
strictEqual(Chat(1, "/firebomb", "#102", "1"), 1);
const g_SamePlayerBomb = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/freezebomb", "#103", "1"), 1);
const g_OtherPlayerBomb = g_vecRepeatingTasks.at(-1);
strictEqual(Chat(1, "/freeze", "#103", "10"), 1);
const g_FailingFreeze = g_vecRepeatingTasks.at(-1);
strictEqual(g_Peer.MovementType, 0);
strictEqual(Chat(1, "/drug", "#103", "1"), 1);
const g_FailingDrug = g_vecRepeatingTasks.at(-1);
g_FailingDrug.Callback();

const g_BeaconFailure = new Error("beacon disposal failed");
const g_BombFailure = new Error("timebomb disposal failed");
const g_DrugFailure = new Error("drug disposal failed");
const g_FreezeFailure = new Error("freeze disposal failed");
const g_vecStaleCallbacks = [];

for (const [Task, Failure] of [[g_FailingBeacon, g_BeaconFailure], [g_FailingBomb, g_BombFailure], [g_FailingDrug, g_DrugFailure], [g_FailingFreeze, g_FreezeFailure]]) {
	g_vecStaleCallbacks.push(Task.Callback);
	const Dispose = Task.DisposeRepeatingTickTask.bind(Task);
	Task.DisposeRepeatingTickTask = () => {
		Dispose();
		throw Failure;
	};
}

const g_unActionsBeforeFailedCleanup = g_vecActions.length;
throws(() => g_mapEventListeners.get("round_end")(), (Failure) => {
	strictEqual(Failure.message, "Could not clear all Fun Commands effects.");
	const [BeaconFailures, TimedEffectFailures, FreezeFailures] = Failure.errors;
	deepStrictEqual(Array.from(BeaconFailures.errors), [g_BeaconFailure]);
	deepStrictEqual(Array.from(TimedEffectFailures.errors, (PlayerFailure) => PlayerFailure.errors[0]), [g_BombFailure, g_DrugFailure]);
	deepStrictEqual(Array.from(FreezeFailures.errors), [g_FreezeFailure]);

	return true;
});

for (const Task of [g_FailingBeacon, g_LaterBeacon, g_FailingBomb, g_SamePlayerBomb, g_OtherPlayerBomb, g_FailingDrug, g_FailingFreeze]) {
	strictEqual(Task.Callback, null);
}

deepStrictEqual({ ...g_Target.RenderColor }, g_ColorBeforeFailedCleanup);
strictEqual(g_Peer.MovementType, 2);
strictEqual(g_Peer.RenderColor.Blue, 7);
strictEqual(g_vecDrugRolls.at(-1), 0);
deepStrictEqual(g_vecActions.slice(g_unActionsBeforeFailedCleanup).find((Action) => Action[0] === "fade"), g_vecExpectedDrugClearFade);

strictEqual(Chat(1, "/freeze", "#103", "10"), 1);
const g_ReplacementFreeze = g_vecRepeatingTasks.at(-1);
const g_unActionsBeforeStaleCallbacks = g_vecActions.length;
for (const Callback of g_vecStaleCallbacks) {
	Callback();
}

strictEqual(g_vecActions.length, g_unActionsBeforeStaleCallbacks);
strictEqual(g_Peer.MovementType, 0);
strictEqual(typeof g_ReplacementFreeze.Callback, "function");
strictEqual(Chat(1, "/freeze", "#103", "0"), 1);
strictEqual(g_ReplacementFreeze.Callback, null);

const g_vecDeathEventTasks = [];
const g_vecDeathEventCallbacks = [];
const g_ColorBeforeDeathEvent = { ...g_Peer.RenderColor };

for (const strEffect of ["beacon", "timebomb", "firebomb", "freezebomb", "freeze", "drug"]) {
	strictEqual(Chat(1, `/${strEffect}`, "#103", "1"), 1);
	const Task = g_vecRepeatingTasks.at(-1);
	g_vecDeathEventTasks.push(Task);
	g_vecDeathEventCallbacks.push(Task.Callback);

	if (strEffect !== "freeze") {
		Task.Callback();
	}
}

strictEqual(Chat(1, "/beacon", "#102", "1"), 1);
const g_SurvivorBeacon = g_vecRepeatingTasks.at(-1);
g_mapEventListeners.get("player_death")({ GetEventInteger: (strKey) => ({ userid: 903, attacker: 102 })[strKey] ?? 0 });
strictEqual(g_vecDeathEventTasks.every((Task) => typeof Task.Callback === "function"), true);

const g_unBeforeDeathRollClear = g_vecDrugRolls.length;
g_Peer.Dead = true;
g_Peer.MovementType = 0;
const g_unBeforeDeathEvent = g_vecActions.length;
g_mapEventListeners.get("player_death")({ GetEventInteger: (strKey) => ({ userid: 103, attacker: 102 })[strKey] ?? 0 });
strictEqual(g_vecDeathEventTasks.every((Task) => Task.Callback === null), true);
strictEqual(typeof g_SurvivorBeacon.Callback, "function");
strictEqual(g_Peer.MovementType, 0);
deepStrictEqual({ ...g_Peer.RenderColor }, g_ColorBeforeDeathEvent);
deepStrictEqual(g_vecDrugRolls.slice(g_unBeforeDeathRollClear), [0]);
deepStrictEqual(g_vecActions.slice(g_unBeforeDeathEvent).find((Action) => Action[0] === "fade"), g_vecExpectedDrugClearFade);

g_Peer.Dead = false;
g_Peer.MovementType = 2;
strictEqual(Chat(1, "/beacon", "#103", "1"), 1);
const g_RespawnBeacon = g_vecRepeatingTasks.at(-1);
const g_unBeforeStaleDeathCallbacks = g_vecActions.length;
for (const Callback of g_vecDeathEventCallbacks) {
	Callback();
}

strictEqual(g_vecActions.length, g_unBeforeStaleDeathCallbacks);
strictEqual(typeof g_RespawnBeacon.Callback, "function");
strictEqual(Chat(1, "/beacon", "#103", "0"), 1);
strictEqual(Chat(1, "/beacon", "#102", "0"), 1);

strictEqual(Chat(1, "/drug", "#103", "1"), 1);
const g_ReplacedDrugTask = g_vecRepeatingTasks.at(-1);
g_ReplacedDrugTask.Callback();
const g_unBeforeDrugSlotReuse = g_vecDrugRolls.length;
const g_unActionsBeforeDrugSlotReuse = g_vecActions.length;
g_Peer.UserID = 903;
g_ReplacedDrugTask.Callback();
strictEqual(g_ReplacedDrugTask.Callback, null);
strictEqual(g_vecDrugRolls.length, g_unBeforeDrugSlotReuse);
strictEqual(g_vecActions.slice(g_unActionsBeforeDrugSlotReuse).some((Action) => Action[0] === "fade"), false);
g_Peer.UserID = 103;

strictEqual(Chat(1, "/drug", "#103", "1"), 1);
const g_PreviousDrug = g_vecRepeatingTasks.at(-1);
const g_PreviousDrugCallback = g_PreviousDrug.Callback;
g_PreviousDrugCallback();
g_Peer.UserID = 903;
strictEqual(Chat(1, "/drug", "#903"), 1);
match(g_vecReplies.at(-1)[1], /started 1, cancelled 0/);
const g_ReplacementDrug = g_vecRepeatingTasks.at(-1);
strictEqual(g_PreviousDrug.Callback, null);
const g_unBeforeStaleDrug = g_vecActions.length;
g_PreviousDrugCallback();
strictEqual(g_vecActions.length, g_unBeforeStaleDrug);

g_ReplacementDrug.Callback();
deepStrictEqual(g_vecActions.at(-1), g_vecExpectedDrugPulseFade);
strictEqual(Chat(1, "/drug", "#903", "0"), 1);
g_Peer.UserID = 103;

const g_unBeforeFadeOnlyDrugRolls = g_vecDrugRolls.length;
g_Peer.Teleport = (Position, Angles) => {
	strictEqual(Position, null);
	g_vecDrugRolls.push(Angles.Roll);

	return false;
};

strictEqual(Chat(1, "/drug", "#103", "1"), 1);
const g_FadeOnlyDrugTask = g_vecRepeatingTasks.at(-1);
g_FadeOnlyDrugTask.Callback();
g_FadeOnlyDrugTask.Callback();
deepStrictEqual(g_vecActions.slice(-2), [g_vecExpectedDrugPulseFade, g_vecExpectedDrugPulseFade]);
strictEqual(Chat(1, "/drug", "#103", "0"), 1);
strictEqual(g_vecDrugRolls.length, g_unBeforeFadeOnlyDrugRolls + 1);
deepStrictEqual(g_vecActions.at(-1), g_vecExpectedDrugClearFade);

delete g_Peer.Teleport;
delete g_Peer.GetEyeAngles;

strictEqual(Chat(1, "/gag", "#102"), 1);
strictEqual(Chat(2, "ordinary chat"), 1);
strictEqual(Chat(1, "/ungag", "#102"), 1);
strictEqual(Chat(2, "ordinary chat"), 0);

g_bMuteRejected = true;
strictEqual(Chat(1, "/silence", "#102"), 1);
match(g_vecReplies.at(-1)[1], /Could not mute/);
strictEqual(Chat(2, "still allowed after rejected voice mute"), 0);

g_bMuteRejected = false;
strictEqual(Chat(1, "/silence", "#102"), 1);
strictEqual(Chat(2, "ordinary chat"), 1);
const g_unMuteOperations = g_vecMuteReceivers.length;
strictEqual(Chat(1, "/silence", "#102"), 1);
strictEqual(g_vecMuteReceivers.length, g_unMuteOperations);

const g_NewListener = AddPlayer(4, 904, "New voice listener");
g_mapListeners.get("active")(4);
deepStrictEqual(g_vecMuteReceivers.at(-1), [2, [4]]);
g_NewListener.FakeClient = true;
g_mapListeners.get("active")(4);
strictEqual(g_vecMuteReceivers.length, g_unMuteOperations + 1);

const g_unBeforeLevelVoiceRoutes = g_vecMuteReceivers.length;
g_mapListeners.get("level-end")();
g_setRefusingVoiceReceivers.add(1);

try {
	g_mapListeners.get("level-start")();
	deepStrictEqual(g_vecMuteReceivers.slice(g_unBeforeLevelVoiceRoutes), [[2, [3]]]);
	strictEqual(Chat(2, "gag persists across the map"), 1);
} finally {
	g_setRefusingVoiceReceivers.clear();
}

const g_unBeforeReplacementVoiceRoutes = g_vecMuteReceivers.length;
g_mapPlayers.set(2, { ...g_Target, UserID: 902 });
g_mapListeners.get("level-start")();
strictEqual(g_vecMuteReceivers.length, g_unBeforeReplacementVoiceRoutes);
strictEqual(Chat(2, "the replacement is not gagged"), 0);
g_mapPlayers.set(2, g_Target);
strictEqual(Chat(1, "/unsilence", "#102"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["mute", 2], ["unmute", 2]]);

function OpenCommunicationMenu(unUserID) {
	strictEqual(Chat(1, "/admin"), 1);
	g_mapMenus.get(1).Options.SelectCallback(1, "chat");
	const ActionMenu = g_mapMenus.get(1);
	ActionMenu.Options.SelectCallback(1, ActionMenu.Items.find((Option) => Option.Value?.Name === "gag").Value);

	const TargetMenu = g_mapMenus.get(1);
	strictEqual(TargetMenu.Items.some((Option) => Option.Value === 904), false);
	TargetMenu.Options.SelectCallback(1, unUserID);

	return g_mapMenus.get(1);
}

const g_CommunicationMenu = OpenCommunicationMenu(102);
deepStrictEqual(g_CommunicationMenu.Items.map((Option) => Option.Value), ["mute", "gag", "silence", null]);
g_mapPermissions.get(1).delete("sourcejs.chat");
g_CommunicationMenu.Options.SelectCallback(1, "gag");
strictEqual(Chat(2, "still allowed"), 0);
g_mapPermissions.get(1).add("sourcejs.chat");
g_CommunicationMenu.Options.SelectCallback(1, "gag");
strictEqual(Chat(2, "gagged from the menu"), 1);
const g_GaggedMenu = OpenCommunicationMenu(102);
deepStrictEqual(g_GaggedMenu.Items.map((Option) => Option.Value), ["mute", "ungag", "silence", null]);
strictEqual(Chat(1, "/mute", "#102"), 1);
g_GaggedMenu.Options.SelectCallback(1, "ungag");
deepStrictEqual(g_mapMenus.get(1).Items.map((Option) => Option.Value), ["unmute", "ungag", "unsilence", null]);
strictEqual(Chat(2, "still gagged"), 1);

const g_StaleCommunicationMenu = g_mapMenus.get(1);
g_mapPermissions.set(2, new Set(["sourcejs.immunity"]));
g_StaleCommunicationMenu.Options.SelectCallback(1, "unsilence");
match(g_vecReplies.at(-1)[1], /immune player/);
strictEqual(Chat(2, "still gagged after immunity was granted"), 1);
g_mapPermissions.delete(2);

const g_PendingCommunicationMenu = OpenCommunicationMenu(102);
g_mapListeners.get("disconnect")(2);
g_Target.UserID = 902;
g_PendingCommunicationMenu.Options.SelectCallback(1, "unsilence");
match(g_vecReplies.at(-1)[1], /No matching player/);
strictEqual(Chat(2, "new connection"), 0);
g_Target.UserID = 102;
g_mapPlayers.delete(4);
g_mapMenus.delete(1);

g_mapPermissions.set(2, new Set(["sourcejs.immunity"]));
strictEqual(Chat(1, "/ban", "#102", "10"), 1);
match(g_vecReplies.at(-1)[1], /immune/);
g_mapPermissions.delete(2);
strictEqual(Chat(1, "!ban", "#102", "15", "rules"), 0);
deepStrictEqual(g_vecActions.slice(-2), [["ban", 102, 15, false, false], ["kick", 102, "rules"]]);

strictEqual(Chat(1, "/cvar", "rcon_password"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs.password/);

const g_unActionsBeforeUnsafeConfig = g_vecActions.length;
strictEqual(RunServerCommand("execcfg", "../unsafe.cfg"), 1);
strictEqual(g_vecActions.length, g_unActionsBeforeUnsafeConfig);

const g_unBeforeOfflineBan = g_vecActions.length;
strictEqual(Chat(1, "/addban", "0", "[U:1:2468]"), 1);
match(g_vecReplies.at(-1)[1], /permission/i);

g_mapPermissions.get(1).add("sourcejs.rcon");
g_mapOfflinePermissions.set("STEAM_0:0:1234", new Set(["sourcejs.immunity"]));
strictEqual(Chat(1, "/addban", "0", "[U:1:2468]"), 1);
match(g_vecReplies.at(-1)[1], /immune/);
strictEqual(Chat(1, "/addban", "0", "[U:1:4294967296]"), 1);
match(g_vecReplies.at(-1)[1], /Steam2 or Steam3/);
strictEqual(RunServerCommand("addban", "0", "[U:1:2468]", "line\nbreak"), 1);
match(g_vecReplies.at(-1)[1], /single line/);
strictEqual(g_vecActions.length, g_unBeforeOfflineBan);
g_mapOfflinePermissions.clear();
g_mapOfflinePermissions.set("76561197960268196", new Set(["sourcejs.immunity"]));
strictEqual(Chat(1, "/addban", "0", "STEAM_1:0:1234"), 1);
match(g_vecReplies.at(-1)[1], /immune/);
strictEqual(g_vecActions.length, g_unBeforeOfflineBan);
g_mapOfflinePermissions.clear();

g_mapConVars.set("sv_lan", { Exists: true, Value: "1" });
strictEqual(RunServerCommand("addban", "0", "[U:1:2468]"), 1);
match(g_vecReplies.at(-1)[1], /unavailable in LAN mode/);
strictEqual(RunServerCommand("unban", "[U:1:2468]"), 1);
match(g_vecReplies.at(-1)[1], /unavailable in LAN mode/);
strictEqual(g_vecActions.length, g_unBeforeOfflineBan);
g_mapConVars.delete("sv_lan");

strictEqual(Chat(1, "/addban", "15", "[U:1:2469]", "test"), 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeOfflineBan), [["engine", "banid 15 STEAM_1:1:1234"]]);
strictEqual(RunServerCommand("addban", "0", "[U:1:2468]"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["engine", "banid 0 STEAM_1:0:1234"], ["engine", "writeid"]]);
strictEqual(RunServerCommand("unban", "[U:1:2468]"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["engine", "removeid STEAM_1:0:1234"], ["engine", "writeid"]]);
strictEqual(RunServerCommand("banip", "192.0.2.43", "3"), 1);
deepStrictEqual(g_vecActions.at(-1), ["engine", "addip 3 192.0.2.43"]);

const g_unBeforeMalformedUnban = g_vecActions.length;
strictEqual(RunServerCommand("unban", "192.0.2.43", "extra"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_unban/);
strictEqual(g_vecActions.length, g_unBeforeMalformedUnban);

g_setRejectedEngineCommands.add("writeip");
strictEqual(RunServerCommand("banip", "192.0.2.43", "0"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["engine", "addip 0 192.0.2.43"], ["engine", "writeip"]]);
match(g_vecReplies.at(-1)[1], /ban-list write request/);
g_setRejectedEngineCommands.clear();
strictEqual(RunServerCommand("unban", "192.0.2.43"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["engine", "removeip 192.0.2.43"], ["engine", "writeip"]]);
g_mapPermissions.get(1).delete("sourcejs.rcon");

const g_unBeforeInvalidIP = g_vecActions.length;
strictEqual(Chat(1, "/banip", "192.0.2.43", "5"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs.rcon/);

for (const strAddress of ["0", "0.0.0.0", "000.00.0.000"]) {
	strictEqual(RunServerCommand("banip", strAddress, "5"), 1);
	match(g_vecReplies.at(-1)[1], /unspecified IPv4/);
}

strictEqual(g_vecActions.length, g_unBeforeInvalidIP);

let g_unAddressReads = 0;
Object.defineProperty(g_Target, "RemoteAddress", {
	configurable: true,
	enumerable: true,
	get() {
		return (++g_unAddressReads === 1) ? "192.0.2.43:27015" : "192.0.2.44:27015";
	},
});

try {
	strictEqual(Chat(1, "/banip", "#102", "5", "IP rule"), 1);
	deepStrictEqual(g_vecActions.slice(g_unBeforeInvalidIP), [["engine", "addip 5 192.0.2.44"], ["kick", 102, "IP rule"]]);

	const unBeforeImmuneIP = g_vecActions.length;
	g_mapPermissions.set(2, new Set(["sourcejs.immunity"]));
	strictEqual(Chat(1, "/banip", "#102", "5"), 1);
	match(g_vecReplies.at(-1)[1], /immune player/);
	strictEqual(g_vecActions.length, unBeforeImmuneIP);
	g_mapPermissions.delete(2);

	Object.defineProperty(g_Target, "RemoteAddress", {
		configurable: true,
		enumerable: true,
		get() {
			g_Target.UserID = 902;

			return "192.0.2.43:27015";
		},
	});

	strictEqual(Chat(1, "/banip", "#102", "5"), 1);
	match(g_vecReplies.at(-1)[1], /no longer connected/);
	strictEqual(g_vecActions.length, unBeforeImmuneIP);
} finally {
	g_Target.UserID = 102;
	delete g_Target.RemoteAddress;
	g_mapPermissions.delete(2);
}

const g_strActivityBeforeBan = g_ShowActivity.Value;
g_ShowActivity.Value = "13";
g_mapPermissions.set(3, new Set(["sourcejs.admin"]));
const g_unBeforeBanActivity = g_vecChatDeliveries.length;
const g_OriginalTargetBan = g_Target.Ban;
g_Target.Ban = () => false;
strictEqual(Chat(1, "/ban", "#102", "1", "private reason"), 1);
match(g_vecReplies.at(-1)[1], /Could not ban this player/);
strictEqual(g_vecChatDeliveries.length, g_unBeforeBanActivity);

g_Target.Ban = g_OriginalTargetBan;
strictEqual(Chat(1, "/ban", "#102", "1", "private reason"), 1);
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeBanActivity), [
	[[3], "[SourceJS] Operator: Submitted a ban for Test Player (for 1 minute)."],
	[[2], "[SourceJS] Admin: Submitted a ban for Test Player (for 1 minute)."],
]);

g_mapPermissions.delete(3);
g_ShowActivity.Value = g_strActivityBeforeBan;

const g_OriginalTargetKick = g_Target.Kick;
g_Target.Kick = () => {
	throw new Error("Disconnected");
};

strictEqual(RunServerCommand("ban", "#102", "0"), 1);
deepStrictEqual(g_vecActions.slice(-2), [["ban", 102, 0, false, false], ["engine", "writeid"]]);
match(g_vecReplies.at(-1)[1], /Ban submitted.*kick was not confirmed/);
g_Target.Kick = g_OriginalTargetKick;

const g_TestConVar = { Exists: true, Flags: 0, Value: "initial", DefaultValue: "initial" };
g_mapConVars.set("sourcejs_test_convar", g_TestConVar);
g_ShowActivity.Value = "13";
g_mapPermissions.set(3, new Set(["sourcejs.admin"]));
const g_unBeforeConVarActivity = g_vecChatDeliveries.length;
strictEqual(Chat(2, "/cvar", "sourcejs_test_convar", "denied"), 1);
match(g_vecReplies.at(-1)[1], /permission/i);
strictEqual(g_TestConVar.Value, "initial");

g_TestConVar.RejectWrite = true;
strictEqual(Chat(1, "/cvar", "sourcejs_test_convar", "refused"), 1);
match(g_vecReplies.at(-1)[1], /ConVar write was not accepted/);
strictEqual(g_TestConVar.Value, "initial");
delete g_TestConVar.RejectWrite;
strictEqual(g_vecChatDeliveries.length, g_unBeforeConVarActivity);

strictEqual(Chat(1, "/cvar", "sourcejs_test_convar", "changed"), 1);
strictEqual(g_TestConVar.Value, "changed");
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeConVarActivity), [
	[[3], "[SourceJS] Operator: Changed ConVar sourcejs_test_convar."],
	[[2], "[SourceJS] Admin: Changed ConVar sourcejs_test_convar."],
]);

const g_unBeforeUnchangedConVar = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/cvar", "sourcejs_test_convar", "changed"), 1);
strictEqual(g_vecChatDeliveries.length, g_unBeforeUnchangedConVar);
strictEqual(Chat(1, "/cvar", "sourcejs_test_convar"), 1);
match(g_vecReplies.at(-1)[1], /sourcejs_test_convar = changed/);

strictEqual(Chat(1, "/resetcvar", "sourcejs_test_convar", "extra"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_resetcvar/);
strictEqual(g_TestConVar.Value, "changed");
strictEqual(Chat(1, "/resetcvar", "sourcejs_test_convar"), 1);
strictEqual(g_TestConVar.Value, "initial");
deepStrictEqual(g_vecChatDeliveries.slice(g_unBeforeUnchangedConVar), [
	[[3], "[SourceJS] Operator: Reset ConVar sourcejs_test_convar."],
	[[2], "[SourceJS] Admin: Reset ConVar sourcejs_test_convar."],
]);
g_mapPermissions.delete(3);
g_ShowActivity.Value = "0";

strictEqual(Chat(1, "/cvar", "protect", "sourcejs_test_convar"), 1);
match(g_vecReplies.at(-1)[1], /only be configured from the server console/);
strictEqual(Chat(1, "/cvar", "sourcejs_test_convar", "before_protection"), 1);
strictEqual(g_TestConVar.Value, "before_protection");
strictEqual(RunServerCommand("cvar", "protect", "SOURCEJS_TEST_CONVAR"), 1);
match(g_vecReplies.at(-1)[1], /restricted to the server console/);

for (const vecArguments of [["/cvar", "sourcejs_test_convar"], ["/cvar", "SourceJS_Test_ConVar", "denied"], ["/resetcvar", "sourcejs_test_convar"]]) {
	strictEqual(Chat(1, ...vecArguments), 1);
	match(g_vecReplies.at(-1)[1], /restricted to the server console/);
}

strictEqual(g_TestConVar.Value, "before_protection");
strictEqual(RunServerCommand("resetcvar", "sourcejs_test_convar"), 1);
strictEqual(g_TestConVar.Value, "initial");
strictEqual(g_vecChatDeliveries.length, g_unBeforeUnchangedConVar + 2);
g_ShowActivity.Value = "15";
strictEqual(Chat(1, "/cvar", "SJS_SHOW_ACTIVITY"), 1);
match(g_vecReplies.at(-1)[1], /restricted to the server console/);

const g_PasswordConVar = g_mapConVars.get("rcon_password");
const g_unBeforeProtectedConVarActivity = g_vecChatDeliveries.length;
strictEqual(Chat(1, "/cvar", "rcon_password", "denied"), 1);
strictEqual(g_PasswordConVar.Value, "not public");
g_mapPermissions.get(1).add("sourcejs.password");
strictEqual(Chat(1, "/cvar", "rcon_password"), 1);
match(g_vecReplies.at(-1)[1], /protected; its value is not displayed/);
strictEqual(RunServerCommand("cvar", "rcon_password"), 1);
match(g_vecReplies.at(-1)[1], /protected; its value is not displayed/);
strictEqual(Chat(1, "/cvar", "rcon_password", "new_secret"), 1);
strictEqual(g_PasswordConVar.Value, "new_secret");
match(g_vecReplies.at(-1)[1], /rcon_password updated/);
doesNotMatch(g_vecReplies.at(-1)[1], /new_secret/);
strictEqual(g_vecChatDeliveries.length, g_unBeforeProtectedConVarActivity);
g_PasswordConVar.Value = "not public";
g_mapPermissions.get(1).delete("sourcejs.password");

const g_CheatConVar = { Exists: true, Flags: g_unCheatConVarFlag, Value: "0", DefaultValue: "0" };
g_mapConVars.set("sourcejs_test_cheat", g_CheatConVar);
g_mapPermissions.get(1).delete("sourcejs.cheats");
strictEqual(Chat(1, "/cvar", "sourcejs_test_cheat", "1"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs.cheats/);
strictEqual(g_CheatConVar.Value, "0");

g_mapPermissions.get(1).add("sourcejs.cheats");
strictEqual(Chat(1, "/cvar", "sourcejs_test_cheat", "1"), 1);
strictEqual(g_CheatConVar.Value, "1");

for (const strConVarName of ["servercfgfile", "lservercfgfile"]) {
	const ConVar = { Exists: true, Flags: 0, Value: "server.cfg", DefaultValue: "server.cfg" };
	g_mapConVars.set(strConVarName, ConVar);
	strictEqual(Chat(1, "/cvar", strConVarName, "match.cfg"), 1);
	match(g_vecReplies.at(-1)[1], /requires sourcejs.config/);
	strictEqual(Chat(1, "/resetcvar", strConVarName), 1);
	match(g_vecReplies.at(-1)[1], /requires sourcejs.config/);
	strictEqual(ConVar.Value, "server.cfg");

	for (const strValue of ["match.cfg;echo", "../match.cfg", "match.cfg\n", '"match.cfg"']) {
		strictEqual(RunServerCommand("cvar", strConVarName.toUpperCase(), strValue), 1);
		match(g_vecReplies.at(-1)[1], /without a directory/);
		strictEqual(ConVar.Value, "server.cfg");
	}

	strictEqual(RunServerCommand("cvar", strConVarName, "match.cfg"), 1);
	strictEqual(ConVar.Value, "match.cfg");
	strictEqual(RunServerCommand("cvar", strConVarName, ""), 1);
	strictEqual(ConVar.Value, "");
	strictEqual(RunServerCommand("resetcvar", strConVarName), 1);
	strictEqual(ConVar.Value, "server.cfg");
}

strictEqual(RunServerCommand("sql_reload"), 1);
match(g_vecReplies.at(-1)[1], /SQL administration is disabled/);
strictEqual(RunServerCommand("create_adm_tables"), 1);
match(g_vecReplies.at(-1)[1], /SQL administration is disabled/);

g_mapConVars.get("sjs_sql_admin_enabled").Value = "1";
strictEqual(RunServerCommand("create_adm_tables"), 1);
deepStrictEqual(g_vecActions.at(-1), ["sql-schema", "create"]);
match(g_vecReplies.at(-1)[1], /tables are ready/);

strictEqual(RunServerCommand("sql_addgroup", "Operators", "sourcejs.kick"), 1);
strictEqual(RunServerCommand("sql_addadmin", "76561197960265934", "Operators"), 1);
strictEqual(RunServerCommand("who", "#103"), 1);
deepStrictEqual(g_vecReplies.at(-1), [0, "#103 Test Peer: kick"]);
strictEqual(Chat(3, "/kick", "#102", "SQL test"), 1);
deepStrictEqual(g_vecActions.at(-1), ["kick", 102, "SQL test"]);

strictEqual(RunServerCommand("update_adm_tables", "unexpected"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_update_adm_tables/);
strictEqual(RunServerCommand("update_adm_tables"), 1);
deepStrictEqual(g_vecActions.at(-1), ["sql-schema", "update"]);
match(g_vecReplies.at(-1)[1], /schema is up to date/);
strictEqual(Chat(3, "/kick", "#102", "SQL grant survived"), 1);
deepStrictEqual(g_vecActions.at(-1), ["kick", 102, "SQL grant survived"]);

strictEqual(RunServerCommand("sql_delgroup", "Operators"), 1);
strictEqual(RunServerCommand("who", "#103"), 1);
deepStrictEqual(g_vecReplies.at(-1), [0, "#103 Test Peer: no bundled command permissions"]);
strictEqual(Chat(3, "/kick", "#102"), 1);
match(g_vecReplies.at(-1)[1], /permission/);

strictEqual(RunServerCommand("sql_addgroup", "Immune", "sourcejs.immunity"), 1);
strictEqual(RunServerCommand("sql_addadmin", "76561197960268196", "Immune"), 1);
g_mapPermissions.get(1).add("sourcejs.rcon");
const g_unBeforeSQLBanDenial = g_vecActions.length;
strictEqual(Chat(1, "/addban", "0", "[U:1:2468]"), 1);
match(g_vecReplies.at(-1)[1], /immune/);
strictEqual(g_vecActions.length, g_unBeforeSQLBanDenial);
g_mapPermissions.get(1).delete("sourcejs.rcon");
strictEqual(RunServerCommand("sql_delgroup", "Immune"), 1);

const g_unBeforeCombinedAdminReload = g_unAuthorizationReloads;
const g_setOperatorReloadPermissions = g_mapPermissions.get(1);
g_setOperatorReloadPermissions.add("sourcejs.config");
g_bDeferSQLSynchronization = true;

try {
	strictEqual(Chat(2, "/reloadadmins"), 1);
	match(g_vecReplies.at(-1)[1], /permission/);
	strictEqual(g_unAuthorizationReloads, g_unBeforeCombinedAdminReload);
	strictEqual(g_SQLSynchronizationCallback, null);

	strictEqual(Chat(1, "/reloadadmins", "unexpected"), 1);
	match(g_vecReplies.at(-1)[1], /Usage: sjs_reloadadmins/);
	strictEqual(g_unAuthorizationReloads, g_unBeforeCombinedAdminReload);

	strictEqual(Chat(1, "/reloadadmins"), 1);
	match(g_vecReplies.at(-1)[1], /Authorization configuration read/);
	strictEqual(g_unAuthorizationReloads, g_unBeforeCombinedAdminReload + 1);
	const FailedSQLSynchronization = g_SQLSynchronizationCallback;
	g_SQLSynchronizationCallback = null;
	FailedSQLSynchronization(new Error("Database unavailable"));
	match(g_vecReplies.at(-1)[1], /SQL administrator permissions could not be refreshed/);

	strictEqual(Chat(1, "/reloadadmins"), 1);
	const StaleSQLSynchronization = g_SQLSynchronizationCallback;
	g_SQLSynchronizationCallback = null;
	const unBeforeStaleReply = g_vecReplies.length;
	const CurrentOperator = g_mapPlayers.get(1);
	AddPlayer(1, 901, "Replacement operator");

	try {
		StaleSQLSynchronization(null);
		strictEqual(g_vecReplies.length, unBeforeStaleReply);
	} finally {
		g_mapPlayers.set(1, CurrentOperator);
	}

	strictEqual(RunServerCommand("reloadadmins"), 1);
	const ConsoleSQLSynchronization = g_SQLSynchronizationCallback;
	g_SQLSynchronizationCallback = null;
	ConsoleSQLSynchronization(null);
	deepStrictEqual(g_vecReplies.at(-1), [0, "SQL administrator permissions refreshed."]);
	strictEqual(g_unAuthorizationReloads, g_unBeforeCombinedAdminReload + 3);
} finally {
	g_bDeferSQLSynchronization = false;
	g_setOperatorReloadPermissions.delete("sourcejs.config");
}

g_mapConVars.set("nextlevel", { Exists: true, Value: "" });
g_mapConVars.get("sjs_nextmap_enabled").Value = "1";
g_mapListeners.get("level-start")();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
strictEqual(Chat(2, "/nextmap"), 1);
match(g_vecReplies.at(-1)[1], /Next map: map_two/);

const g_unExpectedDefaultVoteTimeoutSeconds = 20;
const g_unChatMessagesBeforeVote = g_vecChatMessages.length;
strictEqual(Chat(1, "/votekick", "#103", "reason"), 1);
strictEqual(g_vecChatMessages.length, g_unChatMessagesBeforeVote);
const g_VoteMenu = g_mapMenus.get(2);
strictEqual(g_VoteMenu.constructor, SimpleRadioMenu);
strictEqual(g_VoteMenu.UseTextDialogFallback, false);
strictEqual(RenderMenuText(g_VoteMenu.Options.Title), "Kick Test Peer?");
strictEqual(g_VoteMenu.Options.Timeout, g_unExpectedDefaultVoteTimeoutSeconds);
deepStrictEqual(g_VoteMenu.Items.map((Option) => [Option.ChoiceIndex, RenderMenuText(Option.Text)]), [[1, "Yes"], [2, "No"]]);

const g_unActionsBeforeVoteSelection = g_vecActions.length;
g_bSoundPrecached = false;
g_VoteMenu.Options.SelectCallback(0, g_VoteMenu.Items[0].Value);
g_VoteMenu.Options.SelectCallback(2, g_VoteMenu.Items[0].Value);
g_VoteMenu.Options.SelectCallback(2, g_VoteMenu.Items[1].Value);
g_mapMenus.get(3).Options.SelectCallback(3, g_VoteMenu.Items[0].Value);
deepStrictEqual(g_vecActions.slice(g_unActionsBeforeVoteSelection), [
	["precache-sound", "buttons/button14.wav", true, undefined],
	["sound", "buttons/button14.wav", 2],
	["sound", "buttons/button14.wav", 3],
]);

g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["kick", 103, "reason"]);
strictEqual(g_mapMenus.size, 0);

g_VoteMenu.Options.SelectCallback(2, g_VoteMenu.Items[0].Value);
deepStrictEqual(g_vecActions.at(-1), ["kick", 103, "reason"]);
strictEqual(Chat(2, "/revote"), 1);
match(g_vecReplies.at(-1)[1], /No vote is in progress/);
strictEqual(RunServerCommand("revote"), 1);
match(g_vecReplies.at(-1)[1], /only available in-game/);

strictEqual(Chat(1, "/vote", "Color?", "Blue", "Red"), 1);
const g_RevoteDelay = g_vecDelayed.at(-1);
g_RevoteDelay.TimeRemainingSeconds = 7.75;
const g_RedrawMenu = g_mapMenus.get(2);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(g_mapMenus.has(2), false);

const g_unActionsBeforeRedraw = g_vecActions.length;
strictEqual(Chat(2, "/revote"), 1);
strictEqual(g_mapMenus.get(2), g_RedrawMenu);
strictEqual(g_unLastVoteMenuTimeout, 7);
strictEqual(g_RedrawMenu.Timeout, g_unExpectedDefaultVoteTimeoutSeconds);
strictEqual(g_vecDelayed.at(-1), g_RevoteDelay);
strictEqual(g_vecActions.length, g_unActionsBeforeRedraw);
g_RedrawMenu.Options.SelectCallback(2, 1);
g_RedrawMenu.Options.SelectCallback(2, 0);
deepStrictEqual(g_vecActions.slice(g_unActionsBeforeRedraw), [["sound", "buttons/button14.wav", 2]]);
strictEqual(Chat(3, "/votefor", "2"), 1);
g_RevoteDelay.Callback();
match(g_vecChatMessages.at(-1), /Vote result: Red \(2\/2\)/);

strictEqual(Chat(1, "/vote", "Again?", "Blue", "Red"), 1);
const g_FailedRevoteDelay = g_vecDelayed.at(-1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_bVoteMenuSendSucceeds = false;
strictEqual(Chat(2, "/revote"), 1);
match(g_vecReplies.at(-1)[1], /could not reopen/);

g_bVoteMenuSendSucceeds = true;
strictEqual(Chat(3, "/votefor", "1"), 1);
g_FailedRevoteDelay.TimeRemainingSeconds = 0;
strictEqual(Chat(3, "/revote"), 1);
match(g_vecReplies.at(-1)[1], /expired/);
g_FailedRevoteDelay.Callback();
match(g_vecChatMessages.at(-1), /Vote result: Blue \(2\/2\)/);

for (const bRadioAvailable of [true, false]) {
	g_bHasShowMenu = bRadioAvailable;
	g_setFailingMenuRecipients.add(1);
	g_setRejectedMenuRecipients.add(2);
	g_setFailingMenuClosures.add(1);

	try {
		strictEqual(Chat(1, "/vote", '"Partial delivery?"'), 1);
		deepStrictEqual([...g_mapMenus.keys()], [3]);
		const PartialVote = g_mapMenus.get(3);
		const PartialVoteDeadline = g_vecDelayed.at(-1);
		strictEqual(PartialVote.constructor, bRadioAvailable ? SimpleRadioMenu : SimpleESCMenu);
		PartialVote.Options.SelectCallback(1, 1);
		strictEqual(Chat(2, "/votefor", "2"), 1);
		match(g_vecReplies.at(-1)[1], /not eligible/);
		PartialVote.Options.SelectCallback(3, 0);
		strictEqual(PartialVoteDeadline.Callback, null);
		match(g_vecChatMessages.at(-1), /Vote result: Yes \(1\/1\)/);
	} finally {
		g_setFailingMenuRecipients.clear();
		g_setRejectedMenuRecipients.clear();
		g_setFailingMenuClosures.clear();
	}
}

strictEqual(Chat(1, "/vote", "Closing menus?"), 1);
g_setFailingMenuClosures.add(1);
g_setFailingMenuClosures.add(2);

try {
	strictEqual(Chat(2, "/votefor", "1"), 1);
	match(g_vecReplies.at(-1)[1], /Vote recorded/);
	g_vecDelayed.at(-1).Callback();
	match(g_vecChatMessages.at(-1), /Vote result: Yes \(1\/1\)/);
	strictEqual(g_mapMenus.size, 0);
} finally {
	g_setFailingMenuClosures.clear();
}

g_bHasShowMenu = false;
strictEqual(Chat(1, "/votekick", "#103"), 1);
strictEqual(g_mapMenus.get(2).constructor, SimpleESCMenu);
strictEqual(g_mapMenus.get(2).UseTextDialogFallback, false);
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.CloseText), "Skip vote");

const g_OriginalVoter = g_mapPlayers.get(2);
g_mapPlayers.set(2, { ...g_OriginalVoter, UserID: 902 });
strictEqual(Chat(2, "/revote"), 1);
match(g_vecReplies.at(-1)[1], /not eligible/);
g_mapPlayers.set(2, g_OriginalVoter);

const g_unActionsBeforeManualVote = g_vecActions.length;
g_mapMenus.get(2).Options.SelectCallback(2, 99);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(g_vecActions.length, g_unActionsBeforeManualVote);
strictEqual(g_mapMenus.has(2), false);

g_vecDelayed.at(-1).TimeRemainingSeconds = 0.3;
strictEqual(Chat(2, "/revote"), 1);
strictEqual(g_mapMenus.get(2).constructor, SimpleESCMenu);
strictEqual(g_unLastVoteMenuTimeout, 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(g_vecActions.length, g_unActionsBeforeManualVote);
strictEqual(g_mapMenus.has(2), false);

g_bSoundPrecached = false;
g_bSoundPrecacheSucceeds = false;
g_mapMenus.get(3).Options.SelectCallback(3, 0);
strictEqual(g_vecActions.slice(g_unActionsBeforeManualVote).some((Action) => Action[0] === "sound"), false);
g_bSoundPrecached = true;
g_bSoundPrecacheSucceeds = true;
g_mapListeners.get("level-end")();
strictEqual(g_vecDelayed.at(-1).Callback, null);
strictEqual(g_mapMenus.size, 0);

const g_MenuSounds = g_mapConVars.get("sjs_menu_sounds");
strictEqual(g_MenuSounds.Value, "1");
strictEqual(Chat(1, "/vote", '"Sound configuration unavailable?"'), 1);
const g_VoteWithoutSoundConfiguration = g_mapMenus.get(2);
const g_VoteWithoutSoundDeadline = g_vecDelayed.at(-1);
const g_MenuSoundValueDescriptor = Object.getOwnPropertyDescriptor(g_MenuSounds, "Value");
Object.defineProperty(g_MenuSounds, "Value", {
	get() {
		throw new Error("Sound configuration failed.");
	},
});

try {
	g_VoteWithoutSoundConfiguration.Options.SelectCallback(1, 0);
	g_VoteWithoutSoundConfiguration.Options.SelectCallback(2, 0);
	g_VoteWithoutSoundConfiguration.Options.InteractionCallback(3, "Exit");
	strictEqual(g_VoteWithoutSoundDeadline.Callback, null);
	match(g_vecChatMessages.at(-1), /Vote result: Yes \(2\/2\)/);
} finally {
	Object.defineProperty(g_MenuSounds, "Value", g_MenuSoundValueDescriptor);
}

g_strVoteMenuSoundOverride = "buttons/custom.wav";
g_bSoundPrecached = false;
const g_unBeforeMapMenuSound = g_vecActions.length;
g_mapListeners.get("level-start")();
deepStrictEqual(g_vecActions.slice(g_unBeforeMapMenuSound).filter((Action) => (Action[0] === "precache-sound") && (Action[1] === "buttons/custom.wav")), [["precache-sound", "buttons/custom.wav", true, undefined]]);

strictEqual(Chat(1, "/vote", "Menu sounds?"), 1);
const g_unBeforeDisabledMenuSound = g_vecActions.length;
g_MenuSounds.Value = "0";
g_mapMenus.get(2).Options.SelectCallback(2, 0);
strictEqual(g_vecActions.length, g_unBeforeDisabledMenuSound);
g_MenuSounds.Value = "1";
g_mapMenus.get(3).Options.SelectCallback(3, 0);
deepStrictEqual(g_vecActions.slice(g_unBeforeDisabledMenuSound), [["sound", "buttons/custom.wav", 3]]);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /Yes \(2\/2\)/);

g_mapListeners.get("level-end")();
g_strVoteMenuSoundOverride = "not_installed.wav";
g_bSoundPrecached = false;
const g_unBeforeMissingMenuSound = g_vecActions.length;
strictEqual(Chat(1, "/vote", "Missing sound?"), 1);
g_mapMenus.get(2).Options.SelectCallback(2, 1);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /No \(1\/1\)/);
deepStrictEqual(g_vecActions.slice(g_unBeforeMissingMenuSound).filter((Action) => Action[0] === "sound"), [["sound", "buttons/button14.wav", 2]]);

g_strVoteMenuSoundOverride = null;
g_mapListeners.get("level-end")();
g_bDefaultMenuSoundMissing = true;
const g_unBeforeFallbackMenuSound = g_vecActions.length;
strictEqual(Chat(1, "/vote", "Fallback sound?"), 1);
g_mapMenus.get(2).Options.SelectCallback(2, 0);
deepStrictEqual(g_vecActions.slice(g_unBeforeFallbackMenuSound).filter((Action) => Action[0] === "sound"), [["sound", "buttons/blip1.wav", 2]]);
strictEqual(Chat(1, "/cancelvote"), 1);
g_bDefaultMenuSoundMissing = false;
g_mapListeners.get("level-end")();

g_bDefaultMenuSoundMissing = true;
g_bBlipMenuSoundMissing = true;
g_bDefaultMenuExitSoundMissing = true;
g_bSoundPrecached = false;
g_MenuSounds.Value = "0";
const g_unBeforeBundledSound = g_vecActions.length;
g_mapListeners.get("level-start")();
strictEqual(g_setMenuSoundDownloads.has("sound/sourcejs/menu-select.wav"), true);
deepStrictEqual(g_vecActions.slice(g_unBeforeBundledSound).filter((Action) => Action[1] === "sourcejs/menu-select.wav"), [["precache-sound", "sourcejs/menu-select.wav", true, undefined]]);

g_MenuSounds.Value = "1";
strictEqual(Chat(1, "/vote", "Bundled fallback?"), 1);
const g_BundledSoundVote = g_mapMenus.get(2);
const g_unBeforeBundledBallot = g_vecActions.length;
g_BundledSoundVote.Options.SelectCallback(2, 0);
g_BundledSoundVote.Options.SelectCallback(2, 1);
deepStrictEqual(g_vecActions.slice(g_unBeforeBundledBallot), [["sound", "sourcejs/menu-select.wav", 2]]);
strictEqual(Chat(1, "/cancelvote"), 1);

g_mapListeners.get("level-end")();
g_bRejectMenuSoundDownload = true;
g_mapListeners.get("level-start")();
strictEqual(Chat(1, "/vote", "Download unavailable?"), 1);
const g_unBeforeRejectedSoundBallot = g_vecActions.length;
g_mapMenus.get(2).Options.SelectCallback(2, 0);
strictEqual(g_vecActions.length, g_unBeforeRejectedSoundBallot);
strictEqual(Chat(1, "/cancelvote"), 1);
g_bRejectMenuSoundDownload = false;
g_bDefaultMenuSoundMissing = false;
g_bBlipMenuSoundMissing = false;
g_bDefaultMenuExitSoundMissing = false;
g_mapListeners.get("level-end")();

g_bUseClientMenuSoundProfile = true;
g_bDefaultMenuSoundMissing = true;
g_bBlipMenuSoundMissing = true;
g_bDefaultMenuExitSoundMissing = true;
g_setMenuSoundDownloads.delete("sound/sourcejs/menu-select.wav");
try {
	const unBeforeClientMenuSounds = g_vecActions.length;
	g_mapListeners.get("level-start")();
	deepStrictEqual(g_vecActions.slice(unBeforeClientMenuSounds).filter((Action) => (Action[0] === "precache-sound") && Action[1].startsWith("UI/menu_")), [
		["precache-sound", "UI/menu_accept.wav", false, true],
		["precache-sound", "UI/menu_focus.wav", false, true],
		["precache-sound", "UI/menu_back.wav", false, true],
	]);
	strictEqual(g_setMenuSoundDownloads.has("sound/sourcejs/menu-select.wav"), false);

	strictEqual(Chat(1, "/admin"), 1);
	const Menu = g_mapMenus.get(1);
	const unBeforeInteraction = g_vecActions.length;
	Menu.Options.InteractionCallback(1, "Next");
	Menu.Options.InteractionCallback(1, "Back");
	Menu.Options.InteractionCallback(1, "ExitBack");
	Menu.CloseMenu(1);
	strictEqual(Chat(1, "/vote", "Client UI sound?"), 1);
	g_mapMenus.get(2).Options.SelectCallback(2, 0);
	deepStrictEqual(g_vecActions.slice(unBeforeInteraction).filter((Action) => Action[0] === "sound"), [
		["sound", "UI/menu_focus.wav", 1],
		["sound", "UI/menu_focus.wav", 1],
		["sound", "UI/menu_back.wav", 1],
		["sound", "UI/menu_accept.wav", 2],
	]);
	strictEqual(Chat(1, "/cancelvote"), 1);
} finally {
	g_bUseClientMenuSoundProfile = false;
	g_bDefaultMenuSoundMissing = false;
	g_bBlipMenuSoundMissing = false;
	g_bDefaultMenuExitSoundMissing = false;
	g_setPrecachedClientMenuSounds.clear();
	g_mapListeners.get("level-end")();
}

g_strSupportedVoteMenuSound = "";
strictEqual(Chat(1, "/vote", "Muted by GameData?"), 1);
const g_unBeforeSilentBallot = g_vecActions.length;
g_mapMenus.get(2).Options.SelectCallback(2, 0);
strictEqual(g_vecActions.length, g_unBeforeSilentBallot);
strictEqual(Chat(1, "/cancelvote"), 1);
g_strSupportedVoteMenuSound = null;
g_mapListeners.get("level-end")();

strictEqual(Chat(1, "/admin"), 1);
const g_AdminSoundMenu = g_mapMenus.get(1);
const g_unBeforeAdminMenuSound = g_vecActions.length;
g_AdminSoundMenu.Options.InteractionCallback(2, "Next");
g_AdminSoundMenu.Options.InteractionCallback(1, "Next");
g_AdminSoundMenu.Options.InteractionCallback(1, "Select", { Value: null });
deepStrictEqual(g_vecActions.slice(g_unBeforeAdminMenuSound), [["sound", "buttons/button14.wav", 1], ["sound", "buttons/combine_button7.wav", 1]]);

g_MenuSounds.Value = "0";
g_AdminSoundMenu.Options.InteractionCallback(1, "Exit");
strictEqual(g_vecActions.length, g_unBeforeAdminMenuSound + 2);

g_MenuSounds.Value = "1";
g_bDefaultMenuExitSoundMissing = true;
g_AdminSoundMenu.Options.InteractionCallback(1, "Exit");
deepStrictEqual(g_vecActions.at(-1), ["sound", "buttons/button14.wav", 1]);
g_bDefaultMenuExitSoundMissing = false;
g_AdminSoundMenu.CloseMenu(1);

g_bHasShowMenu = false;
LoadFile(join(g_strAdministrationRoot, "votes.js")).StartVote(1, "Paged ballot?", ["One", "Two", "Three", "Four", "Five", "Six"]);
const g_PagedVote = g_mapMenus.get(2);
strictEqual(g_PagedVote.constructor, PagedESCMenu);
strictEqual(RenderMenuText(g_PagedVote.Options.CloseText), "Skip vote");
const g_unBeforePagedVoteSound = g_vecActions.length;
g_PagedVote.Options.InteractionCallback(2, "Next");
g_PagedVote.Options.SelectCallback(2, 5);
g_PagedVote.Options.SelectCallback(2, 0);
deepStrictEqual(g_vecActions.slice(g_unBeforePagedVoteSound), [["sound", "buttons/button14.wav", 2], ["sound", "buttons/button14.wav", 2]]);
strictEqual(Chat(1, "/cancelvote"), 1);

const g_setVotePermissions = g_mapPermissions.get(1);
const g_KickVoteThreshold = g_mapConVars.get("sjs_vote_kick");
strictEqual(g_KickVoteThreshold.Value, "0.60");
const g_unActionsBeforeVotePolicies = g_vecActions.length;
strictEqual(Chat(1, "/votekick", "#103"), 1);
g_KickVoteThreshold.Value = "0.75";
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(Chat(1, "/votefor", "1"), 1);
strictEqual(Chat(3, "/votefor", "2"), 1);
strictEqual(g_vecDelayed.at(-1).Callback, null);
match(g_vecChatMessages.at(-1), /67% yes; 75% required/);
strictEqual(g_vecActions.length, g_unActionsBeforeVotePolicies);

g_KickVoteThreshold.Value = "1";
strictEqual(Chat(1, "/votekick", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["kick", 103, "Kicked by an administrator."]);
g_KickVoteThreshold.Value = "0.60";

g_mapConVars.get("sjs_voteban_time").Value = "45";
strictEqual(Chat(1, "/voteban", "#103", "vote rule"), 1);
match(RenderMenuText(g_mapMenus.get(2).Options.Title), /45 minutes/);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.slice(-2), [["ban", 103, 45, false, false], ["kick", 103, "vote rule"]]);

const g_VoteBanDuration = g_mapConVars.get("sjs_voteban_time");
g_VoteBanDuration.Value = "0";
strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(1, "/votefor", "1"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
const g_unBeforeDisconnectVoteBan = g_vecActions.length;
g_mapListeners.get("disconnect")(3);
deepStrictEqual(g_vecActions.slice(g_unBeforeDisconnectVoteBan), [["engine", "banid 0 STEAM_1:0:103"], ["engine", "writeid"]]);

g_VoteBanDuration.Value = "45";
strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
const g_unBeforeReusedSlotVoteBan = g_vecActions.length;
AddPlayer(3, 904, "Replacement ban target");
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.slice(g_unBeforeReusedSlotVoteBan), [["engine", "banid 45 STEAM_1:0:103"]]);
g_mapPlayers.set(3, g_Peer);

strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_mapOfflinePermissions.set(g_Peer.NetworkID, new Set(["sourcejs.immunity"]));
const g_unBeforeDeniedVoteBan = g_vecActions.length;
g_mapPlayers.delete(3);
throws(() => g_vecDelayed.at(-1).Callback(), /target account is immune/);
g_mapOfflinePermissions.delete(g_Peer.NetworkID);
g_mapPlayers.set(3, g_Peer);

strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_setVotePermissions.delete("sourcejs.ban");
g_mapPlayers.delete(3);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);
g_setVotePermissions.add("sourcejs.ban");
g_mapPlayers.set(3, g_Peer);

const g_strPeerNetworkID = g_Peer.NetworkID;
strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_Peer.NetworkID = "STEAM_1:0:999";
throws(() => g_vecDelayed.at(-1).Callback(), /Steam identity changed during the vote/);

g_Peer.NetworkID = "STEAM_ID_PENDING";
strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_mapPlayers.delete(3);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /disconnected target had no valid Steam ID/);
g_Peer.NetworkID = g_strPeerNetworkID;
g_mapPlayers.set(3, g_Peer);

strictEqual(Chat(1, "/voteban", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_mapConVars.set("sv_lan", { Exists: true, Value: "1" });
g_mapPlayers.delete(3);
throws(() => g_vecDelayed.at(-1).Callback(), /unavailable in LAN mode/);
g_mapConVars.delete("sv_lan");
g_mapPlayers.set(3, g_Peer);
strictEqual(g_vecActions.length, g_unBeforeDeniedVoteBan);

const g_unBeforeTargetVotes = g_vecActions.length;
strictEqual(Chat(1, "/voteburn", "#103", "3"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_voteburn <target>/);
strictEqual(Chat(1, "/voteslay", "@all"), 1);
match(g_vecReplies.at(-1)[1], /Ambiguous target/);

g_Peer.Dead = true;
strictEqual(Chat(1, "/voteburn", "#103"), 1);
match(g_vecReplies.at(-1)[1], /requires a live target/);
g_Peer.Dead = false;

g_setVotePermissions.delete("sourcejs.slay");
strictEqual(Chat(1, "/voteslay", "#103"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs\.slay/);
g_setVotePermissions.add("sourcejs.slay");
strictEqual(g_mapMenus.size, 0);
strictEqual(g_vecActions.length, g_unBeforeTargetVotes);

strictEqual(Chat(1, "/voteburn", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_Peer.Dead = true;
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /target is no longer alive/);
strictEqual(g_vecActions.length, g_unBeforeTargetVotes);
g_Peer.Dead = false;

strictEqual(Chat(1, "/voteslay", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
const g_ReplacementVoteTarget = AddPlayer(3, 903, "Replacement vote target");
throws(() => g_vecDelayed.at(-1).Callback(), /target player is no longer connected/);
strictEqual(g_ReplacementVoteTarget.Dead, false);
strictEqual(g_vecActions.length, g_unBeforeTargetVotes);
g_mapPlayers.set(3, g_Peer);

const g_flExpectedVoteBurnSeconds = 19.8;
const g_BurnDuration = g_mapConVars.get("sjs_burn_duration");
const g_strPreviousBurnDuration = g_BurnDuration.Value;
g_BurnDuration.Value = "2";
strictEqual(Chat(1, "/voteburn", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_BurnDuration.Value = "7";
const g_unDeliveriesBeforeVoteBurn = g_vecChatDeliveries.length;
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.slice(g_unBeforeTargetVotes), [["ignite", 103, g_flExpectedVoteBurnSeconds]]);
strictEqual(g_vecChatDeliveries.slice(g_unDeliveriesBeforeVoteBurn).some(([, strText]) => strText.includes("Ignited 1 player(s)")), false);

strictEqual(Chat(1, "/burn", "#103"), 1);
deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, 7]);
g_BurnDuration.Value = g_strPreviousBurnDuration;

strictEqual(Chat(1, "/voteslay", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["slay", 103]);
strictEqual(g_Peer.Dead, true);
strictEqual(g_mapMenus.size, 0);
g_Peer.Dead = false;

g_mapConVars.set("sv_gravity", { Exists: true, Value: "800" });
AddPlayer(4, 104, "Extra voter");
strictEqual(Chat(1, "/votegravity", "100", "200", "300"), 1);
strictEqual(Chat(1, "/votefor", "1"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(Chat(3, "/votefor", "2"), 1);
strictEqual(Chat(4, "/votefor", "3"), 1);
strictEqual(g_vecDelayed.at(-1).Callback, null);
strictEqual(g_mapConVars.get("sv_gravity").Value, "100");
g_mapPlayers.delete(4);

strictEqual(Chat(1, "/votegravity", "500"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(Chat(3, "/votefor", "2"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("sv_gravity").Value, "100");
match(g_vecChatMessages.at(-1), /without a winner/);

const g_GravityVoteConVar = g_mapConVars.get("sv_gravity");
const g_OriginalRandom = runInContext("Math.random", g_Context);

try {
	runInContext("Math.random = () => 0.999", g_Context);
	strictEqual(Chat(1, "/votegravity", "100", "200", "300", "400", "500", "ignored"), 1);
	deepStrictEqual(g_mapMenus.get(2).Items.map((Option) => Option.Text), ["100", "200", "300", "400", "500"]);
	strictEqual(Chat(1, "/votefor", "1"), 1);
	strictEqual(Chat(2, "/votefor", "2"), 1);
	g_vecDelayed.at(-1).Callback();
	strictEqual(g_GravityVoteConVar.Value, "200");
	match(g_vecChatMessages.at(-1), /sv_gravity set to 200/);
} finally {
	runInContext("Math", g_Context).random = g_OriginalRandom;
}

strictEqual(Chat(1, "/votegravity", "200", "invalid"), 1);
match(g_vecReplies.at(-1)[1], /Gravity/);
strictEqual(g_mapMenus.size, 0);

strictEqual(Chat(1, "/votegravity", "600"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_setVotePermissions.delete("sourcejs.cvar");
g_vecDelayed.at(-1).Callback();
strictEqual(g_GravityVoteConVar.Value, "200");
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);
g_setVotePermissions.add("sourcejs.cvar");

const g_RefusingGravity = {
	Exists: true,
	get Value() {
		return "200";
	},
	set Value(strValue) {
		strictEqual(strValue, "600");
	},
};

g_mapConVars.set("sv_gravity", g_RefusingGravity);
strictEqual(Chat(1, "/votegravity", "600"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
throws(() => g_vecDelayed.at(-1).Callback(), /engine rejected sv_gravity/);
strictEqual(g_RefusingGravity.Value, "200");
match(g_vecChatMessages.at(-1), /action could not be applied/);
strictEqual(g_mapMenus.size, 0);
g_mapConVars.set("sv_gravity", g_GravityVoteConVar);

const g_LivingVoice = { Exists: true, Value: "0" };
const g_DeadVoice = { Exists: true, Value: "1" };
const g_AllTalk = { Exists: true, Value: "0" };
g_mapConVars.set("sv_talk_enemy_living", g_LivingVoice);
g_mapConVars.set("sv_alltalk", g_AllTalk);
strictEqual(Chat(1, "/votealltalk", "unexpected"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_votealltalk/);
strictEqual(g_mapMenus.size, 0);

strictEqual(Chat(1, "/votealltalk"), 1);
match(RenderMenuText(g_mapMenus.get(2).Options.Title), /Set sv_alltalk to 1/);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual([g_AllTalk.Value, g_LivingVoice.Value], ["1", "0"]);

g_mapConVars.delete("sv_alltalk");
strictEqual(Chat(1, "/votealltalk"), 1);
match(g_vecReplies.at(-1)[1], /does not expose the required ConVar/);
strictEqual(g_mapMenus.size, 0);

g_mapConVars.set("sv_talk_enemy_dead", g_DeadVoice);
strictEqual(Chat(1, "/votealltalk"), 1);
strictEqual(Chat(2, "/votefor", "2"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual([g_LivingVoice.Value, g_DeadVoice.Value], ["0", "1"]);
match(g_vecChatMessages.at(-1), /Vote did not pass/);

for (const strExpected of ["1", "0"]) {
	strictEqual(Chat(1, "/votealltalk"), 1);
	strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), `Set sv_talk_enemy_living and sv_talk_enemy_dead to ${strExpected}?`);
	strictEqual(Chat(2, "/votefor", "1"), 1);
	g_vecDelayed.at(-1).Callback();
	deepStrictEqual([g_LivingVoice.Value, g_DeadVoice.Value], [strExpected, strExpected]);
}

strictEqual(Chat(1, "/votealltalk"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_setVotePermissions.delete("sourcejs.cvar");
g_vecDelayed.at(-1).Callback();
deepStrictEqual([g_LivingVoice.Value, g_DeadVoice.Value], ["0", "0"]);
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);

strictEqual(Chat(1, "/votealltalk"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs\.cvar/);
strictEqual(g_mapMenus.size, 0);
g_setVotePermissions.add("sourcejs.cvar");

strictEqual(Chat(1, "/votealltalk"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_mapConVars.delete("sv_talk_enemy_dead");
throws(() => g_vecDelayed.at(-1).Callback(), /does not expose the required ConVar/);
strictEqual(g_LivingVoice.Value, "0");
match(g_vecChatMessages.at(-1), /action could not be applied/);

const g_RefusingVoice = {
	Exists: true,
	get Value() {
		return "0";
	},
	set Value(strValue) {
		strictEqual(strValue, "1");
	},
};

g_mapConVars.set("sv_talk_enemy_dead", g_RefusingVoice);
strictEqual(Chat(1, "/votealltalk"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
throws(() => g_vecDelayed.at(-1).Callback(), /engine rejected sv_talk_enemy_dead/);
deepStrictEqual([g_LivingVoice.Value, g_RefusingVoice.Value], ["0", "0"]);
strictEqual(g_mapMenus.size, 0);
g_mapConVars.delete("sv_talk_enemy_dead");
g_mapConVars.delete("sv_talk_enemy_living");

const g_FriendlyFireVoteConVar = g_mapConVars.get("mp_friendlyfire");
const g_strFriendlyFireBeforeVote = g_FriendlyFireVoteConVar.Value;
const g_strFriendlyFireAfterVote = (Number(g_strFriendlyFireBeforeVote) === 0) ? "1" : "0";
strictEqual(Chat(1, "/voteff"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_FriendlyFireVoteConVar.Value, g_strFriendlyFireAfterVote);
g_FriendlyFireVoteConVar.Value = g_strFriendlyFireBeforeVote;

strictEqual(Chat(1, "/votekick", "#103"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_setVotePermissions.delete("sourcejs.kick");
const g_unActionsBeforeRevocation = g_vecActions.length;
g_vecDelayed.at(-1).Callback();
strictEqual(g_vecActions.length, g_unActionsBeforeRevocation);
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);
g_setVotePermissions.add("sourcejs.kick");

g_setVotePermissions.delete("sourcejs.cvar");
strictEqual(Chat(1, "/vote", "Too early?"), 1);
match(g_vecReplies.at(-1)[1], /Wait 30 second/);
strictEqual(g_mapMenus.size, 0);

g_flServerTime = 29.1;
strictEqual(Chat(1, "/vote", "Still early?"), 1);
match(g_vecReplies.at(-1)[1], /Wait 1 second/);

g_flServerTime = 30;
strictEqual(Chat(1, "/vote", "Now?", '"Single answer"'), 1);
deepStrictEqual(g_mapMenus.get(2).Items.map((Option) => RenderMenuText(Option.Text)), ["Yes", "No"]);
strictEqual(Chat(1, "/cancelvote"), 1);
strictEqual(g_mapMenus.size, 0);
strictEqual(Chat(1, "/vote", "Immediately after cancelling?"), 1);
match(g_vecReplies.at(-1)[1], /Wait 30 second/);

g_setVotePermissions.add("sourcejs.vote_delay_bypass");
strictEqual(Chat(1, "/vote", "Bypass?"), 1);
g_setVotePermissions.delete("sourcejs.vote_delay_bypass");
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /No votes were cast/);

g_mapListeners.get("level-end")();
g_flServerTime = 0;
strictEqual(Chat(1, "/vote", "New map?"), 1);
strictEqual(g_mapMenus.size, 3);
strictEqual(Chat(1, "/cancelvote"), 1);

g_mapConVars.get("sjs_vote_delay").Value = "0";
strictEqual(Chat(1, "/vote", "Delay disabled?"), 1);
strictEqual(g_mapMenus.size, 3);
strictEqual(Chat(1, "/cancelvote"), 1);
g_mapConVars.get("sjs_vote_delay").Value = "30";
g_setVotePermissions.add("sourcejs.cvar");

strictEqual(Chat(1, "/vote", '"Disconnect and exit?"', "Keep", "Drop"), 1);
const g_EarlyVoteDelay = g_vecDelayed.at(-1);
strictEqual(Chat(2, "/votefor", "2"), 1);
strictEqual(Chat(1, "/votefor", "1"), 1);
g_mapListeners.get("disconnect")(2);
strictEqual(typeof g_EarlyVoteDelay.Callback, "function");
g_mapMenus.get(3).Options.InteractionCallback(3, "Exit");
strictEqual(g_EarlyVoteDelay.Callback, null);
strictEqual(g_mapMenus.size, 0);
match(g_vecChatMessages.at(-1), /Vote result: Keep \(1\/1\)/);

strictEqual(Chat(3, "/revote"), 1);
match(g_vecReplies.at(-1)[1], /No vote is in progress/);

const g_VoteProgressChat = g_mapConVars.get("sjs_vote_progress_chat");
const g_VoteProgressConsole = g_mapConVars.get("sjs_vote_progress_console");
const g_VoteProgressClientConsole = g_mapConVars.get("sjs_vote_progress_client_console");
const g_VoteProgressHint = g_mapConVars.get("sjs_vote_progress_hintbox");
const g_vecVoteProgressConVars = [g_VoteProgressChat, g_VoteProgressConsole, g_VoteProgressClientConsole, g_VoteProgressHint];
for (const ConVar of g_vecVoteProgressConVars) {
	strictEqual(ConVar.Value, "0");
}

const g_flPreviousVoteProgressTime = g_flServerTime;
const g_ProgressBot = AddPlayer(4, 604, "Progress bot");
g_ProgressBot.FakeClient = true;

try {
	strictEqual(Chat(1, "/vote", "Progress?", "Keep", "Drop"), 1);
	const ProgressVoteDelay = g_vecDelayed.at(-1);
	const unBeforeSilentVote = g_vecChatDeliveries.length;
	strictEqual(Chat(2, "/votefor", "1"), 1);
	strictEqual(g_vecChatDeliveries.length, unBeforeSilentVote);

	g_VoteProgressConsole.Value = "1";
	strictEqual(Chat(2, "/revote"), 1);
	const unBeforeConsoleVote = g_vecReplies.length;
	g_mapMenus.get(2).Options.SelectCallback(2, 1);
	deepStrictEqual(g_vecReplies.slice(unBeforeConsoleVote), [[0, "Test Player changed their vote to Drop."]]);
	strictEqual(g_vecChatDeliveries.length, unBeforeSilentVote);

	g_VoteProgressConsole.Value = "0";
	g_VoteProgressChat.Value = "1";
	g_VoteProgressClientConsole.Value = "1";
	g_mapMenus.get(3).Options.SelectCallback(3, 1);
	deepStrictEqual(g_vecChatDeliveries.at(-1), [[1, 2, 3], "[SourceJS] Test Peer voted for Drop."]);
	deepStrictEqual(g_vecReplies.slice(-3), [1, 2, 3].map((unIndex) => [unIndex, "[SourceJS] Test Peer voted for Drop.\n"]));

	g_VoteProgressHint.Value = "1";
	ProgressVoteDelay.TimeRemainingSeconds = 12;
	g_flServerTime += 1;
	const unBeforeProgressHint = g_vecActions.length;
	g_mapListeners.get("tick")();
	g_mapListeners.get("tick")();
	deepStrictEqual(g_vecActions.slice(unBeforeProgressHint).filter((Action) => Action[0] === "hint"), [["hint", [1, 2, 3], "Votes: 2/3 (12s left)\n1. Drop: 2"]]);

	g_bHintDeliveryThrows = true;
	strictEqual(Chat(1, "/votefor", "1"), 1);
	match(g_vecChatMessages.at(-1), /Vote result: Drop \(2\/3\)/);
	strictEqual(ProgressVoteDelay.Callback, null);
	g_bHintDeliveryThrows = false;

	g_flServerTime += 1;
	const unAfterProgressVote = g_vecActions.length;
	g_mapListeners.get("tick")();
	strictEqual(g_vecActions.slice(unAfterProgressVote).some((Action) => Action[0] === "hint"), false);

	g_VoteProgressChat.Value = "0";
	g_VoteProgressClientConsole.Value = "0";
	g_bHasHintText = false;
	const unBeforeUnsupportedHint = g_vecChatDeliveries.length;
	strictEqual(Chat(1, "/vote", "No hint support?"), 1);
	strictEqual(Chat(2, "/votefor", "1"), 1);
	g_flServerTime += 1;
	g_mapListeners.get("tick")();
	strictEqual(g_vecChatDeliveries.length, unBeforeUnsupportedHint);

	g_mapListeners.get("level-end")();
	strictEqual(g_mapMenus.size, 0);
} finally {
	g_bHasHintText = true;
	g_bHintDeliveryThrows = false;
	g_flServerTime = g_flPreviousVoteProgressTime;
	g_mapPlayers.delete(4);

	for (const ConVar of g_vecVoteProgressConVars) {
		ConVar.Value = "0";
	}
}

const g_unBeforeReusedVoterSlot = g_vecActions.length;
strictEqual(Chat(1, "/votekick", "#103"), 1);
const g_ReusedVoterSlotDelay = g_vecDelayed.at(-1);
const g_StaleVoteMenu = g_mapMenus.get(2);
strictEqual(Chat(2, "/votefor", "1"), 1);
AddPlayer(2, 902, "Replacement voter");

try {
	strictEqual(Chat(2, "/votefor", "2"), 1);
	match(g_vecReplies.at(-1)[1], /not eligible for an active vote/);
	strictEqual(Chat(2, "/revote"), 1);
	match(g_vecReplies.at(-1)[1], /not eligible for this vote/);
	g_StaleVoteMenu.Options.SelectCallback(2, 0);
	g_ReusedVoterSlotDelay.Callback();
	match(g_vecChatMessages.at(-1), /No votes were cast/);
	strictEqual(g_mapMenus.size, 0);
	strictEqual(g_vecActions.length, g_unBeforeReusedVoterSlot);
} finally {
	g_mapPlayers.set(2, g_Target);
}

strictEqual(Chat(1, "/votekick", "#103"), 1);
const g_MissingVoterDelay = g_vecDelayed.at(-1);
strictEqual(Chat(2, "/votefor", "2"), 1);
strictEqual(Chat(1, "/votefor", "1"), 1);
g_mapPlayers.delete(2);

try {
	g_MissingVoterDelay.Callback();
	deepStrictEqual(g_vecActions.slice(g_unBeforeReusedVoterSlot), [["kick", 103, "Kicked by an administrator."]]);
} finally {
	g_mapPlayers.set(2, g_Target);
}

const g_unBeforeMissingVoteInitiator = g_vecActions.length;
strictEqual(Chat(1, "/votekick", "#103"), 1);
const g_MissingVoteInitiatorDelay = g_vecDelayed.at(-1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_mapPlayers.delete(1);

try {
	g_MissingVoteInitiatorDelay.Callback();
	match(g_vecChatMessages.at(-1), /initiator no longer has permission/);
	strictEqual(g_vecActions.length, g_unBeforeMissingVoteInitiator);
} finally {
	g_mapPlayers.set(1, g_Operator);
}

strictEqual(Chat(1, "/vote", "Reopened?", "Keep", "Drop"), 1);
const g_ReopenedExitDelay = g_vecDelayed.at(-1);
g_mapMenus.get(3).Options.InteractionCallback(3, "Exit");
strictEqual(Chat(3, "/revote"), 1);
strictEqual(Chat(1, "/votefor", "1"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(typeof g_ReopenedExitDelay.Callback, "function");
strictEqual(Chat(3, "/votefor", "2"), 1);
strictEqual(g_ReopenedExitDelay.Callback, null);
match(g_vecChatMessages.at(-1), /Vote result: Keep \(2\/3\)/);

for (const bRadioAvailable of [true, false]) {
	g_bHasShowMenu = bRadioAvailable;
	const unBeforeReplacedBallot = g_vecActions.length;
	strictEqual(Chat(1, "/votekick", "#103"), 1);
	const ReplacedVoteDeadline = g_vecDelayed.at(-1);
	const ReplacedVoteMenu = g_mapMenus.get(1);
	strictEqual(ReplacedVoteMenu.constructor, bRadioAvailable ? SimpleRadioMenu : SimpleESCMenu);
	strictEqual(Chat(2, "/votefor", "2"), 1);
	strictEqual(Chat(1, "/admin"), 1);
	const ReplacementMenu = g_mapMenus.get(1);
	notStrictEqual(ReplacementMenu, ReplacedVoteMenu);
	ReplacedVoteMenu.Options.SelectCallback(1, 0);
	strictEqual(g_vecActions.length, unBeforeReplacedBallot);
	strictEqual(typeof ReplacedVoteDeadline.Callback, "function");

	const unBeforeVoteExit = g_vecActions.length;
	ReplacedVoteMenu.Options.InteractionCallback(3, "Exit");
	g_mapListeners.get("tick")();
	strictEqual(ReplacedVoteDeadline.Callback, null);
	strictEqual(g_mapMenus.get(1), ReplacementMenu);
	match(g_vecChatMessages.at(-1), /Vote did not pass: 0% yes/);
	strictEqual(g_vecActions.slice(unBeforeVoteExit).some((Action) => Action[0] === "kick"), false);
	ReplacementMenu.CloseMenu(1);

	strictEqual(Chat(1, "/vote", '"Reopen after replacement?"', "Keep", "Drop"), 1);
	const RecoveredVoteDeadline = g_vecDelayed.at(-1);
	const RecoveredVoteMenu = g_mapMenus.get(1);
	strictEqual(Chat(1, "/admin"), 1);
	g_mapListeners.get("tick")();
	strictEqual(typeof RecoveredVoteDeadline.Callback, "function");
	strictEqual(Chat(1, "/revote"), 1);
	strictEqual(g_mapMenus.get(1), RecoveredVoteMenu);
	strictEqual(Chat(2, "/votefor", "1"), 1);
	strictEqual(Chat(3, "/votefor", "2"), 1);
	strictEqual(typeof RecoveredVoteDeadline.Callback, "function");
	RecoveredVoteMenu.Options.SelectCallback(1, 0);
	strictEqual(RecoveredVoteDeadline.Callback, null);
	match(g_vecChatMessages.at(-1), /Vote result: Keep \(2\/3\)/);
}

g_bHasShowMenu = true;
const g_unBeforeDisconnectedInitiator = g_vecActions.length;
strictEqual(Chat(1, "/votekick", "#103"), 1);
const g_DisconnectedInitiatorDelay = g_vecDelayed.at(-1);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(Chat(3, "/votefor", "1"), 1);
g_mapListeners.get("disconnect")(1);
strictEqual(g_DisconnectedInitiatorDelay.Callback, null);
strictEqual(g_vecActions.length, g_unBeforeDisconnectedInitiator);
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);

const g_unExpectedMapCommandDelaySeconds = 3;
const g_unExpectedVotedMapChangeDelaySeconds = 5;
const g_unActionsBeforeMapCommand = g_vecActions.length;
const g_unRepliesBeforeMapCommand = g_vecReplies.length;
const g_unDeliveriesBeforeMapCommand = g_vecChatDeliveries.length;
g_bUserMessageReplies = true;
strictEqual(Chat(1, "!map", "map_two"), 0);
g_bUserMessageReplies = false;
const g_FirstMapDelay = g_vecDelayed.at(-1);
strictEqual(g_FirstMapDelay.Seconds, g_unExpectedMapCommandDelaySeconds);
strictEqual(g_vecActions.length, g_unActionsBeforeMapCommand);
match(g_vecChatMessages.at(-1), /Changing map to map_two in 3 seconds/);
deepStrictEqual(g_vecReplies.slice(g_unRepliesBeforeMapCommand), [[1, "[SourceJS] Changing map to map_two in 3 seconds."]]);
deepStrictEqual(g_vecChatDeliveries.slice(g_unDeliveriesBeforeMapCommand).map(([vecRecipients, strMessage]) => [[...vecRecipients].sort(), strMessage]), [[[2, 3], "[SourceJS] Changing map to map_two in 3 seconds."]]);

function SelectAdminAction(strCategory, strAction) {
	strictEqual(Chat(1, "/admin"), 1);
	g_mapMenus.get(1).Options.SelectCallback(1, strCategory);
	const ActionMenu = g_mapMenus.get(1);
	ActionMenu.Options.SelectCallback(1, ActionMenu.Items.find((Option) => (Option.Value?.Name === strAction) || (Option.Text === strAction)).Value);

	return g_mapMenus.get(1);
}

g_mapClientLanguages.set(1, "russian");
g_mapClientLanguages.set(2, "fr-FR");
g_mapClientLanguages.set(3, "japanese");

try {
	strictEqual(Chat(3, "/motd"), 1);
	deepStrictEqual(g_vecActions.at(-1), ["panel", 3, "info", "motd", "今日のメッセージ"]);

	strictEqual(Chat(1, "/admin"), 1);
	const RussianAdmin = g_mapMenus.get(1);
	strictEqual(RussianAdmin.Options.Title, "Администрирование SourceJS");
	RussianAdmin.Options.SelectCallback(1, "slay");
	strictEqual(g_mapMenus.get(1).Items.find((Option) => Option.Value?.Name === "beacon").Text, "Включить или выключить маяк");
	g_mapMenus.get(1).CloseMenu(1);

	for (const bRadio of [true, false]) {
		g_bHasShowMenu = bRadio;
		const BanTargets = SelectAdminAction("ban", "ban");
		BanTargets.Options.SelectCallback(1, 103);
		const BanDuration = g_mapMenus.get(1);
		strictEqual(BanDuration.Options.Title, "Срок блокировки: Test Peer");
		strictEqual(BanDuration.Items.find((Option) => Option.Value === "60").Text, "60 мин.");
		BanDuration.Options.SelectCallback(1, "60");
		const BanReasons = g_mapMenus.get(1);
		strictEqual(BanReasons.Options.Title, "Причина блокировки: Test Peer");
		strictEqual(BanReasons.Items.find((Option) => Option.Value === "Cheating").Text, "Читы");
		BanReasons.CloseMenu(1);
	}

	g_bHasShowMenu = true;

	strictEqual(Chat(1, "/vote", '"Leave my question untouched?"'), 1);
	const LocalizedVote = g_mapMenus.get(1);
	strictEqual(LocalizedVote.Options.Title, "Leave my question untouched?");
	strictEqual(RenderMenuText(LocalizedVote.Items[0].Text, 1), "Да");
	strictEqual(RenderMenuText(LocalizedVote.Items[0].Text, 2), "Oui");
	strictEqual(RenderMenuText(LocalizedVote.Items[0].Text, 3), "はい");
	strictEqual(Chat(1, "/cancelvote"), 1);

	const unBeforeLocalizedAnnouncement = g_vecActions.length;
	strictEqual(RunServerCommand("csay", "Keep this English {Player}"), 1);
	deepStrictEqual(g_vecActions.slice(unBeforeLocalizedAnnouncement).sort((Left, Right) => Left[1][0] - Right[1][0]), [
		["center", [1], "Консоль: Keep this English {Player}"],
		["center", [2], "Console: Keep this English {Player}"],
		["center", [3], "コンソール: Keep this English {Player}"],
	]);

	const unBeforeTranslatedMap = g_vecChatDeliveries.length;
	const unBeforeTranslatedReply = g_vecReplies.length;
	g_bUserMessageReplies = true;
	strictEqual(Chat(1, "!map", "map_two"), 0);
	g_bUserMessageReplies = false;
	deepStrictEqual(g_vecReplies.slice(unBeforeTranslatedReply), [[1, "[SourceJS] Переход на карту map_two через 3 сек."]]);
	const mapNotices = new Map(g_vecChatDeliveries.slice(unBeforeTranslatedMap).map(([[unRecipientIndex], strText]) => [unRecipientIndex, strText]));
	strictEqual(mapNotices.size, 2);
	strictEqual(mapNotices.get(2), "[SourceJS] Passage à la carte map_two dans 3 s.");
	strictEqual(mapNotices.get(3), "[SourceJS] 3 秒後にマップを map_two に変更します。");

	g_bUserMessageReplies = true;
	strictEqual(Chat(1, "/slay", "#123456"), 1);
	strictEqual(g_vecReplies.at(-1)[1], "[SourceJS] Подходящий игрок не найден.");
	g_bUserMessageReplies = false;
	strictEqual(Chat(1, "/slay", "#123456"), 1);
	strictEqual(g_vecReplies.at(-1)[1], "[SourceJS] No matching player.\n");
	strictEqual(g_mapClientCommands.get("sjs_slay")({ Index: 1, Arguments: ["sjs_slay", "#123456"] }), 1);
	strictEqual(g_vecReplies.at(-1)[1], "[SourceJS] No matching player.\n");
	strictEqual(RunServerCommand("slay", "#123456"), 1);
	deepStrictEqual(g_vecReplies.at(-1), [0, "No matching player."]);
} finally {
	g_mapClientLanguages.clear();
}

strictEqual(Chat(1, "/map", "map_three"), 1);
strictEqual(g_FirstMapDelay.Callback, null);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);

strictEqual(Chat(1, "/votemap", "map_two"), 1);
const g_MapVote = g_mapMenus.get(2);
g_bSoundDispatchThrows = true;
g_MapVote.Options.SelectCallback(2, 0);
g_MapVote.Options.SelectCallback(3, 0);
g_bSoundDispatchThrows = false;
g_vecDelayed.at(-1).Callback();
strictEqual(g_vecDelayed.at(-1).Seconds, g_unExpectedVotedMapChangeDelaySeconds);
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);
g_mapListeners.get("level-end")();
strictEqual(g_vecDelayed.at(-1).Callback, null);

const g_unBeforeRejectedMapVotes = g_vecActions.length;
strictEqual(Chat(1, "/votemap"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_votemap/);

strictEqual(Chat(1, "/votemap", "map_two"), 1);
const g_EmptyMapVote = g_vecDelayed.at(-1);
g_EmptyMapVote.Callback();
match(g_vecChatMessages.at(-1), /No votes were cast/);
strictEqual(g_vecDelayed.at(-1), g_EmptyMapVote);

strictEqual(Chat(1, "/votemap", "map_two"), 1);
const g_TiedApprovalMapVote = g_vecDelayed.at(-1);
strictEqual(Chat(1, "/votefor", "1"), 1);
strictEqual(Chat(2, "/votefor", "2"), 1);
g_TiedApprovalMapVote.Callback();
match(g_vecChatMessages.at(-1), /without a winner/);
strictEqual(g_vecDelayed.at(-1), g_TiedApprovalMapVote);

strictEqual(Chat(1, "/votemap", "map_two"), 1);
const g_CancelledMapVote = g_vecDelayed.at(-1);
const g_FinishCancelledMapVote = g_CancelledMapVote.Callback;
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(Chat(1, "/cancelvote"), 1);
strictEqual(g_CancelledMapVote.Callback, null);
g_FinishCancelledMapVote();
strictEqual(g_vecDelayed.at(-1), g_CancelledMapVote);
strictEqual(g_vecActions.length, g_unBeforeRejectedMapVotes);

const g_ContextMath = runInContext("Math", g_Context);
const g_OriginalContextRandom = g_ContextMath.random;
g_ContextMath.random = () => 0.75;

try {
	strictEqual(Chat(1, "/vote", '"Choose one"', "One", "Two", "Three", "Four", "Five", "Ignored"), 1);
	deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["One", "Two", "Three", "Four", "Five"]);
	strictEqual(Chat(1, "/votefor", "1"), 1);
	strictEqual(Chat(2, "/votefor", "2"), 1);
	g_vecDelayed.at(-1).Callback();
	match(g_vecChatMessages.at(-1), /Vote result: Two \(1\/2\)/);

	strictEqual(Chat(1, "/votemap", "map_two", "map_three", "map_four", "map_five", "map_one", "ignored_missing_map"), 1);
	deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_two", "map_three", "map_four", "map_five", "map_one"]);
	strictEqual(Chat(1, "/votefor", "1"), 1);
	strictEqual(Chat(2, "/votefor", "2"), 1);
	g_vecDelayed.at(-1).Callback();
	const VotedMapDelay = g_vecDelayed.at(-1);
	strictEqual(VotedMapDelay.Seconds, g_unExpectedVotedMapChangeDelaySeconds);
	strictEqual(g_vecActions.length, g_unBeforeRejectedMapVotes);
	match(g_vecChatMessages.at(-1), /Changing map to map_three in 5 seconds/);
	VotedMapDelay.Callback();
	deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);
} finally {
	g_ContextMath.random = g_OriginalContextRandom;
}

strictEqual(Chat(1, "/votemap", "map_two"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
g_setUnavailableMaps.add("map_two");
g_vecDelayed.at(-1).Callback();
g_setUnavailableMaps.delete("map_two");
match(g_vecChatMessages.at(-1), /did not accept the map change to map_two/);
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);

strictEqual(Chat(1, "/map", "map_two"), 1);
g_mapPermissions.get(1).delete("sourcejs.map");
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);
g_mapPermissions.get(1).add("sourcejs.map");

strictEqual(Chat(1, "/setnextmap", "map_two"), 1);
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);

g_ContextMath.random = () => 0;

const g_RotationChangeMode = { Immediately: 0, RoundEnd: 1, MapEnd: 2 };

function StartRotationTest(unChangeMode) {
	g_mapListeners.get("level-end")();

	g_flServerTime = 10;
	g_mapConVars.get("sjs_rockthevote").Value = "1";
	g_mapConVars.get("sjs_rtv_needed").Value = "0.60";
	g_mapConVars.get("sjs_rtv_minplayers").Value = "0";
	g_mapConVars.get("sjs_rtv_initialdelay").Value = "30";
	g_mapConVars.get("sjs_rtv_interval").Value = "240";
	g_mapConVars.get("sjs_rtv_changetime").Value = String(unChangeMode);
	g_mapConVars.get("sjs_rtv_postvoteaction").Value = "0";
	g_mapConVars.get("nextlevel").Value = "";

	g_mapListeners.get("level-start")();
}

StartRotationTest(g_RotationChangeMode.Immediately);
strictEqual(Chat(2, "RTV"), 0);
match(g_vecReplies.at(-1)[1], /opens in 30 second/);

g_flServerTime = 40;
g_mapConVars.get("sjs_rtv_minplayers").Value = "4";
strictEqual(Chat(2, "rockthevote"), 0);
match(g_vecReplies.at(-1)[1], /Not enough players/);

g_mapConVars.get("sjs_rtv_minplayers").Value = "0";
strictEqual(Chat(2, "rtv please"), 0);
strictEqual(Chat(2, "RoCkThEvOtE"), 0);
match(g_vecChatMessages.at(-1), /Test Player rocked the vote: 1\/2/);
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /already rocked the vote: 1\/2/);

strictEqual(Chat(1, "/vote", "Unrelated?"), 1);
strictEqual(Chat(3, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /already in progress/);

strictEqual(Chat(1, "/cancelvote"), 1);
strictEqual(Chat(3, "/rtv"), 1);
match(g_vecChatMessages.at(-1), /Test Peer rocked the vote: 2\/2/);
strictEqual(Chat(2, "/votefor", "1"), 1);
const g_ImmediateRotationVote = g_vecDelayed.at(-1);
g_ImmediateRotationVote.Callback();
const g_ImmediateRotationChange = g_vecDelayed.at(-1);
strictEqual(g_ImmediateRotationChange.Seconds, g_unExpectedMapCommandDelaySeconds);
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /already scheduled/);
g_ImmediateRotationChange.Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_two"]);

g_flServerTime = 279;
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /opens in 1 second/);

StartRotationTest(g_RotationChangeMode.RoundEnd);
g_flServerTime = 40;
g_mapConVars.get("sjs_rtv_needed").Value = "1";
strictEqual(Chat(1, "/rtv"), 1);
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(g_mapMenus.size, 0);
g_mapListeners.get("disconnect")(3);
strictEqual(g_mapMenus.has(3), false);
strictEqual(g_mapMenus.size, 2);
strictEqual(Chat(3, "/votefor", "1"), 1);
match(g_vecReplies.at(-1)[1], /not eligible/);
strictEqual(Chat(2, "/votefor", "2"), 1);
const g_RoundRotationVote = g_vecDelayed.at(-1);
g_RoundRotationVote.Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");
strictEqual(g_vecDelayed.at(-1), g_RoundRotationVote);

g_mapEventListeners.get("round_end")();
const g_RoundRotationChange = g_vecDelayed.at(-1);
strictEqual(g_RoundRotationChange.Seconds, g_unExpectedMapCommandDelaySeconds);
g_mapEventListeners.get("round_end")();
strictEqual(g_vecDelayed.at(-1), g_RoundRotationChange);
g_mapListeners.get("level-end")();
strictEqual(g_RoundRotationChange.Callback, null);

StartRotationTest(g_RotationChangeMode.MapEnd);
g_flServerTime = 40;
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(Chat(2, "/votefor", "2"), 1);
const g_MapEndRotationVote = g_vecDelayed.at(-1);
g_MapEndRotationVote.Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");
g_mapEventListeners.get("round_end")();
strictEqual(g_vecDelayed.at(-1), g_MapEndRotationVote);

g_flServerTime = 280;
g_mapConVars.get("sjs_rtv_postvoteaction").Value = "1";
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /next map has already been chosen/);

g_mapConVars.get("sjs_rtv_postvoteaction").Value = "0";
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(g_mapMenus.size, 0);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);

StartRotationTest(g_RotationChangeMode.RoundEnd);
g_flServerTime = 40;
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(Chat(1, "/map", "map_three"), 1);
const g_AdministratorMapChange = g_vecDelayed.at(-1);
g_mapEventListeners.get("round_end")();
strictEqual(g_vecDelayed.at(-1), g_AdministratorMapChange);
g_AdministratorMapChange.Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);

StartRotationTest(g_RotationChangeMode.RoundEnd);
g_flServerTime = 40;
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(Chat(2, "/votefor", "1"), 1);
const g_OverriddenRotationVote = g_vecDelayed.at(-1);
g_OverriddenRotationVote.Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
strictEqual(Chat(1, "/setnextmap", "map_three"), 1);
g_mapEventListeners.get("round_end")();
strictEqual(g_vecDelayed.at(-1), g_OverriddenRotationVote);

g_flServerTime = 280;
g_mapConVars.get("sjs_rtv_postvoteaction").Value = "1";
const g_RotationBot = AddPlayer(4, 104, "Rotation bot");
g_RotationBot.FakeClient = true;
const g_unBeforeBotRequest = g_vecChatMessages.length;
strictEqual(Chat(4, "/rtv"), 1);
strictEqual(g_vecChatMessages.length, g_unBeforeBotRequest);
strictEqual(g_mapMenus.size, 0);
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /closed because the next map has already been chosen/);
strictEqual(g_mapMenus.size, 0);

g_mapConVars.get("nextlevel").Value = "map_four";
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecChatMessages.at(-1), /1\/2/);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(g_mapMenus.size, 3);
strictEqual(g_mapMenus.has(4), false);

g_mapPlayers.delete(4);
g_mapListeners.get("level-end")();

StartRotationTest(g_RotationChangeMode.MapEnd);
g_flServerTime = 40;
strictEqual(Chat(1, "/setnextmap", "map_four"), 1);
const g_unMapChangesBeforeManualRTV = g_vecActions.filter(([strAction]) => strAction === "change-map").length;
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(g_mapMenus.size, 0);
strictEqual(g_vecActions.filter(([strAction]) => strAction === "change-map").length, g_unMapChangesBeforeManualRTV);
const g_ManualRTVChange = g_vecDelayed.at(-1);
strictEqual(g_ManualRTVChange.Seconds, g_unExpectedMapCommandDelaySeconds);
g_ManualRTVChange.Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_four"]);
strictEqual(g_vecActions.filter(([strAction]) => strAction === "change-map").length, g_unMapChangesBeforeManualRTV + 1);

StartRotationTest(g_RotationChangeMode.MapEnd);
strictEqual(Chat(2, "/nominate"), 1);
match(g_vecReplies.at(-1)[1], /not enabled/);

g_mapConVars.get("sjs_nominations").Value = "1";
g_bHasShowMenu = true;
strictEqual(Chat(2, "NoMiNaTe"), 0);
const g_NominationMenu = g_mapMenus.get(2);
strictEqual(g_NominationMenu.constructor, PagedRadioMenu);
strictEqual(g_NominationMenu.UseTextDialogFallback, false);
deepStrictEqual(g_NominationMenu.Items.map((Item) => [Item.Text, Item.Selectable]), [["map_one (Current map)", false], ["map_two", true], ["map_three", true]]);
g_NominationMenu.Options.SelectCallback(2, "map_three");
match(g_vecChatMessages.at(-1), /Test Player nominated map_three/);
strictEqual(Chat(3, "/nominate", "MAP_THREE"), 1);
match(g_vecReplies.at(-1)[1], /already nominated/);
strictEqual(Chat(2, "/nominate", "TWO"), 1);
match(g_vecReplies.at(-1)[1], /Replaced map_three with map_two/);

strictEqual(Chat(3, "/nominate_addmap", "map_three"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
strictEqual(RunServerCommand("nominate_addmap", "map_three"), 1);
match(g_vecReplies.at(-1)[1], /Nominated map_three/);

g_bHasShowMenu = false;
g_mapConVars.get("sjs_nominate_maxfound").Value = "2";
strictEqual(Chat(3, "/nominate", "map"), 1);
const g_PartialNominationMenu = g_mapMenus.get(3);
strictEqual(g_PartialNominationMenu.constructor, PagedESCMenu);
deepStrictEqual(g_PartialNominationMenu.Items.map((Item) => [Item.Text, Item.Selectable]), [["map_one (Current map)", false], ["map_two (Already nominated)", false]]);
strictEqual(Chat(3, "/nominate", "missing"), 1);
match(g_vecReplies.at(-1)[1], /No map.*matches/);
g_bHasShowMenu = true;

const g_unBeforeStaleNomination = g_vecChatMessages.length;
g_mapPlayers.set(3, { ...g_Peer, UserID: 903 });
g_PartialNominationMenu.Options.SelectCallback(3, "map_three");
strictEqual(g_vecChatMessages.length, g_unBeforeStaleNomination);
g_mapPlayers.set(3, g_Peer);

g_mapListeners.get("disconnect")(2);
strictEqual(g_mapMenus.has(2), false);
strictEqual(Chat(1, "/mapvote"), 1);
const g_NominationVoteMenu = g_mapMenus.get(3);
deepStrictEqual(g_NominationVoteMenu.Items.map((Item) => Item.Text), ["map_three", "map_two"]);
g_PartialNominationMenu.Options.SelectCallback(3, "map_two");
strictEqual(g_mapMenus.get(3), g_NominationVoteMenu);
strictEqual(Chat(1, "/cancelvote"), 1);
strictEqual(Chat(3, "/nominate"), 1);
deepStrictEqual(g_mapMenus.get(3).Items.map((Item) => Item.Selectable), [false, true, true]);

g_strMapCycle = "map_one\nmap_three\n";
const g_NominationMenuBeforeDeniedRefresh = g_mapMenus.get(3);
strictEqual(Chat(3, "/mapchooser_refresh"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
strictEqual(g_mapMenus.get(3), g_NominationMenuBeforeDeniedRefresh);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-4), [[0, "Map cycle:"], [0, "map_one"], [0, "map_two"], [0, "map_three"]]);

strictEqual(Chat(1, "/vote", "Unrelated question?"), 1);
const g_UnrelatedVoteMenu = g_mapMenus.get(2);
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(g_mapMenus.get(2), g_UnrelatedVoteMenu);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-3), [[0, "Map cycle:"], [0, "map_one"], [0, "map_three"]]);
strictEqual(Chat(1, "/cancelvote"), 1);
strictEqual(g_mapMenus.has(3), false);
strictEqual(Chat(3, "/nominate", "map_two"), 1);
match(g_vecReplies.at(-1)[1], /No map.*matches/);

g_strMapCycle = "map_one\nmap_two\nmap_three\n";
g_strCurrentMap = "map_two";
StartRotationTest(g_RotationChangeMode.MapEnd);
strictEqual(Chat(3, "/nominate"), 1);
deepStrictEqual(g_mapMenus.get(3).Items.map((Item) => [Item.Text, Item.Selectable]), [["map_one (Recently played)", false], ["map_two (Current map)", false], ["map_three", true]]);

g_mapConVars.get("sjs_nominate_excludeold").Value = "0";
strictEqual(Chat(3, "/nominate", "map_one"), 1);
match(g_vecChatMessages.at(-1), /Test Peer nominated map_one/);
strictEqual(Chat(3, "/nominate"), 1);
strictEqual(g_mapMenus.has(3), true);

g_strCurrentMap = "map_one";
g_strMapCycle = "map_one\nmap_two\nmap_three\nmap_four\nmap_five\n";
g_mapConVars.get("sjs_mapvote_include").Value = "3";
g_mapConVars.get("sjs_mapvote_voteduration").Value = "12";
g_mapConVars.get("sjs_mapvote_runoff").Value = "1";
g_mapConVars.get("sjs_mapvote_runoffpercent").Value = "60";
StartRotationTest(g_RotationChangeMode.MapEnd);
strictEqual(Chat(3, "/nominate", "map_five"), 1);
strictEqual(Chat(3, "/mapvote"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
strictEqual(Chat(1, "/mapvote"), 1);
const g_InitialMapBallot = g_mapMenus.get(2);
strictEqual(g_InitialMapBallot.Timeout, 12);
deepStrictEqual(g_InitialMapBallot.Items.map((Item) => Item.Text), ["map_five", "map_three", "map_four"]);
const g_InitialMapBallotDelay = g_vecDelayed.at(-1);
const g_FinishInitialMapBallot = g_InitialMapBallotDelay.Callback;
const g_strCycleBeforeBallot = g_strMapCycle;
g_strMapCycle = "map_one\nmap_two\nmap_four\n";
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
match(g_vecReplies.at(-1)[1], /cannot be refreshed during a rotation vote/);
strictEqual(RunServerCommand("listmaps"), 1);
strictEqual(g_vecReplies.at(-1)[1], "map_five");
strictEqual(g_mapMenus.get(2), g_InitialMapBallot);
strictEqual(g_InitialMapBallotDelay.Callback, g_FinishInitialMapBallot);

strictEqual(Chat(1, "/votefor", "1"), 1);
strictEqual(Chat(2, "/votefor", "2"), 1);
strictEqual(Chat(3, "/votefor", "3"), 1);
strictEqual(g_InitialMapBallotDelay.Callback, null);
const g_RunoffMenu = g_mapMenus.get(2);
g_FinishInitialMapBallot();
strictEqual(g_mapMenus.get(2), g_RunoffMenu);
strictEqual(RenderMenuText(g_RunoffMenu.Options.Title), "Runoff: choose the next map");
deepStrictEqual(g_RunoffMenu.Items.map((Item) => Item.Text), ["map_five", "map_three"]);
strictEqual(Chat(1, "/mapchooser_refresh"), 1);
match(g_vecReplies.at(-1)[1], /cannot be refreshed during a rotation vote/);
strictEqual(g_mapMenus.get(2), g_RunoffMenu);
strictEqual(Chat(2, "/votefor", "2"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");

strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-4), [[0, "Map cycle:"], [0, "map_one"], [0, "map_two"], [0, "map_four"]]);
strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");

g_strMapCycle = g_strCycleBeforeBallot;
g_mapConVars.set("mapcyclefile", { Exists: true, Value: "engine-cycle.txt" });
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-3), [[0, "Map cycle:"], [0, "map_one"], [0, "map_three"]]);

g_mapConVars.get("sjs_mapcyclefile").Value = "rotation/custom.txt";
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-3), [[0, "Map cycle:"], [0, "map_one"], [0, "map_four"]]);
strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");
g_mapConVars.get("sjs_mapcyclefile").Value = "";
g_mapConVars.delete("mapcyclefile");

for (const strRunoffThreshold of ["50", "60"]) {
	StartRotationTest(g_RotationChangeMode.MapEnd);
	g_mapConVars.get("sjs_mapvote_runoffpercent").Value = strRunoffThreshold;
	strictEqual(Chat(1, "/mapvote"), 1);
	const RotationTieBallot = g_mapMenus.get(2);
	strictEqual(RotationTieBallot.Items.length, 3);
	const strExpectedWinner = RotationTieBallot.Items[1].Text;
	// Cast in reverse ballot order and leave the first map without any votes.
	strictEqual(Chat(2, "/votefor", "3"), 1);
	strictEqual(Chat(3, "/votefor", "2"), 1);
	g_vecDelayed.at(-1).Callback();

	if (strRunoffThreshold === "60") {
		const RotationTieRunoff = g_mapMenus.get(2);
		strictEqual(RenderMenuText(RotationTieRunoff.Options.Title), "Runoff: choose the next map");
		deepStrictEqual(RotationTieRunoff.Items.map((Item) => Item.Text), [strExpectedWinner, RotationTieBallot.Items[2].Text]);
		strictEqual(Chat(2, "/votefor", "2"), 1);
		strictEqual(Chat(3, "/votefor", "1"), 1);
		g_vecDelayed.at(-1).Callback();
	}

	strictEqual(g_mapConVars.get("nextlevel").Value, strExpectedWinner);
	strictEqual(g_mapMenus.size, 0);
}

StartRotationTest(g_RotationChangeMode.MapEnd);
g_strMapCycle = "map_one\nmap_two\nmap_three\n";
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(Chat(3, "/nominate", "map_three"), 1);
match(g_vecChatMessages.at(-1), /Test Peer nominated map_three/);
strictEqual(Chat(3, "/nominate"), 1);
const g_NominationBeforeFailedRefresh = g_mapMenus.get(3);
for (const [strCycleFile, strCycleContents, ExpectedFailure] of [
	["../outside.txt", null, /relative \.txt path/],
	["missing-cycle.txt", null, /Could not read map cycle/],
	["", "", /contains no installed maps/],
	["", "// Only invalid and unavailable maps\n../bad\nnot_installed\n", /contains no installed maps/],
]) {
	g_mapConVars.get("sjs_mapcyclefile").Value = strCycleFile;
	g_strMapCycle = strCycleContents;
	const unBeforeRefreshActions = g_vecActions.length;
	const unBeforeRefreshDelays = g_vecDelayed.length;
	strictEqual(RunServerCommand("mapchooser_refresh"), 1);
	match(g_vecReplies.at(-1)[1], ExpectedFailure);
	strictEqual(g_mapMenus.get(3), g_NominationBeforeFailedRefresh);
	strictEqual(g_vecActions.length, unBeforeRefreshActions);
	strictEqual(g_vecDelayed.length, unBeforeRefreshDelays);
	strictEqual(RunServerCommand("listmaps"), 1);
	deepStrictEqual(g_vecReplies.slice(-4), [[0, "Map cycle:"], [0, "map_one"], [0, "map_two"], [0, "map_three"]]);
}

strictEqual(Chat(1, "/mapvote"), 1);
strictEqual(g_mapMenus.get(2).Items[0].Text, "map_three");
strictEqual(Chat(1, "/cancelvote"), 1);
g_mapListeners.get("level-end")();
const g_unBeforeUnavailableCycleActivation = g_vecReplies.length;
g_mapListeners.get("level-start")();
match(g_vecReplies.slice(g_unBeforeUnavailableCycleActivation).map(([, strReply]) => strReply).join("\n"), /contains no installed maps.*Keeping the previous list/);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-4), [[0, "Map cycle:"], [0, "map_one"], [0, "map_two"], [0, "map_three"]]);

g_vecInstalledMaps = ["map_four", "map_two", "unsafe;changelevel"];
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
match(g_vecReplies.at(-1)[1], /contains no installed maps/);

g_mapConVars.get("sjs_mapcyclefile").Value = "*";
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-3), [[0, "Map cycle:"], [0, "map_four"], [0, "map_two"]]);

g_vecInstalledMaps = [];
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
match(g_vecReplies.at(-1)[1], /found no installed maps/);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-3), [[0, "Map cycle:"], [0, "map_four"], [0, "map_two"]]);
g_mapConVars.get("sjs_mapcyclefile").Value = "";
g_strMapCycle = g_strCycleBeforeBallot;

StartRotationTest(g_RotationChangeMode.MapEnd);
const g_strUnchangedNextMap = g_mapConVars.get("nextlevel").Value;
strictEqual(Chat(1, "/mapvote"), 1);
strictEqual(Chat(1, "/cancelvote"), 1);
strictEqual(g_mapConVars.get("nextlevel").Value, g_strUnchangedNextMap);

strictEqual(Chat(1, "/mapvote"), 1);
g_setVotePermissions.delete("sourcejs.map");
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, g_strUnchangedNextMap);
match(g_vecChatMessages.at(-1), /no longer has permission/);
g_setVotePermissions.add("sourcejs.map");

StartRotationTest(g_RotationChangeMode.MapEnd);
strictEqual(Chat(1, "/vote", "Finish this first?"), 1);
const g_ExistingVote = g_mapMenus.get(2);
const g_unBeforeDeniedMapVote = g_vecDelayed.length;
g_setVotePermissions.delete("sourcejs.map");
strictEqual(Chat(1, "/mapvote"), 1);
match(g_vecReplies.at(-1)[1], /requires sourcejs\.map/);
strictEqual(g_vecDelayed.length, g_unBeforeDeniedMapVote);

g_setVotePermissions.add("sourcejs.map");
strictEqual(Chat(1, "/mapvote"), 1);
match(g_vecReplies.at(-1)[1], /queued until the current vote ends/);
const g_FirstMapVoteRetry = g_vecDelayed.at(-1);
const g_RetryWhileVoting = g_FirstMapVoteRetry.Callback;
strictEqual(g_FirstMapVoteRetry.Seconds, 5);
strictEqual(RunServerCommand("mapvote"), 1);
match(g_vecReplies.at(-1)[1], /already queued/);
strictEqual(g_vecDelayed.at(-1), g_FirstMapVoteRetry);

g_RetryWhileVoting();
const g_SecondMapVoteRetry = g_vecDelayed.at(-1);
notStrictEqual(g_FirstMapVoteRetry, g_SecondMapVoteRetry);
strictEqual(g_mapMenus.get(2), g_ExistingVote);
strictEqual(Chat(1, "/cancelvote"), 1);
g_RetryWhileVoting();
strictEqual(g_mapMenus.size, 0);
g_SecondMapVoteRetry.Callback();
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
strictEqual(Chat(1, "/mapvote"), 1);
match(g_vecReplies.at(-1)[1], /rotation vote is already in progress/);
strictEqual(Chat(1, "/cancelvote"), 1);

for (const strCancellation of ["permission", "disconnected", "replacement", "manual choice", "scheduled change", "map end"]) {
	StartRotationTest(g_RotationChangeMode.MapEnd);
	strictEqual(Chat(1, "/vote", "Before cancelling?"), 1);
	strictEqual(Chat(1, "/mapvote"), 1);
	const PendingMapVote = g_vecDelayed.at(-1);
	const StartPendingMapVote = PendingMapVote.Callback;
	strictEqual(Chat(1, "/cancelvote"), 1);
	const Initiator = g_mapPlayers.get(1);

	if (strCancellation === "permission") {
		g_setVotePermissions.delete("sourcejs.vote");
	} else if (strCancellation === "disconnected") {
		g_mapListeners.get("disconnect")(1);
		strictEqual(PendingMapVote.Callback, null);
	} else if (strCancellation === "replacement") {
		g_mapPlayers.set(1, { ...Initiator, UserID: 901 });
	} else if (strCancellation === "manual choice") {
		strictEqual(RunServerCommand("setnextmap", "map_three"), 1);
		strictEqual(PendingMapVote.Callback, null);
	} else if (strCancellation === "scheduled change") {
		strictEqual(RunServerCommand("map", "map_three"), 1);
	} else {
		g_mapListeners.get("level-end")();
		strictEqual(PendingMapVote.Callback, null);
	}

	StartPendingMapVote();
	strictEqual(g_mapMenus.size, 0, strCancellation);

	if (strCancellation === "permission") {
		match(g_vecReplies.at(-1)[1], /initiator no longer has permission/);
	} else if (strCancellation === "scheduled change") {
		match(g_vecReplies.at(-1)[1], /a change is scheduled/);
	}

	g_setVotePermissions.add("sourcejs.vote");
	g_mapPlayers.set(1, Initiator);
}

StartRotationTest(g_RotationChangeMode.MapEnd);
g_mapConVars.get("sjs_mapvote_novote").Value = "0";
strictEqual(Chat(1, "/mapvote"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, g_strUnchangedNextMap);
match(g_vecChatMessages.at(-1), /No votes were cast/);

g_mapConVars.get("sjs_mapvote_novote").Value = "1";
strictEqual(Chat(1, "/mapvote"), 1);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /No votes were cast. Next map: map_(three|four|five)/);

g_mapConVars.get("sjs_mapvote_extend").Value = "1";
g_mapConVars.get("sjs_mapvote_timelimit_seconds").Value = "1";
g_mapConVars.set("mp_timelimit", { Exists: true, Value: "480" });
g_mapConVars.set("mp_maxrounds", { Exists: true, Value: "4" });
g_mapConVars.set("mp_winlimit", { Exists: true, Value: "0" });
g_mapConVars.set("mp_fraglimit", { Exists: true, Value: "20" });
StartRotationTest(g_RotationChangeMode.MapEnd);
const g_strNextMapBeforeExtension = g_mapConVars.get("nextlevel").Value;
strictEqual(Chat(1, "/mapvote"), 1);
strictEqual(RenderMenuText(g_mapMenus.get(2).Items.at(-1).Text), "Extend Map");
strictEqual(Chat(2, "/votefor", "4"), 1);
strictEqual(Chat(3, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Runoff: choose the next map");
strictEqual(RenderMenuText(g_mapMenus.get(2).Items[1].Text), "Extend Map");
strictEqual(Chat(2, "/votefor", "2"), 1);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /current map was extended/);
strictEqual(g_mapConVars.get("mp_timelimit").Value, "1380");
strictEqual(g_mapConVars.get("mp_maxrounds").Value, "9");
strictEqual(g_mapConVars.get("mp_winlimit").Value, "0");
strictEqual(g_mapConVars.get("mp_fraglimit").Value, "30");
strictEqual(g_mapConVars.get("nextlevel").Value, g_strNextMapBeforeExtension);

strictEqual(Chat(1, "/mapvote"), 1);
strictEqual(g_mapMenus.get(2).Items.some((Item) => RenderMenuText(Item.Text) === "Extend Map"), false);
strictEqual(Chat(1, "/cancelvote"), 1);

StartRotationTest(g_RotationChangeMode.Immediately);
g_flServerTime = 40;
const g_strNextMapBeforeKeeping = g_mapConVars.get("nextlevel").Value;
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(RenderMenuText(g_mapMenus.get(2).Items.at(-1).Text), "Don't Change");
const g_unBeforeKeepingMap = g_vecActions.length;
strictEqual(Chat(2, "/votefor", "4"), 1);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /current map stays/);
strictEqual(g_mapConVars.get("nextlevel").Value, g_strNextMapBeforeKeeping);
strictEqual(g_vecActions.length, g_unBeforeKeepingMap);
strictEqual(g_mapConVars.get("mp_timelimit").Value, "1380");

strictEqual(Chat(1, "/mapvote"), 1);
strictEqual(RenderMenuText(g_mapMenus.get(2).Items.at(-1).Text), "Extend Map");
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /No votes were cast. Next map: map_(three|four|five)/);
strictEqual(g_mapConVars.get("mp_timelimit").Value, "1380");

g_mapConVars.get("sjs_mapvote_dontchange").Value = "0";
StartRotationTest(g_RotationChangeMode.RoundEnd);
g_flServerTime = 40;
strictEqual(Chat(2, "/rtv"), 1);
strictEqual(Chat(3, "/rtv"), 1);
strictEqual(RenderMenuText(g_mapMenus.get(2).Items.at(-1).Text), "Extend Map");
g_mapConVars.get("sjs_mapvote_extend").Value = "0";
strictEqual(Chat(2, "/votefor", "4"), 1);
g_vecDelayed.at(-1).Callback();
match(g_vecChatMessages.at(-1), /reached its extension limit/);
strictEqual(g_mapConVars.get("mp_timelimit").Value, "1380");

g_mapConVars.get("sjs_mapvote_dontchange").Value = "1";
g_mapConVars.get("sjs_mapvote_extend").Value = "1";
g_mapConVars.get("sjs_mapvote_timelimit_seconds").Value = "0";
g_mapConVars.get("sjs_mapchooser").Value = "1";
g_mapConVars.set("mp_timelimit", { Exists: true, Value: "8" });
StartRotationTest(g_RotationChangeMode.MapEnd);
const g_unExpectedAutomaticMapVoteCheckSeconds = 5;
const g_InitialAutomaticCheck = g_vecDelayed.at(-1);
strictEqual(g_InitialAutomaticCheck.Seconds, g_unExpectedAutomaticMapVoteCheckSeconds);
g_flServerTime = 100;
g_InitialAutomaticCheck.Callback();
strictEqual(g_mapMenus.size, 0);

g_mapConVars.get("mp_timelimit").Value = "4";
strictEqual(Chat(1, "/vote", "Busy?"), 1);
const g_UnrelatedMapVoteDelay = g_vecDelayed.at(-1);
const g_AutomaticCheckWhileBusy = g_vecDelayed.at(-2);
g_AutomaticCheckWhileBusy.Callback();
strictEqual(g_mapMenus.get(2).Options.Title, "Busy?");
const g_AutomaticRetry = g_vecDelayed.at(-1);
strictEqual(g_AutomaticRetry.Seconds, g_unExpectedAutomaticMapVoteCheckSeconds);
g_UnrelatedMapVoteDelay.Callback();
g_AutomaticRetry.Callback();
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
strictEqual(RenderMenuText(g_mapMenus.get(2).Items.at(-1).Text), "Extend Map");
strictEqual(Chat(2, "/votefor", "4"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("mp_timelimit").Value, "19");
const g_RescheduledAutomaticCheck = g_vecDelayed.at(-1);
strictEqual(g_RescheduledAutomaticCheck.Seconds, g_unExpectedAutomaticMapVoteCheckSeconds);
g_flServerTime = 970;
g_RescheduledAutomaticCheck.Callback();
strictEqual(g_mapMenus.get(2).Items.some((Item) => RenderMenuText(Item.Text) === "Extend Map"), false);
const g_AutomaticMapBallot = g_vecDelayed.at(-1);
g_mapListeners.get("level-end")();
strictEqual(g_AutomaticMapBallot.Callback, null);
strictEqual(g_mapMenus.size, 0);

for (const strVoteEnd of ["cancelled", "no votes"]) {
	g_mapConVars.get("sjs_mapvote_novote").Value = "0";
	g_mapConVars.get("mp_timelimit").Value = "2";
	g_mapConVars.get("mp_maxrounds").Value = "0";
	StartRotationTest(g_RotationChangeMode.MapEnd);
	const CheckBeforeUnresolvedVote = g_vecDelayed.at(-1).Callback;
	CheckBeforeUnresolvedVote();
	const UnresolvedBallot = g_vecDelayed.at(-1);
	strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");

	if (strVoteEnd === "cancelled") {
		strictEqual(Chat(1, "/cancelvote"), 1);
	} else {
		UnresolvedBallot.Callback();
		match(g_vecChatMessages.at(-1), /No votes were cast/);
	}

	strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
	strictEqual(g_mapMenus.size, 0);

	const CheckAfterUnresolvedVote = g_vecDelayed.at(-1);
	strictEqual(CheckAfterUnresolvedVote.Seconds, g_unExpectedAutomaticMapVoteCheckSeconds);
	CheckBeforeUnresolvedVote();
	strictEqual(g_vecDelayed.at(-1), CheckAfterUnresolvedVote);
	CheckAfterUnresolvedVote.Callback();
	strictEqual(g_mapMenus.size, 0);

	const CheckAfterLimitChange = g_vecDelayed.at(-1);
	g_mapConVars.get("mp_timelimit").Value = "3";
	CheckAfterLimitChange.Callback();
	const NewBallot = g_mapMenus.get(2);
	strictEqual(RenderMenuText(NewBallot.Options.Title), "Choose the next map");
	strictEqual(Chat(2, "/votefor", "1"), 1);
	const DelayedResult = g_vecDelayed.at(-1);
	DelayedResult.Callback();
	strictEqual(g_mapConVars.get("nextlevel").Value, NewBallot.Items[0].Text);
	strictEqual(g_mapMenus.size, 0);
	strictEqual(g_vecDelayed.at(-1), DelayedResult);
}

g_mapConVars.get("sjs_mapvote_novote").Value = "1";

function FireMapVoteEvent(strEventName, Fields, Callback = g_mapEventListeners.get(strEventName)) {
	Callback({ EventName: strEventName, GetEventInteger: (strKey, nDefaultValue = 0) => Fields[strKey] ?? nDefaultValue });
}

g_mapConVars.get("mp_timelimit").Value = "2";
g_mapConVars.get("mp_maxrounds").Value = "4";
g_mapConVars.get("mp_winlimit").Value = "0";
StartRotationTest(g_RotationChangeMode.MapEnd);
FireMapVoteEvent("round_end", { winner: 2 });
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
FireMapVoteEvent("round_end", { winner: 3 });
g_mapConVars.get("mp_timelimit").Value = "0";
strictEqual(Chat(1, "/cancelvote"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
strictEqual(Chat(1, "/cancelvote"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapMenus.size, 0);

FireMapVoteEvent("round_end", { winner: 2 });
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
strictEqual(Chat(1, "/cancelvote"), 1);

g_mapConVars.get("mp_timelimit").Value = "4";
StartRotationTest(g_RotationChangeMode.MapEnd);
FireMapVoteEvent("round_end", { winner: 2 });
g_flServerTime = 70;
FireMapVoteEvent("round_end", { winner: 3 });
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
strictEqual(Chat(1, "/cancelvote"), 1);
g_mapConVars.get("mp_timelimit").Value = "0";
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapMenus.size, 0);

g_mapConVars.get("mp_timelimit").Value = "0";
g_mapConVars.get("mp_fraglimit").Value = "0";
g_mapConVars.get("mp_maxrounds").Value = "4";
g_mapConVars.get("sjs_mapvote_extend").Value = "0";
StartRotationTest(g_RotationChangeMode.MapEnd);
g_flServerTime = 70;
FireMapVoteEvent("round_end", { winner: 0 });
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 3\./);
FireMapVoteEvent("round_end", { winner: 2 });
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 2\./);

FireMapVoteEvent("game_start", {});
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 4\./);
FireMapVoteEvent("round_end", { winner: 1 });
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 3\./);

FireMapVoteEvent("game_newmap", {});
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 4\./);
strictEqual(g_mapMenus.size, 0);

strictEqual(Chat(1, "/vote", "BusyRound?"), 1);
const g_RoundConflictBallot = g_vecDelayed.at(-1);
const g_RoundRetry = g_vecDelayed.at(-2);
FireMapVoteEvent("round_end", { winner: 3 });
strictEqual(g_mapMenus.get(2).Options.Title, "BusyRound?");
g_RoundConflictBallot.Callback();
g_RoundRetry.Callback();
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");
const g_strRoundVoteWinner = g_mapMenus.get(2).Items[0].Text;
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, g_strRoundVoteWinner);
FireMapVoteEvent("round_end", { winner: 3 });
strictEqual(g_mapMenus.size, 0);

g_mapConVars.get("mp_maxrounds").Value = "0";
g_mapConVars.get("mp_winlimit").Value = "4";
StartRotationTest(g_RotationChangeMode.MapEnd);
FireMapVoteEvent("round_end", { winner: 2 });
FireMapVoteEvent("round_end", { winner: 3 });
strictEqual(g_mapMenus.size, 0);
FireMapVoteEvent("round_end", { winner: 2 });
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");

g_mapConVars.get("mp_winlimit").Value = "0";
g_mapConVars.get("mp_fraglimit").Value = "20";
StartRotationTest(g_RotationChangeMode.MapEnd);
const g_FragScorer = g_mapPlayers.get(2);
g_FragScorer.Frags = 14;
FireMapVoteEvent("player_death", { attacker: g_FragScorer.UserID });
strictEqual(g_mapMenus.size, 0);
g_mapPlayers.get(3).Frags = 20;
FireMapVoteEvent("player_death", { attacker: 0 });
strictEqual(g_mapMenus.size, 0);
g_FragScorer.Frags = 15;
FireMapVoteEvent("player_death", { attacker: g_FragScorer.UserID });
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");

const { RecordMapVoteRound, ResetMapVoteScores } = LoadFile(join(g_strAdministrationRoot, "rotation.js"));

g_mapConVars.get("mp_fraglimit").Value = "0";
g_mapConVars.get("mp_winlimit").Value = "4";
g_mapConVars.get("mp_maxrounds").Value = "4";
StartRotationTest(g_RotationChangeMode.MapEnd);
FireMapVoteEvent("teamplay_win_panel", { round_complete: 0, winning_team: 3, blue_score: 2 }, RecordMapVoteRound);
strictEqual(g_mapMenus.size, 0);
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 4\./);
FireMapVoteEvent("teamplay_win_panel", { round_complete: 1, winning_team: 3, blue_score: 1 }, RecordMapVoteRound);
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 3\./);

ResetMapVoteScores();
FireMapVoteEvent("arena_win_panel", { winning_team: 3, blue_score: 1 }, RecordMapVoteRound);
strictEqual(g_mapMenus.size, 0);
strictEqual(Chat(2, "/timeleft"), 1);
match(g_vecReplies.at(-1)[1], /Rounds remaining: 2\./);

g_mapConVars.get("mp_maxrounds").Value = "0";
FireMapVoteEvent("teamplay_win_panel", { round_complete: 1, winning_team: 3, blue_score: 2 }, RecordMapVoteRound);
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Choose the next map");

function ActivateRotationMap(strMap, strNextMap, Configure = null) {
	g_mapListeners.get("level-end")();

	g_strCurrentMap = strMap;
	g_mapConVars.get("nextlevel").Value = strNextMap;
	const unPreviousDelayCount = g_vecDelayed.length;

	g_mapListeners.get("level-start")();
	const RandomCycleDelay = g_vecDelayed[unPreviousDelayCount];
	strictEqual(RandomCycleDelay.Seconds, 5);
	Configure?.(RandomCycleDelay);
	RandomCycleDelay.Callback?.();

	return g_mapConVars.get("nextlevel").Value;
}

g_strMapCycle = "map_one\nmap_two\nmap_three\n";
strictEqual(ActivateRotationMap("map_three", "map_three"), "map_one");
strictEqual(ActivateRotationMap("map_one", "not_a_valid_map"), "map_two");
strictEqual(ActivateRotationMap("map_two", "map_one"), "map_one");
strictEqual(ActivateRotationMap("map_two", ""), "map_three");
strictEqual(ActivateRotationMap("map_four", ""), "map_three");
strictEqual(ActivateRotationMap("map_five", "map_five"), "map_three");
strictEqual(ActivateRotationMap("map_three", ""), "map_one");
strictEqual(ActivateRotationMap("map_two", ""), "map_three");
g_strMapCycle = "map_two\nmap_one\nmap_three\n";
strictEqual(ActivateRotationMap("map_four", ""), "map_one");
g_strMapCycle = "map_one\nmap_three\n";
strictEqual(ActivateRotationMap("map_four", ""), "map_one");
g_strMapCycle = "map_one\nmap_two\nmap_three\n";
strictEqual(ActivateRotationMap("map_two", "map_one"), "map_one");

for (const Failure of [null, false, new Error("ChangeLevel failed.")]) {
	strictEqual(ActivateRotationMap("map_one", ""), "map_two");
	strictEqual(RunServerCommand("map", "map_two"), 1);
	const FailedMapDelay = g_vecDelayed.at(-1);
	const unBeforeFailedMapAttempt = g_vecActions.length;
	g_ChangeLevelFailure = Failure;

	if (Failure === null) {
		g_setUnavailableMaps.add("map_two");
	}

	try {
		FailedMapDelay.Callback();
		strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");
		match(g_vecChatMessages.at(-1), /did not accept the map change to map_two/);
		deepStrictEqual(g_vecActions.slice(unBeforeFailedMapAttempt), (Failure === null) ? [] : [["change-map", "map_two"]]);
	} finally {
		g_ChangeLevelFailure = null;
		g_setUnavailableMaps.delete("map_two");
	}
}

strictEqual(ActivateRotationMap("map_one", ""), "map_two");
strictEqual(Chat(1, "/map", "map_two"), 1);
const g_RefusedMapDelay = g_vecDelayed.at(-1);
g_mapPermissions.get(1).delete("sourcejs.map");
g_RefusedMapDelay.Callback();
match(g_vecChatMessages.at(-1), /initiator no longer has permission/);
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
g_mapPermissions.get(1).add("sourcejs.map");

strictEqual(RunServerCommand("map", "map_two"), 1);
const g_OverrideMapDelay = g_vecDelayed.at(-1);
strictEqual(RunServerCommand("setnextmap", "map_four"), 1);
g_setUnavailableMaps.add("map_two");

try {
	g_OverrideMapDelay.Callback();
	strictEqual(g_mapConVars.get("nextlevel").Value, "map_four");
} finally {
	g_setUnavailableMaps.delete("map_two");
}

strictEqual(RunServerCommand("map", "map_two"), 1);
const g_ObsoleteChangeMap = g_vecDelayed.at(-1).Callback;
strictEqual(RunServerCommand("map", "map_three"), 1);
const g_NewMapDelay = g_vecDelayed.at(-1);
const g_unBeforeObsoleteMapChange = g_vecActions.length;
g_ObsoleteChangeMap();
strictEqual(g_vecActions.length, g_unBeforeObsoleteMapChange);
g_NewMapDelay.Callback();
deepStrictEqual(g_vecActions.slice(g_unBeforeObsoleteMapChange), [["change-map", "map_three"]]);

strictEqual(ActivateRotationMap("map_two", "map_one"), "map_one");

function ReportFailedMapChange(strMap) {
	g_mapEventListeners.get("server_changelevel_failed")({
		GetEventString(strKey) {
			strictEqual(strKey, "levelname");

			return strMap;
		},
	});
}

strictEqual(ActivateRotationMap("map_one", ""), "map_two");
ReportFailedMapChange("");
ReportFailedMapChange("map_three");
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
ReportFailedMapChange("MAP_TWO");
strictEqual(g_mapConVars.get("nextlevel").Value, "map_three");
ReportFailedMapChange("map_three");
strictEqual(g_mapConVars.get("nextlevel").Value, "");

const g_strChooserBeforeRecovery = g_mapConVars.get("sjs_mapchooser").Value;
g_mapConVars.get("sjs_mapchooser").Value = "0";
strictEqual(RunServerCommand("nextmap"), 1);
match(g_vecReplies.at(-1)[1], /Next map: map_one/);
g_mapConVars.get("sjs_mapchooser").Value = g_strChooserBeforeRecovery;

strictEqual(ActivateRotationMap("map_one", ""), "map_two");
g_mapConVars.get("sjs_nextmap_enabled").Value = "0";
ReportFailedMapChange("map_two");
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
g_mapConVars.get("sjs_nextmap_enabled").Value = "1";
strictEqual(RunServerCommand("setnextmap", "map_four"), 1);
ReportFailedMapChange("map_two");
strictEqual(g_mapConVars.get("nextlevel").Value, "map_four");
ReportFailedMapChange("map_four");
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");

const g_NextLevelBeforeRecovery = g_mapConVars.get("nextlevel");

try {
	g_mapConVars.set("nextlevel", {
		Exists: true,
		get Value() {
			return "map_two";
		},
		set Value(strMap) {
			strictEqual(strMap, "map_three");
		},
	});

	ReportFailedMapChange("map_two");
	match(g_vecReplies.at(-1)[1], /Could not recover from failed map change to map_two: The engine did not accept/);
	strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
} finally {
	g_mapConVars.set("nextlevel", g_NextLevelBeforeRecovery);
}

strictEqual(ActivateRotationMap("map_two", "map_one"), "map_one");
const g_unBeforeMapCycleConsole = g_vecReplies.length;
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(g_unBeforeMapCycleConsole), [[0, "Map cycle:"], [0, "map_one"], [0, "map_two"], [0, "map_three"]]);

g_setUnavailableMaps.add("map_three");
g_bUserMessageReplies = true;
const g_unBeforeMapCycleChat = g_vecReplies.length;
strictEqual(Chat(2, "/listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(g_unBeforeMapCycleChat), [[2, "[SourceJS] Map cycle:\n"], [2, "[SourceJS] map_one\n"], [2, "[SourceJS] map_two\n"], [2, "[SourceJS] See your console for the map cycle."]]);

g_setUnavailableMaps.add("map_one");
g_setUnavailableMaps.add("map_two");
const g_unBeforeEmptyMapCycle = g_vecReplies.length;
strictEqual(g_mapClientCommands.get("sjs_listmaps")({ Index: 2, Arguments: ["sjs_listmaps"] }), 1);
deepStrictEqual(g_vecReplies.slice(g_unBeforeEmptyMapCycle), [[2, "[SourceJS] Map cycle:\n"], [2, "[SourceJS] The map cycle is empty.\n"]]);
g_setUnavailableMaps.clear();
g_bUserMessageReplies = false;

g_mapConVars.get("sjs_randomcycle").Value = "1";
strictEqual(g_mapConVars.get("sjs_randomcycle_exclude").Value, "5");
strictEqual(ActivateRotationMap("map_three", "map_three"), "map_one");
strictEqual(ActivateRotationMap("map_one", "map_one"), "map_two");
strictEqual(ActivateRotationMap("map_two", "map_three"), "map_three");
strictEqual(Chat(2, "/maphistory"), 1);
match(g_vecReplies.at(-1)[1], /permission/);

const g_unBeforeMapHistory = g_vecReplies.length;
strictEqual(Chat(1, "/maphistory"), 1);
match(g_vecReplies.at(-1)[1], /See console for map history/);
const g_vecHistoryReplies = g_vecReplies.slice(g_unBeforeMapHistory).map((Entry) => Entry[1]);
match(g_vecHistoryReplies[1], /Current map: map_two/);
match(g_vecHistoryReplies[2], /Map \| Started \| Played \| Change reason/);
match(g_vecHistoryReplies[3], /map_one \| /);
match(g_vecHistoryReplies[4], /map_three \| /);

g_strMapCycle = "map_one\nmap_two\nmap_three\nmap_four\n";
strictEqual(ActivateRotationMap("map_three", ""), "map_four");
g_strMapCycle = "map_two\n";
strictEqual(ActivateRotationMap("map_two", ""), "");
g_strMapCycle = "map_one\nmap_two\nmap_three\n";
g_mapConVars.get("sjs_randomcycle").Value = "0";
strictEqual(ActivateRotationMap("map_one", ""), "map_two");

const g_RandomCycle = g_mapConVars.get("sjs_randomcycle");
const g_RandomCycleExclude = g_mapConVars.get("sjs_randomcycle_exclude");
let g_InvokePreviousRandomCycle = null;
strictEqual(ActivateRotationMap("map_one", "", (Delay) => {
	strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");
	g_InvokePreviousRandomCycle = Delay.Callback;
	g_RandomCycle.Value = "1";
	g_RandomCycleExclude.Value = "0";
	g_strMapCycle = "map_one\nmap_four\n";
}), "map_four");
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-3), [[0, "Map cycle:"], [0, "map_one"], [0, "map_four"]]);

g_strMapCycle = "map_one\nmap_two\nmap_three\n";
strictEqual(ActivateRotationMap("map_one", "", (Delay) => {
	g_InvokePreviousRandomCycle();
	strictEqual(g_mapConVars.get("nextlevel").Value, "");
	strictEqual(Chat(2, "/setnextmap", "map_four"), 1);
	match(g_vecReplies.at(-1)[1], /permission/);
	strictEqual(typeof Delay.Callback, "function");
	strictEqual(g_mapConVars.get("nextlevel").Value, "");
	strictEqual(RunServerCommand("setnextmap", "map_three"), 1);
	strictEqual(Delay.Callback, null);
}), "map_three");

strictEqual(ActivateRotationMap("map_one", "", () => {
	g_mapConVars.get("nextlevel").Value = "map_four";
}), "map_four");

strictEqual(ActivateRotationMap("map_one", "", () => {
	strictEqual(Chat(1, "/mapvote"), 1);
	strictEqual(RenderMenuText(g_mapMenus.get(1).Options.Title), "Choose the next map");
}), "");

strictEqual(ActivateRotationMap("map_one", "", (Delay) => {
	const InvokeCancelledRandomCycle = Delay.Callback;
	g_mapListeners.get("level-end")();
	strictEqual(Delay.Callback, null);
	InvokeCancelledRandomCycle();
}), "");

g_RandomCycle.Value = "0";
g_RandomCycleExclude.Value = "5";
strictEqual(ActivateRotationMap("map_one", ""), "map_two");

const { FormatMapHistory, RecordMapEnd, RecordMapStart, TrackRequestedMapChange } = LoadFile(join(g_strAdministrationRoot, "map-history.js"));
const g_ReadOriginalSystemTime = runInContext("Date.now", g_Context);
runInContext("Date.now = () => 60000", g_Context);
RecordMapEnd();
RecordMapStart("map_two");
runInContext("Date.now = () => 183000", g_Context);
strictEqual(TrackRequestedMapChange("map_three", "Map vote", () => true), true);
RecordMapEnd();
runInContext("Date.now = () => 210000", g_Context);
RecordMapStart("map_three");
match(FormatMapHistory(), /map_two \| 1970-01-01T00:01:00.000Z \| 2m 3s \| Map vote/);

strictEqual(TrackRequestedMapChange("map_four", "Admin command", () => false), false);
RecordMapStart("map_four");
match(FormatMapHistory(), /map_three \| .* \| Engine or unknown/);

TrackRequestedMapChange("map_two", "Rock the Vote", () => true);
RecordMapStart("map_one");
match(FormatMapHistory(), /map_four \| .* \| Engine or unknown/);

strictEqual(Chat(1, "/map", "map_two"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(ActivateRotationMap("map_two", ""), "map_three");
match(FormatMapHistory(), /map_one \| .* \| Admin command/);

for (let unIndex = 0; unIndex < 25; ++unIndex) {
	RecordMapEnd();
	RecordMapStart("map_two");
}

strictEqual(FormatMapHistory().split("\n").length, 23);
runInContext("Date", g_Context).now = g_ReadOriginalSystemTime;

StartRotationTest(g_RotationChangeMode.MapEnd);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapMenus.size, 0);
const g_PendingAutomaticCheck = g_vecDelayed.at(-1);
strictEqual(g_PendingAutomaticCheck.Seconds, g_unExpectedAutomaticMapVoteCheckSeconds);
strictEqual(Chat(2, "nextmap"), 0);
match(g_vecReplies.at(-1)[1], /pending a map vote/);

const g_NextLevelForManualSelection = g_mapConVars.get("nextlevel");
g_mapConVars.set("nextlevel", {
	Exists: true,
	get Value() {
		return "map_two";
	},
	set Value(strMap) {
		strictEqual(strMap, "map_three");
	},
});

strictEqual(Chat(1, "/setnextmap", "map_three"), 1);
match(g_vecReplies.at(-1)[1], /engine did not accept the next map/);
strictEqual(typeof g_PendingAutomaticCheck.Callback, "function");
g_mapConVars.set("nextlevel", g_NextLevelForManualSelection);
strictEqual(Chat(1, "/setnextmap", "map_three", "extra"), 1);
match(g_vecReplies.at(-1)[1], /Usage: sjs_setnextmap/);
strictEqual(Chat(1, "/setnextmap", "map_three"), 1);
strictEqual(g_PendingAutomaticCheck.Callback, null);
strictEqual(Chat(2, "nextmap"), 0);
match(g_vecReplies.at(-1)[1], /Next map: map_three/);

strictEqual(Chat(1, "/mapvote"), 1);
const g_SupersededBallot = g_vecDelayed.at(-1);
strictEqual(Chat(2, "/votefor", "1"), 1);
strictEqual(Chat(1, "/setnextmap", "map_four"), 1);
g_SupersededBallot.Callback();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_four");
match(g_vecChatMessages.at(-1), /Map vote result ignored/);

g_mapConVars.get("mp_timelimit").Value = "180";
g_mapConVars.get("sjs_mapvote_timelimit_seconds").Value = "1";
g_mapConVars.get("mp_maxrounds").Value = "4";
FireMapVoteEvent("round_end", { winner: 2 });
g_flServerTime = 70;
strictEqual(Chat(2, "timeleft"), 0);
match(g_vecReplies.at(-1)[1], /2m 0s.*Rounds remaining: 3/);

const g_TimeLeftAnnouncementInterval = g_mapConVars.get("sjs_timeleft_interval");
const g_unBeforeTimeAnnouncements = g_vecChatMessages.length;
const g_unBeforeTimeAnnouncementReplies = g_vecReplies.length;
g_TimeLeftAnnouncementInterval.Value = "0.5";
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements);
strictEqual(g_vecReplies.length, g_unBeforeTimeAnnouncementReplies);

g_TimeLeftAnnouncementInterval.Value = "60";
g_mapListeners.get("tick")();
g_flServerTime = 129.5;
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements);
strictEqual(g_vecReplies.length, g_unBeforeTimeAnnouncementReplies);
g_flServerTime = 130;
g_mapListeners.get("tick")();
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements + 1);
match(g_vecChatMessages.at(-1), /Approximate map time remaining: 1m 0s/);
strictEqual(g_vecReplies.length, g_unBeforeTimeAnnouncementReplies + 1);
strictEqual(g_vecReplies.at(-1)[0], 0);
strictEqual(g_vecChatMessages.at(-1), `[SourceJS] ${g_vecReplies.at(-1)[1]}`);

g_flServerTime = 140;
g_TimeLeftAnnouncementInterval.Value = "5";
g_mapListeners.get("tick")();
g_flServerTime = 144.5;
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements + 1);
g_flServerTime = 145;
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements + 2);

g_TimeLeftAnnouncementInterval.Value = "0";
g_mapListeners.get("tick")();
g_flServerTime = 190;
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements + 2);
strictEqual(g_vecReplies.length, g_unBeforeTimeAnnouncementReplies + 2);

g_TimeLeftAnnouncementInterval.Value = "5";
g_mapListeners.get("tick")();
g_mapListeners.get("level-end")();
g_flServerTime = 195;
g_mapListeners.get("tick")();
strictEqual(g_vecChatMessages.length, g_unBeforeTimeAnnouncements + 2);
strictEqual(g_vecReplies.length, g_unBeforeTimeAnnouncementReplies + 2);

g_TimeLeftAnnouncementInterval.Value = "0";

StartRotationTest(g_RotationChangeMode.MapEnd);
const g_PendingMapMenuAutomaticCheck = g_vecDelayed.at(-1);
g_ContextMath.random = g_OriginalContextRandom;

function SelectAdminMenuOption(strText) {
	const Menu = g_mapMenus.get(1);
	const Item = Menu.Items.find((Option) => (Option.Value?.Name === strText) || (Option.Text === strText));
	Menu.Options.SelectCallback(1, Item.Value);
}

for (const [strAction, bRadio, strPreset] of [["gravity", true, "0.1"], ["gravity", false, "0.1"], ["blind", true, "240"], ["blind", false, "240"]]) {
	g_bHasShowMenu = bRadio;
	const Renderer = bRadio ? PagedRadioMenu : PagedESCMenu;
	const OriginalTargets = SelectAdminAction("slay", strAction);
	strictEqual(OriginalTargets.constructor, Renderer);
	strictEqual(OriginalTargets.Items.some((Item) => Item.Value === 103), true);
	const flOriginalGravity = g_Peer.Gravity;
	const unActionsBeforeStaleTarget = g_vecActions.length;
	g_Peer.UserID = 903;
	OriginalTargets.Options.SelectCallback(1, 103);
	match(g_vecReplies.at(-1)[1], /No matching player/);
	const ReplacementTargets = g_mapMenus.get(1);
	notStrictEqual(ReplacementTargets, OriginalTargets);
	strictEqual(ReplacementTargets.constructor, Renderer);
	strictEqual(ReplacementTargets.Items.some((Item) => Item.Value === 103), false);
	strictEqual(ReplacementTargets.Items.some((Item) => Item.Value === 903), true);
	OriginalTargets.Options.SelectCallback(1, 903);
	strictEqual(g_mapMenus.get(1), ReplacementTargets);
	strictEqual(g_vecActions.length, unActionsBeforeStaleTarget);
	strictEqual(g_Peer.Gravity, flOriginalGravity);

	ReplacementTargets.Options.SelectCallback(1, 903);
	const Presets = g_mapMenus.get(1);
	strictEqual(Presets.constructor, Renderer);
	strictEqual(Presets.Items.some((Item) => Item.Value === strPreset), true);
	g_Peer.Dead = true;
	Presets.Options.SelectCallback(1, strPreset);
	match(g_vecReplies.at(-1)[1], /no longer eligible/);
	const LiveTargets = g_mapMenus.get(1);
	strictEqual(LiveTargets.Items.some((Item) => Item.Value === 903), false);
	strictEqual(g_vecActions.length, unActionsBeforeStaleTarget);
	strictEqual(g_Peer.Gravity, flOriginalGravity);
	g_Peer.Dead = false;

	const TargetsBeforeImmunity = SelectAdminAction("slay", strAction);
	g_mapPermissions.set(3, new Set(["sourcejs.immunity"]));
	TargetsBeforeImmunity.Options.SelectCallback(1, 903);
	match(g_vecReplies.at(-1)[1], /immune player/);
	const TargetsAfterImmunity = g_mapMenus.get(1);
	notStrictEqual(TargetsAfterImmunity, TargetsBeforeImmunity);
	strictEqual(TargetsAfterImmunity.Items.some((Item) => Item.Value === 903), false);
	strictEqual(g_vecActions.length, unActionsBeforeStaleTarget);
	g_mapPermissions.delete(3);

	const UnprivilegedTargets = SelectAdminAction("slay", strAction);
	g_mapPermissions.get(1).delete("sourcejs.slay");
	const unBeforeDeniedSelection = g_vecReplies.length;
	UnprivilegedTargets.Options.SelectCallback(1, 903);
	strictEqual(g_vecReplies.length, unBeforeDeniedSelection);
	strictEqual(g_mapMenus.get(1), UnprivilegedTargets);
	strictEqual(g_vecActions.length, unActionsBeforeStaleTarget);
	g_mapPermissions.get(1).add("sourcejs.slay");
	UnprivilegedTargets.Options.SelectCallback(1, 903);
	const AllowedPresets = g_mapMenus.get(1);
	AllowedPresets.Options.SelectCallback(1, strPreset);

	if (strAction === "gravity") {
		strictEqual(g_Peer.Gravity, Math.fround(0.1));
		g_Peer.Gravity = flOriginalGravity;
	} else {
		deepStrictEqual(g_vecActions.at(-1), ["fade", 3, 240, g_unExpectedBlindFadeMask, g_unExpectedBlindFadeSeconds, g_unExpectedBlindFadeSeconds]);
	}

	const RedisplayedTargets = g_mapMenus.get(1);
	notStrictEqual(RedisplayedTargets, AllowedPresets);
	strictEqual(RedisplayedTargets.Items.some((Item) => Item.Value === 903), true);
	g_Peer.UserID = 103;
	RedisplayedTargets.CloseMenu(1);
}

g_bHasShowMenu = true;
const g_LastGravityTargets = SelectAdminAction("slay", "gravity");
const g_vecPreviouslyLiveTargets = Array.from(g_mapPlayers.values()).filter((Player) => Player.Connected && !Player.Dead);
for (const Player of g_vecPreviouslyLiveTargets) {
	Player.Dead = true;
}

try {
	g_LastGravityTargets.Options.SelectCallback(1, 103);
	const EmptyGravityTargets = g_mapMenus.get(1);
	notStrictEqual(EmptyGravityTargets, g_LastGravityTargets);
	match(g_vecReplies.at(-1)[1], /There are no eligible players/);
	deepStrictEqual(EmptyGravityTargets.Items.map((Item) => Item.Text), ["Back to actions"]);
	EmptyGravityTargets.Options.SelectCallback(1, null);
	strictEqual(g_mapMenus.get(1).Items.some((Item) => Item.Value?.Name === "gravity"), true);
} finally {
	for (const Player of g_vecPreviouslyLiveTargets) {
		Player.Dead = false;
	}
}

const g_NextMapMenu = SelectAdminAction("map", "setnextmap");
strictEqual(g_NextMapMenu.constructor, PagedRadioMenu);
g_mapPermissions.get(1).delete("sourcejs.map");
const g_strBeforeDeniedNextMap = g_mapConVars.get("nextlevel").Value;
SelectAdminMenuOption("map_two");
strictEqual(g_mapConVars.get("nextlevel").Value, g_strBeforeDeniedNextMap);

g_mapPermissions.get(1).add("sourcejs.map");
SelectAdminAction("map", "setnextmap");
SelectAdminMenuOption("map_two");
strictEqual(g_mapConVars.get("nextlevel").Value, "map_two");

g_mapClientLanguages.set(1, "russian");
try {
	strictEqual(Chat(1, "/admin"), 1);
	g_mapMenus.get(1).Options.SelectCallback(1, "vote");
	const VoteMenu = g_mapMenus.get(1);
	strictEqual(VoteMenu.constructor, PagedRadioMenu);
	const unPageCount = VoteMenu.GetMenuPageCount();
	const vecVisibleLabels = [];
	strictEqual(VoteMenu.RenderMenu.GetPlayerMenuPage(1), 0);
	strictEqual(unPageCount > 1, true);

	for (let unPageIndex = 0; unPageIndex < unPageCount; unPageIndex += 1) {
		const { MenuMessage: strPage } = VoteMenu.BuildMenuRenderData(1, unPageIndex);
		strictEqual(Buffer.byteLength(strPage, "utf8") <= 384, true, `Russian vote menu page ${unPageIndex + 1}`);
		const vecLines = strPage.split("\n");
		strictEqual(vecLines[0], `Голосования сервера [${unPageIndex + 1}/${unPageCount}]`);
		deepStrictEqual(vecLines.slice(-3), [
			`${(unPageIndex > 0) ? "->" : ""}8. Предыдущая страница`,
			`${(unPageIndex < (unPageCount - 1)) ? "->" : ""}9. Следующая страница`,
			"0. Закрыть",
		]);

		const vecPageOptions = VoteMenu.RenderMenu.GetMenuOptions(unPageIndex);
		for (const Option of vecPageOptions) {
			const strLabel = Option.GetMenuText(1);
			strictEqual(vecLines.includes(`->${Option.ChoiceIndex}. ${strLabel}`), true);
			vecVisibleLabels.push(strLabel);
		}
	}

	deepStrictEqual(vecVisibleLabels, VoteMenu.Items.map((Option) => Option.Text));
	strictEqual(vecVisibleLabels.includes("Голосование за поджог игрока"), true);
	VoteMenu.CloseMenu(1);
} finally {
	g_mapClientLanguages.delete(1);
}

SelectAdminAction("vote", "votemap");
SelectAdminMenuOption("map_one");
strictEqual(g_mapMenus.get(1).Items.some((Option) => Option.Text === "map_one"), false);
SelectAdminMenuOption("map_three");
SelectAdminMenuOption("Review vote (2)");
strictEqual(g_mapMenus.get(1).Options.Title, "Confirm vote: map_one, map_three");
strictEqual(g_mapMenus.has(2), false);

g_strMapCycle = "map_one\nmap_two\n";
strictEqual(Chat(1, "/mapchooser_refresh"), 1);
SelectAdminMenuOption("Start the vote");
match(g_vecReplies.at(-1)[1], /no longer available in the map cycle/);
strictEqual(g_mapMenus.has(2), false);

g_strMapCycle = "map_one\nmap_two\nmap_three\n";
strictEqual(Chat(1, "/mapchooser_refresh"), 1);
SelectAdminAction("vote", "votemap");
SelectAdminMenuOption("map_three");
SelectAdminMenuOption("Review vote (1)");
SelectAdminMenuOption("Start the vote");
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Change map to map_three?");
strictEqual(Chat(1, "/cancelvote"), 1);

const g_MenuVoteBot = AddPlayer(4, 604, "Vote target bot");
g_MenuVoteBot.FakeClient = true;
const g_KickVoteTargets = SelectAdminAction("vote", "votekick");
strictEqual(g_KickVoteTargets.constructor, PagedRadioMenu);
strictEqual(g_KickVoteTargets.Items.some((Option) => Option.Value === 604), true);
g_KickVoteTargets.Options.SelectCallback(1, 604);
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Kick Vote target bot?");
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["kick", 604, "Kicked by an administrator."]);

const g_unBeforeDeniedBanVote = g_vecActions.length;
strictEqual(Chat(1, "/voteban", "#604"), 1);
match(g_vecReplies.at(-1)[1], /requires a human target/);
strictEqual(g_mapMenus.size, 0);
g_bHasShowMenu = false;
const g_BanVoteTargets = SelectAdminAction("vote", "voteban");
strictEqual(g_BanVoteTargets.constructor, PagedESCMenu);
strictEqual(g_BanVoteTargets.Items.some((Option) => Option.Value === 604), false);
g_setVotePermissions.delete("sourcejs.ban");
g_BanVoteTargets.Options.SelectCallback(1, 103);
strictEqual(g_mapMenus.has(2), false);
strictEqual(g_vecActions.length, g_unBeforeDeniedBanVote);
g_setVotePermissions.add("sourcejs.ban");

SelectAdminAction("vote", "voteban").Options.SelectCallback(1, 103);
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Ban for 45 minutes: Test Peer?");
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.slice(g_unBeforeDeniedBanVote), [["ban", 103, 45, false, false], ["kick", 103, "Banned from this server."]]);
g_mapPlayers.delete(4);
g_bHasShowMenu = true;

const g_strGravityBeforeMenuVote = g_mapConVars.get("sv_gravity").Value;
SelectAdminAction("vote", "votegravity");
const g_GravityBallot = g_mapMenus.get(2);
strictEqual(g_GravityBallot.constructor, SimpleRadioMenu);
deepStrictEqual(g_GravityBallot.Items.map((Option) => Option.Text), ["200", "400", "800", "1600", "3200"]);
strictEqual(Chat(2, "/votefor", "4"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("sv_gravity").Value, "1600");
g_mapConVars.get("sv_gravity").Value = g_strGravityBeforeMenuVote;

g_bHasShowMenu = false;
const g_SlayVoteTargets = SelectAdminAction("vote", "voteslay");
strictEqual(g_SlayVoteTargets.constructor, PagedESCMenu);
g_setVotePermissions.delete("sourcejs.slay");
g_SlayVoteTargets.Options.SelectCallback(1, 103);
strictEqual(g_mapMenus.has(2), false);

strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "vote");
strictEqual(g_mapMenus.get(1).Items.some((Option) => ["voteburn", "voteslay"].includes(Option.Value?.Name)), false);

g_setVotePermissions.add("sourcejs.slay");
g_Peer.Dead = true;
const g_BurnVoteTargets = SelectAdminAction("vote", "voteburn");
strictEqual(g_BurnVoteTargets.Items.some((Option) => Option.Value === 103), false);
g_BurnVoteTargets.Options.SelectCallback(1, null);
strictEqual(g_mapMenus.get(1).Options.Title, "Voting actions");

g_Peer.Dead = false;
SelectAdminAction("vote", "voteburn").Options.SelectCallback(1, 103);
const g_BurnBallot = g_mapMenus.get(2);
strictEqual(g_BurnBallot.constructor, SimpleESCMenu);
strictEqual(RenderMenuText(g_BurnBallot.Options.Title), "Burn Test Peer?");
strictEqual(RenderMenuText(g_mapMenus.get(1).Options.Title), "Burn Test Peer?");
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["ignite", 103, g_flExpectedVoteBurnSeconds]);
strictEqual(g_mapMenus.size, 0);

SelectAdminAction("vote", "voteslay").Options.SelectCallback(1, 103);
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Slay Test Peer?");
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
deepStrictEqual(g_vecActions.at(-1), ["slay", 103]);
strictEqual(g_Peer.Dead, true);
g_Peer.Dead = false;

const g_strFriendlyFireBeforeMenuVote = g_mapConVars.get("mp_friendlyfire").Value;
SelectAdminAction("vote", "voteff");
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("mp_friendlyfire").Value, (g_strFriendlyFireBeforeMenuVote === "0") ? "1" : "0");
g_mapConVars.get("mp_friendlyfire").Value = g_strFriendlyFireBeforeMenuVote;

g_mapConVars.set("sv_alltalk", { Exists: true, Value: "0" });
SelectAdminAction("vote", "votealltalk");
strictEqual(RenderMenuText(g_mapMenus.get(2).Options.Title), "Set sv_alltalk to 1?");
strictEqual(Chat(2, "/votefor", "1"), 1);
g_vecDelayed.at(-1).Callback();
strictEqual(g_mapConVars.get("sv_alltalk").Value, "1");
g_mapConVars.delete("sv_alltalk");
g_bHasShowMenu = true;

const g_ChangeMapMenu = SelectAdminAction("map", "map");
strictEqual(g_ChangeMapMenu.Options.Title, "Select a map");
SelectAdminMenuOption("map_three");
const g_MenuMapChange = g_vecDelayed.at(-1);
strictEqual(g_MenuMapChange.Seconds, g_unExpectedMapCommandDelaySeconds);
g_MenuMapChange.Callback();
deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_three"]);

const g_setDirectMapPermissions = new Set(["sourcejs.map"]);
g_mapPermissions.set(2, g_setDirectMapPermissions);

for (const bHasShowMenu of [true, false]) {
	g_bHasShowMenu = bHasShowMenu;
	const unActionsBeforeDirectMap = g_vecActions.length;
	strictEqual(Chat(2, "!map"), 0);
	const DirectMapMenu = g_mapMenus.get(2);
	strictEqual(DirectMapMenu.constructor, bHasShowMenu ? PagedRadioMenu : PagedESCMenu);
	strictEqual(DirectMapMenu.Options.Title, "Select a map");
	strictEqual(DirectMapMenu.Items.some((Item) => Item.Text === "Back to actions"), false);
	const DirectMapChoice = DirectMapMenu.Items.find((Item) => Item.Text === "map_two");
	g_setDirectMapPermissions.delete("sourcejs.map");
	DirectMapMenu.Options.SelectCallback(2, DirectMapChoice.Value);
	strictEqual(g_vecActions.length, unActionsBeforeDirectMap);
	DirectMapMenu.CloseMenu(2);

	strictEqual(Chat(2, "/map"), 1);
	match(g_vecReplies.at(-1)[1], /do not have permission/);
	strictEqual(g_mapMenus.has(2), false);

	g_setDirectMapPermissions.add("sourcejs.map");
	strictEqual(Chat(2, "/map"), 1);
	const AllowedMapMenu = g_mapMenus.get(2);
	AllowedMapMenu.Options.SelectCallback(2, AllowedMapMenu.Items.find((Item) => Item.Text === "map_two").Value);
	const DirectMapDelay = g_vecDelayed.at(-1);
	strictEqual(DirectMapDelay.Seconds, g_unExpectedMapCommandDelaySeconds);
	strictEqual(g_vecActions.length, unActionsBeforeDirectMap);
	DirectMapDelay.Callback();
	deepStrictEqual(g_vecActions.at(-1), ["change-map", "map_two"]);
	AllowedMapMenu.CloseMenu(2);
}

g_mapPermissions.delete(2);
g_bHasShowMenu = true;
strictEqual(RunServerCommand("map"), 1);
match(g_vecReplies.at(-1)[1], /Specify an installed map name/);

const g_PendingAdminMapMenu = SelectAdminAction("map", "map");
strictEqual(g_PendingAdminMapMenu.Options.Title, "Select a map");
g_bHasShowMenu = false;
const g_ESCMapMenu = SelectAdminAction("map", "setnextmap");
strictEqual(g_ESCMapMenu.constructor, PagedESCMenu);
SelectAdminMenuOption("Back to actions");
strictEqual(g_mapMenus.get(1).Options.Title, "Map actions");

const g_ESCBanReason = OpenBanReasonMenu("30");
strictEqual(g_ESCBanReason.constructor, PagedESCMenu);
strictEqual(g_ESCBanReason.UseTextDialogFallback, false);
g_ESCBanReason.Options.SelectCallback(1, null);
const g_ESCBanDuration = g_mapMenus.get(1);
strictEqual(g_ESCBanDuration.constructor, PagedESCMenu);
match(g_ESCBanDuration.Options.Title, /Ban duration/);
const g_unBeforeStaleBanSelection = g_vecActions.length;
g_ESCBanReason.Options.SelectCallback(1, "Spam");
strictEqual(g_vecActions.length, g_unBeforeStaleBanSelection);

const g_ESCSlapDamage = SelectAdminAction("slay", "slap");
strictEqual(g_ESCSlapDamage.constructor, PagedESCMenu);
g_ESCSlapDamage.Options.SelectCallback(1, "5");
const g_ESCSlapTargets = g_mapMenus.get(1);
strictEqual(g_ESCSlapTargets.constructor, PagedESCMenu);
match(g_ESCSlapTargets.Options.Title, /5 damage/);
const g_nHealthBeforeESCSlap = g_Peer.Health;
g_ESCSlapTargets.Options.SelectCallback(1, 103);
strictEqual(g_Peer.Health, g_nHealthBeforeESCSlap - 5);
g_Peer.Health = g_nHealthBeforeESCSlap;

const g_ESCCommunication = OpenCommunicationMenu(103);
strictEqual(g_ESCCommunication.constructor, PagedESCMenu);
g_ESCCommunication.Options.SelectCallback(1, "gag");
strictEqual(Chat(3, "blocked by ESC menu"), 1);
strictEqual(Chat(1, "/ungag", "#103"), 1);

g_bHasShowMenu = true;
const g_unBeforeDeniedWho = g_vecReplies.length;
strictEqual(Chat(2, "/who", "#101"), 1);
deepStrictEqual(g_vecReplies.slice(g_unBeforeDeniedWho), [[2, "[SourceJS] You do not have permission to use this command.\n"]]);

strictEqual(Chat(1, "/who"), 1);
match(g_vecReplies.at(-2)[1], /#102 Test Player: no bundled command permissions/);
match(g_vecReplies.at(-1)[1], /See your console/);

g_mapPermissions.set(2, new Set(["sourcejs.cheats"]));
strictEqual(Chat(1, "/who", "#102"), 1);
match(g_vecReplies.at(-1)[1], /#102 Test Player: cheats\s*$/);
const g_unBeforeNoClipDenials = g_vecActions.length;
strictEqual(Chat(2, "/noclip", "@me"), 1);
match(g_vecReplies.at(-1)[1], /do not have permission/);
g_mapPermissions.get(2).add("sourcejs.slay");
strictEqual(Chat(1, "/who", "#102"), 1);
match(g_vecReplies.at(-1)[1], /#102 Test Player: cheats, slay\s*$/);
g_mapPermissions.get(2).delete("sourcejs.cheats");
strictEqual(Chat(2, "/noclip", "@me"), 1);
match(g_vecReplies.at(-1)[1], /also requires sourcejs\.cheats/);
strictEqual(g_vecActions.length, g_unBeforeNoClipDenials);

g_mapPermissions.set(2, new Set(["sourcejs.map"]));
const g_WhoMenu = SelectAdminAction("admin", "Identify player");
strictEqual(g_WhoMenu.constructor, PagedRadioMenu);
strictEqual(g_WhoMenu.Options.Title, "Identify a player");
g_mapPermissions.get(2).add("sourcejs.immunity");
SelectAdminMenuOption("Test Player");
match(g_vecReplies.at(-1)[1], /immune player/);
strictEqual(Chat(1, "/who", "#102"), 1);
match(g_vecReplies.at(-1)[1], /immune player/);

g_mapPermissions.get(1).add("sourcejs.targetimmune");
g_bHasShowMenu = false;
const g_ESCWhoMenu = SelectAdminAction("admin", "Identify player");
strictEqual(g_ESCWhoMenu.constructor, PagedESCMenu);
const g_unBeforeRevokedWho = g_vecReplies.length;
g_mapPermissions.get(1).delete("sourcejs.admin");
SelectAdminMenuOption("Test Player");
strictEqual(g_vecReplies.length, g_unBeforeRevokedWho);
g_mapPermissions.get(1).add("sourcejs.admin");
g_Target.UserID = 902;
SelectAdminMenuOption("Test Player");
match(g_vecReplies.at(-1)[1], /No matching player/);

g_Target.UserID = 102;
g_bUserMessageReplies = true;
const g_unBeforeWhoReplies = g_vecReplies.length;
SelectAdminMenuOption("Test Player");
deepStrictEqual(g_vecReplies.slice(g_unBeforeWhoReplies), [[1, "[SourceJS] #102 Test Player: map"]]);
g_bUserMessageReplies = false;
g_mapPermissions.get(1).delete("sourcejs.targetimmune");
g_mapPermissions.delete(2);
g_bHasShowMenu = true;

strictEqual(Chat(1, "/admin"), 1);
strictEqual(g_mapMenus.get(1).Items.some((Option) => Option.Value === "config"), false);
const g_unBeforeConfigurationActions = g_vecActions.length;
const g_unBeforeAuthorizationReloads = g_unAuthorizationReloads;
strictEqual(Chat(1, "/execcfg", "match.cfg"), 1);
match(g_vecReplies.at(-1)[1], /permission/i);
strictEqual(Chat(1, "/reloadadmins"), 1);
strictEqual(g_unAuthorizationReloads, g_unBeforeAuthorizationReloads);
g_mapPermissions.get(1).add("sourcejs.config");

strictEqual(Chat(1, "/execcfg", "../unsafe.cfg"), 1);
match(g_vecReplies.at(-1)[1], /without a directory/);
strictEqual(Chat(1, "/execcfg", "missing.cfg"), 1);
match(g_vecReplies.at(-1)[1], /Config not found/);
strictEqual(g_vecActions.length, g_unBeforeConfigurationActions);

SelectAdminAction("config", "execcfg");
match(g_vecReplies.at(-1)[1], /No config files/);
strictEqual(g_mapMenus.get(1).Options.Title, "Server actions");

g_setInstalledConfigurations.add("cfg/match.cfg");
g_strConfigurationMenu = JSON.stringify([{ File: "../unsafe.cfg", Label: "Unsafe" }]);
SelectAdminAction("config", "execcfg");
match(g_vecReplies.at(-1)[1], /unique .cfg basename/);

g_strConfigurationMenu = JSON.stringify([{ File: "match.cfg", Label: "Match settings" }, { File: "missing.cfg", Label: "Missing settings" }]);

const g_ConfigurationMenu = SelectAdminAction("config", "execcfg");
strictEqual(g_ConfigurationMenu.constructor, PagedRadioMenu);
deepStrictEqual(g_ConfigurationMenu.Items.map((Option) => Option.Text), ["Match settings", "Back to server actions"]);
g_mapPermissions.get(1).delete("sourcejs.config");
SelectAdminMenuOption("Match settings");
strictEqual(g_vecActions.length, g_unBeforeConfigurationActions);
g_mapPermissions.get(1).add("sourcejs.config");

SelectAdminAction("config", "execcfg");
g_strConfigurationMenu = "[]";
SelectAdminMenuOption("Match settings");
match(g_vecReplies.at(-1)[1], /no longer listed/);

g_strConfigurationMenu = JSON.stringify([{ File: "match.cfg", Label: "Match settings" }]);
SelectAdminAction("config", "execcfg");
g_setInstalledConfigurations.delete("cfg/match.cfg");
SelectAdminMenuOption("Match settings");
match(g_vecReplies.at(-1)[1], /Config not found/);
strictEqual(g_vecActions.length, g_unBeforeConfigurationActions);

g_setInstalledConfigurations.add("cfg/match.cfg");
g_bHasShowMenu = false;
const g_ESCConfigurationMenu = SelectAdminAction("config", "execcfg");
strictEqual(g_ESCConfigurationMenu.constructor, PagedESCMenu);
SelectAdminMenuOption("Back to server actions");
strictEqual(g_mapMenus.get(1).Options.Title, "Server actions");
g_ESCConfigurationMenu.Options.SelectCallback(1, "match.cfg");
strictEqual(g_vecActions.length, g_unBeforeConfigurationActions);

SelectAdminMenuOption("execcfg");
SelectAdminMenuOption("Match settings");
deepStrictEqual(g_vecActions.at(-1), ["engine", "exec match.cfg"]);
match(g_vecReplies.at(-1)[1], /Config execution submitted/);

strictEqual(Chat(1, "/admin"), 1);
g_mapMenus.get(1).Options.SelectCallback(1, "config");
g_mapPermissions.get(1).delete("sourcejs.config");
SelectAdminMenuOption("reloadadmins");
strictEqual(g_unAuthorizationReloads, g_unBeforeAuthorizationReloads);

g_mapPermissions.get(1).add("sourcejs.config");
const g_unBeforeMenuAuthorizationReplies = g_vecReplies.length;
SelectAdminAction("config", "reloadadmins");
strictEqual(g_unAuthorizationReloads, g_unBeforeAuthorizationReloads + 1);
strictEqual(g_mapMenus.get(1).Options.Title, "Server actions");
deepStrictEqual(g_vecReplies.slice(g_unBeforeMenuAuthorizationReplies), [
	[1, "[SourceJS] Choose a category to view its actions.\n"],
	[1, "[SourceJS] Authorization configuration read.\n"],
	[1, "[SourceJS] SQL administrator permissions refreshed.\n"],
]);

g_mapPermissions.get(1).delete("sourcejs.config");
g_bHasShowMenu = true;
strictEqual(Chat(1, "/admin"), 1);
const g_AdminMenuBeforeUnload = g_mapMenus.get(1);
g_Plugin.Unload();

const g_unAfterMapMenuUnload = g_vecActions.length;
g_PendingAdminMapMenu.Options.SelectCallback(1, { Map: "map_three" });
g_AdminMenuBeforeUnload.Options.SelectCallback(1, "ban");
strictEqual(g_vecActions.length, g_unAfterMapMenuUnload);
strictEqual(g_PendingMapMenuAutomaticCheck.Callback, null);
strictEqual(g_mapMenus.size, 0);
strictEqual(g_ChatFilter, null);
strictEqual(g_mapListeners.size, 0);
strictEqual(g_mapEventListeners.size, 0);

// Reload on a running map without receiving ServerActivate first.
for (const strModulePath of g_mapModuleCache.keys()) {
	if (dirname(strModulePath) === g_strAdministrationRoot) {
		g_mapModuleCache.delete(strModulePath);
	}
}

g_strCurrentMap = "";
g_flServerTime = 500;
g_strMapCycle = "map_one\nmap_two\nmap_three\n";
g_mapConVars.get("nextlevel").Value = "map_one";
g_mapConVars.get("mp_timelimit").Value = "2";
g_mapConVars.get("mp_maxrounds").Value = "4";
const g_ReloadedAdministration = LoadFile(join(g_strAdministrationRoot, g_Manifest.Entry));
g_strMapCycle = null;
g_vecInstalledMaps = ["map_one", "map_two", "map_three"];
g_mapConVars.get("sjs_rockthevote").Value = "1";
g_mapConVars.get("sjs_mapchooser").Value = "1";
g_mapConVars.get("sjs_nextmap_enabled").Value = "1";
g_mapConVars.get("sjs_mapvote_start").Value = "3";
const g_unBeforeFirstMap = g_vecDelayed.length;
g_mapListeners.get("tick")();
strictEqual(g_vecDelayed.length, g_unBeforeFirstMap);

g_strCurrentMap = "map_one";
g_mapListeners.get("tick")();
strictEqual(g_mapConVars.get("nextlevel").Value, "map_one");
strictEqual(g_vecDelayed.length, g_unBeforeFirstMap + 1);
const g_LateAutomaticCheck = g_vecDelayed.at(-1);
g_mapListeners.get("tick")();
strictEqual(g_vecDelayed.at(-1), g_LateAutomaticCheck);
strictEqual(RunServerCommand("listmaps"), 1);
deepStrictEqual(g_vecReplies.slice(-4), [[0, "Map cycle:"], [0, "map_one"], [0, "map_two"], [0, "map_three"]]);
strictEqual(RunServerCommand("timeleft"), 1);
match(g_vecReplies.at(-1)[1], /unavailable until the next map.*Round limit: 4/);
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecReplies.at(-1)[1], /opens in 30 second/);

g_flServerTime = 530;
g_LateAutomaticCheck.Callback();
strictEqual(g_mapMenus.size, 0);
strictEqual(Chat(2, "/rtv"), 1);
match(g_vecChatMessages.at(-1), /rocked the vote: 1\/2/);
const g_PendingLateCheck = g_vecDelayed.at(-1);
g_mapListeners.get("level-end")();
strictEqual(g_PendingLateCheck.Callback, null);
g_mapListeners.get("tick")();
strictEqual(g_vecDelayed.at(-1), g_PendingLateCheck);

g_strCurrentMap = "map_two";
g_flServerTime = 10;
g_strMapCycle = "map_one\nmap_two\nmap_three\n";
g_vecInstalledMaps = [];
g_mapListeners.get("level-start")();
strictEqual(RunServerCommand("timeleft"), 1);
match(g_vecReplies.at(-1)[1], /2m 0s.*Rounds remaining: 4/);

const { GetPreviousMaps } = LoadFile(join(g_strAdministrationRoot, "map-history.js"));
strictEqual(g_strRecentMapsContents, null);
g_strRecentMapsContents = "map_four\r\n../invalid\r\nMAP_FOUR\r\nmap_two\r\nmap_five\r\n";
g_mapConVars.get("sjs_mapvote_persistentmaps").Value = "1";
deepStrictEqual(Array.from(GetPreviousMaps(4)), ["MAP_FOUR", "map_five", "map_one"]);
g_mapConVars.get("sjs_nominations").Value = "1";
g_strMapCycle = "map_one\nmap_two\nmap_three\nmap_four\nmap_five\n";
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
strictEqual(Chat(3, "/nominate", "map_four"), 1);
match(g_vecReplies.at(-1)[1], /recently played/);
strictEqual(RunServerCommand("maphistory"), 1);
strictEqual(g_vecReplies.slice(-4).some(([, strReply]) => /map_four|map_five/i.test(strReply)), false);
g_mapListeners.get("level-end")();
strictEqual(g_strRecentMapsContents, "MAP_FOUR\nmap_five\nmap_one\nmap_two\n");

g_bRejectRecentMapsWrite = true;
g_strCurrentMap = "map_three";
g_mapListeners.get("level-start")();
g_mapListeners.get("level-end")();
deepStrictEqual(Array.from(GetPreviousMaps(4)), ["MAP_FOUR", "map_five", "map_one", "map_two"]);
strictEqual(g_strRecentMapsContents, "MAP_FOUR\nmap_five\nmap_one\nmap_two\n");
match(g_vecReplies.at(-1)[1], /Could not save recent maps/);
g_bRejectRecentMapsWrite = false;
g_mapConVars.get("sjs_mapvote_persistentmaps").Value = "0";
g_strCurrentMap = "map_two";
g_mapListeners.get("level-start")();
deepStrictEqual(Array.from(GetPreviousMaps(4)), ["MAP_FOUR", "map_five", "map_one", "map_three"]);

g_strMapCycle = "map_two\nmap_three\nmap_four\nmap_five\n";
g_mapConVars.get("sjs_nominate_excludeold").Value = "0";
g_mapConVars.get("sjs_mapvote_exclude").Value = "0";
strictEqual(RunServerCommand("mapchooser_refresh"), 1);
g_mapConVars.get("sjs_nominations").Value = "1";
g_mapConVars.get("sjs_mapvote_include").Value = "2";
strictEqual(Chat(3, "/nominate", "map_three"), 1);
match(g_vecChatMessages.at(-1), /nominated map_three/);

try {
	g_ContextMath.random = () => 0.999;
	strictEqual(Chat(1, "/mapvote"), 1);
	deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_three", "map_five"]);
	strictEqual(Chat(1, "/cancelvote"), 1);
	strictEqual(Chat(1, "/mapvote"), 1);
	deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_five", "map_four"]);
	strictEqual(Chat(1, "/cancelvote"), 1);
	g_ContextMath.random = () => 0;
	strictEqual(Chat(1, "/mapvote"), 1);
	deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_three", "map_four"]);
	strictEqual(Chat(1, "/cancelvote"), 1);
} finally {
	g_ContextMath.random = g_OriginalContextRandom;
}

strictEqual(Chat(2, "/nominate", "map_three"), 1);
strictEqual(Chat(3, "/nominate", "map_four"), 1);
const g_unAnnouncementsBeforeFullNomination = g_vecChatMessages.length;
strictEqual(Chat(1, "/nominate", "map_five"), 1);
match(g_vecReplies.at(-1)[1], /nomination list is full/);
strictEqual(g_vecChatMessages.length, g_unAnnouncementsBeforeFullNomination);

strictEqual(Chat(2, "/nominate", "map_five"), 1);
match(g_vecReplies.at(-1)[1], /Replaced map_three with map_five/);
strictEqual(Chat(3, "/nominate_addmap", "map_three"), 1);
match(g_vecReplies.at(-1)[1], /permission/);
strictEqual(Chat(1, "/mapvote"), 1);
deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_five", "map_four"]);
strictEqual(Chat(1, "/cancelvote"), 1);

strictEqual(Chat(2, "/nominate", "map_five"), 1);
strictEqual(Chat(3, "/nominate", "map_four"), 1);
strictEqual(RunServerCommand("nominate_addmap", "map_three"), 1);
match(g_vecReplies.at(-1)[1], /Nominated map_three/);
strictEqual(Chat(1, "/mapvote"), 1);
deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_four", "map_three"]);
strictEqual(Chat(1, "/cancelvote"), 1);

g_mapConVars.get("sjs_mapvote_include").Value = "3";
strictEqual(Chat(1, "/nominate", "map_three"), 1);
strictEqual(Chat(2, "/nominate", "map_four"), 1);
strictEqual(Chat(3, "/nominate", "map_five"), 1);
g_mapConVars.get("sjs_mapvote_include").Value = "2";
strictEqual(RunServerCommand("nominate_addmap", "map_four"), 1);
match(g_vecReplies.at(-1)[1], /already nominated/);
strictEqual(Chat(1, "/mapvote"), 1);
deepStrictEqual(g_mapMenus.get(2).Items.map((Item) => Item.Text), ["map_three", "map_four"]);
strictEqual(Chat(1, "/cancelvote"), 1);

g_ReloadedAdministration.Unload();
strictEqual(g_mapListeners.size, 0);

const g_strProtectionRoot = join(g_strPluginRoot, "server-protection");
const g_ProtectionManifest = JSON.parse(readFileSync(join(g_strProtectionRoot, "plugin.json"), "utf8"));
strictEqual(g_ProtectionManifest.Autoload, true);
const g_Protection = LoadFile(join(g_strProtectionRoot, g_ProtectionManifest.Entry));
const g_VisibleCapacity = { Exists: true, Value: "9" };
g_mapConVars.set("sv_visiblemaxplayers", g_VisibleCapacity);
g_Protection.Load();
const g_VisibilityTask = g_vecRepeatingTasks.at(-1);
let g_unRegularChatCalls = 0;

function HandleTestChat() {
	++g_unRegularChatCalls;

	return g_Modules.commands.CONTINUE;
}

g_Modules["commands/say"].RegisterCommandFilter(HandleTestChat);

const g_unExpectedFloodBurstMessageCount = 4;
for (let unMessageCount = 0; unMessageCount < g_unExpectedFloodBurstMessageCount; ++unMessageCount) {
	strictEqual(Chat(2, "hello"), 0);
}

g_mapClientLanguages.set(2, "russian");
strictEqual(Chat(2, "/help"), 1);
strictEqual(Chat(2, "!help"), 1);
strictEqual(g_unRegularChatCalls, g_unExpectedFloodBurstMessageCount);
deepStrictEqual(g_vecActions.at(-1), ["chat-warning", [2], "[SourceJS] Вы отправляете сообщения слишком часто."]);
deepStrictEqual(g_vecChatDeliveries.at(-1), [[2], "[SourceJS] Вы отправляете сообщения слишком часто."]);
strictEqual(Chat(3, "a different client"), 0);

g_flServerTime = 1;
g_bHasTextMsg = false;
strictEqual(Chat(2, "extends penalty"), 1);
deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] You are sending chat messages too quickly.\n"]);
g_mapClientLanguages.delete(2);
g_bHasTextMsg = true;
g_bTextMsgDeliveryThrows = true;
strictEqual(Chat(2, "failed delivery still blocks"), 1);
deepStrictEqual(g_vecReplies.at(-1), [2, "[SourceJS] You are sending chat messages too quickly.\n"]);

g_bConsoleDeliveryThrows = true;
const g_unCallsBeforeFailedFloodWarnings = g_unRegularChatCalls;
const g_unRepliesBeforeFailedFloodWarnings = g_vecReplies.length;
strictEqual(Chat(2, "ordinary flood chat"), 1);
strictEqual(Chat(2, "!help"), 1);
strictEqual(Chat(2, "/help"), 1);
strictEqual(g_unRegularChatCalls, g_unCallsBeforeFailedFloodWarnings);
strictEqual(g_vecReplies.length, g_unRepliesBeforeFailedFloodWarnings);
g_bConsoleDeliveryThrows = false;
g_bTextMsgDeliveryThrows = false;

g_flServerTime = 4.76;
strictEqual(Chat(2, "penalty elapsed"), 0);
strictEqual(Chat(2, "one strike had decayed"), 0);
strictEqual(Chat(2, "too fast again"), 1);

g_mapPermissions.set(2, new Set(["sourcejs.flood"]));
strictEqual(Chat(2, "exempt"), 0);
g_mapPermissions.get(2).delete("sourcejs.flood");
g_mapConVars.get("sjs_flood_time").Value = "0";
strictEqual(Chat(2, "disabled"), 0);
g_mapConVars.get("sjs_flood_time").Value = "0.75";
strictEqual(Chat(2, "enabled again"), 1);

g_mapListeners.get("disconnect")(2);
strictEqual(Chat(2, "disconnect cleared state"), 0);

for (let unMessageCount = 1; unMessageCount < g_unExpectedFloodBurstMessageCount; ++unMessageCount) {
	strictEqual(Chat(2, "new burst"), 0);
}

strictEqual(Chat(2, "flood"), 1);
g_mapPlayers.set(2, { ...g_Target, UserID: 902 });
strictEqual(Chat(2, "slot reused without a disconnect event"), 0);
g_mapPlayers.set(2, g_Target);
g_mapListeners.get("level-end")();
g_flServerTime = 0;
strictEqual(Chat(2, "new map"), 0);

function CheckReservationJoin(unIndex, unKickedUserID = 0, strReason = "This slot is reserved for a player with reservation access.") {
	const unActionsBeforeJoin = g_vecActions.length;
	g_mapListeners.get("active")(unIndex);
	g_vecDelayed.at(-1).Callback();
	strictEqual(g_vecActions.length, unActionsBeforeJoin + Number(unKickedUserID !== 0));

	if (unKickedUserID !== 0) {
		deepStrictEqual(g_vecActions.at(-1), ["kick", unKickedUserID, strReason]);
	}
}

g_mapListeners.get("level-start")();
g_mapConVars.get("sjs_reserved_slots").Value = "1";
g_mapClientLanguages.set(3, "japanese");
CheckReservationJoin(3, 103, "この枠は予約権限のあるプレイヤー専用です。");
g_mapClientLanguages.delete(3);
g_mapListeners.get("disconnect")(3);
g_mapPermissions.set(3, new Set(["sourcejs.reservation"]));
CheckReservationJoin(3);

g_mapConVars.get("sjs_reserve_type").Value = "1";
g_mapPlayers.get(1).Latency = 0.4;
g_Target.Latency = 0.1;
CheckReservationJoin(3, 101);
g_mapListeners.get("disconnect")(1);

g_Target.Observer = true;
CheckReservationJoin(3, 102);
g_mapListeners.get("disconnect")(2);

g_mapPermissions.get(2).add("sourcejs.reskick_immunity");
CheckReservationJoin(3, 101);
g_mapListeners.get("disconnect")(1);
g_mapPermissions.get(2).delete("sourcejs.reskick_immunity");
g_Target.Observer = false;
g_mapPlayers.get(1).ConnectedSeconds = 10;
g_Target.ConnectedSeconds = 20;
g_mapConVars.get("sjs_reserve_kicktype").Value = "1";
CheckReservationJoin(3, 102);
g_mapListeners.get("disconnect")(2);

g_mapConVars.get("sjs_reserve_kicktype").Value = "2";
g_Target.Observer = true;
CheckReservationJoin(3, 102);
g_mapListeners.get("disconnect")(2);
g_Target.Observer = false;
g_mapConVars.get("sjs_reserve_kicktype").Value = "1";
g_mapPermissions.get(2).add("sourcejs.reskick_immunity");
CheckReservationJoin(2, 102);
g_mapPermissions.get(2).delete("sourcejs.reskick_immunity");
g_mapListeners.get("disconnect")(2);

g_mapConVars.get("sjs_reserve_type").Value = "2";
CheckReservationJoin(3);
CheckReservationJoin(2);
g_mapConVars.get("sjs_reserve_maxadmins").Value = "2";
CheckReservationJoin(3, 102);
g_mapListeners.get("disconnect")(2);
CheckReservationJoin(2, 102);
g_mapListeners.get("disconnect")(2);

g_mapListeners.get("active")(3);
const g_StaleAdmission = g_vecDelayed.at(-1);
const g_CheckStaleAdmission = g_StaleAdmission.Callback;
g_mapPlayers.set(3, { ...g_Peer, UserID: 903 });
g_mapListeners.get("active")(3);
strictEqual(g_StaleAdmission.Callback, null);
const g_PendingAdmission = g_vecDelayed.at(-1);
const g_CheckPendingAdmission = g_PendingAdmission.Callback;
const g_unBeforeStaleAdmission = g_vecActions.length;
g_CheckStaleAdmission();
strictEqual(g_vecActions.length, g_unBeforeStaleAdmission);

g_mapListeners.get("active")(3);
strictEqual(g_vecDelayed.at(-1), g_PendingAdmission);
g_mapListeners.get("level-end")();
strictEqual(g_PendingAdmission.Callback, null);
g_CheckPendingAdmission();
strictEqual(g_vecActions.length, g_unBeforeStaleAdmission);

g_mapPlayers.set(3, g_Peer);
g_mapListeners.get("level-start")();
g_mapConVars.get("sjs_hide_slots").Value = "1";
g_VisibilityTask.Callback();
strictEqual(g_VisibleCapacity.Value, "3");
g_mapConVars.get("sjs_reserved_slots").Value = "0";
g_VisibilityTask.Callback();
strictEqual(g_VisibleCapacity.Value, "9");
g_mapConVars.get("sjs_reserved_slots").Value = "1";
g_VisibilityTask.Callback();
strictEqual(g_VisibleCapacity.Value, "3");
g_mapListeners.get("disconnect")(3);
strictEqual(g_VisibleCapacity.Value, "2");
g_mapConVars.get("sjs_hide_slots").Value = "0";
g_VisibilityTask.Callback();
strictEqual(g_VisibleCapacity.Value, "9");

g_mapConVars.get("sjs_hide_slots").Value = "1";
g_VisibilityTask.Callback();
g_VisibleCapacity.Value = "7";
g_VisibilityTask.Callback();
strictEqual(g_VisibleCapacity.Value, "3");

g_Protection.Unload();
strictEqual(g_VisibilityTask.Callback, null);
strictEqual(g_VisibleCapacity.Value, "7");
strictEqual(g_EarlyChatFilter, null);
strictEqual(g_ChatFilter, HandleTestChat);
g_Modules["commands/say"].UnregisterCommandFilter(HandleTestChat);
strictEqual(g_ChatFilter, null);
strictEqual(g_mapListeners.size, 0);
console.log(`Server administration smoke passed: ${g_mapServerCommands.size} commands, authorization, targeting, moderation, vote menus, map rotation, flood protection, reservation and cleanup (runtime doubles).`);
