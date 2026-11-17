"use strict";

const {
	BLACK,
	BLUE,
	COLOR_SIZE,
	ORANGE,
	PURPLE,
	YELLOW,
	Color,
	CreateRGBAColor,
} = require("colors");
const { EntityCount, GameDirectory, IsDedicatedServer } = require("engines");
const {
	GetProxyName,
	GetSendTableName,
	IsAvailable,
	ListProperties,
} = require("engines/gamerules");
const { ModelPrecacheResource, PrecacheResourceError } = require("engines/precache");
const {
	AddOriginToPVS,
	BuildEntityClusterList,
	AreAreasConnected,
	CheckBoxInPVS,
	IsHeadNodeVisible,
	CheckOriginInPVS,
	ExecuteClientCommand,
	ExecuteClientCommandKeyValues,
	PrintToClientConsole,
	CleanUpEntityClusterList,
	PrintDeveloperOverlayLine,
	PrintDeveloperOverlayLineExtended,
	GetServerConstants,
	CreateFakeClientWithOptions,
	CreateSpatialPartition,
	DestroySpatialPartition,
	DrawSpatialPartitionMapToScratchPad,
	EmitAmbientSound,
	ForceFlushEntity,
	GetGameDescription,
	GetGameServerSteamID,
	GetAchievementManager,
	GetAreaForOrigin,
	GetAreaBits,
	GetAreaPortalPlane,
	GetAttachedSplitScreenUserCount,
	GetEntityChangeAccessor,
	GetClientCrossPlayPlatform,
	GetClientSteamID,
	GetClientXUID,
	GetClusterForOrigin,
	GetEntityTransmitBitsForClient,
	GetUserLoadingProgress,
	GetPaintMapDataRLE,
	GetPlayerInformation,
	GetPlayerNetworkChannelInformation,
	GetPreviousCheckTransmitInformation,
	GetPVSForCluster,
	GetServer,
	GetSharedEdictChangeInformation,
	GetSinglePlayerSharedMemorySpace,
	GetSplitScreenPlayerAttachment,
	GetTextMessage,
	GetTimescale,
	HasPaintMap,
	ValidateHostSession,
	IsApplicationActive,
	IsAnyClientLowViolence,
	IsCreatingResourceList,
	IsCreatingXboxResourceList,
	IsDedicatedServerForPS3,
	IsDedicatedServerForXbox,
	IsLevelMainMenuBackground,
	IsEngineLogEnabled,
	IsOverrideLoadGameEntitiesEnabled,
	IsSplitScreenPlayer,
	IsUserIDInUse,
	GetChoreographySoundLatency,
	GetLaunchOptions,
	LoadAdjacentEntities,
	LoadGameState,
	GetMulticastRecipients,
	EndMultiplayerGame,
	NotifyEdictFlagsChange,
	PaintAllSurfaces,
	SetPaused,
	PlayTemporaryEntity,
	RefreshScreenIfNecessary,
	RemoveAllPaint,
	ResetPVS,
	SetAreaPortalState,
	SetAreaPortalStates,
	SetServerHibernation,
	SetTimescale,
	GetServerVersion,
	NotifySolidMoved,
	NotifyTriggerMoved,
} = require("engines/server");
const {
	Attenuation,
	Channel,
	Pitch,
	SOUND_FROM_WORLD,
	Sound,
	SoundFlags,
	VOL_NORM,
	GetDistanceGainFromSoundLevel,
} = require("engines/sound");
const {
	ContentMasks,
	TraceType,
	GetPointContents,
	IsPointOutsideWorld,
} = require("engines/trace");
const { GetEntitiesByClassName, GetEntityCount, GetMaximumEntityCount } = require("entities");
const { Entity } = require("entities/entity");
const { IsEntityValid } = require("entities/helpers");
const { SERVER_CLASSES, ServerClassGenerator } = require("entities/classes");
const { CollisionGroup, CollisionRules, SolidFlags, SolidType } = require("entities/collisions");
const { DamageTypes, MoveType, RenderMode, TakeDamage } = require("entities/constants");
const { GetEntityDataMap, GetEntityDataMapFields } = require("entities/datamaps");
const { ENTITY_DICTIONARY } = require("entities/dictionary");
const { FindEntityByHammerID, GetEntityKeyValue } = require("entities/factories");
const {
	GetEntityFireOutputHookOptions,
	GetEntityFireOutputIdentifier,
	GetEntityFireOutputAddress,
} = require("entities/outputs");
const {
	GetEntityProperty,
	GetSendTable,
	GetServerClassProperties,
	GetEntityServerClass,
} = require("entities/props");
const {
	ALWAYS,
	DONT_SEND,
	FULL_CHECK,
	PVS_CHECK,
	GetTransmitStateFlags,
} = require("entities/transmit");
const {
	GetAllEntities: g_GetAllEntities,
	GetAllPlayers: g_GetAllPlayers,
	GetAllRecipients: g_GetAllRecipients,
	GetAllWeapons: g_GetAllWeapons,
} = require("filters");
const { KeyValues } = require("keyvalues");
const {
	BaseEntityIterator,
	EntityIterator,
	EntityTraceFilter,
	GetAllEntities,
	GetValidEntities,
} = require("filters/entities");
const { FromItems, IteratorFilter, IteratorObject } = require("filters/iterator");
const { GetAllPlayers, PlayerIterator, ParsePlayerFilterExpression } = require("filters/players");
const {
	BaseRecipientFilter,
	RecipientFilter,
	ContainsRecipient,
	CreateRecipientFilterFromPlayer,
	CreateRecipientFilterFromValues,
	GetAllRecipients,
	GetAliveRecipients,
	GetBotRecipients,
	GetDeadRecipients,
	GetHumanRecipients,
	GetRecipientsByTeam,
	ResolveRecipientPlayers,
} = require("filters/recipients");
const {
	GetAllWeapons: g_GetAllFilterWeapons,
	GetCurrentWeapon: g_GetFilterCurrentWeapon,
	GetWeapon,
	GetWeaponCount,
	GetWeaponsByClassName: g_GetFilterWeaponsByClassName,
	GetWeaponsByName: g_GetFilterWeaponsByName,
	WeaponClassIterator,
	WeaponIterator,
} = require("filters/weapons");
const { RegisterPluginUnloadingListener } = require("listeners");
const { LogInfo, LogWarning } = require("loggers");
const {
	Matrix3x4,
	Plane,
	QAngle,
	Vector,
	VMatrix,
	GetVectorLength,
} = require("mathlib");
const {
	Address,
	Allocate,
	AllocateObject,
	CopyObjectToAddress,
	CopyAddressToObject,
	Deallocate,
	GetObjectAddress,
	MakeObject,
	ObjectTypeSize,
} = require("memory");
const { Type } = require("memory/helpers");
const { CustomType, Manager } = require("memory/manager");
const {
	NetChannel,
	NET_FLOW,
	GetPlayerNetChannel,
	GetPlayerNetChannelInfo,
} = require("netchannel");
const {
	PhysicsInterface,
	PhysicsEnvironment,
	PhysicsObject,
	GetActivePhysicsEnvironmentByIndex,
	GetServerGravityConVarValue,
} = require("physics");
const { GetClientCount } = require("players");
const { Player } = require("players/entity");
const {
	GetIndexFromNetworkID,
	GetIndexFromPlayerInformation,
	GetName,
	GetNetworkIDFromIndex,
	GetPlayerInformationFromUserID,
	GetAddressFromUserID,
	GetUserIDFromIndex,
	GetUserIDFromAddress,
} = require("players/helpers");
const { GetClientCVarValue, GetClientLanguage } = require("players/language");
const {
	SDKBranch,
	DataProfile,
	GetPlayersByTeam,
	GetTeamSupportedBranches,
	GetTeamClassesByName,
	GetTeamClassesByNumber,
	GetTeamData,
	GetTeamManagers,
	GetTeamName,
	GetTeamNames,
	GetTeamNumbers,
	GetTeamNumber,
	GetTeamProfile,
} = require("players/teams");
// Keep namespace access for the live VoiceServer getter.
const g_PlayerVoiceAPI = require("players/voice");
const {
	GetClientListening,
	MUTE_MANAGER,
	GetSetClientListeningHookOptions,
} = g_PlayerVoiceAPI;
const { GetBotPlayers, GetHumanPlayers, GetPlayer: g_GetBotPlayer } = require("players/bots");
const {
	GetAll: g_GetAllDictionaryPlayers,
	Get: g_GetDictionaryPlayer,
	GetEntries,
	GetKeys,
	GetPlayer,
	GetValues,
	Has: g_HasDictionaryPlayer,
	PLAYER_DICTIONARY,
	PlayerDictionary,
} = require("players/dictionary");
const g_PlayerConstants = require("players/constants");
const { Branch } = require("players/engines");
const { RegisterCommand, UnregisterCommand } = require("source");
const {
	AccountType,
	GetNetworkID,
	GetXUID,
	STEAM_BRANCH,
	STEAM_ID_SIZE,
	SteamID,
	Universe,
} = require("steam");
const {
	AMMO_PROPERTY_PREFIX,
	CLIP_PROPERTY,
	DecorateWeapon,
	GetAllWeapons,
	GetAmmo,
	GetClasses,
	GetClassName,
	GetClip,
	GetCount,
	GetCurrentWeapon,
	GetNames,
	GetOwner,
	GetPrimaryAmmoType,
	GetProperty,
	GetPropertyEntity,
	GetPropertyInteger,
	GetSecondaryAmmo,
	GetSecondaryAmmoType,
	GetSecondaryClip,
	GetWeaponName,
	GetWeaponsByClassName,
	GetWeaponsByName,
	OWNER_PROPERTY,
	PRIMARY_AMMO_TYPE_PROPERTY,
	SECONDARY_AMMO_TYPE_PROPERTY,
	SECONDARY_CLIP_PROPERTY,
	Weapon,
} = require("weapons");
const { WEAPON_MANAGER } = require("weapons/manager");
const {
	CanUse,
	CanUseCurrent,
	WEAPON_RESTRICTION_HANDLER,
	WEAPON_RESTRICTION_MANAGER,
	WeaponRestrictionHandler,
	WeaponRestrictionManager,
} = require("weapons/restrictions");
const {
	GetAll: g_GetAllWeaponScripts,
	GetClasses: g_GetWeaponScriptClasses,
	GetNames: g_GetWeaponScriptNames,
	GetScriptPath,
	Has: g_HasWeaponScript,
	Load: g_LoadWeaponScript,
} = require("weapons/scripts");
const {
	FormatName,
	Get,
	GetAll,
	GetDataPath,
	GetNames: g_GetWeaponDataNames,
	GetProjectiles,
	GetProperties,
	GetSpecialNames,
	GetTags,
	Has,
	Load,
	SUPPORTED_BRANCHES,
} = require("weapons/data");
const g_WeaponConstants = require("weapons/constants");
const { WeaponClass } = require("weapons/instance");
const {
	GetProperty: g_GetEntityWeaponProperty,
	GetPropertyEntity: g_GetEntityWeaponPropertyEntity,
	GetPropertyInteger: g_GetEntityWeaponPropertyInteger,
	Weapon: g_EntityWeapon,
} = require("weapons/entity");

const g_strPluginName = "api-world-objects";
const g_strCommandName = "sjs_api_world";
let g_bUnloading = false;
let g_bCleanupInProgress = false;
let g_bCommandRegistered = false;
let g_PluginUnloadingRegistration = null;

function UseCleanup(strLabel, Use, Cleanup) {
	let bOperationFailed = false;
	let OperationError = undefined;
	try {
		return Use();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			Cleanup();
		} catch (CleanupError) {
			if (bOperationFailed) {
				throw new AggregateError([OperationError, CleanupError], `${strLabel} operation and cleanup failed.`);
			}

			throw CleanupError;
		}
	}
}

function GetCommandArguments(Command) {
	return Command.Arguments.slice(1);
}

function ConvertBigIntToString(...vecArguments) {
	const Value = vecArguments[1];

	return (typeof Value === "bigint") ? `${Value}n` : Value;
}

function SummarizeValue(Value) {
	if (Value === undefined) {
		return "undefined";
	}

	if (Value === null) {
		return "null";
	}

	if (typeof Value === "object") {
		try {
			return JSON.stringify(Value, ConvertBigIntToString);
		} catch {
			return "[unserializable value]";
		}
	}

	return String(Value);
}

function LogResult(strLabel, Callback) {
	const Value = Callback();
	LogInfo("%s", `${strLabel}: ${SummarizeValue(Value)}`);

	return Value;
}

function GetEntityIndexes(Values) {
	if (!Array.isArray(Values)) {
		return Values;
	}

	return Values.map((Value) => (Value && (Value.Index !== undefined)) ? Value.Index : Value);
}

function InspectWorld() {
	const VectorValue = new Vector(3, 4, 12);
	LogResult("mathlib.GetVectorLength", () => GetVectorLength(VectorValue));
	LogResult("mathlib.Vector.GetNormalizedMathStructure", () => new Vector(3, 4, 0).GetNormalizedMathStructure().ConvertMathStructureToArray());
	LogResult("mathlib.Vector.RandomizeMathStructure", () => {
		const RandomVector = new Vector();
		RandomVector.RandomizeMathStructure(-8, 8);

		return RandomVector.ConvertMathStructureToArray();
	});

	LogResult("mathlib.Vector.IsMathStructureZero", () => new Vector(0.001, 0, 0).IsMathStructureZero(0.01));
	LogResult("mathlib.Vector.GetNegativeMathStructure", () => new Vector(1, -2, 3).GetNegativeMathStructure().ConvertMathStructureToArray());
	LogResult("mathlib.Vector arithmetic", () => ({
		Add: new Vector(1, 2, 3).AddScalar(2).ConvertMathStructureToArray(),
		Subtract: new Vector(1, 2, 3).SubtractVector(new Vector(1, 1, 1)).ConvertMathStructureToArray(),
		Multiply: new Vector(1, 2, 3).MultiplyScalar(2).ConvertMathStructureToArray(),
		Divide: new Vector(2, 4, 6).DivideVector(new Vector(2, 2, 3)).ConvertMathStructureToArray(),
	}));

	LogResult("mathlib.Vector length comparisons", () => ({
		Greater: new Vector(3, 4, 0).IsVectorLengthGreaterThan(4),
		Less: new Vector(3, 4, 0).IsVectorLengthLessThan(6),
	}));

	LogResult("mathlib.Vector.Length setter", () => {
		const ResizedVector = new Vector(3, 4, 0);
		ResizedVector.Length = 10;

		return ResizedVector.ConvertMathStructureToArray();
	});

	LogResult("mathlib.QAngle.ConvertQAngleToVectors", () => {
		const Vectors = new QAngle(0, 90, 0).ConvertQAngleToVectors();

		return {
			Forward: Vectors.Forward.ConvertMathStructureToArray(),
			Right: Vectors.Right.ConvertMathStructureToArray(),
			Up: Vectors.Up.ConvertMathStructureToArray(),
		};
	});

	LogResult("mathlib.Matrix3x4.Position", () => new Matrix3x4(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(1, 2, 3)).Position.ConvertMathStructureToArray());
	LogResult("mathlib.Matrix3x4 copy constructor", () => new Matrix3x4(new Matrix3x4(1, 0, 0, 8, 0, 1, 0, 9, 0, 0, 1, 10)).Position.ConvertMathStructureToArray());

	if (typeof VMatrix.prototype.SetIdentityVMatrix === "function") {
		LogResult("mathlib.VMatrix.SetIdentityVMatrix", () => new VMatrix().SetIdentityVMatrix().ConvertMatrixToArray());
		LogResult("mathlib.VMatrix copy constructor", () => new VMatrix(new VMatrix().SetIdentityVMatrix()).ConvertMatrixToArray());
		LogResult("mathlib.VMatrix.ConvertVMatrixToMatrix3x4", () => new VMatrix().SetIdentityVMatrix().ConvertVMatrixToMatrix3x4().ConvertMatrixToArray());
	}

	LogResult("mathlib.Plane.CreateMathStructureFromValue", () => {
		const PlaneValue = Plane.CreateMathStructureFromValue({ Normal: [0, 0, 1], Distance: 32, Type: 1, SignBits: 0 });

		return {
			Distance: PlaneValue.Distance,
			Normal: PlaneValue.Normal.ConvertMathStructureToArray(),
			SignBits: PlaneValue.SignBits,
			Type: PlaneValue.Type,
		};
	});

	LogResult("mathlib.QAngle.CopyMathStructureFrom", () => new QAngle().CopyMathStructureFrom({ X: 15, Y: 30, Z: 45 }).ConvertMathStructureToArray());
	LogResult("memory.ObjectTypeSize QAngle", () => ObjectTypeSize(QAngle));

	// These logs contain snapshots; the reported allocation addresses are no longer live after each cleanup.
	LogResult("memory.MakeObject QAngle", () => {
		const unAddress = AllocateObject(QAngle);
		if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
			throw new Error("Unable to allocate the QAngle example object.");
		}

		return UseCleanup("QAngle allocation", () => {
			const Angle = MakeObject(QAngle, unAddress);
			Angle.X = 90;
			Angle.Y = 45;
			Angle.Z = 0;

			return { Type: Angle.constructor.name, Address: GetObjectAddress(Angle), Value: Angle.ConvertMathStructureToArray() };
		}, () => {
			// Attempt once: a native free exception does not prove that the allocation remains live.
			if (!Deallocate(unAddress)) {
				throw new Error("Unable to release the QAngle example object.");
			}
		});
	});

	LogResult("memory.CopyObjectToAddress/CopyAddressToObject QAngle", () => {
		const unSourceAddress = AllocateObject(QAngle);
		if ((typeof unSourceAddress !== "bigint") || (unSourceAddress <= 0n)) {
			throw new Error("Unable to allocate the source QAngle example object.");
		}

		return UseCleanup("source QAngle allocation", () => {
			const unTargetAddress = AllocateObject(QAngle);
			if ((typeof unTargetAddress !== "bigint") || (unTargetAddress <= 0n)) {
				throw new Error("Unable to allocate the target QAngle example object.");
			}

			return UseCleanup("target QAngle allocation", () => {
				const SourceAngle = MakeObject(QAngle, unSourceAddress);
				SourceAngle.X = 15;
				SourceAngle.Y = 30;
				SourceAngle.Z = 45;

				const unObjectAddress = GetObjectAddress(SourceAngle);

				CopyObjectToAddress(SourceAngle, unTargetAddress);

				const CopiedAngle = CopyAddressToObject(unTargetAddress, QAngle);
				const vecInitialCopy = CopiedAngle.ConvertMathStructureToArray();

				SourceAngle.CopyMathStructureFrom({ X: 60, Y: 75, Z: 90 });
				CopyAddressToObject(unObjectAddress, CopiedAngle);

				return {
					Address: unObjectAddress,
					InitialCopy: vecInitialCopy,
					CopiedIntoObject: CopiedAngle.ConvertMathStructureToArray(),
				};
			}, () => {
				if (!Deallocate(unTargetAddress)) {
					throw new Error("Unable to release the target QAngle example object.");
				}
			});
		}, () => {
			if (!Deallocate(unSourceAddress)) {
				throw new Error("Unable to release the source QAngle example object.");
			}
		});
	});

	LogResult("memory.Address typed read/write", () => {
		const unStorageByteCount = 8;
		const AddressValue = new Address(Allocate(unStorageByteCount), true);
		if (!AddressValue.HasMemoryAddress()) {
			throw new Error("Unable to allocate the typed Address example storage.");
		}

		return UseCleanup("typed Address allocation", () => {
			AddressValue.SetInt(2026, 0x00n);
			AddressValue.SetFloat(7.5, 0x04n);

			return { Address: AddressValue.GetMemoryAddress(), Integer: AddressValue.GetInt(), Float: AddressValue.GetFloat(0x04n) };
		}, () => {
			if (!AddressValue.Deallocate()) {
				throw new Error("Unable to release the typed Address example storage.");
			}
		});
	});

	LogResult("memory/manager.Manager.CreateType", () => {
		let ExampleType = Manager.GetClass("SourceJSExampleType");
		if (ExampleType === null) {
			ExampleType = Manager.CreateType("SourceJSExampleType", {
				Size: 4,
				Properties: {
					Value: Manager.InstanceAttribute(Type.Int, 0x00n),
				},
			});
		}

		const Instance = new ExampleType();

		return UseCleanup("SourceJSExampleType instance", () => {
			Instance.Value = 1337;

			const Wrapped = MakeObject(ExampleType, Instance.Address);
			const nInitialValue = Wrapped.Value;

			Wrapped.Value = 2026;

			return {
				InitialValue: nInitialValue,
				LiveValue: Instance.Value,
				Address: Wrapped.Address,
			};
		}, () => {
			if (!Instance.Deallocate()) {
				throw new Error("Unable to deallocate the SourceJSExampleType instance.");
			}
		});
	});

	LogResult("memory/manager.Manager.DefineType", () => {
		let ManualType = Manager.GetClass("SourceJSManualType");
		if (ManualType === null) {
			class SourceJSManualType extends CustomType {
			}

			ManualType = Manager.DefineType("SourceJSManualType", SourceJSManualType, {
				Size: 4,
				Properties: {
					Value: Manager.InstanceAttribute(Type.Int, 0x00n),
				},
			});
		}

		const Instance = new ManualType();

		return UseCleanup("SourceJSManualType instance", () => {
			Instance.Value = 2026;

			return {
				ClassName: ManualType.name,
				Address: Instance.Address,
				Size: ManualType.TypeSize,
				Value: Instance.Value,
			};
		}, () => {
			if (!Instance.Deallocate()) {
				throw new Error("Unable to deallocate the SourceJSManualType instance.");
			}
		});
	});

	LogResult("colors.CreateRGBAColor", () => CreateRGBAColor(0x40, 0xA0, 0xFF, 0xFF));
	LogResult("colors.Color.CreateColorWithAlpha", () => BLUE.CreateColorWithAlpha(0x60).ConvertColorToArray());
	LogResult("colors.Color.ConvertColorToHexString", () => ORANGE.ConvertColorToHexString());
	LogResult("memory.MakeObject Color", () => {
		const unAddress = Allocate(COLOR_SIZE);
		if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
			throw new Error("Unable to allocate the Color example object.");
		}

		return UseCleanup("Color allocation", () => {
			const ColorValue = MakeObject(Color, unAddress);
			const SharedView = MakeObject(Color, unAddress);

			ColorValue.CopyColorFrom(PURPLE.CreateColorWithAlpha(0xC0));
			SharedView.Green = 0x60;

			return { Address: ColorValue.GetColorAddress(), Value: ColorValue.ConvertColorToArray(), Hex: ColorValue.ConvertColorToHexString() };
		}, () => {
			if (!Deallocate(unAddress)) {
				throw new Error("Unable to release the Color example object.");
			}
		});
	});

	LogResult("colors constants", () => ({
		BLACK: BLACK.ConvertColorToArray(),
		ORANGE: ORANGE.ConvertColorToArray(),
		YELLOW: YELLOW.ConvertColorToArray(),
	}));

	LogResult("engines.GameDirectory", () => GameDirectory());
	LogResult("engines.IsDedicatedServer", () => IsDedicatedServer());
	LogResult("engines.EntityCount", () => EntityCount());
	LogResult("engines/server.GetServerConstants", () => GetServerConstants());
	LogResult("engines/server.GetGameDescription", () => GetGameDescription());
	LogResult("engines/server.GetServer", () => {
		const Server = GetServer();

		return {
			Active: Server.IsServerActive(),
			ClientCount: Server.GetConnectedClientCount(),
			MapName: Server.GetMapName(),
			MaximumClients: Server.GetMaximumClients(),
			Address: Server.Address,
			Tick: Server.GetServerTick(),
		};
	});

	LogResult("engines/precache.Model", () => {
		const Server = GetServer();
		if (!Server.IsServerActive()) {
			return {
				Active: false,
				MapName: Server.GetMapName(),
			};
		}

		const strPath = `maps/${Server.GetMapName()}.bsp`;
		const Resource = new ModelPrecacheResource(strPath);

		return UseCleanup("model precache resource", () => {
			const ExampleError = new PrecacheResourceError("models/sourcejs_missing.mdl", "modelprecache");

			return {
				Active: true,
				Error: {
					Name: ExampleError.name,
					Path: ExampleError.ResourcePath,
					TableName: ExampleError.TableName,
				},
				Index: Resource.GetPrecacheIndex(),
				Path: Resource.ResourcePath,
				Registered: Resource.Registered,
			};
		}, () => {
			if (!Resource.Unload()) {
				throw new Error(`Unable to unload the managed precache resource ${strPath}.`);
			}
		});
	});

	LogResult("engines/sound.Sound", () => {
		const SoundValue = new Sound("common/null.wav", {
			Attenuation: Attenuation.NONE,
			Volume: VOL_NORM,
			Channel: Channel.AUTO,
			Entity: SOUND_FROM_WORLD,
			Pitch: Pitch.NORMAL,
			Flags: SoundFlags.NO_FLAGS,
		});

		return {
			Attenuation: SoundValue.Attenuation,
			Channel: SoundValue.Channel,
			DistanceGain: GetDistanceGainFromSoundLevel(75, 256),
			Duration: SoundValue.Duration,
			Precached: SoundValue.Precached,
			RelativePath: SoundValue.RelativePath,
			Sample: SoundValue.Sample,
		};
	});

	LogResult("engines/trace.IsPointOutsideWorld", () => IsPointOutsideWorld(VectorValue));
	LogResult("engines/trace.GetPointContents", () => {
		const Result = GetPointContents(VectorValue, ContentMasks.All);

		return {
			Contents: Result.Contents,
			EntityIndex: Result.Entity?.Index ?? null,
			EntityIndexes: Result.Entities,
			Mask: Result.Mask,
		};
	});

	LogResult("engines/gamerules live state", () => {
		if (!IsAvailable()) {
			return { Available: false };
		}

		const vecProperties = ListProperties();

		return {
			Available: true,
			PropertyCount: vecProperties.length,
			FirstProperty: vecProperties[0] ?? null,
			ProxyName: GetProxyName(),
			SendTableName: GetSendTableName(),
		};
	});

	LogResult("physics live environment", () => {
		const flAirDensityAdjustment = 0.001;
		const flGravityAdjustment = 1;
		const PhysicsInterfaceInstance = new PhysicsInterface();
		const Environment = GetActivePhysicsEnvironmentByIndex(0);
		if (Environment === null) {
			return {
				Available: false,
				InterfaceAddress: PhysicsInterfaceInstance.Address,
				ServerGravity: GetServerGravityConVarValue(),
			};
		}

		const EnvironmentFromAddress = PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress(Environment.Address);
		const LiveGravity = EnvironmentFromAddress.GetGravity();
		const GravityBefore = { X: LiveGravity.X, Y: LiveGravity.Y, Z: LiveGravity.Z };
		const flAirDensityBefore = EnvironmentFromAddress.GetAirDensity();
		const GravityTest = { ...GravityBefore, Z: GravityBefore.Z - flGravityAdjustment };
		const flAirDensityTest = flAirDensityBefore + flAirDensityAdjustment;

		// All borrowed physics views and both restorations stay in this synchronous operation.
		return UseCleanup("physics environment example", () => {
			if (!EnvironmentFromAddress.SetGravity(GravityTest)) {
				throw new Error("Unable to set the example physics gravity.");
			}

			if (!EnvironmentFromAddress.SetAirDensity(flAirDensityTest)) {
				throw new Error("Unable to set the example physics air density.");
			}

			const vecActiveObjects = EnvironmentFromAddress.ActiveObjects();
			const FirstObject = vecActiveObjects[0] ?? null;
			let ObjectValue = null;
			if (FirstObject !== null) {
				const ObjectFromAddress = PhysicsObject.CreatePhysicsObjectFromAddress(FirstObject.Address);
				const Position = ObjectFromAddress.GetPosition();
				const Velocity = ObjectFromAddress.GetVelocity();
				ObjectValue = {
					CollisionEnabled: ObjectFromAddress.IsCollisionEnabled(),
					GravityEnabled: ObjectFromAddress.IsGravityEnabled(),
					Mass: ObjectFromAddress.GetMass(),
					Name: ObjectFromAddress.GetName(),
					Address: ObjectFromAddress.Address,
					Position: {
						Angles: [Position.Angles.Pitch, Position.Angles.Yaw, Position.Angles.Roll],
						Origin: [Position.Position.X, Position.Position.Y, Position.Position.Z],
					},
					Velocity: {
						Angular: [Velocity.AngularVelocity.X, Velocity.AngularVelocity.Y, Velocity.AngularVelocity.Z],
						Linear: [Velocity.LinearVelocity.X, Velocity.LinearVelocity.Y, Velocity.LinearVelocity.Z],
					},
				};
			}

			return {
				ActiveObjectCount: EnvironmentFromAddress.GetActiveObjectCount(),
				After: {
					AirDensity: EnvironmentFromAddress.GetAirDensity(),
					Gravity: [LiveGravity.X, LiveGravity.Y, LiveGravity.Z],
				},
				Before: {
					AirDensity: flAirDensityBefore,
					Gravity: GravityBefore,
				},
				EnvironmentAddress: EnvironmentFromAddress.Address,
				InterfaceAddress: PhysicsInterfaceInstance.Address,
				Object: ObjectValue,
				AddressRoundTrip: {
					Environment: PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress(Environment.Address).Address === Environment.Address,
					PhysicsInterface: PhysicsInterface.CreatePhysicsInterfaceFromAddress(PhysicsInterfaceInstance.Address).Address === PhysicsInterfaceInstance.Address,
				},
				ServerGravity: GetServerGravityConVarValue(),
				Simulation: {
					InProgress: EnvironmentFromAddress.IsInSimulation(),
					NextFrameTime: EnvironmentFromAddress.GetNextFrameTime(),
					Time: EnvironmentFromAddress.GetSimulationTime(),
					TimeStep: EnvironmentFromAddress.GetSimulationTimestep(),
				},
			};
		}, () => {
			UseCleanup("physics environment restoration", () => {
				if (!EnvironmentFromAddress.SetAirDensity(flAirDensityBefore)) {
					throw new Error("Unable to restore the physics air density after the example.");
				}
			}, () => {
				if (!EnvironmentFromAddress.SetGravity(GravityBefore)) {
					throw new Error("Unable to restore the physics gravity after the example.");
				}
			});
		});
	});

	LogResult("entities.GetEntityCount", () => GetEntityCount());
	LogResult("entities.GetMaximumEntityCount", () => GetMaximumEntityCount());
	LogResult("entities.GetEntitiesByClassName(worldspawn)", () => GetEntityIndexes(GetEntitiesByClassName("worldspawn")));
	LogResult("entities/entity.Entity", () => {
		const Worldspawn = GetEntitiesByClassName("worldspawn")[0] ?? null;
		if (Worldspawn === null) {
			return null;
		}

		const EntityInstance = Entity(Worldspawn.Index);
		if (EntityInstance === null) {
			return null;
		}

		return {
			ClassName: EntityInstance.ClassName,
			Index: EntityInstance.Index,
			Inputs: EntityInstance.GetEntityInputs().map((Field) => Field.Path),
			ModelName: (typeof EntityInstance.GetEntityModelName === "function") ? EntityInstance.GetEntityModelName() : null,
			Networked: EntityInstance.IsEntityNetworked(),
			Outputs: EntityInstance.GetEntityOutputs().map((Field) => Field.Path),
			Address: EntityInstance.Address,
			Properties: EntityInstance.GetEntityProperties().map((Property) => Property.Path),
			Valid: IsEntityValid(EntityInstance.Index),
		};
	});

	LogResult("entities/classes ServerClassGenerator", () => Array.from(new ServerClassGenerator("base"), (ServerClass) => ServerClass.Name));
	LogResult("entities/classes SERVER_CLASSES", () => {
		const vecServerClasses = SERVER_CLASSES.GetServerClasses();
		const FirstClass = vecServerClasses[0] ?? null;
		if (FirstClass === null) {
			return { Count: 0 };
		}

		return {
			BaseClassNames: SERVER_CLASSES.GetServerClassBaseClassNames(FirstClass.Name),
			Count: vecServerClasses.length,
			FirstName: FirstClass.Name,
			HasFirstClass: SERVER_CLASSES.HasServerClass(FirstClass.Name),
			Properties: SERVER_CLASSES.GetServerClassProperties(FirstClass.Name).map((Property) => Property.Path || Property.Name),
			TableName: SERVER_CLASSES.GetServerClassSendTable(FirstClass.Name)?.Name ?? null,
		};
	});

	LogResult("entities/classes table lookup", () => {
		const FirstClass = SERVER_CLASSES.GetServerClasses()[0] ?? null;
		if (FirstClass === null) {
			return null;
		}

		const Table = SERVER_CLASSES.GetServerClassSendTable(FirstClass.Name);
		const vecProperties = SERVER_CLASSES.GetServerClassProperties(FirstClass.Name);

		return {
			Name: FirstClass.Name,
			Properties: vecProperties.map((Property) => Property.Path || Property.Name),
			TableName: Table?.Name ?? null,
			TableClass: (Table === null) ? null : (SERVER_CLASSES.FindServerClassBySendTableName(Table.Name)?.Name ?? null),
		};
	});

	LogResult("entities/collisions.CollisionRules", () => {
		const Worldspawn = GetEntitiesByClassName("worldspawn")[0] ?? null;
		if (Worldspawn === null) {
			return null;
		}

		const Rules = new CollisionRules(Worldspawn);
		const Bounds = Rules.GetEntityCollisionBounds();

		return {
			Bounds: {
				Maximums: [Bounds.Maximums.X, Bounds.Maximums.Y, Bounds.Maximums.Z],
				Minimums: [Bounds.Minimums.X, Bounds.Minimums.Y, Bounds.Minimums.Z],
			},
			CollisionEnabled: Rules.CollisionEnabled,
			CollisionGroup: Rules.CollisionGroup,
			HasNotSolid: Rules.HasSolidFlags(SolidFlags.NotSolid),
			SolidFlags: Rules.SolidFlags,
			SolidType: Rules.SolidType,
		};
	});

	LogResult("entities/collisions constants", () => ({
		CollisionGroup: {
			Player: CollisionGroup.Player,
		},
		SolidFlags: {
			NotSolid: SolidFlags.NotSolid,
		},
		SolidType: {
			VPhysics: SolidType.VPhysics,
		},
	}));

	LogResult("entities/constants enums", () => ({
		DamageTypes: {
			Blast: DamageTypes.Blast,
		},
		MoveType: {
			NoClip: MoveType.NoClip,
		},
		RenderMode: {
			Glow: RenderMode.Glow,
		},
		TakeDamage: {
			Yes: TakeDamage.Yes,
		},
	}));

	LogResult("entities/datamaps live worldspawn", () => {
		const Worldspawn = GetEntitiesByClassName("worldspawn")[0] ?? null;
		if (Worldspawn === null) {
			return null;
		}

		const DataMap = GetEntityDataMap(Worldspawn);
		if (DataMap === null) {
			return null;
		}

		return {
			BaseAddress: DataMap.BaseAddress,
			ClassName: DataMap.ClassName,
			Fields: GetEntityDataMapFields(DataMap).map((Field) => ({
				Offset: Field.Offset,
				Path: Field.Path,
				Address: Field.Address,
				Type: Field.Type,
			})),
			Length: DataMap.FieldCount,
			PackedSize: DataMap.PackedSize,
			Address: DataMap.Address,
		};
	});

	LogResult("entities/dictionary ENTITY_DICTIONARY", () => {
		const vecIndexes = GetEntityIndexes(GetAllEntities());
		const unFirstIndex = vecIndexes[0] ?? null;
		const FirstEntity = (unFirstIndex === null) ? null : ENTITY_DICTIONARY.get(unFirstIndex);

		return {
			CachedSize: ENTITY_DICTIONARY.size,
			EntityCount: vecIndexes.length,
			FirstEntity: (FirstEntity === null) ? null : {
				ClassName: FirstEntity.ClassName,
				Index: FirstEntity.Index,
				Address: FirstEntity.Address,
				Valid: FirstEntity.Valid,
			},
			FirstIndex: unFirstIndex,
		};
	});

	LogResult("entities/factories live lookup", () => {
		const Worldspawn = GetEntitiesByClassName("worldspawn")[0] ?? null;
		if (Worldspawn === null) {
			return null;
		}

		return {
			ClassNameKeyValue: GetEntityKeyValue(Worldspawn, "classname"),
			IndexForHammerIDZero: FindEntityByHammerID(0)?.Index ?? null,
			Index: Worldspawn.Index,
		};
	});

	LogResult("entities/outputs FireOutput", () => {
		const Options = GetEntityFireOutputHookOptions();

		return {
			Arguments: Options.Arguments,
			Convention: Options.Convention,
			Identifier: GetEntityFireOutputIdentifier(),
			Address: GetEntityFireOutputAddress(),
			ReturnType: Options.ReturnType,
		};
	});

	LogResult("entities/props worldspawn reflection", () => {
		const Worldspawn = GetEntitiesByClassName("worldspawn")[0] ?? null;
		if (Worldspawn === null) {
			return null;
		}

		const ServerClass = GetEntityServerClass(Worldspawn);
		const SendTable = GetSendTable(Worldspawn);
		const vecProperties = GetServerClassProperties(SendTable);
		const FirstProperty = vecProperties[0] ?? null;
		const FirstPropertyValue = (FirstProperty === null) ? null : GetEntityProperty(Worldspawn, FirstProperty.Path);

		return {
			FirstProperty: (FirstProperty === null) ? null : {
				Offset: FirstProperty.Offset,
				Path: FirstProperty.Path,
				Address: FirstProperty.Address,
				Type: FirstProperty.Type,
				Value: FirstPropertyValue,
			},
			Properties: vecProperties.map((Property) => ({
				Offset: Property.Offset,
				Path: Property.Path,
				Address: Property.Address,
				Type: Property.Type,
			})),
			SendTable: (SendTable === null) ? null : {
				Name: SendTable.Name,
				Address: SendTable.Address,
			},
			ServerClass: (ServerClass === null) ? null : {
				Name: ServerClass.Name,
				Address: ServerClass.Address,
			},
		};
	});

	LogResult("entities/transmit worldspawn state", () => {
		const Worldspawn = GetEntitiesByClassName("worldspawn")[0] ?? null;
		if (Worldspawn === null) {
			return null;
		}

		return {
			Constants: {
				ALWAYS,
				DONT_SEND,
				FULL_CHECK,
				PVS_CHECK,
			},
			Index: Worldspawn.Index,
			StateFlags: GetTransmitStateFlags(Worldspawn),
		};
	});

	LogResult("engines/server Server.GetMaximumClients", () => GetServer().GetMaximumClients());
	LogResult("players.GetClientCount", () => GetClientCount());
	LogResult("players/entity.Player", () => {
		const vecConnectedPlayers = GetAllPlayers().filter((Candidate) => Candidate.Connected);
		const FirstConnectedPlayer = vecConnectedPlayers[0] ?? null;
		if (FirstConnectedPlayer === null) {
			return {
				Connected: false,
				ConnectedPlayerCount: vecConnectedPlayers.length,
			};
		}

		const PlayerInstance = new Player(FirstConnectedPlayer.Index);
		const ViewCoordinates = PlayerInstance.GetViewCoordinates();

		return {
			Index: PlayerInstance.Index,
			Connected: PlayerInstance.IsConnected(),
			ConnectedPlayerCount: vecConnectedPlayers.length,
			FakeClient: PlayerInstance.IsFakeClient(),
			Team: PlayerInstance.GetTeam(),
			TeamName: PlayerInstance.GetTeamName(),
			Language: PlayerInstance.GetLanguage(),
			EyeLocation: PlayerInstance.GetEyeLocation().ConvertMathStructureToArray(),
			ViewVector: PlayerInstance.GetViewVector().ConvertMathStructureToArray(),
			ViewCoordinates: (ViewCoordinates === null) ? null : ViewCoordinates.ConvertMathStructureToArray(),
			Spectators: PlayerInstance.GetSpectators().map((Spectator) => Spectator.Index),
			NoClip: PlayerInstance.GetNoClip(),
			GodMode: PlayerInstance.GetGodMode(),
			NoBlock: PlayerInstance.GetNoBlock(),
			Flashlight: PlayerInstance.GetFlashlight(),
			ClientRate: GetClientCVarValue(PlayerInstance, "rate"),
			ActiveWeaponIndex: PlayerInstance.GetActiveWeapon()?.Index ?? null,
			PrimaryWeaponIndex: PlayerInstance.GetPrimaryWeapon()?.Index ?? null,
			Weapons: PlayerInstance.GetWeaponIndexes(),
			IndexFromUserID: GetPlayerInformationFromUserID(PlayerInstance.UserID)?.Index ?? null,
		};
	});

	LogResult("filters/players.GetAllPlayers", () => GetEntityIndexes(GetAllPlayers()));
	LogResult("filters/players.PlayerIterator(Human)", () => GetEntityIndexes(new PlayerIterator("Human").ToArray()));
	LogResult("filters/players.ParsePlayerFilterExpression", () => GetEntityIndexes(Array.from(ParsePlayerFilterExpression("Human - Dead"))));

	LogResult("players/helpers conversions", () => {
		const FirstConnectedPlayer = GetAllPlayers().find((Candidate) => Candidate.Connected) ?? null;
		if (FirstConnectedPlayer === null) {
			return { FirstConnectedPlayer: null };
		}

		const unFirstPlayerIndex = FirstConnectedPlayer.Index;
		const nFirstPlayerUserID = GetUserIDFromIndex(unFirstPlayerIndex);
		const strFirstPlayerNetworkID = GetNetworkIDFromIndex(unFirstPlayerIndex);
		const FirstPlayerInformation = GetPlayerInformationFromUserID(nFirstPlayerUserID);
		const unFirstPlayerAddress = GetAddressFromUserID(nFirstPlayerUserID);

		return {
			Index: unFirstPlayerIndex,
			Name: GetName(unFirstPlayerIndex),
			NetworkID: strFirstPlayerNetworkID,
			NetworkIDIndex: GetIndexFromNetworkID(strFirstPlayerNetworkID),
			PlayerInformationIndex: GetIndexFromPlayerInformation(FirstPlayerInformation),
			Address: unFirstPlayerAddress,
			UserIDFromAddress: GetUserIDFromAddress(unFirstPlayerAddress),
			UserID: nFirstPlayerUserID,
		};
	});

	LogResult("players/language client settings", () => {
		const HumanPlayer = GetAllPlayers().find((Candidate) => Candidate.Connected && !Candidate.FakeClient) ?? null;
		if (HumanPlayer === null) {
			return { HumanPlayer: null };
		}

		return {
			Index: HumanPlayer.Index,
			Language: GetClientLanguage(HumanPlayer),
			Rate: GetClientCVarValue(HumanPlayer, "rate"),
		};
	});

	LogResult("players/teams profile", () => ({
		DataProfile,
		ProfileFromDisk: GetTeamProfile(),
		SDKBranch,
		SupportedBranches: GetTeamSupportedBranches(),
	}));

	LogResult("players/teams mappings", () => {
		const CurrentTeamNames = GetTeamNames();
		const vecTeamEntries = Object.entries(CurrentTeamNames);
		const vecFirstTeamEntry = vecTeamEntries[0] ?? null;
		const SampleTeam = (vecFirstTeamEntry === null) ? null : {
			Name: vecFirstTeamEntry[0],
			TeamNumber: GetTeamNumber(vecFirstTeamEntry[0]),
		};
		if (SampleTeam !== null) {
			SampleTeam.Players = GetEntityIndexes(GetPlayersByTeam(SampleTeam.TeamNumber));
			SampleTeam.RoundTripName = GetTeamName(SampleTeam.TeamNumber);
		}

		return {
			ClassesByName: GetTeamClassesByName(),
			ClassesByNumber: GetTeamClassesByNumber(),
			Data: GetTeamData(),
			Managers: GetTeamManagers(),
			Names: CurrentTeamNames,
			Numbers: GetTeamNumbers(),
			SampleTeam,
		};
	});

	LogResult("players/voice state", () => {
		const FirstConnectedPlayer = GetAllPlayers().find((Candidate) => Candidate.Connected) ?? null;
		const Listening = (FirstConnectedPlayer === null) ? null : {
			Index: FirstConnectedPlayer.Index,
			ListeningToSelf: GetClientListening(FirstConnectedPlayer.Index, FirstConnectedPlayer.Index),
			MutedForSelf: MUTE_MANAGER.IsMuted(FirstConnectedPlayer.Index, [FirstConnectedPlayer.Index]),
		};

		return {
			Listening,
			SetClientListeningHook: GetSetClientListeningHookOptions(),
			VoiceServerAddress: g_PlayerVoiceAPI.VoiceServer.Address,
		};
	});

	LogResult("players/bots roster", () => {
		const vecBotPlayers = GetBotPlayers();
		const vecHumanPlayers = GetHumanPlayers();
		const FirstPlayer = vecBotPlayers[0] ?? vecHumanPlayers[0] ?? null;
		const RoundTripPlayer = (FirstPlayer === null) ? null : g_GetBotPlayer(FirstPlayer.Index);

		return {
			Bots: GetEntityIndexes(vecBotPlayers),
			FirstPlayerRoundTripIndex: RoundTripPlayer?.Index ?? null,
			Humans: GetEntityIndexes(vecHumanPlayers),
		};
	});

	LogResult("players/dictionary roster and cache", () => {
		const PlayersByIndex = g_GetAllDictionaryPlayers();
		const vecPlayerIndexes = GetKeys();
		const unFirstPlayerIndex = vecPlayerIndexes[0] ?? null;
		const FirstPlayer = (unFirstPlayerIndex === null) ? null : {
			IndexFromGetPlayer: GetPlayer(unFirstPlayerIndex)?.Index ?? null,
			Has: g_HasDictionaryPlayer(unFirstPlayerIndex),
			Index: unFirstPlayerIndex,
			IndexFromDictionary: g_GetDictionaryPlayer(unFirstPlayerIndex)?.Index ?? null,
		};

		return {
			All: Object.fromEntries(Object.entries(PlayersByIndex).map(([strKey, Value]) => [strKey, (strKey === "Count") ? Value : Value.Index])),
			Entries: GetEntries().map(([unIndex, Player]) => [unIndex, Player.Index]),
			FirstPlayer,
			Keys: vecPlayerIndexes,
			SharedCache: {
				InstanceOfPlayerDictionary: PLAYER_DICTIONARY instanceof PlayerDictionary,
				Keys: Array.from(PLAYER_DICTIONARY.keys()),
				Size: PLAYER_DICTIONARY.size,
			},
			Values: GetValues().map((Player) => Player.Index),
		};
	});

	LogResult("players/constants selected SDK values", () => ({
		ClientCount: g_PlayerConstants.GetClientCount(),
		Constants: Object.fromEntries(Object.entries(g_PlayerConstants).filter(([, Value]) => typeof Value !== "function")),
		MaximumClients: g_PlayerConstants.GetMaximumClients(),
	}));

	LogResult("players/engines branch", () => Branch);

	if (Branch === "css") {
		const { Branch, HasC4, GetPlayer } = require("players/engines/orangebox/cstrike");

		LogResult("players/engines/orangebox/cstrike state", () => {
			const FirstConnectedPlayer = GetAllPlayers().find((Candidate) => Candidate.Connected) ?? null;
			const SpecializedPlayer = (FirstConnectedPlayer === null) ? null : GetPlayer(FirstConnectedPlayer.Index);

			return {
				Branch,
				Player: (SpecializedPlayer === null) ? null : {
					HasC4: HasC4(SpecializedPlayer),
					Index: SpecializedPlayer.Index,
					MethodHasC4: SpecializedPlayer.HasC4(),
				},
			};
		});
	}

	LogResult("filters current sets", () => ({
		Entities: GetEntityIndexes(g_GetAllEntities()),
		Players: GetEntityIndexes(g_GetAllPlayers()),
		Recipients: GetEntityIndexes(g_GetAllRecipients()),
		Weapons: GetEntityIndexes(g_GetAllWeapons()),
	}));

	LogResult("filters/weapons current state", () => {
		const vecCurrentWeapons = g_GetAllFilterWeapons();
		const FirstWeapon = vecCurrentWeapons[0] ?? null;
		const vecFilteredByClassName = (FirstWeapon === null) ? [] : GetEntityIndexes(g_GetFilterWeaponsByClassName(FirstWeapon.ClassName));
		const vecFilteredByName = ((FirstWeapon === null) || (FirstWeapon.Weapon.length === 0)) ? [] : GetEntityIndexes(g_GetFilterWeaponsByName(FirstWeapon.Weapon));
		const RoundTripWeapon = (FirstWeapon === null) ? null : GetWeapon(FirstWeapon.Index);
		const CurrentPlayer = GetAllPlayers().find((Candidate) => Candidate.Connected) ?? null;
		const CurrentWeapon = (CurrentPlayer === null) ? null : g_GetFilterCurrentWeapon(CurrentPlayer);

		return {
			All: GetEntityIndexes(vecCurrentWeapons),
			ByClassName: vecFilteredByClassName,
			ByName: vecFilteredByName,
			Classes: new WeaponClassIterator().ToArray(),
			Count: GetWeaponCount(),
			CurrentPlayer: (CurrentPlayer === null) ? null : {
				Index: CurrentPlayer.Index,
				WeaponName: CurrentWeapon?.Weapon ?? null,
			},
			Iterator: GetEntityIndexes(new WeaponIterator().ToArray()),
			RoundTripIndex: RoundTripWeapon?.Index ?? null,
		};
	});

	LogResult("weapons/data active branch", () => {
		const LoadedData = Load();
		const vecWeaponEntries = GetAll();
		const FirstWeapon = vecWeaponEntries[0] ?? null;

		return {
			Count: vecWeaponEntries.length,
			DataPath: GetDataPath(),
			FirstWeapon,
			FirstFormattedName: (FirstWeapon === null) ? null : FormatName(FirstWeapon.Name),
			FirstLookup: (FirstWeapon === null) ? null : Get(FirstWeapon.Name),
			HasData: Has(),
			LoadedPath: LoadedData.Path,
			Names: g_GetWeaponDataNames(),
			Projectiles: GetProjectiles(),
			Properties: GetProperties(),
			SpecialNames: GetSpecialNames(),
			SupportedBranches: SUPPORTED_BRANCHES,
			Tags: GetTags(),
		};
	});

	LogResult("weapons/manager data", () => {
		const vecWeaponClasses = WEAPON_MANAGER.Values();
		const FirstWeaponClass = vecWeaponClasses[0] ?? null;
		const strFirstWeaponName = FirstWeaponClass?.Name ?? null;

		return {
			AmmoProperty: WEAPON_MANAGER.AmmoProperty,
			Entries: WEAPON_MANAGER.Entries().map(([strClassName, WeaponClass]) => [strClassName, WeaponClass.ClassName]),
			First: (FirstWeaponClass === null) ? null : {
				ClassName: FirstWeaponClass.ClassName,
				FormattedName: WEAPON_MANAGER.FormatName(strFirstWeaponName),
				Has: WEAPON_MANAGER.Has(strFirstWeaponName),
				RoundTripClassName: WEAPON_MANAGER.Get(strFirstWeaponName)?.ClassName ?? null,
			},
			IteratedClassNames: [...WEAPON_MANAGER].map((WeaponClass) => WeaponClass.ClassName),
			Keys: WEAPON_MANAGER.Keys(),
			MyWeaponsProperty: WEAPON_MANAGER.MyWeaponsProperty,
			Prefix: WEAPON_MANAGER.Prefix,
			Projectiles: WEAPON_MANAGER.Projectiles,
			SpecialNames: WEAPON_MANAGER.SpecialNames,
			Tags: WEAPON_MANAGER.Tags,
			Values: vecWeaponClasses.map((WeaponClass) => WeaponClass.ClassName),
		};
	});

	LogResult("filters/recipients current groups", () => {
		const vecConnectedPlayers = GetAllPlayers().filter((Candidate) => Candidate.Connected);
		const FirstConnectedPlayer = vecConnectedPlayers[0] ?? null;

		return {
			AliveHumans: GetAliveRecipients().GetRecipientIndexes(),
			Bots: GetBotRecipients().GetRecipientIndexes(),
			ByFirstPlayerTeam: (FirstConnectedPlayer === null) ? null : GetRecipientsByTeam(FirstConnectedPlayer.TeamNumber, true).GetRecipientIndexes(),
			DeadHumans: GetDeadRecipients().GetRecipientIndexes(),
			Humans: GetHumanRecipients().GetRecipientIndexes(),
			WithBots: GetAllRecipients().GetRecipientIndexes(),
		};
	});

	LogResult("filters/recipients conversions and mutable filters", () => {
		const AllRecipients = GetAllRecipients();
		const unFirstRecipient = AllRecipients.GetRecipientIndex(0);
		const unFirstRecipientIndex = (unFirstRecipient === 0) ? null : unFirstRecipient;
		const FromPlayer = (unFirstRecipientIndex === null) ? new BaseRecipientFilter() : CreateRecipientFilterFromPlayer(unFirstRecipientIndex, true);
		const FromValues = CreateRecipientFilterFromValues(AllRecipients, true);
		const NativeRoundTrip = BaseRecipientFilter.CreateRecipientFilterFromNativeInfo({
			RecipientIndexes: FromValues.GetRecipientIndexes(),
			InitializationMessage: false,
			Reliable: true,
		});
		const MutableRecipients = new RecipientFilter(GetHumanRecipients(), { IncludeBots: false, Reliable: true });
		MutableRecipients.UpdateRecipients(GetBotRecipients(), { ClearRecipients: false, IncludeBots: true });

		return {
			ContainsFirst: (unFirstRecipientIndex === null) ? null : ContainsRecipient(FromValues, unFirstRecipientIndex),
			FromPlayer: FromPlayer.GetRecipientIndexes(),
			FromValues: FromValues.GetRecipientIndexes(),
			Mutable: {
				Count: MutableRecipients.RecipientCount,
				FirstIndex: MutableRecipients.GetRecipientIndex(0),
				Indices: MutableRecipients.GetRecipientIndexes(),
				Reliable: MutableRecipients.IsRecipientFilterReliable(),
				ResolvedPlayers: GetEntityIndexes(MutableRecipients.ResolveRecipientPlayers()),
			},
			NativeRoundTrip: {
				Count: NativeRoundTrip.RecipientCount,
				FirstIndex: NativeRoundTrip.GetRecipientIndex(0),
				Indices: NativeRoundTrip.GetRecipientIndexes(),
				InitializationMessage: NativeRoundTrip.IsRecipientFilterInitializationMessage(),
				Reliable: NativeRoundTrip.IsRecipientFilterReliable(),
			},
			ResolvedPlayers: GetEntityIndexes(ResolveRecipientPlayers(FromValues)),
		};
	});

	LogResult("filters/iterator live entity view", () => {
		class LiveEntityIterator extends IteratorObject {
			static Iterator() {
				return g_GetAllEntities();
			}
		}

		LiveEntityIterator.RegisterFilter("Valid", (EntityInstance) => EntityInstance.Valid);
		LiveEntityIterator.RegisterFilter("Weapon", (EntityInstance) => EntityInstance.ClassName.startsWith("weapon_"));

		const ValidEntities = new IteratorFilter(() => g_GetAllEntities(), (EntityInstance) => EntityInstance.Valid);
		const WeaponEntities = FromItems(() => ValidEntities).Filter((EntityInstance) => EntityInstance.ClassName.startsWith("weapon_"));
		const vecVisitedIndexes = [];
		const bForEachReturnedSource = ValidEntities.ForEach((EntityInstance) => vecVisitedIndexes.push(EntityInstance.Index)) === ValidEntities;
		const FirstValidEntity = ValidEntities.First();
		const vecNonWeaponEntities = new LiveEntityIterator("Valid", "Weapon").Resolve();
		const DefaultFilterIndexes = Object.fromEntries(Object.entries(LiveEntityIterator.DefaultFilters()).map(([strName, setValues]) => [strName, GetEntityIndexes([...setValues])]));
		const vecFilterNames = LiveEntityIterator.GetFilterNames();
		const bHasValidFilter = LiveEntityIterator.HasFilter("Valid");
		const bRemovedWeaponFilter = LiveEntityIterator.UnregisterFilter("Weapon");
		const bRemovedValidFilter = LiveEntityIterator.UnregisterFilter("Valid");

		return {
			DefaultFilterIndexes,
			FilterNames: vecFilterNames,
			ForEachReturnedSource: bForEachReturnedSource,
			HasValidFilter: bHasValidFilter,
			NonWeaponEntities: GetEntityIndexes(vecNonWeaponEntities),
			RemovedValidFilter: bRemovedValidFilter,
			RemovedWeaponFilter: bRemovedWeaponFilter,
			ValidEntities: {
				Count: ValidEntities.Count(),
				FirstIndex: FirstValidEntity?.Index ?? null,
				Mapped: ValidEntities.Map((EntityInstance) => EntityInstance.Index),
				Resolved: GetEntityIndexes(ValidEntities.Resolve()),
				Spread: GetEntityIndexes([...ValidEntities]),
				Array: GetEntityIndexes(ValidEntities.ToArray()),
				Values: GetEntityIndexes(ValidEntities.Values()),
				Visited: vecVisitedIndexes,
			},
			WeaponEntities: GetEntityIndexes(WeaponEntities.Resolve()),
		};
	});

	LogResult("filters/entities current state", () => {
		const vecAllEntities = GetAllEntities();
		const vecValidEntities = GetValidEntities();
		const vecWorldEntities = new EntityIterator("worldspawn").Resolve();
		const setIgnoredEntityIndexes = new Set(GetEntityIndexes(vecWorldEntities));
		const FirstUnignoredEntity = vecValidEntities.find((EntityInstance) => !setIgnoredEntityIndexes.has(EntityInstance.Index)) ?? null;
		const TraceFilter = new EntityTraceFilter(vecWorldEntities, TraceType.Everything);

		return {
			All: GetEntityIndexes(vecAllEntities),
			BaseDefaultFilters: Object.fromEntries(Object.entries(BaseEntityIterator.DefaultFilters()).map(([strName, setValues]) => [strName, GetEntityIndexes([...setValues])])),
			EntityDefaultFilters: Object.fromEntries(Object.entries(EntityIterator.DefaultFilters()).map(([strName, setValues]) => [strName, GetEntityIndexes([...setValues])])),
			TraceFilter: {
				Ignored: [...TraceFilter.IgnoredEntityIndexes],
				ShouldHitFirstUnignored: (FirstUnignoredEntity === null) ? null : TraceFilter.ShouldHitEntity(FirstUnignoredEntity),
				TraceType: TraceFilter.GetTraceType(),
			},
			Valid: GetEntityIndexes(vecValidEntities),
			WeaponSubstring: GetEntityIndexes(new BaseEntityIterator("weapon", false).Resolve()),
			Worldspawn: GetEntityIndexes(vecWorldEntities),
		};
	});

	LogResult("weapons current state and facade", () => {
		const vecCurrentWeapons = GetAllWeapons();
		const FirstWeapon = vecCurrentWeapons[0] ?? null;
		const vecConnectedPlayers = GetAllPlayers().filter((Candidate) => Candidate.Connected);
		const FirstConnectedPlayer = vecConnectedPlayers[0] ?? null;
		const ActiveWeapon = (FirstConnectedPlayer === null) ? null : GetCurrentWeapon(FirstConnectedPlayer);
		if (FirstWeapon === null) {
			return {
				ActiveWeaponIndex: ActiveWeapon?.Index ?? null,
				All: [],
				Classes: GetClasses(),
				Count: GetCount(),
				Names: GetNames(),
			};
		}

		const WeaponInstance = Weapon(FirstWeapon.Index);
		if (WeaponInstance === null) {
			return null;
		}

		const Owner = GetPropertyEntity(FirstWeapon, OWNER_PROPERTY);
		const OwnerPlayer = (Owner === null) ? null : (vecConnectedPlayers.find((Player) => Player.Index === Owner.Index) ?? null);
		const nPrimaryAmmoType = GetPropertyInteger(FirstWeapon, PRIMARY_AMMO_TYPE_PROPERTY);
		const nReserveAmmo = ((OwnerPlayer === null) || (nPrimaryAmmoType < 0)) ? null : GetAmmo(FirstWeapon);

		return {
			ActiveWeaponIndex: ActiveWeapon?.Index ?? null,
			All: GetEntityIndexes(vecCurrentWeapons),
			ByClassName: GetEntityIndexes(GetWeaponsByClassName(FirstWeapon.ClassName)),
			ByName: GetEntityIndexes(GetWeaponsByName(FirstWeapon.GetWeaponName())),
			Classes: GetClasses(),
			Count: GetCount(),
			Facade: {
				ClassName: WeaponInstance.ClassName,
				Index: WeaponInstance.Index,
				OwnerIndex: WeaponInstance.GetOwner()?.Index ?? null,
				Address: WeaponInstance.Address,
				WeaponName: WeaponInstance.GetWeaponName(),
			},
			InferredClip: GetProperty(FirstWeapon, CLIP_PROPERTY),
			Name: GetWeaponName(FirstWeapon),
			Names: GetNames(),
			OwnerIndex: Owner?.Index ?? null,
			PrimaryAmmoType: nPrimaryAmmoType,
			PrimaryClip: GetPropertyInteger(FirstWeapon, CLIP_PROPERTY),
			ReserveAmmo: nReserveAmmo,
			RoundTripClassName: GetClassName(WeaponInstance),
		};
	});

	LogResult("weapons read helpers", () => {
		const vecCurrentWeapons = GetAllWeapons();
		const setConnectedPlayerIndexes = new Set(GetAllPlayers().filter((Player) => Player.Connected).map((Player) => Player.Index));
		const OwnedWeapon = vecCurrentWeapons.find((WeaponValue) => {
			const Owner = GetPropertyEntity(WeaponValue, OWNER_PROPERTY);

			return (Owner !== null) && setConnectedPlayerIndexes.has(Owner.Index);
		}) ?? null;
		const SelectedWeapon = OwnedWeapon ?? vecCurrentWeapons[0] ?? null;
		const Constants = {
			AMMO_PROPERTY_PREFIX,
			CLIP_PROPERTY,
			OWNER_PROPERTY,
			PRIMARY_AMMO_TYPE_PROPERTY,
			SECONDARY_AMMO_TYPE_PROPERTY,
			SECONDARY_CLIP_PROPERTY,
		};
		if (SelectedWeapon === null) {
			return { Constants, Weapon: null };
		}

		const Owner = GetOwner(SelectedWeapon);
		const bOwnerIsConnectedPlayer = (Owner !== null) && setConnectedPlayerIndexes.has(Owner.Index);
		const nPrimaryAmmoType = GetPropertyInteger(SelectedWeapon, PRIMARY_AMMO_TYPE_PROPERTY);
		const nPrimaryClip = GetPropertyInteger(SelectedWeapon, CLIP_PROPERTY);
		const nSecondaryAmmoType = GetPropertyInteger(SelectedWeapon, SECONDARY_AMMO_TYPE_PROPERTY);
		const nSecondaryClip = GetPropertyInteger(SelectedWeapon, SECONDARY_CLIP_PROPERTY);

		return {
			Constants,
			Weapon: {
				Ammo: (bOwnerIsConnectedPlayer && (nPrimaryAmmoType >= 0)) ? GetAmmo(SelectedWeapon) : null,
				Clip: (nPrimaryClip < 0) ? null : GetClip(SelectedWeapon),
				DecoratedIndex: DecorateWeapon(SelectedWeapon).Index,
				Index: Weapon(SelectedWeapon.Index)?.Index ?? null,
				Name: GetWeaponName(SelectedWeapon),
				OwnerIndex: Owner?.Index ?? null,
				PrimaryAmmoType: (nPrimaryAmmoType < 0) ? null : GetPrimaryAmmoType(SelectedWeapon),
				SecondaryAmmo: (bOwnerIsConnectedPlayer && (nSecondaryAmmoType >= 0)) ? GetSecondaryAmmo(SelectedWeapon) : null,
				SecondaryAmmoType: (nSecondaryAmmoType < 0) ? null : GetSecondaryAmmoType(SelectedWeapon),
				SecondaryClip: (nSecondaryClip < 0) ? null : GetSecondaryClip(SelectedWeapon),
			},
		};
	});

	LogResult("weapons/manager first WeaponClass", () => {
		const vecValues = WEAPON_MANAGER.Values();
		const FirstWeaponClass = vecValues[0] ?? null;
		if (FirstWeaponClass === null) {
			return {
				Count: 0,
				WeaponClass: null,
			};
		}

		const strFirstTag = FirstWeaponClass.Tags[0] ?? null;

		return {
			Count: vecValues.length,
			WeaponClass: {
				AmmoProperty: FirstWeaponClass.AmmoProperty,
				BaseName: FirstWeaponClass.BaseName,
				ClassName: FirstWeaponClass.ClassName,
				Clip: FirstWeaponClass.Clip,
				Cost: FirstWeaponClass.Cost,
				Data: FirstWeaponClass.Data,
				HasFirstTag: (strFirstTag === null) ? null : FirstWeaponClass.HasTag(strFirstTag),
				ID: FirstWeaponClass.ID,
				InstanceOfWeaponClass: FirstWeaponClass instanceof WeaponClass,
				ItemDefinitionIndex: FirstWeaponClass.ItemDefinitionIndex,
				MaximumAmmo: FirstWeaponClass.MaximumAmmo,
				Name: FirstWeaponClass.Name,
				ParentClass: FirstWeaponClass.ParentClass,
				Script: FirstWeaponClass.Script,
				SecondaryAmmoProperty: FirstWeaponClass.SecondaryAmmoProperty,
				SecondaryMaximumAmmo: FirstWeaponClass.SecondaryMaximumAmmo,
				Slot: FirstWeaponClass.Slot,
				Tags: FirstWeaponClass.Tags,
				Type: FirstWeaponClass.Type,
			},
		};
	});

	LogResult("weapons/restrictions handler", () => {
		class InspectionRestrictionHandler extends WeaponRestrictionHandler {
			OnPlayerRestrictionAdded() {
				return undefined;
			}
		}

		const FirstConnectedPlayer = GetAllPlayers().find((Player) => Player.Connected) ?? null;
		const FirstWeaponClass = WEAPON_MANAGER.Values()[0] ?? null;
		const SingletonState = {
			GlobalRestrictions: [...WEAPON_RESTRICTION_HANDLER.GlobalRestrictions],
			HandlerRegistered: [...WEAPON_RESTRICTION_MANAGER].includes(WEAPON_RESTRICTION_HANDLER),
			ManagerSize: WEAPON_RESTRICTION_MANAGER.Size,
		};
		if ((FirstConnectedPlayer === null) || (FirstWeaponClass === null)) {
			return {
				Local: null,
				Singleton: SingletonState,
			};
		}

		const PlayerValue = FirstConnectedPlayer;
		const strRestrictedWeaponName = FirstWeaponClass.Name;
		const Manager = new WeaponRestrictionManager();
		const Handler = new InspectionRestrictionHandler({ Manager });
		let LocalState = null;

		UseCleanup("weapon restriction example", () => {
			Handler.AddGlobalRestrictions([strRestrictedWeaponName]);
			Handler.AddPlayerRestrictions(PlayerValue, [strRestrictedWeaponName]);
			Handler.AddTeamRestrictions(PlayerValue.Team, [strRestrictedWeaponName]);
			LocalState = {
				BlockBump: Manager.OnPlayerBumpingWeapon(PlayerValue, strRestrictedWeaponName),
				BlockPurchase: Manager.OnPlayerPurchasingWeapon(PlayerValue, strRestrictedWeaponName),
				GlobalRestrictions: [...Handler.GlobalRestrictions],
				ManagerSizeDuring: Manager.Size,
				PlayerRestricted: Manager.IsPlayerRestricted(PlayerValue, strRestrictedWeaponName),
				PlayerRestrictions: Array.from(Handler.PlayerRestrictions, ([unUserID, setWeaponNames]) => [unUserID, [...setWeaponNames]]),
				TeamRestricted: Manager.IsTeamRestricted(PlayerValue.Team, strRestrictedWeaponName),
				TeamRestrictions: Array.from(Handler.TeamRestrictions, ([unTeamNumber, setWeaponNames]) => [unTeamNumber, [...setWeaponNames]]),
				WeaponName: strRestrictedWeaponName,
			};
		}, () => {
			UseCleanup("weapon restriction cleanup", () => {
				if (!Handler.Clear()) {
					throw new Error("Unable to clear the example weapon restrictions.");
				}
			}, () => {
				if (!Handler.Unregister()) {
					throw new Error("Unable to unregister the example weapon restriction handler.");
				}
			});
		});

		LocalState.ManagerSizeAfter = Manager.Size;

		return {
			GlobalCanUse: CanUse(PlayerValue, strRestrictedWeaponName),
			GlobalCanUseCurrent: CanUseCurrent(PlayerValue),
			Local: LocalState,
			Singleton: SingletonState,
		};
	});

	LogResult("weapons/scripts current catalog", () => {
		const vecClasses = g_GetWeaponScriptClasses();
		const vecScripts = g_GetAllWeaponScripts();
		const strFirstClass = vecClasses[0] ?? null;
		const FirstScript = vecScripts[0] ?? null;

		return {
			Classes: vecClasses,
			FirstClass: (strFirstClass === null) ? null : {
				Exists: g_HasWeaponScript(strFirstClass),
				Path: GetScriptPath(strFirstClass),
			},
			FirstScriptUsesCache: (FirstScript === null) ? null : g_LoadWeaponScript(FirstScript.ClassName) === FirstScript,
			Names: g_GetWeaponScriptNames(),
			Scripts: vecScripts.map((ScriptRecord) => ({
				ClassName: ScriptRecord.ClassName,
				Name: ScriptRecord.Name,
				Path: ScriptRecord.Path,
				Values: ScriptRecord.KeyValues.ConvertKeyValuesToObject(),
			})),
		};
	});

	LogResult("weapons/constants selected SDK values", () => g_WeaponConstants);
	LogResult("weapons/instance explicit WeaponClass", () => {
		const FirstRecord = GetAll()[0] ?? null;
		if (FirstRecord === null) {
			return null;
		}

		const WeaponClassInstance = new WeaponClass(FirstRecord);
		const strFirstTag = WeaponClassInstance.Tags[0] ?? null;

		return {
			ClassName: WeaponClassInstance.ClassName,
			HasFirstTag: (strFirstTag === null) ? null : WeaponClassInstance.HasTag(strFirstTag),
			Name: WeaponClassInstance.Name,
			RecordIsShared: WeaponClassInstance.Record === FirstRecord,
			Tags: WeaponClassInstance.Tags,
		};
	});

	LogResult("weapons/entity live facade", () => {
		const vecCurrentWeapons = GetAllWeapons();
		const setConnectedPlayerIndexes = new Set(GetAllPlayers().filter((Player) => Player.Connected).map((Player) => Player.Index));
		const SelectedWeapon = vecCurrentWeapons.find((WeaponValue) => {
			const Owner = g_GetEntityWeaponPropertyEntity(WeaponValue, OWNER_PROPERTY);

			return (Owner !== null) && setConnectedPlayerIndexes.has(Owner.Index);
		}) ?? vecCurrentWeapons[0] ?? null;
		if (SelectedWeapon === null) {
			return null;
		}

		const Facade = g_EntityWeapon(SelectedWeapon.Index);
		if (Facade === null) {
			return null;
		}

		const Owner = g_GetEntityWeaponPropertyEntity(Facade, OWNER_PROPERTY);
		const nPrimaryAmmoType = g_GetEntityWeaponPropertyInteger(Facade, PRIMARY_AMMO_TYPE_PROPERTY);

		return {
			ClassName: Facade.ClassName,
			Index: Facade.Index,
			InferredClip: g_GetEntityWeaponProperty(Facade, CLIP_PROPERTY),
			IntegerClip: g_GetEntityWeaponPropertyInteger(Facade, CLIP_PROPERTY),
			OwnerIndex: Owner?.Index ?? null,
			Address: Facade.Address,
			PrimaryAmmoType: nPrimaryAmmoType,
		};
	});

	LogResult("steam current player identities", () => {
		const vecPlayers = GetAllPlayers();
		const vecPlayerIdentities = [];
		for (const Player of vecPlayers) {
			if (!Player.Connected) {
				continue;
			}

			const PlayerIdentity = {
				Index: Player.Index,
				NetworkID: GetNetworkID(Player.Index),
			};
			if (typeof GetXUID === "function") {
				PlayerIdentity.XUID = GetXUID(Player.Index);
			}

			vecPlayerIdentities.push(PlayerIdentity);
		}

		return {
			Branch: STEAM_BRANCH,
			Players: vecPlayerIdentities,
		};
	});

	LogResult("steam.SteamID detached and live memory", () => {
		if (typeof SteamID !== "function") {
			return {
				Available: false,
				Branch: STEAM_BRANCH,
			};
		}

		const Constructed = new SteamID(42, 1, Universe.Public, AccountType.Individual);
		const ParsedConstructed = SteamID.Parse(Constructed.ConvertSteamIDToSteamID3());
		const vecPlayers = GetAllPlayers();

		let ConnectedHuman = null;
		for (const Player of vecPlayers) {
			if (Player.Connected && !Player.FakeClient) {
				ConnectedHuman = Player;
				break;
			}
		}

		const strPlayerNetworkID = (ConnectedHuman === null) ? null : GetNetworkID(ConnectedHuman.Index);

		let ParsedPlayer = null;
		if ((strPlayerNetworkID !== null) && /^STEAM_[0-5]:[01]:\d+$/.test(strPlayerNetworkID)) {
			ParsedPlayer = SteamID.Parse(strPlayerNetworkID);
		}

		const unAddress = Allocate(STEAM_ID_SIZE);
		if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
			throw new Error("Unable to allocate the SteamID example object.");
		}

		return UseCleanup("SteamID allocation", () => {
			const LiveSteamID = MakeObject(SteamID, unAddress);
			const AttachedSteamID = SteamID.CreateFromAddress(unAddress);

			LiveSteamID.CopySteamIDFrom(Constructed);
			AttachedSteamID.AccountID += 1;

			const CopiedSteamID = AttachedSteamID.CopySteamID();
			const AnonymousServer = new SteamID(42, 0, Universe.Public, AccountType.GameServer);
			AnonymousServer.CreateBlankAnonymousLogon(Universe.Public);

			const AnonymousServerInformation = {
				Value: AnonymousServer.ConvertSteamIDToUInt64(),
			};
			const ConstructedInformation = {
				EqualsParsed: Constructed.AreEqual(ParsedConstructed),
				Fields: Constructed.GetSteamIDFields(),
				SteamID3: Constructed.ConvertSteamIDToSteamID3(),
				Value: Constructed.ConvertSteamIDToUInt64(),
			};

			if (typeof AnonymousServer.IsAnonymousAccount === "function") {
				AnonymousServerInformation.Anonymous = AnonymousServer.IsAnonymousAccount();
			}

			if (typeof AnonymousServer.IsGameServerAccount === "function") {
				AnonymousServerInformation.GameServer = AnonymousServer.IsGameServerAccount();
			}

			if (typeof Constructed.ConvertSteamIDToSteamID2 === "function") {
				ConstructedInformation.SteamID2 = Constructed.ConvertSteamIDToSteamID2();
			}

			return {
				AccountType,
				AnonymousServer: AnonymousServerInformation,
				Available: true,
				Branch: STEAM_BRANCH,
				Constructed: ConstructedInformation,
				Live: {
					AttachedAccountID: AttachedSteamID.AccountID,
					CopiedHasAddress: CopiedSteamID.HasAddress(),
					Fields: CopiedSteamID.GetSteamIDFields(),
					ObjectAddress: GetObjectAddress(LiveSteamID),
					ObjectTypeSize: ObjectTypeSize(SteamID),
					Address: LiveSteamID.Address,
					ReadAddressValue: AttachedSteamID.ReadAddressValue(),
					Value: LiveSteamID.ConvertSteamIDToUInt64(),
				},
				Player: (ConnectedHuman === null) ? null : {
					Index: ConnectedHuman.Index,
					NetworkID: strPlayerNetworkID,
					SteamID3: (ParsedPlayer === null) ? null : ParsedPlayer.ConvertSteamIDToSteamID3(),
					Value: (ParsedPlayer === null) ? null : ParsedPlayer.ConvertSteamIDToUInt64(),
				},
				SteamIDSize: STEAM_ID_SIZE,
				Universe,
			};
		}, () => {
			if (!Deallocate(unAddress)) {
				throw new Error("Unable to release the SteamID example object.");
			}
		});
	});

	LogResult("netchannel.NET_FLOW values", () => NET_FLOW);

	LogResult("memory.MakeObject NetChannel", () => {
		const vecPlayers = GetAllPlayers();

		let ConnectedPlayer = null;
		for (const Player of vecPlayers) {
			if (Player.Connected) {
				ConnectedPlayer = Player;
				break;
			}
		}

		if (ConnectedPlayer === null) {
			return null;
		}

		const Channel = GetPlayerNetChannel(ConnectedPlayer.Index);
		if (Channel === null) {
			return null;
		}

		const WrappedChannel = MakeObject(NetChannel, Channel.Address);

		return {
			ConnectedPlayerIndex: ConnectedPlayer.Index,
			OriginalAddress: Channel.Address,
			AddressesMatch: WrappedChannel.Address === Channel.Address,
			WrappedAddress: WrappedChannel.Address,
		};
	});

	const vecNetworkPlayers = GetAllPlayers();

	let NetworkPlayer = null;
	for (const Player of vecNetworkPlayers) {
		if (Player.Connected && !Player.FakeClient) {
			NetworkPlayer = Player;
			break;
		}
	}

	LogResult("netchannel.info realtime metrics", () => {
		if (NetworkPlayer === null) {
			return null;
		}

		const Information = GetPlayerNetChannelInfo(NetworkPlayer.Index);
		if (Information === null) {
			return {
				Available: false,
				PlayerIndex: NetworkPlayer.Index,
			};
		}

		const GetFlowMetrics = (nFlow) => {
			const nSequenceNumber = Information.GetNetChannelSequenceNumber(nFlow);

			return {
				AverageChoke: Information.GetNetChannelAverageChoke(nFlow),
				AverageData: Information.GetNetChannelAverageDataRate(nFlow),
				AverageLatency: Information.GetNetChannelAverageLatency(nFlow),
				AverageLoss: Information.GetNetChannelAveragePacketLoss(nFlow),
				AveragePackets: Information.GetNetChannelAveragePacketRate(nFlow),
				Latency: Information.GetNetChannelLatency(nFlow),
				Packet: {
					Bytes: Information.GetNetChannelPacketByteCount(nFlow),
					CommandInterpolation: (typeof Information.GetNetChannelCommandInterpolationAmount === "function") ? Information.GetNetChannelCommandInterpolationAmount(nFlow) : null,
					ResponseLatency: (typeof Information.GetNetChannelPacketResponseLatency === "function") ? Information.GetNetChannelPacketResponseLatency(nFlow) : null,
					SequenceNumber: nSequenceNumber,
					Time: Information.GetNetChannelPacketTime(nFlow),
					Valid: Information.IsNetChannelPacketValid(nFlow),
				},
				Stream: Information.GetNetChannelStreamProgress(nFlow),
				TotalData: Information.GetNetChannelTotalDataBytes(nFlow),
				TotalPackets: (typeof Information.GetNetChannelTotalPacketCount === "function") ? Information.GetNetChannelTotalPacketCount(nFlow) : null,
			};
		};

		const Metrics = {
			BufferSize: Information.BufferSize,
			ChannelAddress: Information.NetworkChannelAddress,
			DataRate: Information.DataRate,
			Incoming: GetFlowMetrics(NET_FLOW.Incoming),
			Loopback: Information.IsNetChannelLoopback(),
			Name: Information.Name,
			Outgoing: GetFlowMetrics(NET_FLOW.Outgoing),
			Playback: Information.IsNetChannelPlayback(),
			PlayerIndex: NetworkPlayer.Index,
			Address: Information.Address,
			RemoteAddress: Information.RemoteAddress,
			RemoteFrameRate: (typeof Information.GetNetChannelRemoteFrameRate === "function") ? Information.GetNetChannelRemoteFrameRate() : null,
			Time: Information.Time,
			TimeConnected: Information.TimeConnected,
			TimeSinceLastReceived: Information.TimeSinceLastReceived,
			TimingOut: Information.IsNetChannelTimingOut(),
		};
		if ("TimeoutSeconds" in Information) {
			Metrics.TimeoutSeconds = Information.TimeoutSeconds;
		}

		return Metrics;
	});

	LogResult("netchannel.channel live object", () => {
		if (NetworkPlayer === null) {
			return null;
		}

		const Channel = GetPlayerNetChannel(NetworkPlayer.Index);
		if (Channel === null) {
			return {
				Available: false,
				PlayerIndex: NetworkPlayer.Index,
			};
		}

		const MessageHandler = Channel.MessageHandler;
		const ChannelInformation = {
			Available: true,
			DataRate: Channel.DataRate,
			PlayerIndex: NetworkPlayer.Index,
			Address: Channel.Address,
		};
		if (MessageHandler !== null) {
			ChannelInformation.MessageHandlerAddress = MessageHandler.Address;
		}

		return ChannelInformation;
	});
}

function IsInt32(nValue) {
	const nMinimumInt32 = -0x80000000;
	const nMaximumInt32 = 0x7FFFFFFF;

	return Number.isInteger(nValue) && (nValue >= nMinimumInt32) && (nValue <= nMaximumInt32);
}

function ParseIndex(strValue, nMinimum, strUsage) {
	if ((typeof strValue !== "string") || (strValue.trim().length === 0)) {
		LogWarning("%s", `Use "${strUsage}".`);
		return null;
	}

	const nIndex = Number(strValue);
	if (!IsInt32(nIndex) || (nIndex < nMinimum)) {
		LogWarning("%s", `Use "${strUsage}".`);
		return null;
	}

	return nIndex;
}

function ParseVectorArgument(vecCommandArguments, unOffset) {
	const unCoordinateCount = 3;
	const vecCoordinates = vecCommandArguments.slice(unOffset, unOffset + unCoordinateCount);
	if ((vecCoordinates.length !== unCoordinateCount) || vecCoordinates.some((strValue) => (typeof strValue !== "string") || (strValue.trim().length === 0))) {
		return null;
	}

	const flX = Number(vecCommandArguments[unOffset]);
	const flY = Number(vecCommandArguments[unOffset + 1]);
	const flZ = Number(vecCommandArguments[unOffset + 2]);
	if (!Number.isFinite(Math.fround(flX)) || !Number.isFinite(Math.fround(flY)) || !Number.isFinite(Math.fround(flZ))) {
		return null;
	}

	return new Vector(flX, flY, flZ);
}

function RunPVSAction(vecCommandArguments) {
	const strAction = vecCommandArguments[1] ?? "inspect";
	if (strAction === "net") {
		if (vecCommandArguments.length !== 3) {
			LogWarning(`Use "${g_strCommandName} pvs net <player>".`);
			return;
		}

		const unIndex = ParseIndex(vecCommandArguments[2], 1, `${g_strCommandName} pvs net <player>`);
		if (unIndex === null) {
			return;
		}

		LogResult("engines/server.GetPlayerNetworkChannelInformation", () => GetPlayerNetworkChannelInformation(unIndex));
		LogResult("engines/server.GetPlayerInformation", () => GetPlayerInformation(unIndex));
		LogResult("engines/server.GetClientSteamID", () => GetClientSteamID(unIndex));
		LogResult("engines/server.GetEntityTransmitBitsForClient", () => GetEntityTransmitBitsForClient(unIndex));
		LogResult("engines/server.GetPreviousCheckTransmitInformation", () => GetPreviousCheckTransmitInformation(unIndex));
		return;
	}

	if (strAction === "message") {
		if ((vecCommandArguments.length < 2) || (vecCommandArguments.length > 3)) {
			LogWarning(`Use "${g_strCommandName} pvs message [name]".`);
			return;
		}

		LogResult("engines/server.GetTextMessage", () => GetTextMessage(vecCommandArguments[2] || "Game_connected"));
		return;
	}

	if (strAction === "entity") {
		if ((vecCommandArguments.length !== 4) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} pvs entity <index> confirm".`);
			return;
		}

		const unIndex = ParseIndex(vecCommandArguments[2], 0, `${g_strCommandName} pvs entity <index> confirm`);
		if (unIndex === null) {
			return;
		}

		const PVSInformation = BuildEntityClusterList(unIndex);
		if ((PVSInformation === null) || (PVSInformation === undefined)) {
			LogResult("engines/server.BuildEntityClusterList", () => PVSInformation);
			return;
		}

		// Finish with borrowed entity storage before logging can reenter the plugin or engine.
		const bCleaned = CleanUpEntityClusterList(PVSInformation.Address);
		LogResult("engines/server.BuildEntityClusterList", () => PVSInformation);
		LogResult("engines/server.CleanUpEntityClusterList", () => bCleaned);
		return;
	}

	if (strAction === "accumulate") {
		if ((vecCommandArguments.length !== 6) || (vecCommandArguments[5] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} pvs accumulate <x> <y> <z> confirm".`);
			return;
		}

		const Origin = ParseVectorArgument(vecCommandArguments, 2);
		if (Origin === null) {
			LogWarning("PVS accumulation requires finite x/y/z coordinates.");
			return;
		}

		LogResult("engines/server.ResetPVS", () => ResetPVS());
		LogResult("engines/server.AddOriginToPVS", () => AddOriginToPVS(Origin));
		return;
	}

	if (strAction === "portal") {
		const nPortalNumber = Number(vecCommandArguments[2]);
		const bOpen = vecCommandArguments[3] === "open";
		if ((vecCommandArguments.length !== 5) || (vecCommandArguments[2].trim().length === 0) || !IsInt32(nPortalNumber) || !["open", "closed"].includes(vecCommandArguments[3]) || (vecCommandArguments[4] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} pvs portal <number> <open|closed> confirm".`);
			return;
		}

		LogResult("engines/server.SetAreaPortalState", () => SetAreaPortalState(nPortalNumber, bOpen));
		return;
	}

	if (strAction === "portals") {
		const strPortalNumberText = String(vecCommandArguments[2] || "");
		const strPortalStateText = String(vecCommandArguments[3] || "");
		const vecPortalNumberValues = strPortalNumberText.split(",");
		const vecPortalStates = strPortalStateText.split(",");
		const vecPortalNumbers = [];
		const vecOpenStates = [];

		let bValidNumbers = true;
		for (const strPortalNumberValue of vecPortalNumberValues) {
			const nPortalNumber = Number(strPortalNumberValue);
			if ((strPortalNumberValue.trim().length === 0) || !IsInt32(nPortalNumber)) {
				bValidNumbers = false;
				break;
			}

			vecPortalNumbers.push(nPortalNumber);
		}

		let bValidStates = true;
		for (const strPortalState of vecPortalStates) {
			if ((strPortalState !== "open") && (strPortalState !== "closed")) {
				bValidStates = false;
				break;
			}

			vecOpenStates.push(strPortalState === "open");
		}

		const bMatchingLengths = vecPortalNumbers.length === vecOpenStates.length;
		const bConfirmed = vecCommandArguments[4] === "confirm";
		const bHasPortalNumbers = Boolean(strPortalNumberText);
		const bHasPortalStates = Boolean(strPortalStateText);
		const bValidInput = bHasPortalNumbers && bHasPortalStates && bValidNumbers && bValidStates && bMatchingLengths && bConfirmed && (vecCommandArguments.length === 5);

		if (!bValidInput) {
			LogWarning(`Use "${g_strCommandName} pvs portals <number,...> <open|closed,...> confirm".`);
			return;
		}

		LogResult("engines/server.SetAreaPortalStates", () => SetAreaPortalStates(vecPortalNumbers, vecOpenStates));
		return;
	}

	if ((strAction !== "inspect") || ![1, 2, 5, 6, 7].includes(vecCommandArguments.length)) {
		LogWarning(`Use "${g_strCommandName} pvs inspect [<x> <y> <z> [portalKey] [headNode]]".`);
		return;
	}

	const Origin = (vecCommandArguments.length >= 5) ? ParseVectorArgument(vecCommandArguments, 2) : new Vector();
	const nPortalKey = (vecCommandArguments.length >= 6) ? Number(vecCommandArguments[5]) : null;
	const nHeadNode = (vecCommandArguments.length >= 7) ? Number(vecCommandArguments[6]) : null;
	if ((Origin === null) || ((nPortalKey !== null) && ((vecCommandArguments[5].trim().length === 0) || !IsInt32(nPortalKey))) || ((nHeadNode !== null) && ((vecCommandArguments[6].trim().length === 0) || !IsInt32(nHeadNode)))) {
		LogWarning(`Use "${g_strCommandName} pvs inspect <x> <y> <z> [portalKey] [headNode]".`);
		return;
	}

	const nCluster = LogResult("engines/server.GetClusterForOrigin", () => GetClusterForOrigin(Origin));
	if (!Number.isInteger(nCluster) || (nCluster < 0)) {
		return;
	}

	const Result = LogResult("engines/server.GetPVSForCluster", () => GetPVSForCluster(nCluster));
	if (!Result) {
		return;
	}

	const flPVSHalfExtent = 16;
	const Minimums = new Vector(Origin.X - flPVSHalfExtent, Origin.Y - flPVSHalfExtent, Origin.Z - flPVSHalfExtent);
	const Maximums = new Vector(Origin.X + flPVSHalfExtent, Origin.Y + flPVSHalfExtent, Origin.Z + flPVSHalfExtent);

	LogResult("engines/server.CheckOriginInPVS", () => CheckOriginInPVS(Origin, Result.Bytes));
	LogResult("engines/server.CheckBoxInPVS", () => CheckBoxInPVS(Minimums, Maximums, Result.Bytes));
	LogResult("engines/server.GetMulticastRecipients", () => GetMulticastRecipients(false, Origin));

	const nArea = LogResult("engines/server.GetAreaForOrigin", () => GetAreaForOrigin(Origin));
	if (Number.isInteger(nArea) && (nArea >= 0)) {
		LogResult("engines/server.GetAreaBits", () => GetAreaBits(nArea));
		LogResult("engines/server.AreAreasConnected", () => AreAreasConnected(nArea, nArea));
	}

	if (nPortalKey !== null) {
		LogResult("engines/server.GetAreaPortalPlane", () => GetAreaPortalPlane(Origin, nPortalKey));
	}

	if (nHeadNode !== null) {
		LogResult("engines/server.IsHeadNodeVisible", () => IsHeadNodeVisible(nHeadNode, Result.Bytes));
	}
}

function AreBoundsOrdered(Minimums, Maximums) {
	return (Minimums !== null) && (Maximums !== null) && (Minimums.X <= Maximums.X) && (Minimums.Y <= Maximums.Y) && (Minimums.Z <= Maximums.Z);
}

function ParseHitboxArguments(vecCommandArguments) {
	if ((vecCommandArguments.length !== 12) || (vecCommandArguments[11] !== "confirm") || !vecCommandArguments[3].trim() || !vecCommandArguments[4].trim()) {
		return null;
	}

	const nHitboxIndex = Number(vecCommandArguments[3]);
	const nHitboxSetIndex = Number(vecCommandArguments[4]);
	const Minimums = ParseVectorArgument(vecCommandArguments, 5);
	const Maximums = ParseVectorArgument(vecCommandArguments, 8);
	if (!IsInt32(nHitboxIndex) || (nHitboxIndex < 0) || !IsInt32(nHitboxSetIndex) || (nHitboxSetIndex < 0) || !AreBoundsOrdered(Minimums, Maximums)) {
		return null;
	}

	return { HitboxIndex: nHitboxIndex, HitboxSetIndex: nHitboxSetIndex, Minimums, Maximums };
}

function LogHitboxUsage() {
	LogWarning(`Use "${g_strCommandName} <entity|player> <index> hitbox <hitbox> <hitboxSet> <minX> <minY> <minZ> <maxX> <maxY> <maxZ> confirm".`);
}

function UpdateHitbox(Owner, HitboxArguments) {
	if (HitboxArguments === null) {
		LogHitboxUsage();
		return;
	}

	const Hitbox = Owner.GetEntityHitbox(HitboxArguments.HitboxIndex, HitboxArguments.HitboxSetIndex);
	if (Hitbox === null) {
		LogWarning("The selected model does not contain that hitbox or hitbox set.");
		return;
	}

	// The view borrows retained model-cache storage; finish its use before logging or other entity work.
	Hitbox.Mins.X = HitboxArguments.Minimums.X;
	Hitbox.Mins.Y = HitboxArguments.Minimums.Y;
	Hitbox.Mins.Z = HitboxArguments.Minimums.Z;
	Hitbox.Maxs.X = HitboxArguments.Maximums.X;
	Hitbox.Maxs.Y = HitboxArguments.Maximums.Y;
	Hitbox.Maxs.Z = HitboxArguments.Maximums.Z;

	LogResult("studio live hitbox", () => ({
		Address: Hitbox.Address,
		Maximums: [Hitbox.Maxs.X, Hitbox.Maxs.Y, Hitbox.Maxs.Z],
		Minimums: [Hitbox.Mins.X, Hitbox.Mins.Y, Hitbox.Mins.Z],
	}));
}

function RunPlayerAction(vecCommandArguments) {
	const strUsage = `${g_strCommandName} player <index> <say|sayTeam|clientCommand|engineCommand|print|keyValues|hitbox|slay|kick|ban|team>`;
	const unIndex = ParseIndex(vecCommandArguments[1], 1, strUsage);
	if (unIndex === null) {
		return;
	}

	const strAction = vecCommandArguments[2];
	if (!["say", "sayTeam", "clientCommand", "engineCommand", "print", "keyValues", "hitbox", "slay", "kick", "ban", "team"].includes(strAction)) {
		LogWarning(`Use "${strUsage}".`);
		return;
	}

	const bSimpleAction = ["slay", "kick"].includes(strAction);
	const bNumericAction = ["ban", "team"].includes(strAction);
	if ((bSimpleAction && ((vecCommandArguments.length !== 4) || (vecCommandArguments[3] !== "confirm"))) || (bNumericAction && ((vecCommandArguments.length !== 5) || (vecCommandArguments[4] !== "confirm")))) {
		LogWarning(`Use "${g_strCommandName} player ${unIndex} ${strAction}${bNumericAction ? " <number>" : ""} confirm".`);
		return;
	}

	if ((strAction === "keyValues") && ((vecCommandArguments.length < 4) || (vecCommandArguments[vecCommandArguments.length - 1] !== "confirm"))) {
		LogWarning(`Use "${g_strCommandName} player ${unIndex} keyValues [message] confirm".`);
		return;
	}

	const HitboxArguments = (strAction === "hitbox") ? ParseHitboxArguments(vecCommandArguments) : undefined;
	if ((strAction === "hitbox") && (HitboxArguments === null)) {
		LogHitboxUsage();
		return;
	}

	const unActionValue = bNumericAction ? ParseIndex(vecCommandArguments[3], 0, `${g_strCommandName} player ${unIndex} ${strAction} <number> confirm`) : null;
	if (bNumericAction && (unActionValue === null)) {
		return;
	}

	const PlayerInstance = new Player(unIndex);
	if (!PlayerInstance.IsConnected()) {
		LogWarning(`Player ${unIndex} is not connected.`);
		return;
	}

	if (strAction === "say") {
		PlayerInstance.Say(vecCommandArguments.slice(3).join(" ") || "SourceJS Player.Say example");
		return;
	}

	if (strAction === "sayTeam") {
		PlayerInstance.SayTeam(vecCommandArguments.slice(3).join(" ") || "SourceJS Player.SayTeam example");
		return;
	}

	if (strAction === "clientCommand") {
		PlayerInstance.ExecuteClientCommand(vecCommandArguments.slice(3).join(" ") || "echo SourceJS Player.ExecuteClientCommand example", true);
		return;
	}

	if (strAction === "engineCommand") {
		const strCommand = vecCommandArguments.slice(3).join(" ") || "echo SourceJS IVEngineServer::ClientCommand example";
		LogResult("engines/server.ExecuteClientCommand", () => ExecuteClientCommand(unIndex, strCommand, true));
		return;
	}

	if (strAction === "print") {
		const strMessage = vecCommandArguments.slice(3).join(" ") || "SourceJS IVEngineServer::ClientPrintf example";
		LogResult("engines/server.PrintToClientConsole", () => PrintToClientConsole(unIndex, `${strMessage}\n`));
		return;
	}

	if (strAction === "keyValues") {
		if (typeof ExecuteClientCommandKeyValues !== "function") {
			LogWarning("ExecuteClientCommandKeyValues is unavailable in the selected SDK.");
			return;
		}

		const CommandValues = new KeyValues("SourceJSExample", { Message: vecCommandArguments.slice(3, -1).join(" ") || "SourceJS ExecuteClientCommandKeyValues example" });
		UseCleanup("client command KeyValues", () => {
			LogResult("engines/server.ExecuteClientCommandKeyValues", () => ExecuteClientCommandKeyValues(unIndex, CommandValues));
		}, () => {
			// Before transfer this frees the owned tree; afterward the missing native handle returns false safely.
			CommandValues.DestroyKeyValues();
		});
		return;
	}

	if (strAction === "hitbox") {
		UpdateHitbox(PlayerInstance, HitboxArguments);
		return;
	}

	if (strAction === "slay") {
		PlayerInstance.Slay();
		return;
	}

	if (strAction === "kick") {
		PlayerInstance.Kick("SourceJS api-world-objects example");
		return;
	}

	if (strAction === "ban") {
		PlayerInstance.Ban(unActionValue, true, false);
		return;
	}

	if (strAction === "team") {
		PlayerInstance.ChangeTeam(unActionValue);
	}
}

function RunSoundAction(vecCommandArguments) {
	const nSoundLevel = 75;
	const flDelay = 0;
	const Origin = ParseVectorArgument(vecCommandArguments, 1);
	const strSample = vecCommandArguments[4];
	if ((vecCommandArguments.length !== 6) || (Origin === null) || !strSample || (vecCommandArguments[5] !== "confirm")) {
		LogWarning(`Use "${g_strCommandName} sound <x> <y> <z> <sample> confirm".`);
		return;
	}

	LogResult("engines/server.EmitAmbientSound", () => EmitAmbientSound(SOUND_FROM_WORLD, Origin, strSample, VOL_NORM, nSoundLevel, SoundFlags.NO_FLAGS, Pitch.NORMAL, flDelay));
}

function RunTransitionAction(vecCommandArguments) {
	if ((vecCommandArguments.length === 4) && (vecCommandArguments[1] === "load") && vecCommandArguments[2] && (vecCommandArguments[3] === "confirm")) {
		LogResult("engines/server.LoadGameState", () => LoadGameState(vecCommandArguments[2], true));
		return;
	}

	if ((vecCommandArguments.length === 5) && (vecCommandArguments[1] === "adjacent") && vecCommandArguments[2] && vecCommandArguments[3] && (vecCommandArguments[4] === "confirm")) {
		LogResult("engines/server.LoadAdjacentEntities", () => LoadAdjacentEntities(vecCommandArguments[2], vecCommandArguments[3]));
		return;
	}

	LogWarning(`Use "${g_strCommandName} transition <load map|adjacent oldLevel landmark> confirm".`);
}

function RunPartitionAction(vecCommandArguments) {
	if ((vecCommandArguments.length !== 8) || (vecCommandArguments[7] !== "confirm")) {
		LogWarning(`Use "${g_strCommandName} partition <minX> <minY> <minZ> <maxX> <maxY> <maxZ> confirm".`);
		return;
	}

	const WorldMinimum = ParseVectorArgument(vecCommandArguments, 1);
	const WorldMaximum = ParseVectorArgument(vecCommandArguments, 4);
	if (!AreBoundsOrdered(WorldMinimum, WorldMaximum)) {
		LogWarning("Spatial partition bounds must be finite ordered vectors.");
		return;
	}

	const SpatialPartition = CreateSpatialPartition(WorldMinimum, WorldMaximum);
	if (SpatialPartition === null) {
		LogWarning("Unable to create the example spatial partition.");
		return;
	}

	// Release before logging can reenter; do not retry an unknown native destruction outcome.
	const bDestroyed = DestroySpatialPartition(SpatialPartition.Address);
	if (!bDestroyed) {
		throw new Error("Unable to destroy the example spatial partition.");
	}

	LogResult("engines/server.CreateSpatialPartition", () => SpatialPartition);
	LogResult("engines/server.DestroySpatialPartition", () => bDestroyed);
}

function RunMovedAction(vecCommandArguments) {
	const unIndex = ParseIndex(vecCommandArguments[1], 0, `${g_strCommandName} moved <entity> <solid|trigger> confirm`);
	if (unIndex === null) {
		return;
	}

	const strMovementKind = vecCommandArguments[2];
	if ((vecCommandArguments.length !== 4) || !["solid", "trigger"].includes(strMovementKind) || (vecCommandArguments[3] !== "confirm")) {
		LogWarning(`Use "${g_strCommandName} moved <entity> <solid|trigger> confirm".`);
		return;
	}

	if (strMovementKind === "solid") {
		LogResult("engines/server.NotifySolidMoved", () => NotifySolidMoved(unIndex));
	} else {
		LogResult("engines/server.NotifyTriggerMoved", () => NotifyTriggerMoved(unIndex));
	}

	LogResult("engines/server.NotifyEdictFlagsChange", () => NotifyEdictFlagsChange(unIndex));
	LogResult("engines/server.GetEntityChangeAccessor", () => GetEntityChangeAccessor(unIndex));
	LogResult("engines/server.GetSharedEdictChangeInformation", () => GetSharedEdictChangeInformation());
}

function RunDebugAction(vecCommandArguments) {
	const nConsoleLineIndex = 2;
	const strMessage = vecCommandArguments.slice(2).join(" ") || "SourceJS IVEngineServer debug print";

	if (vecCommandArguments[1] === "nprint") {
		LogResult("engines/server.PrintDeveloperOverlayLine", () => PrintDeveloperOverlayLine(nConsoleLineIndex, strMessage));
	} else if (vecCommandArguments[1] === "nxprint") {
		LogResult("engines/server.PrintDeveloperOverlayLineExtended", () => PrintDeveloperOverlayLineExtended({
			Color: new Vector(0.2, 1, 0.4),
			FixedWidthFont: true,
			Index: nConsoleLineIndex,
			TimeToLive: 3,
		}, strMessage));
	} else {
		LogWarning(`Use "${g_strCommandName} debug <nprint|nxprint> [message]".`);
	}
}

function RunRawAction(vecCommandArguments) {
	if ((vecCommandArguments.length === 5) && (vecCommandArguments[1] === "scratch") && vecCommandArguments[2] && vecCommandArguments[3] && (vecCommandArguments[4] === "confirm")) {
		const unMaximumDrawFlags = 0xFFFFFFFF;
		const strUsage = `${g_strCommandName} raw scratch <address> <flags> confirm`;
		let unAddress = 0n;
		try {
			unAddress = BigInt(vecCommandArguments[2]);
		} catch {
			LogWarning(`Use "${strUsage}".`);
			return;
		}

		const nFlags = Number(vecCommandArguments[3]);
		if ((unAddress <= 0n) || !vecCommandArguments[3].trim() || !Number.isInteger(nFlags) || (nFlags < 0) || (nFlags > unMaximumDrawFlags)) {
			LogWarning(`Use "${strUsage}".`);
			return;
		}

		LogResult("engines/server.DrawSpatialPartitionMapToScratchPad", () => DrawSpatialPartitionMapToScratchPad(unAddress, nFlags));
		return;
	}

	if ((vecCommandArguments.length === 4) && (vecCommandArguments[1] === "temp") && vecCommandArguments[2] && (vecCommandArguments[3] === "confirm")) {
		const strTemporaryEntityName = String(vecCommandArguments[2]);
		LogResult("engines/server.PlayTemporaryEntity", () => PlayTemporaryEntity(strTemporaryEntityName, {}, null, 0, false));
		return;
	}

	LogWarning(`Use "${g_strCommandName} raw <scratch address flags|temp name> confirm".`);
}

function RunBranchAction(vecCommandArguments) {
	if ((vecCommandArguments[1] ?? "inspect") === "inspect") {
		if (![1, 2, 3].includes(vecCommandArguments.length)) {
			LogWarning(`Use "${g_strCommandName} branch inspect [client]".`);
			return;
		}

		const nClientIndex = Number(vecCommandArguments[2] || 1);
		if (!IsInt32(nClientIndex) || (nClientIndex < 1) || ((vecCommandArguments.length === 3) && !vecCommandArguments[2].trim())) {
			LogWarning(`Use "${g_strCommandName} branch inspect <client>".`);
			return;
		}

		LogResult("engines/server.GetGameServerSteamID", () => GetGameServerSteamID());
		LogResult("engines/server.GetServerVersion", () => GetServerVersion());
		LogResult("engines/server.GetLaunchOptions", () => GetLaunchOptions());
		LogResult("engines/server.IsEngineLogEnabled", () => IsEngineLogEnabled());
		LogResult("engines/server.GetTimescale", () => GetTimescale());
		LogResult("engines/server.IsLevelMainMenuBackground", () => IsLevelMainMenuBackground());
		LogResult("engines/server.IsAnyClientLowViolence", () => IsAnyClientLowViolence());
		LogResult("engines/server.IsOverrideLoadGameEntitiesEnabled", () => IsOverrideLoadGameEntitiesEnabled());
		LogResult("engines/server.IsCreatingResourceList", () => IsCreatingResourceList());
		LogResult("engines/server.IsCreatingXboxResourceList", () => IsCreatingXboxResourceList());
		LogResult("engines/server.IsDedicatedServerForXbox", () => IsDedicatedServerForXbox());
		LogResult("engines/server.IsDedicatedServerForPS3", () => IsDedicatedServerForPS3());
		LogResult("engines/server.GetAchievementManager", () => GetAchievementManager());
		LogResult("engines/server.IsApplicationActive", () => IsApplicationActive());
		LogResult("engines/server.GetChoreographySoundLatency", () => GetChoreographySoundLatency());

		const bPaintMapAvailable = LogResult("engines/server.HasPaintMap", () => HasPaintMap());
		if (bPaintMapAvailable) {
			LogResult("engines/server.GetPaintMapDataRLE", () => GetPaintMapDataRLE());
		}

		const PlayerInformation = LogResult("engines/server.GetPlayerInformation", () => GetPlayerInformation(nClientIndex));
		if (PlayerInformation === null) {
			LogWarning(`Client ${nClientIndex} is not connected.`);
			return;
		}

		const nUserID = PlayerInformation.UserID;
		LogResult("engines/server.IsUserIDInUse", () => IsUserIDInUse(nUserID));
		LogResult("engines/server.GetUserLoadingProgress", () => GetUserLoadingProgress(nUserID));
		LogResult("engines/server.IsSplitScreenPlayer", () => IsSplitScreenPlayer(nClientIndex));
		LogResult("engines/server.GetSplitScreenPlayerAttachment", () => GetSplitScreenPlayerAttachment(nClientIndex));
		LogResult("engines/server.GetAttachedSplitScreenUserCount", () => GetAttachedSplitScreenUserCount(nClientIndex));
		LogResult("engines/server.GetClientXUID", () => GetClientXUID(nClientIndex));
		LogResult("engines/server.GetClientCrossPlayPlatform", () => GetClientCrossPlayPlatform(nClientIndex));
		return;
	}

	if ((vecCommandArguments.length === 3) && (vecCommandArguments[1] === "end") && (vecCommandArguments[2] === "confirm")) {
		LogResult("engines/server.EndMultiplayerGame", () => EndMultiplayerGame());
		return;
	}

	if ((vecCommandArguments.length === 4) && (vecCommandArguments[1] === "bot") && vecCommandArguments[2] && (vecCommandArguments[3] === "confirm")) {
		LogResult("engines/server.CreateFakeClientWithOptions", () => CreateFakeClientWithOptions(vecCommandArguments[2], true));
		return;
	}

	if (vecCommandArguments[1] === "timescale") {
		const flTimescale = Number(vecCommandArguments[2]);
		if ((vecCommandArguments.length !== 4) || !vecCommandArguments[2].trim() || !Number.isFinite(Math.fround(flTimescale)) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch timescale <value> confirm".`);
			return;
		}

		LogResult("engines/server.SetTimescale", () => SetTimescale(flTimescale));
		return;
	}

	if (vecCommandArguments[1] === "pause") {
		const strState = vecCommandArguments[2];
		if ((vecCommandArguments.length !== 4) || !["on", "off"].includes(strState) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch pause <on|off> confirm".`);
			return;
		}

		LogResult("engines/server.SetPaused", () => SetPaused(strState === "on", true));
		return;
	}

	if (vecCommandArguments[1] === "hibernate") {
		const strState = vecCommandArguments[2];
		if ((vecCommandArguments.length !== 4) || !["on", "off"].includes(strState) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch hibernate <on|off> confirm".`);
			return;
		}

		LogResult("engines/server.SetServerHibernation", () => SetServerHibernation(strState === "on"));
		return;
	}

	if (vecCommandArguments[1] === "flush") {
		const nEntityIndex = Number(vecCommandArguments[2]);
		if ((vecCommandArguments.length !== 4) || !vecCommandArguments[2].trim() || !IsInt32(nEntityIndex) || (nEntityIndex < 0) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch flush <entity> confirm".`);
			return;
		}

		LogResult("engines/server.ForceFlushEntity", () => ForceFlushEntity(nEntityIndex));
		return;
	}

	if (vecCommandArguments[1] === "shared") {
		const strSpaceName = vecCommandArguments[2];
		const nEntityIndex = (vecCommandArguments[3] === undefined) ? undefined : Number(vecCommandArguments[3]);
		if (![3, 4].includes(vecCommandArguments.length) || !strSpaceName || ((nEntityIndex !== undefined) && (!vecCommandArguments[3].trim() || !IsInt32(nEntityIndex) || (nEntityIndex < 0)))) {
			LogWarning(`Use "${g_strCommandName} branch shared <name> [entity]".`);
			return;
		}

		LogResult("engines/server.GetSinglePlayerSharedMemorySpace", () => GetSinglePlayerSharedMemorySpace(strSpaceName, nEntityIndex));
		return;
	}

	if (vecCommandArguments[1] === "session") {
		if ((vecCommandArguments.length !== 3) || (vecCommandArguments[2] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch session confirm".`);
			return;
		}

		LogResult("engines/server.ValidateHostSession", () => ValidateHostSession());
		LogResult("engines/server.RefreshScreenIfNecessary", () => RefreshScreenIfNecessary());
		return;
	}

	if (vecCommandArguments[1] === "paint") {
		const unMaximumPaintColor = 0xFF;
		const nColor = Number(vecCommandArguments[2]);
		if ((vecCommandArguments.length !== 4) || !vecCommandArguments[2].trim() || !Number.isInteger(nColor) || (nColor < 0) || (nColor > unMaximumPaintColor) || (vecCommandArguments[3] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch paint <color> confirm".`);
			return;
		}

		LogResult("engines/server.PaintAllSurfaces", () => PaintAllSurfaces(nColor));
		return;
	}

	if (vecCommandArguments[1] === "removePaint") {
		if ((vecCommandArguments.length !== 3) || (vecCommandArguments[2] !== "confirm")) {
			LogWarning(`Use "${g_strCommandName} branch removePaint confirm".`);
			return;
		}

		LogResult("engines/server.RemoveAllPaint", () => RemoveAllPaint());
		return;
	}

	LogWarning(`Use "${g_strCommandName} branch <inspect|end|bot|timescale|pause|hibernate|flush|shared|session|paint|removePaint>".`);
}

function RunEntityAction(vecCommandArguments) {
	const unIndex = ParseIndex(vecCommandArguments[1], 0, `${g_strCommandName} entity <index> <input|hitbox|remove>`);
	if (unIndex === null) {
		return;
	}

	const strAction = vecCommandArguments[2];
	if (!["input", "hitbox", "remove"].includes(strAction)) {
		LogWarning(`Use "${g_strCommandName} entity ${unIndex} <input|hitbox|remove>".`);
		return;
	}

	const HitboxArguments = (strAction === "hitbox") ? ParseHitboxArguments(vecCommandArguments) : undefined;
	if ((strAction === "hitbox") && (HitboxArguments === null)) {
		LogHitboxUsage();
		return;
	}

	if ((strAction === "remove") && ((vecCommandArguments.length !== 4) || (vecCommandArguments[3] !== "confirm"))) {
		LogWarning(`Use "${g_strCommandName} entity ${unIndex} remove confirm".`);
		return;
	}

	let flDelay = 0;
	if (strAction === "input") {
		const strUsage = `Use "${g_strCommandName} entity ${unIndex} input <name> <value> <delay> confirm".`;
		if ((vecCommandArguments.length !== 7) || !vecCommandArguments[3].trim() || !vecCommandArguments[5].trim() || (vecCommandArguments[6] !== "confirm")) {
			LogWarning(strUsage);
			return;
		}

		flDelay = Number(vecCommandArguments[5]);
		if (!Number.isFinite(Math.fround(flDelay)) || (flDelay < 0)) {
			LogWarning(strUsage);
			return;
		}
	}

	const EntityInstance = Entity(unIndex);
	if ((EntityInstance === null) || !EntityInstance.Valid) {
		LogWarning(`Entity ${unIndex} was not found.`);
		return;
	}

	if (strAction === "input") {
		EntityInstance.CallEntityInput(vecCommandArguments[3], vecCommandArguments[4], flDelay);
		return;
	}

	if (strAction === "hitbox") {
		UpdateHitbox(EntityInstance, HitboxArguments);
		return;
	}

	if (strAction === "remove") {
		EntityInstance.RemoveEntity();
		return;
	}
}

function RunWorldExample(Command) {
	if (g_bUnloading) {
		return;
	}

	const vecCommandArguments = GetCommandArguments(Command);

	if (g_bUnloading) {
		return;
	}

	if (vecCommandArguments[0] === "pvs") {
		RunPVSAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "player") {
		RunPlayerAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "entity") {
		RunEntityAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "sound") {
		RunSoundAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "transition") {
		RunTransitionAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "partition") {
		RunPartitionAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "moved") {
		RunMovedAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "debug") {
		RunDebugAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "raw") {
		RunRawAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "branch") {
		RunBranchAction(vecCommandArguments);
		return;
	}

	if (vecCommandArguments[0] === "inspect") {
		if (vecCommandArguments.length !== 1) {
			LogWarning(`Use "${g_strCommandName} inspect".`);
			return;
		}

		InspectWorld();
		return;
	}

	LogInfo(`Use "${g_strCommandName} pvs inspect <x> <y> <z>".`);
	LogInfo(`Use "${g_strCommandName} player <index> print <text>".`);
	LogInfo(`Use "${g_strCommandName} sound <x> <y> <z> <sample> confirm".`);
	LogInfo(`Use "${g_strCommandName} entity <index> input <name> <value> <delay> confirm".`);
	LogInfo(`Use "${g_strCommandName} inspect" after a map has loaded; inspection temporarily changes physics settings and then restores them.`);
}

function Cleanup() {
	g_bUnloading = true;

	if (g_bCleanupInProgress) {
		// The active invocation owns completion; a nested call must not repeat any release.
		return false;
	}

	g_bCleanupInProgress = true;
	try {
		const vecCleanupErrors = [];
		try {
			if (g_bCommandRegistered) {
				if (!UnregisterCommand(g_strCommandName, RunWorldExample)) {
					throw new Error(`Unable to unregister the ${g_strCommandName} command.`);
				}

				g_bCommandRegistered = false;
			}
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		try {
			if (g_PluginUnloadingRegistration) {
				if (!g_PluginUnloadingRegistration.DisposeListener()) {
					throw new Error("Unable to dispose the example plugin-unloading listener.");
				}

				g_PluginUnloadingRegistration = null;
			}
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		if (vecCleanupErrors.length > 0) {
			throw new AggregateError(vecCleanupErrors, "World example cleanup failed.");
		}

		return true;
	} finally {
		g_bCleanupInProgress = false;
	}
}

function HandlePluginUnloading(strUnloadingPluginName) {
	if (strUnloadingPluginName === g_strPluginName) {
		Cleanup();
	}
}

function Initialize() {
	if (!RegisterCommand(g_strCommandName, RunWorldExample)) {
		throw new Error(`Unable to register the ${g_strCommandName} command.`);
	}

	g_bCommandRegistered = true;

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	g_PluginUnloadingRegistration = RegisterPluginUnloadingListener(HandlePluginUnloading);
	if (!g_PluginUnloadingRegistration) {
		throw new Error("Unable to register the plugin-unloading listener.");
	}

	if (g_bUnloading) {
		Cleanup();
		return;
	}

	LogInfo(`World example loaded; run "${g_strCommandName}".`);
}

exports.Unload = Cleanup;

try {
	Initialize();
} catch (ErrorValue) {
	try {
		Cleanup();
	} catch (CleanupError) {
		throw new AggregateError([ErrorValue, CleanupError], "World example registration and rollback failed.");
	}

	throw ErrorValue;
}
