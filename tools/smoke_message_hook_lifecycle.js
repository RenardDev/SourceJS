#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelpRequested = (process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"));
	console[bHelpRequested ? "log" : "error"]("Usage: node tools/smoke_message_hook_lifecycle.js");
	process.exit(bHelpRequested ? 0 : 2);
}

const g_strHookSourcePath = g_Path.resolve(__dirname, "../packages/sourcejs/memory/hooks/messages.js");
const g_strHookSourceCode = g_FileSystem.readFileSync(g_strHookSourcePath, "utf8");
const g_unBeginVirtualTableIndex = 1;
const g_unEndVirtualTableIndex = 2;
const g_unProtobufVirtualTableIndex = 3;
const g_unEngineServerAddress = 0x64n;
const g_unRecipientFilterAddress = 0x80n;
const g_unBitBufferAddress = 0x90n;
const g_nMessageIndex = 0;

function RejectBufferUse() {
	throw new Error("The lifecycle scenarios must not dispatch message buffers.");
}

function ObserveMessage() {
}

function CreateFixture(strBackend) {
	const vecNativeHooks = [];
	const mapFailures = new Map();
	const Module = { exports: {} };

	function CreateOptions(unVirtualTableIndex, vecArguments, strReturnType) {
		return { Arguments: vecArguments, Convention: "thiscall", Index: unVirtualTableIndex, ObjectAddress: g_unEngineServerAddress, ReturnType: strReturnType };
	}

	function CreateVTableHook(Options) {
		const Failures = mapFailures.get(Options.Index) ?? {};
		if (Failures.CreationAllowed === false) {
			return null;
		}

		const NativeHook = {
			Index: Options.Index,
			PostAllowed: Failures.PostAllowed ?? true,
			PostCallbacks: [],
			PostFailure: Failures.PostFailure ?? null,
			PreAllowed: Failures.PreAllowed ?? true,
			PreCallbacks: [],
			PreFailure: Failures.PreFailure ?? null,
			RegistrationError: Failures.RegistrationError ?? null,
			RemovalAllowed: Failures.RemovalAllowed ?? true,
			RemovalAttempts: 0,
			RemovalFailure: Failures.RemovalFailure ?? null,
			Removed: false,
		};
		vecNativeHooks.push(NativeHook);

		return {
			Pre(Callback) {
				if (NativeHook.PreFailure !== null) {
					throw NativeHook.PreFailure.Value;
				}

				if (NativeHook.RegistrationError !== null) {
					throw NativeHook.RegistrationError;
				}

				if (!NativeHook.PreAllowed) {
					return false;
				}

				NativeHook.PreCallbacks.push(Callback);

				return true;
			},

			Post(Callback) {
				if (NativeHook.PostFailure !== null) {
					throw NativeHook.PostFailure.Value;
				}

				if (!NativeHook.PostAllowed) {
					return false;
				}

				NativeHook.PostCallbacks.push(Callback);

				return true;
			},

			Remove() {
				NativeHook.RemovalAttempts += 1;
				if (NativeHook.RemovalFailure !== null) {
					throw NativeHook.RemovalFailure.Value;
				}

				if (!NativeHook.RemovalAllowed) {
					return false;
				}

				NativeHook.Removed = true;
				NativeHook.PreCallbacks.length = 0;
				NativeHook.PostCallbacks.length = 0;

				return true;
			},
		};
	}

	const NativeMessages = {
		GetUserMessageIndex(strName) {
			return (strName === "TextMsg") ? g_nMessageIndex : -1;
		},

		GetUserMessageName(nIndex) {
			return (nIndex === g_nMessageIndex) ? "TextMsg" : "";
		},
	};
	const NativeMessageHooks = {
		Backend() {
			return strBackend;
		},

		GetUserMessageBeginHookOptions() {
			return CreateOptions(g_unBeginVirtualTableIndex, ["address", "address", "int"], "address");
		},

		GetMessageEndHookOptions() {
			return CreateOptions(g_unEndVirtualTableIndex, ["address"], "void");
		},

		GetSendUserMessageHookOptions() {
			return CreateOptions(g_unProtobufVirtualTableIndex, ["address", "address", "int", "address"], "void");
		},
		GetRecipientFilter(unAddress) {
			g_Assert.equal(unAddress, g_unRecipientFilterAddress);

			return { Indices: [1], InitializationMessage: false, Reliable: false };
		},
	};

	function FixtureRequire(strModuleName) {
		switch (strModuleName) {
			case "bitbuffers":
				return { BitBufferRead: RejectBufferUse, BitBufferWrite: RejectBufferUse };

			case "filters/recipients":
				return { RecipientFilter: { CreateRecipientFilterFromNativeInfo: NativeInformation => NativeInformation } };

			case "internal/runtime":
				return {
					GetModule(strNativeModuleName) {
						if (strNativeModuleName === "messages") {
							return NativeMessages;
						}

						g_Assert.equal(strNativeModuleName, "memory/hooks/messages");

						return NativeMessageHooks;
					},
				};

			case "memory/hooks":
				// Only the current native export exists; a phantom CreateVTable alias must fail.
				return { CreateVTableHook };

			case "messages/implementation":
				return {
					GetUserMessageImplementation(nMessageIndex) {
						g_Assert.equal(nMessageIndex, g_nMessageIndex);

						return {};
					},
				};

			default:
				throw new Error(`Unexpected lifecycle dependency: ${strModuleName}`);
		}
	}

	new Function("require", "module", "exports", g_strHookSourceCode)(FixtureRequire, Module, Module.exports);

	return { Exports: Module.exports, Failures: mapFailures, NativeHooks: vecNativeHooks };
}

function AssertReleased(Fixture) {
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.BitBufferBeginInstalled, false);
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.BitBufferEndInstalled, false);
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.ProtobufSendInstalled, false);

	for (const NativeHook of Fixture.NativeHooks) {
		g_Assert.equal(NativeHook.Removed, true);
		g_Assert.equal(NativeHook.PreCallbacks.length, 0);
		g_Assert.equal(NativeHook.PostCallbacks.length, 0);
	}
}

function VerifyBaseConstructorContracts() {
	for (const strBackend of ["bitbuffer", "protobuf"]) {
		const Fixture = CreateFixture(strBackend);
		const { UserMessageHookBase } = Fixture.Exports;
		const BaseHook = new UserMessageHookBase("TextMsg");
		g_Assert.equal(BaseHook.MessageIndex, g_nMessageIndex);
		g_Assert.equal(BaseHook.MessageName, "TextMsg");
		g_Assert.equal(BaseHook.Callback, null);
		g_Assert.equal(BaseHook.RequiredBackend, null);
		g_Assert.throws(() => BaseHook.Store, /Store is not implemented/);
		g_Assert.throws(() => BaseHook.RegisterUserMessageHook(ObserveMessage), /Store is not implemented/);
		g_Assert.throws(() => new UserMessageHookBase("TextMsg", ObserveMessage), /Store is not implemented/);
		g_Assert.equal(BaseHook.DisposeUserMessageHook(), false);
		g_Assert.equal(Fixture.NativeHooks.length, 0, "abstract registration must not install native hooks");
	}
}

function VerifyRemovalRetry(strBackend) {
	const Fixture = CreateFixture(strBackend);
	const FirstHook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	const unNativeHookCount = Fixture.NativeHooks.length;
	for (const NativeHook of Fixture.NativeHooks) {
		NativeHook.RemovalAllowed = false;
	}

	g_Assert.equal(FirstHook.DisposeUserMessageHook(), true, "callback removal remains independent of native removal");
	g_Assert.equal(FirstHook.Callback, null);
	g_Assert.equal(FirstHook.Store.size, 0);
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.ProtobufSendInstalled, strBackend === "protobuf");
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.BitBufferBeginInstalled, strBackend === "bitbuffer");
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.BitBufferEndInstalled, strBackend === "bitbuffer");
	g_Assert.equal(FirstHook.DisposeUserMessageHook(), false, "an empty disposal retries removal without claiming another callback");

	for (const NativeHook of Fixture.NativeHooks) {
		g_Assert.equal(NativeHook.RemovalAttempts, 2);
	}

	const ReplacementHook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	g_Assert.equal(Fixture.NativeHooks.length, unNativeHookCount, "retained complete hooks are reused without duplicate callbacks");

	for (const NativeHook of Fixture.NativeHooks) {
		g_Assert.equal(NativeHook.PreCallbacks.length, 1, "retained hooks keep exactly one dispatch callback");
		g_Assert.equal(NativeHook.PostCallbacks.length, (NativeHook.Index === g_unBeginVirtualTableIndex) ? 1 : 0);
		NativeHook.RemovalAllowed = true;
	}

	g_Assert.equal(ReplacementHook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyPartialBitBufferRemoval() {
	const Fixture = CreateFixture("bitbuffer");
	const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	const BeginHook = Fixture.NativeHooks.find((NativeHook) => NativeHook.Index === g_unBeginVirtualTableIndex);
	g_Assert.notEqual(BeginHook, undefined);

	BeginHook.RemovalAllowed = false;

	g_Assert.equal(Hook.DisposeUserMessageHook(), true);
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.BitBufferBeginInstalled, true);
	g_Assert.equal(Fixture.Exports.HOOK_STATUS.BitBufferEndInstalled, false);
	g_Assert.throws(() => new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage), /release incomplete/);
	g_Assert.equal(Fixture.NativeHooks.length, 2, "a partially removed pair is not duplicated");

	BeginHook.RemovalAllowed = true;

	const ReplacementHook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	g_Assert.equal(Fixture.NativeHooks.length, 4);
	g_Assert.equal(BeginHook.Removed, true);
	g_Assert.equal(ReplacementHook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyRegistrationRollback(strBackend) {
	const Fixture = CreateFixture(strBackend);
	const unFirstHookIndex = (strBackend === "bitbuffer") ? g_unBeginVirtualTableIndex : g_unProtobufVirtualTableIndex;
	Fixture.Failures.set(unFirstHookIndex, { PreAllowed: false, RemovalAllowed: false });

	if (strBackend === "bitbuffer") {
		Fixture.Failures.set(g_unEndVirtualTableIndex, { RemovalAllowed: false });
	}

	g_Assert.throws(() => new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage), /register .* pre-hook/);

	const unNativeHookCount = Fixture.NativeHooks.length;
	g_Assert.throws(() => Fixture.Exports.EnsureNativeHooks(), /release .*incomplete/);
	g_Assert.equal(Fixture.NativeHooks.length, unNativeHookCount, "failed rollback must not masquerade as a complete installation");

	for (const NativeHook of Fixture.NativeHooks) {
		g_Assert.equal(NativeHook.Removed, false);
		NativeHook.RemovalAllowed = true;
	}

	Fixture.Failures.clear();

	const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	g_Assert.equal(Hook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyInstallationFailure(unFailedHookIndex, Failures, ExpectedError) {
	const strBackend = (unFailedHookIndex === g_unProtobufVirtualTableIndex) ? "protobuf" : "bitbuffer";
	const Fixture = CreateFixture(strBackend);
	Fixture.Failures.set(unFailedHookIndex, Failures);

	g_Assert.throws(() => new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage), ExpectedError);
	AssertReleased(Fixture);
	Fixture.Failures.clear();

	const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	g_Assert.equal(Hook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyCallbackOwnership() {
	const Fixture = CreateFixture("bitbuffer");
	const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	const UnregisteredCallback = () => {
	};
	Hook.Callback = UnregisteredCallback;

	g_Assert.throws(() => Hook.RegisterUserMessageHook(ObserveMessage), /release the previous callback/);
	g_Assert.equal(Hook.Store.get(g_nMessageIndex).has(ObserveMessage), true, "a failed replacement does not lose the original registration");

	Hook.Callback = ObserveMessage;

	g_Assert.equal(Hook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyDuplicateReplacementPreservesCallback(strBackend) {
	const Fixture = CreateFixture(strBackend);
	const FirstCallback = () => {
	};

	const SecondCallback = () => {
	};

	const FirstHook = new Fixture.Exports.UserMessageHook("TextMsg", FirstCallback);
	const SecondHook = new Fixture.Exports.UserMessageHook("TextMsg", SecondCallback);

	g_Assert.throws(() => FirstHook.RegisterUserMessageHook(SecondCallback), /already registered/);
	g_Assert.equal(FirstHook.Callback, FirstCallback, "a duplicate replacement preserves the previous callback binding");
	g_Assert.equal(FirstHook.Store.get(g_nMessageIndex).has(FirstCallback), true, "a duplicate replacement preserves the previous registration");
	g_Assert.equal(FirstHook.DisposeUserMessageHook(), true);
	g_Assert.equal(SecondHook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyReplacementKeepsNativeHooks(strBackend) {
	const Fixture = CreateFixture(strBackend);
	const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	const ReplacementCallback = () => {
	};

	const unFirstHookIndex = (strBackend === "bitbuffer") ? g_unBeginVirtualTableIndex : g_unProtobufVirtualTableIndex;
	const unNativeHookCount = Fixture.NativeHooks.length;
	Fixture.Failures.set(unFirstHookIndex, { CreationAllowed: false });

	const OriginalDisposeUserMessageHook = Hook.DisposeUserMessageHook;
	Hook.DisposeUserMessageHook = () => {
		OriginalDisposeUserMessageHook.call(Hook);
		throw new Error("Replacement cleanup failed after removing the previous callback.");
	};

	g_Assert.throws(() => Hook.RegisterUserMessageHook(ReplacementCallback), /Replacement cleanup failed/);
	g_Assert.equal(Hook.Callback, ObserveMessage, "failed replacement restores the previous callback binding");
	g_Assert.equal(Hook.Store.get(g_nMessageIndex).has(ObserveMessage), true, "failed replacement restores the previous registration");
	g_Assert.equal(Hook.Store.get(g_nMessageIndex).has(ReplacementCallback), false, "failed replacement removes the new registration");
	g_Assert.equal(Fixture.NativeHooks.length, unNativeHookCount, "failed replacement does not allocate native hooks");

	Hook.DisposeUserMessageHook = OriginalDisposeUserMessageHook;

	g_Assert.equal(Hook.RegisterUserMessageHook(ReplacementCallback), ReplacementCallback, "replacement reuses the active native hooks");
	g_Assert.equal(Fixture.NativeHooks.length, unNativeHookCount, "replacement does not allocate additional native hooks");
	g_Assert.equal(Hook.Store.get(g_nMessageIndex).has(ObserveMessage), false, "replacement removes the previous callback");
	g_Assert.equal(Hook.Store.get(g_nMessageIndex).has(ReplacementCallback), true, "replacement retains the new callback");
	g_Assert.equal(Hook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function VerifyReplacementRollbackFailure(strBackend, bFailRestoration) {
	const Fixture = CreateFixture(strBackend);
	const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
	const ReplacementCallback = () => {
	};

	const setMessageCallbacks = Hook.Store.get(g_nMessageIndex);
	const OriginalAdd = setMessageCallbacks.add;
	const OriginalDelete = setMessageCallbacks.delete;
	const OriginalDisposeUserMessageHook = Hook.DisposeUserMessageHook;
	Hook.DisposeUserMessageHook = () => {
		OriginalDisposeUserMessageHook.call(Hook);

		if (bFailRestoration) {
			setMessageCallbacks.add = (Callback) => {
				if (Callback === ObserveMessage) {
					throw new Error("Simulated callback restoration failure.");
				}

				return OriginalAdd.call(setMessageCallbacks, Callback);
			};

		} else {
			setMessageCallbacks.delete = (Callback) => {
				return (Callback === ReplacementCallback) ? false : OriginalDelete.call(setMessageCallbacks, Callback);
			};
		}

		throw new Error("Simulated replacement disposal failure.");
	};

	g_Assert.throws(() => Hook.RegisterUserMessageHook(ReplacementCallback), (ErrorValue) => {
		g_Assert.ok(ErrorValue instanceof AggregateError);
		g_Assert.equal(ErrorValue.errors.length, 2, "replacement and rollback errors are both retained");
		g_Assert.match(ErrorValue.errors[0].message, /replacement disposal failure/);
		g_Assert.match(ErrorValue.errors[1].message, bFailRestoration ? /restoration failure/ : /roll back the replacement/);

		return true;
	});

	setMessageCallbacks.add = OriginalAdd;
	setMessageCallbacks.delete = OriginalDelete;
	Hook.DisposeUserMessageHook = OriginalDisposeUserMessageHook;
	setMessageCallbacks.delete(ReplacementCallback);
	setMessageCallbacks.add(ObserveMessage);
	Hook.Callback = ObserveMessage;
	g_Assert.equal(Hook.DisposeUserMessageHook(), true);
	AssertReleased(Fixture);
}

function CaptureFailure(Callback) {
	try {
		return { Threw: false, Value: Callback() };
	} catch (Value) {
		return { Threw: true, Value };
	}
}

function AssertFailureIdentity(Outcome, vecExpectedFailures) {
	g_Assert.equal(Outcome.Threw, vecExpectedFailures.length > 0, "Cleanup must not hide or manufacture a thrown failure.");
	if (vecExpectedFailures.length === 0) {
		return;
	}

	const setExpectedFailures = new Set(vecExpectedFailures);
	const Leaves = Value => (!setExpectedFailures.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(Leaves) : [Value];
	const vecActualFailures = Leaves(Outcome.Value);
	g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length, "Every primary and cleanup failure must be retained.");
	for (let unFailureIndex = 0; unFailureIndex < vecExpectedFailures.length; unFailureIndex++) {
		g_Assert.strictEqual(vecActualFailures[unFailureIndex], vecExpectedFailures[unFailureIndex], "Failure identity and occurrence order must be preserved.");
	}

	if (vecExpectedFailures.length === 1) {
		g_Assert.strictEqual(Outcome.Value, vecExpectedFailures[0], "A single failure is rethrown unchanged.");
	} else {
		g_Assert.ok(Outcome.Value instanceof AggregateError);
	}
}

function CreateFailureValues() {
	return [new Error("Controlled native hook failure"), null, undefined, false, 0, new AggregateError([new Error("Injected aggregate child")], "Injected aggregate failure")];
}

function GetRemovalModeSets(strBackend) {
	const vecModes = ["THROW", "FALSE", "SUCCESS"];

	return (strBackend === "bitbuffer") ? vecModes.flatMap(strBeginMode => vecModes.map(strEndMode => [strBeginMode, strEndMode])) : vecModes.map(strMode => [strMode]);
}

function ConfigureRemovalFailures(Fixture, vecModes, vecValues) {
	const vecExpectedFailures = [];
	for (let unHookIndex = 0; unHookIndex < Fixture.NativeHooks.length; unHookIndex++) {
		const NativeHook = Fixture.NativeHooks[unHookIndex];
		const strMode = vecModes[unHookIndex];
		NativeHook.RemovalAllowed = strMode !== "FALSE";
		NativeHook.RemovalFailure = (strMode === "THROW") ? { Value: vecValues[unHookIndex] } : null;
		if (strMode === "THROW") {
			vecExpectedFailures.push(vecValues[unHookIndex]);
		}
	}

	return vecExpectedFailures;
}

function AssertRemovalAttempts(Fixture, vecModes) {
	for (let unHookIndex = 0; unHookIndex < Fixture.NativeHooks.length; unHookIndex++) {
		const NativeHook = Fixture.NativeHooks[unHookIndex];
		g_Assert.equal(NativeHook.RemovalAttempts, 1, "Every native removal must be attempted even after another removal throws.");
		g_Assert.equal(NativeHook.Removed, vecModes[unHookIndex] === "SUCCESS");
		const strStatusName = (NativeHook.Index === g_unBeginVirtualTableIndex) ? "BitBufferBeginInstalled" : (NativeHook.Index === g_unEndVirtualTableIndex) ? "BitBufferEndInstalled" : "ProtobufSendInstalled";
		g_Assert.equal(Fixture.Exports.HOOK_STATUS[strStatusName], vecModes[unHookIndex] !== "SUCCESS", "Failed native handles remain owned and visible for retry.");
	}
}

function AllowRemovalRetry(Fixture) {
	for (const NativeHook of Fixture.NativeHooks) {
		NativeHook.RemovalAllowed = true;
		NativeHook.RemovalFailure = null;
	}
}

function VerifyNativeRemovalFailures() {
	let unCaseCount = 0;
	const vecValues = CreateFailureValues();
	for (const strBackend of ["bitbuffer", "protobuf"]) {
		for (let unValueIndex = 0; unValueIndex < vecValues.length; unValueIndex++) {
			for (const vecModes of GetRemovalModeSets(strBackend)) {
				const Fixture = CreateFixture(strBackend);
				const Hook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
				let CaptureAddress = null;
				if (strBackend === "bitbuffer") {
					const BeginHook = Fixture.NativeHooks[0];
					CaptureAddress = BeginHook.PostCallbacks[0];
					BeginHook.PreCallbacks[0]({ Arguments: [g_unEngineServerAddress, g_unRecipientFilterAddress, g_nMessageIndex] });
					CaptureAddress({ ReturnValue: g_unBitBufferAddress });
				}

				const vecExpectedFailures = ConfigureRemovalFailures(Fixture, vecModes, [vecValues[unValueIndex], vecValues[(unValueIndex + 1) % vecValues.length]]);
				const Outcome = CaptureFailure(() => Hook.DisposeUserMessageHook());
				AssertRemovalAttempts(Fixture, vecModes);
				AssertFailureIdentity(Outcome, vecExpectedFailures);
				g_Assert.equal(Hook.Callback, null, "Callback removal remains committed when native cleanup throws.");
				g_Assert.equal(Hook.Store.size, 0);
				if (!Outcome.Threw) {
					g_Assert.equal(Outcome.Value, true, "Callback removal success does not depend on native removal success.");
				}

				if (CaptureAddress !== null) {
					g_Assert.doesNotThrow(() => CaptureAddress({ ReturnValue: 0n }), "Transient bitbuffer state must be cleared even when native removal throws.");
				}

				const unNativeHookCount = Fixture.NativeHooks.length;
				AllowRemovalRetry(Fixture);
				g_Assert.equal(Hook.DisposeUserMessageHook(), false, "Empty disposal retries native cleanup without claiming callback removal.");
				g_Assert.equal(Fixture.NativeHooks.length, unNativeHookCount);
				AssertReleased(Fixture);
				unCaseCount++;
			}
		}
	}

	g_Assert.equal(unCaseCount, 72);

	return unCaseCount;
}

function VerifyInstallationRollbackFailures() {
	let unCaseCount = 0;
	const vecValues = CreateFailureValues();
	const vecStages = [
		{ Backend: "bitbuffer", Index: g_unBeginVirtualTableIndex, Method: "Pre" },
		{ Backend: "bitbuffer", Index: g_unBeginVirtualTableIndex, Method: "Post" },
		{ Backend: "bitbuffer", Index: g_unEndVirtualTableIndex, Method: "Pre" },
		{ Backend: "protobuf", Index: g_unProtobufVirtualTableIndex, Method: "Pre" },
	];
	for (const Stage of vecStages) {
		for (let unValueIndex = 0; unValueIndex < vecValues.length; unValueIndex++) {
			for (const vecModes of GetRemovalModeSets(Stage.Backend)) {
				const Fixture = CreateFixture(Stage.Backend);
				const vecCleanupValues = CreateFailureValues();
				const vecIndexes = (Stage.Backend === "bitbuffer") ? [g_unBeginVirtualTableIndex, g_unEndVirtualTableIndex] : [g_unProtobufVirtualTableIndex];
				const vecExpectedFailures = [vecValues[unValueIndex]];
				for (let unHookIndex = 0; unHookIndex < vecIndexes.length; unHookIndex++) {
					const strMode = vecModes[unHookIndex];
					const Failure = vecCleanupValues[(unValueIndex + unHookIndex) % vecCleanupValues.length];
					Fixture.Failures.set(vecIndexes[unHookIndex], { RemovalAllowed: strMode !== "FALSE", RemovalFailure: (strMode === "THROW") ? { Value: Failure } : null });
					if (strMode === "THROW") {
						vecExpectedFailures.push(Failure);
					}
				}

				Fixture.Failures.get(Stage.Index)[Stage.Method + "Failure"] = { Value: vecValues[unValueIndex] };
				const Outcome = CaptureFailure(() => new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage));
				AssertRemovalAttempts(Fixture, vecModes);
				AssertFailureIdentity(Outcome, vecExpectedFailures);
				if (vecExpectedFailures.length > 1) {
					g_Assert.strictEqual(Outcome.Value.errors[0], vecExpectedFailures[0], "Installation preserves the primary failure before cleanup failures.");
				}

				const EmptyHook = new Fixture.Exports.UserMessageHook("TextMsg");
				g_Assert.equal(EmptyHook.Callback, null);
				g_Assert.equal(EmptyHook.Store.size, 0, "Failed installation must not commit callback registration.");
				const unNativeHookCount = Fixture.NativeHooks.length;
				AllowRemovalRetry(Fixture);
				g_Assert.equal(EmptyHook.DisposeUserMessageHook(), false);
				g_Assert.equal(Fixture.NativeHooks.length, unNativeHookCount, "Cleanup retries never create duplicate native hooks.");
				AssertReleased(Fixture);
				Fixture.Failures.clear();
				const ReplacementHook = new Fixture.Exports.UserMessageHook("TextMsg", ObserveMessage);
				g_Assert.equal(ReplacementHook.DisposeUserMessageHook(), true);
				AssertReleased(Fixture);
				unCaseCount++;
			}
		}
	}

	g_Assert.equal(unCaseCount, 180);

	return unCaseCount;
}

const g_unNativeRemovalFailureCases = VerifyNativeRemovalFailures();
const g_unInstallationRollbackFailureCases = VerifyInstallationRollbackFailures();
console.log(`[  OK  ] message hook release safety: ${g_unNativeRemovalFailureCases + g_unInstallationRollbackFailureCases} independent-removal/primary-cleanup/falsy-value/transient-state/retry scenarios passed with native doubles`);

VerifyBaseConstructorContracts();
VerifyRemovalRetry("bitbuffer");
VerifyRemovalRetry("protobuf");
VerifyPartialBitBufferRemoval();
VerifyRegistrationRollback("bitbuffer");
VerifyRegistrationRollback("protobuf");
VerifyCallbackOwnership();
VerifyDuplicateReplacementPreservesCallback("bitbuffer");
VerifyDuplicateReplacementPreservesCallback("protobuf");
VerifyReplacementKeepsNativeHooks("bitbuffer");
VerifyReplacementKeepsNativeHooks("protobuf");
VerifyReplacementRollbackFailure("bitbuffer", false);
VerifyReplacementRollbackFailure("protobuf", false);
VerifyReplacementRollbackFailure("bitbuffer", true);
VerifyReplacementRollbackFailure("protobuf", true);
VerifyInstallationFailure(g_unEndVirtualTableIndex, { CreationAllowed: false }, /install IVEngineServer::MessageEnd/);
VerifyInstallationFailure(g_unBeginVirtualTableIndex, { PostAllowed: false }, /register .* post-hook/);
VerifyInstallationFailure(g_unEndVirtualTableIndex, { PreAllowed: false }, /register .* pre-hook/);
VerifyInstallationFailure(g_unProtobufVirtualTableIndex, { CreationAllowed: false }, /install IVEngineServer::SendUserMessage/);
VerifyInstallationFailure(g_unProtobufVirtualTableIndex, { RegistrationError: new Error("Simulated registration exception") }, /Simulated registration exception/);

console.log("[smoke_message_hook_lifecycle] ok");
