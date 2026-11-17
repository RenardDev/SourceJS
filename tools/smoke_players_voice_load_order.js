"use strict";

const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackageRootPath = g_Path.resolve(__dirname, "../packages/sourcejs");
const g_strPlayersPath = g_Path.join(g_strPackageRootPath, "players/index.js");
const g_strVoicePath = g_Path.join(g_strPackageRootPath, "players/voice.js");

const g_setStubbedModules = new Set([
	"auth/manager",
	"engines/server",
	"engines/sound",
	"engines/trace",
	"entities",
	"entities/collisions",
	"entities/constants",
	"filters/entities",
	"filters/weapons",
	"mathlib",
	"memory/hooks",
	"netchannel",
	"players/dropweapon",
	"players/teams",
	"steam",
	"weapons",
	"weapons/manager",
	"weapons/restrictions",
]);

function RestorePackageCache(mapOriginalDescriptors) {
	const vecFailures = [];
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Temporary voice load-order cache entry must be removable: " + strPath);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}
	}

	for (const [strPath, Descriptor] of mapOriginalDescriptors) {
		try {
			Object.defineProperty(require.cache, strPath, Descriptor);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Voice load-order package cache restoration failed.");
	}
}

function VerifyLoadOrder(bLoadPlayersFirst) {
	const ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const mapOriginalCacheDescriptors = new Map();
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapOriginalCacheDescriptors.set(strPath, Object.getOwnPropertyDescriptor(require.cache, strPath));
		}
	}

	let unMaximumClientsCallCount = 0;
	const NativePlayers = {
		GetMaximumClients() {
			unMaximumClientsCallCount += 1;

			return 4;
		},
	};

	const NativeVoice = {
		GetClientListening(nReceiverIndex, nSenderIndex) {
			g_Assert.equal(nReceiverIndex, 1);
			g_Assert.equal(nSenderIndex, 2);

			return true;
		},
	};

	const PlayerHelpers = { GetPlayerIndex: (PlayerReference) => PlayerReference };
	const mapNativeModules = new Map([
		["players", NativePlayers],
		["players/voice", NativeVoice],
		["players/helpers", PlayerHelpers],
	]);
	const GetModule = (strModuleName) => mapNativeModules.get(strModuleName) ?? {};

	let PrimaryFailure = undefined;
	let bFailed = false;
	let bCacheAcquired = false;
	let bLoaderAcquired = false;

	try {
		g_Assert.ok(ModuleLoadDescriptor && Object.hasOwn(ModuleLoadDescriptor, "value") && (typeof ModuleLoadDescriptor.value === "function") && (ModuleLoadDescriptor.configurable || ModuleLoadDescriptor.writable), "Node module loader must be replaceable without invoking an accessor.");

		for (const [strPath, Descriptor] of mapOriginalCacheDescriptors) {
			g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
		}

		bCacheAcquired = true;
		for (const strPath of mapOriginalCacheDescriptors.keys()) {
			g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
		}

		bLoaderAcquired = true;
		Object.defineProperty(g_Module, "_load", {
			...ModuleLoadDescriptor,

			value: function LoadVoiceFixture(strRequest, ParentModule, bIsMain) {
				if (strRequest === "internal/runtime") {
					return { GetModule };
				}

				if (strRequest === "players/helpers") {
					return PlayerHelpers;
				}

				if ((strRequest === "listeners") || g_setStubbedModules.has(strRequest)) {
					return {};
				}

				if (strRequest === "players/voice") {
					return ModuleLoadDescriptor.value.call(this, g_strVoicePath, ParentModule, bIsMain);
				}

				return ModuleLoadDescriptor.value.call(this, strRequest, ParentModule, bIsMain);
			},
		});

		require(bLoadPlayersFirst ? g_strPlayersPath : g_strVoicePath);
		require(bLoadPlayersFirst ? g_strVoicePath : g_strPlayersPath);
		const Voice = require(g_strVoicePath);
		g_Assert.equal(Voice.GetClientListening(1, 2), true);
		g_Assert.equal(unMaximumClientsCallCount, 2);
	} catch (Failure) {
		PrimaryFailure = Failure;
		bFailed = true;
	} finally {
		const vecCleanupFailures = [];
		if (bLoaderAcquired) {
			try {
				Object.defineProperty(g_Module, "_load", ModuleLoadDescriptor);
			} catch (Failure) {
				vecCleanupFailures.push(Failure);
			}
		}

		if (bCacheAcquired) {
			try {
				RestorePackageCache(mapOriginalCacheDescriptors);
			} catch (Failure) {
				vecCleanupFailures.push(Failure);
			}
		}

		if (vecCleanupFailures.length > 0) {
			if (bFailed) {
				throw new AggregateError([PrimaryFailure, ...vecCleanupFailures], "Voice load-order verification and restoration failed.");
			}

			throw new AggregateError(vecCleanupFailures, "Voice load-order restoration failed.");
		}
	}

	if (bFailed) {
		throw PrimaryFailure;
	}
}

VerifyLoadOrder(true);
VerifyLoadOrder(false);

console.log("[  OK  ] smoke_players_voice_load_order (native modules mocked)");
