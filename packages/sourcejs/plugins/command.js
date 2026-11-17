"use strict";

const {
	RegisterTypedClientCommand,
	RegisterTypedSayCommand,
	RegisterTypedServerCommand,
} = require("commands/typed");
const { LogInfo, LogWarning } = require("loggers");
const {
	InvalidPluginName,
	PluginAlreadyLoaded,
	PluginDisabled,
	PluginFileNotFoundError,
	PluginLoadError,
	PluginNotLoaded,
	PLUGIN_MANAGER,
} = require("plugins/manager");

function IsPlainObject(Value) {
	if ((Value === null) || (typeof Value !== "object")) {
		return false;
	}

	const Prototype = Object.getPrototypeOf(Value);

	return (Prototype === Object.prototype) || (Prototype === null);
}

function RequireSubCommandOptions(CommandOptions, strOptionsName) {
	if (!IsPlainObject(CommandOptions)) {
		throw new TypeError(`${strOptionsName} must be a plain object.`);
	}

	return CommandOptions;
}

function ReadSubCommandOption(CommandOptions, strOptionName, DefaultOptionValue) {
	if (!Object.hasOwn(CommandOptions, strOptionName)) {
		return DefaultOptionValue;
	}

	const OptionValue = CommandOptions[strOptionName];

	return (OptionValue === undefined) ? DefaultOptionValue : OptionValue;
}

function NormalizeCommandNames(CommandNames) {
	const vecSourceCommandNames = Array.isArray(CommandNames) ? CommandNames : [CommandNames];
	const vecNormalizedCommandNames = [];
	if (vecSourceCommandNames.length === 0) {
		throw new TypeError("CommandNames must contain non-empty strings.");
	}

	for (const strCommandName of vecSourceCommandNames) {
		if ((typeof strCommandName !== "string") || (strCommandName.length === 0)) {
			throw new TypeError("CommandNames must contain non-empty strings.");
		}

		vecNormalizedCommandNames.push(strCommandName);
	}

	return vecNormalizedCommandNames;
}

function BuildSubCommandPath(strRootCommandName, CommandNames) {
	if ((typeof strRootCommandName !== "string") || (strRootCommandName.length === 0)) {
		throw new TypeError("CommandName must be a non-empty string.");
	}

	const vecNormalizedCommandNames = NormalizeCommandNames(CommandNames);
	const vecCommandPath = [strRootCommandName];
	for (const strCommandName of vecNormalizedCommandNames) {
		vecCommandPath.push(strCommandName);
	}

	return vecCommandPath;
}

function CreatePermissionRegistrationOptions(CommandOptions, strRequiredPermission) {
	const ValidatedCommandOptions = RequireSubCommandOptions(CommandOptions, "CommandOptions");
	const RegistrationOptions = Object.create(null);
	for (const strOptionName in ValidatedCommandOptions) {
		if (!Object.hasOwn(ValidatedCommandOptions, strOptionName)) {
			continue;
		}

		RegistrationOptions[strOptionName] = ValidatedCommandOptions[strOptionName];
	}

	RegistrationOptions.Permission = strRequiredPermission;

	return RegistrationOptions;
}

function RequirePluginName(strPluginName) {
	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		throw new TypeError("PluginName must be a non-empty string.");
	}

	return strPluginName;
}

function RequirePluginSelector(PluginSelector) {
	if (typeof PluginSelector === "string") {
		return RequirePluginName(PluginSelector);
	}

	if (!Number.isSafeInteger(PluginSelector) || (PluginSelector <= 0)) {
		throw new TypeError("PluginSelector must be a non-empty string or positive safe integer.");
	}

	return PluginSelector;
}

function GetPluginInstanceName(PluginInstance, strPluginResultName) {
	if ((PluginInstance === null) || (typeof PluginInstance !== "object")) {
		throw new TypeError(`${strPluginResultName} must be a plugin instance object.`);
	}

	const strPluginName = PluginInstance.Name;
	if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
		throw new TypeError(`${strPluginResultName}.Name must be a non-empty string.`);
	}

	return strPluginName;
}

class SubCommandManager extends Array {
	constructor(PluginManager = PLUGIN_MANAGER, strRootCommandName = "sjs", CommandOptions = {}) {
		super();

		if ((PluginManager === null) || (typeof PluginManager !== "object") || Array.isArray(PluginManager)) {
			throw new TypeError("PluginManager must be a plugin manager object.");
		}

		if ((typeof strRootCommandName !== "string") || (strRootCommandName.length === 0)) {
			throw new TypeError("RootCommandName must be a non-empty string.");
		}

		const ValidatedCommandOptions = RequireSubCommandOptions(CommandOptions, "CommandOptions");
		const strDefaultMessagePrefix = `[${strRootCommandName.toUpperCase()}] `;
		const strMessagePrefix = ReadSubCommandOption(ValidatedCommandOptions, "Prefix", strDefaultMessagePrefix);
		const CommandLogger = ReadSubCommandOption(ValidatedCommandOptions, "Logger", { Info: LogInfo, Warning: LogWarning });

		if (typeof strMessagePrefix !== "string") {
			throw new TypeError("CommandOptions.Prefix must be a string.");
		}

		if ((CommandLogger === null) || ((typeof CommandLogger !== "object") && (typeof CommandLogger !== "function"))) {
			throw new TypeError("CommandOptions.Logger must provide Info and Warning functions.");
		}

		const CommandLoggerInformation = CommandLogger.Info;
		const CommandLoggerWarning = CommandLogger.Warning;
		if ((typeof CommandLoggerInformation !== "function") || (typeof CommandLoggerWarning !== "function")) {
			throw new TypeError("CommandOptions.Logger must provide Info and Warning functions.");
		}

		this.PluginManager = PluginManager;
		this.CommandName = strRootCommandName;
		this.MessagePrefix = strMessagePrefix;
		this.CommandLogger = CommandLogger;
	}

	ServerSubCommand(CommandNames, CommandOptions = {}) {
		const vecCommandPath = BuildSubCommandPath(this.CommandName, CommandNames);
		const RegistrationOptions = RequireSubCommandOptions(CommandOptions, "CommandOptions");
		const ServerCommandRegistration = RegisterTypedServerCommand(vecCommandPath, RegistrationOptions);
		this.push(ServerCommandRegistration);

		return ServerCommandRegistration;
	}

	ClientSubCommand(CommandNames, strRequiredPermission = null, CommandOptions = {}) {
		const vecCommandPath = BuildSubCommandPath(this.CommandName, CommandNames);
		const RegistrationOptions = CreatePermissionRegistrationOptions(CommandOptions, strRequiredPermission);
		const ClientCommandRegistration = RegisterTypedClientCommand(vecCommandPath, RegistrationOptions);
		this.push(ClientCommandRegistration);

		return ClientCommandRegistration;
	}

	SaySubCommand(CommandNames, strRequiredPermission = null, CommandOptions = {}) {
		const vecCommandPath = BuildSubCommandPath(this.CommandName, CommandNames);
		const RegistrationOptions = CreatePermissionRegistrationOptions(CommandOptions, strRequiredPermission);
		const SayCommandRegistration = RegisterTypedSayCommand(vecCommandPath, RegistrationOptions);
		this.push(SayCommandRegistration);

		return SayCommandRegistration;
	}

	LoadPlugin(strPluginName) {
		const strValidatedPluginName = RequirePluginName(strPluginName);
		this.LogMessage(`Loading plugin "${strValidatedPluginName}".`);

		let LoadedPlugin = null;
		try {
			LoadedPlugin = this.PluginManager.LoadPlugin(strValidatedPluginName);
		} catch (PluginLifecycleError) {
			this.LogPluginError("load", strValidatedPluginName, PluginLifecycleError);
			return null;
		}

		const strLoadedPluginName = GetPluginInstanceName(LoadedPlugin, "LoadedPlugin");
		this.LogMessage(`Plugin "${strLoadedPluginName}" has been loaded.`);

		return LoadedPlugin;
	}

	UnloadPlugin(PluginSelector) {
		const ValidatedPluginSelector = RequirePluginSelector(PluginSelector);
		this.LogMessage(`Unloading plugin "${ValidatedPluginSelector}".`);

		let bPluginUnloaded = false;
		try {
			bPluginUnloaded = this.PluginManager.UnloadPlugin(ValidatedPluginSelector);
		} catch (PluginLifecycleError) {
			this.LogPluginError("unload", ValidatedPluginSelector, PluginLifecycleError);
			return false;
		}

		if (typeof bPluginUnloaded !== "boolean") {
			throw new TypeError("PluginManager.UnloadPlugin() must return a boolean.");
		}

		if (!bPluginUnloaded) {
			this.LogWarning(`Plugin "${ValidatedPluginSelector}" failed to unload.`);
			return false;
		}

		this.LogMessage(`Plugin "${ValidatedPluginSelector}" has been unloaded.`);

		return true;
	}

	ReloadPlugin(PluginSelector) {
		const ValidatedPluginSelector = RequirePluginSelector(PluginSelector);
		this.LogMessage(`Reloading plugin "${ValidatedPluginSelector}".`);

		let ReloadedPlugin = null;
		try {
			ReloadedPlugin = this.PluginManager.ReloadPlugin(ValidatedPluginSelector);
		} catch (PluginLifecycleError) {
			this.LogPluginError("reload", ValidatedPluginSelector, PluginLifecycleError);
			return null;
		}

		const strReloadedPluginName = GetPluginInstanceName(ReloadedPlugin, "ReloadedPlugin");
		this.LogMessage(`Plugin "${strReloadedPluginName}" has been reloaded.`);

		return ReloadedPlugin;
	}

	PrintPlugins() {
		const PluginManager = this.PluginManager;
		const vecPluginRecords = PluginManager.GetPluginRecords();
		const vecPluginLines = [];
		if (!Array.isArray(vecPluginRecords)) {
			throw new TypeError("PluginManager.GetPluginRecords() must return an array.");
		}

		for (const PluginRecord of vecPluginRecords) {
			if ((PluginRecord === null) || (typeof PluginRecord !== "object")) {
				throw new TypeError("PluginManager.GetPluginRecords() must contain plugin record objects.");
			}

			const unPluginIndex = PluginRecord.Index;
			const strPluginName = PluginRecord.Name;
			const bPluginLoaded = PluginRecord.Loaded;
			const bPluginEnabled = PluginRecord.Enabled;
			const strPluginEntry = PluginRecord.Entry;
			if (!Number.isSafeInteger(unPluginIndex) || (unPluginIndex <= 0)) {
				throw new TypeError("PluginRecord.Index must be a positive safe integer.");
			}

			if ((typeof strPluginName !== "string") || (strPluginName.length === 0)) {
				throw new TypeError("PluginRecord.Name must be a non-empty string.");
			}

			if ((typeof bPluginLoaded !== "boolean") || (typeof bPluginEnabled !== "boolean")) {
				throw new TypeError("PluginRecord.Loaded and Enabled fields must be booleans.");
			}

			if ((typeof strPluginEntry !== "string") || (strPluginEntry.length === 0)) {
				throw new TypeError("PluginRecord.Entry must be a non-empty string.");
			}

			const PluginInformation = PluginManager.GetPluginInfo(strPluginName);
			if ((PluginInformation === null) || (typeof PluginInformation !== "object")) {
				throw new TypeError("PluginManager.GetPluginInfo() must return a plugin information object.");
			}

			const strPluginVerboseName = PluginInformation.VerboseName;
			const strPluginDescription = PluginInformation.Description;
			if ((typeof strPluginVerboseName !== "string") || (strPluginVerboseName.length === 0)) {
				throw new TypeError("PluginInfo.VerboseName must be a non-empty string.");
			}

			if ((strPluginDescription !== null) && (typeof strPluginDescription !== "string")) {
				throw new TypeError("PluginInfo.Description must be a string or null.");
			}

			const strPluginLoadedText = bPluginLoaded ? "loaded" : "unloaded";
			const strPluginEnabledText = bPluginEnabled ? "enabled" : "disabled";
			const strPluginStatusText = `${strPluginLoadedText}, ${strPluginEnabledText}`;
			const strPluginDescriptionText = ((strPluginDescription === null) || (strPluginDescription.length === 0)) ? strPluginEntry : strPluginDescription;
			vecPluginLines.push(`${unPluginIndex}. ${strPluginName} (${strPluginVerboseName}) [${strPluginStatusText}] - ${strPluginDescriptionText}`);
		}

		const strPluginListingMessage = (vecPluginLines.length > 0) ? vecPluginLines.join("\n") : "No SourceJS plugins found.";
		this.LogMessage(strPluginListingMessage);

		return vecPluginLines;
	}

	LogMessage(strMessageText) {
		if (typeof strMessageText !== "string") {
			throw new TypeError("MessageText must be a string.");
		}

		const strMessagePrefix = this.MessagePrefix;
		const CommandLogger = this.CommandLogger;
		if (typeof strMessagePrefix !== "string") {
			throw new TypeError("MessagePrefix must be a string.");
		}

		if ((CommandLogger === null) || ((typeof CommandLogger !== "object") && (typeof CommandLogger !== "function"))) {
			throw new TypeError("CommandLogger must provide an Info function.");
		}

		const CommandLoggerInformation = CommandLogger.Info;
		if (typeof CommandLoggerInformation !== "function") {
			throw new TypeError("CommandLogger.Info must be a function.");
		}

		Reflect.apply(CommandLoggerInformation, CommandLogger, [`${strMessagePrefix}${strMessageText}`]);
	}

	LogWarning(strMessageText) {
		if (typeof strMessageText !== "string") {
			throw new TypeError("MessageText must be a string.");
		}

		const strMessagePrefix = this.MessagePrefix;
		const CommandLogger = this.CommandLogger;
		if (typeof strMessagePrefix !== "string") {
			throw new TypeError("MessagePrefix must be a string.");
		}

		if ((CommandLogger === null) || ((typeof CommandLogger !== "object") && (typeof CommandLogger !== "function"))) {
			throw new TypeError("CommandLogger must provide a Warning function.");
		}

		const CommandLoggerWarning = CommandLogger.Warning;
		if (typeof CommandLoggerWarning !== "function") {
			throw new TypeError("CommandLogger.Warning must be a function.");
		}

		Reflect.apply(CommandLoggerWarning, CommandLogger, [`${strMessagePrefix}${strMessageText}`]);
	}

	LogPluginError(strPluginAction, PluginSelector, PluginLifecycleError) {
		if ((strPluginAction !== "load") && (strPluginAction !== "unload") && (strPluginAction !== "reload")) {
			throw new TypeError("PluginAction must be load, unload or reload.");
		}

		const ValidatedPluginSelector = RequirePluginSelector(PluginSelector);

		if (!(PluginLifecycleError instanceof Error)) {
			throw new TypeError("PluginLifecycleError must be an Error.");
		}

		if (PluginLifecycleError instanceof InvalidPluginName) {
			this.LogWarning(`Invalid plugin name "${ValidatedPluginSelector}".`);
		} else if (PluginLifecycleError instanceof PluginAlreadyLoaded) {
			this.LogWarning(`Plugin "${ValidatedPluginSelector}" is already loaded.`);
		} else if (PluginLifecycleError instanceof PluginDisabled) {
			this.LogWarning(`Plugin "${ValidatedPluginSelector}" is disabled.`);
		} else if (PluginLifecycleError instanceof PluginFileNotFoundError) {
			this.LogWarning(`Plugin "${ValidatedPluginSelector}" does not exist.`);
		} else if (PluginLifecycleError instanceof PluginNotLoaded) {
			this.LogWarning(`Plugin "${ValidatedPluginSelector}" is not loaded.`);
		} else if (PluginLifecycleError instanceof PluginLoadError) {
			this.LogWarning(`Plugin "${ValidatedPluginSelector}" failed to ${strPluginAction}.`);
		} else {
			const strPluginLifecycleErrorMessage = PluginLifecycleError.message;
			const strPluginFallbackErrorMessage = `Plugin "${ValidatedPluginSelector}" failed to ${strPluginAction}.`;
			if (typeof strPluginLifecycleErrorMessage !== "string") {
				throw new TypeError("PluginLifecycleError.message must be a string.");
			}

			const strPluginWarningMessage = (strPluginLifecycleErrorMessage.length === 0) ? strPluginFallbackErrorMessage : strPluginLifecycleErrorMessage;
			this.LogWarning(strPluginWarningMessage);
		}
	}

	Dispose() {
		const vecStartingCommandRegistrations = [];
		for (const CommandRegistration of this) {
			vecStartingCommandRegistrations.push(CommandRegistration);
		}

		let FirstRegistrationCleanupError = null;
		let bHasRegistrationCleanupError = false;
		for (const CommandRegistration of vecStartingCommandRegistrations) {
			try {
				const bCommandRegistrationIsObject = (CommandRegistration !== null) && ((typeof CommandRegistration === "object") || (typeof CommandRegistration === "function"));
				if (!bCommandRegistrationIsObject) {
					throw new TypeError("Owned command registrations must be objects with an Unload function.");
				}

				const CommandRegistrationUnload = CommandRegistration.Unload;
				if (typeof CommandRegistrationUnload !== "function") {
					throw new TypeError("Owned command registrations must provide an Unload function.");
				}

				// Already-unloaded typed registrations return false and can be released.
				const bCommandRegistrationUnloaded = Reflect.apply(CommandRegistrationUnload, CommandRegistration, []);
				if (typeof bCommandRegistrationUnloaded !== "boolean") {
					throw new TypeError("CommandRegistration.Unload() must return a boolean.");
				}
			} catch (RegistrationCleanupError) {
				if (!bHasRegistrationCleanupError) {
					FirstRegistrationCleanupError = RegistrationCleanupError;
					bHasRegistrationCleanupError = true;
				}

				continue;
			}

			const nCommandRegistrationIndex = Array.prototype.indexOf.call(this, CommandRegistration);
			if (nCommandRegistrationIndex >= 0) {
				Array.prototype.splice.call(this, nCommandRegistrationIndex, 1);
			}
		}

		if (bHasRegistrationCleanupError) {
			throw FirstRegistrationCleanupError;
		}

		return true;
	}

	static get [Symbol.species]() {
		return Array;
	}
}

module.exports = { SubCommandManager };
