#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPlayersConstantsPath = g_Path.join(g_strPackageRootPath, "players", "constants.js");
const g_strPlayersConstantsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-constants.md");

const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unDocumentationCodeBlockCount = 9;
const g_unGrenadeButtonMask = 0x00800000;
const g_nInt32Minimum = -0x80000000;
const g_unInt32UpperBound = 0x80000000;
const g_unUint32UpperBound = 0x100000000;
const g_DocumentationBlockIndexes = {
	Import: 0,
	LiveRange: 1,
	ButtonTransitions: 2,
	InputMask: 3,
	HUDFlags: 4,
	HitGroups: 5,
	EnumNames: 6,
	CommandMetadata: 7,
	Capabilities: 8,
};

// Bounds synchronous JavaScript only; this is not a security sandbox or native-IO cancellation.
function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, vecArguments)", { filename: `${g_strPlayersConstantsDocumentationPath}:${strLabel}` });

	return Script.runInNewContext({ Callback, Receiver, vecArguments, Reflect }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RestorePlayersConstantsProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		if (!Reflect.deleteProperty(Owner, strName)) {
			throw new Error(`Players-constants fixture could not delete temporary property ${strName}.`);
		}

		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

const g_NativeConstants = {
	ABSOLUTE_PLAYER_LIMIT: 64,
	FIRST_PLAYER_INDEX: 1,
	FixAngle: { Absolute: 1, None: 0, Relative: 2 },
	HideHUDFlags: { Chat: 0x80, Crosshair: 0x100 },
	HitGroup: { Generic: 0, Head: 1 },
	IN_ATTACK: 0x01,
	INVALID_PLAYER_INDEX: -1,
	INVALID_PLAYER_USERID: -1,
	LIFE_ALIVE: 0,
	LifeState: { Alive: 0, Dead: 2 },
	MAX_EDICTS: 2048,
	ObserverMode: { Chase: 5, None: 0 },
	PlayerAnimation: { Reload: 7 },
	PlayerButtons: { Attack: 0x01, Grenade1: g_unGrenadeButtonMask, Jump: 0x02, Use: 0x20 },
	PlayerStates: { OnGround: 0x01 },
	WORLD_INDEX: 0,

	GetClientCount() {
		return 4;
	},

	GetMaximumClients() {
		return 32;
	},
};

const g_vecEventCalls = [];
const g_vecListenerCalls = [];
const g_vecDocumentationModules = [];
const g_mapActiveButtonListeners = new Map();
const g_mapActiveEventListeners = new Map();

function UnregisterEventListener(strEventName, Callback) {
	const setCallbacks = g_mapActiveEventListeners.get(strEventName);
	if (setCallbacks !== undefined) {
		setCallbacks.delete(Callback);

		if (setCallbacks.size === 0) {
			g_mapActiveEventListeners.delete(strEventName);
		}
	}

	g_vecEventCalls.push(["UnregisterEventListener", strEventName, Callback]);

	return true;
}

function GetActiveDocumentationListenerCount() {
	let unCount = g_mapActiveButtonListeners.size;
	for (const setCallbacks of g_mapActiveEventListeners.values()) {
		unCount += setCallbacks.size;
	}

	return unCount;
}

function ReleaseActiveDocumentationListeners() {
	const vecCleanupErrors = [];
	for (const [Subscription, Dispose] of [...g_mapActiveButtonListeners]) {
		try {
			RunDocumentationFunction(Dispose, Subscription, [], "Fixture:DisposeListener");
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}
	}

	for (const [strEventName, setCallbacks] of [...g_mapActiveEventListeners]) {
		for (const Callback of [...setCallbacks]) {
			try {
				UnregisterEventListener(strEventName, Callback);
			} catch (ErrorValue) {
				vecCleanupErrors.push(ErrorValue);
			}
		}

		if ((setCallbacks.size === 0) && (g_mapActiveEventListeners.get(strEventName) === setCallbacks)) {
			g_mapActiveEventListeners.delete(strEventName);
		}
	}

	if (vecCleanupErrors.length === 1) {
		throw vecCleanupErrors[0];
	}

	if (vecCleanupErrors.length > 0) {
		throw new AggregateError(vecCleanupErrors, "Players-constants listener restoration failed.");
	}
}

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_ConstantsCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strPlayersConstantsPath);
const g_MarkerDescriptor = Object.getOwnPropertyDescriptor(g_NativeConstants, "Marker");

function LoadPlayersConstantsModule() {
	const OriginalModuleLoad = g_Module._load;
	Object.defineProperty(g_Module, "_load", {
		configurable: true,
		enumerable: g_ModuleLoadDescriptor?.enumerable ?? true,

		value: function LoadModule(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return {
					GetModule(strModuleName) {
						if (strModuleName === "players/constants") {
							return g_NativeConstants;
						}

						throw new Error(`unexpected native module ${strModuleName}`);
					},
				};
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		},

		writable: true,
	});

	const Constants = require(g_strPlayersConstantsPath);

	RestorePlayersConstantsProperty(g_Module, "_load", g_ModuleLoadDescriptor);

	return Constants;
}

let g_bExecutionFailed = false;
let g_Failure = null;

try {
	delete require.cache[g_strPlayersConstantsPath];

	const g_Constants = LoadPlayersConstantsModule();
	const g_vecDocumentedSDKNames = [
		"INVALID_PLAYER_INDEX",
		"INVALID_PLAYER_USERID",
		"WORLD_INDEX",
		"FIRST_PLAYER_INDEX",
		"ABSOLUTE_PLAYER_LIMIT",
		"MAX_EDICTS",
		"GetMaximumClients",
		"GetClientCount",
		"Attack",
		"Jump",
		"Duck",
		"Forward",
		"Back",
		"Use",
		"Cancel",
		"Left",
		"Right",
		"MoveLeft",
		"MoveRight",
		"Attack2",
		"Run",
		"Reload",
		"Alt1",
		"Alt2",
		"Score",
		"Speed",
		"Walk",
		"Zoom",
		"Weapon1",
		"Weapon2",
		"BullRush",
		"Grenade1",
		"Grenade2",
		"LookSpin",
		"IN_ATTACK",
		"IN_JUMP",
		"IN_DUCK",
		"IN_FORWARD",
		"IN_BACK",
		"IN_USE",
		"IN_CANCEL",
		"IN_LEFT",
		"IN_RIGHT",
		"IN_MOVELEFT",
		"IN_MOVERIGHT",
		"IN_ATTACK2",
		"IN_RUN",
		"IN_RELOAD",
		"IN_ALT1",
		"IN_ALT2",
		"IN_SCORE",
		"IN_SPEED",
		"IN_WALK",
		"IN_ZOOM",
		"IN_WEAPON1",
		"IN_WEAPON2",
		"IN_BULLRUSH",
		"IN_GRENADE1",
		"IN_GRENADE2",
		"IN_LOOKSPIN",
		"OnGround",
		"Ducking",
		"WaterJump",
		"OnTrain",
		"InRain",
		"Frozen",
		"AtControls",
		"Client",
		"FakeClient",
		"InWater",
		"WeaponSelection",
		"Flashlight",
		"All",
		"Health",
		"PlayerDead",
		"NeedSuit",
		"MiscStatus",
		"Chat",
		"Crosshair",
		"VehicleCrosshair",
		"InVehicle",
		"BonusProgress",
		"Radar",
		"Generic",
		"Head",
		"Chest",
		"Stomach",
		"LeftArm",
		"RightArm",
		"LeftLeg",
		"RightLeg",
		"Gear",
		"Alive",
		"Dying",
		"Dead",
		"Respawnable",
		"DiscardBody",
		"LIFE_ALIVE",
		"LIFE_DYING",
		"LIFE_DEAD",
		"LIFE_RESPAWNABLE",
		"LIFE_DISCARDBODY",
		"None",
		"DeathCam",
		"FreezeCam",
		"Fixed",
		"InEye",
		"Chase",
		"Roaming",
		"Absolute",
		"Relative",
		"Idle",
		"SuperJump",
		"Die",
		"Attack1",
		"StartAiming",
		"LeaveAiming",
	];

	const g_vecRequiredSections = [
		"Import",
		"Indexes and capacity",
		"Input buttons",
		"Player and HUD flags",
		"Hit groups",
		"Life and observer state",
		"Fix angles and animation",
		"Capability discovery",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	g_Assert.ok(g_Constants === g_NativeConstants, "players/constants must expose the exact native object.");
	g_Assert.equal(g_Constants.FixAngle.Absolute, 1, "FixAngle.Absolute");
	g_Assert.equal(g_Constants.HideHUDFlags.Chat, 0x80, "HideHUDFlags.Chat");
	g_Assert.equal(g_Constants.HitGroup.Head, 1, "HitGroup.Head");
	g_Assert.equal(g_Constants.LifeState.Alive, 0, "LifeState.Alive");
	g_Assert.equal(g_Constants.ObserverMode.Chase, 5, "ObserverMode.Chase");
	g_Assert.equal(g_Constants.PlayerAnimation.Reload, 7, "PlayerAnimation.Reload");
	g_Assert.equal(g_Constants.PlayerButtons.Attack, 0x01, "PlayerButtons.Attack");
	g_Assert.equal(g_Constants.PlayerStates.OnGround, 0x01, "PlayerStates.OnGround");
	g_Assert.equal(g_Constants.IN_ATTACK, 0x01, "standalone IN_ATTACK");
	g_Assert.equal(g_Constants.LIFE_ALIVE, 0, "standalone LIFE_ALIVE");
	g_Assert.equal(g_Constants.GetMaximumClients(), 32, "GetMaximumClients direct native call");
	g_Assert.equal(g_Constants.GetClientCount(), 4, "GetClientCount direct native call");
	g_Assert.ok(!Object.hasOwn(g_Constants.PlayerButtons, "LookSpin"), "undeclared SDK constants must be omitted.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "number"), "players/constants must not expose generic number lookup.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "object"), "players/constants must not expose generic object lookup.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "objectNumber"), "players/constants must not expose generic object-number lookup.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "buttons"), "players/constants must not expose lower-camel namespace aliases.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "lifeState"), "players/constants must not expose lower-camel namespace aliases.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "HideHudFlags"), "players/constants must preserve the HUD acronym.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "moduleName"), "players/constants must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_Constants, "default"), "players/constants must not expose a default alias.");

	// Negative legacy spellings above are intentional; this probe checks native-object identity.
	g_NativeConstants.Marker = "live";
	g_Assert.equal(g_Constants.Marker, "live", "native constants object remains live");

	function RunDocumentationConstantExample(vecCodeBlocks, unCodeBlockIndex, Constants) {
		const ModuleRecord = { exports: {} };
		const strLabel = `Contract-${unCodeBlockIndex + 1}`;
		const Callback = g_VM.compileFunction(vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strPlayersConstantsDocumentationPath}:${strLabel}` });
		RunDocumentationFunction(Callback, undefined, [(strModuleName) => {
			g_Assert.equal(strModuleName, "players/constants", "constant examples require only their selected constant record");

			return Constants;
		}, ModuleRecord, ModuleRecord.exports], strLabel);

		return ModuleRecord.exports;
	}

	function CheckDocumentationIntegerContracts(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);

		const CreateConstants = () => ({ ...g_NativeConstants });
		const Import = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Import, CreateConstants());
		g_Assert.equal(Import.Constants.INVALID_PLAYER_INDEX, -1, "import preserves the native record and flat sentinel");

		const vecGroupNames = [
			"FixAngle",
			"PlayerStates",
			"HideHUDFlags",
			"HitGroup",
			"PlayerButtons",
			"LifeState",
		];
		for (const strGroupName of vecGroupNames) {
			for (const InvalidGroup of [null, [], "not a record"]) {
				const Constants = CreateConstants();
				Constants[strGroupName] = InvalidGroup;
				g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Import, Constants), /invalid .* export/, "import rejects invalid " + strGroupName);
			}
		}

		const InheritedConstants = Object.create(g_NativeConstants);
		g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Import, InheritedConstants), /invalid .* export/, "required constants must be own properties");

		for (const nInvalidIndex of [0, 1]) {
			const Constants = CreateConstants();
			Constants.INVALID_PLAYER_INDEX = nInvalidIndex;
			g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Import, Constants), /invalid index sentinels/, "import rejects changed invalid-index sentinels");
		}

		// This fixture also returns malformed values to exercise live-count validation.
		let MaximumClients = 32;
		const Counts = {
			...CreateConstants(),

			GetMaximumClients() {
				return MaximumClients;
			},
		};
		const Range = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.LiveRange, Counts);
		g_Assert.equal(RunDocumentationFunction(() => Range.NormalizePlayerIndex(32), undefined, [], "Contract:NormalizePlayerIndex"), 32, "live final slot is accepted");
		g_Assert.equal(RunDocumentationFunction(() => Range.NormalizePlayerIndex(33), undefined, [], "Contract:NormalizePlayerIndex"), -1, "a slot beyond the current live range is rejected");

		for (const InvalidIndex of [
			0,
			-1,
			1.5,
			"1",
			1n,
			NaN,
			Infinity,
			undefined,
		]) {
			g_Assert.equal(RunDocumentationFunction(() => Range.NormalizePlayerIndex(InvalidIndex), undefined, [], "Contract:NormalizePlayerIndex"), -1, "invalid indexes are rejected without numeric coercion");
		}

		MaximumClients = 1;
		g_Assert.equal(RunDocumentationFunction(() => Range.NormalizePlayerIndex(2), undefined, [], "Contract:NormalizePlayerIndex"), -1, "normalization rereads the live range instead of cached capacity");

		for (const InvalidCount of [
			-1,
			1.5,
			"32",
			32n,
			NaN,
			Infinity,
		]) {
			MaximumClients = InvalidCount;
			g_Assert.throws(() => RunDocumentationFunction(() => Range.NormalizePlayerIndex(1), undefined, [], "Contract:NormalizePlayerIndex"), /invalid slot count/, "the normalization helper rejects malformed live counts");
		}

		const NoClients = {
			...CreateConstants(),

			GetMaximumClients() {
				return 0;
			},

			GetClientCount() {
				return 0;
			},
		};
		g_Assert.equal(RunDocumentationFunction(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.LiveRange, NoClients).NormalizePlayerIndex(1), undefined, [], "Contract:NormalizePlayerIndex"), -1, "an empty live range has no valid player slot");

		for (const InvalidCount of [
			-1,
			1.5,
			"4",
			4n,
			NaN,
			Infinity,
			33,
		]) {
			const Constants = {
				...CreateConstants(),

				GetClientCount() {
					return InvalidCount;
				},
			};
			g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.LiveRange, Constants), /invalid connected-client count/, "count example rejects malformed or oversized connected counts");
		}

		const CountError = new Error("live count unavailable");
		const ThrowingConstants = {
			...CreateConstants(),

			GetClientCount() {
				throw CountError;
			},
		};
		g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.LiveRange, ThrowingConstants), (ErrorValue) => ErrorValue === CountError, "live failure is not replaced");

		const OptionalButtons = { ...CreateConstants(), PlayerButtons: { Attack: 0x01, Use: 0x20 } };
		g_Assert.equal(RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.InputMask, OptionalButtons).ActionMask, 0x21, "missing optional grenade button is not fabricated");

		OptionalButtons.PlayerButtons.Grenade1 = g_unGrenadeButtonMask;
		g_Assert.equal(RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.InputMask, OptionalButtons).ActionMask, 0x21 | g_unGrenadeButtonMask, "an available grenade button joins the mask");

		for (const strRequiredButton of ["Attack", "Use"]) {
			const Constants = { ...CreateConstants(), PlayerButtons: { Attack: 0x01, Use: 0x20 } };
			delete Constants.PlayerButtons[strRequiredButton];
			g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.InputMask, Constants), /requires the Attack and Use/, "missing required input capability is rejected");
		}

		const Flags = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.HUDFlags, CreateConstants());
		const nUnrelatedFlags = g_nInt32Minimum | 0x80;
		const nHiddenFlags = RunDocumentationFunction(() => Flags.SetHUDFlag(nUnrelatedFlags, "Crosshair", true), undefined, [], "Contract:SetHUDFlag");
		g_Assert.equal(nHiddenFlags, nUnrelatedFlags | 0x100, "setting HUD bits preserves unrelated sign and chat bits");
		g_Assert.equal(RunDocumentationFunction(() => Flags.SetHUDFlag(nHiddenFlags, "Crosshair", false), undefined, [], "Contract:SetHUDFlag"), nUnrelatedFlags, "clearing HUD bits preserves unrelated sign and chat bits");
		g_Assert.equal(RunDocumentationFunction(() => Flags.HasPlayerState(g_nInt32Minimum | 0x01, "OnGround"), undefined, [], "Contract:HasPlayerState"), true, "signed flags can include both the top bit and OnGround");
		g_Assert.equal(RunDocumentationFunction(() => Flags.HasPlayerState(g_nInt32Minimum, "OnGround"), undefined, [], "Contract:HasPlayerState"), false, "an unrelated top bit is not an OnGround state");

		for (const InvalidFlags of [
			null,
			undefined,
			NaN,
			Infinity,
			-Infinity,
			1.5,
			"1",
			1n,
			g_unInt32UpperBound,
			g_nInt32Minimum - 1,
			g_unUint32UpperBound,
		]) {
			g_Assert.throws(() => RunDocumentationFunction(() => Flags.HasPlayerState(InvalidFlags, "OnGround"), undefined, [], "Contract:HasPlayerState"), TypeError, "player flags reject non-int32 values");
			g_Assert.throws(() => RunDocumentationFunction(() => Flags.SetHUDFlag(InvalidFlags, "Crosshair", true), undefined, [], "Contract:SetHUDFlag"), TypeError, "HUD flags reject non-int32 values");
		}

		g_Assert.throws(() => RunDocumentationFunction(() => Flags.HasPlayerState(0, "Missing"), undefined, [], "Contract:HasPlayerState"), RangeError, "absent player-state capability is rejected");
		g_Assert.throws(() => RunDocumentationFunction(() => Flags.SetHUDFlag(0, "Missing", true), undefined, [], "Contract:SetHUDFlag"), RangeError, "absent HUD capability is rejected");
		g_Assert.throws(() => RunDocumentationFunction(() => Flags.SetHUDFlag(0, "Crosshair", 1), undefined, [], "Contract:SetHUDFlag"), TypeError, "HUD enablement requires a boolean");

		process.stdout.write("players/constants integer documentation: import, live-range, capability, and signed-int32 boundary scenarios passed.\n");
	}

	function CheckDocumentationOptionalConstants(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);

		const CreateConstants = () => ({ ...g_NativeConstants, FixAngle: { ...g_NativeConstants.FixAngle }, PlayerAnimation: { ...g_NativeConstants.PlayerAnimation } });
		const State = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.EnumNames, CreateConstants());
		g_Assert.equal(State.ChaseModeName, "Chase", "selected observer capability is decoded");
		g_Assert.equal(RunDocumentationFunction(() => State.NameForValue({ Alive: 0 }, 0), undefined, [], "Contract:NameForValue"), "Alive", "zero is a real enum value, not absence");
		g_Assert.equal(RunDocumentationFunction(() => State.NameForValue({ Alive: 0 }, -1), undefined, [], "Contract:NameForValue"), null, "unknown enum values return null");

		for (const InvalidNamespace of [null, undefined, [], "record", 1]) {
			g_Assert.throws(() => RunDocumentationFunction(() => State.NameForValue(InvalidNamespace, 0), undefined, [], "Contract:NameForValue"), TypeError, "enum decoder rejects non-record namespaces");
		}

		const NoObserver = CreateConstants();
		delete NoObserver.ObserverMode;
		g_Assert.equal(RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.EnumNames, NoObserver).ChaseModeName, null, "missing observer capability is not fabricated");

		const Metadata = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.CommandMetadata, CreateConstants());
		g_Assert.deepEqual(RunDocumentationFunction(() => Metadata.CommandMetadata("Reload", "Absolute"), undefined, [], "Contract:CommandMetadata"), { Animation: 7, FixAngle: 1 }, "builder returns a record with exact public keys");
		g_Assert.throws(() => RunDocumentationFunction(() => Metadata.CommandMetadata("Missing", "Absolute"), undefined, [], "Contract:CommandMetadata"), RangeError, "missing animation value fails explicitly");
		g_Assert.throws(() => RunDocumentationFunction(() => Metadata.CommandMetadata("Reload", "Missing"), undefined, [], "Contract:CommandMetadata"), RangeError, "missing angle value fails explicitly");

		const NoAnimation = CreateConstants();
		delete NoAnimation.PlayerAnimation;
		const MissingAnimationMetadata = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.CommandMetadata, NoAnimation);
		g_Assert.equal(MissingAnimationMetadata.Metadata, null, "unsupported animation capability yields null metadata");
		g_Assert.throws(() => RunDocumentationFunction(() => MissingAnimationMetadata.CommandMetadata("Reload", "Absolute"), undefined, [], "Contract:CommandMetadata"), RangeError, "exported builder does not invent an unsupported animation");

		for (const strEmptyGroup of ["FixAngle", "PlayerAnimation"]) {
			const Constants = CreateConstants();
			Constants[strEmptyGroup] = {};
			g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.CommandMetadata, Constants), /does not expose a fix-angle mode|no animation values/, "an empty namespace is not a usable capability");
		}

		const vecInvalidSDKValues = [
			"7",
			7n,
			undefined,
			null,
			NaN,
			Infinity,
			1.5,
			g_unInt32UpperBound,
			g_nInt32Minimum - 1,
		];
		for (const InvalidSDKValue of vecInvalidSDKValues) {
			for (const strGroupName of ["FixAngle", "PlayerAnimation"]) {
				const Constants = CreateConstants();
				const strMemberName = (strGroupName === "FixAngle") ? "None" : "Reload";
				Constants[strGroupName] = { [strMemberName]: InvalidSDKValue };
				g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.CommandMetadata, Constants), TypeError, "top-level metadata rejects non-int32 SDK values");

				Constants[strGroupName][strMemberName] = 0;
				const MutableMetadata = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.CommandMetadata, Constants);
				Constants[strGroupName][strMemberName] = InvalidSDKValue;
				g_Assert.throws(() => RunDocumentationFunction(() => MutableMetadata.CommandMetadata("Reload", "None"), undefined, [], "Contract:CommandMetadata"), TypeError, "exported builder validates every call, not just setup");
			}
		}

		const AccessError = new Error("selected namespace access failed");
		const ThrowingConstants = CreateConstants();
		Object.defineProperty(ThrowingConstants.PlayerAnimation, "Reload", {
			get() {
				throw AccessError;
			},
		});
		g_Assert.throws(() => RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.CommandMetadata, ThrowingConstants), (ErrorValue) => ErrorValue === AccessError, "metadata preserves the original namespace access failure");

		const Capabilities = RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Capabilities, CreateConstants()).Capabilities;
		g_Assert.equal(Capabilities.ObserverModes, true, "installed observer namespace is discovered");
		g_Assert.equal(Capabilities.PlayerAnimation, true, "installed animation namespace is discovered");

		const NoOptional = CreateConstants();
		delete NoOptional.ABSOLUTE_PLAYER_LIMIT;
		delete NoOptional.MAX_EDICTS;
		delete NoOptional.ObserverMode;
		delete NoOptional.PlayerAnimation;
		NoOptional.PlayerButtons = { Attack: 0x01, Use: 0x20 };
		g_Assert.deepEqual(RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Capabilities, NoOptional).Capabilities, { AbsolutePlayerLimit: false, GrenadeInput: false, MaximumEdicts: false, ObserverModes: false, PlayerAnimation: false }, "absent capabilities remain absent");

		const InheritedOptional = Object.create(g_NativeConstants);
		InheritedOptional.PlayerButtons = Object.create(g_NativeConstants.PlayerButtons);
		g_Assert.deepEqual(RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Capabilities, InheritedOptional).Capabilities, RunDocumentationConstantExample(vecCodeBlocks, g_DocumentationBlockIndexes.Capabilities, NoOptional).Capabilities, "capability discovery ignores inherited keys");

		process.stdout.write("players/constants optional documentation: enum, builder, capability, and mutable-value failure scenarios passed.\n");
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strPlayersConstantsDocumentationPath, "utf8");
	CheckDocumentationIntegerContracts(g_strDocumentation);
	CheckDocumentationOptionalConstants(g_strDocumentation);

	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationCodeBlockCount, "players/constants documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/constants documentation must be maintained by hand.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\s*\./, "players/constants documentation must not depend on console output.");
	g_Assert.match(g_vecCodeBlocks[g_DocumentationBlockIndexes.Import], /const g_Constants = require\("players\/constants"\);/, "players/constants import must preserve the conditional native namespace.");

	for (const strExportName of Object.keys(g_NativeConstants)) {
		if (strExportName === "Marker") {
			continue;
		}

		g_Assert.ok(g_strDocumentation.includes(`\`${strExportName}\``) || g_strDocumentation.includes(`${strExportName}()`) || g_strDocumentation.includes(`${strExportName}.`) || g_strDocumentation.includes(`${strExportName},`), `players/constants documentation must cover selected export ${strExportName}.`);
	}

	for (const strSDKName of g_vecDocumentedSDKNames) {
		g_Assert.ok(g_strDocumentation.includes(strSDKName), `players/constants documentation must cover maximum SDK name ${strSDKName}.`);
	}

	for (const strSectionName of g_vecRequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strDocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/constants contents must link ${strSectionName}.`);
		g_Assert.ok(g_strDocumentation.includes(`## ${strSectionName}`), `players/constants documentation must contain ${strSectionName}.`);
	}

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players/constants") {
			return g_Constants;
		}

		if (strModuleName === "listeners") {
			return {
				ButtonStatus: { PRESSED: 1, RELEASED: 0 },

				GetButtonCombinationStatus(unOldButtons, unNewButtons, unCombination) {
					const bPrevious = (unOldButtons & unCombination) === unCombination;
					const bCurrent = (unNewButtons & unCombination) === unCombination;

					if (!bPrevious && bCurrent) {
						return 1;
					}

					if (bPrevious && !bCurrent) {
						return 0;
					}

					return null;
				},

				RegisterButtonStateChangedListener(Callback) {
					if (typeof Callback !== "function") {
						throw new TypeError("RegisterButtonStateChangedListener(Callback) expects a function.");
					}

					let bDisposed = false;
					const Player = {
						Say(strMessage) {
							g_vecListenerCalls.push(["Say", strMessage]);

							return true;
						},
					};

					const Subscription = {
						DisposeListener() {
							if (bDisposed) {
								return false;
							}

							bDisposed = true;
							g_mapActiveButtonListeners.delete(Subscription);
							g_vecListenerCalls.push(["DisposeListener", Callback]);

							return true;
						},
					};
					g_mapActiveButtonListeners.set(Subscription, Subscription.DisposeListener);

					Callback(Player, 0, g_Constants.PlayerButtons.Jump | g_Constants.PlayerButtons.Attack);

					return Subscription;
				},
			};
		}

		if (strModuleName === "events") {
			return {
				UnregisterEventListener,

				RegisterEventListener(strEventName, Callback) {
					if ((typeof strEventName !== "string") || (strEventName.length === 0) || (typeof Callback !== "function")) {
						throw new TypeError("RegisterEventListener(strEventName, Callback) expects a non-empty event name and a function.");
					}

					let setCallbacks = g_mapActiveEventListeners.get(strEventName);
					if (setCallbacks === undefined) {
						setCallbacks = new Set();
						g_mapActiveEventListeners.set(strEventName, setCallbacks);
					}

					setCallbacks.add(Callback);
					g_vecEventCalls.push(["RegisterEventListener", strEventName, Callback]);

					Callback({
						GetEventInteger(strName) {
							if (strName === "hitgroup") {
								return g_Constants.HitGroup.Head;
							}

							if (strName === "userid") {
								return 11;
							}

							throw new RangeError(`Unexpected engine event integer field ${strName}.`);
						},
					});

					return true;
				},
			};
		}

		throw new Error(`unexpected documentation module ${strModuleName}`);
	}

	function UnloadDocumentationModule(ModuleRecord, bRequired = false) {
		const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
		const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
		g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
		g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "Documentation unload lookup must follow the current exact native export key");

		const ModuleExports = ModuleRecord.exports;
		const Unload = ModuleExports.Unload;
		g_Assert.equal(Object.hasOwn(ModuleExports, "unload"), false, "No lowercase lifecycle alias");

		if (bRequired) {
			g_Assert.equal(typeof Unload, "function", "The cleanup example must export the native unload entry point");
		}

		if (typeof Unload === "function") {
			Reflect.apply(Unload, ModuleExports, []);
		}
	}

	function ExecuteRootDocumentation(unCodeBlockIndex) {
		const strLabel = `Root-${unCodeBlockIndex + 1}`;
		const ModuleRecord = { exports: {} };
		const Callback = g_VM.compileFunction(g_vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strPlayersConstantsDocumentationPath}:${strLabel}` });
		let bFailed = false;
		let Failure = null;

		try {
			RunDocumentationFunction(Callback, undefined, [RequireDocumentationModule, ModuleRecord, ModuleRecord.exports], strLabel);
			g_vecDocumentationModules.push(ModuleRecord.exports);
		} catch (ErrorValue) {
			bFailed = true;
			Failure = ErrorValue;
		}

		const vecCleanupErrors = [];

		try {
			RunDocumentationFunction(UnloadDocumentationModule, undefined, [ModuleRecord, (unCodeBlockIndex === g_DocumentationBlockIndexes.ButtonTransitions) || (unCodeBlockIndex === g_DocumentationBlockIndexes.HitGroups)], `${strLabel}:Unload`);
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		if (!bFailed && (vecCleanupErrors.length === 0) && (GetActiveDocumentationListenerCount() !== 0)) {
			vecCleanupErrors.push(new Error(`Players-constants ${strLabel} did not release all registered listeners.`));
		}

		try {
			ReleaseActiveDocumentationListeners();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		if (vecCleanupErrors.length > 0) {
			if (!bFailed && (vecCleanupErrors.length === 1)) {
				throw vecCleanupErrors[0];
			}

			if (bFailed) {
				vecCleanupErrors.unshift(Failure);
			}

			throw new AggregateError(vecCleanupErrors, "Players-constants documentation cleanup failed.");
		}

		if (bFailed) {
			throw Failure;
		}
	}

	for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; ++unCodeBlockIndex) {
		ExecuteRootDocumentation(unCodeBlockIndex);
	}

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strPlayersConstantsDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/constants documentation link must exist: ${strTarget}`);
	}

	const g_strPackageSource = g_FileSystem.readFileSync(g_strPlayersConstantsPath, "utf8");
	g_Assert.ok(g_strPackageSource.startsWith('"use strict";'), "players/constants must enable strict mode.");
	g_Assert.ok(g_vecListenerCalls.some((vecCall) => vecCall[0] === "Say"), "button workflow must react to the selected SDK bitmask.");
	g_Assert.deepEqual(g_vecListenerCalls.filter((vecCall) => vecCall[0] === "Say").map((vecCall) => vecCall[1]), ["Jump + attack pressed"], "button workflow must use the actual uppercase PRESSED status.");
	g_Assert.ok(g_vecListenerCalls.some((vecCall) => vecCall[0] === "DisposeListener"), "button workflow must dispose its listener.");
	g_Assert.ok(g_vecEventCalls.some((vecCall) => (vecCall[0] === "RegisterEventListener") && (vecCall[1] === "player_hurt")), "hit-group workflow must subscribe to the engine event.");
	g_Assert.ok(g_vecEventCalls.some((vecCall) => (vecCall[0] === "UnregisterEventListener") && (vecCall[1] === "player_hurt")), "hit-group workflow must unsubscribe from the engine event.");
	g_Assert.ok(g_vecDocumentationModules.some((Exports) => (typeof Exports.GetLastHeadHitUserID === "function") && (RunDocumentationFunction(() => Exports.GetLastHeadHitUserID(), undefined, [], "Contract:GetLastHeadHitUserID") === 11)), "hit-group workflow must retain the matching user ID.");
} catch (ErrorValue) {
	g_bExecutionFailed = true;
	g_Failure = ErrorValue;
} finally {
	const vecCleanupErrors = [];
	for (const Restore of [
		ReleaseActiveDocumentationListeners,
		() => RestorePlayersConstantsProperty(g_Module, "_load", g_ModuleLoadDescriptor),
		() => RestorePlayersConstantsProperty(require.cache, g_strPlayersConstantsPath, g_ConstantsCacheDescriptor),
		() => RestorePlayersConstantsProperty(g_NativeConstants, "Marker", g_MarkerDescriptor),
	]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}
	}

	if (vecCleanupErrors.length > 0) {
		if (!g_bExecutionFailed && (vecCleanupErrors.length === 1)) {
			throw vecCleanupErrors[0];
		}

		if (g_bExecutionFailed) {
			vecCleanupErrors.unshift(g_Failure);
		}

		throw new AggregateError(vecCleanupErrors, "Players-constants fixture restoration failed.");
	}
}

if (g_bExecutionFailed) {
	throw g_Failure;
}

console.log("[smoke_players_constants] selected-SDK doubles and documentation passed; native SDK execution not exercised");
