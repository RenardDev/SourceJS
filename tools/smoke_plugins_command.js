#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strCommandPath = g_Path.join(g_strPackageRootPath, "plugins", "command.js");
const g_strTypedCommandsPath = g_Path.join(g_strPackageRootPath, "commands", "typed.js");
const g_strLoggersPath = g_Path.join(g_strPackageRootPath, "loggers.js");
const g_strPluginManagerPath = g_Path.join(g_strPackageRootPath, "plugins", "manager.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "plugins-command.md");
const g_vecTypedCommandRegistrations = [];
const g_vecNativeLogMessages = [];
const g_vecPluginManagerCalls = [];
const g_mapRegistrationUnload = new Map();

function CreateHeadingAnchor(strHeadingText) {
	return strHeadingText.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strMarkdownText) {
	const vecContentsMatch = strMarkdownText.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "plugins/command contents section");

	const vecDocumentedAnchors = [];
	const vecSectionAnchors = [];
	for (const vecDocumentedAnchorMatch of vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)) {
		vecDocumentedAnchors.push(vecDocumentedAnchorMatch[1]);
	}

	for (const vecSectionHeadingMatch of strMarkdownText.matchAll(/^## (.+)$/gm)) {
		const strSectionAnchor = CreateHeadingAnchor(vecSectionHeadingMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "plugins/command contents anchors");
}

function VerifyDocumentationLinks(strMarkdownText) {
	const strDocumentationWithoutCode = strMarkdownText.replace(/```[\s\S]*?```/g, "");
	for (const vecDocumentationLinkMatch of strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strDocumentationLinkTarget = vecDocumentationLinkMatch[1];
		if (strDocumentationLinkTarget.startsWith("#") || /^[a-z]+:/i.test(strDocumentationLinkTarget)) {
			continue;
		}

		const nFragmentIndex = strDocumentationLinkTarget.indexOf("#");
		const strDocumentationLinkPathText = (nFragmentIndex < 0) ? strDocumentationLinkTarget : strDocumentationLinkTarget.slice(0, nFragmentIndex);
		const strDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strDocumentationLinkPathText);
		g_Assert.ok(g_FileSystem.existsSync(strDocumentationLinkPath), `plugins/command documentation link must exist: ${strDocumentationLinkTarget}`);
	}
}

function InstallDependency(strModulePath, ModuleExports) {
	delete require.cache[strModulePath];
	require.cache[strModulePath] = { exports: ModuleExports, filename: strModulePath, id: strModulePath, loaded: true };
}

class PluginError extends Error {
}

class InvalidPluginName extends PluginError {
}

class PluginAlreadyLoaded extends PluginError {
}

class PluginDisabled extends PluginError {
}

class PluginFileNotFoundError extends PluginError {
}

class PluginLoadError extends PluginError {
}

class PluginNotLoaded extends PluginError {
}

class PluginManagerFixture {
	constructor() {
		this.DiskNames = new Set(["hello", "metrics"]);
		this.DisabledNames = new Set();
		this.LoadedNames = ["hello", "metrics"];
	}

	GetPluginRecords() {
		g_vecPluginManagerCalls.push(["GetPluginRecords"]);

		const vecPluginRecords = [];
		for (let unLoadedPluginIndex = 0; unLoadedPluginIndex < this.LoadedNames.length; ++unLoadedPluginIndex) {
			const strLoadedPluginName = this.LoadedNames[unLoadedPluginIndex];
			vecPluginRecords.push({
				Directory: g_Path.join(g_strRepositoryRootPath, "runtime", "plugins", strLoadedPluginName),
				Enabled: true,
				Entry: g_Path.join(g_strRepositoryRootPath, "runtime", "plugins", strLoadedPluginName, "index.js"),
				Index: unLoadedPluginIndex + 1,
				Loaded: true,
				Name: strLoadedPluginName,
			});
		}

		return vecPluginRecords;
	}

	GetPluginRecord(PluginSelector) {
		const vecPluginRecords = this.GetPluginRecords();
		if (Number.isInteger(PluginSelector)) {
			const PluginRecord = vecPluginRecords[PluginSelector - 1];
			return (PluginRecord === undefined) ? null : PluginRecord;
		}

		for (const PluginRecord of vecPluginRecords) {
			if (PluginRecord.Name === PluginSelector) {
				return PluginRecord;
			}
		}

		return null;
	}

	IsPluginLoaded(PluginSelector) {
		return this.GetPluginRecord(PluginSelector) !== null;
	}

	LoadPlugin(strPluginName) {
		g_vecPluginManagerCalls.push(["LoadPlugin", strPluginName]);

		if ((typeof strPluginName !== "string") || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(strPluginName)) {
			throw new InvalidPluginName(strPluginName);
		}

		if (this.LoadedNames.includes(strPluginName)) {
			throw new PluginAlreadyLoaded(strPluginName);
		}

		if (this.DisabledNames.has(strPluginName)) {
			throw new PluginDisabled(strPluginName);
		}

		if (!this.DiskNames.has(strPluginName)) {
			throw new PluginFileNotFoundError(strPluginName);
		}

		if (strPluginName === "broken") {
			throw new PluginLoadError(strPluginName);
		}

		this.LoadedNames.push(strPluginName);

		return { Name: strPluginName };
	}

	UnloadPlugin(PluginSelector) {
		g_vecPluginManagerCalls.push(["UnloadPlugin", PluginSelector]);

		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord === null) {
			throw new PluginNotLoaded(String(PluginSelector));
		}

		this.LoadedNames.splice(this.LoadedNames.indexOf(PluginRecord.Name), 1);

		return true;
	}

	ReloadPlugin(PluginSelector) {
		g_vecPluginManagerCalls.push(["ReloadPlugin", PluginSelector]);

		const PluginRecord = this.GetPluginRecord(PluginSelector);
		if (PluginRecord === null) {
			throw new PluginNotLoaded(String(PluginSelector));
		}

		this.LoadedNames.splice(this.LoadedNames.indexOf(PluginRecord.Name), 1);

		return this.LoadPlugin(PluginRecord.Name);
	}

	GetPluginInfo(strPluginName) {
		g_vecPluginManagerCalls.push(["GetPluginInfo", strPluginName]);

		return { Description: (strPluginName === "hello") ? "SourceJS greeting example" : "Runtime metrics example", VerboseName: (strPluginName === "hello") ? "Hello" : "Metrics" };
	}
}

const g_PluginManager = new PluginManagerFixture();

function CreateTypedRegistration(strCommandKind, vecCommandNames, RegistrationOptions) {
	const TypedRegistration = {
		Callback: null,
		Commands: vecCommandNames,
		Kind: strCommandKind,
		Options: RegistrationOptions,
		Registered: false,
		UnloadCount: 0,

		Register(CommandCallback) {
			if (typeof CommandCallback !== "function") {
				throw new TypeError("Typed command callback must be a function.");
			}

			this.Callback = CommandCallback;
			this.Registered = true;

			return this;
		},

		Unload() {
			this.UnloadCount += 1;

			if (!this.Registered) {
				return false;
			}

			this.Registered = false;

			return true;
		},
	};

	g_mapRegistrationUnload.set(TypedRegistration, TypedRegistration.Unload);
	g_vecTypedCommandRegistrations.push(TypedRegistration);

	return TypedRegistration;
}

const g_TypedCommands = {
	RegisterTypedClientCommand(vecCommandNames, RegistrationOptions) {
		return CreateTypedRegistration("CLIENT", vecCommandNames, RegistrationOptions);
	},

	RegisterTypedSayCommand(vecCommandNames, RegistrationOptions) {
		return CreateTypedRegistration("SAY", vecCommandNames, RegistrationOptions);
	},

	RegisterTypedServerCommand(vecCommandNames, RegistrationOptions) {
		return CreateTypedRegistration("SERVER", vecCommandNames, RegistrationOptions);
	},
};

const g_NativeLoggers = {
	LogInfo(strMessageText) {
		g_vecNativeLogMessages.push(["INFO", strMessageText]);

		return true;
	},

	LogWarning(strMessageText) {
		g_vecNativeLogMessages.push(["WARNING", strMessageText]);

		return true;
	},
};

const g_PluginManagerModule = {
	InvalidPluginName,
	PluginAlreadyLoaded,
	PluginDisabled,
	PluginFileNotFoundError,
	PluginLoadError,
	PluginNotLoaded,
	PLUGIN_MANAGER: g_PluginManager,
};

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_mapPackageCacheDescriptors = new Map();
let g_bPackageCacheOwned = false;
for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

function RestoreModuleLoader() {
	Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
}

function RestorePackageCache() {
	if (!g_bPackageCacheOwned) {
		return;
	}

	const vecFailures = [];
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strModulePath), "Temporary command module cache entry must be removable: " + strModulePath);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
		try {
			Object.defineProperty(require.cache, strModulePath, Descriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Command module cache restoration failed.");
	}

	g_bPackageCacheOwned = false;
}

function ReleaseTypedRegistrations() {
	const vecFailures = [];
	for (const TypedRegistration of g_vecTypedCommandRegistrations) {
		try {
			if (TypedRegistration.Registered) {
				const UnloadRegistration = g_mapRegistrationUnload.get(TypedRegistration);
				g_Assert.equal(Reflect.apply(UnloadRegistration, TypedRegistration, []), true, "Active typed command registration must be released.");
			}
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Typed command registration cleanup failed.");
	}
}

function CheckSubCommandOwnership(SubCommandManager) {
	const vecOwner = new SubCommandManager(g_PluginManager, "copy_contract");
	const Registration = vecOwner.ServerSubCommand("entry");

	try {
		const vecCopies = [
			vecOwner.slice(),
			vecOwner.map((CurrentRegistration) => CurrentRegistration),
			vecOwner.filter(() => true),
		];
		for (const vecCopy of vecCopies) {
			g_Assert.equal(Object.getPrototypeOf(vecCopy), Array.prototype, "command copies are ordinary arrays");
			g_Assert.equal(vecCopy[0], Registration, "command copies share the original registration reference");
			vecCopy.length = 0;
			g_Assert.equal(vecOwner.length, 1, "clearing a copy does not remove owned registrations");
			g_Assert.equal(vecOwner[0], Registration, "copy mutation preserves the owner entry");
			g_Assert.equal(Registration.UnloadCount, 0, "copy mutation does not unload the registration");
		}
	} finally {
		g_Assert.equal(vecOwner.Dispose(), true, "copy-contract owner is explicitly disposed");
	}

	g_Assert.equal(Registration.UnloadCount, 1, "only the original owner disposes the registration");

	const vecReentrantOwner = new SubCommandManager(g_PluginManager, "snapshot_contract");
	let unAddedRegistrationUnloadCount = 0;
	const AddedRegistration = {
		Unload() {
			unAddedRegistrationUnloadCount += 1;

			return true;
		},
	};

	const StartingRegistration = {
		Unload() {
			vecReentrantOwner.push(AddedRegistration);

			return true;
		},
	};
	vecReentrantOwner.push(StartingRegistration);

	try {
		g_Assert.equal(vecReentrantOwner.Dispose(), true, "disposal processes its initial snapshot");
		g_Assert.equal(unAddedRegistrationUnloadCount, 0, "reentrant additions are outside the snapshot");
		g_Assert.equal(vecReentrantOwner.length, 1, "successful snapshot disposal may retain a new owner entry");
		g_Assert.equal(vecReentrantOwner[0], AddedRegistration, "the reentrant registration remains owned");
	} finally {
		g_Assert.equal(vecReentrantOwner.Dispose(), true, "reentrant registration is disposed in a later snapshot");
	}

	g_Assert.equal(unAddedRegistrationUnloadCount, 1, "later disposal releases the retained registration once");
	g_Assert.equal(vecReentrantOwner.length, 0, "reentrant owner cleanup completes");
}

let g_ReleaseDocumentation = null;

function ReleaseDocumentationOwner() {
	if (g_ReleaseDocumentation === null) {
		return;
	}

	g_ReleaseDocumentation();
}

let g_PrimaryError = null;
let g_bHasPrimaryError = false;

try {
	// Foreign cache entries and the Node loader are borrowed, not fixture state.
	for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed command cache entries must support exact restoration.");
	}

	g_bPackageCacheOwned = true;
	InstallDependency(g_strTypedCommandsPath, g_TypedCommands);
	InstallDependency(g_strLoggersPath, g_NativeLoggers);
	InstallDependency(g_strPluginManagerPath, g_PluginManagerModule);
	delete require.cache[g_strCommandPath];

	const g_OriginalModuleLoad = g_ModuleLoadDescriptor.value;
	g_Module._load = function LoadModule(strRequest) {
		if (strRequest === "commands/typed") {
			return require(g_strTypedCommandsPath);
		}

		if (strRequest === "loggers") {
			return require(g_strLoggersPath);
		}

		if (strRequest === "plugins/manager") {
			return require(g_strPluginManagerPath);
		}

		return g_OriginalModuleLoad.apply(this, arguments);
	};

	const { SubCommandManager } = require(g_strCommandPath);
	RestoreModuleLoader();

	g_Assert.deepEqual(Object.keys(require(g_strCommandPath)), ["SubCommandManager"], "plugins/command exact exports");

	const g_vecSubCommandRegistrations = new SubCommandManager(g_PluginManager, "sjs_tools", { Prefix: "[Tools] " });
	const g_vecServerCommandNames = ["plugins", "list"];
	const g_ClientCommandOptions = { Description: "Reload a plugin." };

	g_Assert.equal(g_vecSubCommandRegistrations.CommandName, "sjs_tools", "command name field");
	g_Assert.equal(g_vecSubCommandRegistrations.MessagePrefix, "[Tools] ", "message prefix field");

	const g_ServerCommandRegistration = g_vecSubCommandRegistrations.ServerSubCommand(g_vecServerCommandNames, { Description: "List plugins." });
	const g_ClientCommandRegistration = g_vecSubCommandRegistrations.ClientSubCommand("reload", "sourcejs.plugins", g_ClientCommandOptions);
	const g_SayCommandRegistration = g_vecSubCommandRegistrations.SaySubCommand("count", null, { Description: "Count plugins." });

	g_vecServerCommandNames.push("unexpected");

	g_Assert.deepEqual(g_ServerCommandRegistration.Commands, ["sjs_tools", "plugins", "list"], "server subcommand path");
	g_Assert.deepEqual(g_ClientCommandRegistration.Commands, ["sjs_tools", "reload"], "client subcommand path");
	g_Assert.equal(g_ClientCommandRegistration.Options.Permission, "sourcejs.plugins", "client permission");
	g_Assert.equal(Object.getPrototypeOf(g_ClientCommandRegistration.Options), null, "client permission options use a prototype-safe owned record");
	g_Assert.deepEqual(g_ClientCommandOptions, { Description: "Reload a plugin." }, "client permission options preserve the caller record");
	g_Assert.deepEqual(g_SayCommandRegistration.Commands, ["sjs_tools", "count"], "say subcommand path");
	g_Assert.equal(g_vecSubCommandRegistrations.length, 3, "manager owns every typed registration.");
	g_Assert.throws(() => g_vecSubCommandRegistrations.ServerSubCommand(7), /non-empty strings/, "subcommands reject numeric paths.");
	g_Assert.ok(g_vecSubCommandRegistrations.slice() instanceof Array, "derived collection operations return ordinary arrays.");
	g_Assert.ok(!(g_vecSubCommandRegistrations.slice() instanceof SubCommandManager), "derived collection operations do not invoke the public constructor.");

	let g_unPrefixReadCount = 0;
	const g_OneReadCommandOptions = {
		get Prefix() {
			g_unPrefixReadCount += 1;

			return "[One Read] ";
		},
	};
	const g_vecOneReadSubCommands = new SubCommandManager(g_PluginManager, "one_read", g_OneReadCommandOptions);
	g_Assert.equal(g_vecOneReadSubCommands.MessagePrefix, "[One Read] ", "constructor preserves the owned prefix value.");
	g_Assert.equal(g_unPrefixReadCount, 1, "constructor reads the prefix option once.");
	g_Assert.throws(() => new SubCommandManager(g_PluginManager, "invalid", Object.create({ Prefix: "[Inherited] " })), /plain object/, "constructor rejects inherited option containers.");

	g_ServerCommandRegistration.Register(() => true);
	g_ClientCommandRegistration.Register(() => true);
	g_SayCommandRegistration.Register(() => true);

	g_Assert.equal(g_vecSubCommandRegistrations.Dispose(), true, "dispose result");
	g_Assert.equal(g_vecSubCommandRegistrations.length, 0, "dispose clears registrations.");
	g_Assert.deepEqual([g_ServerCommandRegistration.UnloadCount, g_ClientCommandRegistration.UnloadCount, g_SayCommandRegistration.UnloadCount], [1, 1, 1], "dispose calls registration.Unload.");

	const g_vecResilientSubCommands = new SubCommandManager(g_PluginManager, "resilient");
	const g_FirstRegistrationCleanupError = new Error("first unload failed");
	let g_bShouldFailFirstRegistrationCleanup = true;
	let g_bSuccessfulRegistrationCleanupCalled = false;
	const g_RetryableCommandRegistration = {
		Unload() {
			if (g_bShouldFailFirstRegistrationCleanup) {
				g_bShouldFailFirstRegistrationCleanup = false;
				throw g_FirstRegistrationCleanupError;
			}

			return true;
		},
	};

	const g_SuccessfulCommandRegistration = {
		Unload() {
			g_bSuccessfulRegistrationCleanupCalled = true;

			return true;
		},
	};

	g_vecResilientSubCommands.push(g_RetryableCommandRegistration, g_SuccessfulCommandRegistration);

	g_Assert.throws(() => g_vecResilientSubCommands.Dispose(), (ThrownError) => ThrownError === g_FirstRegistrationCleanupError, "dispose rethrows the first cleanup error.");
	g_Assert.equal(g_bSuccessfulRegistrationCleanupCalled, true, "dispose continues cleanup after an error.");
	g_Assert.equal(g_vecResilientSubCommands.length, 1, "failed dispose retains only registrations that still require cleanup.");
	g_Assert.equal(g_vecResilientSubCommands[0], g_RetryableCommandRegistration, "failed dispose retains the exact registration for retry.");
	g_Assert.equal(g_vecResilientSubCommands.Dispose(), true, "dispose retries retained registration cleanup.");
	g_Assert.equal(g_vecResilientSubCommands.length, 0, "successful retry clears the retained registration.");

	g_Assert.equal(g_vecSubCommandRegistrations.LoadPlugin("hello"), null, "LoadPlugin maps PluginAlreadyLoaded to null.");
	g_Assert.equal(g_vecSubCommandRegistrations.UnloadPlugin("hello"), true, "UnloadPlugin success");
	g_Assert.equal(g_vecSubCommandRegistrations.ReloadPlugin("hello"), null, "ReloadPlugin maps PluginNotLoaded to null.");
	g_Assert.equal(g_vecSubCommandRegistrations.LoadPlugin("hello").Name, "hello", "LoadPlugin success");
	g_Assert.equal(g_vecSubCommandRegistrations.ReloadPlugin("hello").Name, "hello", "ReloadPlugin success");

	const g_vecPluginListingLines = g_vecSubCommandRegistrations.PrintPlugins();
	let g_bHelloPluginListed = false;
	for (const strPluginListingLine of g_vecPluginListingLines) {
		if (strPluginListingLine.includes("hello (Hello)")) {
			g_bHelloPluginListed = true;
		}
	}

	g_Assert.equal(g_bHelloPluginListed, true, "PrintPlugins includes manifest information.");
	g_Assert.throws(() => g_vecSubCommandRegistrations.LoadPlugin(1), /PluginName/, "LoadPlugin rejects numeric selectors.");
	g_Assert.throws(() => g_vecSubCommandRegistrations.UnloadPlugin(0), /PluginSelector/, "UnloadPlugin rejects zero selectors.");
	g_Assert.throws(() => g_vecSubCommandRegistrations.ReloadPlugin(-1), /PluginSelector/, "ReloadPlugin rejects negative selectors.");

	const g_vecFalseUnloadSubCommands = new SubCommandManager({
		UnloadPlugin() {
			return false;
		},
	}, "false_unload");

	const g_vecInvalidUnloadResultSubCommands = new SubCommandManager({
		UnloadPlugin() {
			return "unloaded";
		},
	}, "invalid_unload_result");

	const g_vecMalformedPluginResultSubCommands = new SubCommandManager({
		LoadPlugin() {
			return null;
		},

		ReloadPlugin() {
			return { Name: "" };
		},
	}, "malformed_plugin_result");

	g_Assert.equal(g_vecFalseUnloadSubCommands.UnloadPlugin("hello"), false, "UnloadPlugin forwards an exact false result.");
	g_Assert.throws(() => g_vecInvalidUnloadResultSubCommands.UnloadPlugin("hello"), /return a boolean/, "UnloadPlugin rejects a non-boolean manager result.");
	g_Assert.throws(() => g_vecMalformedPluginResultSubCommands.LoadPlugin("hello"), /plugin instance object/, "LoadPlugin rejects a malformed returned plugin.");
	g_Assert.throws(() => g_vecMalformedPluginResultSubCommands.ReloadPlugin("hello"), /Name must be a non-empty string/, "ReloadPlugin rejects a malformed returned plugin name.");

	const g_vecInvalidDisposeSubCommands = new SubCommandManager(g_PluginManager, "invalid_dispose");
	const g_InvalidDisposeCommandRegistration = {
		Unload() {
			return "unloaded";
		},
	};

	g_vecInvalidDisposeSubCommands.push(g_InvalidDisposeCommandRegistration);

	g_Assert.throws(() => g_vecInvalidDisposeSubCommands.Dispose(), /return a boolean/, "Dispose rejects non-boolean cleanup results.");
	g_Assert.equal(g_vecInvalidDisposeSubCommands[0], g_InvalidDisposeCommandRegistration, "Dispose retains malformed cleanup ownership.");

	g_InvalidDisposeCommandRegistration.Unload = function UnloadCommandRegistration() {
		return true;
	};

	g_Assert.equal(g_vecInvalidDisposeSubCommands.Dispose(), true, "Dispose retries corrected cleanup state.");

	const g_vecCommandLoggerMessages = [];
	let g_unCommandLoggerInformationReadCount = 0;
	let g_unCommandLoggerWarningReadCount = 0;

	const g_CommandLogger = {
		get Info() {
			g_unCommandLoggerInformationReadCount += 1;

			return function WriteCommandInformation(strMessageText) {
				g_Assert.equal(this, g_CommandLogger, "LogMessage preserves the command logger receiver.");
				g_vecCommandLoggerMessages.push(["INFO", strMessageText]);
			};
		},

		get Warning() {
			g_unCommandLoggerWarningReadCount += 1;

			return function WriteCommandWarning(strMessageText) {
				g_Assert.equal(this, g_CommandLogger, "LogWarning preserves the command logger receiver.");
				g_vecCommandLoggerMessages.push(["WARNING", strMessageText]);
			};
		},
	};

	const g_vecLiveLoggerSubCommands = new SubCommandManager(g_PluginManager, "live_logger");
	g_vecLiveLoggerSubCommands.CommandLogger = g_CommandLogger;
	g_vecLiveLoggerSubCommands.MessagePrefix = "[Live] ";

	g_Assert.equal(g_vecLiveLoggerSubCommands.LogMessage("ready"), undefined, "LogMessage returns undefined.");
	g_Assert.equal(g_vecLiveLoggerSubCommands.LogWarning("careful"), undefined, "LogWarning returns undefined.");
	g_Assert.equal(g_unCommandLoggerInformationReadCount, 1, "LogMessage reads the live Info method once.");
	g_Assert.equal(g_unCommandLoggerWarningReadCount, 1, "LogWarning reads the live Warning method once.");
	g_Assert.deepEqual(g_vecCommandLoggerMessages, [["INFO", "[Live] ready"], ["WARNING", "[Live] careful"]], "live logger calls");

	g_Assert.equal(g_vecSubCommandRegistrations.LogMessage("maintenance"), undefined, "LogMessage result");
	g_Assert.equal(g_vecSubCommandRegistrations.LogWarning("careful"), undefined, "LogWarning result");
	g_Assert.throws(() => g_vecSubCommandRegistrations.LogPluginError("remove", "hello", new Error("invalid action")), /PluginAction/, "LogPluginError rejects unsupported actions.");
	g_Assert.throws(() => g_vecSubCommandRegistrations.LogPluginError("load", "hello", {}), /must be an Error/, "LogPluginError rejects non-Error lifecycle failures.");

	const g_MalformedPluginLifecycleError = new Error("invalid message");
	g_MalformedPluginLifecycleError.message = 7;
	g_Assert.throws(() => g_vecSubCommandRegistrations.LogPluginError("load", "hello", g_MalformedPluginLifecycleError), /message must be a string/, "LogPluginError rejects a malformed live Error message.");

	for (const PluginLifecycleError of [
		new InvalidPluginName(),
		new PluginAlreadyLoaded(),
		new PluginDisabled(),
		new PluginFileNotFoundError(),
		new PluginNotLoaded(),
		new PluginLoadError(),
		new Error("native failure"),
	]) {
		g_vecSubCommandRegistrations.LogPluginError("load", "hello", PluginLifecycleError);
	}

	g_vecPluginManagerCalls.length = 0;
	g_vecNativeLogMessages.length = 0;

	CheckSubCommandOwnership(SubCommandManager);

	const g_unDocumentationRegistrationStartIndex = g_vecTypedCommandRegistrations.length;
	const g_strPluginsCommandDocumentationText = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationCodeBlocks = [];
	for (const vecDocumentationCodeBlockMatch of g_strPluginsCommandDocumentationText.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
	}

	function DocumentationRequire(strRequestedModuleName) {
		if (strRequestedModuleName === "loggers") {
			return g_NativeLoggers;
		}

		if (strRequestedModuleName === "plugins/command") {
			return { SubCommandManager };
		}

		if (strRequestedModuleName === "plugins/manager") {
			return g_PluginManagerModule;
		}

		throw new Error(`unexpected plugins/command documentation module ${strRequestedModuleName}`);
	}

	g_Assert.equal(g_vecDocumentationCodeBlocks.length, 6, "plugins/command documentation workflow count");
	g_Assert.ok(!g_strPluginsCommandDocumentationText.includes("Generated by"), "plugins/command documentation must be maintained by hand.");
	g_Assert.ok(g_strPluginsCommandDocumentationText.includes("does not replace the native `sjs plugins ...` command"), "plugins/command docs must distinguish built-in commands.");
	g_Assert.ok(g_strPluginsCommandDocumentationText.includes("calls `Unload()` on each snapshot entry"), "plugins/command docs must describe snapshot cleanup.");
	g_Assert.ok(g_strPluginsCommandDocumentationText.includes("ordinary arrays containing the same registration objects"), "plugins/command docs must distinguish array copies from owners.");
	g_Assert.ok(g_strPluginsCommandDocumentationText.includes("Registrations added reentrantly during cleanup remain outside the snapshot."), "plugins/command docs must not promise disposal of reentrant additions.");
	g_Assert.ok(g_strPluginsCommandDocumentationText.includes("does not filter `Loaded` or `Enabled`"), "plugins/command docs must not invent record filtering.");
	g_Assert.ok(!g_strPluginsCommandDocumentationText.includes("console."), "plugins/command documentation must not depend on console-only inspection.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strPluginsCommandDocumentationText), "plugins/command documentation must remain valid ASCII.");
	VerifyContentsAnchors(g_strPluginsCommandDocumentationText);
	VerifyDocumentationLinks(g_strPluginsCommandDocumentationText);

	const g_unDocumentationTimeoutMilliseconds = 1000;
	const g_vecDocumentationModuleRecords = [];
	const g_CommandPrototypeDescriptors = Object.getOwnPropertyDescriptors(SubCommandManager.prototype);
	const g_PluginFixtureDescriptors = Object.getOwnPropertyDescriptors(g_PluginManager);
	const g_vecStartingLoadedNames = g_PluginManager.LoadedNames.slice();
	const g_vecStartingDiskNames = [...g_PluginManager.DiskNames];
	const g_vecStartingDisabledNames = [...g_PluginManager.DisabledNames];

	g_ReleaseDocumentation = () => {
		const vecFailures = [];
		for (const [Target, Descriptors] of [[SubCommandManager.prototype, g_CommandPrototypeDescriptors], [g_PluginManager, g_PluginFixtureDescriptors]]) {
			for (const strName of Object.getOwnPropertyNames(Target)) {
				if (!Object.hasOwn(Descriptors, strName)) {
					try {
						g_Assert.ok(Reflect.deleteProperty(Target, strName), "Temporary command fixture property must be removable: " + strName);
					} catch (Failure) {
						vecFailures.push(Failure);
					}
				}
			}

			for (const strName of Object.keys(Descriptors)) {
				try {
					Object.defineProperty(Target, strName, Descriptors[strName]);
				} catch (Failure) {
					vecFailures.push(Failure);
				}
			}
		}

		for (const DocumentationModuleRecord of g_vecDocumentationModuleRecords) {
			try {
				if (typeof DocumentationModuleRecord.exports.Unload === "function") {
					// Inactive owners may return false; ReleaseTypedRegistrations independently verifies release.
					g_VM.runInNewContext("ReleaseDocumentationModule();", { ReleaseDocumentationModule: () => DocumentationModuleRecord.exports.Unload() }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
				}
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		g_PluginManager.LoadedNames.splice(0, g_PluginManager.LoadedNames.length, ...g_vecStartingLoadedNames);
		for (const [setNames, vecStartingNames] of [[g_PluginManager.DiskNames, g_vecStartingDiskNames], [g_PluginManager.DisabledNames, g_vecStartingDisabledNames]]) {
			setNames.clear();
			for (const strName of vecStartingNames) {
				setNames.add(strName);
			}
		}

		if (vecFailures.length > 0) {
			throw new AggregateError(vecFailures, "Command documentation cleanup failed.");
		}
	};

	function CompileDocumentationModule(strJavaScript, unBlockIndex) {
		const strFileName = g_strDocumentationPath + ":" + (unBlockIndex + 1);
		const DocumentationModuleRecord = new g_Module(strFileName, module);
		DocumentationModuleRecord.filename = strFileName;
		DocumentationModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
		DocumentationModuleRecord.require = DocumentationRequire;
		// Acquire before compilation so partially executed modules also have an owner.
		g_vecDocumentationModuleRecords.push(DocumentationModuleRecord);
		DocumentationModuleRecord._compile(strJavaScript, strFileName);

		return DocumentationModuleRecord;
	}

	const g_RunDocumentationWorkflows = () => {
		const vecDocumentationModuleExports = [];
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecDocumentationCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const DocumentationModuleRecord = CompileDocumentationModule(g_vecDocumentationCodeBlocks[unDocumentationCodeBlockIndex], unDocumentationCodeBlockIndex);
			vecDocumentationModuleExports.push(DocumentationModuleRecord.exports);
		}

		g_Assert.equal(g_vecTypedCommandRegistrations.length, g_unDocumentationRegistrationStartIndex, "plugins/command examples must not create registrations during block load");
		g_Assert.equal(g_vecPluginManagerCalls.length, 0, "plugins/command examples must not query or mutate plugins during block load");
		g_Assert.equal(g_vecNativeLogMessages.length, 0, "plugins/command examples must not log during block load");

		const CreatedCommandController = vecDocumentationModuleExports[1].CreateToolsCommandManager();
		g_Assert.equal(CreatedCommandController.CommandName, "sjs_tools", "documented command name");
		g_Assert.equal(CreatedCommandController.MessagePrefix, "[SourceJS Tools] ", "documented message prefix");
		g_Assert.equal(CreatedCommandController.Commands.PluginManager, g_PluginManager, "documented plugin manager field");
		g_Assert.deepEqual(vecDocumentationModuleExports[1].ReconfigureCommandManager(CreatedCommandController.Commands, "sjs_admin", "[Admin] "), { CommandName: "sjs_admin", MessagePrefix: "[Admin] " }, "documented writable command fields");

		const Lifecycle = vecDocumentationModuleExports[2];
		g_Assert.equal(typeof Lifecycle.Load, "function", "controller exports the canonical SourceJS Load key");
		g_Assert.equal(typeof Lifecycle.Unload, "function", "controller exports the canonical SourceJS Unload key");
		g_Assert.equal(Object.hasOwn(Lifecycle, "load"), false, "controller has no lowercase Load alias");
		g_Assert.equal(Object.hasOwn(Lifecycle, "unload"), false, "controller has no lowercase Unload alias");
		g_Assert.ok(Lifecycle.Load(), "documented typed subcommand load");

		const vecDocumentedCommandRegistrations = g_vecTypedCommandRegistrations.slice(g_unDocumentationRegistrationStartIndex);
		const vecDocumentedReplies = [];
		g_Assert.equal(vecDocumentedCommandRegistrations.length, 3, "documented typed registration count");

		for (const DocumentedCommandRegistration of vecDocumentedCommandRegistrations) {
			const DocumentedCommandContext = {
				Reply(strMessageText) {
					vecDocumentedReplies.push(strMessageText);
				},
			};

			if (DocumentedCommandRegistration.Kind === "CLIENT") {
				DocumentedCommandRegistration.Callback(DocumentedCommandContext, "hello");
			} else {
				DocumentedCommandRegistration.Callback(DocumentedCommandContext);
			}
		}

		let bDocumentedClientReplyFound = false;
		let bDocumentedSayReplyFound = false;
		for (const strDocumentedReplyMessage of vecDocumentedReplies) {
			if (strDocumentedReplyMessage === "Reloaded hello.") {
				bDocumentedClientReplyFound = true;
			}

			if (strDocumentedReplyMessage === "2 plugin(s) loaded.") {
				bDocumentedSayReplyFound = true;
			}
		}

		g_Assert.equal(bDocumentedClientReplyFound, true, "documented client subcommand reply");
		g_Assert.equal(bDocumentedSayReplyFound, true, "documented say subcommand reply");
		g_Assert.ok(vecDocumentationModuleExports[2].Unload(), "documented typed subcommand cleanup");

		for (const DocumentedCommandRegistration of vecDocumentedCommandRegistrations) {
			g_Assert.equal(DocumentedCommandRegistration.Registered, false, "documented registrations unload");
		}

		g_Assert.deepEqual(vecDocumentationModuleExports[3].CyclePluginLifecycle("hello"), { Loaded: "hello", Reloaded: "hello", Restored: "hello" }, "documented plugin lifecycle cycle");

		const DocumentedPluginListing = vecDocumentationModuleExports[4].InspectPluginListing();
		g_Assert.equal(DocumentedPluginListing.Lines.length, 2, "documented plugin listing lines");
		g_Assert.equal(DocumentedPluginListing.Messages.length, 1, "documented prefixed listing message");

		const DocumentedControllerLogging = vecDocumentationModuleExports[5].InspectControllerLogging();
		g_Assert.deepEqual(DocumentedControllerLogging.InfoMessages, ["[SJS_TOOLS] Plugin maintenance started."], "documented informational logging");
		g_Assert.deepEqual(DocumentedControllerLogging.WarningMessages, ["[SJS_TOOLS] Reloading plugins interrupts their callbacks.", "[SJS_TOOLS] Plugin \"missing-plugin\" is not loaded."], "documented warning logging");
		g_Assert.equal(g_PluginManager.IsPluginLoaded("hello"), true, "documentation restores the hello plugin.");

		const vecDocumentationReconfigurationOwner = new SubCommandManager(g_PluginManager, "sjs_tools");
		vecDocumentationReconfigurationOwner.ServerSubCommand("held");
		g_Assert.throws(() => vecDocumentationModuleExports[1].ReconfigureCommandManager(vecDocumentationReconfigurationOwner, "sjs_admin", "[Admin] "), /empty SubCommandManager/, "cannot pretend reconfiguration renames owned paths");
		g_Assert.equal(vecDocumentationReconfigurationOwner.CommandName, "sjs_tools", "failed reconfiguration preserves root");
		g_Assert.equal(vecDocumentationReconfigurationOwner.Dispose(), true, "reconfiguration probe cleanup");

		const OriginalDocumentationSubCommandFactory = SubCommandManager.prototype.ServerSubCommand;
		const OriginalDocumentationDisposal = SubCommandManager.prototype.Dispose;
		for (const CleanupFailure of [new Error("cleanup failed"), null, undefined]) {
			const RegistrationFailure = new Error("registration failed");
			SubCommandManager.prototype.ServerSubCommand = () => {
				throw RegistrationFailure;
			};
			SubCommandManager.prototype.Dispose = () => {
				throw CleanupFailure;
			};

			try {
				g_Assert.throws(() => vecDocumentationModuleExports[2].Load(), (Failure) => (Failure instanceof AggregateError) && (Failure.errors.length === 2) && (Failure.errors[0] === RegistrationFailure) && (Failure.errors[1] === CleanupFailure), "documented load preserves registration and cleanup failures in order");
				g_Assert.throws(() => vecDocumentationModuleExports[2].Load(), /already loaded/, "failed cleanup retains owner for retry");
			} finally {
				SubCommandManager.prototype.ServerSubCommand = OriginalDocumentationSubCommandFactory;
				SubCommandManager.prototype.Dispose = OriginalDocumentationDisposal;
				// Dispose is restored before this retry; the following false result verifies the owner was cleared.
				vecDocumentationModuleExports[2].Unload();
			}

			g_Assert.equal(vecDocumentationModuleExports[2].Unload(), false, "retry cleared documented owner");
		}

		for (const TypedCommandRegistration of g_vecTypedCommandRegistrations) {
			g_Assert.equal(TypedCommandRegistration.Registered, false, "documentation unloads every typed registration.");
		}

		// Load the real metadata class with a filesystem double that reports no manifest.
		const strPluginInformationPath = g_Path.join(g_strPackageRootPath, "plugins", "info.js");
		const PluginInformationIntegrationModule = new g_Module(strPluginInformationPath, module);
		PluginInformationIntegrationModule.filename = strPluginInformationPath;
		PluginInformationIntegrationModule.paths = g_Module._nodeModulePaths(g_Path.dirname(strPluginInformationPath));
		PluginInformationIntegrationModule.require = (strModuleName) => {
			if (strModuleName !== "filesystem") {
				throw new Error(`Unexpected metadata integration dependency: ${strModuleName}.`);
			}

			return { DoesFileExist: () => false };
		};
		PluginInformationIntegrationModule._compile(g_FileSystem.readFileSync(strPluginInformationPath, "utf8"), strPluginInformationPath);

		const { PluginInfo } = PluginInformationIntegrationModule.exports;
		const OriginalInformationListing = g_PluginManager.GetPluginInfo;
		const vecMissingManifestMessages = [];
		g_PluginManager.GetPluginInfo = (strPluginName) => {
			const PluginRecord = g_PluginManager.GetPluginRecords().find((PluginRecord) => PluginRecord.Name === strPluginName);
			const Information = PluginInfo.FromRecord(PluginRecord);
			g_Assert.equal(Information.Description, null, "real manifest-less metadata has no description");

			return Information;
		};

		try {
			const vecCommands = new SubCommandManager(g_PluginManager, "sjs_tools", {
				Logger: { Info: (strMessage) => vecMissingManifestMessages.push(strMessage), Warning: () => {} },
			});
			const vecListing = vecCommands.PrintPlugins();
			const vecRecords = g_PluginManager.GetPluginRecords();
			g_Assert.equal(vecListing.length, vecRecords.length, "real manifest-less metadata renders every current record");
			for (let unRecordIndex = 0; unRecordIndex < vecRecords.length; ++unRecordIndex) {
				g_Assert.ok(vecListing[unRecordIndex].endsWith(` - ${vecRecords[unRecordIndex].Entry}`), "null description uses record entry without changing metadata");
			}

			g_Assert.equal(vecMissingManifestMessages.length, 1, "manifest-less listing logs one complete message");

			for (const strDescription of ["", "Current description"]) {
				g_PluginManager.GetPluginInfo = (strPluginName) => {
					const PluginRecord = vecRecords.find((PluginRecord) => PluginRecord.Name === strPluginName);
					const Information = PluginInfo.FromRecord(PluginRecord);
					Information.Description = strDescription;

					return Information;
				};

				const vecDescriptionListing = vecCommands.PrintPlugins();
				for (let unRecordIndex = 0; unRecordIndex < vecRecords.length; ++unRecordIndex) {
					const strExpectedDescription = (strDescription.length === 0) ? vecRecords[unRecordIndex].Entry : strDescription;
					g_Assert.ok(vecDescriptionListing[unRecordIndex].endsWith(` - ${strExpectedDescription}`), "empty and non-empty descriptions preserve listing behavior");
				}
			}

			for (const Description of [
				undefined,
				true,
				0,
				{},
				[],
			]) {
				g_PluginManager.GetPluginInfo = (strPluginName) => {
					const PluginRecord = vecRecords.find((PluginRecord) => PluginRecord.Name === strPluginName);
					const Information = PluginInfo.FromRecord(PluginRecord);
					Information.Description = Description;

					return Information;
				};

				g_Assert.throws(() => vecCommands.PrintPlugins(), TypeError, "nullable descriptions do not permit other invalid types");
			}

			g_Assert.equal(vecMissingManifestMessages.length, 3, "invalid description listings do not log successful output");
		} finally {
			g_PluginManager.GetPluginInfo = OriginalInformationListing;
		}

		const strPluginCommandSource = g_FileSystem.readFileSync(g_strCommandPath, "utf8");
		for (const strRequiredSourceContract of [
			"BuildSubCommandPath(this.CommandName, CommandNames)",
			"CreatePermissionRegistrationOptions(CommandOptions, strRequiredPermission)",
			"RegisterTypedServerCommand(vecCommandPath, RegistrationOptions)",
			"RegisterTypedClientCommand(vecCommandPath, RegistrationOptions)",
			"RegisterTypedSayCommand(vecCommandPath, RegistrationOptions)",
			"Reflect.apply(CommandRegistrationUnload, CommandRegistration, [])",
			"throw FirstRegistrationCleanupError",
		]) {
			g_Assert.ok(strPluginCommandSource.includes(strRequiredSourceContract), `plugins/command contract missing: ${strRequiredSourceContract}`);
		}

		g_Assert.ok(!strPluginCommandSource.includes("registration.dispose()"), "plugins/command must call the real typed-registration cleanup method.");
	};
	g_VM.runInNewContext("RunDocumentationWorkflows();", { RunDocumentationWorkflows: g_RunDocumentationWorkflows }, { filename: g_strDocumentationPath, timeout: g_unDocumentationTimeoutMilliseconds });
} catch (Failure) {
	g_PrimaryError = Failure;
	g_bHasPrimaryError = true;
} finally {
	const vecCleanupFailures = [];
	// All independent owners run even when another cleanup fails.
	for (const Cleanup of [
		RestoreModuleLoader,
		ReleaseDocumentationOwner,
		ReleaseTypedRegistrations,
		RestorePackageCache,
	]) {
		try {
			Cleanup();
		} catch (Failure) {
			vecCleanupFailures.push(Failure);
		}
	}

	if (vecCleanupFailures.length > 0) {
		throw new AggregateError(g_bHasPrimaryError ? [g_PrimaryError, ...vecCleanupFailures] : vecCleanupFailures, "Command smoke test cleanup failed.");
	}
}

if (g_bHasPrimaryError) {
	throw g_PrimaryError;
}

console.log("[  OK  ] smoke_plugins_command");
