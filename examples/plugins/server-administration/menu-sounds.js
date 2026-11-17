"use strict";

const { CreateConVar } = require("cvars");
const { GetGameDirectory } = require("engines/server");
const { EmitSound, IsSoundPrecached, PrecacheSound, SOUND_FROM_LOCAL_PLAYER } = require("engines/sound");
const { DoesFileExist } = require("filesystem");
const { GetModule } = require("internal/runtime");
const { LoadGameDataFile } = require("memory/manager");
const { DOWNLOADABLES } = require("stringtables");
const { TryFunEffect } = require("./fun-effects");

const { GetPlayer } = GetModule("players");

const g_MenuSoundSamplePattern = /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(wav|mp3)$/i;
const g_strDefaultSelectionSound = "buttons/button14.wav";
const g_strDefaultExitSound = "buttons/combine_button7.wav";
const g_strFallbackSelectionSound = "buttons/blip1.wav";
const g_strBundledSelectionSound = "sourcejs/menu-select.wav";
const g_setClientMenuSounds = new Set();
let g_MenuSounds = null;
let g_MenuSamples = null;
let g_bBundledSoundPrepared = false;

function EnsureMenuSound(strSample) {
	if (g_setClientMenuSounds.has(strSample)) {
		// Dedicated servers may not ship the game's own client UI audio.
		return IsSoundPrecached(strSample) || PrecacheSound(strSample, false, true);
	}

	// The engine can cache a sample name even when the audio file is missing.
	return DoesFileExist(`sound/${strSample}`) && (IsSoundPrecached(strSample) || PrecacheSound(strSample, true));
}

function PrepareMenuSound(strSample) {
	if (!EnsureMenuSound(strSample)) {
		return false;
	}

	if (strSample === g_strBundledSelectionSound) {
		DOWNLOADABLES.Add(`sound/${strSample}`);
		g_bBundledSoundPrepared = true;
	}

	return true;
}

function ReadClientMenuSamples(strGame) {
	const Samples = {};

	try {
		const Profile = LoadGameDataFile("MenuSounds.json")?.[strGame];
		for (const strKey of ["MenuItemSound", "MenuPageSound", "MenuExitSound", "MenuExitBackSound"]) {
			const strSample = Profile?.[strKey];
			if ((typeof strSample === "string") && g_MenuSoundSamplePattern.test(strSample)) {
				Samples[strKey] = strSample;
			}
		}
	} catch {
		// A game without a local profile still uses the standard sample fallbacks.
	}

	return Samples;
}

function ReadMenuSamples() {
	const Samples = { MenuItemSound: g_strDefaultSelectionSound, MenuExitSound: g_strDefaultExitSound, MenuExitBackSound: g_strDefaultExitSound };
	let strGame = "";

	try {
		strGame = GetGameDirectory().split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? "";
		const { Games } = LoadGameDataFile("core.games/common.games.txt");
		const vecDefaults = [].concat(Games["#default"]);
		const vecGameEntries = [].concat(Games[strGame]);
		const vecMatchingDefaults = vecDefaults.filter((Entry) => {
			const Supported = Entry?.["#supported"];

			return !Supported || [].concat(Supported.game).includes(strGame);
		});

		for (const Entry of [...vecMatchingDefaults, ...vecGameEntries]) {
			for (const strKey of Object.keys(Samples)) {
				const strSample = Entry?.Keys?.[strKey];
				if ((typeof strSample === "string") && ((strSample === "") || g_MenuSoundSamplePattern.test(strSample))) {
					Samples[strKey] = strSample;
				}
			}
		}
	} catch {
		// Keep the stock samples if the optional GameData snapshot cannot be read.
	}

	return { Configured: Samples, Client: ReadClientMenuSamples(strGame) };
}

function ResolveMenuSample(strSample, ...vecFallbacks) {
	if (!strSample) {
		return "";
	}

	for (const strCandidate of new Set([strSample, ...vecFallbacks])) {
		if (strCandidate) {
			let bPrepared = false;
			TryFunEffect(`menu sound ${strCandidate}`, () => {
				bPrepared = PrepareMenuSound(strCandidate);

				return bPrepared;
			});

			if (bPrepared) {
				return strCandidate;
			}
		}
	}

	return "";
}

function PrepareMenuSounds() {
	// Prepare downloads before players connect, even if playback starts disabled.
	const { Configured: Samples, Client: ClientSamples } = ReadMenuSamples();
	g_setClientMenuSounds.clear();
	for (const strSample of Object.values(ClientSamples)) {
		g_setClientMenuSounds.add(strSample);
	}

	Samples.MenuItemSound = ResolveMenuSample(Samples.MenuItemSound, ClientSamples.MenuItemSound, g_strDefaultSelectionSound, g_strFallbackSelectionSound, g_strBundledSelectionSound);
	Samples.MenuPageSound = (Samples.MenuItemSound === ClientSamples.MenuItemSound) ? ResolveMenuSample(ClientSamples.MenuPageSound ?? Samples.MenuItemSound, Samples.MenuItemSound) : Samples.MenuItemSound;
	Samples.MenuExitSound = ResolveMenuSample(Samples.MenuExitSound, ClientSamples.MenuExitSound, Samples.MenuItemSound);
	Samples.MenuExitBackSound = ResolveMenuSample(Samples.MenuExitBackSound, ClientSamples.MenuExitBackSound, Samples.MenuItemSound);

	g_MenuSamples = Samples;
}

function ResetMenuSounds() {
	g_MenuSamples = null;
	g_setClientMenuSounds.clear();
	g_bBundledSoundPrepared = false;
}

function RegisterMenuSounds() {
	g_MenuSounds = CreateConVar("sjs_menu_sounds", "1", "Play feedback sounds in bundled administration menus.", 0, 0, 1);
}

function TryPlayMenuSound(unClientIndex, strInteraction) {
	if (Number(g_MenuSounds.Value) === 0) {
		return true;
	}

	if (g_MenuSamples === null) {
		PrepareMenuSounds();
	}

	let strSample = g_MenuSamples.MenuItemSound;

	if (strInteraction === "Exit") {
		strSample = g_MenuSamples.MenuExitSound;
	} else if (strInteraction === "ExitBack") {
		strSample = g_MenuSamples.MenuExitBackSound;
	} else if ((strInteraction === "Back") || (strInteraction === "Next")) {
		strSample = g_MenuSamples.MenuPageSound;
	}

	if (!strSample) {
		return true;
	}

	const Player = GetPlayer(unClientIndex);
	if (!Player?.Connected || Player.FakeClient) {
		return true;
	}

	for (const strCandidate of new Set([strSample, g_MenuSamples.MenuItemSound, g_strFallbackSelectionSound])) {
		if (!strCandidate || ((strCandidate === g_strBundledSelectionSound) && !g_bBundledSoundPrepared)) {
			continue;
		}

		if (EnsureMenuSound(strCandidate) && EmitSound({
			Sample: strCandidate,
			Entity: SOUND_FROM_LOCAL_PLAYER,
			Recipients: [unClientIndex],
			Reliable: true,
		})) {
			return true;
		}
	}

	return false;
}

function PlayMenuSound(unClientIndex, strInteraction) {
	TryFunEffect(`menu ${strInteraction} sound`, () => TryPlayMenuSound(unClientIndex, strInteraction));
}

module.exports = { PrepareMenuSounds, ResetMenuSounds, RegisterMenuSounds, PlayMenuSound };
