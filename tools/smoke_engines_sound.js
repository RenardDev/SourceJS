#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_nInt32Minimum = -2_147_483_648;
const g_nInt32Maximum = 2_147_483_647;

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strProjectRoot, "packages", "sourcejs");
const g_strSoundPath = g_Path.join(g_strPackageRoot, "engines", "sound.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strStringTablesPath = g_Path.join(g_strPackageRoot, "stringtables.js");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "engines-sound.md");

const g_Attenuation = {
	GUNFIRE: 0.27,
	IDLE: 2,
	MAXIMUM: 3.98,
	NONE: 0,
	NORMAL: 0.8,
	RICOCHET: 1.5,
	STATIC: 1.25,
};

const g_Channel = {
	AUTO: 0,
	BODY: 4,
	ITEM: 3,
	REPLACE: -1,
	STATIC: 6,
	STREAM: 5,
	USER_BASE: 135,
	VOICE: 2,
	VOICE_BASE: 7,
	WEAPON: 1,
};

const g_Pitch = {
	HIGH: 120,
	LOW: 95,
	NORMAL: 100,
};

const g_SoundFlags = {
	CHANGE_PITCH: 0x02,
	CHANGE_VOLUME: 0x01,
	DELAY: 0x10,
	IGNORE_NAME: 0x0200,
	IGNORE_PHONEMES: 0x0100,
	NO_FLAGS: 0x00,
	SHOULD_PAUSE: 0x80,
	SPAWNING: 0x08,
	SPEAKER: 0x40,
	STOP: 0x04,
	STOP_LOOPING: 0x20,
};

const g_vecExpectedExports = [
	"Attenuation",
	"Channel",
	"MAX_ATTENUATION",
	"Pitch",
	"SOUND_FROM_LOCAL_PLAYER",
	"SOUND_FROM_WORLD",
	"Sound",
	"SoundFlags",
	"StreamSound",
	"VOL_NORM",
	"EmitSound",
	"GetDistanceGainFromSoundLevel",
	"GetSoundDuration",
	"IsLoopingSound",
	"IsSoundPrecached",
	"PrecacheSound",
	"PrecacheSoundSentenceGroup",
	"PrefetchSound",
	"SetPlayerDSP",
	"SetSoundRoomType",
	"StopSound",
].sort();
const g_setCapabilityExports = new Set(["IsLoopingSound", "PrecacheSoundSentenceGroup"]);
const g_vecExpectedLimitedExports = g_vecExpectedExports.filter((strName) => !g_setCapabilityExports.has(strName));

const g_vecNativeCalls = [];
const g_setPrecachedSamples = new Set();
const g_vecDownloadablePaths = [];
const g_vecStringTableEntries = [];

function RequireNonEmptyString(strValue, strValueName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strValueName} must be a non-empty string.`);
	}

	return strValue;
}

function RequireInt32(nValue, strValueName) {
	if (!Number.isInteger(nValue) || (nValue < g_nInt32Minimum) || (nValue > g_nInt32Maximum)) {
		throw new TypeError(`${strValueName} must be a signed 32-bit integer.`);
	}

	return nValue;
}

function RequireFiniteNumber(dblValue, strValueName) {
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue)) {
		throw new TypeError(`${strValueName} must be a finite number.`);
	}

	return dblValue;
}

function RequireOptionalBoolean(bValue, bDefaultValue, strValueName) {
	if (bValue === undefined) {
		return bDefaultValue;
	}

	if (typeof bValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bValue;
}

function RequirePlayerIndex(Value, strValueName) {
	const nIndex = (typeof Value === "number") ? Value : Value?.Index;
	RequireInt32(nIndex, strValueName);

	if (nIndex <= 0) {
		throw new RangeError(`${strValueName} must be positive.`);
	}

	return nIndex;
}

function RequireRecipients(Value, strValueName) {
	if ((Value === undefined) || (Value === null)) {
		return null;
	}

	let Recipients = Value;
	if (!Array.isArray(Value) && ((typeof Value === "object") || (typeof Value === "function"))) {
		const RecipientIndexes = Value.RecipientIndexes;
		if ((RecipientIndexes !== undefined) && (RecipientIndexes !== null)) {
			if (!Array.isArray(RecipientIndexes)) {
				throw new TypeError(strValueName + ".RecipientIndexes must be an array.");
			}

			Recipients = RecipientIndexes;
		}
	}

	if (!Array.isArray(Recipients)) {
		return [RequirePlayerIndex(Recipients, strValueName)];
	}

	const vecRecipientIndices = [];
	const unRecipientCount = Recipients.length;
	for (let unRecipientIndex = 0; unRecipientIndex < unRecipientCount; ++unRecipientIndex) {
		const nRecipientIndex = RequirePlayerIndex(Recipients[unRecipientIndex], strValueName);
		if (!vecRecipientIndices.includes(nRecipientIndex)) {
			vecRecipientIndices.push(nRecipientIndex);
		}
	}

	return vecRecipientIndices;
}

function RequireVector(VectorValue, strValueName, bOptional = true) {
	if (bOptional && ((VectorValue === undefined) || (VectorValue === null))) {
		return null;
	}

	if (!VectorValue || (typeof VectorValue !== "object")) {
		throw new TypeError(`${strValueName} must be a vector object.`);
	}

	const Components = Array.isArray(VectorValue) ? { X: VectorValue[0], Y: VectorValue[1], Z: VectorValue[2] } : VectorValue;
	const flX = Components.X ?? Components.Pitch;
	const flY = Components.Y ?? Components.Yaw;
	const flZ = Components.Z ?? Components.Roll;
	if ((flX === undefined) && (flY === undefined) && (flZ === undefined)) {
		throw new TypeError(`${strValueName} must provide at least one component.`);
	}

	return {
		X: RequireFiniteNumber(flX ?? 0, `${strValueName}.X`),
		Y: RequireFiniteNumber(flY ?? 0, `${strValueName}.Y`),
		Z: RequireFiniteNumber(flZ ?? 0, `${strValueName}.Z`),
	};
}

function ValidateEmitOptions(Options) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("emit options must be an object.");
	}

	const Entity = Options.Entity;
	const nEntityIndex = (Entity && (typeof Entity === "object")) ? Entity.Index : (Entity ?? 0);
	const vecOrigins = Options.Origins ?? [];
	if (!Array.isArray(vecOrigins)) {
		throw new TypeError("emit origins must be an array.");
	}

	const NormalizedOptions = {
		Attenuation: RequireFiniteNumber(Options.Attenuation ?? 0, "EmitSound.Attenuation"),
		Channel: RequireInt32(Options.Channel ?? 0, "EmitSound.Channel"),
		Direction: RequireVector(Options.Direction, "EmitSound.Direction"),
		Entity: RequireInt32(nEntityIndex, "EmitSound.Entity"),
		Flags: RequireInt32(Options.Flags ?? 0, "EmitSound.Flags"),
		Origin: RequireVector(Options.Origin, "EmitSound.Origin"),
		Origins: vecOrigins.map((Origin) => RequireVector(Origin, "EmitSound.Origins entry", false)),
		Pitch: RequireInt32(Options.Pitch ?? 100, "EmitSound.Pitch"),
		Recipients: RequireRecipients(Options.Recipients, "EmitSound.Recipients"),
		Reliable: RequireOptionalBoolean(Options.Reliable, false, "EmitSound.Reliable"),
		Sample: RequireNonEmptyString(Options.Sample, "EmitSound.Sample"),
		SoundTime: RequireFiniteNumber(Options.SoundTime ?? 0, "EmitSound.SoundTime"),
		SpeakerEntity: RequireInt32(Options.SpeakerEntity ?? -1, "EmitSound.SpeakerEntity"),
		UpdatePositions: RequireOptionalBoolean(Options.UpdatePositions, true, "EmitSound.UpdatePositions"),
		Volume: RequireFiniteNumber(Options.Volume ?? 1, "EmitSound.Volume"),
	};

	return NormalizedOptions;
}

function ValidateStop(Options) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("stop options must be one object.");
	}

	const Entity = Options.Entity;
	const nEntityIndex = (Entity && (typeof Entity === "object")) ? Entity.Index : (Entity ?? 0);

	return {
		Channel: RequireInt32(Options.Channel ?? 0, "StopSound.Channel"),
		Entity: RequireInt32(nEntityIndex, "StopSound.Entity"),
		Sample: RequireNonEmptyString(Options.Sample, "StopSound.Sample"),
	};
}

const g_NativeSound = {
	Attenuation: g_Attenuation,
	Channel: g_Channel,
	MAX_ATTENUATION: 3.98,
	Pitch: g_Pitch,
	SOUND_FROM_LOCAL_PLAYER: -1,
	SOUND_FROM_WORLD: 0,
	SoundFlags: g_SoundFlags,
	VOL_NORM: 1,
	GetDistanceGainFromSoundLevel(nSoundLevel, flDistance) {
		const unMinimumSoundLevel = 0;
		const unMaximumSoundLevel = 255;

		const nNormalizedSoundLevel = RequireInt32(nSoundLevel, "GetDistanceGainFromSoundLevel.nSoundLevel");
		const flNormalizedDistance = RequireFiniteNumber(flDistance, "GetDistanceGainFromSoundLevel.flDistance");
		if ((nNormalizedSoundLevel < unMinimumSoundLevel) || (nNormalizedSoundLevel > unMaximumSoundLevel)) {
			throw new RangeError("GetDistanceGainFromSoundLevel.nSoundLevel expects an integer from 0 through 255.");
		}

		const flGain = nNormalizedSoundLevel / (Math.max(0, flNormalizedDistance) + nNormalizedSoundLevel);

		g_vecNativeCalls.push(["GetDistanceGainFromSoundLevel", nNormalizedSoundLevel, flNormalizedDistance]);

		return flGain;
	},
	GetSoundDuration(strSample) {
		const strNormalizedSample = RequireNonEmptyString(strSample, "GetSoundDuration.strSample");
		g_vecNativeCalls.push(["GetSoundDuration", strNormalizedSample]);

		return 2.5;
	},
	EmitSound(Options) {
		if ((arguments.length !== 1) || (Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("emit options must be one object.");
		}

		const NormalizedOptions = ValidateEmitOptions(Options);
		g_vecNativeCalls.push(["EmitSound", NormalizedOptions]);

		return true;
	},
	IsLoopingSound(strSample) {
		const strNormalizedSample = RequireNonEmptyString(strSample, "IsLoopingSound.strSample");
		g_vecNativeCalls.push(["IsLoopingSound", strNormalizedSample]);

		return strNormalizedSample.includes("klaxon");
	},
	IsSoundPrecached(strSample) {
		const strNormalizedSample = RequireNonEmptyString(strSample, "IsSoundPrecached.strSample");
		g_vecNativeCalls.push(["IsSoundPrecached", strNormalizedSample]);

		return g_setPrecachedSamples.has(strNormalizedSample);
	},
	PrecacheSound(strSample, bPreload = false, bUISound = false) {
		const strNormalizedSample = RequireNonEmptyString(strSample, "PrecacheSound.strSample");
		const bNormalizedPreload = RequireOptionalBoolean(bPreload, false, "PrecacheSound.bPreload");
		const bNormalizedUISound = RequireOptionalBoolean(bUISound, false, "PrecacheSound.bUISound");
		g_vecNativeCalls.push(["PrecacheSound", strNormalizedSample, bNormalizedPreload, bNormalizedUISound]);
		g_setPrecachedSamples.add(strNormalizedSample);

		return true;
	},
	PrecacheSoundSentenceGroup(strGroupName) {
		const strNormalizedGroupName = RequireNonEmptyString(strGroupName, "PrecacheSoundSentenceGroup.strGroupName");
		g_vecNativeCalls.push(["PrecacheSoundSentenceGroup", strNormalizedGroupName]);

		return true;
	},
	PrefetchSound(strSample) {
		const strNormalizedSample = RequireNonEmptyString(strSample, "PrefetchSound.strSample");
		g_vecNativeCalls.push(["PrefetchSound", strNormalizedSample]);

		return true;
	},
	SetPlayerDSP(Recipients, nDSPType, bFastReset = false) {
		const vecNormalizedRecipients = RequireRecipients(Recipients, "SetPlayerDSP.Recipients");
		const nNormalizedDSPType = RequireInt32(nDSPType, "SetPlayerDSP.nDSPType");
		const bNormalizedFastReset = RequireOptionalBoolean(bFastReset, false, "SetPlayerDSP.bFastReset");
		g_vecNativeCalls.push(["SetPlayerDSP", vecNormalizedRecipients, nNormalizedDSPType, bNormalizedFastReset]);

		return true;
	},
	SetSoundRoomType(Recipients, nRoomType, bReliable = false) {
		const vecNormalizedRecipients = RequireRecipients(Recipients, "SetSoundRoomType.Recipients");
		const nNormalizedRoomType = RequireInt32(nRoomType, "SetSoundRoomType.nRoomType");
		const bNormalizedReliable = RequireOptionalBoolean(bReliable, false, "SetSoundRoomType.bReliable");
		g_vecNativeCalls.push(["SetSoundRoomType", vecNormalizedRecipients, nNormalizedRoomType, bNormalizedReliable]);

		return true;
	},
	StopSound(Options) {
		if (arguments.length !== 1) {
			throw new TypeError("stop options must be one object.");
		}

		const NormalizedOptions = ValidateStop(Options);
		g_vecNativeCalls.push(["StopSound", NormalizedOptions]);

		return true;
	},
};

function VerifyRecipientSnapshot() {
	const unOriginalCallCount = g_vecNativeCalls.length;
	for (const Operation of [
		{ Name: "DSP", Call: (Value) => g_NativeSound.SetPlayerDSP(Value, 1) },
		{ Name: "Room", Call: (Value) => g_NativeSound.SetSoundRoomType(Value, 1) },
		{ Name: "Emit", Call: (Value) => g_NativeSound.EmitSound({ Sample: "snapshot.wav", Recipients: Value }) },
	]) {
		const ReadResult = () => (Operation.Name === "Emit") ? g_vecNativeCalls.at(-1)[1].Recipients : g_vecNativeCalls.at(-1)[1];
		for (const strLocation of ["Filter", "Entry", "Index", "Fallback"]) {
			let unReads = 0;
			let unIndexReads = 0;
			const Value = (strLocation === "Entry") ? [] : {};
			const strProperty = (strLocation === "Entry") ? "0" : ((strLocation === "Index") ? "Index" : "RecipientIndexes");
			Object.defineProperty(Value, strProperty, {
				get() {
					if (++unReads > 1) {
						throw new Error("Repeated sound recipient getter.");
					}

					return (strLocation === "Filter") ? [1] : ((strLocation === "Fallback") ? undefined : 1);
				},
			});

			if (strLocation === "Fallback") {
				Object.defineProperty(Value, "Index", {
					get() {
						++unIndexReads;

						return 1;
					},
				});
			}

			g_Assert.equal(Operation.Call(Value), true);
			g_Assert.deepEqual(ReadResult(), [1]);
			g_Assert.equal(unReads, 1);
			g_Assert.equal(unIndexReads, (strLocation === "Fallback") ? 1 : 0);
		}

		for (const strLocation of ["Filter", "Entry", "Index"]) {
			for (const Original of [undefined, null, Symbol("sound getter"), new Error("Original sound getter")]) {
				const Value = (strLocation === "Entry") ? [] : {};
				const strProperty = (strLocation === "Entry") ? "0" : ((strLocation === "Index") ? "Index" : "RecipientIndexes");
				Object.defineProperty(Value, strProperty, {
					get() {
						throw Original;
					},
				});
				const unCallCount = g_vecNativeCalls.length;
				let bCaught = false;
				try {
					Operation.Call(Value);
				} catch (Failure) {
					bCaught = true;
					g_Assert.strictEqual(Failure, Original);
				}

				g_Assert.equal(bCaught, true);
				g_Assert.equal(g_vecNativeCalls.length, unCallCount);
			}
		}

		const vecSparse = new Array(2);
		vecSparse[0] = 1;
		for (const Value of [vecSparse, { RecipientIndexes: true, Index: 1 }]) {
			const unCallCount = g_vecNativeCalls.length;
			g_Assert.throws(() => Operation.Call(Value));
			g_Assert.equal(g_vecNativeCalls.length, unCallCount);
		}

		g_Assert.equal(Operation.Call([1, { Index: 1 }]), true);
		g_Assert.deepEqual(ReadResult(), [1]);
		g_Assert.equal(Operation.Call([]), true);
		g_Assert.deepEqual(ReadResult(), []);
	}

	g_vecNativeCalls.length = unOriginalCallCount;
}

const g_NativeStringTables = {
	DOWNLOADABLES: {
		Add(strFilePath) {
			g_vecDownloadablePaths.push(RequireNonEmptyString(strFilePath, "DOWNLOADABLES.Add.strFilePath"));

			return true;
		},
	},
	AddString(strTableName, strValue) {
		const strNormalizedTableName = RequireNonEmptyString(strTableName, "AddString.strTableName");
		const strNormalizedValue = RequireNonEmptyString(strValue, "AddString.strValue");
		g_vecStringTableEntries.push([strNormalizedTableName, strNormalizedValue]);

		return g_vecStringTableEntries.length - 1;
	},
};

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

function LoadSound(NativeModule) {
	delete require.cache[g_strSoundPath];
	InstallDependency(g_strRuntimePath, {
		GetModule(strModuleName) {
			if (strModuleName !== "engines/sound") {
				throw new Error(`native module is unavailable: ${strModuleName}`);
			}

			return NativeModule;
		},
	});
	InstallDependency(g_strStringTablesPath, g_NativeStringTables);

	return require(g_strSoundPath);
}

const g_SoundModule = LoadSound(g_NativeSound);
g_Assert.notStrictEqual(g_SoundModule, g_NativeSound);
g_Assert.deepEqual(Object.keys(g_SoundModule).sort(), g_vecExpectedExports);
g_Assert.deepEqual(g_SoundModule.Attenuation, g_Attenuation);
g_Assert.deepEqual(g_SoundModule.Channel, g_Channel);
g_Assert.deepEqual(g_SoundModule.Pitch, g_Pitch);
g_Assert.deepEqual(g_SoundModule.SoundFlags, g_SoundFlags);
g_Assert.equal(g_SoundModule.MAX_ATTENUATION, 3.98);
g_Assert.equal(g_SoundModule.SOUND_FROM_LOCAL_PLAYER, -1);
g_Assert.equal(g_SoundModule.SOUND_FROM_WORLD, 0);
g_Assert.equal(g_SoundModule.VOL_NORM, 1);
g_Assert.equal(g_SoundModule.Channel.USER_BASE, 135);
g_Assert.equal(g_SoundModule.Attenuation.MAXIMUM, 3.98);
g_Assert.equal(g_SoundModule.Pitch.NORMAL, 100);
g_Assert.equal(g_SoundModule.SoundFlags.IGNORE_NAME, 0x0200);

g_Assert.equal(g_SoundModule.PrecacheSound("ui/buttonclick.wav", true, true), true);
g_Assert.equal(g_SoundModule.IsSoundPrecached("ui/buttonclick.wav"), true);
g_Assert.equal(g_SoundModule.PrefetchSound("ui/buttonclick.wav"), true);
g_Assert.equal(g_SoundModule.IsLoopingSound("ambient/alarms/klaxon1.wav"), true);
g_Assert.equal(g_SoundModule.GetSoundDuration("ui/buttonclick.wav"), 2.5);
g_Assert.equal(g_SoundModule.GetDistanceGainFromSoundLevel(75, 512) > 0, true);
g_Assert.equal(g_SoundModule.PrecacheSoundSentenceGroup("NPC_Citizen.Follow"), true);
g_Assert.equal(g_SoundModule.SetSoundRoomType([1], 0, true), true);
g_Assert.equal(g_SoundModule.SetPlayerDSP([1], 0, true), true);

const g_OriginalDuration = g_SoundModule.GetSoundDuration;

g_SoundModule.GetSoundDuration = () => 7.5;
g_Assert.equal(g_SoundModule.GetSoundDuration("ui/buttonclick.wav"), 7.5);
g_Assert.equal(new g_SoundModule.Sound("ui/buttonclick.wav").Duration, 2.5);
g_SoundModule.GetSoundDuration = g_OriginalDuration;

g_Assert.equal(g_SoundModule.EmitSound({
	Attenuation: g_SoundModule.Attenuation.STATIC,
	Channel: g_SoundModule.Channel.STATIC,
	Direction: null,
	Entity: g_SoundModule.SOUND_FROM_WORLD,
	Flags: g_SoundModule.SoundFlags.NO_FLAGS,
	Origin: { X: 1, Y: 2, Z: 3 },
	Origins: [{ X: 4, Y: 5, Z: 6 }],
	Pitch: g_SoundModule.Pitch.NORMAL,
	Recipients: [1],
	Reliable: true,
	Sample: "ambient/alarms/klaxon1.wav",
	SoundTime: 0,
	SpeakerEntity: -1,
	UpdatePositions: true,
	Volume: g_SoundModule.VOL_NORM,
}), true);
g_Assert.equal(g_SoundModule.StopSound({
	Channel: g_SoundModule.Channel.STATIC,
	Entity: g_SoundModule.SOUND_FROM_WORLD,
	Sample: "ambient/alarms/klaxon1.wav",
}), true);
g_Assert.throws(() => g_SoundModule.EmitSound([1], g_SoundModule.SOUND_FROM_LOCAL_PLAYER, g_SoundModule.Channel.ITEM, "ui/buttonclick.wav"), /Options/);
g_Assert.throws(() => g_SoundModule.StopSound(g_SoundModule.SOUND_FROM_WORLD, g_SoundModule.Channel.STATIC, "ambient/alarms/klaxon1.wav"), /Options/);

for (const Operation of [
	() => g_SoundModule.PrecacheSound("sample.wav", "yes", false),
	() => g_SoundModule.IsSoundPrecached(7),
	() => g_SoundModule.PrefetchSound(""),
	() => g_SoundModule.IsLoopingSound(null),
	() => g_SoundModule.GetSoundDuration(undefined),
	() => g_SoundModule.EmitSound({ Sample: "sample.wav", Reliable: 1 }),
	() => g_SoundModule.EmitSound({ Sample: "sample.wav", Origins: {} }),
	() => g_SoundModule.EmitSound({ Sample: "sample.wav", Recipients: [0] }),
	() => g_SoundModule.StopSound({ Sample: "sample.wav", Channel: "voice" }),
	() => g_SoundModule.SetSoundRoomType([1], 0, 1),
	() => g_SoundModule.SetPlayerDSP([1], 0, 1),
	() => g_SoundModule.GetDistanceGainFromSoundLevel(75.5, 512),
	() => g_SoundModule.GetDistanceGainFromSoundLevel(-1, 512),
	() => g_SoundModule.GetDistanceGainFromSoundLevel(256, 512),
	() => g_SoundModule.GetDistanceGainFromSoundLevel(511, 512),
	() => g_SoundModule.GetDistanceGainFromSoundLevel(-2_147_483_648, 512),
	() => g_SoundModule.GetDistanceGainFromSoundLevel(2_147_483_647, 512),
	() => g_SoundModule.PrecacheSoundSentenceGroup(""),
]) {
	g_Assert.throws(Operation);
}

VerifyRecipientSnapshot();

const g_AlarmSound = new g_SoundModule.Sound("ambient\\alarms\\klaxon1.wav", {
	Attenuation: g_SoundModule.Attenuation.STATIC,
	Channel: g_SoundModule.Channel.STATIC,
	Direction: null,
	Download: true,
	Entity: g_SoundModule.SOUND_FROM_WORLD,
	Flags: g_SoundModule.SoundFlags.NO_FLAGS,
	Origin: { X: 256, Y: 128, Z: 72 },
	Origins: [],
	Pitch: g_SoundModule.Pitch.NORMAL,
	Preload: true,
	Recipients: [1],
	Reliable: true,
	SoundTime: 0,
	SpeakerEntity: -1,
	UISound: false,
	UpdatePositions: true,
	Volume: 0.65,
});
g_Assert.equal(g_AlarmSound.Sample, "ambient/alarms/klaxon1.wav");
g_Assert.equal(g_AlarmSound.EngineSample, "ambient/alarms/klaxon1.wav");
g_Assert.equal(g_AlarmSound.RelativePath, "sound/ambient/alarms/klaxon1.wav");
g_Assert.equal(g_AlarmSound.Duration, 2.5);
g_Assert.equal(g_AlarmSound.Precached, false);
g_Assert.equal(g_vecDownloadablePaths.at(-1), "sound/ambient/alarms/klaxon1.wav");
g_Assert.equal(g_AlarmSound.PlaySound(), true);
g_Assert.equal(g_AlarmSound.Precached, true);
g_Assert.equal(g_AlarmSound.StopSound(), true);

g_AlarmSound.Volume = 0.35;
g_AlarmSound.Flags = g_SoundModule.SoundFlags.CHANGE_VOLUME;
g_Assert.equal(g_AlarmSound.PlaySound([]), true);
g_Assert.deepEqual(g_vecNativeCalls.at(-1)[1].Recipients, []);

g_Assert.equal(g_AlarmSound.PlaySound(1), true);
g_Assert.deepEqual(g_vecNativeCalls.at(-1)[1].Recipients, [1]);
g_Assert.equal(g_AlarmSound.PlaySound({ RecipientIndexes: [1] }), true);
g_Assert.deepEqual(g_vecNativeCalls.at(-1)[1].Recipients, [1]);

for (const nEntityIndex of [-2_147_483_648, 2_147_483_647]) {
	const BoundarySound = new g_SoundModule.Sound("sample.wav", { Entity: nEntityIndex });
	g_Assert.equal(BoundarySound.Entity, nEntityIndex);
}

for (const Operation of [
	() => new g_SoundModule.Sound(""),
	() => new g_SoundModule.Sound("sample.wav", null),
	() => new g_SoundModule.Sound("sample.wav", { Entity: 1.5 }),
	() => new g_SoundModule.Sound("sample.wav", { Entity: -2_147_483_649 }),
	() => new g_SoundModule.Sound("sample.wav", { Entity: 2_147_483_648 }),
	() => new g_SoundModule.Sound("sample.wav", { Origins: {} }),
	() => new g_SoundModule.Sound("sample.wav", { Origins: null }),
	() => new g_SoundModule.Sound("sample.wav", { Reliable: 1 }),
]) {
	g_Assert.throws(Operation);
}

const g_MusicSound = new g_SoundModule.StreamSound("music/flu/jukebox/all_i_want_for_xmas.wav", {
	Channel: g_SoundModule.Channel.STREAM,
	Download: true,
	Recipients: [1],
	Volume: 0.5,
});
g_Assert.ok(g_MusicSound instanceof g_SoundModule.Sound);
g_Assert.equal(g_MusicSound.Pitch, g_SoundModule.Pitch.NORMAL);
g_Assert.equal(g_MusicSound.SpeakerEntity, -1);
g_Assert.equal(g_MusicSound.EngineSample, "*/music/flu/jukebox/all_i_want_for_xmas.wav");
g_Assert.equal(g_MusicSound.RelativePath, "sound/music/flu/jukebox/all_i_want_for_xmas.wav");
g_Assert.equal(g_MusicSound.PrecacheSound(), true);
g_Assert.deepEqual(g_vecStringTableEntries.at(-1), ["soundprecache", "*/music/flu/jukebox/all_i_want_for_xmas.wav"]);
g_Assert.equal(g_MusicSound.PlaySound(), true);
g_Assert.equal(g_MusicSound.StopSound(), true);

for (const strAlias of ["default", "engineSound", "moduleName", "precacheSound"]) {
	g_Assert.equal(Object.hasOwn(g_SoundModule, strAlias), false);
}

const g_LimitedNativeSound = { ...g_NativeSound };
delete g_LimitedNativeSound.IsLoopingSound;
delete g_LimitedNativeSound.PrecacheSoundSentenceGroup;

const g_LimitedSoundModule = LoadSound(g_LimitedNativeSound);
g_Assert.deepEqual(Object.keys(g_LimitedSoundModule).sort(), g_vecExpectedLimitedExports);
g_Assert.equal(Object.hasOwn(g_LimitedSoundModule, "IsLoopingSound"), false);
g_Assert.equal(Object.hasOwn(g_LimitedSoundModule, "PrecacheSoundSentenceGroup"), false);

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = RequireFiniteNumber(flX, "Vector.X");
		this.Y = RequireFiniteNumber(flY, "Vector.Y");
		this.Z = RequireFiniteNumber(flZ, "Vector.Z");
	}
}

class RecipientFilter {
	constructor(...vecValues) {
		const Options = vecValues.at(-1);
		if ((Options !== null) && (typeof Options === "object") && !Array.isArray(Options) && Object.hasOwn(Options, "Reliable")) {
			vecValues.pop();
			this.Reliable = RequireOptionalBoolean(Options.Reliable, false, "RecipientFilter.Reliable");
		} else {
			this.Reliable = false;
		}

		this.RecipientIndexes = vecValues.flatMap((Value) => Array.isArray(Value) ? Value : [Value]).map((Value) => RequirePlayerIndex(Value, "RecipientFilter.Index"));
	}

	IsRecipientFilterReliable() {
		return this.Reliable;
	}
}

function Player(unIndex) {
	return {
		Connected: true,
		Index: RequirePlayerIndex(unIndex, "Player.Index"),
	};
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function ExecuteDocumentationBlock(strSource, unIndex, ModuleMap) {
	const Script = new g_VM.Script(`(function (require, console) {\n${strSource}\n})`, {
		filename: `engines-sound.md:block-${unIndex + 1}`,
	});
	const Callback = Script.runInNewContext({});
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(ModuleMap, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return ModuleMap[strModuleName];
	};
	const DocumentationConsole = {
		log() {
		},
	};

	Callback(DocumentationRequire, DocumentationConsole);
}

const g_vecDocumentationLogMessages = [];
const g_DocumentationModules = {
	"engines/sound": g_SoundModule,
	"filters/recipients": { RecipientFilter },
	loggers: {
		LogInfo(strFormat, Record) {
			g_Assert.equal(strFormat, "%j", "documentation logs must use structured formatting");
			g_Assert.ok(Record && (typeof Record === "object") && !Array.isArray(Record), "documentation log record must be an object");
			g_vecDocumentationLogMessages.push(JSON.stringify(Record));

			return true;
		},
	},
	globals: {
		GetRuntimeInfo() {
			return { SDKBranch: "l4d2" };
		},
	},
	mathlib: { Vector },
	"players/entity": { Player },
};
const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
g_Assert.equal(g_vecDocumentationBlocks.length, 20);
g_Assert.doesNotMatch(g_strDocumentation, /Positional EmitSound|StopSound\(ValueEntity/);
g_Assert.doesNotMatch(g_strDocumentation, /Passing a `mathlib\.Vector` object directly to a sound vector option|For a `mathlib\.Vector` object, call `ConvertMathStructureToArray\(\)` before passing it to this API/, "vector documentation must permit current X/Y/Z getters");
g_Assert.match(g_strDocumentation, /Origin: new Vector\(256, 128, 72\),/, "managed playback must exercise a direct component-bearing vector");

for (const [unIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, g_DocumentationModules);
}

g_Assert.equal(g_vecDocumentationLogMessages.length, 5, "all five diagnostic examples must use the public logger");

const g_setExercisedOperations = new Set(g_vecNativeCalls.map(([strOperation]) => strOperation));
for (const strOperation of [
	"GetDistanceGainFromSoundLevel",
	"GetSoundDuration",
	"EmitSound",
	"IsLoopingSound",
	"IsSoundPrecached",
	"PrecacheSound",
	"PrecacheSoundSentenceGroup",
	"PrefetchSound",
	"SetPlayerDSP",
	"SetSoundRoomType",
	"StopSound",
]) {
	g_Assert.equal(g_setExercisedOperations.has(strOperation), true, `missing exercised native operation: ${strOperation}`);
}

for (const unSoundLevel of [0, 1, 181, 254, 255]) {
	const unCallCount = g_vecNativeCalls.length;
	g_Assert.equal(g_SoundModule.GetDistanceGainFromSoundLevel(unSoundLevel, 512), unSoundLevel / (512 + unSoundLevel));
	g_Assert.deepEqual(g_vecNativeCalls[unCallCount], ["GetDistanceGainFromSoundLevel", unSoundLevel, 512]);
}

g_Assert.throws(() => g_SoundModule.GetDistanceGainFromSoundLevel(256, Infinity), /flDistance/);

delete require.cache[g_strSoundPath];
InstallDependency(g_strRuntimePath, {
	GetModule() {
		throw new Error("native engines/sound module is unavailable");
	},
});
g_Assert.throws(() => require(g_strSoundPath), /native engines\/sound module is unavailable/);

console.log("[smoke] engines/sound contracts and documentation passed");
