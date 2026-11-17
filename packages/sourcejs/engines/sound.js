"use strict";

const { GetModule } = require("internal/runtime");
const { DOWNLOADABLES, AddString } = require("stringtables");

const g_nMinimumInt32 = -2_147_483_648;
const g_nMaximumInt32 = 2_147_483_647;
const g_nDefaultSpeakerEntityIndex = -1;

const g_SoundRuntime = GetModule("engines/sound");
const g_Attenuation = Object.freeze({ ...g_SoundRuntime.Attenuation });
const g_Channel = Object.freeze({ ...g_SoundRuntime.Channel });
const g_Pitch = Object.freeze({ ...g_SoundRuntime.Pitch });
const g_SoundFlags = Object.freeze({ ...g_SoundRuntime.SoundFlags });
const g_flMaximumAttenuation = g_SoundRuntime.MAX_ATTENUATION;
const g_nSoundFromLocalPlayer = g_SoundRuntime.SOUND_FROM_LOCAL_PLAYER;
const g_nSoundFromWorld = g_SoundRuntime.SOUND_FROM_WORLD;
const g_flVolumeNormal = g_SoundRuntime.VOL_NORM;

function NormalizeSample(strSample) {
	if ((typeof strSample !== "string") || (strSample.length === 0)) {
		throw new TypeError("strSample must be a non-empty string.");
	}

	return strSample.replace(/\\/g, "/");
}

function GetSoundDownloadPath(strSample) {
	const strNormalizedSample = NormalizeSample(strSample);

	return strNormalizedSample.startsWith("sound/") ? strNormalizedSample : `sound/${strNormalizedSample}`;
}

function RequireOptions(Options) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Options must be an object.");
	}

	return Options;
}

function RequireBoolean(Options, strOptionName, bDefaultValue) {
	const bValue = Options[strOptionName] ?? bDefaultValue;
	if (typeof bValue !== "boolean") {
		throw new TypeError(`${strOptionName} must be a boolean.`);
	}

	return bValue;
}

function RequireNumber(Options, strOptionName, flDefaultValue) {
	const flValue = Options[strOptionName] ?? flDefaultValue;
	if ((typeof flValue !== "number") || !Number.isFinite(flValue)) {
		throw new TypeError(`${strOptionName} must be a finite number.`);
	}

	return flValue;
}

function RequireInt32(Options, strOptionName, nDefaultValue) {
	const nValue = Options[strOptionName] ?? nDefaultValue;
	if (!Number.isInteger(nValue) || (nValue < g_nMinimumInt32) || (nValue > g_nMaximumInt32)) {
		throw new TypeError(`${strOptionName} must be a signed 32-bit integer.`);
	}

	return nValue;
}

function PrecacheSound(strSample, bPreload = false, bUISound = false) {
	return g_SoundRuntime.PrecacheSound(NormalizeSample(strSample), bPreload, bUISound);
}

function IsSoundPrecached(strSample) {
	return g_SoundRuntime.IsSoundPrecached(NormalizeSample(strSample));
}

function PrefetchSound(strSample) {
	return g_SoundRuntime.PrefetchSound(NormalizeSample(strSample));
}

function IsLoopingSound(strSample) {
	return g_SoundRuntime.IsLoopingSound(NormalizeSample(strSample));
}

function GetSoundDuration(strSample) {
	return g_SoundRuntime.GetSoundDuration(NormalizeSample(strSample));
}

function EmitSound(Options) {
	const SoundOptions = RequireOptions(Options);
	const NormalizedOptions = { ...SoundOptions, Sample: NormalizeSample(SoundOptions.Sample) };

	return g_SoundRuntime.EmitSound(NormalizedOptions);
}

function StopSound(Options) {
	const SoundOptions = RequireOptions(Options);
	const NormalizedOptions = { ...SoundOptions, Sample: NormalizeSample(SoundOptions.Sample) };

	return g_SoundRuntime.StopSound(NormalizedOptions);
}

function SetSoundRoomType(...vecArguments) {
	return g_SoundRuntime.SetSoundRoomType(...vecArguments);
}

function SetPlayerDSP(...vecArguments) {
	return g_SoundRuntime.SetPlayerDSP(...vecArguments);
}

function GetDistanceGainFromSoundLevel(...vecArguments) {
	return g_SoundRuntime.GetDistanceGainFromSoundLevel(...vecArguments);
}

class Sound {
	constructor(strSample, Options = {}) {
		const ValidatedOptions = RequireOptions(Options);
		const vecOrigins = ValidatedOptions.Origins;

		this.Sample = NormalizeSample(strSample);
		this.Entity = RequireInt32(ValidatedOptions, "Entity", g_nSoundFromWorld);
		this.Volume = RequireNumber(ValidatedOptions, "Volume", g_flVolumeNormal);
		this.Attenuation = RequireNumber(ValidatedOptions, "Attenuation", g_Attenuation.NONE);
		this.Channel = RequireInt32(ValidatedOptions, "Channel", g_Channel.AUTO);
		this.Flags = RequireInt32(ValidatedOptions, "Flags", g_SoundFlags.NO_FLAGS);
		this.Pitch = RequireInt32(ValidatedOptions, "Pitch", g_Pitch.NORMAL);
		this.Origin = ValidatedOptions.Origin ?? null;
		this.Direction = ValidatedOptions.Direction ?? null;
		this.Origins = (vecOrigins === undefined) ? [] : vecOrigins;
		this.UpdatePositions = RequireBoolean(ValidatedOptions, "UpdatePositions", true);
		this.SoundTime = RequireNumber(ValidatedOptions, "SoundTime", 0.0);
		this.SpeakerEntity = RequireInt32(ValidatedOptions, "SpeakerEntity", g_nDefaultSpeakerEntityIndex);
		this.Recipients = ValidatedOptions.Recipients ?? null;
		this.Reliable = RequireBoolean(ValidatedOptions, "Reliable", false);
		this.Preload = RequireBoolean(ValidatedOptions, "Preload", false);
		this.UISound = RequireBoolean(ValidatedOptions, "UISound", false);
		this.Download = RequireBoolean(ValidatedOptions, "Download", false);

		if (!Array.isArray(this.Origins)) {
			throw new TypeError("Origins must be an array.");
		}

		if (this.Download) {
			DOWNLOADABLES.Add(this.RelativePath);
		}
	}

	PrecacheSound() {
		return PrecacheSound(this.EngineSample, this.Preload, this.UISound);
	}

	PlaySound(Recipients = this.Recipients) {
		if (!this.Precached) {
			this.PrecacheSound();
		}

		return EmitSound({
			Direction: this.Direction,
			Entity: this.Entity,
			Origin: this.Origin,
			Recipients,
			Origins: this.Origins,
			Reliable: this.Reliable,
			UpdatePositions: this.UpdatePositions,
			Attenuation: this.Attenuation,
			SoundTime: this.SoundTime,
			Volume: this.Volume,
			Channel: this.Channel,
			Pitch: this.Pitch,
			SpeakerEntity: this.SpeakerEntity,
			Sample: this.EngineSample,
			Flags: this.Flags,
		});
	}

	StopSound(nEntityIndex = this.Entity, nChannel = this.Channel) {
		return StopSound({ Entity: nEntityIndex, Channel: nChannel, Sample: this.EngineSample });
	}

	get EngineSample() {
		return this.Sample;
	}

	get RelativePath() {
		return GetSoundDownloadPath(this.Sample);
	}

	get Duration() {
		return GetSoundDuration(this.EngineSample);
	}

	get Precached() {
		return IsSoundPrecached(this.EngineSample);
	}
}

class StreamSound extends Sound {
	PrecacheSound() {
		return AddString("soundprecache", this.EngineSample) >= 0;
	}

	get EngineSample() {
		return `*/${this.Sample}`;
	}
}

const g_SoundAPI = {
	Attenuation: g_Attenuation,
	Channel: g_Channel,
	MAX_ATTENUATION: g_flMaximumAttenuation,
	Pitch: g_Pitch,
	SOUND_FROM_LOCAL_PLAYER: g_nSoundFromLocalPlayer,
	SOUND_FROM_WORLD: g_nSoundFromWorld,
	Sound,
	SoundFlags: g_SoundFlags,
	StreamSound,
	VOL_NORM: g_flVolumeNormal,
	EmitSound,
	GetDistanceGainFromSoundLevel,
	GetSoundDuration,
	IsSoundPrecached,
	PrecacheSound,
	PrefetchSound,
	SetPlayerDSP,
	SetSoundRoomType,
	StopSound,
};

if (typeof g_SoundRuntime.IsLoopingSound === "function") {
	g_SoundAPI.IsLoopingSound = IsLoopingSound;
}

if (typeof g_SoundRuntime.PrecacheSoundSentenceGroup === "function") {
	const PrecacheSoundSentenceGroup = (strGroupName) => g_SoundRuntime.PrecacheSoundSentenceGroup(NormalizeSample(strGroupName));
	g_SoundAPI.PrecacheSoundSentenceGroup = PrecacheSoundSentenceGroup;
}

module.exports = g_SoundAPI;
