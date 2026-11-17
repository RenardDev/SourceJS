#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strPackageRoot = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs");
const g_strServerPath = g_Path.join(g_strPackageRoot, "engines", "server.js");
// This test double models a 64-bit address space, not an executing game SDK.
const g_unMaximumMockAddress = 0xFFFFFFFFFFFFFFFFn;
const g_unNetworkBaseTickInterval = 100;
const g_unEntityPVSAddress = 0x6000n;
const g_unEntityPVSIndex = 77;

const g_strNativeBindingsPath = g_Path.join(g_strRepositoryRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8").replace(/\r\n/g, "\n");
const g_nCleanupCallbackStart = g_strNativeBindings.indexOf("\t\tvoid CleanupEngineServerEntityClusterListCallback(");
const g_nCleanupCallbackEnd = g_strNativeBindings.indexOf("\n\t\t}\n", g_nCleanupCallbackStart);
g_Assert.ok((g_nCleanupCallbackStart >= 0) && (g_nCleanupCallbackEnd > g_nCleanupCallbackStart), "native cleanup callback must remain available");

const g_strCleanupCallback = g_strNativeBindings.slice(g_nCleanupCallbackStart, g_nCleanupCallbackEnd);
g_Assert.equal((g_strCleanupCallback.match(/engines\/server\.CleanUpEntityClusterList\(/g) ?? []).length, 3, "all cleanup diagnostic signatures must match the public export");
g_Assert.doesNotMatch(g_strCleanupCallback, /engines\/server\.CleanupEntityClusterList\(/, "native cleanup diagnostics must not advertise an absent API");

function RequireNativeAddress(unAddress, strOperationName, bAllowZero = false) {
	if ((typeof unAddress !== "bigint") || (unAddress < 0n) || (unAddress > g_unMaximumMockAddress) || (!bAllowZero && (unAddress === 0n))) {
		throw new Error(`${strOperationName} requires a ${bAllowZero ? "non-negative" : "positive"} BigInt address`);
	}

	return unAddress;
}

function RequireNativeFloat(dblValue, strOperationName) {
	const flMaximumValue = (2 - (2 ** -23)) * (2 ** 127);
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue) || (Math.abs(dblValue) > flMaximumValue)) {
		throw new Error(`${strOperationName} requires a finite float value`);
	}

	return Math.fround(dblValue);
}

function RequirePVSInformationAddress(Value, strOperationName) {
	const IndexValue = ((Value !== null) && (typeof Value === "object")) ? Value.Index : Value;
	if (IndexValue === g_unEntityPVSIndex) {
		return g_unEntityPVSAddress;
	}

	return RequireNativeAddress(Value, strOperationName);
}

const g_vecCommands = [];
const g_vecSDKCalls = [];
let g_nNativeClientRate = 30_000;
let g_nNativeClientUpdateRate = 30;
const g_NativeClient = {
	Active: true,
	Connected: true,
	DisconnectClient(strReason) {
		g_vecSDKCalls.push(`client-disconnect:${strReason}`);

		return true;
	},
	ExecuteClientStringCommand(strCommandLine) {
		g_vecSDKCalls.push(`client-string-command:${strCommandLine}`);

		return true;
	},
	FakeClient: false,
	Index: 0,
	IsHLTV: false,
	MaximumAcknowledgedTickCount: 510,
	Name: "Ren",
	NetworkChannelAddress: 0x3000n,
	NetworkID: "STEAM_1:1:42",
	PlayerSlot: 0,
	Address: 0x2000n,
	PrintToClientConsole(strMessage) {
		g_vecSDKCalls.push(`client-print:${strMessage}`);

		return true;
	},
	get Rate() {
		return g_nNativeClientRate;
	},
	SetNetworkRate(nRate, bForce) {
		if (typeof bForce !== "boolean") {
			throw new Error("SetNetworkRate requires a boolean force argument");
		}

		g_nNativeClientRate = nRate;

		return true;
	},
	SetUpdateRate(nRate, bForce) {
		if (typeof bForce !== "boolean") {
			throw new Error("SetUpdateRate requires a boolean force argument");
		}

		g_nNativeClientUpdateRate = nRate;

		return true;
	},
	Spawned: true,
	get UpdateRate() {
		return g_nNativeClientUpdateRate;
	},
	GetUserSetting(strName) {
		return (strName === "rate") ? String(g_nNativeClientRate) : "";
	},
	UserID: 7,
};
let g_strNativePassword = "";
let g_bNativePaused = false;
let g_flNativeTimescale = 1;
const g_NativeServer = {
	GetServerClassBitCount() {
		return 9;
	},
	GetConnectedClientCount() {
		return 8;
	},
	DisconnectClient(Client, strReason) {
		return (Client === g_NativeClient) && (strReason === "bye");
	},
	GetClient(unClientIndex) {
		if (unClientIndex !== 0) {
			throw new Error("client slot");
		}

		return g_NativeClient;
	},
	IsServerActive() {
		return true;
	},
	IsDedicatedServer() {
		return true;
	},
	IsHLTVServer() {
		return false;
	},
	IsServerLoading() {
		return false;
	},
	IsMultiplayerServer() {
		return true;
	},
	IsServerPausable() {
		return true;
	},
	IsServerPaused() {
		return g_bNativePaused;
	},
	IsReplayServer() {
		return false;
	},
	GetMapName() {
		return "test_map";
	},
	GetMaximumClients() {
		return 8;
	},
	GetServerName() {
		return "SourceJS test server";
	},
	GetNetworkStatistics() {
		return { Incoming: 12, Outgoing: 34 };
	},
	GetServerClassCount() {
		return 17;
	},
	GetAllocatedClientCount() {
		return 3;
	},
	GetFakeClientCount() {
		return 1;
	},
	GetRealPlayerCount() {
		return 2;
	},
	GetProxyClientCount() {
		return 0;
	},
	GetServerPassword() {
		return g_strNativePassword;
	},
	Address: 0x1000n,
	SetServerPassword(strPassword) {
		if (typeof strPassword !== "string") {
			throw new Error("SetServerPassword requires a string");
		}

		g_strNativePassword = strPassword;

		return true;
	},
	SetServerPaused(bPaused) {
		if (typeof bPaused !== "boolean") {
			throw new Error("SetServerPaused requires a boolean");
		}

		g_bNativePaused = bPaused;

		return true;
	},
	SetServerTimescale(dblServerTimescale) {
		g_flNativeTimescale = RequireNativeFloat(dblServerTimescale, "SetServerTimescale");

		return true;
	},
	GetServerSpawnCount() {
		return 4;
	},
	GetServerTick() {
		return 512;
	},
	GetServerTickInterval() {
		return 0.015;
	},
	GetServerTime() {
		return 12.5;
	},
	GetServerTimescale() {
		return g_flNativeTimescale;
	},
	GetUDPPort() {
		return 27015;
	},
};

function RequireCommandLine(strCommandLine, strOperationName) {
	if ((typeof strCommandLine !== "string") || (strCommandLine.length === 0)) {
		throw new Error(`${strOperationName} requires a non-empty command string`);
	}

	return strCommandLine;
}

const g_NativeGlobalVariablesState = {
	Address: 0x1000n,
	RealTime: 120,
	FrameCount: 800,
	AbsoluteFrameTime: 0.016,
	AbsoluteFrameStartTimeStandardDeviation: 0.001,
	CurrentTime: 12.5,
	FrameTime: 0.015,
	MaximumClients: 8,
	TickCount: 512,
	IntervalPerTick: 0.015,
	InterpolationAmount: 0.25,
	SimulatedTicksThisFrame: 1,
	NetworkProtocol: 24,
	SaveRestoreDataAddress: 0x2000n,
	MapName: "test_map",
	MapVersion: 1,
	StartSpot: "",
	MapLoadType: 0,
	MapLoadFailed: false,
	IsDeathmatch: false,
	IsCooperative: true,
	IsTeamplay: true,
	MaximumEntities: 2_048,
	ServerCount: 3,
	EdictArrayAddress: 0x3000n,
	MapGroupName: "test_group",
};
const g_vecNativeGlobalWritableProperties = [
	"RealTime",
	"FrameCount",
	"AbsoluteFrameTime",
	"AbsoluteFrameStartTimeStandardDeviation",
	"CurrentTime",
	"FrameTime",
	"MaximumClients",
	"TickCount",
	"IntervalPerTick",
	"InterpolationAmount",
	"SimulatedTicksThisFrame",
	"NetworkProtocol",
	"SaveRestoreDataAddress",
	"MapVersion",
	"MapLoadType",
	"MapLoadFailed",
	"IsDeathmatch",
	"IsCooperative",
	"IsTeamplay",
	"MaximumEntities",
	"ServerCount",
	"EdictArrayAddress",
];

function CreateNativeGlobalVariables() {
	const View = {};
	for (const strPropertyName of ["Address", "MapName", "StartSpot", "MapGroupName"]) {
		Object.defineProperty(View, strPropertyName, {
			enumerable: true,
			get() {
				return g_NativeGlobalVariablesState[strPropertyName];
			},
		});
	}

	for (const strPropertyName of g_vecNativeGlobalWritableProperties) {
		Object.defineProperty(View, strPropertyName, {
			enumerable: true,
			get() {
				return g_NativeGlobalVariablesState[strPropertyName];
			},
			set(Value) {
				if ((strPropertyName === "SaveRestoreDataAddress") || (strPropertyName === "EdictArrayAddress")) {
					RequireNativeAddress(Value, `globals.GetGlobalVariables().${strPropertyName}`, true);
				}

				g_NativeGlobalVariablesState[strPropertyName] = Value;
			},
		});
	}

	Object.defineProperties(View, {
		IsClient: {
			enumerable: true,
			value() {
				return false;
			},
		},
		GetNetworkBase: {
			enumerable: true,
			value(nTick, nEntityIndex) {
				return nTick - (nTick % g_unNetworkBaseTickInterval) + nEntityIndex;
			},
		},
		IsRemoteClient: {
			enumerable: true,
			value() {
				return false;
			},
		},
	});

	return View;
}

const g_NativeModules = {
	"engines/server": {
		GetServerConstants() {
			return {
				QueryCVarStatus: { Success: 0, NotFound: 1, Invalid: 2, Protected: 3 },
				MapLoadType: { NEW_GAME: 0, LOAD_GAME: 1, TRANSITION: 2, BACKGROUND: 3 },
			};
		},
		AllowImmediateEdictReuse() {
			g_vecSDKCalls.push("allow-edict-reuse");

			return true;
		},
		GetApplicationID() {
			return 550;
		},
		ChangeLevel(strMapName, strLandmark) {
			g_vecSDKCalls.push(`change-level:${strMapName}:${strLandmark}`);

			return true;
		},
		AreAreasConnected(nAreaOne, nAreaTwo) {
			g_vecSDKCalls.push(`areas-connected:${nAreaOne}:${nAreaTwo}`);

			return (nAreaOne === 2) && (nAreaTwo === 3);
		},
		CheckBoxInPVS(MinimumBounds, MaximumBounds, PVSBytes) {
			g_vecSDKCalls.push(`box-pvs:${MinimumBounds.X}:${MaximumBounds.Z}:${PVSBytes.byteLength}`);

			return true;
		},
		IsHeadNodeVisible(nHeadNodeIndex, PVSBytes) {
			g_vecSDKCalls.push(`head-node:${nHeadNodeIndex}:${PVSBytes.byteLength}`);

			return nHeadNodeIndex === 9;
		},
		CheckOriginInPVS(Origin, PVSBytes) {
			g_vecSDKCalls.push(`origin-pvs:${Origin.X}:${PVSBytes.byteLength}`);

			return Origin.X === 4;
		},
		CleanUpEntityClusterList(PVSInformationOrEntity) {
			const unPVSAddress = RequirePVSInformationAddress(PVSInformationOrEntity, "CleanUpEntityClusterList");
			g_vecSDKCalls.push(`cleanup-clusters:${unPVSAddress}`);

			return true;
		},
		ClearSaveDirectoryAfterClientLoad() {
			return true;
		},
		ExecuteClientCommand(Client, strCommandLine, bServerSide) {
			g_vecSDKCalls.push(`client-command:${Client}:${strCommandLine}:${bServerSide}`);

			return true;
		},
		ExecuteClientCommandKeyValues(Client, KeyValues) {
			// Forwarding only; client identity and ownership execute in the compiled V8 fixture.
			g_vecSDKCalls.push(`client-kv:${Client}:${KeyValues.Handle}`);

			return true;
		},
		PrintToClientConsole(Client, strMessage) {
			g_vecSDKCalls.push(`client-printf:${Client}:${strMessage}`);

			return true;
		},
		PrintDeveloperOverlayLine(nPosition, strMessage) {
			g_vecSDKCalls.push(`nprint:${nPosition}:${strMessage}`);

			return true;
		},
		PrintDeveloperOverlayLineExtended(OverlayInformation, strMessage) {
			g_vecSDKCalls.push(`nxprint:${OverlayInformation.Index}:${OverlayInformation.TimeToLive}:${strMessage}`);

			return true;
		},
		BuildEntityClusterList(...vecArguments) {
			const PVSInformation = vecArguments[1];
			// Only optional PVS storage and result shape are modeled, not first-entity admission or native lifetime.
			const unPVSAddress = ((PVSInformation === undefined) || (PVSInformation === null)) ? g_unEntityPVSAddress : RequirePVSInformationAddress(PVSInformation, "BuildEntityClusterList");

			return {
				Area: 1,
				SecondaryArea: 2,
				Center: { X: 1, Y: 2, Z: 3 },
				ClusterCount: 2,
				Clusters: [4, 5],
				HeadNode: 6,
				Kind: "PVSInfo_t",
				Address: unPVSAddress,
				Valid: true,
			};
		},
		GetClusterCount() {
			return 64;
		},
		CreateEdict(nForcedEdictIndex) {
			return { Index: nForcedEdictIndex, Kind: "edict", Address: 0x4000n, Valid: true };
		},
		CreateFakeClient(strName) {
			return { Index: 4, Kind: "edict", Name: strName, Address: 0x5000n, Valid: true };
		},
		CreateFakeClientWithOptions(strName, bReportFakeClient) {
			g_vecSDKCalls.push(`fake-client-ex:${strName}:${bReportFakeClient}`);

			return { Index: 5, Kind: "edict", Name: strName, Address: 0x5100n, Valid: true };
		},
		CreateSpatialPartition(WorldMinimums, WorldMaximums) {
			g_vecSDKCalls.push(`create-partition:${WorldMinimums.X}:${WorldMaximums.Z}`);

			return { Kind: "ISpatialPartition", Address: 0x7000n, Valid: true };
		},
		SetClientCrosshairAngle(nClientIndex, flPitch, flYaw) {
			g_vecSDKCalls.push(`crosshair:${nClientIndex}:${flPitch}:${flYaw}`);

			return true;
		},
		GetServer() {
			return g_NativeServer;
		},
		GetServerFromAddress(unAddress) {
			RequireNativeAddress(unAddress, "GetServerFromAddress");

			return g_NativeServer;
		},
		GetEntityCount() {
			return 42;
		},
		DestroySpatialPartition(unAddress) {
			g_vecSDKCalls.push(`destroy-partition:${unAddress}`);

			return true;
		},
		DrawSpatialPartitionMapToScratchPad(unScratchPad3DAddress, unDrawFlags) {
			RequireNativeAddress(unScratchPad3DAddress, "DrawSpatialPartitionMapToScratchPad");

			g_vecSDKCalls.push(`scratch:${unScratchPad3DAddress}:${unDrawFlags}`);

			return true;
		},
		EmitAmbientSound(Entity, Position, strSample, flVolume, nSoundLevel, nFlags, nPitch, flDelay) {
			g_vecSDKCalls.push(`ambient:${Entity}:${Position.X}:${strSample}:${flVolume}:${nSoundLevel}:${nFlags}:${nPitch}:${flDelay}`);

			return true;
		},
		FadeClientVolume() {
			return true;
		},
		ForceExactFile(strPath) {
			g_vecSDKCalls.push(`exact:${strPath}`);

			return true;
		},
		ForceModelBounds() {
			return true;
		},
		ForceSimpleMaterial() {
			return true;
		},
		GetGlobalVariables() {
			return CreateNativeGlobalVariables();
		},
		GetMaximumClients() {
			return 8;
		},
		GetMaximumEntities() {
			return 2_048;
		},
		GetServerCount() {
			return g_NativeGlobalVariablesState.ServerCount;
		},
		GetServerTime() {
			return g_NativeGlobalVariablesState.CurrentTime;
		},
		GetServerTick() {
			return g_NativeGlobalVariablesState.TickCount;
		},
		GetServerTickInterval() {
			return g_NativeGlobalVariablesState.IntervalPerTick;
		},
		GetMapName() {
			return g_NativeGlobalVariablesState.MapName;
		},
		GetGameDescription() {
			return "Left 4 Dead 2";
		},
		GetGameDirectory() {
			return "C:/game/left4dead2";
		},
		GetGameServerSteamID() {
			return { AccountID: 1, AccountInstance: 1, AccountType: 3, StaticAccountKey: 1n, Universe: 1, Valid: true, Value: 901n };
		},
		GetClientCrossPlayPlatform(nClientIndex) {
			return (nClientIndex === 1) ? 2 : 0;
		},
		GetClientXUID(nClientIndex) {
			return (nClientIndex === 1) ? 76_561_197_960_265_770n : 0n;
		},
		GetAchievementManager() {
			return { Kind: "IAchievementMgr", Address: 0xF000n };
		},
		GetClientCVarValue(PlayerOrIndex, strCVarName) {
			const nMinimumNativeInteger = -2_147_483_648;
			const nMaximumNativeInteger = 2_147_483_647;
			const IsNativeInteger = Value => (typeof Value === "number") && Number.isInteger(Value) && (Value >= nMinimumNativeInteger) && (Value <= nMaximumNativeInteger);

			if ((arguments.length < 2) || (typeof strCVarName !== "string")) {
				throw new Error("engines/server.GetClientCVarValue(PlayerOrIndex, strCVarName) expects a player index and CVar name.");
			}

			let nPlayerIndex = -1;
			if (IsNativeInteger(PlayerOrIndex)) {
				nPlayerIndex = PlayerOrIndex;

			} else if ((PlayerOrIndex !== null) && ((typeof PlayerOrIndex === "object") || (typeof PlayerOrIndex === "function"))) {
				const IndexValue = PlayerOrIndex.Index;
				if (IsNativeInteger(IndexValue)) {
					nPlayerIndex = IndexValue;
				}
			}

			const strEncodedName = Buffer.from(strCVarName, "utf8").toString("utf8");
			if (strEncodedName.length === 0) {
				throw new Error("engines/server.GetClientCVarValue(PlayerOrIndex, strCVarName) expects a non-empty CVar name.");
			}

			if (nPlayerIndex <= 0) {
				return "";
			}

			const nCStringEnd = strEncodedName.indexOf("\0");
			const strNativeName = (nCStringEnd < 0) ? strEncodedName : strEncodedName.slice(0, nCStringEnd);

			return String(nPlayerIndex) + ":" + strNativeName;
		},
		GetClientSteamID(nClientIndex, bValidatedOnly) {
			g_vecSDKCalls.push(`steam-id:${nClientIndex}:${bValidatedOnly}`);

			return (nClientIndex === 1) ? { AccountID: 42, AccountInstance: 1, AccountType: 1, StaticAccountKey: 42n, Universe: 1, Valid: true, Value: 76_561_197_960_265_770n } : null;
		},
		GetAreaForOrigin(Origin) {
			return (Origin.Z === 6) ? 2 : -1;
		},
		GetAreaBits(nArea) {
			return new Uint8Array([nArea, 0x02, 0x03, 0x04]);
		},
		GetAreaPortalPlane(Origin, nPortalKey) {
			return (nPortalKey === 17) ? { Distance: Origin.Z, Normal: { X: 0, Y: 0, Z: 1 } } : null;
		},
		GetClusterForOrigin(Origin) {
			return (Origin.X === 1) ? 12 : -1;
		},
		GetEntityChangeAccessor(nEntityIndex) {
			return (nEntityIndex === g_unEntityPVSIndex) ? { ChangeInformation: 3, Address: 0x8000n, SerialNumber: 4, Kind: "IChangeInfoAccessor" } : null;
		},
		GetEntityTransmitBitsForClient(nClientIndex) {
			return (nClientIndex === 1) ? { Indexes: [1, g_unEntityPVSIndex], MaximumBits: 2_048, Address: 0x9000n, Kind: "CBitVec<MAX_EDICTS>" } : null;
		},
		GetPVSForCluster(nCluster) {
			return { Bytes: new Uint8Array([nCluster, 0x01, 0x02, 0x03]), RequiredBytes: 4 };
		},
		GetPlayerNetworkChannelInformation(nPlayerIndex) {
			return (nPlayerIndex === 1) ? { NetworkChannelAddress: 0x3000n, LatencyOutgoing: 0.03, PlayerIndex: 1, Address: 0x9100n, RemoteAddress: "127.0.0.1:27005", TimeConnected: 10 } : null;
		},
		GetUserLoadingProgress(nUserID) {
			return (nUserID === 7) ? 88 : -1;
		},
		GetAttachedSplitScreenUserCount(nEntityIndex) {
			return (nEntityIndex === 1) ? 1 : 0;
		},
		GetPreviousCheckTransmitInformation(nClientIndex) {
			return (nClientIndex === 1) ? { Areas: [1], AreasNetworked: 1, MapAreas: 1, Address: 0xA000n, PVS: [0xFF], PVSSize: 1, TransmitAlways: [], TransmitEdicts: [1, g_unEntityPVSIndex], Kind: "CCheckTransmitInfo" } : null;
		},
		GetSinglePlayerSharedMemorySpace() {
			// Only the selected result shape is modeled, not argument conversion or native lifetime.
			return { Kind: "ISPSharedMemory", Address: 0xF100n };
		},
		GetSplitScreenPlayerAttachment(nPlayerIndex) {
			return (nPlayerIndex === 2) ? { Index: 1 } : null;
		},
		GetSplitScreenPlayerForEntity(nEntityIndex, nSplitScreenSlot) {
			return ((nEntityIndex === 1) && (nSplitScreenSlot === 0)) ? { Index: 2 } : null;
		},
		GetTimescale() {
			return g_flNativeTimescale;
		},
		GetPaintMapDataRLE() {
			return [0x0B, 0x16, 0x21];
		},
		HasPaintMap() {
			return true;
		},
		GetPlayerInformation(nPlayerIndex) {
			return (nPlayerIndex === 1) ? { CustomFiles: [0, 0, 0, 0], FilesDownloaded: 0, FriendsID: 42, FriendsName: "Ren", GUID: "STEAM_1:0:21", IsFakePlayer: false, IsHLTV: false, Name: "Ren", UserID: 7, XUID: 76_561_197_960_265_770n } : null;
		},
		InsertServerCommand(strCommandLine) {
			RequireCommandLine(strCommandLine, "InsertServerCommand");
			g_vecCommands.push(`insert-server:${strCommandLine}`);

			return true;
		},
		ValidateHostSession() {
			g_vecSDKCalls.push("host-validate-session");

			return true;
		},
		IsAnyClientLowViolence() {
			return false;
		},
		IsCreatingResourceList() {
			return false;
		},
		IsCreatingXboxResourceList() {
			return false;
		},
		IsDedicatedServer() {
			return true;
		},
		IsDedicatedServerForPS3() {
			return false;
		},
		IsDedicatedServerForXbox() {
			return false;
		},
		IsClientFullyAuthenticated(nClientIndex) {
			return nClientIndex === 1;
		},
		IsApplicationActive() {
			return true;
		},
		IsDecalPrecached(strPath) {
			return strPath === "decals/test";
		},
		IsGenericPrecached(strPath) {
			return strPath === "scripts/test.txt";
		},
		IsInEditMode() {
			return false;
		},
		IsLevelMainMenuBackground() {
			return true;
		},
		IsLowViolence() {
			return false;
		},
		IsEngineLogEnabled() {
			return true;
		},
		IsMapValid(strMapName) {
			return strMapName === "test_map";
		},
		IsModelPrecached(strPath) {
			return strPath === "models/test.mdl";
		},
		IsPaused() {
			return false;
		},
		IsOverrideLoadGameEntitiesEnabled() {
			return true;
		},
		IsSplitScreenPlayer(nPlayerIndex) {
			return nPlayerIndex === 2;
		},
		IsUserIDInUse(nUserID) {
			return nUserID === 7;
		},
		GetLaunchOptions() {
			return { Address: 0x29n, Kind: "KeyValues" };
		},
		GetChoreographySoundLatency() {
			return 0.25;
		},
		LoadPaintMapDataRLE(vecData) {
			g_vecSDKCalls.push(`paint-load:${vecData.join(",")}`);

			return true;
		},
		SetLightStyle(nLightStyle, strLightPattern) {
			g_vecSDKCalls.push(`light:${nLightStyle}:${strLightPattern}`);

			return true;
		},
		LoadAdjacentEntities(strOldLevelName, strLandmarkName) {
			g_vecSDKCalls.push(`adjacent:${strOldLevelName}:${strLandmarkName}`);

			return true;
		},
		LoadGameState(strMapName, bCreatePlayers) {
			g_vecSDKCalls.push(`load-state:${strMapName}:${bCreatePlayers}`);

			return true;
		},
		SetNetworkStringTablesLocked(bLock) {
			return !bLock;
		},
		PrintEngineLog(strMessage) {
			g_vecSDKCalls.push(`log:${strMessage}`);

			return true;
		},
		GetMapEntitiesString() {
			return '{"classname" "worldspawn"}';
		},
		GetMulticastRecipients(bUsePAS, Origin) {
			g_vecSDKCalls.push(`multicast:${bUsePAS}:${Origin.Y}`);

			return [1, 3];
		},
		EndMultiplayerGame() {
			g_vecSDKCalls.push("multiplayer-end");

			return true;
		},
		SetPaused(bPaused, bForce) {
			g_vecSDKCalls.push(`pause:${bPaused}:${bForce}`);

			return true;
		},
		PaintAllSurfaces(unColor) {
			g_vecSDKCalls.push(`paint-all:${unColor}`);

			return true;
		},
		NotifyEdictFlagsChange(nEntityIndex) {
			g_vecSDKCalls.push(`edict-flags:${nEntityIndex}`);

			return true;
		},
		PlayTemporaryEntity(strName, Value, vecRecipients, flDelay, bReliable) {
			const strRecipients = ((vecRecipients === null) || (vecRecipients === undefined)) ? "all" : vecRecipients.join(",");
			g_vecSDKCalls.push(`temp:${strName}:${Value.Value}:${strRecipients}:${flDelay}:${bReliable}`);

			return true;
		},
		PrecacheDecal(strPath, bPreload) {
			return ((strPath === "decals/native") && bPreload) ? 21 : -1;
		},
		PrecacheGeneric(strPath, bPreload) {
			return (((strPath === "scripts/native.txt") || (strPath === "scripts/sourcejs/runtime.txt")) && bPreload) ? 22 : -1;
		},
		PrecacheModel(strPath, bPreload) {
			return ((strPath === "models/native.mdl") && bPreload) ? 23 : -1;
		},
		PrecacheSound(strSample, bPreload, bUISound) {
			g_vecSDKCalls.push(`precache-sound:${strSample}:${bPreload}:${bUISound}`);

			return (strSample === "ui/buttonclick.wav") ? 24 : -1;
		},
		IsSoundPrecached(strSample) {
			return strSample === "ui/buttonclick.wav";
		},
		PrefetchSound(strSample) {
			g_vecSDKCalls.push(`prefetch-sound:${strSample}`);

			return true;
		},
		IsLoopingSound(strSample) {
			return strSample === "ambient/alarms/klaxon1.wav";
		},
		GetSoundDuration(strSample) {
			return (strSample === "ui/buttonclick.wav") ? 0.25 : 0;
		},
		EmitSound(Options) {
			g_vecSDKCalls.push(`emit-sound:${Options.Entity}:${Options.Sample}`);

			return true;
		},
		StopSound(Options) {
			g_vecSDKCalls.push(`stop-sound:${Options.Entity}:${Options.Channel}:${Options.Sample}`);

			return true;
		},
		QueueServerCommand(strCommandLine) {
			RequireCommandLine(strCommandLine, "QueueServerCommand");
			g_vecCommands.push(`queue-server:${strCommandLine}`);

			return true;
		},
		RemoveEdict(Edict) {
			return Edict.Index === g_unEntityPVSIndex;
		},
		RefreshScreenIfNecessary() {
			g_vecSDKCalls.push("refresh-screen");

			return true;
		},
		RemoveAllPaint() {
			g_vecSDKCalls.push("paint-remove");

			return true;
		},
		ReserveServerForQueuedGame(strPayload) {
			return strPayload === "reservation";
		},
		SendPaintMapDataToClient(nClientIndex) {
			return nClientIndex === 1;
		},
		ResetPVS(unPVSByteCount) {
			const unDefaultPVSByteCount = 8;
			const unMaximumPVSByteCount = 1_024 * 1_024;

			const unBufferByteCount = ((unPVSByteCount === undefined) || (unPVSByteCount === null)) ? unDefaultPVSByteCount : unPVSByteCount;
			if (!Number.isInteger(unBufferByteCount) || (unBufferByteCount < 1) || (unBufferByteCount > unMaximumPVSByteCount)) {
				throw new Error("ResetPVS requires a byte count between 1 and 1048576");
			}

			g_vecSDKCalls.push(`reset-pvs:${unBufferByteCount}`);

			return new Uint8Array(unBufferByteCount);
		},
		AddOriginToPVS(Origin) {
			g_vecSDKCalls.push(`add-pvs:${Origin.X}:${Origin.Y}:${Origin.Z}`);

			return new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		},
		GetSentenceGroupIndexFromName(strName) {
			return (strName === "Test") ? 2 : -1;
		},
		GetSentenceGroupNameFromIndex(nSentenceGroupIndex) {
			return (nSentenceGroupIndex === 2) ? "Test" : null;
		},
		PickSentenceFromGroup(nSentenceGroupIndex) {
			return { Index: nSentenceGroupIndex + 10, Name: "Test.Pick" };
		},
		PickSequentialSentenceFromGroup(nSentenceGroupIndex, nSentenceIndex) {
			return { Index: nSentenceIndex + 1, Name: `Test.${nSentenceGroupIndex}` };
		},
		GetSentenceIndexFromName(strName) {
			return (strName === "Test.Pick") ? 12 : -1;
		},
		GetSentenceDuration(nSentenceIndex) {
			return (nSentenceIndex === 12) ? 1.5 : 0;
		},
		GetSentenceNameFromIndex(nSentenceIndex) {
			return (nSentenceIndex === 12) ? "Test.Pick" : null;
		},
		ExecuteServerCommand(strCommandLine) {
			RequireCommandLine(strCommandLine, "ExecuteServerCommand");
			g_vecCommands.push(`server:${strCommandLine}`);

			return true;
		},
		GetServerVersion() {
			return 9015;
		},
		SetAreaPortalState(nAreaPortalNumber, bIsAreaPortalOpen) {
			g_vecSDKCalls.push(`portal-state:${nAreaPortalNumber}:${bIsAreaPortalOpen}`);

			return true;
		},
		SetAreaPortalStates(vecAreaPortalNumbers, vecAreaPortalOpenStates) {
			g_vecSDKCalls.push(`portal-states:${vecAreaPortalNumbers.join(",")}:${vecAreaPortalOpenStates.join(",")}`);

			return true;
		},
		SetDedicatedServerBenchmarkMode(bIsEnabled) {
			g_vecSDKCalls.push(`benchmark:${bIsEnabled}`);

			return true;
		},
		SetFakeClientCVarValue(Client, strCVarName, strCVarValue) {
			g_vecSDKCalls.push(`fake-cvar:${Client}:${strCVarName}:${strCVarValue}`);

			return true;
		},
		SetAchievementManager(AchievementManager) {
			g_vecSDKCalls.push(`achievement:${AchievementManager}`);

			return true;
		},
		SetServerHibernation(bHibernating) {
			g_vecSDKCalls.push(`hibernation:${bHibernating}`);

			return true;
		},
		SetNoClipEnabled(bNoClipEnabled) {
			g_vecSDKCalls.push(`noclip:${bNoClipEnabled}`);

			return true;
		},
		EnsureEntityInstanceBaseline(nEntityIndex) {
			return nEntityIndex === g_unEntityPVSIndex;
		},
		SetTimescale(flTimescale) {
			g_flNativeTimescale = RequireNativeFloat(flTimescale, "SetTimescale");

			return true;
		},
		SetClientViewEntity(nClientIndex, ViewEntity) {
			g_vecSDKCalls.push(`view:${nClientIndex}:${ViewEntity}`);

			return true;
		},
		ForceFlushEntity(nEntityIndex) {
			g_vecSDKCalls.push(`flush:${nEntityIndex}`);

			return true;
		},
		GetSharedEdictChangeInformation() {
			return { Address: 0xB000n, ChangeInformationCount: 2, Kind: "CSharedEdictChangeInfo", SerialNumber: 9 };
		},
		NotifySolidMoved(nEntityIndex, unCollideableAddress = null, PreviousOrigin = null, bTestSurroundingBoundsOnly = false) {
			g_vecSDKCalls.push(`solid-moved:${nEntityIndex}:${unCollideableAddress}:${PreviousOrigin?.X ?? "none"}:${bTestSurroundingBoundsOnly}`);

			return true;
		},
		StartClientCVarQuery(nClientIndex, strCVarName) {
			return ((nClientIndex === 1) && (strCVarName === "rate")) ? 91 : -1;
		},
		PlaceStaticDecal() {
			return true;
		},
		GetTextMessage(strTextMessageName) {
			return (strTextMessageName === "SourceJS_Test") ? {
				BoxColor: { Red: 0, Green: 0, Blue: 0, Alpha: 0 },
				Effect: 2,
				Message: "Test message",
				Name: strTextMessageName,
			} : null;
		},
		NotifyTriggerMoved(nEntityIndex, bTestSurroundingBoundsOnly) {
			g_vecSDKCalls.push(`trigger-moved:${nEntityIndex}:${bTestSurroundingBoundsOnly}`);

			return true;
		},
	},
};

function InstallDependency(strFilePath, ModuleExports) {
	require.cache[strFilePath] = {
		children: [],
		exports: ModuleExports,
		filename: strFilePath,
		id: strFilePath,
		loaded: true,
		paths: [],
	};
}

const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
InstallDependency(g_strRuntimePath, {
	GetModule(strModuleName) {
		if (!Object.hasOwn(g_NativeModules, strModuleName)) {
			throw new Error(`native module is unavailable: ${strModuleName}`);
		}

		return g_NativeModules[strModuleName];
	},
});

const g_ServerAPI = require(g_strServerPath);
g_Assert(g_ServerAPI === g_NativeModules["engines/server"], "engines/server must export the exact native module object");
g_Assert(g_ServerAPI.GetServer() === g_NativeServer, "GetServer must return the exact native IServer object");
g_Assert.equal(g_NativeServer.Address, 0x1000n, "IServer BigInt address");
g_Assert.equal(g_NativeServer.GetMaximumClients(), 8, "IServer.GetMaximumClients native result");
g_Assert.equal(g_NativeServer.GetAllocatedClientCount(), 3, "IServer.GetAllocatedClientCount native result");
g_Assert.equal(g_NativeServer.GetConnectedClientCount(), 8, "IServer.GetConnectedClientCount native result");
g_Assert.equal(g_NativeServer.GetUDPPort(), 27015, "IServer.GetUDPPort native result");
g_Assert.equal(g_NativeServer.GetServerName(), "SourceJS test server", "IServer.GetServerName native result");
g_Assert.equal(g_NativeServer.GetMapName(), "test_map", "IServer.GetMapName native result");
g_Assert.equal(g_NativeServer.GetNetworkStatistics().Outgoing, 34, "IServer.GetNetworkStatistics native result");
g_Assert(g_NativeServer.GetClient(0) === g_NativeClient, "IServer.GetClient must return the exact native IClient object");
g_Assert(g_NativeServer.DisconnectClient(g_NativeClient, "bye"), "IServer.DisconnectClient native result");
g_Assert(g_NativeServer.SetServerPassword("secret"), "IServer.SetServerPassword native result");
g_Assert.equal(g_NativeServer.GetServerPassword(), "secret", "IServer.GetServerPassword live result");
g_Assert(g_NativeServer.SetServerPaused(true), "IServer.SetServerPaused native result");
g_Assert(g_NativeServer.IsServerPaused(), "IServer.IsServerPaused native result");
g_Assert(g_NativeServer.SetServerTimescale(0.5), "IServer.SetServerTimescale native result");
g_Assert.equal(g_NativeServer.GetServerTimescale(), 0.5, "IServer.GetServerTimescale live result");
g_Assert(g_NativeServer.IsServerActive(), "IServer.IsServerActive native result");
g_Assert(g_NativeServer.IsMultiplayerServer(), "IServer.IsMultiplayerServer native result");
g_Assert(g_ServerAPI.GetServerFromAddress(0x1000n) === g_NativeServer, "GetServerFromAddress must return the exact native IServer object");
g_Assert.throws(() => g_ServerAPI.GetServerFromAddress(0n), Error, "GetServerFromAddress must reject a null address");

const g_vecEngineServerMethods = [
	"GetServerConstants",
	"ExecuteServerCommand",
	"QueueServerCommand",
	"InsertServerCommand",
	"GetGameDescription",
	"IsDedicatedServer",
	"GetEntityCount",
	"GetGlobalVariables",
	"GetMaximumClients",
	"GetMaximumEntities",
	"GetServerCount",
	"GetServerTime",
	"GetServerTick",
	"GetServerTickInterval",
	"GetMapName",
	"GetGameDirectory",
	"GetClientCVarValue",
	"ChangeLevel",
	"IsMapValid",
	"IsInEditMode",
	"IsModelPrecached",
	"IsDecalPrecached",
	"IsGenericPrecached",
	"GetClusterForOrigin",
	"GetPVSForCluster",
	"CheckOriginInPVS",
	"CheckBoxInPVS",
	"GetMulticastRecipients",
	"ResetPVS",
	"AddOriginToPVS",
	"SetAreaPortalState",
	"IsHeadNodeVisible",
	"AreAreasConnected",
	"GetAreaForOrigin",
	"GetAreaBits",
	"GetAreaPortalPlane",
	"SetAreaPortalStates",
	"LoadGameState",
	"LoadAdjacentEntities",
	"GetTextMessage",
	"GetPlayerInformation",
	"GetClientSteamID",
	"GetPlayerNetworkChannelInformation",
	"PrintDeveloperOverlayLine",
	"PrintDeveloperOverlayLineExtended",
	"ExecuteClientCommandKeyValues",
	"GetEntityTransmitBitsForClient",
	"NotifyEdictFlagsChange",
	"GetPreviousCheckTransmitInformation",
	"GetSharedEdictChangeInformation",
	"GetEntityChangeAccessor",
	"CreateSpatialPartition",
	"DestroySpatialPartition",
	"DrawSpatialPartitionMapToScratchPad",
	"NotifySolidMoved",
	"NotifyTriggerMoved",
	"BuildEntityClusterList",
	"CleanUpEntityClusterList",
	"PlayTemporaryEntity",
	"GetGameServerSteamID",
	"GetServerVersion",
	"EndMultiplayerGame",
	"CreateFakeClientWithOptions",
	"GetLaunchOptions",
	"IsUserIDInUse",
	"GetUserLoadingProgress",
	"IsEngineLogEnabled",
	"GetTimescale",
	"SetTimescale",
	"IsLevelMainMenuBackground",
	"IsAnyClientLowViolence",
	"IsOverrideLoadGameEntitiesEnabled",
	"IsCreatingResourceList",
	"IsCreatingXboxResourceList",
	"IsDedicatedServerForXbox",
	"IsDedicatedServerForPS3",
	"IsSplitScreenPlayer",
	"GetSplitScreenPlayerAttachment",
	"GetSplitScreenPlayerForEntity",
	"GetAttachedSplitScreenUserCount",
	"ForceFlushEntity",
	"GetSinglePlayerSharedMemorySpace",
	"SetPaused",
	"ValidateHostSession",
	"RefreshScreenIfNecessary",
	"GetAchievementManager",
	"SetAchievementManager",
	"SetServerHibernation",
	"HasPaintMap",
	"RemoveAllPaint",
	"PaintAllSurfaces",
	"GetClientXUID",
	"IsApplicationActive",
	"SetNoClipEnabled",
	"GetPaintMapDataRLE",
	"LoadPaintMapDataRLE",
	"SendPaintMapDataToClient",
	"GetChoreographySoundLatency",
	"GetClientCrossPlayPlatform",
	"EnsureEntityInstanceBaseline",
	"ReserveServerForQueuedGame",
	"CreateEdict",
	"RemoveEdict",
	"EmitAmbientSound",
	"FadeClientVolume",
	"PickSentenceFromGroup",
	"PickSequentialSentenceFromGroup",
	"GetSentenceIndexFromName",
	"GetSentenceNameFromIndex",
	"GetSentenceGroupIndexFromName",
	"GetSentenceGroupNameFromIndex",
	"GetSentenceDuration",
	"ExecuteClientCommand",
	"PrintToClientConsole",
	"SetLightStyle",
	"PlaceStaticDecal",
	"SetClientViewEntity",
	"SetClientCrosshairAngle",
	"SetNetworkStringTablesLocked",
	"CreateFakeClient",
	"IsPaused",
	"ForceExactFile",
	"ForceModelBounds",
	"ClearSaveDirectoryAfterClientLoad",
	"SetFakeClientCVarValue",
	"ForceSimpleMaterial",
	"AllowImmediateEdictReuse",
	"GetApplicationID",
	"IsLowViolence",
	"StartClientCVarQuery",
	"IsClientFullyAuthenticated",
	"SetDedicatedServerBenchmarkMode",
	"GetClusterCount",
	"GetMapEntitiesString",
	"PrintEngineLog",
	"PrecacheModel",
	"PrecacheGeneric",
	"PrecacheDecal",
	"PrecacheSound",
	"IsSoundPrecached",
	"PrefetchSound",
	"IsLoopingSound",
	"GetSoundDuration",
	"EmitSound",
	"StopSound",
	"GetServer",
	"GetServerFromAddress",
];
for (const strMethodName of g_vecEngineServerMethods) {
	g_Assert.equal(typeof g_ServerAPI[strMethodName], "function", `${strMethodName} must be a direct native export`);
}

g_Assert.equal(g_vecEngineServerMethods.length, 147, "engines/server fixture must cover all 147 selected-SDK exports");
g_Assert.deepEqual(Object.keys(g_ServerAPI).sort(), g_vecEngineServerMethods.toSorted(), "engines/server must expose exactly the selected-SDK fixture surface");

for (const unAddress of [1n, 0x20000000000001n, g_unMaximumMockAddress]) {
	g_Assert(g_ServerAPI.GetServerFromAddress(unAddress) === g_NativeServer, "GetServerFromAddress must accept the full modeled BigInt range");
	g_Assert(g_ServerAPI.DrawSpatialPartitionMapToScratchPad(unAddress, 0), "scratch-pad requests must accept the full modeled BigInt range");
}

for (const Value of [0n, -1n, g_unMaximumMockAddress + 1n, 0x1000, "4096", null, undefined, true, Object(1n)]) {
	g_Assert.throws(() => g_ServerAPI.GetServerFromAddress(Value), { name: "Error" }, "GetServerFromAddress must reject an invalid BigInt address");
	g_Assert.throws(() => g_ServerAPI.DrawSpatialPartitionMapToScratchPad(Value, 0), { name: "Error" }, "scratch-pad requests must reject an invalid BigInt address");
}

for (const SteamIDRecord of [g_ServerAPI.GetClientSteamID(1), g_ServerAPI.GetGameServerSteamID()]) {
	g_Assert.deepEqual(Object.keys(SteamIDRecord).toSorted(), ["AccountID", "AccountInstance", "AccountType", "StaticAccountKey", "Universe", "Valid", "Value"], "SteamID records must expose the exact PascalCase native fields");
	g_Assert.equal(typeof SteamIDRecord.StaticAccountKey, "bigint", "SteamID static keys must be BigInt");
	g_Assert.equal(typeof SteamIDRecord.Value, "bigint", "SteamID values must be BigInt");
}

const g_unExpectedDefaultPVSByteCount = 8;
const g_unExpectedMaximumPVSByteCount = 1_024 * 1_024;

for (const Value of [undefined, null, 1, g_unExpectedMaximumPVSByteCount]) {
	const arrPVSBytes = g_ServerAPI.ResetPVS(Value);
	g_Assert(arrPVSBytes instanceof Uint8Array, "ResetPVS must return byte storage");
	g_Assert.equal(arrPVSBytes.byteLength, ((Value === undefined) || (Value === null)) ? g_unExpectedDefaultPVSByteCount : Value, "ResetPVS must preserve the native optional-count contract");
}

for (const Value of [0, -1, 1.5, g_unExpectedMaximumPVSByteCount + 1, Number.MAX_VALUE, NaN, Infinity, "4", 4n, true, {}]) {
	g_Assert.throws(() => g_ServerAPI.ResetPVS(Value), { name: "Error" }, "ResetPVS must preserve the native count range and error class");
}

for (const flTimescale of [0, -1, 0.5, 1.25]) {
	g_Assert(g_ServerAPI.SetTimescale(flTimescale), "SetTimescale must accept native finite float values");
	g_Assert.equal(g_ServerAPI.GetTimescale(), Math.fround(flTimescale), "SetTimescale must preserve native float precision");
}

for (const Value of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, "1", 1n, null]) {
	const flPreviousTimescale = g_ServerAPI.GetTimescale();
	g_Assert.throws(() => g_ServerAPI.SetTimescale(Value), { name: "Error" }, "SetTimescale must reject invalid native float arguments");
	g_Assert.equal(g_ServerAPI.GetTimescale(), flPreviousTimescale, "invalid SetTimescale requests must not mutate native state");
}

g_Assert(g_ServerAPI.ChangeLevel("test_map"), "ChangeLevel native result");
g_Assert(g_ServerAPI.IsMapValid("test_map"), "IsMapValid native result");
g_Assert(g_ServerAPI.IsModelPrecached("models/test.mdl"), "IsModelPrecached native result");
g_Assert.equal(g_ServerAPI.GetClusterForOrigin({ X: 1, Y: 2, Z: 3 }), 12, "GetClusterForOrigin native result");

const g_PVS = g_ServerAPI.GetPVSForCluster(12);
g_Assert.equal(g_PVS.RequiredBytes, 4, "GetPVSForCluster required byte count");
g_Assert.equal(g_PVS.Bytes[0], 0x0C, "GetPVSForCluster bytes");
g_Assert(g_ServerAPI.CheckOriginInPVS({ X: 4, Y: 5, Z: 6 }, g_PVS.Bytes), "CheckOriginInPVS native result");
g_Assert(g_ServerAPI.CheckBoxInPVS({ X: 1, Y: 2, Z: 3 }, { X: 4, Y: 5, Z: 6 }, g_PVS.Bytes), "CheckBoxInPVS native result");
g_Assert.equal(g_ServerAPI.GetMulticastRecipients(false, { X: 1, Y: 2, Z: 3 }).join(","), "1,3", "GetMulticastRecipients native recipients");
g_Assert.equal(g_ServerAPI.ResetPVS(4).byteLength, 4, "ResetPVS native bytes");
g_Assert.equal(g_ServerAPI.AddOriginToPVS({ X: 7, Y: 8, Z: 9 })[3], 0x04, "AddOriginToPVS native bytes");
g_Assert(g_ServerAPI.SetAreaPortalState(17, true), "SetAreaPortalState native result");
g_Assert(g_ServerAPI.IsHeadNodeVisible(9, g_PVS.Bytes), "IsHeadNodeVisible native result");
g_Assert(g_ServerAPI.AreAreasConnected(2, 3), "AreAreasConnected native result");
g_Assert.equal(g_ServerAPI.GetAreaForOrigin({ X: 4, Y: 5, Z: 6 }), 2, "GetAreaForOrigin native result");
g_Assert.equal(g_ServerAPI.GetAreaBits(2)[0], 0x02, "GetAreaBits native bytes");
g_Assert.equal(g_ServerAPI.GetAreaPortalPlane({ X: 4, Y: 5, Z: 6 }, 17).Distance, 6, "GetAreaPortalPlane native result");
g_Assert(g_ServerAPI.SetAreaPortalStates([17, 18], [true, false]), "SetAreaPortalStates native result");
g_Assert.equal(g_ServerAPI.GetPlayerNetworkChannelInformation(1).RemoteAddress, "127.0.0.1:27005", "GetPlayerNetworkChannelInformation remote address");
g_Assert.equal(g_ServerAPI.GetPlayerInformation(1).Name, "Ren", "GetPlayerInformation native result");
g_Assert.equal(g_ServerAPI.GetClientSteamID(1).AccountID, 42, "GetClientSteamID native fields");
g_Assert.equal(g_ServerAPI.GetTextMessage("SourceJS_Test").Message, "Test message", "GetTextMessage native result");
g_Assert(g_ServerAPI.LoadGameState("test_map", false), "LoadGameState native result");
g_Assert(g_ServerAPI.LoadAdjacentEntities("old_map", "landmark"), "LoadAdjacentEntities native result");
g_Assert(g_ServerAPI.PrintDeveloperOverlayLine(2, "debug"), "PrintDeveloperOverlayLine native result");
g_Assert(g_ServerAPI.PrintDeveloperOverlayLineExtended({ Index: 3, TimeToLive: 2 }, "debug-x"), "PrintDeveloperOverlayLineExtended native result");
g_Assert(g_ServerAPI.ExecuteClientCommandKeyValues(1, { Handle: 31 }), "ExecuteClientCommandKeyValues forwards a handle wrapper");
g_Assert.equal(g_ServerAPI.GetEntityTransmitBitsForClient(1).Indexes.join(","), "1,77", "GetEntityTransmitBitsForClient native bits");
g_Assert(g_ServerAPI.NotifyEdictFlagsChange(g_unEntityPVSIndex), "NotifyEdictFlagsChange native result");
g_Assert.equal(g_ServerAPI.GetPreviousCheckTransmitInformation(1).TransmitEdicts[1], g_unEntityPVSIndex, "GetPreviousCheckTransmitInformation native result");
g_Assert.equal(g_ServerAPI.GetSharedEdictChangeInformation().SerialNumber, 9, "GetSharedEdictChangeInformation native result");
g_Assert.equal(g_ServerAPI.GetEntityChangeAccessor(g_unEntityPVSIndex).ChangeInformation, 3, "GetEntityChangeAccessor native result");

const g_Partition = g_ServerAPI.CreateSpatialPartition({ X: -1, Y: -2, Z: -3 }, { X: 4, Y: 5, Z: 6 });
g_Assert.equal(typeof g_Partition.Address, "bigint", "CreateSpatialPartition BigInt address");
g_Assert(g_ServerAPI.DrawSpatialPartitionMapToScratchPad(0xC000n, 7), "DrawSpatialPartitionMapToScratchPad native result");
g_Assert(g_ServerAPI.DestroySpatialPartition(g_Partition.Address), "DestroySpatialPartition native result");
g_Assert(g_ServerAPI.NotifySolidMoved(g_unEntityPVSIndex, 0xD000n, { X: 1, Y: 2, Z: 3 }, true), "NotifySolidMoved native result");
g_Assert(g_ServerAPI.NotifyTriggerMoved(g_unEntityPVSIndex, true), "NotifyTriggerMoved native result");

const g_EntityPVS = g_ServerAPI.BuildEntityClusterList(g_unEntityPVSIndex, g_unEntityPVSAddress);
g_Assert.equal(g_EntityPVS.Address, g_unEntityPVSAddress, "BuildEntityClusterList must preserve the BigInt address");
g_Assert.equal(g_EntityPVS.Clusters.join(","), "4,5", "BuildEntityClusterList native PVS data");
g_Assert(g_ServerAPI.CleanUpEntityClusterList(g_EntityPVS.Address), "CleanUpEntityClusterList native result");
g_Assert.equal(g_ServerAPI.BuildEntityClusterList(g_unEntityPVSIndex, { Index: g_unEntityPVSIndex }).Address, g_unEntityPVSAddress, "BuildEntityClusterList resolves a networkable entity");
g_Assert(g_ServerAPI.CleanUpEntityClusterList({ Index: g_unEntityPVSIndex }), "CleanUpEntityClusterList resolves a networkable entity");
g_Assert.throws(() => g_ServerAPI.BuildEntityClusterList(g_unEntityPVSIndex, { Address: g_unEntityPVSAddress }), /positive BigInt address/, "a PVS address wrapper is not a native address argument");
g_Assert.throws(() => g_ServerAPI.CleanUpEntityClusterList(g_EntityPVS), /positive BigInt address/, "cleanup requires the PVS Address, not its wrapper");

const g_PVSIndexError = new Error("PVS entity index getter failed");
const g_BrokenPVSReference = {
	get Index() {
		throw g_PVSIndexError;
	},
};
g_Assert.throws(() => g_ServerAPI.BuildEntityClusterList(g_unEntityPVSIndex, g_BrokenPVSReference), (ErrorValue) => ErrorValue === g_PVSIndexError, "build preserves an entity selector error before address fallback");
g_Assert.throws(() => g_ServerAPI.CleanUpEntityClusterList(g_BrokenPVSReference), (ErrorValue) => ErrorValue === g_PVSIndexError, "cleanup preserves an entity selector error before address fallback");

g_Assert(g_ServerAPI.PlayTemporaryEntity("CTest", { Value: 9 }, [1, 2], 0.1, true), "PlayTemporaryEntity native result");
g_Assert.equal(g_ServerAPI.PrecacheDecal("decals/native", true), 21, "PrecacheDecal native result");
g_Assert.equal(g_ServerAPI.PrecacheGeneric("scripts/native.txt", true), 22, "PrecacheGeneric native result");
g_Assert.equal(g_ServerAPI.PrecacheModel("models/native.mdl", true), 23, "PrecacheModel native result");
g_Assert.equal(g_ServerAPI.GetGameServerSteamID().Value, 901n, "GetGameServerSteamID native fields");
g_Assert.equal(g_ServerAPI.GetServerVersion(), 9015, "GetServerVersion native result");
g_Assert(g_ServerAPI.EndMultiplayerGame(), "EndMultiplayerGame native result");
g_Assert.equal(g_ServerAPI.CreateFakeClientWithOptions("ReportedBot", false).Index, 5, "CreateFakeClientWithOptions native edict");
g_Assert.equal(g_ServerAPI.GetLaunchOptions().Address, 0x29n, "GetLaunchOptions native KeyValues address");
g_Assert(g_ServerAPI.IsUserIDInUse(7), "IsUserIDInUse native result");
g_Assert.equal(g_ServerAPI.GetUserLoadingProgress(7), 88, "GetUserLoadingProgress native result");
g_Assert(g_ServerAPI.IsEngineLogEnabled(), "IsEngineLogEnabled native result");
g_Assert(g_ServerAPI.SetTimescale(0.75), "SetTimescale native result");
g_Assert.equal(g_ServerAPI.GetTimescale(), 0.75, "GetTimescale native result");
g_Assert(g_ServerAPI.IsLevelMainMenuBackground(), "IsLevelMainMenuBackground native result");
g_Assert(!g_ServerAPI.IsAnyClientLowViolence(), "IsAnyClientLowViolence native result");
g_Assert(g_ServerAPI.IsOverrideLoadGameEntitiesEnabled(), "IsOverrideLoadGameEntitiesEnabled native result");
g_Assert(!g_ServerAPI.IsCreatingResourceList(), "IsCreatingResourceList native result");
g_Assert(!g_ServerAPI.IsCreatingXboxResourceList(), "IsCreatingXboxResourceList native result");
g_Assert(!g_ServerAPI.IsDedicatedServerForXbox(), "IsDedicatedServerForXbox native result");
g_Assert(!g_ServerAPI.IsDedicatedServerForPS3(), "IsDedicatedServerForPS3 native result");
g_Assert(g_ServerAPI.IsSplitScreenPlayer(2), "IsSplitScreenPlayer native result");
g_Assert.equal(g_ServerAPI.GetSplitScreenPlayerAttachment(2).Index, 1, "GetSplitScreenPlayerAttachment native edict");
g_Assert.equal(g_ServerAPI.GetSplitScreenPlayerForEntity(1, 0).Index, 2, "GetSplitScreenPlayerForEntity native edict");
g_Assert.equal(g_ServerAPI.GetAttachedSplitScreenUserCount(1), 1, "GetAttachedSplitScreenUserCount native result");
g_Assert(g_ServerAPI.ForceFlushEntity(g_unEntityPVSIndex), "ForceFlushEntity native result");
g_Assert.equal(g_ServerAPI.GetSinglePlayerSharedMemorySpace("SourceJS", g_unEntityPVSIndex).Address, 0xF100n, "GetSinglePlayerSharedMemorySpace BigInt address");
g_Assert(g_ServerAPI.SetPaused(true, true), "SetPaused native result");
g_Assert(g_ServerAPI.ValidateHostSession(), "ValidateHostSession native result");
g_Assert(g_ServerAPI.RefreshScreenIfNecessary(), "RefreshScreenIfNecessary native result");

const g_AchievementManager = g_ServerAPI.GetAchievementManager();
g_Assert(g_ServerAPI.SetAchievementManager(g_AchievementManager.Address), "SetAchievementManager native result");
g_Assert(g_ServerAPI.SetServerHibernation(true), "SetServerHibernation native result");
g_Assert(g_ServerAPI.HasPaintMap(), "HasPaintMap native result");
g_Assert.equal(g_ServerAPI.GetClientXUID(1), 76_561_197_960_265_770n, "GetClientXUID native UInt64 result");
g_Assert(g_ServerAPI.IsApplicationActive(), "IsApplicationActive native result");
g_Assert.equal(g_ServerAPI.GetPaintMapDataRLE().join(","), "11,22,33", "GetPaintMapDataRLE native data");
g_Assert(g_ServerAPI.LoadPaintMapDataRLE([0x2C, 0x37]), "LoadPaintMapDataRLE native result");
g_Assert.equal(g_ServerAPI.GetClientCrossPlayPlatform(1), 2, "GetClientCrossPlayPlatform native result");
g_Assert(g_ServerAPI.EnsureEntityInstanceBaseline(g_unEntityPVSIndex), "EnsureEntityInstanceBaseline native result");
g_Assert(g_ServerAPI.ReserveServerForQueuedGame("reservation"), "ReserveServerForQueuedGame native result");

const g_CreatedEdict = g_ServerAPI.CreateEdict(g_unEntityPVSIndex);
g_Assert.equal(g_CreatedEdict.Index, g_unEntityPVSIndex, "CreateEdict native object");
g_Assert(g_ServerAPI.RemoveEdict(g_CreatedEdict), "RemoveEdict native object");
g_Assert.equal(g_ServerAPI.CreateFakeClient("Bot").Name, "Bot", "CreateFakeClient native object");
g_Assert.equal(g_ServerAPI.PickSentenceFromGroup(2).Name, "Test.Pick", "PickSentenceFromGroup native result");
g_Assert.equal(g_ServerAPI.GetSentenceNameFromIndex(12), "Test.Pick", "GetSentenceNameFromIndex native result");
g_Assert.equal(g_ServerAPI.GetSentenceDuration(12), 1.5, "GetSentenceDuration native result");
g_Assert(g_ServerAPI.ExecuteClientCommand(1, "play ui/buttonclick.wav", true), "ExecuteClientCommand native result");
g_Assert(g_ServerAPI.PrintToClientConsole(1, "SourceJS test"), "PrintToClientConsole native result");
g_Assert(g_ServerAPI.EmitAmbientSound(0, { X: 1, Y: 2, Z: 3 }, "ambient/test.wav", 0.8, 75, 0, 100, 0.25), "EmitAmbientSound native result");
g_Assert.equal(g_ServerAPI.GetApplicationID(), 550, "GetApplicationID native result");
g_Assert.equal(g_ServerAPI.GetClusterCount(), 64, "GetClusterCount native result");
g_Assert.equal(g_ServerAPI.GetMapEntitiesString(), '{"classname" "worldspawn"}', "GetMapEntitiesString native result");
g_Assert.equal(g_ServerAPI.StartClientCVarQuery(1, "rate"), 91, "StartClientCVarQuery native result");
g_Assert(g_ServerAPI.IsClientFullyAuthenticated(1), "IsClientFullyAuthenticated native result");
g_Assert(g_ServerAPI.ForceExactFile("materials/test.vmt"), "ForceExactFile native result");
g_Assert(g_ServerAPI.PrintEngineLog("sourcejs test"), "PrintEngineLog native result");
g_Assert(g_vecSDKCalls.includes("change-level:test_map:undefined"), "ChangeLevel arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("exact:materials/test.vmt"), "ForceExactFile argument should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("multicast:false:2"), "GetMulticastRecipients arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("portal-states:17,18:true,false"), "SetAreaPortalStates arrays should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("client-command:1:play ui/buttonclick.wav:true"), "ExecuteClientCommand arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("client-printf:1:SourceJS test"), "PrintToClientConsole arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("ambient:0:1:ambient/test.wav:0.8:75:0:100:0.25"), "EmitAmbientSound arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("load-state:test_map:false"), "LoadGameState arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("adjacent:old_map:landmark"), "LoadAdjacentEntities arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("client-kv:1:31"), "ExecuteClientCommandKeyValues handle arguments should reach the forwarding fixture unchanged");
g_Assert(g_vecSDKCalls.includes("solid-moved:77:53248:1:true"), "NotifySolidMoved arguments should reach native unchanged");
g_Assert(g_vecSDKCalls.includes("temp:CTest:9:1,2:0.1:true"), "PlayTemporaryEntity arguments should reach native unchanged");
g_Assert.equal(g_ServerAPI.GetMaximumClients(), 8, "GetMaximumClients native value");
g_Assert.equal(g_ServerAPI.GetMaximumEntities(), 2_048, "GetMaximumEntities native value");
g_Assert.equal(g_ServerAPI.GetServerCount(), 3, "GetServerCount native value");
g_Assert.equal(g_ServerAPI.GetServerTime(), 12.5, "GetServerTime native value");
g_Assert.equal(g_ServerAPI.GetServerTick(), 512, "GetServerTick native value");
g_Assert.equal(g_ServerAPI.GetServerTickInterval(), 0.015, "GetServerTickInterval native value");
g_Assert.equal(g_ServerAPI.GetMapName(), "test_map", "GetMapName native value");

const g_GlobalVariables = g_ServerAPI.GetGlobalVariables();
const g_SecondGlobalVariables = g_ServerAPI.GetGlobalVariables();
g_Assert(g_GlobalVariables !== g_SecondGlobalVariables, "GetGlobalVariables must return a fresh JavaScript view");
g_Assert.equal(g_GlobalVariables.TickCount, 512, "GetGlobalVariables TickCount");
g_Assert.equal(g_GlobalVariables.MapName, "test_map", "GetGlobalVariables MapName");

for (const strPropertyName of [
	"Address",
	"MapName",
	"StartSpot",
	"MapGroupName",
	"RealTime",
	"FrameCount",
	"AbsoluteFrameTime",
	"AbsoluteFrameStartTimeStandardDeviation",
	"CurrentTime",
	"FrameTime",
	"MaximumClients",
	"TickCount",
	"IntervalPerTick",
	"InterpolationAmount",
	"SimulatedTicksThisFrame",
	"NetworkProtocol",
	"SaveRestoreDataAddress",
	"MapVersion",
	"MapLoadType",
	"MapLoadFailed",
	"IsDeathmatch",
	"IsCooperative",
	"IsTeamplay",
	"MaximumEntities",
	"ServerCount",
	"EdictArrayAddress",
]) {
	g_Assert(Object.hasOwn(g_GlobalVariables, strPropertyName), `GetGlobalVariables must expose ${strPropertyName}`);
}

g_Assert.equal(g_GlobalVariables.IsClient(), false, "GetGlobalVariables IsClient");
g_Assert.equal(g_GlobalVariables.IsRemoteClient(), false, "GetGlobalVariables IsRemoteClient");
g_Assert.equal(g_GlobalVariables.GetNetworkBase(512, 7), 507, "GetGlobalVariables GetNetworkBase");

for (const strPropertyName of ["SaveRestoreDataAddress", "EdictArrayAddress"]) {
	const unPreviousAddress = g_GlobalVariables[strPropertyName];
	for (const unAddress of [0n, 0x20000000000001n, g_unMaximumMockAddress]) {
		g_GlobalVariables[strPropertyName] = unAddress;
		g_Assert.equal(g_SecondGlobalVariables[strPropertyName], unAddress, "global views must share exact BigInt addresses");
	}

	for (const Value of [-1n, g_unMaximumMockAddress + 1n, 0, 0x1000, "4096", null, undefined, true, Object(1n)]) {
		g_Assert.throws(() => {
			g_GlobalVariables[strPropertyName] = Value;
		}, { name: "Error" }, "global address fields must reject non-native address values");
		g_Assert.equal(g_SecondGlobalVariables[strPropertyName], g_unMaximumMockAddress, "invalid global address writes must leave shared state unchanged");
	}

	g_GlobalVariables[strPropertyName] = unPreviousAddress;
	g_Assert.equal(g_SecondGlobalVariables[strPropertyName], unPreviousAddress, "global address fields must restore shared state");
}

const g_flPreviousCurrentTime = g_GlobalVariables.CurrentTime;
g_GlobalVariables.CurrentTime = 20;
g_Assert.equal(g_SecondGlobalVariables.CurrentTime, 20, "GetGlobalVariables views must share native backing state");
g_SecondGlobalVariables.CurrentTime = g_flPreviousCurrentTime;
g_Assert.equal(g_ServerAPI.GetGlobalVariables().CurrentTime, g_flPreviousCurrentTime, "GetGlobalVariables CurrentTime restoration");
g_Assert.equal(g_ServerAPI.GetEntityCount(), 42, "GetEntityCount native value");
g_Assert.equal(g_ServerAPI.GetGameDirectory(), "C:/game/left4dead2", "GetGameDirectory native value");
g_Assert.equal(g_ServerAPI.GetGameDescription(), "Left 4 Dead 2", "GetGameDescription native value");
g_Assert.equal(g_ServerAPI.GetClientCVarValue(1, "name"), "1:name", "GetClientCVarValue native value");
g_Assert.throws(() => g_ServerAPI.GetClientCVarValue(1, ""), "GetClientCVarValue must preserve native empty-name errors");
g_Assert.throws(() => g_ServerAPI.GetClientCVarValue(1), "GetClientCVarValue must preserve native missing-name errors");
g_Assert.equal(g_ServerAPI.GetClientCVarValue(0, "name"), "", "GetClientCVarValue must preserve the native zero-index empty result");
g_Assert.equal(g_ServerAPI.GetClientCVarValue(-1, "name"), "", "GetClientCVarValue must preserve the native negative-index empty result");
g_Assert.throws(() => g_ServerAPI.GetClientCVarValue(0, ""), "GetClientCVarValue must validate the name before the nonpositive-index result");

(() => {
	const vecArraySelector = [];
	vecArraySelector.Index = 3;
	const FunctionSelector = () => {};
	FunctionSelector.Index = 4;
	const BoxedSelector = new Number(5);
	BoxedSelector.Index = 6;
	const vecSelectors = [
		{ Selector: 1, Index: 1 },
		{ Selector: -0, Index: 0 },
		{ Selector: -1, Index: -1 },
		{ Selector: -2_147_483_648, Index: -2_147_483_648 },
		{ Selector: 2_147_483_647, Index: 2_147_483_647 },
		{ Selector: { Index: 2 }, Index: 2 },
		{ Selector: vecArraySelector, Index: 3 },
		{ Selector: FunctionSelector, Index: 4 },
		{ Selector: BoxedSelector, Index: 6 },
		{ Selector: Object.create({ Index: 7 }), Index: 7 },
	];
	for (const Case of vecSelectors) {
		const strExpected = (Case.Index > 0) ? String(Case.Index) + ":name" : "";
		g_Assert.equal(g_ServerAPI.GetClientCVarValue(Case.Selector, "name"), strExpected, "Client CVar selector mock follows native integer-or-Index parsing");
	}

	const vecInvalidSelectors = [undefined, null, true, false, "1", 1n, 1.5, NaN, Infinity, -Infinity, 2_147_483_648, -2_147_483_649, 2 ** 40, {}, [], new Number(1), { Index: "1" }, { Index: 1n }, { Index: NaN }, { Index: 1.5 }, { Index: 2_147_483_648 }];
	for (const Selector of vecInvalidSelectors) {
		g_Assert.equal(g_ServerAPI.GetClientCVarValue(Selector, "name"), "", "Unrecognized Client CVar selectors produce the native empty result");
	}

	let unIndexReads = 0;
	const Selector = {
		get Index() {
			++unIndexReads;
			return 1;
		},
		valueOf() {
			throw new Error("Client CVar selector must not coerce an object");
		},
	};
	g_Assert.equal(g_ServerAPI.GetClientCVarValue(Selector, "name"), "1:name");
	g_Assert.equal(unIndexReads, 1, "Client CVar Index is read once");

	for (const Name of [undefined, null, 1, 1n, {}, new String("name"), Symbol("name")]) {
		unIndexReads = 0;
		g_Assert.throws(() => g_ServerAPI.GetClientCVarValue(Selector, Name), /GetClientCVarValue\(PlayerOrIndex, strCVarName\)/);
		g_Assert.equal(unIndexReads, 0, "Primitive name type is checked before reading Index");
	}

	for (const Original of [undefined, null, Symbol("Client CVar Index"), new Error("Client CVar Index")]) {
		const ThrowingSelector = {
			get Index() {
				throw Original;
			},
		};
		for (const strName of ["name", "", "\0suffix"]) {
			let bCaught = false;
			try {
				g_ServerAPI.GetClientCVarValue(ThrowingSelector, strName);
			} catch (Failure) {
				bCaught = true;
				g_Assert.strictEqual(Failure, Original, "Client CVar Index errors precede name decoding and empty-name checks");
			}

			g_Assert(bCaught);
		}
	}

	const NonCoercingIndex = {
		Index: {
			valueOf() {
				throw new Error("Client CVar Index must not coerce its value");
			},
		},
	};
	g_Assert.equal(g_ServerAPI.GetClientCVarValue(NonCoercingIndex, "name"), "");
	g_Assert.equal(g_ServerAPI.GetClientCVarValue(1, "name\0suffix"), "1:name", "SDK name consumes its C-string prefix");
	g_Assert.equal(g_ServerAPI.GetClientCVarValue(1, "\0suffix"), "1:", "A nonempty UTF-8 name may have an empty C-string prefix");
	g_Assert.equal(g_ServerAPI.GetClientCVarValue(0, "\0suffix"), "");
	g_Assert.equal(g_ServerAPI.GetClientCVarValue(1, "\uD800"), "1:\uFFFD", "Mock SDK name matches native UTF-8 encoding");
	g_Assert.throws(() => g_ServerAPI.GetClientCVarValue({ Index: 0 }, ""), /non-empty CVar name/);
})();
g_Assert(g_ServerAPI.IsDedicatedServer(), "IsDedicatedServer native value");

g_Assert(g_ServerAPI.ExecuteServerCommand("status"), "ExecuteServerCommand native result");
g_Assert(g_ServerAPI.QueueServerCommand("changelevel test_map"), "QueueServerCommand native result");
g_Assert(g_ServerAPI.InsertServerCommand("exec server.cfg"), "InsertServerCommand native result");
g_Assert.throws(() => g_ServerAPI.ExecuteServerCommand(""), "ExecuteServerCommand must preserve native empty-command errors");
g_Assert.throws(() => g_ServerAPI.QueueServerCommand(""), "QueueServerCommand must preserve native empty-command errors");
g_Assert.throws(() => g_ServerAPI.InsertServerCommand(""), "InsertServerCommand must preserve native empty-command errors");
g_Assert.equal(g_vecCommands.join("|"), "server:status|queue-server:changelevel test_map|insert-server:exec server.cfg", "server command native order");
g_Assert(g_ServerAPI.ExecuteServerCommand("echo root"), "ExecuteServerCommand direct native result");
g_Assert.equal(g_vecCommands.at(-1), "server:echo root", "ExecuteServerCommand direct native command");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "engineServer"), false, "engines/server must not expose an engineServer facade");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "server"), false, "engines/server must not expose a Server facade");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "globalVars"), false, "engines/server must not expose a globalVars facade");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "moduleName"), false, "engines/server must not expose moduleName metadata");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "executeServerCommand"), false, "engines/server must not expose executeServerCommand");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "queueCommandString"), false, "engines/server must not expose queueCommandString");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "insertCommandString"), false, "engines/server must not expose insertCommandString");
g_Assert.equal(Object.hasOwn(g_ServerAPI, "getClientConVarValue"), false, "engines/server must not expose getClientConVarValue");
g_Assert.equal(g_NativeClient.NetworkChannelAddress, 0x3000n, "IClient network channel address must be BigInt");
g_Assert.equal(Object.hasOwn(g_NativeClient, "netchannel"), false, "IClient must not expose a netchannel wrapper snapshot");
g_Assert.equal(Object.hasOwn(g_NativeClient, "valid"), false, "IClient must not expose a valid snapshot");
g_Assert(g_NativeClient.SetNetworkRate(32_000, true), "IClient.SetNetworkRate must write live native state");
g_Assert.equal(g_NativeClient.Rate, 32_000, "IClient.Rate must read live native state");
g_Assert(g_NativeClient.SetUpdateRate(60, true), "IClient.SetUpdateRate must write live native state");
g_Assert.equal(g_NativeClient.UpdateRate, 60, "IClient.UpdateRate must read live native state");
g_Assert.throws(() => g_NativeClient.SetNetworkRate(30_000, 1), "IClient.SetNetworkRate must reject a non-boolean force argument");
g_Assert.throws(() => g_NativeClient.SetUpdateRate(30, 1), "IClient.SetUpdateRate must reject a non-boolean force argument");

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = flX;
		this.Y = flY;
		this.Z = flZ;
	}

	Add(VectorValue) {
		return new Vector(this.X + VectorValue.X, this.Y + VectorValue.Y, this.Z + VectorValue.Z);
	}
}

function VerifyWorldCommandLifecycle() {
	const unScriptTimeoutMilliseconds = 1_000;

	const strExamplePath = g_Path.join(g_strRepositoryRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const setModules = new Set(Array.from(strExample.matchAll(/require\("([^"]+)"\)/g), (vecMatch) => vecMatch[1]));
	const FlattenErrors = (Failure) => Array.isArray(Failure?.errors) ? Array.from(Failure.errors).flatMap(FlattenErrors) : [Failure];
	const CreateRun = (Profile = {}) => {
		const Exports = {};
		const State = { Command: null, Listener: null, CommandActive: false, ListenerActive: false, RegisterCalls: 0, ListenerCalls: 0, UnregisterCalls: 0, DisposeCalls: 0, SDKCalls: [], Warnings: [], Logs: [], Caught: false, Failure: undefined };
		const mapOverrides = new Map();
		const vecRecursiveResults = [];
		const Source = {
			RegisterCommand(strName, Callback) {
				g_Assert.equal(strName, "sjs_api_world");
				g_Assert.equal(typeof Exports.Unload, "function", "Unload must exist before any registration");
				State.RegisterCalls += 1;

				if (Profile.ThrowRegister) {
					throw Profile.Error;
				}

				if (Profile.RejectRegister) {
					return false;
				}

				State.Command = Callback;
				State.CommandActive = true;

				if (Profile.UnloadDuringRegister) {
					Exports.Unload();
				}

				return true;
			},
			UnregisterCommand(strName, Callback) {
				g_Assert.equal(strName, "sjs_api_world");
				g_Assert.equal(Callback, State.Command);
				State.UnregisterCalls += 1;

				if (Profile.ReenterUnregister && (State.UnregisterCalls === 1)) {
					vecRecursiveResults.push(Exports.Unload());
				}

				if (Profile.ThrowUnregister && (State.UnregisterCalls === 1)) {
					throw Profile.Error;
				}

				if (Profile.RejectUnregister && (State.UnregisterCalls === 1)) {
					return false;
				}

				State.CommandActive = false;

				return true;
			},
		};
		const Listeners = {
			RegisterPluginUnloadingListener(Callback) {
				State.ListenerCalls += 1;

				if (Profile.ThrowListener) {
					throw Profile.Error;
				}

				if (Profile.RejectListener) {
					return null;
				}

				State.Listener = Callback;
				State.ListenerActive = true;
				const Registration = {
					DisposeListener() {
						State.DisposeCalls += 1;

						if (Profile.ReenterDispose && (State.DisposeCalls === 1)) {
							vecRecursiveResults.push(Exports.Unload());
						}

						if (Profile.ThrowDispose && (State.DisposeCalls === 1)) {
							throw Profile.DisposeError;
						}

						if (Profile.RejectDispose && (State.DisposeCalls === 1)) {
							return false;
						}

						State.ListenerActive = false;

						return true;
					},
				};

				if (Profile.UnloadDuringListener) {
					Exports.Unload();
				}

				return Registration;
			},
		};
		const Loggers = {
			LogInfo(strMessage) {
				if (Profile.ThrowLog) {
					throw Profile.Error;
				}

				State.Logs.push(strMessage);
			},
			LogWarning(strMessage) {
				State.Warnings.push(strMessage);
			},
		};
		const Context = g_VM.createContext({
			exports: Exports,
			require: (strName) => {
				g_Assert.ok(setModules.has(strName), `Unexpected world-example dependency ${strName}`);

				if (strName === "source") {
					return Source;
				}

				if (strName === "listeners") {
					return Listeners;
				}

				if (strName === "loggers") {
					return Loggers;
				}

				return new Proxy({}, { get: (Target, Property) => {
					if (Object.hasOwn(Target, Property)) {
						return Target[Property];
					}

					const strMember = String(Property);
					if ((strName === "mathlib") && (strMember === "Vector")) {
						return Vector;
					}

					const strKey = `${strName}.${strMember}`;
					const Callback = function(...vecArguments) {
						State.SDKCalls.push(strKey);
						const Override = mapOverrides.get(strKey);
						g_Assert.equal(typeof Override, "function", `Unexpected SDK operation ${strKey}`);

						if (new.target !== undefined) {
							return Reflect.construct(Override, vecArguments);
						}

						return Override(...vecArguments);
					};
					Target[Property] = Callback;

					return Callback;
				} });
			},
		});
		try {
			g_VM.runInContext(strExample, Context, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
		} catch (CaughtError) {
			State.Caught = true;
			State.Failure = CaughtError;
		}

		return { State, Exports, Context, Overrides: mapOverrides, RecursiveResults: vecRecursiveResults, Invoke: (vecArguments) => State.Command({ Arguments: ["sjs_api_world", ...vecArguments] }) };
	};
	let unLifecycleScenarios = 0;
	for (const Profile of [{}, { UnloadDuringRegister: true }, { UnloadDuringListener: true }, { ReenterUnregister: true }, { ReenterDispose: true }]) {
		const Run = CreateRun(Profile);
		g_Assert.equal(Run.State.Caught, false);
		g_Assert.equal(Run.Exports.Unload(), true);
		g_Assert.equal(Run.Exports.Unload(), true);
		g_Assert.equal(Run.State.UnregisterCalls, 1);
		g_Assert.equal(Run.State.DisposeCalls, Profile.UnloadDuringRegister ? 0 : 1);
		g_Assert.equal(Run.State.CommandActive, false);
		g_Assert.equal(Run.State.ListenerActive, false);
		g_Assert.ok(Run.RecursiveResults.every((bResult) => bResult === false));
		g_Assert.equal(g_VM.runInContext("g_bCleanupInProgress", Run.Context), false);
		Run.State.Command({ get Arguments() {
			g_Assert.fail("Stale callbacks must not inspect command arguments");
		} });
		g_Assert.equal(Run.State.SDKCalls.length, 0);

		if (Profile.UnloadDuringRegister || Profile.UnloadDuringListener) {
			g_Assert.equal(Run.State.Logs.length, 0, "a synchronously unloaded plugin must not report successful loading");
		}

		unLifecycleScenarios += 1;
	}

	for (const ErrorValue of [undefined, null, false, 0, "opaque startup failure", Object.freeze(new Error("opaque startup failure"))]) {
		for (const strStage of ["REGISTER", "LISTENER", "LOG"]) {
			const Run = CreateRun({ Error: ErrorValue, ThrowRegister: strStage === "REGISTER", ThrowListener: strStage === "LISTENER", ThrowLog: strStage === "LOG" });
			g_Assert.equal(Run.State.Caught, true);
			g_Assert.equal(Run.State.Failure, ErrorValue);
			g_Assert.equal(Run.State.CommandActive, false);
			g_Assert.equal(Run.State.ListenerActive, false);
			g_Assert.equal(Run.Exports.Unload(), true);
			unLifecycleScenarios += 1;
		}
	}

	for (const Profile of [{ RejectRegister: true }, { RejectListener: true }]) {
		const Run = CreateRun(Profile);
		g_Assert.equal(Run.State.Caught, true);
		g_Assert.equal(Run.State.CommandActive, false);
		g_Assert.equal(Run.State.ListenerActive, false);
		g_Assert.equal(Run.Exports.Unload(), true);
		unLifecycleScenarios += 1;
	}

	for (const Profile of [{ RejectUnregister: true }, { RejectDispose: true }, { ThrowUnregister: true, Error: null }, { ThrowDispose: true, DisposeError: undefined }, { ThrowUnregister: true, Error: false, ThrowDispose: true, DisposeError: 0 }]) {
		const Run = CreateRun(Profile);
		let bCaught = false;
		let Failure = undefined;
		try {
			Run.Exports.Unload();
		} catch (CaughtError) {
			bCaught = true;
			Failure = CaughtError;
		}

		g_Assert.equal(bCaught, true);
		const vecFailures = FlattenErrors(Failure);
		g_Assert.equal(vecFailures.length, Number(Boolean(Profile.RejectUnregister || Profile.ThrowUnregister)) + Number(Boolean(Profile.RejectDispose || Profile.ThrowDispose)));
		g_Assert.equal(Run.State.UnregisterCalls, 1);
		g_Assert.equal(Run.State.DisposeCalls, 1);
		Run.State.Command({ get Arguments() {
			g_Assert.fail("A failed cleanup must still close command dispatch");
		} });
		g_Assert.equal(Run.Exports.Unload(), true);
		g_Assert.equal(Run.State.UnregisterCalls, (Profile.RejectUnregister || Profile.ThrowUnregister) ? 2 : 1);
		g_Assert.equal(Run.State.DisposeCalls, (Profile.RejectDispose || Profile.ThrowDispose) ? 2 : 1);
		g_Assert.equal(Run.State.SDKCalls.length, 0);
		unLifecycleScenarios += 1;
	}

	const ReentrantArguments = CreateRun();
	ReentrantArguments.State.Command({ get Arguments() {
		ReentrantArguments.Exports.Unload();

		return ["sjs_api_world", "raw", "temp", "CTest", "confirm"];
	} });
	g_Assert.equal(ReentrantArguments.State.SDKCalls.length, 0);
	unLifecycleScenarios += 1;
	const vecMalformed = [
		["inspect", "extra"],
		["player", "1", "unknown"],
		["player", "1", "slay", "confirm", "extra"],
		["player", "1", "kick"],
		["player", "1", "ban", "1", "confirm", "extra"],
		["player", "1", "team", "2147483648", "confirm"],
		["player", "1", "keyValues", "message"],
		["player", "1", "hitbox", "0", "0", "4", "2", "3", "1", "5", "6", "confirm"],
		["entity", "1", "unknown"],
		["entity", "1", "remove", "extra", "confirm"],
		["entity", "1", "input", "confirm"],
		["entity", "1", "input", "Use", "", "1", "confirm", "extra"],
		["entity", "1", "input", "Use", "", "1e100", "confirm"],
		["sound", "1", "2", "3", "sample", "confirm", "extra"],
		["sound", "1e100", "2", "3", "sample", "confirm"],
		["transition", "load", "map", "confirm", "extra"],
		["transition", "adjacent", "old", "landmark", "confirm", "extra"],
		["partition", "0", "0", "0", "1", "1", "1", "extra", "confirm"],
		["partition", "1", "0", "0", "0", "1", "1", "confirm"],
		["moved", "1", "solid", "extra", "confirm"],
		["raw", "temp", "CTest", "confirm", "extra"],
		["raw", "scratch", "1", "0", "confirm", "extra"],
		["raw", "scratch", "1", " ", "confirm"],
		["branch", "inspect", "1", "extra"],
		["branch", "inspect", "2147483648"],
		["branch", "end", "confirm", "extra"],
		["branch", "bot", "name", "confirm", "extra"],
		["branch", "timescale", "1", "confirm", "extra"],
		["branch", "timescale", "1e100", "confirm"],
		["branch", "pause", "on", "confirm", "extra"],
		["branch", "hibernate", "off", "confirm", "extra"],
		["branch", "flush", "1", "confirm", "extra"],
		["branch", "flush", "2147483648", "confirm"],
		["branch", "shared", "name", "1", "extra"],
		["branch", "session", "confirm", "extra"],
		["branch", "paint", "1", "confirm", "extra"],
		["branch", "removePaint", "confirm", "extra"],
		["pvs", "inspect", "1e100", "0", "0"],
	];
	const InvalidRun = CreateRun();
	for (const vecArguments of vecMalformed) {
		const unWarningsBefore = InvalidRun.State.Warnings.length;
		InvalidRun.Invoke(vecArguments);
		g_Assert.equal(InvalidRun.State.Warnings.length, unWarningsBefore + 1, JSON.stringify(vecArguments));
		g_Assert.equal(InvalidRun.State.SDKCalls.length, 0);
	}

	InvalidRun.Exports.Unload();
	const vecValidDispatch = [
		{ Arguments: ["transition", "load", "map", "confirm"], Methods: ["LoadGameState"] },
		{ Arguments: ["transition", "adjacent", "old", "landmark", "confirm"], Methods: ["LoadAdjacentEntities"] },
		{ Arguments: ["moved", "1", "trigger", "confirm"], Methods: ["NotifyTriggerMoved", "NotifyEdictFlagsChange", "GetEntityChangeAccessor", "GetSharedEdictChangeInformation"] },
		{ Arguments: ["raw", "scratch", "8192", "0", "confirm"], Methods: ["DrawSpatialPartitionMapToScratchPad"] },
		{ Arguments: ["raw", "temp", "CTest", "confirm"], Methods: ["PlayTemporaryEntity"] },
		{ Arguments: ["branch", "end", "confirm"], Methods: ["EndMultiplayerGame"] },
		{ Arguments: ["branch", "bot", "name", "confirm"], Methods: ["CreateFakeClientWithOptions"] },
		{ Arguments: ["branch", "timescale", "1", "confirm"], Methods: ["SetTimescale"] },
		{ Arguments: ["branch", "pause", "on", "confirm"], Methods: ["SetPaused"] },
		{ Arguments: ["branch", "hibernate", "off", "confirm"], Methods: ["SetServerHibernation"] },
		{ Arguments: ["branch", "flush", "1", "confirm"], Methods: ["ForceFlushEntity"] },
		{ Arguments: ["branch", "shared", "name"], Methods: ["GetSinglePlayerSharedMemorySpace"] },
		{ Arguments: ["branch", "session", "confirm"], Methods: ["ValidateHostSession", "RefreshScreenIfNecessary"] },
		{ Arguments: ["branch", "paint", "1", "confirm"], Methods: ["PaintAllSurfaces"] },
		{ Arguments: ["branch", "removePaint", "confirm"], Methods: ["RemoveAllPaint"] },
	];
	for (const Fixture of vecValidDispatch) {
		const Run = CreateRun();
		for (const strMethod of Fixture.Methods) {
			Run.Overrides.set(`engines/server.${strMethod}`, () => true);
		}

		Run.Invoke(Fixture.Arguments);
		g_Assert.deepEqual(Run.State.SDKCalls, Fixture.Methods.map((strMethod) => `engines/server.${strMethod}`));
		g_Assert.equal(Run.State.Warnings.length, 0);
		Run.Exports.Unload();
	}

	let unPartitionScenarios = 0;
	for (const Logging of [{ Failed: false }, ...[undefined, null, false, 0, "opaque partition log error", Object.freeze(new Error("opaque partition log error"))].map((Failure) => ({ Failed: true, Failure }))]) {
		for (const strDestroyMode of ["", "FALSE", "THROW"]) {
			const Profile = { ThrowLog: false, Error: Logging.Failure };
			const Run = CreateRun(Profile);
			const DestructionError = Object.freeze(new Error("Unknown spatial partition destruction outcome."));
			let unDestroyCalls = 0;
			Run.Overrides.set("engines/server.CreateSpatialPartition", (Minimums, Maximums) => {
				g_Assert.deepEqual([Minimums.X, Minimums.Y, Minimums.Z, Maximums.X, Maximums.Y, Maximums.Z], [0, 0, 0, 1, 1, 1]);

				return { Address: 0x1000n };
			});
			Run.Overrides.set("engines/server.DestroySpatialPartition", (unAddress) => {
				g_Assert.equal(unAddress, 0x1000n);
				g_Assert.equal(Run.State.Logs.length, 1, "the only prior log must be startup, not a live partition address");
				unDestroyCalls += 1;

				if (strDestroyMode === "THROW") {
					throw DestructionError;
				}

				return strDestroyMode !== "FALSE";
			});
			Profile.ThrowLog = Logging.Failed;
			let bCaught = false;
			let Failure = undefined;
			try {
				Run.Invoke(["partition", "0", "0", "0", "1", "1", "1", "confirm"]);
			} catch (CaughtError) {
				bCaught = true;
				Failure = CaughtError;
			}

			g_Assert.equal(unDestroyCalls, 1, "native destruction must not be retried after logging or destruction failure");
			g_Assert.equal(bCaught, Logging.Failed || Boolean(strDestroyMode));

			if (strDestroyMode === "THROW") {
				g_Assert.equal(Failure, DestructionError);

			} else if (strDestroyMode === "FALSE") {
				g_Assert.match(Failure.message, /Unable to destroy/);

			} else if (Logging.Failed) {
				g_Assert.equal(Failure, Logging.Failure);
			}

			Run.Exports.Unload();
			unPartitionScenarios += 1;
		}
	}

	let unKeyValuesScenarios = 0;
	for (const OperationError of [undefined, null, false, 0, "opaque client command error", Object.freeze(new Error("opaque client command error"))]) {
		for (const bTransferred of [false, true]) {
			for (const bCleanupFails of [false, true]) {
				const Run = CreateRun();
				const CleanupError = Object.freeze(new Error("opaque KeyValues release error"));
				let bOwnsTree = true;
				let unReleaseCalls = 0;
				let unTreeDestructions = 0;
				Run.Overrides.set("players/entity.Player", class {
					constructor(unIndex) {
						g_Assert.equal(unIndex, 1);
					}

					IsConnected() {
						return true;
					}
				});
				Run.Overrides.set("keyvalues.KeyValues", class {
					constructor(strName, Values) {
						g_Assert.equal(strName, "SourceJSExample");
						g_Assert.equal(Values.Message, "message");
						this.Handle = Object.freeze({ NativeHandle: true });
					}

					DestroyKeyValues() {
						unReleaseCalls += 1;

						if (bCleanupFails) {
							throw CleanupError;
						}

						this.Handle = null;

						if (!bOwnsTree) {
							return false;
						}

						bOwnsTree = false;
						unTreeDestructions += 1;

						return true;
					}
				});
				Run.Overrides.set("engines/server.ExecuteClientCommandKeyValues", (unIndex, Values) => {
					g_Assert.equal(unIndex, 1);
					g_Assert.notEqual(Values.Handle, null);

					if (bTransferred) {
						bOwnsTree = false;
					}

					throw OperationError;
				});
				let bCaught = false;
				let Failure = undefined;
				try {
					Run.Invoke(["player", "1", "keyValues", "message", "confirm"]);
				} catch (CaughtError) {
					bCaught = true;
					Failure = CaughtError;
				}

				g_Assert.equal(bCaught, true);
				const vecFailures = FlattenErrors(Failure);
				g_Assert.equal(vecFailures[0], OperationError);
				g_Assert.equal(vecFailures.length, bCleanupFails ? 2 : 1);

				if (bCleanupFails) {
					g_Assert.equal(vecFailures[1], CleanupError);
				}

				g_Assert.equal(unReleaseCalls, 1);
				g_Assert.equal(unTreeDestructions, (bTransferred || bCleanupFails) ? 0 : 1, "engine-owned trees must never be destroyed by the caller");
				Run.Exports.Unload();
				unKeyValuesScenarios += 1;
			}
		}
	}

	console.log(`[world command lifecycle] ${unLifecycleScenarios} lifecycle, ${vecValidDispatch.length} valid/${vecMalformed.length} malformed-dispatch, ${unPartitionScenarios} partition and ${unKeyValuesScenarios} KeyValues transfer/release scenarios; actual complete example with controlled SDK doubles, not live engine proof`);
}

function VerifyWorldServerActions(ServerAPI) {
	VerifyWorldCommandLifecycle();

	const unScriptTimeoutMilliseconds = 1_000;

	const strExamplePath = g_Path.join(g_strRepositoryRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8").replace(/\r\n/g, "\n");
	const vecFunctionNames = ["UseCleanup", "IsInt32", "ParseIndex", "ParseVectorArgument", "RunPVSAction", "RunMovedAction", "RunDebugAction", "RunRawAction", "RunBranchAction"];
	const vecFunctions = vecFunctionNames.map((strName) => {
		const nFunctionStart = strExample.indexOf(`\nfunction ${strName}(`);
		const nFunctionEnd = strExample.indexOf("\nfunction ", nFunctionStart + 1);
		g_Assert.ok((nFunctionStart >= 0) && (nFunctionEnd > nFunctionStart), `world function ${strName} must remain available`);

		return strExample.slice(nFunctionStart, nFunctionEnd);
	});
	const mapResults = new Map();
	const Context = g_VM.createContext({
		...ServerAPI,
		Vector,
		g_strCommandName: "sjs_api_world",
		LogResult: (strLabel, Callback) => {
			const Result = Callback();
			mapResults.set(strLabel, Result);

			return Result;
		},
		LogWarning: (strMessage) => g_Assert.fail(strMessage),
	});
	g_VM.runInContext(vecFunctions.join("\n"), Context, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

	const vecServerMatch = strExample.match(/\tLogResult\("engines\/server.GetServer",[\s\S]*?\n\t}\);/);
	const vecMaximumClientsMatch = strExample.match(/^\tLogResult\("engines\/server Server.GetMaximumClients".*$/m);
	g_Assert.ok(vecServerMatch && vecMaximumClientsMatch, "world example must retain its IServer inspection callbacks");
	g_VM.runInContext(`${vecServerMatch[0]}\n${vecMaximumClientsMatch[0]}`, Context, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });

	const Server = ServerAPI.GetServer();
	const ServerResult = mapResults.get("engines/server.GetServer");
	g_Assert.equal(ServerResult.Active, Server.IsServerActive());
	g_Assert.equal(ServerResult.ClientCount, Server.GetConnectedClientCount());
	g_Assert.equal(ServerResult.MaximumClients, Server.GetMaximumClients());
	g_Assert.equal(ServerResult.Tick, Server.GetServerTick());
	g_Assert.equal(ServerResult.Address, Server.Address);
	g_Assert.equal(mapResults.get("engines/server Server.GetMaximumClients"), Server.GetMaximumClients());

	const vecPrecacheMatch = strExample.match(/\tLogResult\("engines\/precache.Model",[\s\S]*?\n\t}\);/);
	g_Assert.ok(vecPrecacheMatch, "world example must retain its managed precache callback");

	const InactiveServer = { ...Server, IsServerActive: () => false };
	g_VM.runInNewContext(vecPrecacheMatch[0], {
		GetServer: () => InactiveServer,
		LogResult: (strLabel, Callback) => mapResults.set(strLabel, Callback()),
	}, { filename: strExamplePath, timeout: unScriptTimeoutMilliseconds });
	g_Assert.equal(mapResults.get("engines/precache.Model").Active, false);
	g_Assert.equal(mapResults.get("engines/precache.Model").MapName, Server.GetMapName());

	for (const strInvocation of [
		'RunPVSAction(["pvs", "net", "1"]);',
		'RunPVSAction(["pvs", "entity", "77", "confirm"]);',
		'RunMovedAction(["moved", "77", "solid", "confirm"]);',
		'RunDebugAction(["debug", "nprint", "world"]);',
		'RunDebugAction(["debug", "nxprint", "world"]);',
		'RunRawAction(["raw", "temp", "CTest", "confirm"]);',
		'RunBranchAction(["branch", "inspect", "1"]);',
	]) {
		g_VM.runInContext(strInvocation, Context, { timeout: unScriptTimeoutMilliseconds });
	}

	g_Assert.equal(mapResults.get("engines/server.GetPlayerInformation").UserID, 7);
	g_Assert.equal(mapResults.get("engines/server.GetEntityChangeAccessor").ChangeInformation, 3);

	for (const strOperation of ["CleanUpEntityClusterList", "PrintDeveloperOverlayLine", "PrintDeveloperOverlayLineExtended", "PlayTemporaryEntity", "IsEngineLogEnabled", "IsApplicationActive"]) {
		g_Assert.equal(mapResults.get(`engines/server.${strOperation}`), true, `world example must call ${strOperation}`);
	}

	const OriginalBuildEntityClusterList = Context.BuildEntityClusterList;
	const OriginalCleanupEntityClusterList = Context.CleanUpEntityClusterList;

	try {
		for (const MissingInformation of [null, undefined]) {
			let unCleanupCallCount = 0;
			Context.BuildEntityClusterList = () => MissingInformation;
			Context.CleanUpEntityClusterList = () => {
				unCleanupCallCount++;
			};

			g_VM.runInContext('RunPVSAction(["pvs", "entity", "77", "confirm"]);', Context, { timeout: unScriptTimeoutMilliseconds });
			g_Assert.equal(unCleanupCallCount, 0, "a missing PVS result must not dispatch cleanup");
		}
	} finally {
		Context.BuildEntityClusterList = OriginalBuildEntityClusterList;
		Context.CleanUpEntityClusterList = OriginalCleanupEntityClusterList;
	}

	const OriginalLogWarning = Context.LogWarning;
	const OriginalLogResult = Context.LogResult;
	const vecValidPVSCommands = [
		["pvs"],
		["pvs", "inspect"],
		["pvs", "inspect", "1", "2", "3"],
		["pvs", "inspect", "1", "2", "3", "17"],
		["pvs", "inspect", "1", "2", "3", "17", "3"],
		["pvs", "net", "1"],
		["pvs", "entity", "77", "confirm"],
		["pvs", "message"],
		["pvs", "message", "Game_connected"],
		["pvs", "accumulate", "1", "2", "3", "confirm"],
		["pvs", "portal", "17", "open", "confirm"],
		["pvs", "portals", "17,18", "open,closed", "confirm"],
	];
	const vecMalformedCommands = [
		[],
		["pvs", "unknown"],
		["pvs", ""],
		["pvs", "inspect", "1"],
		["pvs", "inspect", "1", "2"],
		["pvs", "inspect", "", "2", "3"],
		["pvs", "inspect", "1", "2", "3", "invalid"],
		["pvs", "inspect", "1", "2", "3", "1", "invalid"],
		["pvs", "inspect", "1", "2", "3", "2147483648"],
		["pvs", "inspect", "1", "2", "3", "1", "-2147483649"],
		["pvs", "inspect", "1", "2", "3", "", "1"],
		["pvs", "inspect", "1", "2", "3", "1", "2", "extra"],
		["pvs", "net"],
		["pvs", "net", "1", "extra"],
		["pvs", "net", "0"],
		["pvs", "net", "2147483648"],
		["pvs", "net", ""],
		["pvs", "entity", "1"],
		["pvs", "entity", "1", "confirm", "extra"],
		["pvs", "entity", "-1", "confirm"],
		["pvs", "entity", "2147483648", "confirm"],
		["pvs", "entity", "", "confirm"],
		["pvs", "message", "Game_connected", "extra"],
		["pvs", "accumulate", "1", "2", "3"],
		["pvs", "accumulate", "1", "2", "3", "extra", "confirm"],
		["pvs", "accumulate", "1", "2", "invalid", "confirm"],
		["pvs", "accumulate", "1", "2", "", "confirm"],
		["pvs", "portal", "1", "open"],
		["pvs", "portal", "1", "open", "confirm", "extra"],
		["pvs", "portal", "1.5", "open", "confirm"],
		["pvs", "portal", "2147483648", "open", "confirm"],
		["pvs", "portal", "", "open", "confirm"],
		["pvs", "portals", "", "open", "confirm"],
		["pvs", "portals", "1,", "open,closed", "confirm"],
		["pvs", "portals", "1,2", "open", "confirm"],
		["pvs", "portals", "1", "invalid", "confirm"],
		["pvs", "portals", "1", "open", "confirm", "extra"],
		["pvs", "portals", "2147483648", "open", "confirm"],
	];
	const mapNativeMethods = new Map(Object.keys(ServerAPI).filter((strName) => typeof Context[strName] === "function").map((strName) => [strName, Context[strName]]));
	try {
		for (const vecArguments of vecValidPVSCommands) {
			let unResults = 0;
			Context.LogResult = (strLabel, Callback) => {
				unResults += 1;

				return OriginalLogResult(strLabel, Callback);
			};
			g_VM.runInContext(`RunPVSAction(${JSON.stringify(vecArguments)});`, Context, { timeout: unScriptTimeoutMilliseconds });
			g_Assert.ok(unResults > 0, `valid PVS command must execute a result callback: ${JSON.stringify(vecArguments)}`);
		}

		for (const [strName] of mapNativeMethods) {
			Context[strName] = () => g_Assert.fail(`Malformed PVS command called native API ${strName}`);
		}

		for (const vecArguments of vecMalformedCommands) {
			let unWarnings = 0;
			let unResults = 0;
			const unNativeCallsBefore = g_vecSDKCalls.length;
			Context.LogWarning = () => unWarnings++;
			Context.LogResult = () => unResults++;
			g_VM.runInContext(`RunPVSAction(${JSON.stringify(vecArguments)});`, Context, { timeout: unScriptTimeoutMilliseconds });
			g_Assert.equal(unWarnings, 1, JSON.stringify(vecArguments));
			g_Assert.equal(unResults, 0);
			g_Assert.equal(g_vecSDKCalls.length, unNativeCallsBefore, "malformed PVS commands must not call the SDK");
		}

		for (const [strName, Callback] of mapNativeMethods) {
			Context[strName] = Callback;
		}

		const vecLoggingProfiles = [{ Failed: false }, ...[undefined, null, false, 0, "opaque log error", Object.freeze(new Error("opaque log error"))].map((Failure) => ({ Failed: true, Failure }))];
		let unLeaseScenarios = 0;
		for (const Logging of vecLoggingProfiles) {
			for (const strCleanupMode of ["", "FALSE", "THROW"]) {
				const ReleaseError = Object.freeze(new Error("Unknown PVS cleanup outcome."));
				const Information = Object.freeze({ Address: 0x1000n, Clusters: [1, 2] });
				let bStorageLive = true;
				let unReleases = 0;
				const vecLogs = [];
				Context.BuildEntityClusterList = () => Information;
				Context.CleanUpEntityClusterList = (unAddress) => {
					g_Assert.equal(unAddress, Information.Address);
					g_Assert.equal(bStorageLive, true, "PVS cleanup must precede reentrant logging");
					bStorageLive = false;
					unReleases += 1;

					if (strCleanupMode === "THROW") {
						throw ReleaseError;
					}

					return strCleanupMode !== "FALSE";
				};
				Context.LogResult = (strLabel, Callback) => {
					g_Assert.equal(bStorageLive, false);
					const Value = Callback();
					vecLogs.push({ Label: strLabel, Value });

					if (Logging.Failed) {
						throw Logging.Failure;
					}

					return Value;
				};
				let bCaught = false;
				let Failure = undefined;
				try {
					g_VM.runInContext('RunPVSAction(["pvs", "entity", "77", "confirm"]);', Context, { timeout: unScriptTimeoutMilliseconds });
				} catch (CaughtError) {
					bCaught = true;
					Failure = CaughtError;
				}

				g_Assert.equal(unReleases, 1);
				g_Assert.equal(bCaught, (strCleanupMode === "THROW") || Logging.Failed);

				if (bCaught) {
					g_Assert.equal(Failure, (strCleanupMode === "THROW") ? ReleaseError : Logging.Failure);

				} else {
					g_Assert.equal(vecLogs[0].Value, Information);
					g_Assert.equal(vecLogs[1].Value, strCleanupMode !== "FALSE");
				}

				unLeaseScenarios += 1;
			}
		}

		console.log(`[world PVS commands] ${vecValidPVSCommands.length} valid, ${vecMalformedCommands.length} malformed-input and ${unLeaseScenarios} cleanup-before-log scenarios; controlled SDK doubles, not live engine proof`);
	} finally {
		Context.LogWarning = OriginalLogWarning;
		Context.LogResult = OriginalLogResult;
		Context.BuildEntityClusterList = OriginalBuildEntityClusterList;
		Context.CleanUpEntityClusterList = OriginalCleanupEntityClusterList;
		for (const [strName, Callback] of mapNativeMethods) {
			Context[strName] = Callback;
		}
	}
}

const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "engines-server.md");
const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_nEntityReferenceStart = g_strDocumentationSource.indexOf("## Entities, transmission, and spatial partitions");
const g_nEntityReferenceEnd = g_strDocumentationSource.indexOf("## Resources, sound, and presentation", g_nEntityReferenceStart);
g_Assert.ok((g_nEntityReferenceStart >= 0) && (g_nEntityReferenceEnd > g_nEntityReferenceStart), "entity reference section must remain available");

const g_strEntityReference = g_strDocumentationSource.slice(g_nEntityReferenceStart, g_nEntityReferenceEnd);
for (const vecMatch of g_strEntityReference.matchAll(/^\| `([A-Za-z][A-Za-z0-9_]*)\(/gm)) {
	g_Assert.equal(typeof g_ServerAPI[vecMatch[1]], "function", `entity reference names an absent export: ${vecMatch[1]}`);
}

const g_vecDocumentationBlocks = [...g_strDocumentationSource.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
const g_unDocumentationPVSByteCount = 8;

const g_DocumentationServer = {
	GetGlobalVariables() {
		const NativeGlobalVariables = g_ServerAPI.GetGlobalVariables();

		return {
			CurrentTime: NativeGlobalVariables.CurrentTime,
			TickCount: NativeGlobalVariables.TickCount,
			MapName: NativeGlobalVariables.MapName,
		};
	},
	GetServer() {
		return g_NativeServer;
	},
};

const g_DocumentationServerAPI = new Proxy(g_DocumentationServer, {
	get(Target, PropertyKey) {
		if (Object.hasOwn(Target, PropertyKey)) {
			return Target[PropertyKey];
		}

		if (!Object.hasOwn(g_ServerAPI, PropertyKey)) {
			throw new Error(`documentation requested an unknown server export: ${String(PropertyKey)}`);
		}

		return (...vecArguments) => {
			if (PropertyKey === "GetPVSForCluster") {
				return { Bytes: new Uint8Array(g_unDocumentationPVSByteCount), RequiredBytes: g_unDocumentationPVSByteCount };
			}

			if ((PropertyKey === "ResetPVS") || (PropertyKey === "AddOriginToPVS")) {
				return new Uint8Array(g_unDocumentationPVSByteCount);
			}

			if (PropertyKey === "GetAreaBits") {
				return new Uint8Array(g_unDocumentationPVSByteCount);
			}

			if (PropertyKey === "GetPreviousCheckTransmitInformation") {
				return { TransmitEdicts: [] };
			}

			if (PropertyKey === "GetEntityTransmitBitsForClient") {
				return { Indexes: [] };
			}

			if (PropertyKey === "CreateSpatialPartition") {
				return { Kind: "ISpatialPartition", Address: 0xA000n };
			}

			if (PropertyKey === "DestroySpatialPartition") {
				return true;
			}

			if ((PropertyKey === "GetClusterForOrigin") || (PropertyKey === "GetAreaForOrigin")) {
				return 1;
			}

			if (PropertyKey.startsWith("Is") || PropertyKey.startsWith("Check") || PropertyKey.startsWith("Are")) {
				return true;
			}

			return g_ServerAPI[PropertyKey](...vecArguments);
		};
	},
});

const g_vecDocumentationLogMessages = [];
const g_DocumentationModules = {
	"engines/server": g_DocumentationServerAPI,
	loggers: {
		LogInfo(strFormat, Value) {
			g_Assert.equal(strFormat, "%j", "documentation must serialize structured records through the logger");
			g_Assert.ok(Value && (typeof Value === "object") && !Array.isArray(Value), "documentation log record must be an object");
			g_vecDocumentationLogMessages.push(JSON.stringify(Value));

			return true;
		},
	},
	mathlib: { Vector },
	netchannel: {
		NET_FLOW: Object.freeze({ Outgoing: 0, Incoming: 1, InOut: 2 }),
		NetChannel: {
			CreateNetChannelFromAddress(unAddress) {
				g_Assert.equal(unAddress, 0x3000n, "documentation netchannel address");

				return {
					GetNetChannelLatency(nFlow) {
						g_Assert.ok(Number.isSafeInteger(nFlow) && (nFlow === g_DocumentationModules.netchannel.NET_FLOW.Incoming), "documentation must request the native incoming flow");

						return 0.02;
					},
				};
			},
		},
	},
	"players/entity": {
		Player(nIndex) {
			const PlayerObject = {
				Index: nIndex,
				Maximums: new Vector(16, 16, 72),
				Minimums: new Vector(-16, -16, 0),
				Origin: (nIndex === 1) ? new Vector(1, 2, 3) : new Vector(4, 5, 6),
			};
			PlayerObject.GetEntityPropertyVector = (strPropertyName) => {
				const PropertyVectors = {
					m_vecOrigin: PlayerObject.Origin,
					m_vecMins: PlayerObject.Minimums,
					m_vecMaxs: PlayerObject.Maximums,
				};

				return PropertyVectors[strPropertyName];
			};

			return PlayerObject;
		},
	},
};

g_Assert.throws(() => g_DocumentationServerAPI.MissingServerExport, { name: "Error" }, "documentation must not silently accept invented server exports");

function RunDocumentationBlock(strDocumentationBlock, unBlockIndex, ServerAPI = g_DocumentationServerAPI) {
	const DocumentationModules = { ...g_DocumentationModules, "engines/server": ServerAPI };

	return g_VM.runInNewContext(strDocumentationBlock, {
		console: {
			log() {
			},
		},
		Uint8Array,
		require(strModuleName) {
			if (!Object.hasOwn(DocumentationModules, strModuleName)) {
				throw new Error(`documentation block ${unBlockIndex + 1} requested unknown module: ${strModuleName}`);
			}

			return DocumentationModules[strModuleName];
		},
	}, { filename: `${g_strDocumentationPath}#${unBlockIndex + 1}` });
}

function CreateDocumentationServerOverride(Overrides) {
	return new Proxy(g_DocumentationServerAPI, {
		get(Target, PropertyKey) {
			return Object.hasOwn(Overrides, PropertyKey) ? Overrides[PropertyKey] : Target[PropertyKey];
		},
	});
}

for (const [unBlockIndex, strDocumentationBlock] of g_vecDocumentationBlocks.entries()) {
	RunDocumentationBlock(strDocumentationBlock, unBlockIndex);
}

g_Assert.equal(g_vecDocumentationBlocks.length, 9, "engines/server documentation example count");
g_Assert.equal(g_vecDocumentationLogMessages.length, 6, "all six diagnostic examples must use the public logger");

const g_nRealtimeBlockIndex = g_vecDocumentationBlocks.findIndex((strBlock) => strBlock.includes(".GetNetChannelLatency("));
g_Assert.ok(g_nRealtimeBlockIndex >= 0, "realtime server example must remain available");
g_Assert.ok(g_vecDocumentationBlocks[g_nRealtimeBlockIndex].includes("NET_FLOW.Incoming"), "realtime example must name the public incoming flow");

for (const strInvalidFlowReference of ["NET_FLOW.INCOMING", "NET_FLOW.Outgoing"]) {
	const strInvalidExample = g_vecDocumentationBlocks[g_nRealtimeBlockIndex].replace("NET_FLOW.Incoming", strInvalidFlowReference);
	g_Assert.throws(() => RunDocumentationBlock(strInvalidExample, g_nRealtimeBlockIndex), /documentation must request the native incoming flow/);
}

const g_nVisibilityBlockIndex = g_vecDocumentationBlocks.findIndex((strBlock) => strBlock.includes("function AddVectors("));
g_Assert.ok(g_nVisibilityBlockIndex >= 0, "visibility documentation example must exist");

let g_unInvalidAreaBitCallCount = 0;

for (const dblInvalidAreaNumber of [-1, 0.5, Number.NaN]) {
	const ServerOverride = CreateDocumentationServerOverride({
		GetAreaForOrigin() {
			return dblInvalidAreaNumber;
		},
		GetAreaBits() {
			++g_unInvalidAreaBitCallCount;

			return new Uint8Array(g_unDocumentationPVSByteCount);
		},
	});
	g_Assert.throws(() => RunDocumentationBlock(g_vecDocumentationBlocks[g_nVisibilityBlockIndex], g_nVisibilityBlockIndex, ServerOverride), { message: "The second player origin does not resolve to a valid area." });
}

g_Assert.equal(g_unInvalidAreaBitCallCount, 0, "invalid area numbers must not reach GetAreaBits()");

const g_nSoundBlockIndex = g_vecDocumentationBlocks.findIndex((strBlock) => strBlock.includes("function PlayTemporarySound("));
g_Assert.ok(g_nSoundBlockIndex >= 0, "sound documentation example must exist");

const g_SoundStopFailure = CreateDocumentationServerOverride({
	StopSound() {
		return false;
	},
});
g_Assert.throws(() => RunDocumentationBlock(g_vecDocumentationBlocks[g_nSoundBlockIndex], g_nSoundBlockIndex, g_SoundStopFailure), (ErrorValue) => (ErrorValue.name === "AggregateError") && (ErrorValue.errors.length === 1) && (ErrorValue.errors[0].message === "Sound stop call did not report success: ui/buttonclick.wav."), "the sound example must report cleanup failure");

const g_nMaintenanceBlockIndex = g_vecDocumentationBlocks.findIndex((strBlock) => strBlock.includes("function RunConfirmedServerMaintenance("));
g_Assert.ok(g_nMaintenanceBlockIndex >= 0, "maintenance documentation example must exist");

const g_ChangeLevelFailure = CreateDocumentationServerOverride({
	ChangeLevel() {
		return false;
	},
	IsMapValid() {
		return true;
	},
});
g_Assert.throws(() => RunDocumentationBlock(`${g_vecDocumentationBlocks[g_nMaintenanceBlockIndex]}\nRunConfirmedServerMaintenance("ChangeLevel", "cp_test");`, g_nMaintenanceBlockIndex, g_ChangeLevelFailure), { message: "ChangeLevel() did not report success." });

VerifyWorldServerActions(g_ServerAPI);

const g_MissingNativeModuleError = new Error("native engines/server module is unavailable");

delete require.cache[g_strServerPath];
InstallDependency(g_strRuntimePath, {
	GetModule() {
		throw g_MissingNativeModuleError;
	},
});
g_Assert.throws(() => require(g_strServerPath), (ErrorValue) => ErrorValue === g_MissingNativeModuleError, "engines/server must propagate the exact missing native module error");

console.log(`[smoke] engines/server fixture contracts, ${g_vecDocumentationBlocks.length} documentation examples, and 7 documentation failure cases passed (game SDK execution not exercised)`);
