"use strict";

const { GetSourceJSVersion } = require("core");
const { RegisterLevelInitializeListener, RegisterPluginUnloadingListener } = require("listeners");
const { LogInfo } = require("loggers");

const g_strPluginName = "hello";

let g_bUnloading = false;
let g_bCleanupInProgress = false;
let g_LevelInitializeSubscription = null;
let g_PluginUnloadingSubscription = null;

function DisposeSubscription(Subscription, strEventName) {
	if (Subscription === null) {
		return null;
	}

	if (!Subscription.Disposed && !Subscription.DisposeListener()) {
		throw new Error(`Unable to dispose the ${strEventName} listener.`);
	}

	return null;
}

function Cleanup() {
	g_bUnloading = true;

	if (g_bCleanupInProgress) {
		return false;
	}

	g_bCleanupInProgress = true;

	const vecCleanupErrors = [];
	try {
		try {
			g_LevelInitializeSubscription = DisposeSubscription(g_LevelInitializeSubscription, "LevelInitialize");
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}

		try {
			g_PluginUnloadingSubscription = DisposeSubscription(g_PluginUnloadingSubscription, "PluginUnloading");
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	} finally {
		g_bCleanupInProgress = false;
	}

	if (vecCleanupErrors.length > 0) {
		throw new AggregateError(vecCleanupErrors, "Unable to dispose hello plugin listeners.");
	}

	return true;
}

function HandleLevelInitialize(strMapName) {
	if (g_bUnloading) {
		return;
	}

	LogInfo("%s", `LevelInitialize: ${strMapName}`);
}

function HandlePluginUnloading(strUnloadingPluginName) {
	if (g_bUnloading || (strUnloadingPluginName !== g_strPluginName)) {
		return;
	}

	Cleanup();
	LogInfo("PluginUnloading: hello plugin unloading");
}

function Initialize() {
	const LevelInitializeSubscription = RegisterLevelInitializeListener(HandleLevelInitialize);
	if (!LevelInitializeSubscription) {
		throw new Error("Unable to register the level-initialize listener.");
	}

	g_LevelInitializeSubscription = LevelInitializeSubscription;

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	const PluginUnloadingSubscription = RegisterPluginUnloadingListener(HandlePluginUnloading);
	if (!PluginUnloadingSubscription) {
		throw new Error("Unable to register the plugin-unloading listener.");
	}

	g_PluginUnloadingSubscription = PluginUnloadingSubscription;

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	const strVersion = GetSourceJSVersion();

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	LogInfo("%s", `hello plugin loaded on SourceJS ${strVersion}`);
}

exports.Unload = Cleanup;

try {
	Initialize();
} catch (InitializationError) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([InitializationError, CleanupError], "Hello plugin initialization and cleanup failed.");
	}

	throw InitializationError;
}
