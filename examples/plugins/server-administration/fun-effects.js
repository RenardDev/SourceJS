"use strict";

const { SOURCE_ENGINE_BRANCH } = require("core");
const { LogWarning } = require("core/logger");
const { CreateTemporaryEntity } = require("effects");
const { PrecacheModel } = require("engines/precache");
const { EmitAmbientSound, GetGameDirectory } = require("engines/server");
const { IsSoundPrecached, PrecacheSound } = require("engines/sound");
const { GetEntityDataMapPropertyVector } = require("entities/datamaps");
const { DoesFileExist, ReadTextFile } = require("filesystem");
const { LoadGameDataFile } = require("memory/manager");
const { SOURCE_DATA_ROOT } = require("paths");

const g_GrayRingColor = Object.freeze({ Red: 128, Green: 128, Blue: 128, Alpha: 255 });
const g_WhiteRingColor = Object.freeze({ Red: 255, Green: 255, Blue: 255, Alpha: 255 });
const g_OrangeRingColor = Object.freeze({ Red: 255, Green: 128, Blue: 0, Alpha: 255 });
const g_BlueRingColor = Object.freeze({ Red: 75, Green: 75, Blue: 255, Alpha: 255 });
const g_unRaidSirenSoundLevel = 140;
const g_unMaximumSlapSounds = 64;
const g_unRingHeightAboveOrigin = 10;
const g_setReportedEffects = new Set();
let g_Assets = null;

function TryFunEffect(strOperation, Execute) {
	let strReason = "engine rejected the request";

	try {
		if (Execute() !== false) {
			return;
		}
	} catch (Failure) {
		strReason = Failure?.message ?? "unknown failure";
	}

	if (!g_setReportedEffects.has(strOperation)) {
		g_setReportedEffects.add(strOperation);
		LogWarning(`Fun command effect unavailable: ${strOperation}. ${strReason}`);
	}
}

function ReadGameDataKeys(strFilePath, strGame) {
	const { Games } = LoadGameDataFile(strFilePath);
	const Defaults = Games["#default"];
	const vecDefaults = Array.isArray(Defaults) ? Defaults : [Defaults];
	const Keys = {};

	for (const Entry of vecDefaults) {
		const Supported = Entry?.["#supported"];
		const GamesSupported = Supported?.game;
		const vecSupportedGames = Array.isArray(GamesSupported) ? GamesSupported : [GamesSupported];

		if (!Supported || vecSupportedGames.includes(strGame)) {
			Object.assign(Keys, Entry?.Keys);
		}
	}

	Object.assign(Keys, Games[strGame]?.Keys);

	return Keys;
}

function ReadSDKToolsKeys(strGame) {
	const Keys = {};
	for (const strFilePath of ["sdktools.games/common.games.txt", `sdktools.games/engine.${SOURCE_ENGINE_BRANCH}.txt`, `sdktools.games/game.${strGame}.txt`]) {
		try {
			Object.assign(Keys, ReadGameDataKeys(strFilePath, strGame));
		} catch {
			// A game can supply its keys in one file and omit the others.
		}
	}

	return Keys;
}

function ReadSlapSounds(Keys) {
	const nCount = Number(Keys.SlapSoundCount);
	if (!Number.isInteger(nCount) || (nCount <= 0) || (nCount > g_unMaximumSlapSounds)) {
		return [];
	}

	const vecSamples = Array.from({ length: nCount }, (Value, unIndex) => Keys[`SlapSound${unIndex + 1}`]);

	return vecSamples.filter((strSample) => (typeof strSample === "string") && /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(wav|mp3)$/i.test(strSample) && DoesFileExist(`sound/${strSample}`));
}

function ReadColor(strColor, Fallback) {
	const unColorChannelCount = 4;
	const unMaximumChannelValue = 0xFF;

	const vecChannels = (typeof strColor === "string") ? strColor.split(",").map(Number) : [];
	if ((vecChannels.length !== unColorChannelCount) || vecChannels.some((unChannel) => !Number.isInteger(unChannel) || (unChannel < 0) || (unChannel > unMaximumChannelValue))) {
		return Fallback;
	}

	const [unRed, unGreen, unBlue, unAlpha] = vecChannels;

	return { Red: unRed, Green: unGreen, Blue: unBlue, Alpha: unAlpha };
}

function PrecacheFunModel(strModel) {
	if (!strModel) {
		return 0;
	}

	let nModelIndex = 0;
	TryFunEffect(strModel, () => {
		nModelIndex = PrecacheModel(`materials/${strModel}`, true);

		return nModelIndex > 0;
	});

	return nModelIndex;
}

function SelectAvailableAsset(strRoot, strPreferred, strFallback) {
	if (!strPreferred) {
		return undefined;
	}

	if (DoesFileExist(`${strRoot}/${strPreferred}`)) {
		return strPreferred;
	}

	if (strFallback && DoesFileExist(`${strRoot}/${strFallback}`)) {
		return strFallback;
	}

	TryFunEffect(strPreferred, () => false);

	return undefined;
}

function PrecacheFunSound(strSample) {
	if (strSample) {
		TryFunEffect(strSample, () => IsSoundPrecached(strSample) || PrecacheSound(strSample, true));
	}
}

// The first call reads GameData and precaches assets; later calls share the map's cache.
function GetFunCommandAssets() {
	if (g_Assets) {
		return g_Assets;
	}

	let Keys = {};
	const strGame = GetGameDirectory().split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase();
	TryFunEffect("funcommands.games.txt", () => {
		Keys = ReadGameDataKeys("funcommands.games.txt", strGame);
	});

	TryFunEffect("FunCommandAssets.json", () => {
		const strOverrides = ReadTextFile(`${SOURCE_DATA_ROOT}/effects/FunCommandAssets.json`);
		if (strOverrides !== null) {
			Object.assign(Keys, JSON.parse(strOverrides)[strGame]);
		}
	});

	g_Assets = {
		Beam: PrecacheFunModel(Keys.SpriteBeam),
		SecondaryBeam: PrecacheFunModel(Keys.SpriteBeam2),
		Halo: PrecacheFunModel(Keys.SpriteHalo),
		Glow: PrecacheFunModel(Keys.SpriteGlow),
		Explosion: PrecacheFunModel(SelectAvailableAsset("materials", Keys.SpriteExplosion, Keys.ExplosionFallback)),
		Blip: SelectAvailableAsset("sound", Keys.SoundBlip ?? "buttons/blip1.wav", "buttons/button14.wav"),
		Beep: Keys.SoundBeep,
		Final: Keys.SoundFinal,
		Boom: Keys.SoundBoom,
		Freeze: Keys.SoundFreeze,
		Slap: [],
		SlapFragField: null,
		OuterColor: ReadColor(Keys.ExternalBeaconColor, g_GrayRingColor),
		TeamColors: [g_WhiteRingColor, ...[1, 2, 3, 4].map((unTeam) => ReadColor(Keys[`Team${unTeam}BeaconColor`], g_WhiteRingColor))],
		UnknownColor: ReadColor(Keys.TeamUnknownBeaconColor, g_WhiteRingColor),
	};

	const SDKToolsKeys = ReadSDKToolsKeys(strGame);
	TryFunEffect("slap sounds", () => {
		g_Assets.Slap = ReadSlapSounds(SDKToolsKeys);
	});

	const strSlapFragField = SDKToolsKeys.m_iFrags;
	if ((typeof strSlapFragField === "string") && /^[a-z_][a-z0-9_]*$/i.test(strSlapFragField)) {
		g_Assets.SlapFragField = strSlapFragField;
	}

	for (const strSample of [g_Assets.Blip, g_Assets.Beep, g_Assets.Final, g_Assets.Boom, g_Assets.Freeze, ...g_Assets.Slap]) {
		PrecacheFunSound(strSample);
	}

	return g_Assets;
}

function ClearFunCommandAssets() {
	g_Assets = null;
	g_setReportedEffects.clear();
}

function ReadEyePosition(Player) {
	const Origin = Player.Origin;

	try {
		const ViewOffset = GetEntityDataMapPropertyVector(Player, "m_vecViewOffset");
		if (ViewOffset && Number.isFinite(ViewOffset.X) && Number.isFinite(ViewOffset.Y) && Number.isFinite(ViewOffset.Z)) {
			return { X: Origin.X + ViewOffset.X, Y: Origin.Y + ViewOffset.Y, Z: Origin.Z + ViewOffset.Z };
		}
	} catch {
		// Some engine branches do not expose this datamap field.
	}

	return Origin;
}

function EmitFunSound(Player, Position, strSample) {
	if (strSample) {
		TryFunEffect(strSample, () => {
			if (!IsSoundPrecached(strSample) && !PrecacheSound(strSample, true)) {
				return false;
			}

			return EmitAmbientSound(Player.Index, Position, strSample, 1, g_unRaidSirenSoundLevel, 0, 100);
		});
	}
}

function SendFunRings(Assets, Origin, flRadius, vecRecipients, OuterColor, InnerColor) {
	if ((vecRecipients.length === 0) || (Assets.Beam <= 0) || (Assets.Halo <= 0)) {
		return;
	}

	const Center = { X: Origin.X, Y: Origin.Y, Z: Origin.Z + g_unRingHeightAboveOrigin };
	const Ring = { Center, StartRadius: 10, EndRadius: flRadius, Model: Assets.Beam, Halo: Assets.Halo, StartFrame: 0, Speed: 10, FadeLength: 0, Flags: 0 };
	TryFunEffect("outer BeamRingPoint", () => CreateTemporaryEntity("BeamRingPoint", { ...Ring, FrameRate: 15, LifeTime: 0.5, StartWidth: 5, EndWidth: 5, Amplitude: 0, Color: OuterColor }, vecRecipients));
	TryFunEffect("inner BeamRingPoint", () => CreateTemporaryEntity("BeamRingPoint", { ...Ring, FrameRate: 10, LifeTime: 0.6, StartWidth: 10, EndWidth: 10, Amplitude: 0.5, Color: InnerColor }, vecRecipients));
}

function SendFireBombRings(Assets, Origin, EyePosition, flRadius, vecRecipients) {
	if ((Assets.Beam <= 0) || (Assets.Halo <= 0)) {
		return EyePosition;
	}

	// The stock blast is measured from the last ring when its sprites are available.
	const unFinalStartRadius = 20;
	const unRingHeightStep = 15;
	let Center = { X: Origin.X, Y: Origin.Y, Z: Origin.Z + g_unRingHeightAboveOrigin };
	for (const [unStartRadius, flLifeTime] of [[50, 0.5], [40, 0.6], [30, 0.7], [unFinalStartRadius, 0.8]]) {
		if (vecRecipients.length > 0) {
			const Ring = { Center, StartRadius: unStartRadius, EndRadius: flRadius, Model: Assets.Beam, Halo: Assets.Halo, FrameRate: 10, LifeTime: flLifeTime, StartWidth: 30, EndWidth: 30, Amplitude: 1.5, Speed: 5, Color: g_OrangeRingColor };
			TryFunEffect("firebomb BeamRingPoint", () => CreateTemporaryEntity("BeamRingPoint", Ring, vecRecipients));
		}

		if (unStartRadius > unFinalStartRadius) {
			Center = { ...Center, Z: Center.Z + unRingHeightStep };
		}
	}

	return Center;
}

function SendFreezeBombBeam(Assets, StartPoint, EndPoint, vecRecipients) {
	const nModel = (Assets.SecondaryBeam > 0) ? Assets.SecondaryBeam : Assets.Beam;
	if ((vecRecipients.length === 0) || (nModel <= 0) || (Assets.Halo <= 0)) {
		return;
	}

	const Beam = { StartPoint, EndPoint, Model: nModel, Halo: Assets.Halo, FrameRate: 1, LifeTime: 0.7, StartWidth: 20, EndWidth: 50, FadeLength: 1, Amplitude: 1.5, Speed: 10, Color: g_BlueRingColor };
	TryFunEffect("freezebomb BeamPoints", () => CreateTemporaryEntity("BeamPoints", Beam, vecRecipients));
}

function SendFreezeGlow(Assets, Origin, vecRecipients) {
	const nModel = (Assets.Glow > 0) ? Assets.Glow : Assets.Halo;
	if ((nModel <= 0) || (vecRecipients.length === 0)) {
		return;
	}

	const Glow = { Origin: { X: Origin.X, Y: Origin.Y, Z: Origin.Z + 10 }, Model: nModel, LifeTime: 0.95, Scale: 1.5, Brightness: 50 };
	TryFunEffect("freeze GlowSprite", () => CreateTemporaryEntity("GlowSprite", Glow, vecRecipients));
}

function SendFunExplosion(Assets, Origin, unRadius, vecRecipients, bSecondary = false, flScale = bSecondary ? 0.05 : 5) {
	if ((Assets.Explosion <= 0) || (vecRecipients.length === 0)) {
		return;
	}

	// The engine sends the explosion origin as three scalar properties.
	const Explosion = {
		"m_vecOrigin[0]": Origin.X,
		"m_vecOrigin[1]": Origin.Y,
		"m_vecOrigin[2]": Origin.Z,
		Model: Assets.Explosion,
		Scale: flScale,
		FrameRate: 1,
		Flags: 0,
		Radius: unRadius,
		Magnitude: bSecondary ? 1 : 5000,
	};

	TryFunEffect("Explosion", () => CreateTemporaryEntity("Explosion", Explosion, vecRecipients));
}

module.exports = {
	GrayRingColor: g_GrayRingColor,
	WhiteRingColor: g_WhiteRingColor,
	TryFunEffect,
	GetFunCommandAssets,
	ClearFunCommandAssets,
	ReadEyePosition,
	EmitFunSound,
	SendFunRings,
	SendFireBombRings,
	SendFreezeBombBeam,
	SendFreezeGlow,
	SendFunExplosion,
};
