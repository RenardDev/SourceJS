#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strEntityHooksPath = g_Path.join(g_strPackageRootPath, "memory", "hooks", "entities.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory-hooks-entities.md");
const g_strBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");

const g_vecExpectedExports = [
	"AddPostEntityHook",
	"AddPreEntityHook",
	"CallFunction",
	"CreateEntityHook",
	"CreateEntityVTableHook",
	"GetHookList",
	"GetHooksDisabled",
	"RemoveAllHooks",
	"RemoveHook",
	"SetHooksDisabled",
];

const g_vecNativeCalls = [];
const g_mapHookRecords = new Map();
const g_mapHookIDsByKey = new Map();

let g_bDisabled = false;
let g_unNextHookID = 1;

function GetHeadingAnchor(strHeading) {
	return strHeading.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function VerifyContentsAnchors(strMarkdown) {
	const vecContentsMatch = strMarkdown.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(vecContentsMatch, "memory/hooks/entities contents section");

	const vecDocumentedAnchors = [...vecContentsMatch[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const vecSectionAnchors = [...strMarkdown.matchAll(/^## (.+)$/gm)].map((vecMatch) => GetHeadingAnchor(vecMatch[1])).filter((strAnchor) => strAnchor !== "contents");

	g_Assert.deepEqual(vecDocumentedAnchors, vecSectionAnchors, "memory/hooks/entities contents anchors");
}

function VerifyDocumentationLinks(strMarkdown) {
	const strDocumentationWithoutCode = strMarkdown.replace(/```[\s\S]*?```/g, "");
	const vecLinks = [...strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `memory/hooks/entities documentation link must exist: ${strTarget}`);
	}
}

function InstallDependency(strModulePath, ModuleExports) {
	delete require.cache[strModulePath];
	require.cache[strModulePath] = {
		exports: ModuleExports,
		filename: strModulePath,
		id: strModulePath,
		loaded: true,
	};
}

function ReadCreateOptions(vecArguments) {
	// Model documented positional writes only; entity resolution and ABI validation remain native responsibilities.
	if ((vecArguments.length >= 3) && (typeof vecArguments[1] === "number") && vecArguments[2] && (typeof vecArguments[2] === "object")) {
		const Options = vecArguments[2];
		Options.Entity = vecArguments[0];
		Options.Index = vecArguments[1];
		return Options;
	}

	if ((vecArguments.length >= 2) && (typeof vecArguments[1] === "number")) {
		return { Entity: vecArguments[0], Index: vecArguments[1] };
	}

	if ((vecArguments.length >= 2) && vecArguments[1] && (typeof vecArguments[1] === "object")) {
		const Options = vecArguments[1];
		Options.Entity = vecArguments[0];
		return Options;
	}

	if ((vecArguments.length >= 1) && vecArguments[0] && (typeof vecArguments[0] === "object")) {
		return vecArguments[0];
	}

	throw new Error("memory/hooks/entities.CreateEntityHook(Options) expects hook options.");
}

function GetHookKey(Options, bForceVTable) {
	let strKind = bForceVTable ? "VTABLE" : "";
	if (!bForceVTable && (typeof Options.Kind === "string")) {
		strKind = Options.Kind.toUpperCase();
	}

	if ((strKind !== "VTABLE") && (strKind !== "FUNCTION")) {
		const bHasAddress = (Options.Address !== undefined) && (Options.Address !== null);
		const bHasEntity = (Options.Entity !== undefined) && (Options.Entity !== null);
		const bHasObjectAddress = (Options.ObjectAddress !== undefined) && (Options.ObjectAddress !== null);
		strKind = (!bHasAddress && (bHasEntity || bHasObjectAddress)) ? "VTABLE" : "FUNCTION";
	}

	return (strKind === "VTABLE") ? `${strKind}:${Options.ObjectAddress ?? Options.Entity}:${Options.Index ?? Options.Offset ?? 0}` : `${strKind}:${Options.Address}`;
}

function RemoveHookRecord(unHookID) {
	const HookRecord = g_mapHookRecords.get(unHookID);
	if (!HookRecord) {
		return false;
	}

	g_mapHookRecords.delete(unHookID);
	g_mapHookIDsByKey.delete(HookRecord.Key);

	return true;
}

function RemoveHook(unHookID) {
	g_vecNativeCalls.push(["RemoveHook", unHookID]);

	return RemoveHookRecord(unHookID);
}

function MakeHook(HookRecord) {
	return {
		ID: HookRecord.ID,
		Address: HookRecord.Address,
		TrampolineAddress: HookRecord.TrampolineAddress,
		Post(Callback) {
			HookRecord.PostCallbacks.add(Callback);

			return true;
		},

		Pre(Callback) {
			HookRecord.PreCallbacks.add(Callback);

			return true;
		},

		Remove() {
			return RemoveHook(HookRecord.ID);
		},

		RemovePost(Callback) {
			return HookRecord.PostCallbacks.delete(Callback);
		},

		RemovePre(Callback) {
			return HookRecord.PreCallbacks.delete(Callback);
		},
	};
}

function CreateHook(bForceVTable, vecArguments) {
	const Options = ReadCreateOptions(vecArguments);
	if (Options.Entity === -1) {
		return null;
	}

	const strKey = GetHookKey(Options, bForceVTable);
	const unExistingHookID = g_mapHookIDsByKey.get(strKey);
	if (unExistingHookID !== undefined) {
		return MakeHook(g_mapHookRecords.get(unExistingHookID));
	}

	const unID = g_unNextHookID;
	g_unNextHookID += 1;

	const HookRecord = {
		ID: unID,
		Key: strKey,
		Options,
		Address: 0x500000n + (BigInt(unID) * 0x100n),
		PostCallbacks: new Set(),
		PreCallbacks: new Set(),
		TrampolineAddress: 0x600000n + (BigInt(unID) * 0x100n),
	};

	g_mapHookRecords.set(unID, HookRecord);
	g_mapHookIDsByKey.set(strKey, unID);

	return MakeHook(HookRecord);
}

function RegisterCallback(strHookType, vecArguments) {
	const Callback = vecArguments[vecArguments.length - 1];
	if (typeof Callback !== "function") {
		throw new Error(`memory/hooks/entities.${strHookType}(Options, Callback) expects hook options and callback.`);
	}

	const Hook = CreateHook(false, vecArguments.slice(0, -1));
	if (!Hook) {
		return false;
	}

	return Hook[strHookType](Callback);
}

const g_NativeEntityHooks = {
	CallFunction(Options) {
		g_vecNativeCalls.push(["CallFunction", Options]);

		return Options.ReturnContext ? { Registers: { EAX: 77n }, ReturnValue: 77 } : 77;
	},

	CreateEntityHook(...vecArguments) {
		g_vecNativeCalls.push(["CreateEntityHook", vecArguments]);

		return CreateHook(false, vecArguments);
	},

	CreateEntityVTableHook(...vecArguments) {
		g_vecNativeCalls.push(["CreateEntityVTableHook", vecArguments]);

		return CreateHook(true, vecArguments);
	},

	GetHooksDisabled() {
		g_vecNativeCalls.push(["GetHooksDisabled"]);

		return g_bDisabled;
	},

	GetHookList() {
		g_vecNativeCalls.push(["GetHookList"]);

		return Array.from(g_mapHookRecords.values()).map((HookRecord) => ({
			ID: HookRecord.ID,
			Address: HookRecord.Address,
			TrampolineAddress: HookRecord.TrampolineAddress,
		}));
	},

	AddPostEntityHook(...vecArguments) {
		g_vecNativeCalls.push(["AddPostEntityHook", vecArguments]);

		return RegisterCallback("Post", vecArguments);
	},

	AddPreEntityHook(...vecArguments) {
		g_vecNativeCalls.push(["AddPreEntityHook", vecArguments]);

		return RegisterCallback("Pre", vecArguments);
	},

	RemoveHook,

	RemoveAllHooks() {
		g_vecNativeCalls.push(["RemoveAllHooks"]);
		g_mapHookRecords.clear();
		g_mapHookIDsByKey.clear();

		return true;
	},

	SetHooksDisabled(bValue) {
		g_vecNativeCalls.push(["SetHooksDisabled", bValue]);
		g_bDisabled = Boolean(bValue);

		return g_bDisabled;
	},
};

function LoadEntityHooks() {
	const vecCacheSnapshots = [g_strEntityHooksPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
	const OriginalModuleLoad = g_Module._load;

	try {
		for (const CacheSnapshot of vecCacheSnapshots) {
			delete require.cache[CacheSnapshot.Path];
		}

		InstallDependency(g_strRuntimePath, {
			GetRawModule(strModuleName) {
				g_Assert.equal(strModuleName, "memory/hooks/entities", "entity hook wrapper raw native module name");

				return g_NativeEntityHooks;
			},
		});
		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return OriginalModuleLoad.call(this, g_strRuntimePath, ParentModule, bIsMain);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strEntityHooksPath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		for (const CacheSnapshot of vecCacheSnapshots.reverse()) {
			if (CacheSnapshot.Descriptor === undefined) {
				delete require.cache[CacheSnapshot.Path];

			} else {
				Object.defineProperty(require.cache, CacheSnapshot.Path, CacheSnapshot.Descriptor);
			}
		}
	}
}

function VerifyNativeBindings(strBindingsSource) {
	const strBegin = "v8::Local<v8::Object> const LocalMemoryEntityHooksModule = MakeModule(pIsolate);";
	const strEnd = "v8::Local<v8::Object> const LocalEntityClassesModule = MakeModule(pIsolate);";
	const nBegin = strBindingsSource.indexOf(strBegin);
	g_Assert.ok(nBegin >= 0, "native entity hook module section begin");
	g_Assert.equal(strBindingsSource.indexOf(strBegin, nBegin + strBegin.length), -1, "native entity hook module section is unique");

	const nEnd = strBindingsSource.indexOf(strEnd, nBegin + strBegin.length);
	g_Assert.ok(nEnd > nBegin, "native entity hook module section end");

	const strModuleSource = strBindingsSource.slice(nBegin, nEnd);
	const vecRegistrations = [...strModuleSource.matchAll(/!SetFunction\(pIsolate, LocalContext, LocalMemoryEntityHooksModule, "([^"]+)", (\w+), LocalRuntimeData\)/g)];
	g_Assert.deepEqual(vecRegistrations.map((vecMatch) => vecMatch[1]).sort(), g_vecExpectedExports, "native entity hook exact registrations within module section");

	for (const vecRegistration of vecRegistrations) {
		g_Assert.equal(vecRegistration[2], `${vecRegistration[1]}Callback`, `native entity hook callback: ${vecRegistration[1]}`);
	}

	g_Assert.ok(strModuleSource.includes('!InstallModule(pIsolate, LocalContext, LocalSourceJS, "memory/hooks/entities", LocalMemoryEntityHooksModule)'), "native entity hook module installation within section");
}

function VerifyDocumentationOutcome(Callback, vecExpectedErrors, ExpectedResult) {
	let bThrew = false;
	let CaughtValue = undefined;
	let ActualResult = undefined;

	try {
		ActualResult = Callback();
	} catch (CaughtError) {
		bThrew = true;
		CaughtValue = CaughtError;
	}

	g_Assert.equal(bThrew, vecExpectedErrors.length !== 0, "documented workflow failure state");

	if (!bThrew) {
		g_Assert.equal(ActualResult, ExpectedResult, "documented workflow preserves its result");
		return;
	}

	if (vecExpectedErrors.length > 1) {
		g_Assert.ok(CaughtValue instanceof AggregateError, "multiple failures remain observable");
	}

	const vecActualErrors = (vecExpectedErrors.length > 1) ? CaughtValue.errors : [CaughtValue];
	g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length, "documented failure count");

	for (let unIndex = 0; unIndex < vecExpectedErrors.length; ++unIndex) {
		const ExpectedError = vecExpectedErrors[unIndex];
		if (Object.hasOwn(ExpectedError, "Value")) {
			g_Assert.equal(vecActualErrors[unIndex], ExpectedError.Value, "original thrown value and failure order");

		} else {
			g_Assert.ok(vecActualErrors[unIndex] instanceof Error, "failed status becomes an explicit error");
			g_Assert.equal(vecActualErrors[unIndex].message, ExpectedError.Message, "failed operation diagnostic");
		}
	}
}

function VerifyObserverDocumentationFailures(strCode) {
	const vecThrownValues = [new Error("controlled observer cleanup failure"), null, undefined, 0, false];
	const vecRemovalModes = [{ Kind: "RETURN", Value: true }, { Kind: "RETURN", Value: false }];
	for (const Value of vecThrownValues) {
		vecRemovalModes.push({ Kind: "THROW_BEFORE", Value }, { Kind: "THROW_AFTER", Value });
	}

	let unCaseCount = 0;
	for (const strRegistrationMode of [
		"COMPLETE",
		"PRE_FALSE",
		"PRE_THROW",
		"POST_FALSE",
		"POST_THROW",
		"PRE_DEFINITION_THROW",
		"POST_DEFINITION_THROW",
	]) {
		for (const PostMode of vecRemovalModes) {
			for (const PreMode of vecRemovalModes) {
				const RegistrationError = new Error("controlled observer registration failure");
				const vecCalls = [];
				const OnPre = () => undefined;
				const OnPost = () => undefined;
				const IndependentCallback = () => undefined;
				const setPreCallbacks = new Set([IndependentCallback]);
				const setPostCallbacks = new Set([IndependentCallback]);
				const vecExpectedErrors = [];
				const bPreRegistered = !["PRE_FALSE", "PRE_THROW", "PRE_DEFINITION_THROW"].includes(strRegistrationMode);
				const bPostRegistered = strRegistrationMode === "COMPLETE";
				let unDefinitionReadCount = 0;

				const RemoveCallback = (strPhase, Callback, Mode, setCallbacks) => {
					vecCalls.push(strPhase);
					g_Assert.equal(Callback, (strPhase === "Post") ? OnPost : OnPre, "remove only this workflow's callback");

					if (Mode.Kind === "THROW_BEFORE") {
						throw Mode.Value;
					}

					if ((Mode.Kind === "THROW_AFTER") || Mode.Value) {
						setCallbacks.delete(Callback);
					}

					if (Mode.Kind === "THROW_AFTER") {
						throw Mode.Value;
					}

					return Mode.Value;
				};
				const Hook = {
					RemovePost: Callback => RemoveCallback("Post", Callback, PostMode, setPostCallbacks),
					RemovePre: Callback => RemoveCallback("Pre", Callback, PreMode, setPreCallbacks),
				};
				const Runtime = {
					CreateEntityVTableHook: () => Hook,
					AddPreEntityHook(...vecArguments) {
						const Callback = vecArguments[3];
						if (strRegistrationMode === "PRE_THROW") {
							throw RegistrationError;
						}

						if (strRegistrationMode === "PRE_FALSE") {
							return false;
						}

						setPreCallbacks.add(Callback);

						return true;
					},

					AddPostEntityHook(...vecArguments) {
						const Callback = vecArguments[3];
						if (strRegistrationMode === "POST_THROW") {
							throw RegistrationError;
						}

						if (strRegistrationMode === "POST_FALSE") {
							return false;
						}

						setPostCallbacks.add(Callback);

						return true;
					},
				};
				const Definition = {
					get Arguments() {
						++unDefinitionReadCount;

						if (((strRegistrationMode === "PRE_DEFINITION_THROW") && (unDefinitionReadCount === 2)) || ((strRegistrationMode === "POST_DEFINITION_THROW") && (unDefinitionReadCount === 3))) {
							throw RegistrationError;
						}

						return [];
					},
				};
				const ModuleRecord = { exports: {} };
				const DocumentationRequire = strModuleName => {
					g_Assert.equal(strModuleName, "memory/hooks/entities");

					return Runtime;
				};
				const Script = new g_VM.Script(`(function (require, module) {\n${strCode}\n})`);
				Script.runInThisContext()(DocumentationRequire, ModuleRecord);

				if (strRegistrationMode !== "COMPLETE") {
					vecExpectedErrors.push(strRegistrationMode.endsWith("FALSE") ? { Message: `Entity ${strRegistrationMode.startsWith("PRE") ? "pre" : "post"} callback registration failed.` } : { Value: RegistrationError });
				}

				for (const [strPhase, bRegistered, Mode] of [["Post", bPostRegistered, PostMode], ["Pre", bPreRegistered, PreMode]]) {
					if (bRegistered && ((Mode.Kind !== "RETURN") || !Mode.Value)) {
						vecExpectedErrors.push((Mode.Kind === "RETURN") ? { Message: `Entity ${strPhase.toLowerCase()} callback removal failed.` } : { Value: Mode.Value });
					}
				}

				let Observers = null;
				const Execute = () => {
					Observers = ModuleRecord.exports.RegisterEntityMethodObservers(1, 0, Definition, OnPre, OnPost);

					return Observers.Dispose();
				};
				const bRemovalThrows = (PostMode.Kind !== "RETURN") || (PreMode.Kind !== "RETURN");
				const vecReportedErrors = ((strRegistrationMode === "COMPLETE") && !bRemovalThrows) ? [] : vecExpectedErrors;
				VerifyDocumentationOutcome(Execute, vecReportedErrors, (PostMode.Value === true) && (PreMode.Value === true));
				g_Assert.deepEqual(vecCalls, [...(bPostRegistered ? ["Post"] : []), ...(bPreRegistered ? ["Pre"] : [])], "attempt all confirmed removals in reverse registration order");
				g_Assert.equal(setPreCallbacks.has(IndependentCallback) && setPostCallbacks.has(IndependentCallback), true, "preserve unrelated callbacks");

				if (Observers !== null) {
					const unRemovalCount = vecCalls.length;
					g_Assert.equal(Observers.Hook, Hook, "preserve the shared native handle");
					g_Assert.equal(Observers.Dispose(), false, "Dispose remains one-shot even after a thrown removal");
					g_Assert.equal(vecCalls.length, unRemovalCount, "do not retry failed removals implicitly");
				}

				++unCaseCount;
			}
		}
	}

	g_Assert.equal(unCaseCount, 1008, "observer documentation failure matrix coverage");
}

function VerifyDispatchDocumentationFailures(strCode) {
	const vecThrownValues = [new Error("controlled dispatch failure"), null, undefined, 0, false];
	const vecSetterModes = [{ Kind: "SUCCESS" }, { Kind: "WRONG_BEFORE" }, { Kind: "WRONG_AFTER" }];
	const CallbackObject = {};
	const vecCallbackModes = [CallbackObject, undefined, null, false, 0, 42n, "result"].map(Value => ({ Kind: "RETURN", Value }));
	for (const Value of vecThrownValues) {
		vecSetterModes.push({ Kind: "THROW_BEFORE", Value }, { Kind: "THROW_AFTER", Value });
		vecCallbackModes.push({ Kind: "THROW", Value });
	}

	const Script = new g_VM.Script(`(function (require, module) {\n${strCode}\n})`);
	const LoadDocumentation = Script.runInThisContext();
	let unCaseCount = 0;
	for (const bInitialDisabled of [false, true]) {
		for (const bRequestedDisabled of [false, true]) {
			for (const SetupMode of vecSetterModes) {
				for (const RestoreMode of vecSetterModes) {
					for (const CallbackMode of vecCallbackModes) {
						const vecSetterCalls = [];
						const vecExpectedErrors = [];
						let bCurrentDisabled = bInitialDisabled;
						let bCallbackCalled = false;
						const Runtime = {
							GetHooksDisabled: () => bCurrentDisabled,
							SetHooksDisabled(bDisabled) {
								const Mode = (vecSetterCalls.length === 0) ? SetupMode : RestoreMode;
								vecSetterCalls.push(bDisabled);

								if (Mode.Kind === "THROW_BEFORE") {
									throw Mode.Value;
								}

								if (!Mode.Kind.endsWith("_BEFORE")) {
									bCurrentDisabled = bDisabled;
								}

								if (Mode.Kind === "THROW_AFTER") {
									throw Mode.Value;
								}

								return Mode.Kind.startsWith("WRONG_") ? !bDisabled : bDisabled;
							},
						};
						const Callback = () => {
							bCallbackCalled = true;
							g_Assert.equal(bCurrentDisabled, bRequestedDisabled, "callback sees the requested dispatch state");

							if (CallbackMode.Kind === "THROW") {
								throw CallbackMode.Value;
							}

							return CallbackMode.Value;
						};
						const DocumentationRequire = strModuleName => {
							g_Assert.equal(strModuleName, "memory/hooks/entities");

							return Runtime;
						};
						const ModuleRecord = { exports: {} };
						LoadDocumentation(DocumentationRequire, ModuleRecord);

						if (SetupMode.Kind.startsWith("THROW_")) {
							vecExpectedErrors.push({ Value: SetupMode.Value });

						} else if (SetupMode.Kind.startsWith("WRONG_")) {
							vecExpectedErrors.push({ Message: "Entity hook dispatch state did not change." });

						} else if (CallbackMode.Kind === "THROW") {
							vecExpectedErrors.push({ Value: CallbackMode.Value });
						}

						if (RestoreMode.Kind.startsWith("THROW_")) {
							vecExpectedErrors.push({ Value: RestoreMode.Value });

						} else if (RestoreMode.Kind.startsWith("WRONG_")) {
							vecExpectedErrors.push({ Message: "Entity hook dispatch state did not restore." });
						}

						VerifyDocumentationOutcome(() => ModuleRecord.exports.WithEntityHookDispatchDisabled(Callback, bRequestedDisabled), vecExpectedErrors, CallbackMode.Value);
						g_Assert.equal(bCallbackCalled, SetupMode.Kind === "SUCCESS", "do not invoke the callback after a failed setup");
						g_Assert.deepEqual(vecSetterCalls, [bRequestedDisabled, bInitialDisabled], "one setup and exactly one restoration attempt");
						const bExpectedState = RestoreMode.Kind.endsWith("_BEFORE") ? (SetupMode.Kind.endsWith("_BEFORE") ? bInitialDisabled : bRequestedDisabled) : bInitialDisabled;
						g_Assert.equal(bCurrentDisabled, bExpectedState, "a failed restoration may retain the requested process-wide state");
						++unCaseCount;
					}
				}
			}
		}
	}

	for (const Value of vecThrownValues) {
		const ModuleRecord = { exports: {} };
		const Runtime = {
			GetHooksDisabled() {
				throw Value;
			},

			SetHooksDisabled() {
				g_Assert.fail("no state update after a failed initial state read");
			},
		};
		LoadDocumentation(() => Runtime, ModuleRecord);
		VerifyDocumentationOutcome(() => ModuleRecord.exports.WithEntityHookDispatchDisabled(() => g_Assert.fail("callback after failed read")), [{ Value }]);
		++unCaseCount;
	}

	g_Assert.equal(unCaseCount, 8117, "dispatch documentation failure matrix coverage");
}

function RunSmoke() {
	const unDocumentationTimeoutMilliseconds = 1000;

	const EntityHooks = LoadEntityHooks();

	function DocumentationRequire(strModuleName) {
		if (strModuleName === "memory/hooks/entities") {
			return EntityHooks;
		}

		throw new Error(`unexpected memory/hooks/entities documentation module ${strModuleName}`);
	}

	try {
		g_Assert.equal(EntityHooks, g_NativeEntityHooks, "entity hook facade preserves the raw native module identity");
		g_Assert.deepEqual(Object.keys(EntityHooks).sort(), g_vecExpectedExports, "memory/hooks/entities exact exports");
		g_Assert.equal(Object.hasOwn(EntityHooks, "default"), false, "memory/hooks/entities must not expose a default alias.");
		g_Assert.equal(EntityHooks.CreateEntityHook(-1, 4, { Convention: "thiscall" }), null, "unresolved entity create result");
		g_Assert.equal(EntityHooks.AddPreEntityHook(-1, 4, { Convention: "thiscall" }, () => undefined), false, "unresolved entity pre result");
		g_Assert.equal(EntityHooks.GetHooksDisabled(), false, "initial dispatch state");
		g_Assert.equal(EntityHooks.SetHooksDisabled(true), true, "dispatch disable result");
		g_Assert.equal(EntityHooks.SetHooksDisabled(false), false, "dispatch restore result");
		g_Assert.equal(EntityHooks.GetHookList().length, 0, "direct checks leave no hooks");

		const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
		const vecCodeBlocks = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

		g_Assert.equal(vecCodeBlocks.length, 5, "memory/hooks/entities documentation workflow count");
		g_Assert.ok(!strDocumentation.includes("Generated by"), "memory/hooks/entities documentation must be maintained by hand.");
		g_Assert.ok(strDocumentation.includes("process hook registry"), "memory/hooks/entities docs must describe shared registry ownership.");
		g_Assert.ok(strDocumentation.includes("Payload.CallHookTrampoline"), "memory/hooks/entities docs must describe trampoline access.");
		g_Assert.ok(strDocumentation.includes("Native addresses must be JavaScript `BigInt` values"), "memory/hooks/entities docs must require BigInt addresses.");
		g_Assert.ok(strDocumentation.includes("they are not `Number` values or strings"), "memory/hooks/entities docs must reject Number and string native addresses.");
		g_Assert.ok(!strDocumentation.includes("console."), "memory/hooks/entities documentation must not depend on console-only inspection.");
		g_Assert.ok(!/[^\x00-\x7F]/.test(strDocumentation), "memory/hooks/entities documentation must remain valid ASCII.");
		VerifyContentsAnchors(strDocumentation);
		VerifyDocumentationLinks(strDocumentation);
		VerifyObserverDocumentationFailures(vecCodeBlocks[2]);
		VerifyDispatchDocumentationFailures(vecCodeBlocks[3]);

		g_vecNativeCalls.length = 0;

		const vecDocumentationModules = [];
		for (let unIndex = 0; unIndex < vecCodeBlocks.length; ++unIndex) {
			const ModuleRecord = { exports: {} };
			const Script = new g_VM.Script(`(function (require, module, exports) {\n${vecCodeBlocks[unIndex]}\n})`, { filename: `memory-hooks-entities.md:${unIndex + 1}` });
			const Callback = Script.runInThisContext();
			const Context = g_VM.createContext({ Callback, DocumentationRequire, ModuleRecord });
			const Invocation = new g_VM.Script("Callback(DocumentationRequire, ModuleRecord, ModuleRecord.exports);", { filename: `memory-hooks-entities.md:${unIndex + 1}:execute` });
			Invocation.runInContext(Context, { timeout: unDocumentationTimeoutMilliseconds });

			vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecNativeCalls.length, 0, "memory/hooks/entities examples must not touch native hooks during block load.");
		g_Assert.deepEqual(Object.keys(vecDocumentationModules[0]), [], "documented import block has no workflow export");

		const Definition = {
			Arguments: ["address"],
			Convention: "thiscall",
			ReturnType: "void",
		};
		const AutomaticHook = vecDocumentationModules[1].CreateAutomaticEntityHook(1, 10, Definition);
		const EntityHook = vecDocumentationModules[1].CreateEntityVTableHook(2, 11, Definition);

		g_Assert.equal(typeof AutomaticHook.Address, "bigint");
		g_Assert.equal(typeof EntityHook.TrampolineAddress, "bigint");
		g_Assert.ok((AutomaticHook.ID > 0) && (AutomaticHook.Address > 0n), "documented automatic entity hook");
		g_Assert.ok((EntityHook.ID > 0) && (EntityHook.TrampolineAddress > 0n), "documented forced entity hook");
		g_Assert.equal(AutomaticHook.Remove(), true, "documented automatic hook cleanup");
		g_Assert.equal(EntityHook.Remove(), true, "documented forced hook cleanup");

		function ObservePre() {
		}

		function ObservePost() {
		}

		function ObserveIndependentPre() {
		}

		const Observers = vecDocumentationModules[2].RegisterEntityMethodObservers(3, 12, Definition, ObservePre, ObservePost);
		const ObserverRecord = g_mapHookRecords.get(Observers.Hook.ID);

		g_Assert.deepEqual(Object.keys(Observers).sort(), ["Dispose", "Hook"], "documented observer handle");
		g_Assert.ok(ObserverRecord.PreCallbacks.has(ObservePre), "documented pre callback registration");
		g_Assert.ok(ObserverRecord.PostCallbacks.has(ObservePost), "documented post callback registration");
		g_Assert.equal(Observers.Hook.Pre(ObserveIndependentPre), true, "independent pre callback registration");
		g_Assert.equal(Observers.Dispose(), true, "documented observer cleanup");
		g_Assert.equal(ObserverRecord.PreCallbacks.has(ObservePre), false, "observer cleanup removes its pre callback");
		g_Assert.equal(ObserverRecord.PostCallbacks.has(ObservePost), false, "observer cleanup removes its post callback");
		g_Assert.equal(ObserverRecord.PreCallbacks.has(ObserveIndependentPre), true, "observer cleanup preserves independent callbacks");
		g_Assert.equal(Observers.Dispose(), false, "observer cleanup is idempotent");
		g_Assert.equal(EntityHooks.GetHookList().length, 1, "observer cleanup preserves the process-owned hook");
		g_Assert.equal(Observers.Hook.RemovePre(ObserveIndependentPre), true, "independent callback cleanup");
		g_Assert.equal(Observers.Hook.Remove(), true, "explicit process-owned hook cleanup");
		g_Assert.equal(EntityHooks.GetHookList().length, 0, "documented observer cleanup registry");

		const RegistryHook = vecDocumentationModules[1].CreateEntityVTableHook(4, 13, Definition);
		const vecRegistrySnapshot = EntityHooks.GetHookList();
		g_Assert.equal(typeof vecRegistrySnapshot[0].ID, "number", "hook IDs are not native addresses");
		g_Assert.equal(typeof vecRegistrySnapshot[0].Address, "bigint", "registry addresses are BigInt");
		g_Assert.equal(typeof vecRegistrySnapshot[0].TrampolineAddress, "bigint", "registry trampoline addresses are BigInt");
		vecRegistrySnapshot[0].ID = -1;
		vecRegistrySnapshot[0].Address = 0n;
		vecRegistrySnapshot[0].TrampolineAddress = 0n;
		vecRegistrySnapshot.length = 0;

		g_Assert.deepEqual(vecDocumentationModules[3].InspectEntityHookRegistry().map((Entry) => Entry.ID), [RegistryHook.ID], "documented registry inspection");
		g_Assert.equal(EntityHooks.GetHookList()[0].Address, RegistryHook.Address, "registry snapshot edits preserve live addresses");
		g_Assert.equal(EntityHooks.GetHookList()[0].TrampolineAddress, RegistryHook.TrampolineAddress, "registry snapshot edits preserve live trampolines");
		g_Assert.equal(vecDocumentationModules[3].WithEntityHookDispatchDisabled(() => EntityHooks.GetHooksDisabled()), true, "documented disabled callback state");
		g_Assert.equal(EntityHooks.GetHooksDisabled(), false, "documented dispatch state restoration");

		const DispatchError = new Error("entity hook dispatch callback failed");
		const FailDispatch = () => {
			throw DispatchError;
		};
		g_Assert.throws(() => vecDocumentationModules[3].WithEntityHookDispatchDisabled(FailDispatch), (CaughtError) => CaughtError === DispatchError, "documented dispatch callback error identity");
		g_Assert.equal(EntityHooks.GetHooksDisabled(), false, "documented dispatch state restoration after callback error");
		g_Assert.equal(vecDocumentationModules[3].RemoveEntityHook(RegistryHook.ID), true, "documented single-hook removal");

		const FirstBulkHook = vecDocumentationModules[1].CreateEntityVTableHook(5, 14, Definition);
		const SecondBulkHook = vecDocumentationModules[1].CreateEntityVTableHook(6, 15, Definition);

		g_Assert.equal(vecDocumentationModules[3].RemoveEveryMemoryHook([FirstBulkHook.ID, SecondBulkHook.ID]), true, "documented guarded RemoveAllHooks");

		const CallHook = vecDocumentationModules[1].CreateEntityVTableHook(7, 16, Definition);
		g_Assert.throws(() => vecDocumentationModules[4].CallEntityHookTarget({ Address: 0x700000 }, {}), /BigInt address/, "documented caller rejects legacy Number addresses");

		const Invocation = vecDocumentationModules[4].CallEntityHookTarget(CallHook, {
			Arguments: [0x700000n],
			Convention: "thiscall",
			ReturnContext: true,
			ReturnType: "int",
		});

		g_Assert.equal(Invocation.ReturnValue, 77, "documented ABI call return value");
		g_Assert.equal(Invocation.Registers.EAX, 77n, "documented ABI call register context");
		g_Assert.equal(g_vecNativeCalls.findLast((vecCallRecord) => vecCallRecord[0] === "CallFunction")[1].Address, CallHook.Address, "documented ABI call target address");
		g_Assert.equal(CallHook.Remove(), true, "documented call hook cleanup");
		g_Assert.equal(EntityHooks.GetHookList().length, 0, "documentation leaves the shared hook registry empty");
		g_Assert.equal(EntityHooks.GetHooksDisabled(), false, "documentation restores callback dispatch state");

		const unExactCallAddress = 0xFEDCBA9876543210n;
		const vecExactCallArguments = [0xFEDCBA9876543220n];
		const ExactInvocation = vecDocumentationModules[4].CallEntityHookTarget({ Address: unExactCallAddress }, { Arguments: vecExactCallArguments, Convention: "thiscall", ReturnContext: true, ReturnType: "int" });
		const vecExactNativeCall = g_vecNativeCalls.at(-1);
		g_Assert.equal(vecExactNativeCall[0], "CallFunction", "high-address invocation reaches the native boundary double");
		g_Assert.equal(vecExactNativeCall[1].Address, unExactCallAddress, "documented caller preserves the exact high BigInt target");
		g_Assert.deepEqual(vecExactNativeCall[1].Arguments, vecExactCallArguments, "documented caller preserves exact high BigInt arguments");
		g_Assert.equal(ExactInvocation.ReturnValue, 77, "high-address invocation preserves the controlled result");
		g_Assert.equal(ExactInvocation.Registers.EAX, 77n, "high-address invocation preserves the controlled register context");

		const strPackageSource = g_FileSystem.readFileSync(g_strEntityHooksPath, "utf8");
		const strBindingsSource = g_FileSystem.readFileSync(g_strBindingsPath, "utf8");

		g_Assert.ok(strPackageSource.includes('GetRawModule("memory/hooks/entities")'), "entity hook package must load the direct native module.");
		VerifyNativeBindings(strBindingsSource);
	} finally {
		g_mapHookRecords.clear();
		g_mapHookIDsByKey.clear();
		g_vecNativeCalls.length = 0;
		g_bDisabled = false;
		g_unNextHookID = 1;
	}
}

RunSmoke();

console.log("[  OK  ] memory hooks entities smoke passed with native doubles; native hook/ABI execution not exercised");
