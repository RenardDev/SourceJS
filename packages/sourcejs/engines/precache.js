"use strict";

const { GetGlobalVariables } = require("engines/server");
const { EVENT_MANAGER } = require("events/manager");
const { GetModule } = require("internal/runtime");
const { Downloadables, Find, GetString } = require("stringtables");

const g_PrecacheRuntime = GetModule("engines/precache");

function FindStringIndex(strTableName, strTableValue) {
	const StringTable = Find(strTableName);
	if (!StringTable) {
		return -1;
	}

	for (let unStringIndex = 0; unStringIndex < StringTable.StringCount; ++unStringIndex) {
		if (GetString(strTableName, unStringIndex) === strTableValue) {
			return unStringIndex;
		}
	}

	return -1;
}

function GetCurrentMapName() {
	const strMapName = GetGlobalVariables().MapName;
	if (typeof strMapName !== "string") {
		throw new TypeError("engines/server.GetGlobalVariables().MapName must be a string.");
	}

	return strMapName;
}

function IsMapLoaded() {
	return GetCurrentMapName().length > 0;
}

class PrecacheResourceError extends Error {
	constructor(strResourcePath, strTableName) {
		super(`"${strResourcePath}" was not able to be precached in "${strTableName}".`);
		this.name = "PrecacheResourceError";
		this.ResourcePath = strResourcePath;
		this.TableName = strTableName;
	}
}

class PrecacheResourceBase {
	constructor(strResourcePath, Options = {}) {
		if ((typeof strResourcePath !== "string") || (strResourcePath.length === 0)) {
			throw new TypeError("strResourcePath must be a non-empty string.");
		}

		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Options must be an object.");
		}

		this.ResourcePath = strResourcePath;
		this.Preload = Object.hasOwn(Options, "Preload") ? Options.Preload : false;
		this.Download = Object.hasOwn(Options, "Download") ? Options.Download : false;
		this.UISound = Object.hasOwn(Options, "UISound") ? Options.UISound : false;
		this.Downloadables = null;
		this.Registered = false;

		const ServerSpawnCallback = (GameEvent) => this.OnServerSpawn(GameEvent);
		this.ServerSpawnCallback = ServerSpawnCallback;

		if ((typeof this.Preload !== "boolean") || (typeof this.Download !== "boolean") || (typeof this.UISound !== "boolean")) {
			throw new TypeError("Preload, Download, and UISound must be booleans.");
		}

		try {
			if (IsMapLoaded()) {
				this.Precache();
			}

			this.RegisterServerSpawnListener();

			if (this.Download) {
				this.Downloadables = new Downloadables();
				this.Downloadables.Add(this.GetDownloadPath());
			}
		} catch (ErrorValue) {
			try {
				this.Unload();
			} catch (CleanupError) {
				throw new AggregateError([ErrorValue, CleanupError], "Precache resource construction and cleanup failed.");
			}

			throw ErrorValue;
		}
	}

	RegisterServerSpawnListener() {
		if (this.Registered) {
			return true;
		}

		EVENT_MANAGER.RegisterEventListener("server_spawn", this.ServerSpawnCallback);
		this.Registered = true;

		return true;
	}

	OnServerSpawn(GameEvent) {
		return this.Precache(GameEvent);
	}

	Precache() {
		throw new Error("PrecacheResourceBase.Precache must be implemented by a subclass.");
	}

	Unload() {
		const vecCleanupErrors = [];

		try {
			if (this.Registered) {
				EVENT_MANAGER.UnregisterEventListener("server_spawn", this.ServerSpawnCallback);
				this.Registered = false;
			}
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		try {
			if (this.Downloadables) {
				this.Downloadables.Dispose();
				this.Downloadables = null;
			}
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		if (vecCleanupErrors.length === 1) {
			throw vecCleanupErrors[0];
		}

		if (vecCleanupErrors.length > 1) {
			throw new AggregateError(vecCleanupErrors, "Precache resource cleanup failed.");
		}

		return true;
	}

	GetDownloadPath() {
		return this.ResourcePath;
	}

	GetPrecacheIndex() {
		const nPrecacheIndex = FindStringIndex(this.GetPrecacheTableName(), this.GetPrecacheTableValue());
		if (nPrecacheIndex >= 0) {
			return nPrecacheIndex;
		}

		throw new PrecacheResourceError(this.GetPrecacheTableValue(), this.GetPrecacheTableName());
	}

	GetPrecacheTableName() {
		throw new Error("PrecacheResourceBase.GetPrecacheTableName must be implemented by a subclass.");
	}

	GetPrecacheTableValue() {
		return this.ResourcePath;
	}
}

class ModelPrecacheResource extends PrecacheResourceBase {
	Precache() {
		return g_PrecacheRuntime.PrecacheModel(this.ResourcePath, this.Preload);
	}

	GetPrecacheTableName() {
		return "modelprecache";
	}
}

class GenericPrecacheResource extends PrecacheResourceBase {
	Precache() {
		return g_PrecacheRuntime.PrecacheGeneric(this.ResourcePath, this.Preload);
	}

	GetPrecacheTableName() {
		return "genericprecache";
	}
}

class DecalPrecacheResource extends PrecacheResourceBase {
	Precache() {
		return g_PrecacheRuntime.PrecacheDecal(this.ResourcePath, this.Preload);
	}

	GetPrecacheTableName() {
		return "decalprecache";
	}
}

class SoundPrecacheResource extends PrecacheResourceBase {
	Precache() {
		return g_PrecacheRuntime.PrecacheSound(this.ResourcePath, this.Preload, this.UISound);
	}

	GetDownloadPath() {
		const strNormalizedPath = this.ResourcePath.replace(/\\/g, "/");

		return strNormalizedPath.startsWith("sound/") ? strNormalizedPath : `sound/${strNormalizedPath}`;
	}

	GetPrecacheTableName() {
		return "soundprecache";
	}

	GetSoundSample() {
		return this.ResourcePath;
	}
}

function PrecacheModel(strFilePath, bPreload = false) {
	return g_PrecacheRuntime.PrecacheModel(strFilePath, bPreload);
}

function PrecacheGeneric(strFilePath, bPreload = false) {
	return g_PrecacheRuntime.PrecacheGeneric(strFilePath, bPreload);
}

function PrecacheDecal(strDecalName, bPreload = false) {
	return g_PrecacheRuntime.PrecacheDecal(strDecalName, bPreload);
}

function PrecacheSound(strSample, bPreload = false, bUISound = false) {
	return g_PrecacheRuntime.PrecacheSound(strSample, bPreload, bUISound);
}

module.exports = Object.freeze({
	DecalPrecacheResource,
	GenericPrecacheResource,
	ModelPrecacheResource,
	PrecacheDecal,
	PrecacheGeneric,
	PrecacheModel,
	PrecacheResourceBase,
	PrecacheResourceError,
	PrecacheSound,
	SoundPrecacheResource,
});
