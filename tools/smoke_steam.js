#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "steam.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strMemoryPath = g_Path.join(g_strPackageRootPath, "memory.js");
const g_strMemoryHelpersPath = g_Path.join(g_strPackageRootPath, "memory", "helpers.js");
const g_strSteamPath = g_Path.join(g_strPackageRootPath, "steam.js");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unParsedSteamIDValue = 76561197960265733n;
const g_unUpdatedSteamIDValue = g_unParsedSteamIDValue + 2n;
const g_unAddress = 0x4000n;
const g_unMaximumSteamIDValue = 0xFFFFFFFFFFFFFFFFn;
const g_unMockAllocationAddressGap = 0x10n;

const g_mapMemoryValues = new Map();
const g_mapMemoryAllocations = new Map();
const g_mapRegisteredObjectTypes = new Map();
const g_vecNativeCallLog = [];
let g_unNextAddress = 0x8000n;

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_LoaderDescriptor?.value;
const g_mapPackageCacheDescriptors = new Map();
let g_bSourceJSOwned = false;
let g_bLoaderOwned = false;
let g_bPackageCacheOwned = false;

function RestoreFixtureProperty(Target, strKey, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strKey, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned Steam fixture property must be removable: " + strKey);
}

function ReleaseSteamFixture() {
	const vecFailures = [];
	const AttemptRestoration = (Restore) => {
		try {
			Restore();
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	};

	if (g_bLoaderOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(g_Module, "_load", g_LoaderDescriptor);
			g_bLoaderOwned = false;
		});
	}

	if (g_bPackageCacheOwned) {
		const unPreviousFailureCount = vecFailures.length;
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
				AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapPackageCacheDescriptors) {
			AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, Descriptor));
		}

		if (vecFailures.length === unPreviousFailureCount) {
			g_bPackageCacheOwned = false;
		}
	}

	if (g_bSourceJSOwned) {
		AttemptRestoration(() => {
			RestoreFixtureProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
			g_bSourceJSOwned = false;
		});
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Steam fixture restoration failed.");
	}

	process.removeListener("exit", ReleaseSteamFixture);
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Steam runtime fixture must support exact restoration.");
g_Assert.ok(g_LoaderDescriptor && g_LoaderDescriptor.configurable && (typeof g_OriginalModuleLoad === "function"), "Steam loader must support exact restoration.");

for (const Descriptor of g_mapPackageCacheDescriptors.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed Steam cache entries must support exact restoration.");
}

// Exit cleanup also restores borrowed state after synchronous assertion failures.
process.once("exit", ReleaseSteamFixture);
g_bPackageCacheOwned = true;

for (const strModulePath of g_mapPackageCacheDescriptors.keys()) {
	RestoreFixtureProperty(require.cache, strModulePath, undefined);
}

function InstallDependency(strModulePath, ModuleExports) {
	Object.defineProperty(require.cache, strModulePath, {
		configurable: true,
		enumerable: true,
		writable: true,
		value: {
			children: [],
			exports: ModuleExports,
			filename: strModulePath,
			id: strModulePath,
			loaded: true,
			paths: [],
		},
	});
}

function NormalizeSteamID(unSteamIDValue) {
	if ((typeof unSteamIDValue === "bigint") && (unSteamIDValue >= 0n) && (unSteamIDValue <= g_unMaximumSteamIDValue)) {
		return unSteamIDValue;
	}

	throw new TypeError("Value must be an unsigned 64-bit BigInt SteamID.");
}

function CreateSteamIDFieldsRecord(unSteamIDValue) {
	const unNormalizedSteamIDValue = NormalizeSteamID(unSteamIDValue);
	const unAccountID = (unNormalizedSteamIDValue === g_unUpdatedSteamIDValue) ? 7 : 5;

	return {
		AccountID: unAccountID,
		AccountInstance: 1,
		AccountType: 1,
		StaticAccountKey: (unNormalizedSteamIDValue === g_unUpdatedSteamIDValue) ? g_unUpdatedSteamIDValue : 76561193665298437n,
		Universe: 1,
		Valid: unNormalizedSteamIDValue !== 0n,
		Value: unNormalizedSteamIDValue,
	};
}

function CreateNativeSteamMock(Options = {}) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError("Options must be an object.");
	}

	const bIncludeSteamIDOption = Options.IncludeSteamID;
	const bIncludeXUIDOption = Options.IncludeXUID;
	const vecOmittedMethodNamesOption = Options.OmittedMethods;
	const bIncludeSteamID = (bIncludeSteamIDOption === undefined) ? true : bIncludeSteamIDOption;
	const bIncludeXUID = (bIncludeXUIDOption === undefined) ? true : bIncludeXUIDOption;
	const vecOmittedMethodNames = (vecOmittedMethodNamesOption === undefined) ? [] : vecOmittedMethodNamesOption;

	if ((typeof bIncludeSteamID !== "boolean") || (typeof bIncludeXUID !== "boolean")) {
		throw new TypeError("IncludeSteamID and IncludeXUID must be booleans.");
	}

	if (!Array.isArray(vecOmittedMethodNames)) {
		throw new TypeError("OmittedMethods must be an array.");
	}

	const setOmittedMethodNames = new Set(vecOmittedMethodNames);

	const NativeSteam = {
		STEAM_BRANCH: "l4d2",

		GetNetworkID(unPlayerIndex) {
			if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 1)) {
				throw new TypeError("Index must be a positive integer.");
			}

			g_vecNativeCallLog.push(["GetNetworkID", unPlayerIndex]);

			return "STEAM_1:1:2";
		},
	};

	if (bIncludeXUID) {
		NativeSteam.GetXUID = function GetXUID(unPlayerIndex) {
			if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 1)) {
				throw new TypeError("Index must be a positive integer.");
			}

			g_vecNativeCallLog.push(["GetXUID", unPlayerIndex]);

			return g_unParsedSteamIDValue;
		};
	}

	if (!bIncludeSteamID) {
		return NativeSteam;
	}

	Object.assign(NativeSteam, {
		AccountType: {
			AnonymousGameServer: 4,
			AnonymousUser: 10,
			Chat: 8,
			Clan: 7,
			ContentServer: 6,
			GameServer: 3,
			Individual: 1,
			Invalid: 0,
			Multiseat: 2,
			P2PSuperSeeder: 9,
			Pending: 5,
		},
		STEAM_ID_SIZE: 8,
		Universe: {
			Beta: 2,
			Dev: 4,
			Internal: 3,
			Invalid: 0,
			Max: 6,
			Public: 1,
		},

		SteamIDClear() {
			return 0n;
		},

		SteamIDClearIndividualInstance(unSteamIDValue) {
			g_vecNativeCallLog.push(["SteamIDClearIndividualInstance", unSteamIDValue]);

			return NormalizeSteamID(unSteamIDValue);
		},

		SteamIDCreateBlankAnonymousLogon(unUniverse) {
			g_vecNativeCallLog.push(["SteamIDCreateBlankAnonymousLogon", unUniverse]);

			return 4n;
		},

		SteamIDCreateBlankAnonymousUserAccount(unUniverse) {
			g_vecNativeCallLog.push(["SteamIDCreateBlankAnonymousUserAccount", unUniverse]);

			return 10n;
		},

		SteamIDFields(unSteamIDValue) {
			g_vecNativeCallLog.push(["SteamIDFields", unSteamIDValue]);

			return CreateSteamIDFieldsRecord(unSteamIDValue);
		},

		SteamIDFullSet(unSteamIDIdentifier, unUniverse, unAccountType) {
			g_vecNativeCallLog.push(["SteamIDFullSet", unSteamIDIdentifier, unUniverse, unAccountType]);

			return NormalizeSteamID(unSteamIDIdentifier);
		},

		SteamIDHasNoIndividualInstance(unSteamIDValue) {
			g_vecNativeCallLog.push(["SteamIDHasNoIndividualInstance", unSteamIDValue]);

			return false;
		},

		SteamIDInstancedSet(unAccountID, unAccountInstance, unUniverse, unAccountType) {
			g_vecNativeCallLog.push(["SteamIDInstancedSet", unAccountID, unAccountInstance, unUniverse, unAccountType]);

			return (unAccountID === 7) ? g_unUpdatedSteamIDValue : g_unParsedSteamIDValue;
		},

		SteamIDIsAnonymousAccount() {
			return false;
		},

		SteamIDIsAnonymousGameServerAccount() {
			return false;
		},

		SteamIDIsAnonymousUserAccount() {
			return false;
		},

		SteamIDIsBlankAnonymousAccount() {
			return false;
		},

		SteamIDIsChatAccount() {
			return false;
		},

		SteamIDIsClanAccount() {
			return false;
		},

		SteamIDIsConsoleUserAccount() {
			return false;
		},

		SteamIDIsContentServerAccount() {
			return false;
		},

		SteamIDIsGameServerAccount() {
			return false;
		},

		SteamIDIsIndividualAccount() {
			return true;
		},

		SteamIDIsLobby() {
			return false;
		},

		SteamIDIsPersistentGameServerAccount() {
			return false;
		},

		SteamIDIsValid(unSteamIDValue) {
			return NormalizeSteamID(unSteamIDValue) !== 0n;
		},

		SteamIDNormalize: NormalizeSteamID,

		SteamIDParse(strSteamIDText) {
			g_vecNativeCallLog.push(["SteamIDParse", strSteamIDText]);

			if (!["STEAM_0:1:2", "STEAM_1:1:2", "[U:1:5]"].includes(strSteamIDText)) {
				throw new Error("Unexpected SteamID parse input.");
			}

			return g_unParsedSteamIDValue;
		},

		SteamIDSet(unAccountID, unUniverse, unAccountType) {
			g_vecNativeCallLog.push(["SteamIDSet", unAccountID, unUniverse, unAccountType]);

			return (unAccountID === 7) ? g_unUpdatedSteamIDValue : g_unParsedSteamIDValue;
		},

		SteamIDStaticAccountKey(unSteamIDValue) {
			return CreateSteamIDFieldsRecord(unSteamIDValue).StaticAccountKey;
		},

		SteamIDToSteamID2(unSteamIDValue) {
			g_vecNativeCallLog.push(["SteamIDToSteamID2", unSteamIDValue]);

			return "STEAM_1:1:2";
		},

		SteamIDToSteamID3(unSteamIDValue) {
			g_vecNativeCallLog.push(["SteamIDToSteamID3", unSteamIDValue]);

			return "[U:1:5]";
		},
	});

	for (const strMethodName of setOmittedMethodNames) {
		delete NativeSteam[strMethodName];
	}

	return NativeSteam;
}

const g_MemoryAPI = {
	DataType: {
		ULongLong: "ulonglong",
	},

	Allocate(unSize) {
		if (!Number.isSafeInteger(unSize) || (unSize < 1)) {
			throw new TypeError("Size must be a positive integer.");
		}

		const unAllocatedAddress = g_unNextAddress;
		g_unNextAddress += BigInt(unSize) + g_unMockAllocationAddressGap;
		g_mapMemoryAllocations.set(unAllocatedAddress, unSize);
		g_mapMemoryValues.set(unAllocatedAddress, 0n);

		return unAllocatedAddress;
	},

	Deallocate(unAddress) {
		const unSize = g_mapMemoryAllocations.get(unAddress);
		if (unSize === undefined) {
			return false;
		}

		g_mapMemoryAllocations.delete(unAddress);

		for (const unStoredAddress of g_mapMemoryValues.keys()) {
			if ((unStoredAddress >= unAddress) && (unStoredAddress < (unAddress + BigInt(unSize)))) {
				g_mapMemoryValues.delete(unStoredAddress);
			}
		}

		return true;
	},

	RegisterObjectType(strName, Constructor, Options = {}) {
		const unSize = Options.Size;
		g_mapRegisteredObjectTypes.set(strName, { Constructor: Constructor, Size: unSize });

		return Constructor;
	},
};

const g_MemoryHelpers = {
	Add(unAddress, nAddressOffset) {
		return unAddress + nAddressOffset;
	},

	IsNull(unAddress) {
		return unAddress === 0n;
	},

	Read(unAddress, strDataType, nAddressOffset) {
		g_Assert.equal(strDataType, "ulonglong", "read data type");

		const unTargetAddress = unAddress + nAddressOffset;
		const unStoredValue = g_mapMemoryValues.get(unTargetAddress);

		return (unStoredValue === undefined) ? 0n : unStoredValue;
	},

	Write(unAddress, strDataType, unSteamIDValue, nAddressOffset) {
		g_Assert.equal(strDataType, "ulonglong", "write data type");

		const unTargetAddress = unAddress + nAddressOffset;
		g_mapMemoryValues.set(unTargetAddress, NormalizeSteamID(unSteamIDValue));

		return true;
	},
};

InstallDependency(g_strMemoryPath, g_MemoryAPI);
InstallDependency(g_strMemoryHelpersPath, g_MemoryHelpers);

function LoadSteamAPI(NativeSteam) {
	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { steam: NativeSteam } });
	g_bSourceJSOwned = true;
	RestoreFixtureProperty(require.cache, g_strSteamPath, undefined);

	return require(g_strSteamPath);
}

Object.defineProperty(g_Module, "_load", {
	...g_LoaderDescriptor,
	writable: true,
	value: function LoadSteamTestModule(strRequest, Parent, bIsMain) {
		if (strRequest === "internal/runtime") {
			return g_OriginalModuleLoad(g_strInternalRuntimePath, Parent, bIsMain);
		}

		if (strRequest === "memory") {
			return g_OriginalModuleLoad(g_strMemoryPath, Parent, bIsMain);
		}

		if (strRequest === "memory/helpers") {
			return g_OriginalModuleLoad(g_strMemoryHelpersPath, Parent, bIsMain);
		}

		return g_OriginalModuleLoad(strRequest, Parent, bIsMain);
	},
});
g_bLoaderOwned = true;

const g_Steam = LoadSteamAPI(CreateNativeSteamMock());

function VerifySteamIDConstructorConversionSnapshot() {
	for (const Construct of [
		(SteamValue) => new g_Steam.SteamID(SteamValue),
		(SteamValue) => g_Steam.SteamID.CreateFromValue(SteamValue),
	]) {
		let unMethodReadCount = 0;
		let unMethodCallCount = 0;
		const SteamIDLike = {
			get ConvertSteamIDToUInt64() {
				unMethodReadCount++;

				if (unMethodReadCount > 1) {
					throw new Error("A checked conversion method must not be read again.");
				}

				return function ConvertSteamValue() {
					g_Assert.equal(this, SteamIDLike, "conversion retains the source object receiver");
					unMethodCallCount++;

					return g_unParsedSteamIDValue;
				};
			},
		};
		const SteamIDInstance = Construct(SteamIDLike);
		g_Assert.equal(SteamIDInstance.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "constructor uses the checked conversion method");
		g_Assert.equal(unMethodReadCount, 1, "conversion getter is read once");
		g_Assert.equal(unMethodCallCount, 1, "conversion method is called once");

		const InheritedSteamIDLike = Object.create({
			get ConvertSteamIDToUInt64() {
				return function ConvertInheritedSteamValue() {
					g_Assert.equal(this, InheritedSteamIDLike, "inherited conversion retains its receiver");

					return g_unParsedSteamIDValue;
				};
			},
		});
		g_Assert.equal(Construct(InheritedSteamIDLike).ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "inherited conversion is supported");

		for (const ExpectedError of [
			new Error("Conversion getter failed"),
			null,
			undefined,
			0,
			false,
			"",
			Symbol("Conversion getter failed"),
		]) {
			let unFailedReadCount = 0;
			const FailedSteamIDLike = {
				get ConvertSteamIDToUInt64() {
					unFailedReadCount++;
					throw ExpectedError;
				},
			};
			let bFailed = false;
			let CaughtError = undefined;

			try {
				Construct(FailedSteamIDLike);
			} catch (ThrownError) {
				bFailed = true;
				CaughtError = ThrownError;
			}

			g_Assert.equal(bFailed, true, "conversion getter failure propagates");
			g_Assert.equal(CaughtError, ExpectedError, "conversion getter failure is preserved unchanged");
			g_Assert.equal(unFailedReadCount, 1, "failed conversion getter is not retried");
		}

		for (const ExpectedError of [
			new Error("Conversion method failed"),
			null,
			undefined,
			0,
			false,
			"",
			Symbol("Conversion method failed"),
		]) {
			let unFailedCallCount = 0;
			const FailedSteamIDLike = {
				ConvertSteamIDToUInt64() {
					unFailedCallCount++;
					throw ExpectedError;
				},
			};
			let bFailed = false;
			let CaughtError = undefined;

			try {
				Construct(FailedSteamIDLike);
			} catch (ThrownError) {
				bFailed = true;
				CaughtError = ThrownError;
			}

			g_Assert.equal(bFailed, true, "conversion method failure propagates");
			g_Assert.equal(CaughtError, ExpectedError, "conversion method failure is preserved unchanged");
			g_Assert.equal(unFailedCallCount, 1, "failed conversion method is not retried");
		}

		for (const InvalidValue of [
			-1n,
			0x10000000000000000n,
			1,
			"1",
			null,
			undefined,
			false,
			{},
		]) {
			const SteamIDLike = {
				ConvertSteamIDToUInt64() {
					return InvalidValue;
				},
			};
			g_Assert.throws(() => Construct(SteamIDLike), TypeError, "converted value must be an unsigned 64-bit BigInt");
		}

		for (const unBoundaryValue of [0n, 0xFFFFFFFFFFFFFFFFn]) {
			const SteamIDLike = {
				ConvertSteamIDToUInt64() {
					return unBoundaryValue;
				},
			};
			g_Assert.equal(Construct(SteamIDLike).ConvertSteamIDToUInt64(), unBoundaryValue, "converted unsigned 64-bit boundary is exact");
		}
	}

	let unMethodReadCount = 0;
	const SourceSteamID = new g_Steam.SteamID(g_unParsedSteamIDValue);
	Object.defineProperty(SourceSteamID, "ConvertSteamIDToUInt64", {
		get() {
			unMethodReadCount++;

			return function ConvertExistingSteamValue() {
				g_Assert.equal(this, SourceSteamID, "existing SteamID conversion retains its receiver");

				return g_unUpdatedSteamIDValue;
			};
		},
	});
	g_Assert.equal(new g_Steam.SteamID(SourceSteamID).ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "real SteamID conversion still uses its current method");
	g_Assert.equal(g_Steam.SteamID.CreateFromValue(SourceSteamID), SourceSteamID, "CreateFromValue preserves real SteamID identity without conversion");
	g_Assert.equal(unMethodReadCount, 1, "real SteamID conversion getter is read once");
}

VerifySteamIDConstructorConversionSnapshot();

function VerifySteamIDValueAndAttachmentContracts() {
	const unBorrowedAddress = g_unAddress + 0x100n;
	const bHadMemoryValue = g_mapMemoryValues.has(unBorrowedAddress);
	const SavedMemoryValue = g_mapMemoryValues.get(unBorrowedAddress);
	const unAllocationCount = g_mapMemoryAllocations.size;
	const SteamIDInstance = new g_Steam.SteamID(g_unParsedSteamIDValue);
	g_mapMemoryValues.set(unBorrowedAddress, g_unUpdatedSteamIDValue);

	try {
		SteamIDInstance.Address = unBorrowedAddress;
		g_Assert.equal(SteamIDInstance.Value, g_unParsedSteamIDValue, "attachment does not replace detached Value");
		g_Assert.equal(SteamIDInstance.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "attachment reads the current foreign memory");
		g_Assert.equal(g_mapMemoryValues.get(unBorrowedAddress), g_unUpdatedSteamIDValue, "attachment does not overwrite foreign memory");
		SteamIDInstance.SetNativeValue(0n);
		g_Assert.equal(g_mapMemoryValues.get(unBorrowedAddress), 0n, "attached mutation writes through");
		g_Assert.equal(SteamIDInstance.Value, g_unParsedSteamIDValue, "attached mutation leaves detached Value unchanged");
		const SnapshotSteamID = SteamIDInstance.CopySteamID();
		g_Assert.equal(SnapshotSteamID.Address, 0n, "copy snapshots into detached state");
		g_Assert.equal(SnapshotSteamID.ConvertSteamIDToUInt64(), 0n, "copy captures current memory rather than detached Value");
		SteamIDInstance.Address = 0n;
		g_Assert.equal(SteamIDInstance.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "detachment restores the existing Value");
		g_Assert.equal(g_mapMemoryValues.get(unBorrowedAddress), 0n, "detachment does not free or change foreign memory");
		const FreshView = g_Steam.SteamID.CreateFromAddress(unBorrowedAddress);
		FreshView.Address = 0n;
		g_Assert.equal(FreshView.ConvertSteamIDToUInt64(), 0n, "fresh detached view has the cleared Value");
		g_Assert.equal(g_mapMemoryAllocations.size, unAllocationCount, "attachment and copying do not acquire foreign-memory ownership");

		SteamIDInstance.Value = "invalid";
		g_Assert.equal(SteamIDInstance.Value, "invalid", "Value is an ordinary field without assignment-time normalization");
		g_Assert.throws(() => SteamIDInstance.ConvertSteamIDToUInt64(), TypeError, "detached read validates Value");
		SteamIDInstance.SetNativeValue(g_unParsedSteamIDValue);

		for (const InvalidValue of [
			-1n,
			0x10000000000000000n,
			1,
			"1",
			null,
			undefined,
			false,
			{},
		]) {
			g_Assert.throws(() => SteamIDInstance.SetNativeValue(InvalidValue), TypeError, "SetNativeValue validates the unsigned 64-bit input");
			g_Assert.equal(SteamIDInstance.Value, g_unParsedSteamIDValue, "failed normalization does not replace detached Value");
			g_Assert.equal(g_mapMemoryValues.get(unBorrowedAddress), 0n, "failed normalization does not touch foreign memory");
		}

		for (const Apply of [
			(SteamValue) => SteamIDInstance.AreEqual(SteamValue),
			(SteamValue) => SteamIDInstance.Compare(SteamValue),
			(SteamValue) => SteamIDInstance.CopySteamIDFrom(SteamValue),
		]) {
			let unMethodReadCount = 0;
			const SteamIDLike = {
				get ConvertSteamIDToUInt64() {
					unMethodReadCount++;

					return () => g_unParsedSteamIDValue;
				},
			};
			g_Assert.throws(() => Apply(SteamIDLike), TypeError, "comparison and copy do not accept foreign conversion objects");
			g_Assert.equal(unMethodReadCount, 0, "comparison and copy do not access a foreign conversion getter");
			g_Assert.throws(() => Apply(g_unParsedSteamIDValue.toString()), TypeError, "comparison and copy do not parse strings");
			g_Assert.doesNotThrow(() => Apply(g_unParsedSteamIDValue), "comparison and copy accept exact BigInt input");
			g_Assert.doesNotThrow(() => Apply(new g_Steam.SteamID(g_unParsedSteamIDValue)), "comparison and copy accept real SteamID input");
		}
	} finally {
		if (bHadMemoryValue) {
			g_mapMemoryValues.set(unBorrowedAddress, SavedMemoryValue);
		} else {
			g_mapMemoryValues.delete(unBorrowedAddress);
		}
	}
}

VerifySteamIDValueAndAttachmentContracts();

function VerifyWorldSteamSnapshots(SteamAPI) {
	const unScriptTimeoutMilliseconds = 1000;

	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const nExampleStart = strExample.indexOf('\tLogResult("steam current player identities",');
	const nExampleEnd = strExample.indexOf('\tLogResult("netchannel.NET_FLOW values",', nExampleStart);
	g_Assert.ok((nExampleStart >= 0) && (nExampleEnd > nExampleStart), "world Steam snapshot callbacks must remain available");

	const nCleanupStart = strExample.indexOf("\nfunction UseCleanup(");
	const nCleanupEnd = strExample.indexOf("\nfunction GetCommandArguments(", nCleanupStart);
	g_Assert.ok((nCleanupStart >= 0) && (nCleanupEnd > nCleanupStart));

	const strExampleSource = `${strExample.slice(nCleanupStart, nCleanupEnd)}\n${strExample.slice(nExampleStart, nExampleEnd)}`;

	const vecProfiles = [
		[],
		[{ Connected: false, FakeClient: false, Index: 1 }],
		[{ Connected: true, FakeClient: true, Index: 2 }],
		[{ Connected: true, FakeClient: true, Index: 2 }, { Connected: true, FakeClient: false, Index: 3 }],
	];
	for (const vecPlayers of vecProfiles) {
		const mapOriginalAllocations = new Map(g_mapMemoryAllocations);
		const mapResults = new Map();
		g_VM.runInNewContext(strExampleSource, {
			...SteamAPI,
			...g_MemoryAPI,
			GetAllPlayers: () => vecPlayers,
			GetObjectAddress: (Value) => Value.Address,
			LogResult: (strLabel, Callback) => mapResults.set(strLabel, Callback()),
			MakeObject: (Constructor, unAddress) => Constructor.CreateFromAddress(unAddress),
			ObjectTypeSize: (Constructor) => {
				g_Assert.equal(Constructor, SteamAPI.SteamID);

				return SteamAPI.STEAM_ID_SIZE;
			},
		}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
		g_Assert.equal(mapResults.size, 2);
		g_Assert.deepEqual(g_mapMemoryAllocations, mapOriginalAllocations, "world Steam example must release its allocation");

		const Identities = mapResults.get("steam current player identities");
		const Memory = mapResults.get("steam.SteamID detached and live memory");
		g_Assert.deepEqual(Array.from(Identities.Players, (Player) => Player.Index), vecPlayers.filter((Player) => Player.Connected).map((Player) => Player.Index));
		g_Assert.equal(Identities.Players.every((Player) => Object.hasOwn(Player, "XUID") === (typeof SteamAPI.GetXUID === "function")), true);
		g_Assert.equal(Memory.Available, typeof SteamAPI.SteamID === "function");

		if (!Memory.Available) {
			continue;
		}

		const Human = vecPlayers.find((Player) => Player.Connected && !Player.FakeClient) ?? null;
		g_Assert.equal(Memory.Player?.Index ?? null, Human?.Index ?? null);
		g_Assert.equal(typeof Memory.Live.Address, "bigint");
		g_Assert.equal(typeof Memory.Live.Value, "bigint");
		g_Assert.equal(Memory.Live.CopiedHasAddress, false);
	}

	if (typeof SteamAPI.SteamID !== "function") {
		return;
	}

	const FlattenErrors = (Failure) => Array.isArray(Failure?.errors) ? Array.from(Failure.errors).flatMap(FlattenErrors) : [Failure];
	const vecBodyProfiles = [
		{ Failed: false },
		...[
			undefined,
			null,
			false,
			0,
			"opaque Steam error",
			Object.freeze(new Error("opaque Steam error")),
		].map((Failure) => ({ Failed: true, Failure })),
	];
	let unScenarios = 0;
	for (const Body of vecBodyProfiles) {
		for (const strReleaseMode of ["", "FALSE", "THROW"]) {
			const mapBefore = new Map(g_mapMemoryAllocations);
			const ReleaseError = Object.freeze(new Error("Unknown Steam allocation release outcome."));
			let unReleases = 0;
			let bCaught = false;
			let Failure = undefined;

			try {
				g_VM.runInNewContext(strExampleSource, {
					...SteamAPI,
					...g_MemoryAPI,
					GetAllPlayers: () => [],
					GetObjectAddress: (Value) => Value.Address,
					LogResult: (strLabel, Callback) => {
						g_Assert.ok(strLabel.startsWith("steam"));

						return Callback();
					},

					MakeObject: (Constructor, unAddress) => {
						if (Body.Failed) {
							throw Body.Failure;
						}

						return Constructor.CreateFromAddress(unAddress);
					},

					ObjectTypeSize: (Constructor) => {
						g_Assert.equal(Constructor, SteamAPI.SteamID);

						return SteamAPI.STEAM_ID_SIZE;
					},

					Deallocate: (unAddress) => {
						unReleases += 1;
						const bReleased = g_MemoryAPI.Deallocate(unAddress);

						if (strReleaseMode === "THROW") {
							throw ReleaseError;
						}

						return (strReleaseMode === "FALSE") ? false : bReleased;
					},
				}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
			} catch (CaughtError) {
				bCaught = true;
				Failure = CaughtError;
			}

			g_Assert.equal(unReleases, 1, "Steam allocation release must not be retried");
			g_Assert.deepEqual(g_mapMemoryAllocations, mapBefore);
			g_Assert.equal(bCaught, Body.Failed || Boolean(strReleaseMode));

			if (bCaught) {
				const vecFailures = FlattenErrors(Failure);
				g_Assert.equal(vecFailures.length, Number(Body.Failed) + Number(Boolean(strReleaseMode)));

				if (Body.Failed) {
					g_Assert.equal(vecFailures[0], Body.Failure);
				}

				if (strReleaseMode === "THROW") {
					g_Assert.equal(vecFailures.at(-1), ReleaseError);
				}
			}

			unScenarios += 1;
		}
	}

	console.log(`[world Steam example] ${unScenarios} operation/release scenarios; controlled memory doubles, not native heap proof`);
}

function ExecuteCodeBlock(strCode, BlockIdentifier, MemoryAPI = g_MemoryAPI, SteamAPI = g_Steam) {
	const unCompilationTimeoutMilliseconds = 1000;

	const strDocumentationBlockPath = `${g_strDocumentationPath}:block-${BlockIdentifier}.js`;
	const ModuleRecord = new g_Module(strDocumentationBlockPath, module);
	ModuleRecord.filename = strDocumentationBlockPath;
	ModuleRecord.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDocumentationPath));
	ModuleRecord.require = function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "memory") {
			return MemoryAPI;
		}

		if (strIdentifier === "steam") {
			return SteamAPI;
		}

		throw new Error(`Unexpected steam documentation import in block ${BlockIdentifier}: ${strIdentifier}.`);
	};

	g_VM.runInNewContext("Compile();", {
		Compile() {
			ModuleRecord._compile(strCode, strDocumentationBlockPath);
		},
	}, { filename: strDocumentationBlockPath, timeout: unCompilationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

function NormalizeHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CaptureSteamFailure(Invoke) {
	const Failure = { Failed: false, Error: undefined };

	try {
		Invoke();
	} catch (CaughtError) {
		Failure.Failed = true;
		Failure.Error = CaughtError;
	}

	return Failure;
}

function VerifySteamMemoryWorkflowFailures(strCode) {
	const vecThrownValues = [
		new Error("Steam memory workflow failed"),
		null,
		undefined,
		0,
		false,
		"",
		Symbol("Steam memory workflow failed"),
	];
	const vecOperations = [{ Failed: false }, ...vecThrownValues.map((Error) => ({ Failed: true, Error }))];
	const vecCleanups = [
		{ Failed: false, Throws: false },
		{ Failed: true, Throws: false },
		...vecThrownValues.map((Error) => ({ Failed: true, Throws: true, Error })),
	];

	for (const strStage of [
		"CreateFromAddress",
		"WriteAddressValue",
		"SetNativeValue",
		"ReadAddressValue",
		"CopySteamID",
		"HasAddress",
	]) {
		for (const Error of vecThrownValues) {
			vecOperations.push({ Failed: true, Error, Stage: strStage });
		}
	}

	for (const Operation of vecOperations) {
		for (const Cleanup of vecCleanups) {
			const unAllocationCount = g_mapMemoryAllocations.size;
			let unAllocatedAddress = 0n;
			let unAllocateCallCount = 0;
			let unDeallocateCallCount = 0;
			const MemoryAPI = {
				Allocate(unByteCount) {
					unAllocateCallCount++;
					unAllocatedAddress = g_MemoryAPI.Allocate(unByteCount);

					return unAllocatedAddress;
				},

				Deallocate(unAddress) {
					unDeallocateCallCount++;
					g_Assert.equal(unAddress, unAllocatedAddress, "cleanup uses the original owner address");

					if (Cleanup.Throws) {
						throw Cleanup.Error;
					}

					return Cleanup.Failed ? false : g_MemoryAPI.Deallocate(unAddress);
				},
			};

			class StageSteamID extends g_Steam.SteamID {
				static CreateFromAddress(unAddress, nAddressOffset) {
					if (Operation.Stage === "CreateFromAddress") {
						throw Operation.Error;
					}

					const View = g_Steam.SteamID.CreateFromAddress(unAddress, nAddressOffset);
					if (Operation.Stage !== undefined) {
						Object.defineProperty(View, Operation.Stage, {
							value() {
								throw Operation.Error;
							},
						});
					}

					return View;
				}
			}

			const SteamAPI = { ...g_Steam, SteamID: StageSteamID };
			const { CopySteamIDThroughMemory } = ExecuteCodeBlock(strCode, "memory-failure", MemoryAPI, SteamAPI);
			const SteamValue = (Operation.Failed && (Operation.Stage === undefined)) ? {
				ConvertSteamIDToUInt64() {
					throw Operation.Error;
				},
			} : g_unParsedSteamIDValue;
			let Result = undefined;
			const Failure = CaptureSteamFailure(() => {
				Result = CopySteamIDThroughMemory(SteamValue);
			});

			try {
				g_Assert.equal(unAllocateCallCount, 1, "workflow allocates exactly once");
				g_Assert.equal(unDeallocateCallCount, 1, "workflow attempts cleanup exactly once");
				g_Assert.equal(Failure.Failed, Operation.Failed || Cleanup.Failed, "workflow reports operation and cleanup failures");

				if (Cleanup.Failed) {
					g_Assert.equal(Failure.Error.UnreleasedAddress, unAllocatedAddress, "cleanup failure exposes the recoverable owner");
					g_Assert.equal(g_mapMemoryAllocations.has(unAllocatedAddress), true, "failed cleanup leaves the allocation for controlled recovery");
					const CleanupError = Operation.Failed ? Failure.Error.errors[1] : Failure.Error.cause;

					if (Operation.Failed) {
						g_Assert.equal(Failure.Error.name, "AggregateError", "combined failure is aggregated");
						g_Assert.equal(Failure.Error.errors.length, 2, "both failures are retained");
						g_Assert.equal(Failure.Error.errors[0], Operation.Error, "operation failure identity is retained");
					}

					if (Cleanup.Throws) {
						g_Assert.equal(CleanupError, Cleanup.Error, "cleanup failure identity is retained");

					} else {
						g_Assert.match(CleanupError.message, /Deallocate\(\) did not release/, "false cleanup result is not ignored");
					}

				} else if (Operation.Failed) {
					g_Assert.equal(Failure.Error, Operation.Error, "successful cleanup preserves the original thrown value");

				} else {
					g_Assert.equal(Result.DetachedSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "successful workflow returns the detached snapshot");
				}
			} finally {
				if (g_mapMemoryAllocations.has(unAllocatedAddress)) {
					g_Assert.equal(g_MemoryAPI.Deallocate(unAllocatedAddress), true, "test owner is released after failure verification");
				}
			}

			g_Assert.equal(g_mapMemoryAllocations.size, unAllocationCount, "failure scenario leaves no test-owned allocation");
		}
	}

	for (const InvalidAddress of [
		0n,
		-1n,
		0,
		"0x4000",
		null,
		undefined,
		{},
	]) {
		let unDeallocateCallCount = 0;
		const MemoryAPI = {
			Allocate() {
				return InvalidAddress;
			},

			Deallocate() {
				unDeallocateCallCount++;
			},
		};
		const { CopySteamIDThroughMemory } = ExecuteCodeBlock(strCode, "invalid-allocation", MemoryAPI);
		g_Assert.throws(() => CopySteamIDThroughMemory(g_unParsedSteamIDValue), /positive BigInt address/, "invalid allocation is rejected before attachment");
		g_Assert.equal(unDeallocateCallCount, 0, "no owner is assumed for an invalid allocation result");
	}

	for (const ExpectedError of vecThrownValues) {
		let unDeallocateCallCount = 0;
		const MemoryAPI = {
			Allocate() {
				throw ExpectedError;
			},

			Deallocate() {
				unDeallocateCallCount++;
			},
		};
		const { CopySteamIDThroughMemory } = ExecuteCodeBlock(strCode, "allocation-exception", MemoryAPI);
		const Failure = CaptureSteamFailure(() => CopySteamIDThroughMemory(g_unParsedSteamIDValue));
		g_Assert.equal(Failure.Failed, true, "allocation exception propagates");
		g_Assert.equal(Failure.Error, ExpectedError, "allocation exception identity is retained");
		g_Assert.equal(unDeallocateCallCount, 0, "throwing allocation creates no owner to release");
	}

	for (const nInvalidSize of [
		0,
		-1,
		1.5,
		NaN,
		Infinity,
		Number.MAX_SAFE_INTEGER + 1,
		Number.MAX_SAFE_INTEGER,
	]) {
		let unAllocateCallCount = 0;
		const MemoryAPI = {
			Allocate() {
				unAllocateCallCount++;
			},
		};
		const SteamAPI = { ...g_Steam, STEAM_ID_SIZE: nInvalidSize };
		const { CopySteamIDThroughMemory } = ExecuteCodeBlock(strCode, "invalid-extent", MemoryAPI, SteamAPI);
		g_Assert.throws(() => CopySteamIDThroughMemory(g_unParsedSteamIDValue), /memory support|allocation size/, "invalid or overflowing native extent is rejected");
		g_Assert.equal(unAllocateCallCount, 0, "extent validation precedes allocation");
	}
}

function VerifySteamOptionalMethodSnapshots(strClassifyCode, strAnonymousCode) {
	const { ClassifySteamID } = ExecuteCodeBlock(strClassifyCode, "predicate-snapshot");
	const vecMethodNames = Object.keys(ClassifySteamID(g_unParsedSteamIDValue));
	g_Assert.equal(vecMethodNames.length, 14, "every documented predicate is exercised by the full-capability fixture");

	const vecThrownValues = [
		new Error("Optional Steam method failed"),
		null,
		undefined,
		0,
		false,
		"",
		Symbol("Optional Steam method failed"),
	];

	for (const strMethodName of vecMethodNames) {
		let unGetterCallCount = 0;
		let unMethodCallCount = 0;
		const SteamIDInstance = new g_Steam.SteamID(g_unParsedSteamIDValue);
		Object.defineProperty(SteamIDInstance, strMethodName, {
			get() {
				unGetterCallCount++;

				if (unGetterCallCount > 1) {
					throw new Error("A checked predicate must not be read again.");
				}

				return function ReadSteamPredicate() {
					g_Assert.equal(this, SteamIDInstance, "predicate retains its receiver");
					unMethodCallCount++;

					return true;
				};
			},
		});
		g_Assert.equal(ClassifySteamID(SteamIDInstance)[strMethodName], true, "classification invokes the captured predicate");
		g_Assert.equal(unGetterCallCount, 1, "predicate getter is read once");
		g_Assert.equal(unMethodCallCount, 1, "predicate is invoked once");

		for (const ExpectedError of vecThrownValues) {
			for (const bGetterFailure of [true, false]) {
				const FailedSteamID = new g_Steam.SteamID(g_unParsedSteamIDValue);
				Object.defineProperty(FailedSteamID, strMethodName, {
					get() {
						if (bGetterFailure) {
							throw ExpectedError;
						}

						return () => {
							throw ExpectedError;
						};
					},
				});
				const Failure = CaptureSteamFailure(() => ClassifySteamID(FailedSteamID));
				g_Assert.equal(Failure.Failed, true, "predicate failure propagates");
				g_Assert.equal(Failure.Error, ExpectedError, "predicate failure identity is retained");
			}
		}
	}

	for (const bGetterFailure of [true, false]) {
		for (const Operation of [{ Failed: false }, ...vecThrownValues.map((Error) => ({ Failed: true, Error }))]) {
			const bFailed = Operation.Failed;
			const ExpectedError = Operation.Error;
			let unGetterCallCount = 0;
			let unMethodCallCount = 0;
			class SnapshotSteamID extends g_Steam.SteamID {
				get ClearIndividualInstance() {
					unGetterCallCount++;

					if (bFailed && bGetterFailure) {
						throw ExpectedError;
					}

					return function ClearCapturedIndividualInstance() {
						g_Assert.ok(this instanceof SnapshotSteamID, "optional clear retains its receiver");
						unMethodCallCount++;

						if (bFailed) {
							throw ExpectedError;
						}

						return g_Steam.SteamID.prototype.ClearIndividualInstance.call(this);
					};
				}
			}

			const SteamAPI = { ...g_Steam, SteamID: SnapshotSteamID };
			const { CreateAnonymousSteamIDs } = ExecuteCodeBlock(strAnonymousCode, "optional-clear-snapshot", g_MemoryAPI, SteamAPI);
			const Failure = CaptureSteamFailure(() => CreateAnonymousSteamIDs());
			g_Assert.equal(Failure.Failed, bFailed, "optional clear failure is reported");
			g_Assert.equal(Failure.Error, bFailed ? ExpectedError : undefined, "optional clear failure identity is retained");
			g_Assert.equal(unGetterCallCount, 1, "optional clear getter is read once");
			g_Assert.equal(unMethodCallCount, (bFailed && bGetterFailure) ? 0 : 1, "optional clear is invoked only after successful getter evaluation");
		}
	}
}

function ToPlainValue(Value) {
	if (Array.isArray(Value)) {
		const vecPlainValues = [];
		for (const Entry of Value) {
			vecPlainValues.push(ToPlainValue(Entry));
		}

		return vecPlainValues;
	}

	if ((Value !== null) && (typeof Value === "object")) {
		const PlainValue = {};
		for (const [strName, Entry] of Object.entries(Value)) {
			Object.defineProperty(PlainValue, strName, { configurable: true, enumerable: true, value: ToPlainValue(Entry), writable: true });
		}

		return PlainValue;
	}

	return Value;
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContentsMatch = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "steam contents section");

	const vecDocumentedAnchors = [];
	const DocumentedAnchorPattern = /\]\(#([^)]+)\)/g;
	let vecDocumentedAnchorMatch = DocumentedAnchorPattern.exec(vecContentsMatch[1]);
	while (vecDocumentedAnchorMatch !== null) {
		vecDocumentedAnchors.push(vecDocumentedAnchorMatch[1]);
		vecDocumentedAnchorMatch = DocumentedAnchorPattern.exec(vecContentsMatch[1]);
	}

	const vecSectionAnchors = [];
	const SectionPattern = /^## (.+)$/gm;
	let vecSectionMatch = SectionPattern.exec(strMarkdown);
	while (vecSectionMatch !== null) {
		const strSectionAnchor = NormalizeHeadingAnchor(vecSectionMatch[1]);
		if (strSectionAnchor !== "contents") {
			vecSectionAnchors.push(strSectionAnchor);
		}

		vecSectionMatch = SectionPattern.exec(strMarkdown);
	}

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "steam contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecLinkTargets = [];
	const LinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
	let vecLinkMatch = LinkPattern.exec(strDocumentationWithoutCode);
	while (vecLinkMatch !== null) {
		vecLinkTargets.push(vecLinkMatch[1]);
		vecLinkMatch = LinkPattern.exec(strDocumentationWithoutCode);
	}

	for (const strLinkTarget of vecLinkTargets) {
		if (strLinkTarget.startsWith("#") || /^[a-z]+:/i.test(strLinkTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strLinkTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `steam documentation link must exist: ${strLinkTarget}`);
	}
}

g_Assert.deepEqual(Object.keys(g_Steam).sort(), [
	"AccountType",
	"GetNetworkID",
	"GetXUID",
	"STEAM_BRANCH",
	"STEAM_ID_SIZE",
	"SteamID",
	"Universe",
], "exact full steam exports");
g_Assert.equal(g_Steam.STEAM_BRANCH, "l4d2", "selected SDK branch");
g_Assert.equal(g_Steam.STEAM_ID_SIZE, 8, "SteamID native size");
g_Assert.deepEqual(g_Steam.Universe, {
	Beta: 2,
	Dev: 4,
	Internal: 3,
	Invalid: 0,
	Max: 6,
	Public: 1,
}, "Universe constants");
g_Assert.deepEqual(g_Steam.AccountType, {
	AnonymousGameServer: 4,
	AnonymousUser: 10,
	Chat: 8,
	Clan: 7,
	ContentServer: 6,
	GameServer: 3,
	Individual: 1,
	Invalid: 0,
	Multiseat: 2,
	P2PSuperSeeder: 9,
	Pending: 5,
}, "L4D2 AccountType constants");

const g_vecExpectedMethodNames = [
	"Clear",
	"ClearIndividualInstance",
	"Compare",
	"constructor",
	"CopySteamID",
	"CopySteamIDFrom",
	"CopySteamIDTo",
	"CreateBlankAnonymousLogon",
	"CreateBlankAnonymousUserAccount",
	"AreEqual",
	"SetFull",
	"GetSteamIDFields",
	"HasNoIndividualInstance",
	"HasAddress",
	"SetInstanced",
	"IsAnonymousAccount",
	"IsAnonymousGameServerAccount",
	"IsAnonymousUserAccount",
	"IsBlankAnonymousAccount",
	"IsChatAccount",
	"IsClanAccount",
	"IsConsoleUserAccount",
	"IsContentServerAccount",
	"IsGameServerAccount",
	"IsIndividualAccount",
	"IsLobby",
	"IsPersistentGameServerAccount",
	"IsValid",
	"ReadAddressValue",
	"Set",
	"SetSteamIDFromUInt64",
	"SetNativeValue",
	"AccountID",
	"AccountInstance",
	"AccountType",
	"StaticAccountKey",
	"Universe",
	"ConvertSteamIDToSteamID2",
	"ConvertSteamIDToSteamID3",
	"toString",
	"ConvertSteamIDToUInt64",
	"WriteAddressValue",
].sort();

g_Assert.deepEqual(Object.getOwnPropertyNames(g_Steam.SteamID.prototype).sort(), g_vecExpectedMethodNames, "complete SteamID prototype");

const g_vecSteamIDStaticNames = [];
for (const strStaticName of Object.getOwnPropertyNames(g_Steam.SteamID)) {
	if ((strStaticName !== "length") && (strStaticName !== "name") && (strStaticName !== "prototype")) {
		g_vecSteamIDStaticNames.push(strStaticName);
	}
}

g_vecSteamIDStaticNames.sort();

g_Assert.deepEqual(g_vecSteamIDStaticNames, [
	"CreateFromAddress",
	"CreateFromValue",
	"Parse",
	"TypeSize",
], "SteamID static members");
g_Assert.equal(g_Steam.SteamID.TypeSize, g_Steam.STEAM_ID_SIZE, "SteamID type size");

const g_RegisteredSteamID = g_mapRegisteredObjectTypes.get("SteamID");
g_Assert.equal(g_RegisteredSteamID.Constructor, g_Steam.SteamID, "memory registration constructor");
g_Assert.equal(g_RegisteredSteamID.Size, g_Steam.STEAM_ID_SIZE, "memory registration size");

const g_RegisteredSteamIDView = g_RegisteredSteamID.Constructor.CreateFromAddress(g_unAddress);
g_Assert.ok(g_RegisteredSteamIDView instanceof g_Steam.SteamID, "registered factory constructs a SteamID view");
g_Assert.equal(g_RegisteredSteamIDView.Address, g_unAddress, "registered factory preserves the borrowed address");

g_Assert.equal(g_Steam.GetNetworkID(1), "STEAM_1:1:2", "GetNetworkID");
g_Assert.equal(g_Steam.GetXUID(1), g_unParsedSteamIDValue, "GetXUID");
g_Assert.throws(() => g_Steam.GetNetworkID({ Index: 1 }), TypeError, "network IDs require numeric indexes");

const g_BlankSteamID = new g_Steam.SteamID();
g_Assert.equal(g_BlankSteamID.ConvertSteamIDToUInt64(), 0n, "zero-argument constructor clears the ID");
g_Assert.equal(g_BlankSteamID.HasAddress(), false, "detached blank has no address");
g_Assert.throws(() => g_BlankSteamID.ReadAddressValue(), /not attached/, "detached address reads throw");
g_Assert.throws(() => g_BlankSteamID.WriteAddressValue(0n), /not attached/, "detached address writes throw");

const g_ParsedSteamID = g_Steam.SteamID.Parse("STEAM_0:1:2");
const g_CopiedByConstructor = new g_Steam.SteamID(g_ParsedSteamID);
const g_nPublicUniverse = g_Steam.Universe.Public;
const g_nIndividualAccountType = g_Steam.AccountType.Individual;
const g_SteamIDLike = {
	ConvertSteamIDToUInt64() {
		return g_unParsedSteamIDValue;
	},
};

const g_ObjectConstructed = new g_Steam.SteamID(g_SteamIDLike);
const g_SetConstructed = new g_Steam.SteamID(5, g_nPublicUniverse, g_nIndividualAccountType);
const g_InstancedConstructed = new g_Steam.SteamID(5, 1, g_nPublicUniverse, g_nIndividualAccountType);

g_Assert.equal(g_ParsedSteamID.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "parsed value");
g_Assert.equal(g_CopiedByConstructor.AreEqual(g_ParsedSteamID), true, "copy constructor");
g_Assert.equal(g_ObjectConstructed.AreEqual(g_ParsedSteamID), true, "ConvertSteamIDToUInt64 object constructor");
g_Assert.equal(g_SetConstructed.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "three-argument constructor");
g_Assert.equal(g_InstancedConstructed.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "four-argument constructor");
g_Assert.throws(() => new g_Steam.SteamID(1, 2), TypeError, "unsupported constructor arity throws");
g_Assert.equal(g_Steam.SteamID.CreateFromValue(g_ParsedSteamID), g_ParsedSteamID, "SteamID.CreateFromValue preserves existing identity");
g_Assert.equal(g_Steam.SteamID.CreateFromValue(g_unParsedSteamIDValue).AreEqual(g_ParsedSteamID), true, "SteamID.CreateFromValue constructs values");

g_Assert.equal(g_ParsedSteamID.AccountID, 5, "AccountID getter");
g_Assert.equal(g_ParsedSteamID.AccountInstance, 1, "AccountInstance getter");
g_Assert.equal(g_ParsedSteamID.AccountType, 1, "AccountType getter");
g_Assert.equal(g_ParsedSteamID.Universe, 1, "Universe getter");
g_Assert.equal(g_ParsedSteamID.StaticAccountKey, 76561193665298437n, "StaticAccountKey getter");

const g_ParsedSteamIDFields = g_ParsedSteamID.GetSteamIDFields();
g_Assert.deepEqual(ToPlainValue(g_ParsedSteamIDFields), { AccountID: 5, AccountInstance: 1, AccountType: 1, Universe: 1 }, "live fields view");

g_Assert.equal(g_ParsedSteamID.ConvertSteamIDToSteamID2(), "STEAM_1:1:2", "Steam2 output");
g_Assert.equal(g_ParsedSteamID.ConvertSteamIDToSteamID3(), "[U:1:5]", "Steam3 output");
g_Assert.equal(g_ParsedSteamID.toString(), "[U:1:5]", "string output");

g_ParsedSteamID.AccountID = 7;
g_Assert.equal(g_ParsedSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "AccountID setter");
g_Assert.equal(g_ParsedSteamIDFields.AccountID, 7, "fields view reads wrapper mutations");

g_ParsedSteamIDFields.AccountID = 5;
g_Assert.equal(g_ParsedSteamID.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "fields view writes wrapper mutations");

g_ParsedSteamIDFields.AccountID = 7;
g_Assert.equal(g_ParsedSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "fields view remains writable");

g_ParsedSteamID.AccountInstance = 1;
g_ParsedSteamID.AccountType = g_nIndividualAccountType;
g_ParsedSteamID.Universe = g_nPublicUniverse;
g_Assert.equal(g_ParsedSteamID.Set(7, g_nPublicUniverse, g_nIndividualAccountType), g_ParsedSteamID, "Set result");
g_Assert.equal(g_ParsedSteamID.SetInstanced(7, 1, g_nPublicUniverse, g_nIndividualAccountType), g_ParsedSteamID, "SetInstanced result");
g_Assert.equal(g_ParsedSteamID.SetFull(g_unParsedSteamIDValue, g_nPublicUniverse, g_nIndividualAccountType), g_ParsedSteamID, "SetFull result");
g_Assert.equal(g_ParsedSteamID.SetSteamIDFromUInt64(g_unUpdatedSteamIDValue), g_ParsedSteamID, "SetSteamIDFromUInt64 result");
g_Assert.equal(g_ParsedSteamID.SetNativeValue(g_unParsedSteamIDValue), g_ParsedSteamID, "SetNativeValue result");

g_mapMemoryValues.set(g_unAddress, 0n);
const g_AddressSteamID = g_Steam.SteamID.CreateFromAddress(g_unAddress);
g_Assert.equal(g_AddressSteamID.Address, g_unAddress, "BigInt address");
g_Assert.equal(g_AddressSteamID.HasAddress(), true, "attached address state");
g_Assert.throws(() => {
	g_AddressSteamID.Address = "0x4000";
}, TypeError, "address accessor rejects strings");
g_Assert.equal(g_AddressSteamID.Address, g_unAddress, "failed address assignment preserves attachment");
g_AddressSteamID.Address = 0n;
g_Assert.equal(g_AddressSteamID.HasAddress(), false, "zero detaches address");
g_AddressSteamID.Address = g_unAddress;
g_Assert.equal(g_AddressSteamID.HasAddress(), true, "BigInt address reattaches");
g_Assert.equal(g_AddressSteamID.WriteAddressValue(g_unParsedSteamIDValue), g_AddressSteamID, "WriteAddressValue result");
g_Assert.equal(g_AddressSteamID.ReadAddressValue(), g_unParsedSteamIDValue, "address read-through");
g_AddressSteamID.CopySteamIDFrom(g_ParsedSteamID);
g_Assert.equal(g_mapMemoryValues.get(g_unAddress), g_unParsedSteamIDValue, "CopySteamIDFrom writes through");
g_AddressSteamID.AccountID = 7;
g_Assert.equal(g_mapMemoryValues.get(g_unAddress), g_unUpdatedSteamIDValue, "field setter writes through");
g_Assert.throws(() => g_Steam.SteamID.CreateFromAddress(0n), TypeError, "null addresses are rejected");
g_Assert.throws(() => g_Steam.SteamID.CreateFromAddress("0x4000"), TypeError, "string addresses are rejected");
g_Assert.throws(() => g_Steam.SteamID.CreateFromAddress(g_unAddress, -g_unAddress), RangeError, "offset underflow is rejected");

const g_CopiedSteamID = g_AddressSteamID.CopySteamID();
const g_CopyTarget = new g_Steam.SteamID();
g_Assert.equal(g_CopiedSteamID.HasAddress(), false, "copy is detached");
g_Assert.equal(g_CopiedSteamID.AreEqual(g_AddressSteamID), true, "copy equality");
g_Assert.equal(g_CopiedSteamID.Compare(g_AddressSteamID), 0, "equal comparison");
g_Assert.equal(new g_Steam.SteamID(g_unParsedSteamIDValue).Compare(g_unUpdatedSteamIDValue), -1, "less-than comparison");
g_Assert.equal(new g_Steam.SteamID(g_unUpdatedSteamIDValue).Compare(g_unParsedSteamIDValue), 1, "greater-than comparison");
g_Assert.equal(g_AddressSteamID.CopySteamIDTo(g_CopyTarget), g_CopyTarget, "CopySteamIDTo result");
g_Assert.equal(g_CopyTarget.AreEqual(g_AddressSteamID), true, "CopySteamIDTo value");
g_Assert.throws(() => g_AddressSteamID.CopySteamIDTo({}), TypeError, "CopySteamIDTo requires SteamID");

const g_vecPredicateMethodNames = [
	"HasNoIndividualInstance",
	"IsAnonymousAccount",
	"IsAnonymousGameServerAccount",
	"IsAnonymousUserAccount",
	"IsBlankAnonymousAccount",
	"IsChatAccount",
	"IsClanAccount",
	"IsConsoleUserAccount",
	"IsContentServerAccount",
	"IsGameServerAccount",
	"IsIndividualAccount",
	"IsLobby",
	"IsPersistentGameServerAccount",
	"IsValid",
];

for (const strPredicateMethodName of g_vecPredicateMethodNames) {
	g_Assert.equal(typeof g_AddressSteamID[strPredicateMethodName](), "boolean", `${strPredicateMethodName} result`);
}

g_Assert.equal(g_CopyTarget.CreateBlankAnonymousLogon(g_nPublicUniverse), g_CopyTarget, "anonymous logon result");
g_Assert.equal(g_CopyTarget.ConvertSteamIDToUInt64(), 4n, "anonymous logon value");
g_Assert.equal(g_CopyTarget.CreateBlankAnonymousUserAccount(g_nPublicUniverse), g_CopyTarget, "anonymous user result");
g_Assert.equal(g_CopyTarget.ConvertSteamIDToUInt64(), 10n, "anonymous user value");
g_Assert.equal(g_CopyTarget.ClearIndividualInstance(), g_CopyTarget, "ClearIndividualInstance result");
g_Assert.equal(g_CopyTarget.Clear(), g_CopyTarget, "Clear result");
g_Assert.equal(g_CopyTarget.ConvertSteamIDToUInt64(), 0n, "Clear value");

let g_bParsedThroughNative = false;
let g_bReadFieldsThroughNative = false;
for (const vecNativeCall of g_vecNativeCallLog) {
	const strNativeName = vecNativeCall[0];
	if (strNativeName === "SteamIDParse") {
		g_bParsedThroughNative = true;
	}

	if (strNativeName === "SteamIDFields") {
		g_bReadFieldsThroughNative = true;
	}
}

g_Assert.ok(g_bParsedThroughNative, "parse delegates to native");
g_Assert.ok(g_bReadFieldsThroughNative, "GetSteamIDFields delegates to native");
g_Assert.equal("toJSON" in g_Steam.SteamID.prototype, false, "snapshot serializer is absent");
g_Assert.equal("toUint64" in g_Steam.SteamID.prototype, false, "legacy UInt64 alias is absent");

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationCodeBlocks = [];
const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
while (g_vecCodeBlockMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

const g_vecSteamImportMatch = g_vecDocumentationCodeBlocks[0].match(/const\s*{([\s\S]*?)}\s*=\s*require\("steam"\);/);
g_Assert.ok(g_vecSteamImportMatch, "steam complete import example");

const g_vecDocumentedExportNames = [];
const g_vecDocumentedImportNames = g_vecSteamImportMatch[1].split(",");
for (const strDocumentedImportName of g_vecDocumentedImportNames) {
	const strDocumentedExportName = strDocumentedImportName.split(":", 1)[0].trim();
	if (strDocumentedExportName.length > 0) {
		g_vecDocumentedExportNames.push(strDocumentedExportName);
	}
}

g_vecDocumentedExportNames.sort();

g_Assert.deepEqual(g_vecDocumentedExportNames, Object.keys(g_Steam).sort(), "documented full-capability steam exports");
g_Assert.equal(g_vecDocumentationCodeBlocks.length, 9, "steam JavaScript block count");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by|\bconsole\.|(?:const|let|var)\s+\w+\s*=\s*require\("steam"\)/, "steam documentation must remain hand-written and use direct imports");
g_Assert.doesNotMatch(g_strDocumentation, /[^\x00-\x7F]/, "steam documentation ASCII");
g_Assert.doesNotMatch(g_strDocumentation, /[ \t]+$/m, "steam documentation trailing whitespace");

for (const strDocumentationCodeBlock of g_vecDocumentationCodeBlocks) {
	g_Assert.doesNotMatch(strDocumentationCodeBlock, /^ +\S/m, "steam JavaScript fence indentation must use tabs");
}

VerifyContentsAnchors(g_strDocumentation);
VerifyDocumentationLinks(g_strDocumentation);

const g_DocumentedWorkflows = {};
const g_unNativeCallCountBeforeDocumentation = g_vecNativeCallLog.length;
const g_unAllocationCountBeforeDocumentation = g_mapMemoryAllocations.size;
const g_unMemoryValueCountBeforeDocumentation = g_mapMemoryValues.size;

for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecDocumentationCodeBlocks.length; unCodeBlockIndex += 1) {
	const DocumentedBlockExports = ExecuteCodeBlock(g_vecDocumentationCodeBlocks[unCodeBlockIndex], unCodeBlockIndex + 1);
	const vecDocumentedBlockExportNames = Object.keys(DocumentedBlockExports);
	for (const strDocumentedBlockExportName of vecDocumentedBlockExportNames) {
		if (Object.prototype.hasOwnProperty.call(g_DocumentedWorkflows, strDocumentedBlockExportName)) {
			throw new Error(`Duplicate documented workflow: ${strDocumentedBlockExportName}.`);
		}

		g_DocumentedWorkflows[strDocumentedBlockExportName] = DocumentedBlockExports[strDocumentedBlockExportName];
	}
}

g_Assert.equal(g_vecNativeCallLog.length, g_unNativeCallCountBeforeDocumentation, "steam code blocks must not call native APIs while loading");
g_Assert.equal(g_mapMemoryAllocations.size, g_unAllocationCountBeforeDocumentation, "steam code blocks allocate no memory while loading");
g_Assert.equal(g_mapMemoryValues.size, g_unMemoryValueCountBeforeDocumentation, "steam code blocks write no memory while loading");
g_Assert.deepEqual(Object.keys(g_DocumentedWorkflows).sort(), [
	"BuildSteamIDVariants",
	"ClassifySteamID",
	"CompareAndCopySteamIDs",
	"ConstructSteamIDs",
	"CopySteamIDThroughMemory",
	"CreateAnonymousSteamIDs",
	"CreateSteamIDConstructorForms",
	"GetSteamIDFields",
	"InspectSteamCapabilities",
	"ReadPlayerIdentity",
	"UpdateSteamIDFields",
], "steam documented workflows");

VerifySteamMemoryWorkflowFailures(g_vecDocumentationCodeBlocks.find((strCode) => strCode.includes("function CopySteamIDThroughMemory(")));
VerifySteamOptionalMethodSnapshots(g_vecDocumentationCodeBlocks.find((strCode) => strCode.includes("function ClassifySteamID(")), g_vecDocumentationCodeBlocks.find((strCode) => strCode.includes("function CreateAnonymousSteamIDs(")));

const g_Capabilities = g_DocumentedWorkflows.InspectSteamCapabilities();
g_Assert.equal(g_Capabilities.BranchName, "l4d2", "documented branch capability");
g_Assert.equal(g_Capabilities.HasAccountTypes, true, "documented account-type capability");
g_Assert.equal(g_Capabilities.HasSteamID, true, "documented SteamID capability");
g_Assert.equal(g_Capabilities.HasSteamIDSize, true, "documented SteamID-size capability");
g_Assert.equal(g_Capabilities.HasUniverses, true, "documented universe capability");
g_Assert.equal(g_Capabilities.HasXUID, true, "documented XUID capability");
g_Assert.deepEqual(ToPlainValue(g_DocumentedWorkflows.ReadPlayerIdentity(1)), { BranchName: "l4d2", NetworkID: "STEAM_1:1:2", XUID: g_unParsedSteamIDValue }, "documented player identity");

const g_ConstructorFormResults = g_DocumentedWorkflows.CreateSteamIDConstructorForms(g_unParsedSteamIDValue, 5, 1);
const g_vecConstructorFormNames = [
	"BlankSteamID",
	"FromValueSteamID",
	"IndividualSteamID",
	"InstancedSteamID",
];
for (const strConstructorFormName of g_vecConstructorFormNames) {
	g_Assert.ok(g_ConstructorFormResults[strConstructorFormName] instanceof g_Steam.SteamID, `documented ${strConstructorFormName} form`);
	g_Assert.equal(g_ConstructorFormResults[strConstructorFormName].HasAddress(), false, `documented ${strConstructorFormName} detached`);
}

g_Assert.equal(g_ConstructorFormResults.BlankSteamID.ConvertSteamIDToUInt64(), 0n, "documented blank constructor form");
g_Assert.equal(g_ConstructorFormResults.FromValueSteamID.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "documented value constructor form");
g_Assert.equal(g_ConstructorFormResults.IndividualSteamID.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "documented individual constructor form");
g_Assert.equal(g_ConstructorFormResults.InstancedSteamID.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "documented instanced constructor form");

const g_ConstructedSteamIDs = g_DocumentedWorkflows.ConstructSteamIDs("STEAM_0:1:2", 5);
const g_vecConstructedSteamIDNames = [
	"CopiedByConstructorSteamID",
	"FromBigIntSteamID",
	"FromDecimalSteamID",
	"IndividualSteamID",
	"InstancedSteamID",
	"ParsedSteamID",
];
for (const strConstructedSteamIDName of g_vecConstructedSteamIDNames) {
	g_Assert.ok(g_ConstructedSteamIDs[strConstructedSteamIDName] instanceof g_Steam.SteamID, `documented ${strConstructedSteamIDName} type`);
	g_Assert.equal(g_ConstructedSteamIDs[strConstructedSteamIDName].HasAddress(), false, `documented ${strConstructedSteamIDName} is detached`);
}

g_Assert.equal(g_ConstructedSteamIDs.PreservedIdentity, true, "documented SteamID.CreateFromValue identity");
g_Assert.equal(g_ConstructedSteamIDs.CopiedByConstructorSteamID.AreEqual(g_ConstructedSteamIDs.ParsedSteamID), true, "documented copy constructor value");
g_Assert.equal(g_ConstructedSteamIDs.FromDecimalSteamID.AreEqual(g_ConstructedSteamIDs.ParsedSteamID), true, "documented decimal constructor value");
g_Assert.equal(g_ConstructedSteamIDs.FromBigIntSteamID.AreEqual(g_ConstructedSteamIDs.ParsedSteamID), true, "documented BigInt constructor value");

const g_DocumentedFieldsView = g_DocumentedWorkflows.GetSteamIDFields(g_ConstructedSteamIDs.ParsedSteamID);
g_Assert.deepEqual(ToPlainValue(g_DocumentedFieldsView), { AccountID: 5, AccountInstance: 1, AccountType: 1, Universe: 1 }, "documented live fields view");

const g_UpdatedDocumentedFieldsView = g_DocumentedWorkflows.UpdateSteamIDFields(g_ConstructedSteamIDs.ParsedSteamID, { AccountID: 7, AccountInstance: 1, AccountType: g_nIndividualAccountType, Universe: g_nPublicUniverse });
g_Assert.equal(g_UpdatedDocumentedFieldsView.AccountID, 7, "documented field mutation result");
g_Assert.equal(g_ConstructedSteamIDs.ParsedSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "documented field mutation value");
g_ConstructedSteamIDs.ParsedSteamID.AccountID = 5;
g_Assert.equal(g_UpdatedDocumentedFieldsView.AccountID, 5, "documented fields view remains live");

const g_SteamIDVariantResults = g_DocumentedWorkflows.BuildSteamIDVariants(7, 1, g_unParsedSteamIDValue, g_nPublicUniverse, g_nIndividualAccountType);
g_Assert.equal(g_SteamIDVariantResults.BasicSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "documented Set value");
g_Assert.equal(g_SteamIDVariantResults.InstancedSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "documented SetInstanced value");
g_Assert.equal(g_SteamIDVariantResults.FullSteamID.ConvertSteamIDToUInt64(), g_unParsedSteamIDValue, "documented SetFull value");
g_Assert.equal(g_SteamIDVariantResults.RestoredSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "documented SetSteamIDFromUInt64 value");

const g_MemoryWorkflowResult = g_DocumentedWorkflows.CopySteamIDThroughMemory(g_unParsedSteamIDValue);
g_Assert.ok(g_MemoryWorkflowResult.DetachedSteamID instanceof g_Steam.SteamID, "documented detached memory copy type");
g_Assert.equal(g_MemoryWorkflowResult.DetachedSteamID.HasAddress(), false, "documented detached memory copy state");
g_Assert.equal(g_MemoryWorkflowResult.DetachedSteamID.ConvertSteamIDToUInt64(), g_unUpdatedSteamIDValue, "documented detached memory copy value");
g_Assert.equal(g_MemoryWorkflowResult.HasAddressBeforeRelease, true, "documented attached state before release");
g_Assert.equal(g_MemoryWorkflowResult.ReadSteamIDValue, g_unUpdatedSteamIDValue, "documented memory read-through");
g_Assert.equal(g_mapMemoryAllocations.size, 0, "documentation frees allocated SteamID blocks");

let g_bHasLeakedOffsetMemory = false;
for (const unAddressValue of g_mapMemoryValues.keys()) {
	if (unAddressValue >= 0x8000n) {
		g_bHasLeakedOffsetMemory = true;
		break;
	}
}

g_Assert.equal(g_bHasLeakedOffsetMemory, false, "documentation releases offset memory entries");

const g_ComparisonResults = g_DocumentedWorkflows.CompareAndCopySteamIDs(g_unParsedSteamIDValue, g_unUpdatedSteamIDValue);
g_Assert.equal(g_ComparisonResults.Comparison, -1, "documented SteamID comparison");
g_Assert.equal(g_ComparisonResults.CopyEquals, true, "documented detached copy equality");
g_Assert.equal(g_ComparisonResults.CopyFromMatchesRight, true, "documented CopySteamIDFrom value");
g_Assert.equal(g_ComparisonResults.CopyFromReturnsTarget, true, "documented CopySteamIDFrom identity");
g_Assert.equal(g_ComparisonResults.CopyToMatchesLeft, true, "documented CopySteamIDTo value");
g_Assert.equal(g_ComparisonResults.CopyToReturnsTarget, true, "documented CopySteamIDTo identity");
g_Assert.equal(g_ComparisonResults.Equals, false, "documented unequal SteamIDs");

const g_ClassificationResults = g_DocumentedWorkflows.ClassifySteamID(g_unParsedSteamIDValue);
g_Assert.deepEqual(Object.keys(g_ClassificationResults).sort(), g_vecPredicateMethodNames.slice().sort(), "documented available predicates");
g_Assert.equal(g_ClassificationResults.IsIndividualAccount, true, "documented individual classification");
g_Assert.equal(g_ClassificationResults.IsValid, true, "documented valid classification");

const g_AnonymousSteamIDs = g_DocumentedWorkflows.CreateAnonymousSteamIDs();
g_Assert.ok(g_AnonymousSteamIDs.AnonymousLogonSteamID instanceof g_Steam.SteamID, "documented anonymous logon type");
g_Assert.ok(g_AnonymousSteamIDs.AnonymousUserSteamID instanceof g_Steam.SteamID, "documented anonymous user type");
g_Assert.ok(g_AnonymousSteamIDs.ClearedSteamID instanceof g_Steam.SteamID, "documented cleared type");
g_Assert.ok(g_AnonymousSteamIDs.IndividualWithoutInstanceSteamID instanceof g_Steam.SteamID, "documented cleared individual type");
g_Assert.equal(g_AnonymousSteamIDs.AnonymousLogonSteamID.ConvertSteamIDToUInt64(), 4n, "documented anonymous logon value");
g_Assert.equal(g_AnonymousSteamIDs.AnonymousUserSteamID.ConvertSteamIDToUInt64(), 10n, "documented anonymous user value");
g_Assert.equal(g_AnonymousSteamIDs.ClearedSteamID.ConvertSteamIDToUInt64(), 0n, "documented cleared value");
g_Assert.equal(g_mapMemoryAllocations.size, 0, "documentation leaves no memory allocations");

const g_LimitedSteamAPI = LoadSteamAPI(CreateNativeSteamMock({ IncludeSteamID: false, IncludeXUID: false }));
g_Assert.deepEqual(Object.keys(g_LimitedSteamAPI).sort(), ["GetNetworkID", "STEAM_BRANCH"], "limited SDK exports");
g_Assert.equal(g_LimitedSteamAPI.GetNetworkID(1), "STEAM_1:1:2", "limited network ID");

const g_SteamWithoutLobbyAPI = LoadSteamAPI(CreateNativeSteamMock({ OmittedMethods: ["SteamIDIsLobby"] }));
g_Assert.equal(typeof g_SteamWithoutLobbyAPI.SteamID, "function", "partial SteamID capability remains exported");
g_Assert.equal("IsLobby" in g_SteamWithoutLobbyAPI.SteamID.prototype, false, "missing native SteamID methods are omitted");

VerifyWorldSteamSnapshots(g_Steam);
VerifyWorldSteamSnapshots(g_LimitedSteamAPI);

ReleaseSteamFixture();

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strSteamPath)});`], {
	encoding: "utf8",
	env: {
		...process.env,
		NODE_PATH: g_strPackageRootPath,
	},
	timeout: g_unMissingRuntimeTimeoutMilliseconds,
});

g_Assert.equal(g_MissingRuntimeResult.error, undefined, "steam missing-runtime subprocess starts and finishes within its deadline");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "steam missing-runtime subprocess reports the expected Node failure status");
g_Assert.notEqual(g_MissingRuntimeResult.status, 0, "steam requires the native runtime");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_steam");
