const g_Assert = require("node:assert/strict");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackageRootPath = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strFixturePath = g_Path.join(__dirname, "smoke_commands_auth_player.js");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_typed_command_unload.js\nExercises JavaScript command registration with a native-module test double.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_typed_command_unload.js");
	process.exit(2);
}

// Reuse the process-local fixture without leaking its runtime, caches or lookup paths.
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_NodePathDescriptor = Object.getOwnPropertyDescriptor(process.env, "NODE_PATH");
const g_GlobalPathsDescriptor = Object.getOwnPropertyDescriptor(g_Module, "globalPaths");
const g_PathCacheDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_pathCache");
const g_OriginalInitializeModulePaths = Object.getOwnPropertyDescriptor(g_Module, "_initPaths")?.value;
const g_mapCachedModules = new Map();
const g_IsFixtureModulePath = strModulePath => (strModulePath === g_strFixturePath) || strModulePath.startsWith(g_strPackageRootPath + g_Path.sep);

let g_bRuntimeOwned = false;
let g_bEnvironmentOwned = false;
let g_bGlobalPathsOwned = false;
let g_bPathCacheOwned = false;
let g_bCacheOwned = false;
let g_bFailed = false;
let g_Failure = undefined;

function RestoreFixtureProperty(Target, strName, Descriptor) {
	if (Descriptor) {
		Object.defineProperty(Target, strName, Descriptor);
		return;
	}

	g_Assert.ok(Reflect.deleteProperty(Target, strName), "Owned typed-command fixture property must be removable: " + strName);
}

function SetFixtureFunction(Target, strName, Callback) {
	Object.defineProperty(Target, strName, { configurable: true, enumerable: Object.getOwnPropertyDescriptor(Target, strName)?.enumerable ?? true, writable: true, value: Callback });
}

function ReleaseFixture() {
	const vecFailures = [];
	const AttemptRestoration = Restore => {
		try {
			Restore();
		} catch (ExceptionValue) {
			vecFailures.push(ExceptionValue);
		}
	};

	if (g_bEnvironmentOwned) {
		AttemptRestoration(() => RestoreFixtureProperty(process.env, "NODE_PATH", g_NodePathDescriptor));
		AttemptRestoration(() => g_OriginalInitializeModulePaths.call(g_Module));
	}

	if (g_bGlobalPathsOwned) {
		AttemptRestoration(() => RestoreFixtureProperty(g_Module, "globalPaths", g_GlobalPathsDescriptor));
	}

	if (g_bPathCacheOwned) {
		AttemptRestoration(() => RestoreFixtureProperty(g_Module, "_pathCache", g_PathCacheDescriptor));
	}

	if (g_bCacheOwned) {
		for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
			if (g_IsFixtureModulePath(strModulePath)) {
				AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, undefined));
			}
		}

		for (const [strModulePath, Descriptor] of g_mapCachedModules) {
			AttemptRestoration(() => RestoreFixtureProperty(require.cache, strModulePath, Descriptor));
		}
	}

	if (g_bRuntimeOwned) {
		AttemptRestoration(() => RestoreFixtureProperty(globalThis, "sourcejs", g_SourceJSDescriptor));
	}

	if (vecFailures.length > 0) {
		if (g_bFailed) {
			vecFailures.unshift(g_Failure);
		}

		throw new AggregateError(vecFailures, "Typed-command fixture restoration failed.");
	}
}

for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
	if (g_IsFixtureModulePath(strModulePath)) {
		g_mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
	}
}

g_Assert.ok(g_SourceJSDescriptor || Object.isExtensible(globalThis), "Typed-command runtime fixture must support installation.");
g_Assert.ok(!g_SourceJSDescriptor || g_SourceJSDescriptor.configurable, "Typed-command runtime fixture must support exact restoration.");
g_Assert.ok(Object.isExtensible(require.cache), "Typed-command package cache must support exact restoration.");
g_Assert.ok(g_GlobalPathsDescriptor?.configurable && g_PathCacheDescriptor?.configurable && (typeof g_OriginalInitializeModulePaths === "function"), "Typed-command module lookup state must support exact restoration.");

for (const Descriptor of g_mapCachedModules.values()) {
	g_Assert.equal(Descriptor.configurable, true, "Borrowed typed-command cache entries must support exact restoration.");
}

try {
	g_bCacheOwned = true;

	for (const strModulePath of g_mapCachedModules.keys()) {
		RestoreFixtureProperty(require.cache, strModulePath, undefined);
	}

	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: undefined });
	g_bRuntimeOwned = true;

	Object.defineProperty(g_Module, "globalPaths", { configurable: true, enumerable: g_GlobalPathsDescriptor.enumerable, writable: true, value: [] });
	g_bGlobalPathsOwned = true;

	Object.defineProperty(g_Module, "_pathCache", { configurable: true, enumerable: g_PathCacheDescriptor.enumerable, writable: true, value: Object.create(null) });
	g_bPathCacheOwned = true;
	g_bEnvironmentOwned = true;

	require("./smoke_commands_auth_player.js");

	const { CommandTreeStore, TypedCommandParser, TypedServerCommandRegistration } = require("../packages/sourcejs/commands/typed");
	const { CONTINUE } = require("../packages/sourcejs/commands");

	function VerifyTypedCommandInputsAndRemoval() {
		const Callback = () => CONTINUE;
		let unCases = 0;
		for (const vecCommandPath of [[], new Array(1), ["known", , "last"], [undefined], [null], [42], [""], ["two words"]]) {
			const Parser = new TypedCommandParser();
			g_Assert.throws(() => Parser.AddCommand(vecCommandPath, [], Callback), TypeError);
			g_Assert.equal(Parser.Size, 0);
			unCases += 1;
		}

		const vecInheritedPath = new Array(1);
		Object.setPrototypeOf(vecInheritedPath, Object.assign(Object.create(Array.prototype), { 0: "inherited" }));
		const vecInheritedParameters = new Array(1);
		Object.setPrototypeOf(vecInheritedParameters, Object.assign(Object.create(Array.prototype), { 0: "Inherited" }));
		for (const vecParameters of [new Array(1), ["First", , "Last"], [undefined], [null], [42], [""], [{ Name: "Value", Type: 42 }], vecInheritedParameters]) {
			const Parser = new TypedCommandParser();
			g_Assert.throws(() => Parser.AddCommand("known", vecParameters, Callback), TypeError);
			g_Assert.equal(Parser.Size, 0);
			unCases += 1;
		}

		g_Assert.throws(() => new TypedCommandParser().AddCommand(vecInheritedPath, [], Callback), TypeError);
		unCases += 1;

		for (const InvalidLength of [-1, 0.5, NaN, Infinity, "1", undefined]) {
			for (const bParameterArray of [false, true]) {
				const vecInvalidLength = new Proxy(["Value"], {
					get(Target, Property, Receiver) {
						return (Property === "length") ? InvalidLength : Reflect.get(Target, Property, Receiver);
					},
				});
				const Parser = new TypedCommandParser();
				g_Assert.throws(() => Parser.AddCommand(bParameterArray ? "known" : vecInvalidLength, bParameterArray ? vecInvalidLength : [], Callback), TypeError);
				g_Assert.equal(Parser.Size, 0);
				unCases += 1;
			}
		}

		for (const bParameterArray of [false, true]) {
			for (const FailureValue of [undefined, null, false, 0, "failure", new Error("Input access failed.")]) {
				for (const strProperty of ["length", "0"]) {
					const vecThrowingInput = new Proxy(["Value"], {
						get(Target, Property, Receiver) {
							if (Property === strProperty) {
								throw FailureValue;
							}

							return Reflect.get(Target, Property, Receiver);
						},
					});
					const Parser = new TypedCommandParser();
					let bThrew = false;
					try {
						Parser.AddCommand(bParameterArray ? "known" : vecThrowingInput, bParameterArray ? vecThrowingInput : [], Callback);
					} catch (CaughtFailure) {
						bThrew = true;
						g_Assert.equal(CaughtFailure, FailureValue);
					}

					g_Assert.equal(bThrew, true);
					g_Assert.equal(Parser.Size, 0);
					unCases += 1;
				}
			}
		}

		class InputArray extends Array {
			static get [Symbol.species]() {
				throw new Error("Array species must not be consulted.");
			}
		}

		const vecPath = new InputArray("Known", "Child");
		vecPath.slice = () => [42];
		vecPath[Symbol.iterator] = () => {
			throw new Error("Path iterator must not be consulted.");
		};

		const vecParameters = new InputArray(" Value ", { Name: "Rest", Type: Number, Rest: true, Required: false, DefaultValue: 7 });
		vecParameters.map = () => [{ Name: "Forged", Type: 42 }];

		const Parser = new TypedCommandParser();
		const Node = Parser.AddCommand(vecPath, vecParameters, Callback);
		g_Assert.deepEqual(Node.Commands, ["Known", "Child"]);
		g_Assert.equal(Object.getPrototypeOf(Node.Commands), Array.prototype);
		g_Assert.deepEqual(Node.Parameters, [
			{ Name: "Value", Type: String, Required: true, Rest: false },
			{ Name: "Rest", Type: Number, Required: false, Rest: true, DefaultValue: 7 },
		]);
		g_Assert.equal(Object.getPrototypeOf(Node.Parameters), Array.prototype);
		vecPath[0] = "changed";
		vecParameters[0] = "Changed";
		g_Assert.equal(Node.Commands[0], "Known");
		g_Assert.equal(Node.Parameters[0].Name, "Value");
		unCases += 1;

		for (const bParameterArray of [false, true]) {
			let unLengthReads = 0;
			let unSlotReads = 0;
			const vecChangingInput = new Proxy(["Value"], {
				get(Target, Property, Receiver) {
					if (Property === "length") {
						unLengthReads += 1;
						return (unLengthReads === 1) ? 1 : 0;
					}

					if (Property === "0") {
						unSlotReads += 1;
						return (unSlotReads === 1) ? "Value" : 42;
					}

					return Reflect.get(Target, Property, Receiver);
				},
			});
			const SnapshotNode = new TypedCommandParser().AddCommand(bParameterArray ? "known" : vecChangingInput, bParameterArray ? vecChangingInput : [], Callback);
			g_Assert.equal(bParameterArray ? SnapshotNode.Parameters[0].Name : SnapshotNode.Commands[0], "Value");
			g_Assert.equal(unLengthReads, 1);
			g_Assert.equal(unSlotReads, 1);
			unCases += 1;
		}

		g_Assert.throws(() => new TypedCommandParser().AddCommand("known", [{ Rest: true }, { Type: 42 }], Callback), /types must be converter functions/);
		g_Assert.throws(() => new TypedCommandParser().AddCommand("known", [{ Rest: true }, "Last"], Callback), /rest parameter in the final position/);
		unCases += 2;

		const DeepParser = new TypedCommandParser();
		const vecDeepPath = [];
		let Store = DeepParser;
		const unDepth = 20000;
		for (let unIndex = 0; unIndex < unDepth; unIndex += 1) {
			const strName = String(unIndex);
			vecDeepPath.push(strName);

			if (unIndex === (unDepth - 1)) {
				Store.SetCommand(strName, {});

			} else {
				const ChildStore = new CommandTreeStore();
				Store.SetCommand(strName, ChildStore);
				Store = ChildStore;
			}
		}

		g_Assert.equal(DeepParser.RemoveCommandPath(vecDeepPath), true);
		g_Assert.equal(DeepParser.Size, 0);
		g_Assert.throws(() => DeepParser.RemoveCommandPath(vecDeepPath), /Command does not exist/);
		unCases += 1;

		const SiblingParser = new TypedCommandParser();
		SiblingParser.AddCommand(["root", "first"], [], Callback);
		const SiblingNode = SiblingParser.AddCommand(["root", "second"], [], Callback);
		g_Assert.equal(SiblingParser.RemoveCommandPath(["root", "first"]), false);
		g_Assert.equal(SiblingParser.GetNode(["root", "second"]), SiblingNode);
		g_Assert.equal(SiblingParser.RemoveCommandPath(["root", "second"]), true);
		unCases += 1;

		console.log(`[smoke_typed_command_unload] Typed inputs/removal ${unCases} profiles passed`);
	}

	function VerifyTypedRegistrationRollback() {
		const RegisterDescriptor = Object.getOwnPropertyDescriptor(TypedServerCommandRegistration.Manager, "Register");
		const RemoveCommandDescriptor = Object.getOwnPropertyDescriptor(TypedServerCommandRegistration.Parser, "RemoveCommand");
		const OriginalRemoveCommand = TypedServerCommandRegistration.Parser.RemoveCommand;
		const vecFailures = [undefined, null, false, 0, "registration failure", new Error("Native registration failed.")];
		let unCases = 0;

		try {
			for (const RegistrationFailure of vecFailures) {
				const strRoot = `typed_snapshot_rollback_${unCases}`;
				const vecPath = [strRoot, "child"];
				let unPathReads = 0;
				Object.defineProperty(vecPath, 0, {
					get() {
						unPathReads += 1;
						return (unPathReads === 1) ? strRoot : 42;
					},
				});
				const Registration = new TypedServerCommandRegistration(vecPath);
				SetFixtureFunction(TypedServerCommandRegistration.Manager, "Register", () => {
					throw RegistrationFailure;
				});
				let bThrew = false;
				try {
					Registration.Register(() => CONTINUE);
				} catch (CaughtFailure) {
					bThrew = true;
					g_Assert.equal(CaughtFailure, RegistrationFailure);
				}

				g_Assert.equal(bThrew, true);
				g_Assert.equal(unPathReads, 1);
				g_Assert.equal(Registration.CommandNode, null);
				g_Assert.equal(TypedServerCommandRegistration.Parser.HasCommand(strRoot), false);
				g_Assert.equal(TypedServerCommandRegistration.NativeRegistrations.has(strRoot), false);
				unCases += 1;
			}

			for (const CleanupFailure of vecFailures) {
				const RegistrationFailure = new Error("Primary registration failure.");
				const strRoot = `typed_cleanup_failure_${unCases}`;
				const Registration = new TypedServerCommandRegistration([strRoot, "child"]);
				SetFixtureFunction(TypedServerCommandRegistration.Manager, "Register", () => {
					throw RegistrationFailure;
				});
				SetFixtureFunction(TypedServerCommandRegistration.Parser, "RemoveCommand", () => {
					throw CleanupFailure;
				});
				try {
					g_Assert.throws(() => Registration.Register(() => CONTINUE), (CaughtFailure) => {
						g_Assert.ok(CaughtFailure instanceof AggregateError);
						g_Assert.deepEqual(CaughtFailure.errors, [RegistrationFailure, CleanupFailure]);

						return true;
					});
					g_Assert.equal(TypedServerCommandRegistration.Parser.GetNode([strRoot, "child"]), Registration.CommandNode);
				} finally {
					RestoreFixtureProperty(TypedServerCommandRegistration.Parser, "RemoveCommand", RemoveCommandDescriptor);
					g_Assert.equal(OriginalRemoveCommand.call(TypedServerCommandRegistration.Parser, [strRoot, "child"]), true, "rollback fixture removes the complete root path");
				}

				unCases += 1;
			}
		} finally {
			RestoreFixtureProperty(TypedServerCommandRegistration.Manager, "Register", RegisterDescriptor);
			RestoreFixtureProperty(TypedServerCommandRegistration.Parser, "RemoveCommand", RemoveCommandDescriptor);
		}

		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(TypedServerCommandRegistration.Manager, "Register"), RegisterDescriptor, "rollback restores the original registration descriptor");
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(TypedServerCommandRegistration.Parser, "RemoveCommand"), RemoveCommandDescriptor, "rollback restores the original removal descriptor");

		console.log(`[smoke_typed_command_unload] Typed rollback ${unCases} profiles passed`);
	}

	VerifyTypedCommandInputsAndRemoval();
	VerifyTypedRegistrationRollback();

	const g_FirstRegistration = new TypedServerCommandRegistration(["unload_regression", "first"]);
	const g_SecondRegistration = new TypedServerCommandRegistration(["unload_regression", "second"]);
	g_FirstRegistration.Register(() => CONTINUE);
	g_SecondRegistration.Register(() => CONTINUE);

	const g_UnregisterDescriptor = Object.getOwnPropertyDescriptor(TypedServerCommandRegistration.Manager, "Unregister");
	const g_OriginalUnregister = TypedServerCommandRegistration.Manager.Unregister;
	let g_unCleanupCalls = 0;
	let g_bFailCleanup = true;

	try {
		SetFixtureFunction(TypedServerCommandRegistration.Manager, "Unregister", function UnregisterWithFailure(Registration) {
			g_unCleanupCalls += 1;

			if (g_bFailCleanup) {
				throw new Error("Injected cleanup failure.");
			}

			return g_OriginalUnregister.call(this, Registration);
		});

		g_Assert.equal(g_FirstRegistration.Unload(), true);
		g_Assert.equal(g_unCleanupCalls, 0);

		const CommandNode = g_SecondRegistration.CommandNode;

		g_Assert.throws(() => g_SecondRegistration.Unload(), /Injected cleanup failure/);
		g_Assert.equal(TypedServerCommandRegistration.Parser.GetNode(["unload_regression", "second"]), CommandNode);
		g_Assert.equal(g_SecondRegistration.CommandNode, CommandNode);

		g_bFailCleanup = false;
		g_Assert.equal(g_SecondRegistration.Unload(), true);
		g_Assert.equal(g_unCleanupCalls, 2);
		g_Assert.equal(g_SecondRegistration.Unload(), false);
	} finally {
		RestoreFixtureProperty(TypedServerCommandRegistration.Manager, "Unregister", g_UnregisterDescriptor);
	}

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(TypedServerCommandRegistration.Manager, "Unregister"), g_UnregisterDescriptor, "unload restores the original unregistration descriptor");

	// Case-insensitive sibling paths share a root without changing its native spelling.
	const g_strCaseRoot = "SourceJSTypedCaseRegression";
	const g_FirstCaseRegistration = new TypedServerCommandRegistration([g_strCaseRoot, "first"]);
	const g_SecondCaseRegistration = new TypedServerCommandRegistration([g_strCaseRoot.toLowerCase(), "second"]);
	g_FirstCaseRegistration.Register(() => CONTINUE);
	g_SecondCaseRegistration.Register(() => CONTINUE);

	const g_NativeCaseRegistration = TypedServerCommandRegistration.NativeRegistrations.get(g_strCaseRoot.toLowerCase());
	g_Assert.ok(g_NativeCaseRegistration);
	g_Assert.deepEqual(g_NativeCaseRegistration.Names, [g_strCaseRoot]);
	g_Assert.equal(g_FirstCaseRegistration.Unload(), true);
	g_Assert.equal(g_SecondCaseRegistration.Unload(), true);
	g_Assert.equal(g_SecondCaseRegistration.Unload(), false);
	g_Assert.equal(TypedServerCommandRegistration.NativeRegistrations.has(g_strCaseRoot.toLowerCase()), false);
} catch (ExceptionValue) {
	g_Failure = ExceptionValue;
	g_bFailed = true;
} finally {
	ReleaseFixture();
}

if (g_bFailed) {
	throw g_Failure;
}

console.log("[smoke_typed_command_unload] ok");
