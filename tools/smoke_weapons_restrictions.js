#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-restrictions.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strRestrictionsPath = g_Path.join(g_strPackageRootPath, "weapons", "restrictions.js");
const g_strWeaponsPath = g_Path.join(g_strPackageRootPath, "weapons", "index.js");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unChildTimeoutMilliseconds = 5000;

const g_vecCurrentWeaponReads = [];
const g_vecRemovedWeapons = [];
const g_TestPlayer = { Index: 1, Team: 2, UserID: 42 };
let g_CurrentWeapon = { Index: 10, Weapon: "rifle" };

function VerifyWorldRestrictionExample(WeaponsRestrictionsAPI) {
	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecCallback = strExample.match(/\tLogResult\("weapons\/restrictions handler",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecCallback);
	const nCleanupStart = strExample.indexOf("\nfunction UseCleanup(");
	const nCleanupEnd = strExample.indexOf("\nfunction GetCommandArguments(", nCleanupStart);
	g_Assert.ok((nCleanupStart >= 0) && (nCleanupEnd > nCleanupStart));
	const strCallback = `${strExample.slice(nCleanupStart, nCleanupEnd)}\n${vecCallback[0]}`;
	const FlattenErrors = (Failure) => Array.isArray(Failure?.errors) ? Array.from(Failure.errors).flatMap(FlattenErrors) : [Failure];
	const vecBodyProfiles = [{ Failed: false }, ...[undefined, null, false, 0, "opaque restriction error", Object.freeze(new Error("opaque restriction error"))].map((Failure) => ({ Failed: true, Failure }))];
	let unScenarios = 0;
	for (const Body of vecBodyProfiles) {
		for (const strClearMode of ["", "FALSE", "THROW"]) {
			for (const strUnregisterMode of ["", "FALSE", "THROW"]) {
				const ClearError = Object.freeze(new Error("opaque restriction clear error"));
				const UnregisterError = Object.freeze(new Error("opaque restriction unregister error"));
				const vecCleanups = [];
				let Handler = null;
				class ControlledHandler extends WeaponsRestrictionsAPI.WeaponRestrictionHandler {
					constructor(Options) {
						super(Options);
						Handler = this;
					}

					AddGlobalRestrictions(vecNames) {
						const vecAddedWeaponNames = super.AddGlobalRestrictions(vecNames);

						if (Body.Failed) {
							throw Body.Failure;
						}

						return vecAddedWeaponNames;
					}

					Clear() {
						vecCleanups.push("clear");

						if (strClearMode === "FALSE") {
							return false;
						}

						if (strClearMode === "THROW") {
							throw ClearError;
						}

						return super.Clear();
					}

					Unregister() {
						vecCleanups.push("unregister");

						if (strUnregisterMode === "FALSE") {
							return false;
						}

						if (strUnregisterMode === "THROW") {
							throw UnregisterError;
						}

						return super.Unregister();
					}
				}

				let bCaught = false;
				let Failure = undefined;
				let Result = null;
				try {
					g_VM.runInNewContext(strCallback, {
						...WeaponsRestrictionsAPI,
						WeaponRestrictionHandler: ControlledHandler,
						GetAllPlayers: () => [{ ...g_TestPlayer, Connected: true }],
						WEAPON_MANAGER: { Values: () => [{ Name: "rifle" }] },
						LogResult: (strLabel, Callback) => {
							g_Assert.equal(strLabel, "weapons/restrictions handler");
							Result = Callback();
						},
					}, { filename: strExamplePath, timeout: g_unDocumentationTimeoutMilliseconds });
				} catch (CaughtError) {
					bCaught = true;
					Failure = CaughtError;
				} finally {
					if (Handler !== null) {
						// Test-only rollback bypasses injected overrides; production must not retry unknown outcomes.
						try {
							g_Assert.equal(WeaponsRestrictionsAPI.WeaponRestrictionHandler.prototype.Clear.call(Handler), true, "world restriction fixture clear succeeds");
						} finally {
							// The callback may already have unregistered the handler; false is a valid no-op.
							WeaponsRestrictionsAPI.WeaponRestrictionHandler.prototype.Unregister.call(Handler);
						}
					}
				}

				g_Assert.deepEqual(vecCleanups, ["clear", "unregister"]);
				g_Assert.equal(bCaught, Body.Failed || Boolean(strClearMode || strUnregisterMode));

				if (bCaught) {
					const vecFailures = FlattenErrors(Failure);
					g_Assert.equal(vecFailures.length, Number(Body.Failed) + Number(Boolean(strClearMode)) + Number(Boolean(strUnregisterMode)));

					if (Body.Failed) {
						g_Assert.equal(vecFailures[0], Body.Failure);
					}

					if (strClearMode === "THROW") {
						g_Assert.equal(vecFailures[Number(Body.Failed)], ClearError);
					}

					if (strUnregisterMode === "THROW") {
						g_Assert.equal(vecFailures.at(-1), UnregisterError);
					}

				} else {
					g_Assert.equal(Result.Local.ManagerSizeDuring, 1);
					g_Assert.equal(Result.Local.ManagerSizeAfter, 0);
					g_Assert.equal(Result.Local.TeamRestricted, true, "world restriction example uses the native Team field");
					g_Assert.equal(Result.Local.TeamRestrictions.length, 1);
					g_Assert.equal(Result.Local.TeamRestrictions[0][0], g_TestPlayer.Team, "world restriction bucket retains the native team number");
					g_Assert.equal(Result.Local.TeamRestrictions[0][1][0], "rifle");
				}

				unScenarios += 1;
			}
		}
	}

	console.log(`[world restriction example] ${unScenarios} operation/independent-cleanup scenarios; actual JS package with SDK doubles, not live game proof`);
}

function InstallDependency(strPathName, ModuleExports) {
	delete require.cache[strPathName];
	require.cache[strPathName] = { children: [], exports: ModuleExports, filename: strPathName, id: strPathName, loaded: true, paths: [] };
}

const g_WeaponsAPI = {
	GetCurrentWeapon(Player) {
		g_vecCurrentWeaponReads.push(Player);

		if (!Player || (Player.UserID !== g_TestPlayer.UserID)) {
			throw new TypeError("Current weapon requires the fixture player");
		}

		return g_CurrentWeapon;
	},

	Remove(Weapon) {
		g_vecRemovedWeapons.push(Weapon);

		if (Weapon === g_CurrentWeapon) {
			g_CurrentWeapon = null;
		}

		return true;
	},
};

function LoadWeaponsRestrictionsAPI() {
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const strPackagePathPrefix = `${g_strPackageRootPath}${g_Path.sep}`;
	const mapOriginalPackageCache = new Map(Object.getOwnPropertyNames(require.cache).filter(strCachedPath => strCachedPath.startsWith(strPackagePathPrefix)).map(strCachedPath => [strCachedPath, Object.getOwnPropertyDescriptor(require.cache, strCachedPath)]));
	g_Assert.ok(LoaderDescriptor?.configurable && (typeof OriginalModuleLoad === "function"), "Weapons/restrictions loader must support exact restoration.");
	g_Assert.ok(Object.isExtensible(require.cache) && Array.from(mapOriginalPackageCache.values()).every(Descriptor => Descriptor.configurable), "Weapons/restrictions package cache must support exact restoration.");

	function RestoreProperty(Target, strName, Descriptor) {
		if (Descriptor === undefined) {
			g_Assert.equal(Reflect.deleteProperty(Target, strName), true, `Owned weapons/restrictions fixture property must be removable: ${strName}`);
			return;
		}

		Object.defineProperty(Target, strName, Descriptor);
	}

	let bCacheOwned = false;
	let bLoaderOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;
	const vecCleanupFailures = [];
	try {
		bCacheOwned = true;

		for (const strCachedPath of mapOriginalPackageCache.keys()) {
			RestoreProperty(require.cache, strCachedPath, undefined);
		}

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function Load(strRequest, ParentModule, bIsMain) {
				if (strRequest === "weapons") {
					return require(g_strWeaponsPath);
				}

				return OriginalModuleLoad.call(this, strRequest, ParentModule, bIsMain);
			},
		});
		bLoaderOwned = true;

		InstallDependency(g_strWeaponsPath, g_WeaponsAPI);

		Result = require(g_strRestrictionsPath);
	} catch (CaughtError) {
		bFailed = true;
		Failure = CaughtError;
	} finally {
		if (bLoaderOwned) {
			try {
				RestoreProperty(g_Module, "_load", LoaderDescriptor);
			} catch (CleanupError) {
				vecCleanupFailures.push(CleanupError);
			}
		}

		if (bCacheOwned) {
			for (const strCachedPath of Object.getOwnPropertyNames(require.cache)) {
				if (strCachedPath.startsWith(strPackagePathPrefix)) {
					try {
						RestoreProperty(require.cache, strCachedPath, undefined);
					} catch (CleanupError) {
						vecCleanupFailures.push(CleanupError);
					}
				}
			}

			for (const [strCachedPath, Descriptor] of mapOriginalPackageCache) {
				try {
					RestoreProperty(require.cache, strCachedPath, Descriptor);
				} catch (CleanupError) {
					vecCleanupFailures.push(CleanupError);
				}
			}
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (bFailed) {
			vecCleanupFailures.unshift(Failure);
		}

		throw new AggregateError(vecCleanupFailures, "Weapons/restrictions fixture cleanup failed.");
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_WeaponsRestrictionsAPI = LoadWeaponsRestrictionsAPI();
g_Assert.equal(g_vecCurrentWeaponReads.length, 0, "module import performs no current-weapon lookup");
g_Assert.equal(g_vecRemovedWeapons.length, 0, "module import removes no weapon");
g_Assert.deepEqual(Object.keys(g_WeaponsRestrictionsAPI).sort(), [
	"CanUse",
	"CanUseCurrent",
	"RestrictGlobal",
	"RestrictPlayer",
	"RestrictTeam",
	"UnrestrictGlobal",
	"UnrestrictPlayer",
	"UnrestrictTeam",
	"WEAPON_RESTRICTION_HANDLER",
	"WEAPON_RESTRICTION_MANAGER",
	"WeaponRestrictionHandler",
	"WeaponRestrictionManager",
], "exact weapons/restrictions exports");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_WeaponsRestrictionsAPI.WeaponRestrictionHandler.prototype).sort(), [
	"AddGlobalRestrictions",
	"AddPlayerRestrictions",
	"AddTeamRestrictions",
	"Clear",
	"GlobalRestrictions",
	"constructor",
	"IsGloballyRestricted",
	"IsPlayerRestricted",
	"IsTeamRestricted",
	"Manager",
	"OnPlayerBumpingWeapon",
	"OnPlayerPurchasingWeapon",
	"OnPlayerRestrictionAdded",
	"OnTeamRestrictionAdded",
	"PlayerRestrictions",
	"RemoveGlobalRestrictions",
	"RemovePlayerRestrictions",
	"RemoveTeamRestrictions",
	"TeamRestrictions",
	"Unregister",
].sort(), "exact WeaponRestrictionHandler prototype members");
g_Assert.deepEqual(Object.getOwnPropertyNames(g_WeaponsRestrictionsAPI.WeaponRestrictionManager.prototype).sort(), [
	"AddHandler",
	"Clear",
	"Handlers",
	"constructor",
	"IsPlayerRestricted",
	"IsTeamRestricted",
	"OnPlayerBumpingWeapon",
	"OnPlayerPurchasingWeapon",
	"RemoveHandler",
	"Size",
].sort(), "exact WeaponRestrictionManager string members");

const g_vecManagerPrototypeSymbols = Object.getOwnPropertySymbols(g_WeaponsRestrictionsAPI.WeaponRestrictionManager.prototype);
g_Assert.deepEqual(g_vecManagerPrototypeSymbols, [Symbol.iterator], "exact WeaponRestrictionManager symbol members");

const g_DefaultManager = g_WeaponsRestrictionsAPI.WEAPON_RESTRICTION_MANAGER;
const g_DefaultHandler = g_WeaponsRestrictionsAPI.WEAPON_RESTRICTION_HANDLER;

g_Assert.ok(g_DefaultManager instanceof g_WeaponsRestrictionsAPI.WeaponRestrictionManager, "default manager type");
g_Assert.ok(g_DefaultHandler instanceof g_WeaponsRestrictionsAPI.WeaponRestrictionHandler, "default handler type");
g_Assert.equal(g_DefaultHandler.Manager, g_DefaultManager, "default handler owner");
g_Assert.equal(g_DefaultManager.Size, 1, "default manager starts with one handler");

const g_itDefaultManager = g_DefaultManager[Symbol.iterator]();
g_Assert.equal(g_itDefaultManager.next().value, g_DefaultHandler, "default manager iterator value");
g_Assert.equal(g_itDefaultManager.next().done, true, "default manager iterator end");

const g_vecAddedGlobalWeaponNames = g_DefaultHandler.AddGlobalRestrictions([" Weapon_Rifle ", "rifle", { Weapon: "WEAPON_PISTOL" }]);
g_Assert.deepEqual(g_vecAddedGlobalWeaponNames, ["rifle", "pistol"], "global additions normalize and deduplicate names");
g_Assert.equal(g_DefaultHandler.IsGloballyRestricted("weapon_rifle"), true, "global string lookup");
g_Assert.equal(g_DefaultHandler.IsGloballyRestricted({ Weapon: " PISTOL " }), true, "global weapon-object lookup");
g_Assert.throws(() => g_DefaultHandler.IsGloballyRestricted({ WeaponName: "rifle" }), /weapon name or weapon object/, "stale WeaponName fields are not converted");
g_Assert.equal(g_DefaultHandler.RemoveGlobalRestrictions(["rifle"]), true, "global removal hit");
g_Assert.equal(g_DefaultHandler.RemoveGlobalRestrictions(["rifle"]), false, "global removal miss");
g_Assert.equal(g_DefaultHandler.RemoveGlobalRestrictions(["pistol"]), true, "second global removal");

g_CurrentWeapon = { Index: 10, Weapon: "rifle" };

const g_vecAddedPlayerWeaponNames = g_DefaultHandler.AddPlayerRestrictions(g_TestPlayer, ["weapon_rifle", "RIFLE"]);
g_Assert.deepEqual(g_vecAddedPlayerWeaponNames, ["rifle"], "player additions normalize and deduplicate names");
g_Assert.equal(g_vecRemovedWeapons.at(-1).Index, 10, "new current-weapon restriction removes the matching weapon");
g_Assert.equal(g_CurrentWeapon, null, "matching current weapon is no longer current");
g_Assert.equal(g_DefaultHandler.PlayerRestrictions.get(g_TestPlayer.UserID).has("rifle"), true, "live player restriction map");
g_Assert.equal(g_DefaultHandler.IsPlayerRestricted(g_TestPlayer, "rifle"), true, "player restriction hit");
g_Assert.equal(g_DefaultHandler.OnPlayerBumpingWeapon(g_TestPlayer, "rifle"), false, "handler bump allow-result while restricted");
g_Assert.equal(g_DefaultHandler.OnPlayerPurchasingWeapon(g_TestPlayer, "rifle"), false, "handler purchase allow-result while restricted");
g_Assert.equal(g_DefaultManager.OnPlayerBumpingWeapon(g_TestPlayer, "rifle"), true, "manager bump block-result while restricted");
g_Assert.equal(g_DefaultManager.OnPlayerPurchasingWeapon(g_TestPlayer, "rifle"), true, "manager purchase block-result while restricted");
g_Assert.equal(g_DefaultHandler.RemovePlayerRestrictions(g_TestPlayer.UserID, ["rifle"]), true, "player removal by user ID");
g_Assert.equal(g_DefaultHandler.IsPlayerRestricted(g_TestPlayer, "rifle"), false, "removed player restriction");
g_Assert.equal(g_DefaultHandler.PlayerRestrictions.has(g_TestPlayer.UserID), false, "last player restriction removes its bucket");

const g_unRemovalsBeforeUserIDRestriction = g_vecRemovedWeapons.length;
g_Assert.deepEqual(g_DefaultHandler.AddPlayerRestrictions(77, ["weapon_crowbar"]), ["crowbar"], "numeric user ID restriction add");
g_Assert.equal(g_vecRemovedWeapons.length, g_unRemovalsBeforeUserIDRestriction, "numeric user ID does not trigger a native current lookup");
g_Assert.equal(g_DefaultHandler.IsPlayerRestricted(77, "crowbar"), true, "numeric user ID restriction query");
g_Assert.equal(g_DefaultHandler.RemovePlayerRestrictions(77, ["crowbar"]), true, "numeric user ID restriction removal");
g_Assert.equal(g_DefaultHandler.PlayerRestrictions.has(77), false, "numeric user ID removal clears its bucket");

const g_vecAddedTeamWeaponNames = g_DefaultHandler.AddTeamRestrictions({ TeamNumber: 2 }, ["weapon_smg", "SMG"]);
g_Assert.deepEqual(g_vecAddedTeamWeaponNames, ["smg"], "team additions normalize and deduplicate names");
g_Assert.equal(g_DefaultHandler.TeamRestrictions.get(2).has("smg"), true, "live team restriction map");
g_Assert.equal(g_DefaultHandler.IsTeamRestricted(2, "smg"), true, "team restriction hit");
g_Assert.equal(g_DefaultHandler.IsPlayerRestricted(g_TestPlayer, "smg"), true, "player inherits team restriction");
g_Assert.equal(g_DefaultHandler.IsPlayerRestricted(g_TestPlayer.UserID, "smg"), false, "numeric user ID has no team context");
g_Assert.equal(g_DefaultHandler.RemoveTeamRestrictions(2, ["smg"]), true, "team removal");
g_Assert.equal(g_DefaultHandler.IsTeamRestricted(2, "smg"), false, "removed team restriction");
g_Assert.equal(g_DefaultHandler.TeamRestrictions.has(2), false, "last team restriction removes its bucket");

g_CurrentWeapon = { Index: 11, Weapon: "pistol" };

g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictGlobal("rifle"), true, "default global wrapper add");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUse(g_TestPlayer, "rifle"), false, "default global wrapper query");
g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictGlobal("rifle"), true, "default global wrapper remove");
g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictPlayer(g_TestPlayer, "rifle"), true, "default player wrapper add");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUse(g_TestPlayer, "rifle"), false, "default player wrapper query");
g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictPlayer(g_TestPlayer, "rifle"), true, "default player wrapper remove");
g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictTeam(2, "smg"), true, "default team wrapper add");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUse(g_TestPlayer, "smg"), false, "default team wrapper query");
g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictTeam(2, "smg"), true, "default team wrapper remove");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUseCurrent(g_TestPlayer), true, "unrestricted current weapon");

g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictGlobal("pistol"), true, "current global restriction add");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUseCurrent(g_TestPlayer), false, "restricted current weapon");
g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictGlobal("pistol"), true, "current global restriction remove");

g_CurrentWeapon = null;
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUseCurrent(g_TestPlayer), true, "missing current weapon is allowed");

const g_RestrictionManager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
const g_RestrictionHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ AutoRegister: false, Manager: g_RestrictionManager });

g_Assert.equal(g_RestrictionManager.Size, 0, "deferred handler is not auto-registered");

for (const bAutoRegisterFirst of [false, true]) {
	const Manager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
	let unAutoRegisterReads = 0;
	const Handler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({
		Manager,
		get AutoRegister() {
			unAutoRegisterReads += 1;
			return (unAutoRegisterReads === 1) ? bAutoRegisterFirst : !bAutoRegisterFirst;
		},
	});
	g_Assert.equal(Manager.Size, bAutoRegisterFirst ? 1 : 0, "AutoRegister uses the captured boolean");
	g_Assert.equal(unAutoRegisterReads, 1, "constructor reads AutoRegister once");
	g_Assert.equal(Manager.RemoveHandler(Handler), bAutoRegisterFirst, "snapshot registration cleanup preserves ownership");
}

let g_unInvalidAutoRegisterReads = 0;
g_Assert.throws(() => new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({
	Manager: g_RestrictionManager,
	get AutoRegister() {
		g_unInvalidAutoRegisterReads += 1;
		return (g_unInvalidAutoRegisterReads === 1) ? 1 : false;
	},
}), /AutoRegister must be a boolean/, "constructor validates the captured first option value");
g_Assert.equal(g_unInvalidAutoRegisterReads, 1, "invalid AutoRegister is not re-read before rejection");

const g_CapturedRestrictionManager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
let g_unRestrictionManagerReads = 0;
const g_ManagerSnapshotHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({
	AutoRegister: false,
	get Manager() {
		g_unRestrictionManagerReads += 1;
		return (g_unRestrictionManagerReads === 1) ? g_CapturedRestrictionManager : null;
	},
});
g_Assert.equal(g_ManagerSnapshotHandler.ValueManager, g_CapturedRestrictionManager, "constructor keeps the captured Manager");
g_Assert.equal(g_unRestrictionManagerReads, 1, "constructor reads Manager once");
g_Assert.equal(g_RestrictionManager.AddHandler(g_RestrictionHandler), g_RestrictionHandler, "manager add result");
g_Assert.equal(g_RestrictionManager.AddHandler(g_RestrictionHandler), g_RestrictionHandler, "duplicate manager add result");
g_Assert.equal(g_RestrictionManager.Size, 1, "manager set deduplicates handlers");
g_Assert.equal(g_RestrictionManager.Handlers.has(g_RestrictionHandler), true, "live handler set");

g_RestrictionHandler.AddGlobalRestrictions(["pistol"]);
g_RestrictionHandler.AddPlayerRestrictions(g_TestPlayer, ["rifle"]);
g_RestrictionHandler.AddTeamRestrictions(2, ["smg"]);

g_Assert.equal(g_RestrictionManager.IsPlayerRestricted(g_TestPlayer, "rifle"), true, "manager player restriction");
g_Assert.equal(g_RestrictionManager.IsPlayerRestricted(g_TestPlayer, "smg"), true, "manager inherited team restriction");
g_Assert.equal(g_RestrictionManager.IsTeamRestricted(2, "pistol"), true, "manager global team restriction");
g_Assert.equal(g_RestrictionManager.OnPlayerBumpingWeapon(g_TestPlayer, "rifle"), true, "custom manager bump block-result");
g_Assert.equal(g_RestrictionManager.OnPlayerPurchasingWeapon(g_TestPlayer, "rifle"), true, "custom manager purchase block-result");
g_Assert.equal(g_RestrictionManager.Clear(), true, "manager clear result");
g_Assert.equal(g_RestrictionManager.Size, 1, "manager clear preserves handlers");
g_Assert.equal(g_RestrictionHandler.GlobalRestrictions.size, 0, "manager clear resets global restrictions");
g_Assert.equal(g_RestrictionHandler.PlayerRestrictions.size, 0, "manager clear resets player restrictions");
g_Assert.equal(g_RestrictionHandler.TeamRestrictions.size, 0, "manager clear resets team restrictions");
g_Assert.equal(g_RestrictionManager.OnPlayerBumpingWeapon(g_TestPlayer, "rifle"), null, "unrestricted manager bump result");
g_Assert.equal(g_RestrictionManager.OnPlayerPurchasingWeapon(g_TestPlayer, "rifle"), null, "unrestricted manager purchase result");
g_Assert.equal(g_RestrictionHandler.Unregister(), true, "handler unregister result");
g_Assert.equal(g_RestrictionHandler.Unregister(), false, "repeated handler unregister result");

const g_DetachedHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ Manager: null });

g_Assert.equal(g_DetachedHandler.Manager, null, "detached handler manager");
g_Assert.equal(g_DetachedHandler.Unregister(), false, "detached handler unregister result");
g_Assert.equal(g_RestrictionManager.AddHandler(g_DetachedHandler), g_DetachedHandler, "a manager can register a detached handler");
g_Assert.equal(g_DetachedHandler.Manager, null, "manual registration does not rebind the handler manager");
g_Assert.equal(g_DetachedHandler.Unregister(), false, "detached handler still cannot unregister itself after manual registration");
g_Assert.equal(g_RestrictionManager.Handlers.has(g_DetachedHandler), true, "failed detached unregister preserves manual registration");
g_Assert.equal(g_RestrictionManager.RemoveHandler(g_DetachedHandler), true, "manual manager removes the detached handler");

const g_InitialBackingManager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
const g_ReplacementBackingManager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
const g_ReboundHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ Manager: g_InitialBackingManager });
try {
	g_ReplacementBackingManager.AddHandler(g_ReboundHandler);
	g_ReboundHandler.ValueManager = g_ReplacementBackingManager;
	g_Assert.equal(g_ReboundHandler.Manager, g_ReplacementBackingManager, "Manager follows its writable backing field");
	g_Assert.equal(g_ReboundHandler.Unregister(), true, "Unregister targets the current backing manager");
	g_Assert.equal(g_ReplacementBackingManager.Handlers.has(g_ReboundHandler), false, "current manager membership is removed");
	g_Assert.equal(g_InitialBackingManager.Handlers.has(g_ReboundHandler), true, "rebinding does not migrate or remove the original membership");
} finally {
	// Either manager may already have removed the handler; removal is idempotent.
	g_InitialBackingManager.RemoveHandler(g_ReboundHandler);
	g_ReplacementBackingManager.RemoveHandler(g_ReboundHandler);
}

const g_EmptyScopeHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ Manager: null });
g_Assert.deepEqual(g_EmptyScopeHandler.AddPlayerRestrictions(77, []), [], "empty player adds return no names");
g_Assert.equal(g_EmptyScopeHandler.PlayerRestrictions.get(77).size, 0, "empty player adds create an empty bucket");
g_Assert.equal(g_EmptyScopeHandler.RemovePlayerRestrictions(77, []), false, "empty player bucket removal returns false");
g_Assert.equal(g_EmptyScopeHandler.PlayerRestrictions.has(77), false, "empty player removal deletes its bucket");
g_Assert.deepEqual(g_EmptyScopeHandler.AddTeamRestrictions(2, []), [], "empty team adds return no names");
g_Assert.equal(g_EmptyScopeHandler.TeamRestrictions.get(2).size, 0, "empty team adds create an empty bucket");
g_Assert.equal(g_EmptyScopeHandler.RemoveTeamRestrictions(2, []), false, "empty team bucket removal returns false");
g_Assert.equal(g_EmptyScopeHandler.TeamRestrictions.has(2), false, "empty team removal deletes its bucket");

class AuditedWeaponRestrictions extends g_WeaponsRestrictionsAPI.WeaponRestrictionHandler {
	constructor(Options) {
		super(Options);
		this.RestrictionEvents = [];
	}

	OnPlayerRestrictionAdded(Player, strWeaponName) {
		this.RestrictionEvents.push({ Kind: "player", PlayerUserID: Player.UserID, WeaponName: strWeaponName });
	}

	OnTeamRestrictionAdded(unTeamNumber, strWeaponName) {
		this.RestrictionEvents.push({ Kind: "team", TeamNumber: unTeamNumber, WeaponName: strWeaponName });
	}
}

const g_RestrictionAuditManager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
const g_AuditedRestrictionHandler = new AuditedWeaponRestrictions({ Manager: g_RestrictionAuditManager });

g_AuditedRestrictionHandler.AddPlayerRestrictions(g_TestPlayer, ["weapon_rifle"]);
g_AuditedRestrictionHandler.AddTeamRestrictions(g_TestPlayer.Team, ["weapon_smg"]);

g_Assert.deepEqual(g_AuditedRestrictionHandler.RestrictionEvents, [
	{ Kind: "player", PlayerUserID: 42, WeaponName: "rifle" },
	{ Kind: "team", TeamNumber: 2, WeaponName: "smg" },
], "addition callbacks receive normalized names");
g_Assert.equal(g_AuditedRestrictionHandler.Unregister(), true, "subclass handler unregister result");

for (const InvalidOptions of [null, [], "default"]) {
	g_Assert.throws(function ConstructHandlerWithInvalidOptions() {
		new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler(InvalidOptions);
	}, /options must be an object/, "invalid handler options must throw");
}

g_Assert.throws(function ConstructHandlerWithInvalidAutoRegister() {
	new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ AutoRegister: 1 });
}, /AutoRegister must be a boolean/, "invalid AutoRegister must throw");
g_Assert.throws(function ConstructHandlerWithInvalidManager() {
	new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ Manager: {} });
}, /Manager must be a WeaponRestrictionManager or null/, "invalid Manager must throw");
g_Assert.throws(function AddGlobalRestrictionsWithoutArray() {
	g_DefaultHandler.AddGlobalRestrictions("rifle");
}, /must be an array/, "restriction lists must be arrays");
g_Assert.throws(function AddPlayerRestrictionWithUserIDAlias() {
	g_DefaultHandler.AddPlayerRestrictions({ userid: 42, team: 2 }, ["rifle"]);
}, /positive player user ID/, "userid alias must be rejected");

// Negative migration cases: old internal-style fields are not public API aliases.
g_Assert.throws(function QueryLegacyWeaponName() {
	g_DefaultHandler.IsGloballyRestricted({ m_strWeaponName: "rifle" });
}, /weapon name or weapon object/, "legacy weapon-name field is rejected");
g_Assert.throws(function AddLegacyPlayerIdentity() {
	g_DefaultHandler.AddPlayerRestrictions({ m_nUserID: 42 }, ["rifle"]);
}, /positive player user ID/, "legacy user-ID field is rejected");
g_Assert.throws(function AddLegacyTeamIdentity() {
	g_DefaultHandler.AddTeamRestrictions({ m_nTeamNumber: 2 }, ["rifle"]);
}, /team number/, "legacy team-number field is rejected");

const g_PascalCaseOnlyHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ Manager: null });
g_PascalCaseOnlyHandler.AddTeamRestrictions(2, ["rifle"]);
g_Assert.equal(g_PascalCaseOnlyHandler.IsPlayerRestricted({ UserID: 42, m_nTeamNumber: 2 }, "rifle"), false, "legacy team context is not converted");
g_Assert.equal(g_PascalCaseOnlyHandler.IsPlayerRestricted({ UserID: 42, Team: 2 }, "rifle"), true, "native PascalCase team context participates");
g_Assert.equal(g_PascalCaseOnlyHandler.IsPlayerRestricted({ UserID: 42, TeamNumber: 2 }, "rifle"), false, "standalone team-selector records are not native player team fields");

const g_unReadsBeforeLegacyIndex = g_vecCurrentWeaponReads.length;
g_PascalCaseOnlyHandler.AddPlayerRestrictions({ UserID: 42, m_unIndex: 1 }, ["pistol"]);
g_Assert.equal(g_vecCurrentWeaponReads.length, g_unReadsBeforeLegacyIndex, "legacy index does not trigger a current-weapon lookup");

g_Assert.throws(function AddTeamRestrictionWithAlias() {
	g_DefaultHandler.AddTeamRestrictions("ct", ["rifle"]);
}, /team number/, "team aliases must be rejected");
g_Assert.throws(function QueryClassNameOnlyWeapon() {
	g_DefaultHandler.IsGloballyRestricted({ className: "weapon_rifle" });
}, /weapon name or weapon object/, "className-only objects must be rejected");

for (const InvalidWeapon of ["", "   ", "weapon_", {}, null, 7]) {
	g_Assert.throws(function QueryInvalidWeapon() {
		g_DefaultHandler.IsGloballyRestricted(InvalidWeapon);
	}, /weapon name or weapon object/, "invalid weapon values must throw");
}

g_Assert.throws(function AddInvalidRestrictionHandler() {
	g_RestrictionManager.AddHandler({});
}, /must be a WeaponRestrictionHandler/, "manager requires real handlers");

const g_AtomicValidationHandler = new g_WeaponsRestrictionsAPI.WeaponRestrictionHandler({ Manager: null });
g_Assert.throws(function RemovePlayerRestrictionsWithoutArray() {
	g_AtomicValidationHandler.RemovePlayerRestrictions(9001, "not-an-array");
}, /must be an array/, "player remove validates values without a bucket");
g_Assert.throws(function RemoveTeamRestrictionsWithoutArray() {
	g_AtomicValidationHandler.RemoveTeamRestrictions(9, "not-an-array");
}, /must be an array/, "team remove validates values without a bucket");
g_Assert.throws(function AddPlayerRestrictionsWithoutArray() {
	g_AtomicValidationHandler.AddPlayerRestrictions(9001, "not-an-array");
}, /must be an array/, "player add validates values");
g_Assert.equal(g_AtomicValidationHandler.PlayerRestrictions.has(9001), false, "failed player add creates no bucket");
g_Assert.throws(function AddTeamRestrictionsWithoutArray() {
	g_AtomicValidationHandler.AddTeamRestrictions(9, "not-an-array");
}, /must be an array/, "team add validates values");
g_Assert.equal(g_AtomicValidationHandler.TeamRestrictions.has(9), false, "failed team add creates no bucket");
g_Assert.throws(function AddGlobalRestrictionsWithInvalidWeapon() {
	g_AtomicValidationHandler.AddGlobalRestrictions(["rifle", null]);
}, /weapon name or weapon object/, "bulk normalization is atomic before mutation");
g_Assert.equal(g_AtomicValidationHandler.GlobalRestrictions.has("rifle"), false, "failed bulk normalization adds no valid prefix");

class ThrowingAdditionWeaponRestrictions extends g_WeaponsRestrictionsAPI.WeaponRestrictionHandler {
	OnPlayerRestrictionAdded() {
		throw new Error("addition callback failed");
	}
}

const g_ThrowingAdditionRestrictionHandler = new ThrowingAdditionWeaponRestrictions({ Manager: null });

function AddRestrictionsWithThrowingCallback() {
	g_ThrowingAdditionRestrictionHandler.AddPlayerRestrictions(9002, ["rifle", "pistol"]);
}

g_Assert.throws(AddRestrictionsWithThrowingCallback, /addition callback failed/, "addition callback error propagates");

const g_vecRetainedWeaponNames = [];
for (const strWeaponName of g_ThrowingAdditionRestrictionHandler.PlayerRestrictions.get(9002)) {
	g_vecRetainedWeaponNames.push(strWeaponName);
}

g_Assert.deepEqual(g_vecRetainedWeaponNames, ["rifle", "pistol"], "callback failure preserves every inserted name");

class NonBlockingWeaponRestrictions extends g_WeaponsRestrictionsAPI.WeaponRestrictionHandler {
	OnPlayerBumpingWeapon() {
		return 0;
	}
}

const g_NonBlockingManager = new g_WeaponsRestrictionsAPI.WeaponRestrictionManager();
const g_NonBlockingHandler = new NonBlockingWeaponRestrictions({ Manager: g_NonBlockingManager });
g_Assert.equal(g_NonBlockingManager.OnPlayerBumpingWeapon(g_TestPlayer, "rifle"), null, "only exact false produces a manager block result");
g_Assert.equal(g_NonBlockingHandler.Unregister(), true, "non-blocking handler cleanup");

const g_vecForbiddenExports = [
	"default",
	"list",
	"moduleName",
	"restrict",
	"runtime",
	"weaponRestrictionHandler",
	"weaponRestrictionManager",
];
for (const strForbiddenExport of g_vecForbiddenExports) {
	g_Assert.equal(Object.hasOwn(g_WeaponsRestrictionsAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

g_CurrentWeapon = { Index: 10, Weapon: "rifle" };

function CopyWeaponNames(setRestrictions) {
	const vecWeaponNames = [];
	for (const strWeaponName of setRestrictions) {
		vecWeaponNames.push(strWeaponName);
	}

	return vecWeaponNames;
}

function CopyPlayerRestrictions(mapPlayerRestrictions) {
	const vecCopiedPlayerRestrictions = [];
	for (const [unPlayerUserID, setRestrictions] of mapPlayerRestrictions) {
		vecCopiedPlayerRestrictions.push([unPlayerUserID, CopyWeaponNames(setRestrictions)]);
	}

	return vecCopiedPlayerRestrictions;
}

function CopyTeamRestrictions(mapTeamRestrictions) {
	const vecCopiedTeamRestrictions = [];
	for (const [unTeamNumber, setRestrictions] of mapTeamRestrictions) {
		vecCopiedTeamRestrictions.push([unTeamNumber, CopyWeaponNames(setRestrictions)]);
	}

	return vecCopiedTeamRestrictions;
}

function CopyRestrictionState(RestrictionHandler) {
	return { GlobalWeaponNames: CopyWeaponNames(RestrictionHandler.GlobalRestrictions), PlayerRestrictions: CopyPlayerRestrictions(RestrictionHandler.PlayerRestrictions), TeamRestrictions: CopyTeamRestrictions(RestrictionHandler.TeamRestrictions) };
}

const g_RestrictionStateBeforeDocumentation = CopyRestrictionState(g_DefaultHandler);
const g_unCurrentWeaponReadCountBeforeDocumentation = g_vecCurrentWeaponReads.length;
const g_unRemovedWeaponCountBeforeDocumentation = g_vecRemovedWeapons.length;
const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_DocumentationCodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecDocumentationCodeBlocks = [];
let g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
while (g_vecDocumentationCodeBlockMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecDocumentationCodeBlockMatch[1]);
	g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
}

function RequireDocumentationModule(strModuleIdentifier) {
	if (strModuleIdentifier === "weapons/restrictions") {
		return g_WeaponsRestrictionsAPI;
	}

	throw new Error(`Unexpected documentation import: ${strModuleIdentifier}`);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 6, "all weapons/restrictions documentation JavaScript blocks are present");

const g_vecDocumentationModules = [];
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationBlockIndex += 1) {
	const DocumentationModule = { exports: {} };
	g_VM.runInNewContext(g_vecDocumentationCodeBlocks[unDocumentationBlockIndex], { module: DocumentationModule, require: RequireDocumentationModule }, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_vecDocumentationModules.push(DocumentationModule.exports);
}

g_Assert.deepEqual(CopyRestrictionState(g_DefaultHandler), g_RestrictionStateBeforeDocumentation, "documentation loading preserves restrictions");
g_Assert.equal(g_vecCurrentWeaponReads.length, g_unCurrentWeaponReadCountBeforeDocumentation, "documentation loading performs no weapon lookup");
g_Assert.equal(g_vecRemovedWeapons.length, g_unRemovedWeaponCountBeforeDocumentation, "documentation avoids removing the current weapon");

const g_DocumentedNumericPlayerHandler = new g_vecDocumentationModules[4].AuditedWeaponRestrictions({ Manager: null });
try {
	g_DocumentedNumericPlayerHandler.AddPlayerRestrictions(77, [" Weapon_Rifle "]);
	g_Assert.equal(g_DocumentedNumericPlayerHandler.RestrictionEvents[0].PlayerUserID, 77, "documented player-add callback accepts the original numeric user ID");
	g_Assert.equal(g_DocumentedNumericPlayerHandler.RestrictionEvents[0].WeaponName, "rifle", "documented player-add callback records the normalized name");
	g_DocumentedNumericPlayerHandler.AddTeamRestrictions({ TeamNumber: 2 }, ["weapon_smg"]);
	g_Assert.equal(g_DocumentedNumericPlayerHandler.RestrictionEvents[1].TeamNumber, 2, "documented team-add callback receives the resolved numeric team");
} finally {
	g_Assert.equal(g_DocumentedNumericPlayerHandler.Clear(), true, "documented numeric-player fixture clear succeeds");
}

function ReturnGlobalRestrictionState(RestrictionState) {
	return RestrictionState;
}

const g_DocumentedGlobalResult = g_vecDocumentationModules[1].WithGlobalRestriction("weapon_rifle", ReturnGlobalRestrictionState);
g_Assert.equal(g_DocumentedGlobalResult.RestrictionAdded, true, "documented global transaction adds a new restriction");
g_Assert.equal(g_DocumentedGlobalResult.CurrentlyRestricted, true, "documented global transaction observes its restriction");
g_Assert.equal(g_DefaultHandler.IsGloballyRestricted("rifle"), false, "documented global transaction removes its own restriction");

try {
	g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictGlobal("rifle"), true, "pre-existing documented global restriction setup");
	const DocumentedExistingResult = g_vecDocumentationModules[1].WithGlobalRestriction("rifle", ReturnGlobalRestrictionState);
	g_Assert.equal(DocumentedExistingResult.RestrictionAdded, false, "documented global transaction recognizes existing policy");
	g_Assert.equal(g_DefaultHandler.IsGloballyRestricted("rifle"), true, "documented global transaction preserves existing policy");
} finally {
	g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictGlobal("rifle"), true, "pre-existing global fixture restoration succeeds");
}

function ThrowFromGlobalRestrictionCallback() {
	throw new Error("global callback failed");
}

function RunGlobalRestrictionWithThrowingCallback() {
	g_vecDocumentationModules[1].WithGlobalRestriction("rifle", ThrowFromGlobalRestrictionCallback);
}

g_Assert.throws(RunGlobalRestrictionWithThrowingCallback, /global callback failed/, "global workflow propagates callback errors");
g_Assert.equal(g_DefaultHandler.IsGloballyRestricted("rifle"), false, "documented global transaction cleans up after callback errors");

function ReturnTemporaryPolicyState(PolicyState) {
	return PolicyState;
}

const g_DocumentedTemporaryPolicy = g_vecDocumentationModules[2].EvaluateTemporaryPolicies(77, 2, "rifle", "smg", ReturnTemporaryPolicyState);
g_Assert.equal(g_DocumentedTemporaryPolicy.PlayerCanUseWeapon, false, "documented temporary player policy denies use");
g_Assert.equal(g_DocumentedTemporaryPolicy.TeamCanUseWeapon, false, "documented temporary team policy denies use");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUse(77, "rifle"), true, "documented temporary player policy restores state");
g_Assert.equal(g_DefaultManager.IsTeamRestricted(2, "smg"), false, "documented temporary team policy restores state");

function ThrowFromTemporaryPolicyCallback() {
	throw new Error("policy callback failed");
}

function EvaluateTemporaryPolicyWithThrowingCallback() {
	g_vecDocumentationModules[2].EvaluateTemporaryPolicies(77, 2, "rifle", "smg", ThrowFromTemporaryPolicyCallback);
}

g_Assert.throws(EvaluateTemporaryPolicyWithThrowingCallback, /policy callback failed/, "temporary policy propagates callback errors");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUse(77, "rifle"), true, "documented player policy cleans up after callback errors");
g_Assert.equal(g_DefaultManager.IsTeamRestricted(2, "smg"), false, "documented team policy cleans up after callback errors");

const g_TeamCleanupError = new Error("team cleanup failed after removal");
const g_OriginalRemoveTeamRestrictions = g_DefaultHandler.RemoveTeamRestrictions;
g_Assert.equal(Object.prototype.hasOwnProperty.call(g_DefaultHandler, "RemoveTeamRestrictions"), false, "cleanup regression begins without a handler method override");

try {
	g_DefaultHandler.RemoveTeamRestrictions = function RemoveTeamRestrictionsThenFail(TeamValue, vecWeaponValues) {
		const bRemoved = g_OriginalRemoveTeamRestrictions.call(this, TeamValue, vecWeaponValues);
		if (bRemoved) {
			throw g_TeamCleanupError;
		}

		return bRemoved;
	};

	g_Assert.throws(function EvaluatePolicyWithFailingTeamCleanup() {
		g_vecDocumentationModules[2].EvaluateTemporaryPolicies(77, 2, "rifle", "smg", ReturnTemporaryPolicyState);
	}, function PreserveTeamCleanupError(CaughtError) {
		return CaughtError === g_TeamCleanupError;
	}, "temporary policy preserves the original team cleanup error");
	g_Assert.equal(g_DefaultHandler.PlayerRestrictions.has(77), false, "player cleanup is attempted even when team cleanup throws");
	g_Assert.equal(g_DefaultHandler.TeamRestrictions.has(2), false, "the failing team cleanup already removed its bucket");
} finally {
	delete g_DefaultHandler.RemoveTeamRestrictions;
	// Removal is idempotent when the documented workflow already cleared either bucket.
	g_DefaultHandler.RemovePlayerRestrictions(77, ["rifle"]);
	g_DefaultHandler.RemoveTeamRestrictions(2, ["smg"]);
}

function EvaluateTemporaryPolicyWithInvalidTeam() {
	g_vecDocumentationModules[2].EvaluateTemporaryPolicies(77, "invalid-team", "rifle", "smg", ReturnTemporaryPolicyState);
}

g_Assert.throws(EvaluateTemporaryPolicyWithInvalidTeam, /non-negative team number/, "documented team acquisition rejects invalid identity");
g_Assert.equal(g_WeaponsRestrictionsAPI.CanUse(77, "rifle"), true, "failed documented team acquisition restores player policy");
g_Assert.equal(g_vecDocumentationModules[2].CanUseCurrentWeapon(g_TestPlayer), true, "documented current policy allows an unrestricted weapon");

try {
	g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictGlobal("rifle"), true, "current-policy fixture restriction succeeds");
	g_Assert.equal(g_vecDocumentationModules[2].CanUseCurrentWeapon(g_TestPlayer), false, "documented current policy observes a restriction");
} finally {
	g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictGlobal("rifle"), true, "current-policy fixture restoration succeeds");
}

const g_DocumentedDetachedPolicy = g_vecDocumentationModules[3].EvaluateDetachedPolicy(1001, 3, "pistol", "smg");
g_Assert.deepEqual(g_DocumentedDetachedPolicy.AddedGlobalWeaponNames, ["rifle"], "detached policy normalizes and deduplicates global names");
g_Assert.deepEqual(g_DocumentedDetachedPolicy.AddedPlayerWeaponNames, ["pistol"], "documented detached policy adds a player restriction");
g_Assert.deepEqual(g_DocumentedDetachedPolicy.AddedTeamWeaponNames, ["smg"], "documented detached policy adds a team restriction");
g_Assert.equal(g_DocumentedDetachedPolicy.GloballyRestricted, true, "documented detached global query");
g_Assert.equal(g_DocumentedDetachedPolicy.PlayerBumpAllowed, false, "documented detached bump policy denies a restricted weapon");
g_Assert.equal(g_DocumentedDetachedPolicy.PlayerRestricted, true, "documented detached player query");
g_Assert.equal(g_DocumentedDetachedPolicy.PlayerPurchaseAllowed, false, "documented detached purchase policy denies a restricted weapon");
g_Assert.equal(g_DocumentedDetachedPolicy.RestrictionManager, null, "documented detached manager remains null");
g_Assert.equal(g_DocumentedDetachedPolicy.TeamRestricted, true, "documented detached team query");
g_Assert.equal(g_DocumentedDetachedPolicy.GlobalRestrictionRemoved, true, "documented detached global removal");
g_Assert.equal(g_DocumentedDetachedPolicy.PlayerRestrictionRemoved, true, "documented detached player removal");
g_Assert.equal(g_DocumentedDetachedPolicy.TeamRestrictionRemoved, true, "documented detached team removal");
g_Assert.equal(g_DocumentedDetachedPolicy.RestrictionsCleared, true, "documented detached clear result");
g_Assert.equal(g_DocumentedDetachedPolicy.HandlerUnregistered, false, "documented detached unregister result");

const g_DocumentedAudit = g_vecDocumentationModules[4].RunAuditedPolicy(g_TestPlayer, "weapon_rifle", "weapon_smg");
g_Assert.equal(g_DocumentedAudit.PlayerBumpBlocked, true, "documented audited bump result");
g_Assert.equal(g_DocumentedAudit.PlayerPurchaseBlocked, true, "documented audited purchase result");
g_Assert.equal(g_DocumentedAudit.PlayerRestricted, true, "documented audited player query");
g_Assert.equal(g_DocumentedAudit.TeamRestricted, true, "documented audited team query");
g_Assert.equal(g_DocumentedAudit.HandlerRegistered, true, "documented audited registration");
g_Assert.equal(g_DocumentedAudit.HandlerCount, 1, "documented audited manager size");
g_Assert.equal(g_DocumentedAudit.IteratedHandlerCount, 1, "documented audited manager iterator count");
g_Assert.equal(g_DocumentedAudit.IteratorReturnedHandler, true, "documented audited manager iterator identity");

const g_DocumentedPlayerRestrictionEvent = g_DocumentedAudit.RestrictionEvents[0];
const g_DocumentedTeamRestrictionEvent = g_DocumentedAudit.RestrictionEvents[1];
g_Assert.equal(g_DocumentedAudit.RestrictionEvents.length, 2, "documented audited callback count");
g_Assert.equal(g_DocumentedPlayerRestrictionEvent.Kind, "player", "documented audited player event kind");
g_Assert.equal(g_DocumentedPlayerRestrictionEvent.PlayerUserID, 42, "documented audited player event user ID");
g_Assert.equal(g_DocumentedPlayerRestrictionEvent.WeaponName, "rifle", "documented audited player event weapon");
g_Assert.equal(g_DocumentedTeamRestrictionEvent.Kind, "team", "documented audited team event kind");
g_Assert.equal(g_DocumentedTeamRestrictionEvent.TeamNumber, 2, "documented audited team event number");
g_Assert.equal(g_DocumentedTeamRestrictionEvent.WeaponName, "smg", "documented audited team event weapon");
g_Assert.equal(g_DocumentedAudit.BlockDecisionAfterClear, null, "documented manager clear removes policy");
g_Assert.equal(g_DocumentedAudit.HandlerCountAfterClear, 1, "documented manager clear preserves registration");
g_Assert.equal(g_DocumentedAudit.HandlerRemoved, true, "documented manager removal");
g_Assert.equal(g_DocumentedAudit.HandlerReadded, true, "documented manager re-addition");
g_Assert.equal(g_DocumentedAudit.HandlerUnregistered, true, "documented handler unregister");
g_Assert.equal(g_DocumentedAudit.FinalHandlerCount, 0, "documented audited lifecycle ends empty");

g_Assert.equal(g_vecDocumentationModules[5].ShouldBlockWeaponBump(g_TestPlayer, "rifle"), false, "documented bump adapter permits unrestricted use");
g_Assert.equal(g_vecDocumentationModules[5].ShouldBlockWeaponPurchase(g_TestPlayer, "rifle"), false, "purchase adapter permits unrestricted use");

try {
	g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictGlobal("rifle"), true, "adapter-policy fixture restriction succeeds");
	g_Assert.equal(g_vecDocumentationModules[5].ShouldBlockWeaponBump(g_TestPlayer, "rifle"), true, "documented bump adapter blocks restricted use");
	g_Assert.equal(g_vecDocumentationModules[5].ShouldBlockWeaponPurchase(g_TestPlayer, "rifle"), true, "purchase adapter blocks restricted use");
} finally {
	g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictGlobal("rifle"), true, "adapter-policy fixture restoration succeeds");
}

g_Assert.deepEqual(CopyRestrictionState(g_DefaultHandler), g_RestrictionStateBeforeDocumentation, "documentation workflows restore restrictions");
g_Assert.equal(g_vecRemovedWeapons.length, g_unRemovedWeaponCountBeforeDocumentation, "documentation workflows remove no current weapon");

const g_ForbiddenDocumentationPattern = /Generated by|Player\(1\)|sourcejs:player|addHandler\("weapon_pistol"\)|console\.|const api =/;
g_Assert.doesNotMatch(g_strDocumentationSource, g_ForbiddenDocumentationPattern, "documentation is handwritten and action-oriented");
g_Assert.match(g_strDocumentationSource, /`Handler.Unregister\(\)` targets its current `ValueManager`/, "documentation describes current backing-manager targeting");
g_Assert.match(g_strDocumentationSource, /Empty arrays are valid/, "documentation includes empty bulk-operation effects");
g_Assert.match(g_strDocumentationSource, /All newly added names are stored before the first addition callback runs/, "documentation does not imply callback failure rolls back storage");
g_Assert.match(g_strDocumentationSource, /A returned promise is not awaited/, "documentation explains synchronous hook decisions");
g_Assert.match(g_strDocumentationSource, /attempts team cleanup before player cleanup, even if team cleanup throws/, "documentation describes independent cleanup attempts");

for (const strRelativeLink of ["weapons-entity.md", "weapons.md", "memory-hooks.md", "players-entity.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

try {
	g_Assert.equal(g_WeaponsRestrictionsAPI.RestrictGlobal("rifle"), true, "isolation source restriction add");
	const IsolatedWeaponsRestrictionsAPI = LoadWeaponsRestrictionsAPI();
	g_Assert.equal(IsolatedWeaponsRestrictionsAPI.CanUse(g_TestPlayer, "rifle"), true, "new module context does not inherit restriction state");
} finally {
	g_Assert.equal(g_WeaponsRestrictionsAPI.UnrestrictGlobal("rifle"), true, "isolation source restriction cleanup");
}

const g_vecMissingWeaponsRuntimeArguments = ["-e", `require(${JSON.stringify(g_strRestrictionsPath)});`];
const g_MissingWeaponsRuntimeResult = g_ChildProcess.spawnSync(process.execPath, g_vecMissingWeaponsRuntimeArguments, { encoding: "utf8", env: { ...process.env, NODE_PATH: g_strPackageRootPath }, timeout: g_unChildTimeoutMilliseconds });
g_Assert.equal(g_MissingWeaponsRuntimeResult.error, undefined, "missing-runtime child starts and finishes before the timeout");
g_Assert.equal(g_MissingWeaponsRuntimeResult.signal, null, "missing-runtime child is not terminated by a signal");
g_Assert.equal(g_MissingWeaponsRuntimeResult.status, 1, "weapons/restrictions requires the native weapons runtime");
g_Assert.match(g_MissingWeaponsRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

VerifyWorldRestrictionExample(g_WeaponsRestrictionsAPI);

console.log("[  OK  ] smoke_weapons_restrictions");
