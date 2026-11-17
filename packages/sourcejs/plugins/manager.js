"use strict";

const g_FilesystemRuntime = require("filesystem");
const g_PathsRuntime = require("paths");
const g_PluginsRuntime = require("plugins");
const { Plugin } = require("plugins/instance");
const { PluginInfo } = require("plugins/info");

const g_UnsafePluginNamePattern = /[\x00-\x1F\x7F\u2028\u2029]/;

const g_vecPluginRecordFieldNames = Object.freeze([
	"Index",
	"Name",
	"Directory",
	"Entry",
	"Enabled",
	"Loaded",
]);

class PluginError extends Error {
}

class PluginFileNotFoundError extends PluginError {
}

class InvalidPluginName extends PluginError {
}

class PluginAlreadyLoaded extends PluginError {
}

class PluginDisabled extends PluginError {
}

class PluginLoadError extends PluginError {
}

class PluginNotLoaded extends PluginError {
}

function JoinPluginPath(strLeftPath, strRightPath) {
	return `${strLeftPath.replace(/[\\/]+$/, "")}/${strRightPath.replace(/^[\\/]+/, "")}`;
}

function GetPluginEntryPath(strPluginDirectory, strPluginEntry) {
	const strNormalizedPluginEntry = strPluginEntry.replace(/\\/g, "/");
	if (strNormalizedPluginEntry.startsWith("/") || /^[A-Za-z]:/.test(strNormalizedPluginEntry) || /(^|\/)\.\.(?:\/|$)/.test(strNormalizedPluginEntry)) {
		throw new PluginLoadError(`Plugin entry must stay inside its directory: ${strPluginEntry}.`);
	}

	return JoinPluginPath(strPluginDirectory, strNormalizedPluginEntry);
}

function IsFilesystemSafePluginName(strPluginName) {
	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		return false;
	}

	// Custom matching rules cannot admit unsafe filesystem or logging identities.
	return (strPluginName !== ".") && (strPluginName !== "..") && !strPluginName.includes("/") && !strPluginName.includes("\\") && !strPluginName.includes(":") && !g_UnsafePluginNamePattern.test(strPluginName);
}

function ReadDisabledPluginNames() {
	const strPluginStateFilePath = JoinPluginPath(g_PathsRuntime.DATA_ROOT, "PluginsState.json");
	const bPluginStateFileExists = g_FilesystemRuntime.DoesFileExist(strPluginStateFilePath);
	if (typeof bPluginStateFileExists !== "boolean") {
		throw new PluginLoadError(`filesystem.DoesFileExist() returned a non-boolean result for "${strPluginStateFilePath}".`);
	}

	if (bPluginStateFileExists === false) {
		return new Set();
	}

	const strPluginStateText = g_FilesystemRuntime.ReadTextFile(strPluginStateFilePath);
	let PluginState = null;

	if (strPluginStateText.trim().length === 0) {
		return new Set();
	}

	try {
		PluginState = JSON.parse(strPluginStateText);
	} catch (PluginStateParseError) {
		throw new PluginLoadError(`Could not parse plugin state: ${PluginStateParseError.message}`, { cause: PluginStateParseError });
	}

	if ((PluginState === null) || (typeof PluginState !== "object") || Array.isArray(PluginState) || !Object.hasOwn(PluginState, "Disabled")) {
		throw new PluginLoadError("PluginsState.json must contain a Disabled string array.");
	}

	const vecDisabledPluginNames = PluginState.Disabled;
	if (!Array.isArray(vecDisabledPluginNames)) {
		throw new PluginLoadError("PluginsState.json must contain a Disabled string array.");
	}

	for (const strDisabledPluginName of vecDisabledPluginNames) {
		if (typeof strDisabledPluginName !== "string") {
			throw new PluginLoadError("PluginsState.json must contain a Disabled string array.");
		}
	}

	return new Set(vecDisabledPluginNames);
}

class PluginManager extends Map {
	constructor(PluginManagerOptions = {}) {
		super();

		if ((PluginManagerOptions === null) || (typeof PluginManagerOptions !== "object") || Array.isArray(PluginManagerOptions)) {
			throw new TypeError("PluginManager options must be an object.");
		}

		let ValidPluginPattern = /^[A-Za-z](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;
		if (Object.hasOwn(PluginManagerOptions, "ValidPluginPattern")) {
			ValidPluginPattern = PluginManagerOptions.ValidPluginPattern;
		}

		if (!(ValidPluginPattern instanceof RegExp)) {
			throw new TypeError("ValidPluginPattern must be a RegExp.");
		}

		if (ValidPluginPattern.global || ValidPluginPattern.sticky) {
			throw new TypeError("ValidPluginPattern must not use global or sticky matching.");
		}

		this.ValidPluginPattern = ValidPluginPattern;
	}

	Refresh() {
		this.SyncPluginInstances();

		return this;
	}

	GetPluginRecords() {
		return g_PluginsRuntime.GetPluginRecords();
	}

	GetPluginRecordByName(strPluginName) {
		this.AssertValidPluginName(strPluginName);

		const vecPluginRecords = this.GetPluginRecords();
		for (const PluginRecord of vecPluginRecords) {
			if (PluginRecord.Name === strPluginName) {
				return PluginRecord;
			}
		}

		return null;
	}

	GetPluginRecord(PluginSelector) {
		if (typeof PluginSelector === "string") {
			this.AssertValidPluginName(PluginSelector);

			const vecPluginRecords = this.GetPluginRecords();
			for (const PluginRecord of vecPluginRecords) {
				if (PluginRecord.Name === PluginSelector) {
					return PluginRecord;
				}
			}

			return null;
		}

		if (Number.isSafeInteger(PluginSelector) && (PluginSelector > 0)) {
			const vecPluginRecords = this.GetPluginRecords();
			for (const PluginRecord of vecPluginRecords) {
				if (PluginRecord.Index === PluginSelector) {
					return PluginRecord;
				}
			}

			return null;
		}

		throw new TypeError("Plugin selector must be a name or positive one-based integer index.");
	}

	LoadPlugin(strPluginName) {
		this.AssertValidPluginName(strPluginName);

		if (this.IsPluginLoaded(strPluginName)) {
			throw new PluginAlreadyLoaded(`Plugin "${strPluginName}" is already loaded.`);
		}

		if (!this.PluginExists(strPluginName)) {
			throw new PluginFileNotFoundError(`Plugin "${strPluginName}" does not exist.`);
		}

		if (!this.IsPluginEnabled(strPluginName)) {
			throw new PluginDisabled(`Plugin "${strPluginName}" is disabled.`);
		}

		const bPluginLoaded = g_PluginsRuntime.LoadPlugin(strPluginName);
		if (bPluginLoaded !== true) {
			throw new PluginLoadError(`Plugin "${strPluginName}" failed to load.`);
		}

		const PluginInstance = this.CreatePluginInstance(strPluginName);
		this.set(strPluginName, PluginInstance);

		return PluginInstance;
	}

	UnloadPlugin(PluginSelector) {
		const PluginRecord = this.RequirePluginRecord(PluginSelector);
		const bPluginUnloaded = g_PluginsRuntime.UnloadPlugin(PluginRecord.Name);
		if (bPluginUnloaded !== true) {
			throw new PluginLoadError(`Plugin "${PluginRecord.Name}" failed to unload.`);
		}

		this.delete(PluginRecord.Name);

		return bPluginUnloaded;
	}

	ReloadPlugin(PluginSelector) {
		const PluginRecord = this.RequirePluginRecord(PluginSelector);
		const bPluginReloaded = g_PluginsRuntime.ReloadPlugin(PluginRecord.Name);
		if (bPluginReloaded !== true) {
			this.SyncPluginInstances();
			throw new PluginLoadError(`Plugin "${PluginRecord.Name}" failed to reload.`);
		}

		const PluginInstance = this.CreatePluginInstance(PluginRecord.Name);
		this.set(PluginRecord.Name, PluginInstance);

		return PluginInstance;
	}

	UnloadAllPlugins() {
		const bPluginsUnloaded = g_PluginsRuntime.UnloadAllPlugins();
		this.SyncPluginInstances();

		if (bPluginsUnloaded !== true) {
			throw new PluginLoadError("Not every plugin unloaded.");
		}

		return bPluginsUnloaded;
	}

	ReloadAllPlugins() {
		const bPluginsReloaded = g_PluginsRuntime.ReloadAllPlugins();
		this.SyncPluginInstances();

		if (bPluginsReloaded !== true) {
			throw new PluginLoadError("Not every enabled plugin reloaded.");
		}

		return bPluginsReloaded;
	}

	DisablePlugin(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		let strPluginName = "";
		if (PluginRecord !== null) {
			strPluginName = PluginRecord.Name;
		} else if (typeof PluginSelector === "string") {
			this.AssertValidPluginName(PluginSelector);

			if (!this.PluginExists(PluginSelector)) {
				throw new PluginFileNotFoundError(`Plugin "${PluginSelector}" does not exist.`);
			}

			strPluginName = PluginSelector;
		} else {
			throw new PluginNotLoaded(`Plugin index ${PluginSelector} is not loaded.`);
		}

		const bPluginDisabled = g_PluginsRuntime.DisablePlugin(strPluginName);
		if (bPluginDisabled !== true) {
			throw new PluginLoadError(`Plugin "${strPluginName}" failed to disable.`);
		}

		this.delete(strPluginName);

		return bPluginDisabled;
	}

	EnablePlugin(strPluginName) {
		this.AssertValidPluginName(strPluginName);

		if (!this.PluginExists(strPluginName)) {
			throw new PluginFileNotFoundError(`Plugin "${strPluginName}" does not exist.`);
		}

		const bPluginEnabled = g_PluginsRuntime.EnablePlugin(strPluginName);
		this.SyncPluginInstances();

		if (bPluginEnabled !== true) {
			throw new PluginLoadError(`Plugin "${strPluginName}" failed to enable.`);
		}

		const PluginInstance = this.GetPluginInstance(strPluginName);
		if (PluginInstance === null) {
			throw new PluginLoadError(`Plugin "${strPluginName}" enabled without a loaded record.`);
		}

		return PluginInstance;
	}

	IsValidPluginName(strPluginName) {
		const ValidPluginPattern = this.ValidPluginPattern;
		if (!(ValidPluginPattern instanceof RegExp)) {
			throw new TypeError("ValidPluginPattern must be a RegExp.");
		}

		if (ValidPluginPattern.global || ValidPluginPattern.sticky) {
			throw new TypeError("ValidPluginPattern must not use global or sticky matching.");
		}

		return IsFilesystemSafePluginName(strPluginName) && ValidPluginPattern.test(strPluginName);
	}

	IsPluginLoaded(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord === null) {
			return false;
		}

		const bPluginLoaded = PluginRecord.Loaded;
		if (typeof bPluginLoaded !== "boolean") {
			throw new PluginLoadError(`Plugin "${PluginRecord.Name}" has invalid Loaded state.`);
		}

		return bPluginLoaded;
	}

	IsPluginEnabled(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord !== null) {
			const bPluginEnabled = PluginRecord.Enabled;
			if (typeof bPluginEnabled !== "boolean") {
				throw new PluginLoadError(`Plugin "${PluginRecord.Name}" has invalid Enabled state.`);
			}

			return bPluginEnabled;
		}

		if (typeof PluginSelector !== "string") {
			return false;
		}

		this.AssertValidPluginName(PluginSelector);

		return this.PluginExists(PluginSelector) && !ReadDisabledPluginNames().has(PluginSelector);
	}

	PluginExists(strPluginName) {
		this.AssertValidPluginName(strPluginName);

		let strPluginFilePath = "";
		try {
			strPluginFilePath = this.GetPluginFilePath(strPluginName);
		} catch (PluginFileError) {
			if (PluginFileError instanceof PluginFileNotFoundError) {
				return false;
			}

			throw PluginFileError;
		}

		const bPluginFileExists = g_FilesystemRuntime.DoesFileExist(strPluginFilePath);
		if (typeof bPluginFileExists !== "boolean") {
			throw new PluginLoadError(`filesystem.DoesFileExist() returned a non-boolean result for "${strPluginFilePath}".`);
		}

		return bPluginFileExists;
	}

	GetPluginInstance(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord === null) {
			return null;
		}

		const strPluginName = PluginRecord.Name;
		if ((typeof strPluginName !== "string") || !this.IsValidPluginName(strPluginName)) {
			throw new PluginLoadError("Plugin record has an invalid Name.");
		}

		const bPluginLoaded = PluginRecord.Loaded;
		if (typeof bPluginLoaded !== "boolean") {
			throw new PluginLoadError(`Plugin "${strPluginName}" has invalid Loaded state.`);
		}

		if (bPluginLoaded === false) {
			return null;
		}

		if (!this.has(strPluginName)) {
			const PluginInstance = this.CreatePluginInstance(strPluginName);
			if (!(PluginInstance instanceof Plugin)) {
				throw new TypeError(`Plugin "${strPluginName}" created an invalid managed wrapper.`);
			}

			this.set(strPluginName, PluginInstance);
		}

		const PluginInstance = this.get(strPluginName);
		if (!(PluginInstance instanceof Plugin)) {
			throw new TypeError(`Plugin "${strPluginName}" has an invalid managed wrapper.`);
		}

		return PluginInstance;
	}

	GetPluginName(strPluginName) {
		this.AssertValidPluginName(strPluginName);

		return strPluginName;
	}

	GetPluginDirectory(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord !== null) {
			const strPluginDirectory = PluginRecord.Directory;
			if ((typeof strPluginDirectory !== "string") || (strPluginDirectory.length === 0)) {
				throw new PluginLoadError("Plugin record has an invalid Directory.");
			}

			return strPluginDirectory;
		}

		if (typeof PluginSelector !== "string") {
			throw new PluginNotLoaded(`Plugin index ${PluginSelector} is not loaded.`);
		}

		this.AssertValidPluginName(PluginSelector);

		const strPluginDirectory = JoinPluginPath(g_PathsRuntime.PLUGIN_ROOT, PluginSelector);
		const bPluginDirectoryExists = g_FilesystemRuntime.DoesFileExist(strPluginDirectory);
		if (typeof bPluginDirectoryExists !== "boolean") {
			throw new PluginLoadError(`filesystem.DoesFileExist() returned a non-boolean result for "${strPluginDirectory}".`);
		}

		if (bPluginDirectoryExists === false) {
			throw new PluginFileNotFoundError(`Plugin "${PluginSelector}" does not exist.`);
		}

		return strPluginDirectory;
	}

	GetPluginFilePath(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord !== null) {
			const strPluginEntryPath = PluginRecord.Entry;
			if ((typeof strPluginEntryPath !== "string") || (strPluginEntryPath.length === 0)) {
				throw new PluginLoadError("Plugin record has an invalid Entry path.");
			}

			return strPluginEntryPath;
		}

		if (typeof PluginSelector !== "string") {
			throw new PluginNotLoaded(`Plugin index ${PluginSelector} is not loaded.`);
		}

		const strPluginDirectory = this.GetPluginDirectory(PluginSelector);
		const strPluginManifestPath = JoinPluginPath(strPluginDirectory, "plugin.json");
		const bPluginManifestExists = g_FilesystemRuntime.DoesFileExist(strPluginManifestPath);
		if (typeof bPluginManifestExists !== "boolean") {
			throw new PluginLoadError(`filesystem.DoesFileExist() returned a non-boolean result for "${strPluginManifestPath}".`);
		}

		let strPluginEntry = "index.js";
		if (bPluginManifestExists) {
			strPluginEntry = PluginInfo.FromManifest(PluginSelector, strPluginDirectory).Entry;
		}

		const strPluginFilePath = GetPluginEntryPath(strPluginDirectory, strPluginEntry);
		const bPluginFileExists = g_FilesystemRuntime.DoesFileExist(strPluginFilePath);
		if (typeof bPluginFileExists !== "boolean") {
			throw new PluginLoadError(`filesystem.DoesFileExist() returned a non-boolean result for "${strPluginFilePath}".`);
		}

		if (bPluginFileExists === false) {
			throw new PluginFileNotFoundError(`Plugin entry does not exist: ${strPluginFilePath}.`);
		}

		return strPluginFilePath;
	}

	GetPluginInfo(PluginSelector) {
		const PluginInstance = this.GetPluginInstance(PluginSelector);
		if (PluginInstance !== null) {
			const PluginInformation = PluginInstance.Info;
			if (!(PluginInformation instanceof PluginInfo)) {
				throw new TypeError(`Plugin "${PluginInstance.Name}" returned invalid plugin information.`);
			}

			return PluginInformation;
		}

		if (typeof PluginSelector !== "string") {
			throw new PluginNotLoaded(`Plugin index ${PluginSelector} is not loaded.`);
		}

		const strPluginName = this.GetPluginName(PluginSelector);
		const strPluginDirectory = this.GetPluginDirectory(strPluginName);
		const bPluginEnabled = this.IsPluginEnabled(strPluginName);
		const strPluginFilePath = this.GetPluginFilePath(strPluginName);
		const PluginRecord = { Directory: strPluginDirectory, Enabled: bPluginEnabled, Entry: strPluginFilePath, Index: -1, Loaded: false, Name: strPluginName };

		return PluginInfo.FromRecord(PluginRecord);
	}

	RequirePluginRecord(PluginSelector) {
		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord === null) {
			if (typeof PluginSelector === "string") {
				this.AssertValidPluginName(PluginSelector);

				if (this.PluginExists(PluginSelector)) {
					throw new PluginNotLoaded(`Plugin "${PluginSelector}" is not loaded.`);
				}
			} else {
				throw new PluginNotLoaded(`Plugin index ${PluginSelector} is not loaded.`);
			}

			throw new PluginFileNotFoundError(`Plugin "${PluginSelector}" does not exist.`);
		}

		return PluginRecord;
	}

	AssertValidPluginName(strPluginName) {
		if (!this.IsValidPluginName(strPluginName)) {
			throw new InvalidPluginName(`"${strPluginName}" is an invalid plugin name.`);
		}
	}

	SyncPluginInstances() {
		const vecPluginRecords = this.GetPluginRecords();
		if (!Array.isArray(vecPluginRecords)) {
			throw new PluginLoadError("plugins.GetPluginRecords() must return an array.");
		}

		const setPluginRecordNames = new Set();
		const setPluginRecordIndexes = new Set();
		const setLoadedPluginNames = new Set();
		for (const PluginRecord of vecPluginRecords) {
			if ((PluginRecord === null) || (typeof PluginRecord !== "object") || Array.isArray(PluginRecord)) {
				throw new PluginLoadError("plugins.GetPluginRecords() returned an invalid plugin record.");
			}

			const PluginRecordPrototype = Object.getPrototypeOf(PluginRecord);
			if ((PluginRecordPrototype !== Object.prototype) && (PluginRecordPrototype !== null)) {
				throw new PluginLoadError("plugins.GetPluginRecords() returned a non-plain plugin record.");
			}

			for (const strPluginRecordFieldName of g_vecPluginRecordFieldNames) {
				if (!Object.hasOwn(PluginRecord, strPluginRecordFieldName)) {
					throw new PluginLoadError(`plugins.GetPluginRecords() returned a plugin record without "${strPluginRecordFieldName}".`);
				}
			}

			const strPluginName = PluginRecord.Name;
			const strPluginDirectory = PluginRecord.Directory;
			const strPluginEntry = PluginRecord.Entry;
			const bPluginEnabled = PluginRecord.Enabled;
			const bPluginLoaded = PluginRecord.Loaded;
			const unPluginIndex = PluginRecord.Index;
			if ((typeof strPluginName !== "string") || !this.IsValidPluginName(strPluginName)) {
				throw new PluginLoadError("plugins.GetPluginRecords() returned an invalid plugin Name.");
			}

			if ((typeof strPluginDirectory !== "string") || (strPluginDirectory.length === 0)) {
				throw new PluginLoadError(`Plugin "${strPluginName}" has an invalid Directory.`);
			}

			if ((typeof strPluginEntry !== "string") || (strPluginEntry.length === 0)) {
				throw new PluginLoadError(`Plugin "${strPluginName}" has an invalid Entry path.`);
			}

			if (typeof bPluginEnabled !== "boolean") {
				throw new PluginLoadError(`Plugin "${strPluginName}" has invalid Enabled state.`);
			}

			if (typeof bPluginLoaded !== "boolean") {
				throw new PluginLoadError(`Plugin "${strPluginName}" has invalid Loaded state.`);
			}

			if (!Number.isSafeInteger(unPluginIndex) || (unPluginIndex <= 0)) {
				throw new PluginLoadError(`Plugin "${strPluginName}" has an invalid record Index.`);
			}

			if (setPluginRecordNames.has(strPluginName)) {
				throw new PluginLoadError(`plugins.GetPluginRecords() returned duplicate plugin "${strPluginName}" records.`);
			}

			if (setPluginRecordIndexes.has(unPluginIndex)) {
				throw new PluginLoadError(`plugins.GetPluginRecords() returned duplicate plugin Index ${unPluginIndex}.`);
			}

			setPluginRecordNames.add(strPluginName);
			setPluginRecordIndexes.add(unPluginIndex);

			if (bPluginLoaded === false) {
				continue;
			}

			setLoadedPluginNames.add(strPluginName);
		}

		const mapPendingPluginInstances = new Map();
		for (const strPluginName of setLoadedPluginNames) {
			if (this.has(strPluginName)) {
				const PluginInstance = this.get(strPluginName);
				if (!(PluginInstance instanceof Plugin)) {
					throw new TypeError(`Plugin "${strPluginName}" has an invalid managed wrapper.`);
				}

				continue;
			}

			const PluginInstance = this.CreatePluginInstance(strPluginName);
			if (!(PluginInstance instanceof Plugin)) {
				throw new TypeError(`Plugin "${strPluginName}" created an invalid managed wrapper.`);
			}

			mapPendingPluginInstances.set(strPluginName, PluginInstance);
		}

		for (const strManagedPluginName of this.keys()) {
			if (!setLoadedPluginNames.has(strManagedPluginName)) {
				this.delete(strManagedPluginName);
			}
		}

		for (const vecPendingPluginEntry of mapPendingPluginInstances) {
			const strPluginName = vecPendingPluginEntry[0];
			const PluginInstance = vecPendingPluginEntry[1];
			this.set(strPluginName, PluginInstance);
		}

		return this;
	}

	CreatePluginInstance(strPluginName) {
		return new Plugin(strPluginName, this);
	}

	get PluginNames() {
		const vecPluginNames = [];
		for (const PluginRecord of this.GetPluginRecords()) {
			vecPluginNames.push(PluginRecord.Name);
		}

		return vecPluginNames;
	}

	// Refresh managed wrapper ownership before returning the current instances.
	get LoadedPlugins() {
		this.SyncPluginInstances();

		return Array.from(this.values());
	}
}

const g_mapPluginManager = new PluginManager();

module.exports = {
	PLUGIN_MANAGER: g_mapPluginManager,
	InvalidPluginName,
	PluginAlreadyLoaded,
	PluginDisabled,
	PluginError,
	PluginFileNotFoundError,
	PluginLoadError,
	PluginManager,
	PluginNotLoaded,
};
