"use strict";

const { PluginInfo } = require("plugins/info");

class Plugin {
	constructor(strPluginName, PluginManager) {
		if (!PluginManager || (typeof PluginManager !== "object") || Array.isArray(PluginManager)) {
			throw new TypeError("Plugin manager is required.");
		}

		const strValidatedPluginName = PluginManager.GetPluginName(strPluginName);

		this.PluginManager = PluginManager;
		this.PluginName = strValidatedPluginName;
	}

	LoadPlugin() {
		return this.PluginManager.LoadPlugin(this.PluginName);
	}

	UnloadPlugin() {
		return this.PluginManager.UnloadPlugin(this.PluginName);
	}

	ReloadPlugin() {
		return this.PluginManager.ReloadPlugin(this.PluginName);
	}

	EnablePlugin() {
		return this.PluginManager.EnablePlugin(this.PluginName);
	}

	DisablePlugin() {
		return this.PluginManager.DisablePlugin(this.PluginName);
	}

	get Name() {
		return this.PluginName;
	}

	get Record() {
		return this.PluginManager.GetPluginRecord(this.PluginName);
	}

	get Directory() {
		const PluginRecord = this.Record;
		if (PluginRecord !== null) {
			return PluginRecord.Directory;
		}

		return this.PluginManager.GetPluginDirectory(this.PluginName);
	}

	get FilePath() {
		const PluginRecord = this.Record;
		if (PluginRecord !== null) {
			return PluginRecord.Entry;
		}

		return this.PluginManager.GetPluginFilePath(this.PluginName);
	}

	// This existing public getter reads current manifest metadata synchronously.
	get Info() {
		const PluginRecord = this.Record;
		if (PluginRecord !== null) {
			return PluginInfo.FromRecord(PluginRecord);
		}

		return PluginInfo.FromRecord({ Directory: this.Directory, Enabled: this.Enabled, Entry: this.FilePath, Index: -1, Loaded: false, Name: this.Name });
	}

	get Loaded() {
		return this.PluginManager.IsPluginLoaded(this.PluginName);
	}

	get Enabled() {
		return this.PluginManager.IsPluginEnabled(this.PluginName);
	}
}

module.exports = { Plugin };
