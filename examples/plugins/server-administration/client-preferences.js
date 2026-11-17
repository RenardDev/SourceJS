"use strict";

const { LogWarning } = require("core/logger");
const { PagedESCMenu, PagedESCOption } = require("menus/esc");
const { GetPlayerMenuQueue } = require("menus/queue");
const { PagedRadioMenu, PagedRadioOption } = require("menus/radio");
const { GetUserMessageIndex } = require("messages");
const { GetUserIDFromIndex } = require("players/helpers");
const { CreateStorage } = require("settings/storage");
const { DefineCommand, Reply, RequireCurrentPlayer } = require("./administration");
const { PlayMenuSound } = require("./menu-sounds");
const { CommandFailure, CommandUsage, JoinPhrases, Phrase, Translate } = require("./translations");

const g_strSoundSetting = "AdminSounds";
const g_unPreferenceMenuTimeoutSeconds = 30;
const g_AsyncOptions = Object.freeze({ Blocking: false });
const g_mapPreferenceSessions = new Map();
let g_Preferences = null;
let g_unPendingRequests = 0;

function GetPersistentPlayerID(strNetworkID) {
	return ((typeof strNetworkID === "string") && /^STEAM_\d+:[01]:\d+$/i.test(strNetworkID)) ? strNetworkID.toUpperCase() : null;
}

function AllowsAdminSounds(strNetworkID) {
	const strPlayerID = GetPersistentPlayerID(strNetworkID);
	if (!strPlayerID || !g_Preferences?.Loaded) {
		return true;
	}

	return g_Preferences.GetCachedPlayerValues(strPlayerID)?.[g_strSoundSetting] !== false;
}

function ClosePreferenceMenu(Session) {
	const Menu = Session.Menu;
	Session.Menu = null;
	Menu?.CloseMenu(Session.Index);
}

function ForgetPreferenceSession(unClientIndex) {
	const Session = g_mapPreferenceSessions.get(unClientIndex);
	g_mapPreferenceSessions.delete(unClientIndex);

	if (Session) {
		try {
			ClosePreferenceMenu(Session);
		} catch (Failure) {
			LogWarning(`Could not close the settings menu: ${Failure?.message ?? "unknown error"}`);
		}
	}
}

function ClosePreferenceSessions() {
	for (const unClientIndex of g_mapPreferenceSessions.keys()) {
		ForgetPreferenceSession(unClientIndex);
	}
}

function IsCurrentPreferenceSession(Session) {
	if (!g_Preferences || (g_mapPreferenceSessions.get(Session.Index) !== Session) || (GetUserIDFromIndex(Session.Index) !== Session.UserID)) {
		return false;
	}

	try {
		return GetPersistentPlayerID(RequireCurrentPlayer(Session).NetworkID) === Session.PlayerID;
	} catch {
		return false;
	}
}

function RunPreferenceRequest(Submit, Callback) {
	++g_unPendingRequests;
	let bCompleted = false;
	try {
		Submit((Failure) => {
			bCompleted = true;
			--g_unPendingRequests;
			Callback(Failure);
		});
	} catch (Failure) {
		if (!bCompleted) {
			--g_unPendingRequests;
		}

		throw Failure;
	}
}

function SetSoundPreference(Session, bAllowed) {
	RunPreferenceRequest((Callback) => g_Preferences.SetSetting(Session.PlayerID, g_strSoundSetting, bAllowed, g_AsyncOptions, Callback), (Failure) => {
		if (IsCurrentPreferenceSession(Session)) {
			Reply(Session.Index, Failure ? Phrase("PreferencesSaveFailed", "Could not save the sound preference.") : (bAllowed ? Phrase("SoundsEnabled", "Admin sounds are now enabled.") : Phrase("SoundsDisabled", "Admin sounds are now disabled.")));
		}
	});
}

function BeginPreferenceSession(unClientIndex) {
	if (unClientIndex === 0) {
		throw CommandFailure("InGameOnly", "Player preferences require an in-game player.");
	}

	const unUserID = GetUserIDFromIndex(unClientIndex);
	const CurrentPlayer = RequireCurrentPlayer({ Index: unClientIndex, UserID: unUserID });
	const strPlayerID = GetPersistentPlayerID(CurrentPlayer.NetworkID);
	if (!strPlayerID || CurrentPlayer.FakeClient || !g_Preferences) {
		throw CommandFailure("SteamRequired", "Persistent preferences require an authenticated Steam player.");
	}

	ForgetPreferenceSession(unClientIndex);
	const Session = { Index: unClientIndex, UserID: unUserID, PlayerID: strPlayerID, Menu: null };
	g_mapPreferenceSessions.set(unClientIndex, Session);

	return Session;
}

function ShowSoundMenu(Session) {
	const bAllowed = AllowsAdminSounds(Session.PlayerID);
	const strTitle = `${Translate(Session.Index, "AdminSounds", "Admin sounds")}: ${Translate(Session.Index, bAllowed ? "Yes" : "No", bAllowed ? "on" : "off")}`;
	const bRadioAvailable = GetUserMessageIndex("ShowMenu") >= 0;
	const Options = {
		Title: strTitle,
		Description: Translate(Session.Index, "SelectOption", "Choose whether to hear sounds sent by administrators."),
		CloseText: Translate(Session.Index, "Close", "Close settings"),
		Fill: false,
		Timeout: g_unPreferenceMenuTimeoutSeconds,
		InteractionCallback: PlayMenuSound,
		SelectCallback(unReceiverIndex, bEnabled) {
			if ((unReceiverIndex === Session.Index) && (Session.Menu === Menu) && IsCurrentPreferenceSession(Session) && (typeof bEnabled === "boolean")) {
				Session.Menu = null;
				SetSoundPreference(Session, bEnabled);
			}
		},
		CloseCallback() {
			if (Session.Menu === Menu) {
				Session.Menu = null;
			}
		},
	};
	const Menu = bRadioAvailable ? new PagedRadioMenu(Options) : new PagedESCMenu(Options);
	const Option = bRadioAvailable ? PagedRadioOption : PagedESCOption;
	Menu.UseTextDialogFallback = false;
	Menu.AppendMenuItem(new Option(Translate(Session.Index, bAllowed ? "DisableSounds" : "EnableSounds", bAllowed ? "Disable admin sounds" : "Enable admin sounds"), !bAllowed));
	Session.Menu = Menu;

	try {
		if (GetPlayerMenuQueue(Session.Index).SendMenu(Menu)) {
			return;
		}
	} catch (Failure) {
		LogWarning(`Could not display the settings menu: ${Failure?.message ?? "unknown error"}`);
	}

	Session.Menu = null;
	const strFallback = `Admin sounds: ${bAllowed ? "on" : "off"}`;
	Reply(Session.Index, (unClientIndex) => Translate(unClientIndex, "SettingsHint", "{Current}. Use /settings on or /settings off to change it.", { Current: (unClientIndex === null) ? strFallback : strTitle }));
}

function ReadSoundPreference(Session, Display) {
	RunPreferenceRequest((Callback) => g_Preferences.EnsureLoaded(g_AsyncOptions, Callback), (Failure) => {
		if (!IsCurrentPreferenceSession(Session)) {
			return;
		}

		if (Failure) {
			Reply(Session.Index, Phrase("PreferencesLoadFailed", "Could not load player preferences."));
			return;
		}

		Display(Session);
	});
}

function ShowPreferences(unClientIndex, vecArguments) {
	const strMode = vecArguments[0]?.toLowerCase();
	if ((vecArguments.length > 1) || ((strMode !== undefined) && (strMode !== "on") && (strMode !== "off"))) {
		throw CommandUsage("settings [on|off].");
	}

	const Session = BeginPreferenceSession(unClientIndex);
	if (strMode === undefined) {
		ReadSoundPreference(Session, ShowSoundMenu);
	} else {
		SetSoundPreference(Session, strMode === "on");
	}
}

function HandleCookies(unClientIndex, vecArguments) {
	const [strName, strValue] = vecArguments;
	if (strName === undefined) {
		return JoinPhrases([Phrase("Cookies", "Available cookies:"), Phrase("CookieAdminSounds", "AdminSounds - Enable or disable administrative sounds."), Phrase("CommandUsage", "Usage: {Syntax}", { Syntax: "sjs_cookies AdminSounds [on|off]." })], "\n");
	}

	if ((vecArguments.length === 1) && ["on", "off"].includes(strName.toLowerCase())) {
		return ShowPreferences(unClientIndex, vecArguments);
	}

	if (strName.toLowerCase() !== g_strSoundSetting.toLowerCase()) {
		throw CommandFailure("UnknownCookie", "Unknown cookie. Use sjs_cookies to list available cookies.");
	}

	if (strValue !== undefined) {
		return ShowPreferences(unClientIndex, vecArguments.slice(1));
	}

	const Session = BeginPreferenceSession(unClientIndex);
	ReadSoundPreference(Session, (Current) => Reply(Current.Index, `AdminSounds = ${AllowsAdminSounds(Current.PlayerID) ? "on" : "off"}.`));
}

function RegisterPreferenceCommands() {
	if (typeof CreateStorage === "function") {
		g_Preferences = CreateStorage("ServerAdministration");
		RunPreferenceRequest((Callback) => g_Preferences.EnsureLoaded(g_AsyncOptions, Callback), (Failure) => {
			if (Failure) {
				LogWarning("Could not preload server administration player preferences.");
			}
		});
	}

	DefineCommand("settings", null, "[on|off]", ShowPreferences, false, null, "Player preferences require an in-game player.");
	DefineCommand("cookies", null, "[name] [on|off]", HandleCookies);
}

function ClosePreferences() {
	ClosePreferenceSessions();

	if (!g_Preferences) {
		return;
	}

	// Native sessions belonging to an unloading plugin are released by the runtime.
	if (g_unPendingRequests === 0) {
		g_Preferences.Close({ Blocking: true }, (Failure) => {
			if (Failure) {
				LogWarning("Could not close the server administration settings session.");
			}
		});
	}

	g_Preferences = null;
}

module.exports = { AllowsAdminSounds, ForgetPreferenceSession, ClosePreferenceSessions, RegisterPreferenceCommands, ClosePreferences };
