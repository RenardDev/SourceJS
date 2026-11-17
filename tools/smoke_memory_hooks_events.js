#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory-hooks-events.md");
const g_strEventsHooksPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "hooks", "events.js");
const g_strMemoryHooksPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "hooks.js");
const g_strRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");

const g_unManagerAddress = 0x1000n;
const g_nMinimumInt32 = -0x80000000;
const g_nMaximumInt32 = 0x7FFFFFFF;
const g_unMaximumUInt64 = 0xFFFFFFFFFFFFFFFFn;
const g_dblMaximumFloat = 3.4028234663852886e38;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unFXStateByteCount = 512;
const g_unFPURegisterByteCount = 10;
const g_unFPURegisterCount = 8;
const g_unXMMRegisterByteCount = 16;
const g_vecMinimumExports = [
	"EventAction",
	"ClearPreEvents",
	"EnsurePreEventHook",
	"EventInfo",
	"EventName",
	"EventAddress",
	"Fire",
	"FireEventHookOptions",
	"FreeEvent",
	"GetBool",
	"GetFloat",
	"GetInt",
	"GetPreEventHook",
	"GetString",
	"IsEmpty",
	"IsPreEventHookInstalled",
	"ManagerAddress",
	"Off",
	"OffPre",
	"On",
	"OnPre",
	"RemovePreEventHook",
	"SetBool",
	"SetFloat",
	"SetInt",
	"SetString",
];
const g_vecMaximumExports = [...g_vecMinimumExports, "GetUInt64", "SetUInt64"].sort();

function InstallDependency(strModulePath, Dependency) {
	delete require.cache[strModulePath];
	require.cache[strModulePath] = {
		exports: Dependency,
		filename: strModulePath,
		id: strModulePath,
		loaded: true,
	};
}

function LoadEventsHooks(NativeEvents, MemoryHooks) {
	const BridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const vecCacheSnapshots = [g_strEventsHooksPath, g_strMemoryHooksPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
	const OriginalModuleLoad = g_Module._load;

	try {
		for (const CacheSnapshot of vecCacheSnapshots) {
			delete require.cache[CacheSnapshot.Path];
		}

		const SourceJS = (NativeEvents === undefined) ? {} : { "memory/hooks/events": NativeEvents };
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: SourceJS });
		InstallDependency(g_strMemoryHooksPath, MemoryHooks);
		g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return OriginalModuleLoad.call(this, g_strRuntimePath, ParentModule, bIsMain);
			}

			if (strRequestName === "memory/hooks") {
				return OriginalModuleLoad.call(this, g_strMemoryHooksPath, ParentModule, bIsMain);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		};

		return require(g_strEventsHooksPath);
	} finally {
		g_Module._load = OriginalModuleLoad;

		if (BridgeDescriptor === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", BridgeDescriptor);
		}

		for (const CacheSnapshot of vecCacheSnapshots.reverse()) {
			if (CacheSnapshot.Descriptor === undefined) {
				delete require.cache[CacheSnapshot.Path];

			} else {
				Object.defineProperty(require.cache, CacheSnapshot.Path, CacheSnapshot.Descriptor);
			}
		}
	}
}

function ExtractJavaScriptBlocks(strMarkdown) {
	const vecBlocks = [];
	const Expression = /```js\r?\n([\s\S]*?)\r?\n```/g;
	let vecMatch = null;
	while ((vecMatch = Expression.exec(strMarkdown)) !== null) {
		vecBlocks.push(vecMatch[1]);
	}

	return vecBlocks;
}

function ExecuteDocumentationBlock(strSource, unIndex, Modules) {
	const BlockRequire = (strModuleName) => {
		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Unexpected documentation import: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	const Execute = new Function("require", `"use strict";\n${strSource}\n//# sourceURL=memory-hooks-events.md:block-${unIndex + 1}`);
	const Context = g_VM.createContext({ Execute, BlockRequire });
	// Keep the documentation function's host realm while bounding execution.
	new g_VM.Script("Execute(BlockRequire);").runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RequireNonEmptyString(strValue, strName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strName} must be a non-empty string.`);
	}

	return strValue;
}

function RequireAddress(unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
		throw new TypeError("Expected a positive BigInt event address.");
	}

	return unAddress;
}

function RequireInt32(Value) {
	// Match V8 Int32Value: ToNumber followed by signed 32-bit truncation/wrapping, not range rejection.
	return +Value | 0;
}

function RequireFloat(Value) {
	const dblValue = +Value;
	if (!Number.isFinite(dblValue) || (dblValue < -g_dblMaximumFloat) || (dblValue > g_dblMaximumFloat)) {
		throw new TypeError("Float event values must fit finite floats.");
	}

	return Math.fround(dblValue);
}

function RequireUInt64(unValue) {
	if ((typeof unValue !== "bigint") || (unValue < 0n) || (unValue > g_unMaximumUInt64)) {
		throw new TypeError("UInt64 event values must be unsigned 64-bit BigInts.");
	}

	return unValue;
}

function MakeRegisterContext(InputRegisters = {}, unNativeAddressByteCount) {
	const Registers = {
		FPUControlWord: 0x37F,
		FPUStatusWord: 0,
		FPUTagWord: 0,
		FXState: new Uint8Array(g_unFXStateByteCount),
		MXCSR: 0x1F80,
	};
	const vecIntegerRegisterNames = (unNativeAddressByteCount === 8) ? [
		"RAX",
		"RBP",
		"RBX",
		"RCX",
		"RDI",
		"RDX",
		"RFLAGS",
		"RSI",
		"RSP",
		"R8",
		"R9",
		"R10",
		"R11",
		"R12",
		"R13",
		"R14",
		"R15",
	] : [
		"EAX",
		"EBP",
		"EBX",
		"ECX",
		"EDI",
		"EDX",
		"EFLAGS",
		"ESI",
		"ESP",
	];
	for (let unIndex = 0; unIndex < vecIntegerRegisterNames.length; unIndex += 1) {
		Registers[vecIntegerRegisterNames[unIndex]] = BigInt(unIndex + 1);
	}

	for (let unIndex = 0; unIndex < g_unFPURegisterCount; unIndex += 1) {
		Registers[`ST${unIndex}`] = new Uint8Array(g_unFPURegisterByteCount);
	}

	const unXMMRegisterCount = (unNativeAddressByteCount === 8) ? 16 : 8;
	for (let unIndex = 0; unIndex < unXMMRegisterCount; unIndex += 1) {
		Registers[`XMM${unIndex}`] = new Uint8Array(g_unXMMRegisterByteCount);
	}

	Object.assign(Registers, InputRegisters);

	return Registers;
}

function CreateFixture(unNativeAddressByteCount, unFireEventVTableIndex) {
	if ((unNativeAddressByteCount !== 4) && (unNativeAddressByteCount !== 8)) {
		throw new RangeError("The event fixture supports only 32-bit and 64-bit native addresses.");
	}

	const unNativeAddressBitCount = BigInt(unNativeAddressByteCount * 8);
	const unMaximumNativeAddress = (1n << unNativeAddressBitCount) - 1n;
	const mapActiveEvents = new Map();
	const setDeclaredEvents = new Set();
	const vecFiredEvents = [];
	const vecFreedAddresses = [];
	const vecHookHandles = [];
	const setPhysicalFiles = new Set();
	const mapRuntimeCallbacks = new Map();
	let bFailNextPreRegistration = false;
	let bFailNextRemove = false;
	let unNextEventAddress = (unNativeAddressByteCount === 8) ? 0x20000000000001n : 0x3E8n;
	let unNextHookID = 1;

	function GetEventRecord(unAddress) {
		const Record = mapActiveEvents.get(RequireAddress(unAddress));
		if (!Record) {
			throw new Error("Unknown or expired event address.");
		}

		return Record;
	}

	function RequireEventKey(strName, bOptional = false) {
		if (bOptional && (strName === undefined)) {
			return undefined;
		}

		return RequireNonEmptyString(strName, "Event key");
	}

	function SnapshotEvent(Record, bDoNotBroadcast) {
		return {
			DoNotBroadcast: bDoNotBroadcast,
			Local: Record.Local,
			EventName: Record.EventName,
			Address: Record.Address,
			Reliable: Record.Reliable,
			Values: Object.fromEntries(Record.Values),
		};
	}

	class EventResourceFile {
		constructor(strFilePath) {
			this.EventResourceFilePath = RequireNonEmptyString(strFilePath, "Resource path");
			this.EventResources = new Map();
		}

		SetEventResource(strName, Variables = undefined) {
			const strEventName = RequireNonEmptyString(strName, "Resource event name");
			const EventVariables = (Variables === undefined) ? {} : Variables;
			if (!EventVariables || (typeof EventVariables !== "object") || Array.isArray(EventVariables)) {
				throw new TypeError("Resource event variables must be an object.");
			}

			this.EventResources.set(strEventName, EventVariables);

			return this;
		}

		WriteEventResourceFile() {
			setPhysicalFiles.add(this.FullEventResourceFilePath);

			return this.FullEventResourceFilePath;
		}

		LoadEventsFromFile() {
			if (!setPhysicalFiles.has(this.FullEventResourceFilePath)) {
				throw new Error("The event resource must be written before loading.");
			}

			for (const strEventName of this.EventResources.keys()) {
				setDeclaredEvents.add(strEventName);
			}

			return this.EventResources.size;
		}

		get FullEventResourceFilePath() {
			return `events/${this.EventResourceFilePath}.res`;
		}
	}

	function CreateHookHandle(Options) {
		const vecPreCallbacks = [];
		const vecPostCallbacks = [];
		const Handle = {
			Active: true,
			ID: unNextHookID,
			Options,
			Address: g_unManagerAddress + BigInt(Options.Index),
			Post(Callback) {
				if (!this.Active || (typeof Callback !== "function") || vecPostCallbacks.includes(Callback)) {
					return false;
				}

				vecPostCallbacks.push(Callback);

				return true;
			},

			PostCallbacks: vecPostCallbacks,

			Pre(Callback) {
				if (bFailNextPreRegistration) {
					bFailNextPreRegistration = false;
					return false;
				}

				if (!this.Active || (typeof Callback !== "function") || vecPreCallbacks.includes(Callback)) {
					return false;
				}

				vecPreCallbacks.push(Callback);

				return true;
			},

			PreCallbacks: vecPreCallbacks,

			Remove() {
				if (bFailNextRemove) {
					bFailNextRemove = false;
					return false;
				}

				if (!this.Active) {
					return false;
				}

				this.Active = false;
				vecPreCallbacks.length = 0;
				vecPostCallbacks.length = 0;

				return true;
			},

			RemovePost(Callback) {
				const nIndex = vecPostCallbacks.indexOf(Callback);
				if (!this.Active || (nIndex < 0)) {
					return false;
				}

				vecPostCallbacks.splice(nIndex, 1);

				return true;
			},

			RemovePre(Callback) {
				const nIndex = vecPreCallbacks.indexOf(Callback);
				if (!this.Active || (nIndex < 0)) {
					return false;
				}

				vecPreCallbacks.splice(nIndex, 1);

				return true;
			},

			TrampolineAddress: 0x7000n + BigInt(unNextHookID),
		};

		unNextHookID += 1;
		vecHookHandles.push(Handle);

		return Handle;
	}

	function DispatchOriginal(unAddress, vecCallArguments) {
		const Record = mapActiveEvents.get(unAddress);
		if (!Record) {
			return false;
		}

		vecFiredEvents.push(SnapshotEvent(Record, vecCallArguments[2]));
		mapActiveEvents.delete(unAddress);

		return true;
	}

	function InvokeFireEvent(unAddress, bDoNotBroadcast) {
		const vecHookArguments = [g_unManagerAddress, unAddress, bDoNotBroadcast];
		let bOriginalCalled = false;
		let ReturnValue = true;
		let bSkipOriginal = false;

		for (const Handle of vecHookHandles.filter((Candidate) => Candidate.Active)) {
			for (const Callback of [...Handle.PreCallbacks]) {
				const Payload = {
					Arguments: vecHookArguments,
					CallHookTrampoline(Options = undefined) {
						const CallOptions = (Options === undefined) ? {} : Options;
						const vecCallArguments = (CallOptions.Arguments === undefined) ? vecHookArguments : CallOptions.Arguments;

						g_Assert.equal(Array.isArray(vecCallArguments), true);
						ReturnValue = DispatchOriginal(unAddress, vecCallArguments);
						bOriginalCalled = true;
						bSkipOriginal = true;

						return {
							Registers: MakeRegisterContext(CallOptions.Registers, unNativeAddressByteCount),
							ReturnValue,
						};
					},

					HookID: Handle.ID,

					SetHookArgument(nIndex, Value) {
						if (!Number.isSafeInteger(nIndex) || (nIndex < 0) || (nIndex >= vecHookArguments.length)) {
							throw new RangeError("Invalid hook argument index.");
						}

						vecHookArguments[nIndex] = Value;

						return Value;
					},

					SetHookReturnValue(Value) {
						ReturnValue = Value;
						bSkipOriginal = true;

						return Value;
					},

					TrampolineAddress: Handle.TrampolineAddress,
					Type: "pre",
				};
				const CallbackResult = Callback(Payload);

				if ((CallbackResult !== undefined) && (CallbackResult !== null)) {
					ReturnValue = CallbackResult;
					bSkipOriginal = true;
				}
			}
		}

		if (!bSkipOriginal) {
			ReturnValue = DispatchOriginal(unAddress, vecHookArguments);
			bOriginalCalled = true;
		}

		for (const Handle of vecHookHandles.filter((Candidate) => Candidate.Active)) {
			for (const Callback of [...Handle.PostCallbacks]) {
				const Payload = {
					Arguments: vecHookArguments,
					HookID: Handle.ID,
					ReturnValue,

					SetHookReturnValue(Value) {
						ReturnValue = Value;

						return Value;
					},

					Type: "post",
				};
				const CallbackResult = Callback(Payload);

				if ((CallbackResult !== undefined) && (CallbackResult !== null)) {
					ReturnValue = CallbackResult;
				}
			}
		}

		if (!bOriginalCalled && mapActiveEvents.has(unAddress) && (ReturnValue !== false)) {
			mapActiveEvents.delete(unAddress);
		}

		return ReturnValue;
	}

	const NativeEvents = {
		GetEventInformation(unAddress) {
			const Record = GetEventRecord(unAddress);

			return {
				Local: Record.Local,
				EventName: Record.EventName,
				EventAddress: Record.Address,
				Reliable: Record.Reliable,
			};
		},

		GetEventName(unAddress) {
			return GetEventRecord(unAddress).EventName;
		},

		GetEventAddress(unAddress = undefined) {
			if ((typeof unAddress !== "bigint") || (unAddress <= 0n) || (unAddress > unMaximumNativeAddress)) {
				return 0n;
			}

			return unAddress;
		},

		FireEvent(strName, Payload = undefined, bDoNotBroadcast = undefined) {
			const strEventName = RequireNonEmptyString(strName, "Event name");
			const EventPayload = (Payload === undefined) ? {} : Payload;
			const bBroadcastFlag = (bDoNotBroadcast === undefined) ? false : bDoNotBroadcast;
			if (!EventPayload || (typeof EventPayload !== "object") || Array.isArray(EventPayload)) {
				throw new TypeError("Event payload must be an object.");
			}

			if (typeof bBroadcastFlag !== "boolean") {
				throw new TypeError("DoNotBroadcast must be boolean.");
			}

			const unAddress = unNextEventAddress;
			unNextEventAddress += 1n;
			mapActiveEvents.set(unAddress, {
				Local: false,
				EventName: strEventName,
				Address: unAddress,
				Reliable: true,
				Values: new Map(Object.entries(EventPayload)),
			});

			return InvokeFireEvent(unAddress, bBroadcastFlag);
		},

		GetFireEventHookOptions() {
			return {
				Arguments: ["address", "address", "bool"],
				Convention: "thiscall",
				Index: unFireEventVTableIndex,
				ObjectAddress: g_unManagerAddress,
				ReturnType: "bool",
			};
		},

		FreeEvent(unAddress) {
			const unEventAddress = RequireAddress(unAddress);
			if (!mapActiveEvents.delete(unEventAddress)) {
				throw new Error("Unknown or expired event address.");
			}

			vecFreedAddresses.push(unEventAddress);

			return true;
		},

		GetBoolean(unAddress, strName, bDefaultValue = undefined) {
			const Value = GetEventRecord(unAddress).Values.get(RequireEventKey(strName));

			if ((bDefaultValue !== undefined) && (typeof bDefaultValue !== "boolean")) {
				throw new TypeError("Boolean defaults must be booleans.");
			}

			return (Value === undefined) ? (bDefaultValue ?? false) : Value;
		},

		GetFloat(unAddress, strName, dblDefaultValue = undefined) {
			const Value = GetEventRecord(unAddress).Values.get(RequireEventKey(strName));
			const flDefaultValue = (dblDefaultValue === undefined) ? 0 : RequireFloat(dblDefaultValue);

			return (Value === undefined) ? flDefaultValue : Value;
		},

		GetInteger(unAddress, strName, nDefaultValue = undefined) {
			const Value = GetEventRecord(unAddress).Values.get(RequireEventKey(strName));
			const nNormalizedDefaultValue = (nDefaultValue === undefined) ? 0 : RequireInt32(nDefaultValue);

			return (Value === undefined) ? nNormalizedDefaultValue : Value;
		},

		GetString(unAddress, strName, strDefaultValue = undefined) {
			const Value = GetEventRecord(unAddress).Values.get(RequireEventKey(strName));

			if ((strDefaultValue !== undefined) && (typeof strDefaultValue !== "string")) {
				throw new TypeError("String defaults must be strings.");
			}

			return (Value === undefined) ? (strDefaultValue ?? "") : Value;
		},

		GetUInt64(unAddress, strName, unDefaultValue = undefined) {
			const Value = GetEventRecord(unAddress).Values.get(RequireEventKey(strName));

			if (unDefaultValue !== undefined) {
				RequireUInt64(unDefaultValue);
			}

			return (Value === undefined) ? (unDefaultValue ?? 0n) : Value;
		},

		IsEventEmpty(unAddress, strName = undefined) {
			const mapValues = GetEventRecord(unAddress).Values;
			const strKey = RequireEventKey(strName, true);

			return (strKey === undefined) ? mapValues.size === 0 : (!mapValues.has(strKey) || (mapValues.get(strKey) === ""));
		},

		GetManagerAddress() {
			return g_unManagerAddress;
		},

		RemoveListener(strName, Callback) {
			const strEventName = RequireNonEmptyString(strName, "Runtime event name");
			const setCallbacks = mapRuntimeCallbacks.get(strEventName);
			if ((typeof Callback !== "function") || !setCallbacks || !setCallbacks.delete(Callback)) {
				return false;
			}

			if (setCallbacks.size === 0) {
				mapRuntimeCallbacks.delete(strEventName);
			}

			return true;
		},

		AddListener(strName, Callback) {
			const strEventName = RequireNonEmptyString(strName, "Runtime event name");

			if (typeof Callback !== "function") {
				throw new TypeError("Runtime event callbacks must be functions.");
			}

			let setCallbacks = mapRuntimeCallbacks.get(strEventName);
			if (!setCallbacks) {
				setCallbacks = new Set();
				mapRuntimeCallbacks.set(strEventName, setCallbacks);
			}

			if (setCallbacks.has(Callback)) {
				return false;
			}

			setCallbacks.add(Callback);

			return true;
		},

		SetBoolean(unAddress, strName, bValue) {
			if (typeof bValue !== "boolean") {
				throw new TypeError("Boolean event values must be booleans.");
			}

			GetEventRecord(unAddress).Values.set(RequireEventKey(strName), bValue);

			return true;
		},

		SetFloat(unAddress, strName, dblValue) {
			const flValue = RequireFloat(dblValue);
			GetEventRecord(unAddress).Values.set(RequireEventKey(strName), flValue);

			return true;
		},

		SetInteger(unAddress, strName, nValue) {
			const nNormalizedValue = RequireInt32(nValue);
			GetEventRecord(unAddress).Values.set(RequireEventKey(strName), nNormalizedValue);

			return true;
		},

		SetString(unAddress, strName, strValue) {
			if (typeof strValue !== "string") {
				throw new TypeError("String event values must be strings.");
			}

			GetEventRecord(unAddress).Values.set(RequireEventKey(strName), strValue);

			return true;
		},

		SetUInt64(unAddress, strName, unValue) {
			RequireUInt64(unValue);
			GetEventRecord(unAddress).Values.set(RequireEventKey(strName), unValue);

			return true;
		},
	};

	const MemoryHooks = {
		CreateVTableHook(Options) {
			g_Assert.deepEqual(Options, NativeEvents.GetFireEventHookOptions());

			return CreateHookHandle(Options);
		},
	};

	const Listeners = {
		Emit(strName, Payload) {
			const strEventName = RequireNonEmptyString(strName, "Runtime event name");
			const setCallbacks = mapRuntimeCallbacks.get(strEventName);
			if (!setCallbacks) {
				return 0;
			}

			const strSerializedPayload = (typeof Payload === "string") ? Payload : JSON.stringify(Payload);
			for (const Callback of [...setCallbacks]) {
				Callback(strEventName, strSerializedPayload);
			}

			return setCallbacks.size;
		},
	};

	return {
		ActiveEvents: mapActiveEvents,
		DeclaredEvents: setDeclaredEvents,
		Filesystem: {
			DoesFileExist(strFilePath) {
				return setPhysicalFiles.has(strFilePath);
			},

			RemoveFile(strFilePath) {
				return setPhysicalFiles.delete(strFilePath);
			},
		},
		FiredEvents: vecFiredEvents,
		FreedAddresses: vecFreedAddresses,
		HookHandles: vecHookHandles,
		Listeners,
		MemoryHooks,
		NativeEvents,
		PhysicalFiles: setPhysicalFiles,
		EventResourceFile,
		RuntimeCallbacks: mapRuntimeCallbacks,

		SetFailNextPreRegistration(bValue) {
			bFailNextPreRegistration = bValue;
		},

		SetFailNextRemove(bValue) {
			bFailNextRemove = bValue;
		},
	};
}

function GetNativeSection(strSource, strBegin, strEnd) {
	const nBegin = strSource.indexOf(strBegin);
	g_Assert.ok(nBegin >= 0, `native section begin: ${strBegin}`);
	g_Assert.equal(strSource.indexOf(strBegin, nBegin + strBegin.length), -1, `native section begin is unique: ${strBegin}`);

	const nEnd = strSource.indexOf(strEnd, nBegin + strBegin.length);
	g_Assert.ok(nEnd > nBegin, `native section end: ${strEnd}`);

	return strSource.slice(nBegin, nEnd);
}

function GetNativeCallbackSource(strSource, strName) {
	const strBegin = `void ${strName}(`;
	const nBegin = strSource.indexOf(strBegin);
	g_Assert.ok(nBegin >= 0, `native callback begin: ${strName}`);
	g_Assert.equal(strSource.indexOf(strBegin, nBegin + strBegin.length), -1, `native callback is unique: ${strName}`);

	const nEnd = strSource.slice(nBegin + strBegin.length).search(/\r?\n\t\t(?:void |bool |template <)/);
	g_Assert.ok(nEnd > 0, `native callback end: ${strName}`);

	return strSource.slice(nBegin, nBegin + strBegin.length + nEnd);
}

function VerifyNativeEventExports(NativeEvents, strBindingsSource) {
	const strHooksSource = GetNativeSection(strBindingsSource, "v8::Local<v8::Object> const LocalMemoryHooksModule = MakeModule(pIsolate);", 'if (!InstallModule(pIsolate, LocalContext, LocalSourceJS, "memory/hooks", LocalMemoryHooksModule))');
	g_Assert.match(strHooksSource, /SetFunction\(pIsolate, LocalContext, LocalMemoryHooksModule, "CreateVTableHook", CreateVTableHookCallback,/, "vtable creation uses the actual native export within its module");

	const strModuleBegin = "v8::Local<v8::Object> const LocalMemoryHookEventsModule = MakeModule(pIsolate);";
	const strModuleEnd = 'if (!InstallModule(pIsolate, LocalContext, LocalSourceJS, "memory/hooks/events", LocalMemoryHookEventsModule))';
	const strInstallationSource = GetNativeSection(strBindingsSource, strModuleBegin, strModuleEnd);
	const vecNativeExports = [...strInstallationSource.matchAll(/SetFunction\(pIsolate, LocalContext, LocalMemoryHookEventsModule, "([A-Za-z][A-Za-z0-9]*)"/g)].map((vecMatch) => vecMatch[1]);
	const vecFixtureExports = Object.keys(NativeEvents).filter((strName) => (strName !== "GetUInt64") && (strName !== "SetUInt64"));
	g_Assert.equal(vecNativeExports.length, 18, "selected core native event export count");
	g_Assert.deepEqual(vecFixtureExports.sort(), vecNativeExports.sort(), "the fixture uses actual C++ export names, without invented aliases");

	for (const strName of vecNativeExports) {
		g_Assert.equal(typeof NativeEvents[strName], "function", strName);
	}
}

function TrackExports(ModuleExports, setExercisedExports) {
	return new Proxy(ModuleExports, {
		get(Target, strProperty, Receiver) {
			if ((typeof strProperty === "string") && g_vecMaximumExports.includes(strProperty)) {
				setExercisedExports.add(strProperty);
			}

			return Reflect.get(Target, strProperty, Receiver);
		},
	});
}

function VerifyDocumentationFailureList(bThrew, CaughtValue, vecExpectedErrors) {
	g_Assert.equal(bThrew, vecExpectedErrors.length !== 0, "example failure state");

	if (vecExpectedErrors.length === 0) {
		return;
	}

	if (vecExpectedErrors.length > 1) {
		g_Assert.ok(CaughtValue instanceof AggregateError, "event examples preserve primary and cleanup failures");
	}

	const vecActualErrors = (vecExpectedErrors.length === 1) ? [CaughtValue] : CaughtValue.errors;
	g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length, "all event failures remain observable");

	for (let unIndex = 0; unIndex < vecExpectedErrors.length; ++unIndex) {
		const Expected = vecExpectedErrors[unIndex];
		if (Object.hasOwn(Expected, "Value")) {
			g_Assert.equal(vecActualErrors[unIndex], Expected.Value, "preserve thrown primitives and failure order");

		} else {
			g_Assert.ok(vecActualErrors[unIndex] instanceof Error);
			g_Assert.equal(vecActualErrors[unIndex].message, Expected.Message);
		}
	}
}

function VerifyEventDocumentationCleanupFailures(vecBlocks) {
	const vecThrownValues = [new Error("controlled event operation failure"), null, undefined, 0, false];
	const vecCleanupModes = [
		{ Result: true },
		{ Result: false },
		...vecThrownValues.map(Value => ({ Thrown: Value })),
	];
	const vecExamples = [
		{ Index: 2, EventName: "SourceJSMemoryAccess", Labels: ["event-access callback"], LoadError: "The engine did not load the example event declaration.", FireError: "The private event did not pass through the managed pre-hook." },
		{ Index: 3, EventName: "SourceJSMemoryUInt64", Labels: ["UInt64 callback"], LoadError: "The engine did not load the UInt64 probe event.", FireError: "The UInt64 event value did not round-trip through the pre-hook." },
		{ Index: 4, EventName: "SourceJSMemoryMetric", Labels: [], LoadError: "The engine did not load the metric event declaration.", FireError: "The engine rejected SourceJSMemoryMetric." },
		{ Index: 7, EventName: "SourceJSPrivateMetric", Labels: ["broadcast callback", "privacy observer"], LoadError: "The engine did not load the private metric event.", FireError: "The event was not converted to server-only dispatch." },
		{ Index: 8, EventName: "SourceJSDebugOnly", Labels: ["blocking callback"], LoadError: "The engine did not load the block-probe event.", FireError: "The blocked event unexpectedly reached engine dispatch.", Blocked: true },
		{ Index: 9, EventName: "SourceJSOrderProbe", Labels: ["ordering callback", "ordering observer"], LoadError: "The engine did not load the callback-order probe event.", FireError: "The server-only event did not reach engine dispatch." },
		{ Index: 11, EventName: "SourceJSTrampolineProbe", Labels: ["trampoline callback"], LoadError: "The engine did not load the trampoline probe event.", FireError: "The trampoline did not preserve successful FireEvent dispatch.", CheckContext: true },
		{ Index: 12, EventName: "SourceJSReturnProbe", Labels: ["return-value callback"], LoadError: "The engine did not load the return-value probe event.", FireError: "The original trampoline result did not become FireEvent's return value.", CheckReturn: true },
	];
	let unCaseCount = 0;
	for (const Example of vecExamples) {
		const vecStages = [{ Name: "COMPLETE" }, { Name: "LOAD_STATUS" }, { Name: "FIRE_STATUS" }];
		for (const Value of vecThrownValues) {
			vecStages.push({ Name: "LOAD_THROW", Thrown: Value }, { Name: "FIRE_THROW", Thrown: Value });
		}

		if (Example.CheckContext) {
			for (const Entry of [
				{ Field: "REGISTERS", Message: "The trampoline did not return its complete call context." },
				{ Field: "INTEGER", Message: "The trampoline omitted an architecture integer register." },
				{ Field: "CONTROL", Message: "The trampoline omitted floating-point control state." },
				{ Field: "ST", Message: "The trampoline returned an invalid ST0 register." },
				{ Field: "XMM", Message: "The trampoline returned an invalid XMM0 register." },
				{ Field: "FX", Message: "The trampoline did not return the 512-byte FX snapshot." },
				{ Field: "SETTER", Message: "The trampoline callback could not preserve the native return value." },
				{ Field: "SETTER_SUPPRESSED", Message: "The trampoline callback could not preserve the native return value." },
			]) {
				vecStages.push({ Name: "CONTEXT_STATUS", ...Entry });
			}
		}

		if (Example.CheckReturn) {
			for (const strField of ["SETTER", "SETTER_SUPPRESSED"]) {
				vecStages.push({ Name: "CONTEXT_STATUS", Field: strField, Message: "The return-value callback could not preserve the native return value." });
			}
		}

		let vecCallbackModeSets = [[]];
		for (let unIndex = 0; unIndex < Example.Labels.length; ++unIndex) {
			vecStages.push({ Name: "REGISTER_STATUS", RegistrationIndex: unIndex });

			for (const Value of vecThrownValues) {
				vecStages.push({ Name: "REGISTER_THROW", RegistrationIndex: unIndex, Thrown: Value });
			}

			const vecNextModes = [];
			for (const vecModes of vecCallbackModeSets) {
				for (const Mode of vecCleanupModes) {
					vecNextModes.push([...vecModes, Mode]);
				}
			}

			vecCallbackModeSets = vecNextModes;
		}

		for (const Stage of vecStages) {
			for (const vecCallbackModes of vecCallbackModeSets) {
				for (const FileMode of vecCleanupModes) {
					const Fixture = CreateFixture(4, 7);
					const EventsHooks = LoadEventsHooks(Fixture.NativeEvents, Fixture.MemoryHooks);
					const vecCleanupCalls = [];
					const vecExpectedErrors = [];
					let Resource = null;
					const vecRegisteredCallbacks = [];
					const mapNativeCallbacks = new Map();
					let unRegistrationCount = 0;
					const unConfirmedCount = Stage.Name.startsWith("REGISTER") ? Stage.RegistrationIndex : ((Stage.Name === "COMPLETE") || Stage.Name.startsWith("FIRE") || (Stage.Name === "CONTEXT_STATUS")) ? Example.Labels.length : 0;
					const RequireCleanupResult = (Mode, Callback) => {
						if (Object.hasOwn(Mode, "Thrown")) {
							throw Mode.Thrown;
						}

						return Mode.Result ? Callback() : false;
					};

					class EventResourceFile extends Fixture.EventResourceFile {
						constructor(...vecArguments) {
							super(...vecArguments);
							Resource = this;
						}

						LoadEventsFromFile() {
							if (Stage.Name === "LOAD_THROW") {
								throw Stage.Thrown;
							}

							return (Stage.Name === "LOAD_STATUS") ? 0 : super.LoadEventsFromFile();
						}
					}

					const ControlledEvents = {
						...EventsHooks,

						OnPre(strEventName, Callback) {
							const unIndex = unRegistrationCount++;
							if ((Stage.Name === "REGISTER_THROW") && (unIndex === Stage.RegistrationIndex)) {
								throw Stage.Thrown;
							}

							if ((Stage.Name === "REGISTER_STATUS") && (unIndex === Stage.RegistrationIndex)) {
								return null;
							}

							const EventCallback = (Stage.Name === "CONTEXT_STATUS") ? Context => {
								const CallTrampoline = Context.CallHookTrampoline;
								Context.CallHookTrampoline = (...vecArguments) => {
									const Result = CallTrampoline.apply(Context, vecArguments);
									if (Stage.Field === "REGISTERS") {
										Result.Registers = null;

									} else if (Stage.Field === "INTEGER") {
										delete Result.Registers.EAX;

									} else if (Stage.Field === "CONTROL") {
										Result.Registers.FPUControlWord = NaN;

									} else if (Stage.Field === "ST") {
										Result.Registers.ST0 = new Uint8Array(9);

									} else if (Stage.Field === "XMM") {
										Result.Registers.XMM0 = new Uint8Array(15);

									} else if (Stage.Field === "FX") {
										Result.Registers.FXState = new Uint8Array(511);
									}

									return Result;
								};

								if (Stage.Field.startsWith("SETTER")) {
									Context.SetHookReturnValue = () => undefined;
								}

								if (Stage.Field === "SETTER_SUPPRESSED") {
									try {
										return Callback(Context);
									} catch {
										// Model a native hook boundary that reports a callback failure without rethrowing to Fire().
										return undefined;
									}
								}

								return Callback(Context);
							} : Callback;
							const RegisteredCallback = EventsHooks.OnPre(strEventName, EventCallback);
							g_Assert.equal(RegisteredCallback, EventCallback);
							mapNativeCallbacks.set(Callback, EventCallback);
							vecRegisteredCallbacks.push(Callback);

							return Callback;
						},

						OffPre(strEventName, Callback) {
							const nIndex = vecRegisteredCallbacks.indexOf(Callback);
							g_Assert.ok(nIndex >= 0, "remove only a confirmed callback identity");
							vecCleanupCalls.push(`CALLBACK:${nIndex}`);
							g_Assert.equal(strEventName, Example.EventName, "remove only the callback for this example's event");

							return RequireCleanupResult(vecCallbackModes[nIndex], () => EventsHooks.OffPre(strEventName, mapNativeCallbacks.get(Callback)));
						},

						Fire(...vecArguments) {
							if (Stage.Name === "FIRE_THROW") {
								throw Stage.Thrown;
							}

							return (Stage.Name === "FIRE_STATUS") ? Example.Blocked === true : EventsHooks.Fire(...vecArguments);
						},
					};
					const Modules = {
						"events/resource": { EventResourceFile },
						"memory/helpers": { ADDRESS_SIZE: 4 },
						"memory/hooks/events": ControlledEvents,
						filesystem: {
							...Fixture.Filesystem,

							RemoveFile(strFilePath) {
								vecCleanupCalls.push("FILE");
								g_Assert.equal(strFilePath, Resource.FullEventResourceFilePath, "remove only the created example file");

								return RequireCleanupResult(FileMode, () => Fixture.Filesystem.RemoveFile(strFilePath));
							},
						},
					};

					if (Object.hasOwn(Stage, "Thrown")) {
						vecExpectedErrors.push({ Value: Stage.Thrown });

					} else if (Stage.Name !== "COMPLETE") {
						const strMessage = (Stage.Name === "LOAD_STATUS") ? Example.LoadError : (Stage.Name === "FIRE_STATUS") ? Example.FireError : (Stage.Name === "CONTEXT_STATUS") ? Stage.Message : `The example could not register its ${Example.Labels[Stage.RegistrationIndex]}.`;
						vecExpectedErrors.push({ Message: strMessage });
					}

					for (let nIndex = unConfirmedCount - 1; nIndex >= 0; --nIndex) {
						const Mode = vecCallbackModes[nIndex];
						if (Mode.Result !== true) {
							vecExpectedErrors.push(Object.hasOwn(Mode, "Thrown") ? { Value: Mode.Thrown } : { Message: `The example could not remove its ${Example.Labels[nIndex]}.` });
						}
					}

					let bThrew = false;
					let CaughtValue = undefined;

					try {
						ExecuteDocumentationBlock(vecBlocks[Example.Index], Example.Index, Modules);
					} catch (CaughtError) {
						bThrew = true;
						CaughtValue = CaughtError;
					} finally {
						g_Assert.equal(EventsHooks.ClearPreEvents(), true, "tear down controlled native callbacks after each fault case");
						g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), false, "fault fixtures retain no managed hook");
						Fixture.PhysicalFiles.clear();
					}

					if (FileMode.Result !== true) {
						vecExpectedErrors.push(Object.hasOwn(FileMode, "Thrown") ? { Value: FileMode.Thrown } : { Message: `Unable to remove ${Resource.FullEventResourceFilePath}.` });
					}

					if (bThrew && (vecExpectedErrors.length === 0)) {
						throw new Error(`${Example.EventName}/${Stage.Name} unexpectedly failed.`, { cause: CaughtValue });
					}

					VerifyDocumentationFailureList(bThrew, CaughtValue, vecExpectedErrors);
					const vecExpectedCalls = [];
					for (let nIndex = unConfirmedCount - 1; nIndex >= 0; --nIndex) {
						vecExpectedCalls.push(`CALLBACK:${nIndex}`);
					}

					vecExpectedCalls.push("FILE");
					g_Assert.deepEqual(vecCleanupCalls, vecExpectedCalls, "attempt every confirmed cleanup in reverse acquisition order");
					++unCaseCount;
				}
			}
		}
	}

	const vecWriteStages = [{ Existing: true }];
	for (const Value of vecThrownValues) {
		vecWriteStages.push({ AfterWrite: false, Thrown: Value }, { AfterWrite: true, Thrown: Value });
	}

	for (const Example of vecExamples) {
		for (const Stage of vecWriteStages) {
			const Fixture = CreateFixture(4, 7);
			const EventsHooks = LoadEventsHooks(Fixture.NativeEvents, Fixture.MemoryHooks);
			class EventResourceFile extends Fixture.EventResourceFile {
				WriteEventResourceFile() {
					g_Assert.notEqual(Stage.Existing, true, "do not overwrite an existing resource");

					if (Stage.AfterWrite) {
						super.WriteEventResourceFile();
					}

					throw Stage.Thrown;
				}
			}

			const Modules = {
				"events/resource": { EventResourceFile },
				"memory/helpers": { ADDRESS_SIZE: 4 },
				"memory/hooks/events": {
					...EventsHooks,

					OnPre() {
						g_Assert.fail("do not register after an unconfirmed write");
					},
				},
				filesystem: {
					DoesFileExist: () => Stage.Existing === true,

					RemoveFile() {
						g_Assert.fail("do not delete an unconfirmed or preexisting resource");
					},
				},
			};

			let bThrew = false;

			try {
				ExecuteDocumentationBlock(vecBlocks[Example.Index], Example.Index, Modules);
			} catch (CaughtError) {
				bThrew = true;

				if (Stage.Existing) {
					g_Assert.match(CaughtError.message, /^The example refuses to overwrite /);

				} else {
					g_Assert.equal(CaughtError, Stage.Thrown, "unconfirmed-write errors retain their original identity");
				}
			} finally {
				Fixture.PhysicalFiles.clear();
			}

			g_Assert.equal(bThrew, true, "write/existing-file guard must stop the workflow");
			++unCaseCount;
		}
	}

	g_Assert.equal(unCaseCount, 22474, "eight event-resource example failure matrices, register validation and write ownership guards");
}

function VerifyRuntimeChannelDocumentationFailures(strCode) {
	const vecThrownValues = [new Error("controlled runtime-channel failure"), null, undefined, 0, false];
	const vecRemovalModes = [
		{ Result: true },
		{ Result: false },
		...vecThrownValues.map(Value => ({ Thrown: Value })),
	];
	const vecStages = [
		{ Name: "COMPLETE" },
		{ Name: "COUNT_STATUS" },
		{ Name: "PAYLOAD_STATUS" },
		{ Name: "REGISTER_STATUS" },
	];
	for (const Value of vecThrownValues) {
		vecStages.push({ Name: "REGISTER_THROW", Thrown: Value }, { Name: "EMIT_THROW", Thrown: Value });
	}

	let unCaseCount = 0;
	for (const Stage of vecStages) {
		for (const Mode of vecRemovalModes) {
			const Fixture = CreateFixture(4, 7);
			const EventsHooks = LoadEventsHooks(Fixture.NativeEvents, Fixture.MemoryHooks);
			const strChannelName = "SourceJSMemoryHooksProbe";
			const IndependentCallback = () => undefined;
			g_Assert.equal(EventsHooks.On(strChannelName, IndependentCallback), true);

			let RegisteredCallback = null;
			let unRemovalCount = 0;
			const Modules = {
				"memory/hooks/events": {
					On(strName, Callback) {
						if (Stage.Name === "REGISTER_THROW") {
							throw Stage.Thrown;
						}

						if (Stage.Name === "REGISTER_STATUS") {
							return false;
						}

						const bRegistered = EventsHooks.On(strName, Callback);
						RegisteredCallback = Callback;

						return bRegistered;
					},

					Off(strName, Callback) {
						++unRemovalCount;
						g_Assert.equal(strName, strChannelName);
						g_Assert.equal(Callback, RegisteredCallback, "remove only this channel probe's confirmed callback");

						if (Object.hasOwn(Mode, "Thrown")) {
							throw Mode.Thrown;
						}

						return Mode.Result ? EventsHooks.Off(strName, Callback) : false;
					},
				},
				listeners: {
					Emit(strName, Payload) {
						if (Stage.Name === "EMIT_THROW") {
							throw Stage.Thrown;
						}

						if (Stage.Name === "COUNT_STATUS") {
							return 0;
						}

						return Fixture.Listeners.Emit(strName, (Stage.Name === "PAYLOAD_STATUS") ? { RequestID: -1 } : Payload);
					},
				},
			};
			const vecExpectedErrors = [];
			if (Object.hasOwn(Stage, "Thrown")) {
				vecExpectedErrors.push({ Value: Stage.Thrown });

			} else if (Stage.Name !== "COMPLETE") {
				const strMessage = (Stage.Name === "REGISTER_STATUS") ? "The runtime channel rejected the probe callback." : (Stage.Name === "COUNT_STATUS") ? "The runtime channel did not invoke its registered callback." : "The runtime event did not preserve its serialized payload.";
				vecExpectedErrors.push({ Message: strMessage });
			}

			const bRegistered = !Stage.Name.startsWith("REGISTER");
			if (bRegistered && (Mode.Result !== true)) {
				vecExpectedErrors.push(Object.hasOwn(Mode, "Thrown") ? { Value: Mode.Thrown } : { Message: "The runtime channel did not remove the probe callback." });
			}

			let bThrew = false;
			let CaughtValue = undefined;

			try {
				ExecuteDocumentationBlock(strCode, 5, Modules);
			} catch (CaughtError) {
				bThrew = true;
				CaughtValue = CaughtError;
			}

			try {
				VerifyDocumentationFailureList(bThrew, CaughtValue, vecExpectedErrors);
				g_Assert.equal(unRemovalCount, bRegistered ? 1 : 0, "channel cleanup is attempted once only after confirmed registration");
				g_Assert.equal(Fixture.RuntimeCallbacks.get(strChannelName).has(IndependentCallback), true, "preserve independent runtime callbacks");
			} finally {
				Fixture.RuntimeCallbacks.clear();
			}

			++unCaseCount;
		}
	}

	g_Assert.equal(unCaseCount, 98, "runtime-channel operation and removal failure matrix");
}

function VerifyManagedHookLifecycleDocumentationFailures(strCode) {
	const BaselineFixture = CreateFixture(4, 7);
	const Baseline = LoadEventsHooks(BaselineFixture.NativeEvents, BaselineFixture.MemoryHooks);
	const vecNormalCalls = [];
	const Normal = Object.fromEntries(Object.entries(Baseline).map(([strName, Value]) => [strName, (typeof Value === "function") ? (...vecArguments) => {
		vecNormalCalls.push(strName);

		return Value(...vecArguments);
	} : Value]));
	ExecuteDocumentationBlock(strCode, 6, { "memory/hooks/events": Normal });
	g_Assert.deepEqual(vecNormalCalls.slice(-2), ["ClearPreEvents", "GetPreEventHook"], "the lifecycle probe always ends with event and retained-handle cleanup");
	g_Assert.equal(Baseline.GetPreEventHook(), null);

	const unMainCallCount = vecNormalCalls.length - 2;
	const vecThrownValues = [new Error("controlled managed-hook failure"), null, undefined, 0, false];
	const vecClearModes = [
		{ Result: true },
		...vecThrownValues.map(Value => ({ Thrown: Value })),
	];
	const vecRemoveModes = [
		{ Result: true },
		{ Result: false },
		...vecThrownValues.map(Value => ({ Thrown: Value })),
	];
	let unCaseCount = 0;
	for (let unFaultIndex = 0; unFaultIndex < unMainCallCount; ++unFaultIndex) {
		for (const PrimaryError of vecThrownValues) {
			for (const ClearMode of vecClearModes) {
				for (const RemoveMode of vecRemoveModes) {
					const Fixture = CreateFixture(4, 7);
					const EventsHooks = LoadEventsHooks(Fixture.NativeEvents, Fixture.MemoryHooks);
					const vecCleanupCalls = [];
					const vecExpectedErrors = [{ Value: PrimaryError }];
					let unMainCalls = 0;
					let bInjected = false;
					let bExpectedRemove = false;
					const Controlled = Object.fromEntries(Object.entries(EventsHooks).map(([strName, Value]) => [strName, (typeof Value === "function") ? (...vecArguments) => {
						if (!bInjected) {
							if (unMainCalls++ === unFaultIndex) {
								bInjected = true;
								throw PrimaryError;
							}

							return Value(...vecArguments);
						}

						vecCleanupCalls.push(strName);

						if (strName === "ClearPreEvents") {
							try {
								if (Object.hasOwn(ClearMode, "Thrown")) {
									vecExpectedErrors.push({ Value: ClearMode.Thrown });
									throw ClearMode.Thrown;
								}

								return Value(...vecArguments);
							} finally {
								bExpectedRemove = EventsHooks.GetPreEventHook() !== null;
							}
						}

						if (strName === "GetPreEventHook") {
							return Value(...vecArguments);
						}

						g_Assert.equal(strName, "RemovePreEventHook", "no further main-path operations after a failure");

						if (Object.hasOwn(RemoveMode, "Thrown")) {
							vecExpectedErrors.push({ Value: RemoveMode.Thrown });
							throw RemoveMode.Thrown;
						}

						if (!RemoveMode.Result) {
							vecExpectedErrors.push({ Message: "The lifecycle probe could not release its retained native hook." });
							return false;
						}

						return Value(...vecArguments);
					} : Value]));

					let bThrew = false;
					let CaughtValue = undefined;

					try {
						ExecuteDocumentationBlock(strCode, 6, { "memory/hooks/events": Controlled });
					} catch (CaughtError) {
						bThrew = true;
						CaughtValue = CaughtError;
					} finally {
						g_Assert.equal(EventsHooks.ClearPreEvents(), true);
						g_Assert.equal(EventsHooks.GetPreEventHook(), null, "isolated fixture teardown releases all test hook state");
					}

					VerifyDocumentationFailureList(bThrew, CaughtValue, vecExpectedErrors);
					g_Assert.equal(bInjected, true, "every normal lifecycle operation is fault-injected");
					g_Assert.deepEqual(vecCleanupCalls, ["ClearPreEvents", "GetPreEventHook", ...(bExpectedRemove ? ["RemovePreEventHook"] : [])], "always clear the event, then retry a retained native hook independently");
					++unCaseCount;
				}
			}
		}
	}

	g_Assert.equal(unMainCallCount, 17, "all lifecycle probe main-path operations are covered");
	g_Assert.equal(unCaseCount, 3570, "managed-hook lifecycle and cleanup failure matrix");
}

function VerifyRawEventHookDocumentationFailures(strCode) {
	const unPostCleanupIndex = 0;
	const unPreCleanupIndex = 1;
	const unHookCleanupIndex = 2;
	const unFileCleanupIndex = 3;
	const vecCleanupNames = ["POST", "PRE", "HOOK", "FILE"];
	const unCleanupOperationCount = vecCleanupNames.length;
	const vecThrownValues = [new Error("controlled raw-hook failure"), null, undefined, 0, false];
	const Success = { Result: true };
	const vecFailureModes = [
		{ Result: false },
		...vecThrownValues.map(Value => ({ Thrown: Value })),
	];
	const vecModeSets = [Array(unCleanupOperationCount).fill(Success)];
	for (let unLeft = 0; unLeft < unCleanupOperationCount; ++unLeft) {
		for (const LeftMode of vecFailureModes) {
			const vecSingle = Array(unCleanupOperationCount).fill(Success);
			vecSingle[unLeft] = LeftMode;
			vecModeSets.push(vecSingle);

			for (let unRight = unLeft + 1; unRight < unCleanupOperationCount; ++unRight) {
				for (const RightMode of vecFailureModes) {
					const vecPair = vecSingle.slice();
					vecPair[unRight] = RightMode;
					vecModeSets.push(vecPair);
				}
			}
		}
	}

	for (let unVariant = 0; unVariant < vecFailureModes.length; ++unVariant) {
		const vecAllFailed = [];
		for (let unIndex = 0; unIndex < unCleanupOperationCount; ++unIndex) {
			vecAllFailed.push(vecFailureModes[(unVariant + unIndex) % vecFailureModes.length]);
		}

		vecModeSets.push(vecAllFailed);
	}

	const vecStages = [
		"COMPLETE",
		"LOAD_STATUS",
		"CREATE_NULL",
		"METADATA_STATUS",
		"PRE_STATUS",
		"POST_STATUS",
		"PROBE_STATUS",
		"BLOCK_STATUS",
	].map(strName => ({ Name: strName }));
	for (const strName of [
		"LOAD_THROW",
		"OPTIONS_THROW",
		"CREATE_THROW",
		"PRE_THROW",
		"POST_THROW",
		"PROBE_THROW",
		"BLOCK_THROW",
	]) {
		vecStages.push({ Name: strName, Thrown: vecThrownValues[0] });
	}

	for (const Value of vecThrownValues.slice(1)) {
		vecStages.push({ Name: "PROBE_THROW", Thrown: Value });
	}

	const vecCleanupMessages = [
		"The raw FireEvent post callback could not be removed.",
		"The raw FireEvent pre callback could not be removed.",
		"The raw FireEvent hook could not be removed.",
	];
	const mapStatusErrors = new Map([
		["LOAD_STATUS", "The engine did not load both raw-hook probe events."],
		["CREATE_NULL", "The raw FireEvent hook target could not be resolved."],
		["METADATA_STATUS", "The hook handle did not expose positive BigInt addresses and a numeric ID."],
		["PRE_STATUS", "Unable to register the raw FireEvent pre callback."],
		["POST_STATUS", "Unable to register the raw FireEvent post callback."],
		["PROBE_STATUS", "The raw probe event did not reach engine dispatch."],
		["BLOCK_STATUS", "The raw hook did not block SourceJSRawBlock."],
	]);
	let unCaseCount = 0;
	for (const Stage of vecStages) {
		for (const vecModes of vecModeSets) {
			const Fixture = CreateFixture(4, 7);
			const EventsHooks = LoadEventsHooks(Fixture.NativeEvents, Fixture.MemoryHooks);
			const vecCleanupCalls = [];
			const vecExpectedErrors = [];
			let Resource = null;
			let ActualHook = null;
			let PreCallback = null;
			let PostCallback = null;
			const bCreated = !["LOAD_STATUS", "LOAD_THROW", "OPTIONS_THROW", "CREATE_THROW", "CREATE_NULL"].includes(Stage.Name);
			const bPreRegistered = bCreated && !["METADATA_STATUS", "PRE_STATUS", "PRE_THROW"].includes(Stage.Name);
			const bPostRegistered = bPreRegistered && !["POST_STATUS", "POST_THROW"].includes(Stage.Name);
			const Cleanup = (unIndex, Callback) => {
				vecCleanupCalls.push(vecCleanupNames[unIndex]);
				const Mode = vecModes[unIndex];
				if (Object.hasOwn(Mode, "Thrown")) {
					throw Mode.Thrown;
				}

				return Mode.Result ? Callback() : false;
			};

			class EventResourceFile extends Fixture.EventResourceFile {
				constructor(...vecArguments) {
					super(...vecArguments);
					Resource = this;
				}

				LoadEventsFromFile() {
					if (Stage.Name === "LOAD_THROW") {
						throw Stage.Thrown;
					}

					return (Stage.Name === "LOAD_STATUS") ? 0 : super.LoadEventsFromFile();
				}
			}

			const Modules = {
				"events/resource": { EventResourceFile },
				filesystem: {
					...Fixture.Filesystem,

					RemoveFile(strPath) {
						g_Assert.equal(strPath, Resource.FullEventResourceFilePath);

						return Cleanup(unFileCleanupIndex, () => Fixture.Filesystem.RemoveFile(strPath));
					},
				},
				"memory/hooks/events": {
					...EventsHooks,

					FireEventHookOptions() {
						if (Stage.Name === "OPTIONS_THROW") {
							throw Stage.Thrown;
						}

						return EventsHooks.FireEventHookOptions();
					},

					Fire(strName, ...vecArguments) {
						const strPhase = (strName === "SourceJSRawProbe") ? "PROBE" : "BLOCK";
						if (Stage.Name === `${strPhase}_THROW`) {
							throw Stage.Thrown;
						}

						return (Stage.Name === `${strPhase}_STATUS`) ? strPhase === "BLOCK" : EventsHooks.Fire(strName, ...vecArguments);
					},
				},
				"memory/hooks": {
					CreateVTableHook(Options) {
						if (Stage.Name === "CREATE_THROW") {
							throw Stage.Thrown;
						}

						if (Stage.Name === "CREATE_NULL") {
							return null;
						}

						ActualHook = Fixture.MemoryHooks.CreateVTableHook(Options);

						return {
							...ActualHook,
							ID: (Stage.Name === "METADATA_STATUS") ? 0 : ActualHook.ID,

							Pre(Callback) {
								if (Stage.Name === "PRE_THROW") {
									throw Stage.Thrown;
								}

								if (Stage.Name === "PRE_STATUS") {
									return false;
								}

								PreCallback = Callback;

								return ActualHook.Pre(Callback);
							},

							Post(Callback) {
								if (Stage.Name === "POST_THROW") {
									throw Stage.Thrown;
								}

								if (Stage.Name === "POST_STATUS") {
									return false;
								}

								PostCallback = Callback;

								return ActualHook.Post(Callback);
							},

							RemovePost(Callback) {
								g_Assert.equal(Callback, PostCallback);

								return Cleanup(unPostCleanupIndex, () => ActualHook.RemovePost(Callback));
							},

							RemovePre(Callback) {
								g_Assert.equal(Callback, PreCallback);

								return Cleanup(unPreCleanupIndex, () => ActualHook.RemovePre(Callback));
							},

							Remove() {
								return Cleanup(unHookCleanupIndex, () => ActualHook.Remove());
							},
						};
					},
				},
			};

			if (Object.hasOwn(Stage, "Thrown")) {
				vecExpectedErrors.push({ Value: Stage.Thrown });

			} else if (Stage.Name !== "COMPLETE") {
				vecExpectedErrors.push({ Message: mapStatusErrors.get(Stage.Name) });
			}

			const vecExpectedCalls = [];
			for (const Entry of [
				{ Index: unPostCleanupIndex, Active: bPostRegistered },
				{ Index: unPreCleanupIndex, Active: bPreRegistered },
				{ Index: unHookCleanupIndex, Active: bCreated },
				{ Index: unFileCleanupIndex, Active: true },
			]) {
				if (!Entry.Active) {
					continue;
				}

				vecExpectedCalls.push(vecCleanupNames[Entry.Index]);
				const Mode = vecModes[Entry.Index];
				if (Mode.Result !== true) {
					vecExpectedErrors.push(Object.hasOwn(Mode, "Thrown") ? { Value: Mode.Thrown } : { CleanupIndex: Entry.Index });
				}
			}

			let bThrew = false;
			let CaughtValue = undefined;

			try {
				ExecuteDocumentationBlock(strCode, 10, Modules);
			} catch (CaughtError) {
				bThrew = true;
				CaughtValue = CaughtError;
			} finally {
				if (ActualHook?.Active) {
					g_Assert.equal(ActualHook.Remove(), true, "release isolated test hook state after controlled failures");
				}

				Fixture.PhysicalFiles.clear();
			}

			for (const Expected of vecExpectedErrors) {
				if (Object.hasOwn(Expected, "CleanupIndex")) {
					Expected.Message = (Expected.CleanupIndex === unFileCleanupIndex) ? `Unable to remove ${Resource.FullEventResourceFilePath}.` : vecCleanupMessages[Expected.CleanupIndex];
				}
			}

			VerifyDocumentationFailureList(bThrew, CaughtValue, vecExpectedErrors);
			g_Assert.deepEqual(vecCleanupCalls, vecExpectedCalls, "attempt every acquired raw-hook cleanup independently in reverse order");
			++unCaseCount;
		}
	}

	g_Assert.equal(vecModeSets.length, 247, "success, every single/pair failure, and six all-failing cleanup vectors");
	g_Assert.equal(unCaseCount, 4693, "raw-hook main-path and cleanup failure coverage");
}

function RunSmoke(unNativeAddressByteCount, unFireEventVTableIndex, bHasUInt64) {
	const Fixture = CreateFixture(unNativeAddressByteCount, unFireEventVTableIndex);

	try {
		if (!bHasUInt64) {
			delete Fixture.NativeEvents.GetUInt64;
			delete Fixture.NativeEvents.SetUInt64;
		}

		const strNativeSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
		VerifyNativeEventExports(Fixture.NativeEvents, strNativeSource);

		const EventsHooks = LoadEventsHooks(Fixture.NativeEvents, Fixture.MemoryHooks);
		const vecExpectedExports = bHasUInt64 ? g_vecMaximumExports : [...g_vecMinimumExports].sort();
		g_Assert.deepEqual(Object.keys(EventsHooks).sort(), vecExpectedExports);
		g_Assert.deepEqual(EventsHooks.EventAction, {
			Block: 2,
			Continue: 0,
			StopBroadcast: 1,
		});
		g_Assert.equal(Object.isFrozen(EventsHooks.EventAction), true);
		g_Assert.equal(EventsHooks.ManagerAddress(), g_unManagerAddress);
		g_Assert.equal(EventsHooks.EventAddress(), 0n);
		g_Assert.equal(EventsHooks.EventAddress("4096"), 0n, "EventAddress reports invalid input with its native zero sentinel");
		g_Assert.equal(EventsHooks.EventAddress(4096), 0n);
		g_Assert.equal(EventsHooks.EventAddress(0n), 0n);
		g_Assert.equal(EventsHooks.EventAddress(-1n), 0n);
		g_Assert.equal(EventsHooks.EventAddress(1n << BigInt(unNativeAddressByteCount * 8)), 0n, "selected-width fixture rejects address overflow");
		g_Assert.equal(EventsHooks.EventAddress(0x20000000000001n), (unNativeAddressByteCount === 8) ? 0x20000000000001n : 0n, "selected-width addresses preserve BigInt precision");

		const strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
		const vecDocumentationBlocks = ExtractJavaScriptBlocks(strDocumentation);
		const setExercisedExports = new Set();
		const DocumentedEventsHooks = TrackExports(EventsHooks, setExercisedExports);

		g_Assert.equal(vecDocumentationBlocks.length, 13);
		g_Assert.doesNotMatch(strDocumentation, /generated by|auto-generated|example generator/i);
		g_Assert.doesNotMatch(strDocumentation, /payload\.skip|captureRegisters\s*[:=(]|events\/hooks|addressString|dontBroadcast|moduleName/);

		if ((unNativeAddressByteCount === 4) && bHasUInt64) {
			VerifyEventDocumentationCleanupFailures(vecDocumentationBlocks);
			VerifyRuntimeChannelDocumentationFailures(vecDocumentationBlocks[5]);
			VerifyManagedHookLifecycleDocumentationFailures(vecDocumentationBlocks[6]);
			VerifyRawEventHookDocumentationFailures(vecDocumentationBlocks[10]);
		}

		for (const strSource of vecDocumentationBlocks) {
			new g_VM.Script(`"use strict";\n${strSource}`);
		}

		for (const [unIndex, strSource] of vecDocumentationBlocks.entries()) {
			ExecuteDocumentationBlock(strSource, unIndex, {
				"events/resource": {
					EventResourceFile: Fixture.EventResourceFile,
				},
				filesystem: Fixture.Filesystem,
				listeners: Fixture.Listeners,
				"memory/helpers": {
				ADDRESS_SIZE: unNativeAddressByteCount,
				},
				"memory/hooks": Fixture.MemoryHooks,
				"memory/hooks/events": DocumentedEventsHooks,
			});
		}

		for (const strExportName of vecExpectedExports) {
			g_Assert.equal(setExercisedExports.has(strExportName), true, `Documentation did not exercise memory/hooks/events.${strExportName}.`);
		}

		g_Assert.equal(Fixture.RuntimeCallbacks.size, 0);
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), false);
		g_Assert.equal(EventsHooks.GetPreEventHook(), null);
		g_Assert.equal(Fixture.ActiveEvents.size, 0);
		g_Assert.equal(Fixture.FreedAddresses.length >= 2, true);
		g_Assert.equal(Fixture.PhysicalFiles.size, 0);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSMemoryAccess") && (Event.Values.Damage === 0) && (Event.Values.Scale === 1.5) && (Event.Values.Checked === true) && (Event.Values.Label === "ready")), true);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSMemoryUInt64") && (Event.Values.Sequence === 42n)), bHasUInt64);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSMemoryMetric") && (Event.Values.Count === 3) && (Event.Values.Label === "ready")), true);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSPrivateMetric") && Event.DoNotBroadcast), true);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => Event.EventName === "SourceJSDebugOnly"), false);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSOrderProbe") && Event.DoNotBroadcast), true);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSRawProbe") && Event.DoNotBroadcast), true);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => Event.EventName === "SourceJSRawBlock"), false);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => (Event.EventName === "SourceJSTrampolineProbe") && Event.DoNotBroadcast), true);
		g_Assert.equal(Fixture.FiredEvents.some((Event) => Event.EventName === "SourceJSReturnProbe"), true);

		function NoOperation() {
		}

		EventsHooks.OnPre("DuplicateProbe", NoOperation);
		g_Assert.throws(() => EventsHooks.OnPre("DuplicateProbe", NoOperation), /already registered/);
		g_Assert.equal(EventsHooks.OffPre("DuplicateProbe", NoOperation), true);
		g_Assert.throws(() => EventsHooks.OffPre("DuplicateProbe", NoOperation), /not registered/);

		Fixture.SetFailNextPreRegistration(true);
		g_Assert.throws(() => EventsHooks.EnsurePreEventHook(), /Unable to register/);
		g_Assert.equal(EventsHooks.GetPreEventHook(), null);
		g_Assert.equal(Fixture.HookHandles.at(-1).Active, false);

		Fixture.SetFailNextPreRegistration(true);
		Fixture.SetFailNextRemove(true);
		g_Assert.throws(() => EventsHooks.EnsurePreEventHook(), (ErrorValue) => {
			g_Assert.ok(ErrorValue instanceof AggregateError, "Failed registration and rollback aggregate their errors");
			g_Assert.equal(ErrorValue.errors.length, 2, "Both failure reasons are retained");
			g_Assert.match(ErrorValue.errors[0].message, /Unable to register/);
			g_Assert.match(ErrorValue.errors[1].message, /roll back/);

			return true;
		}, "Failed registration and rollback report both failures");

		const PendingCleanupHook = Fixture.HookHandles.at(-1);
		g_Assert.equal(PendingCleanupHook.Active, true, "Failed native cleanup leaves a live handle");
		g_Assert.equal(EventsHooks.GetPreEventHook(), PendingCleanupHook, "Failed native cleanup retains the handle for retry");
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), false, "A pending cleanup handle is not a registered pre-event hook");

		const unHandleCountBeforeCleanupRetry = Fixture.HookHandles.length;
		Fixture.SetFailNextRemove(true);
		g_Assert.throws(() => EventsHooks.EnsurePreEventHook(), /pending/, "Installation does not ignore failed pending cleanup");
		g_Assert.equal(Fixture.HookHandles.length, unHandleCountBeforeCleanupRetry, "Failed cleanup retry does not create another native hook");

		const OriginalPendingHookRemove = PendingCleanupHook.Remove;

		try {
			PendingCleanupHook.Remove = () => {
				throw new Error("Pending cleanup threw.");
			};

			g_Assert.throws(() => EventsHooks.EnsurePreEventHook(), /Pending cleanup threw/, "Thrown cleanup errors retain the pending hook");
			g_Assert.equal(EventsHooks.GetPreEventHook(), PendingCleanupHook, "Thrown cleanup does not lose the retained handle");
			g_Assert.equal(Fixture.HookHandles.length, unHandleCountBeforeCleanupRetry, "Thrown cleanup retry does not create another native hook");
		} finally {
			PendingCleanupHook.Remove = OriginalPendingHookRemove;
		}

		g_Assert.equal(EventsHooks.RemovePreEventHook(), true, "Native cleanup can be retried explicitly");
		g_Assert.equal(PendingCleanupHook.Active, false, "Explicit cleanup releases the retained native hook");
		g_Assert.equal(EventsHooks.GetPreEventHook(), null, "Successful cleanup clears the retained handle");

		Fixture.SetFailNextPreRegistration(true);
		Fixture.SetFailNextRemove(true);
		g_Assert.throws(() => EventsHooks.EnsurePreEventHook(), AggregateError, "Repeated failed setup retains another cleanup handle");
		const AutomaticallyCleanedHook = EventsHooks.GetPreEventHook();
		const ReplacementPreEventHook = EventsHooks.EnsurePreEventHook();
		g_Assert.equal(AutomaticallyCleanedHook.Active, false, "Installation retries pending native cleanup before creating a replacement");
		g_Assert.notEqual(ReplacementPreEventHook, AutomaticallyCleanedHook, "Successful cleanup permits a new native handle");
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), true, "A successfully registered replacement is installed");
		g_Assert.equal(EventsHooks.RemovePreEventHook(), true, "Replacement cleanup succeeds");

		EventsHooks.OnPre("RemoveRetry", NoOperation);
		Fixture.SetFailNextRemove(true);
		g_Assert.equal(EventsHooks.OffPre("RemoveRetry", NoOperation), true);
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), true);
		g_Assert.equal(EventsHooks.RemovePreEventHook(), true);
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), false);

		EventsHooks.OnPre("ClearOne", NoOperation);
		EventsHooks.OnPre("ClearTwo", NoOperation);
		g_Assert.equal(EventsHooks.ClearPreEvents("ClearOne"), true);
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), true);
		g_Assert.equal(EventsHooks.ClearPreEvents(), true);
		g_Assert.equal(EventsHooks.IsPreEventHookInstalled(), false);

		function InvalidAction() {
			return 99;
		}

		EventsHooks.OnPre("InvalidAction", InvalidAction);
		Fixture.DeclaredEvents.add("InvalidAction");
		g_Assert.throws(() => EventsHooks.Fire("InvalidAction", {}, false), /EventAction/);
		g_Assert.equal(EventsHooks.OffPre("InvalidAction", InvalidAction), true);

		EventsHooks.OnPre("PayloadValidation", NoOperation);
		const ValidationHook = EventsHooks.GetPreEventHook();
		const ManagedDispatcher = ValidationHook.PreCallbacks[0];
		const unValidationAddress = 0x2328n;
		Fixture.ActiveEvents.set(unValidationAddress, {
			Local: false,
			EventName: "PayloadValidation",
			Address: unValidationAddress,
			Reliable: true,
			Values: new Map(),
		});

		g_Assert.equal(EventsHooks.SetInt(unValidationAddress, "Count", g_nMinimumInt32), true);
		g_Assert.equal(EventsHooks.GetInt(unValidationAddress, "Count"), g_nMinimumInt32);
		g_Assert.equal(EventsHooks.GetInt(unValidationAddress, "Missing", g_nMaximumInt32), g_nMaximumInt32);

		for (const Entry of [
			{ Value: 1.5, Expected: 1 },
			{ Value: -1.5, Expected: -1 },
			{ Value: g_nMinimumInt32 - 1, Expected: g_nMaximumInt32 },
			{ Value: g_nMaximumInt32 + 1, Expected: g_nMinimumInt32 },
			{ Value: "7", Expected: 7 },
			{ Value: true, Expected: 1 },
			{ Value: null, Expected: 0 },
			{ Value: undefined, Expected: 0 },
			{ Value: NaN, Expected: 0 },
			{ Value: Infinity, Expected: 0 },
			{ Value: -Infinity, Expected: 0 },
			{ Value: 0x100000001, Expected: 1 },
			{ Value: { valueOf: () => 7 }, Expected: 7 },
		]) {
			g_Assert.equal(EventsHooks.SetInt(unValidationAddress, "Count", Entry.Value), true);
			g_Assert.equal(EventsHooks.GetInt(unValidationAddress, "Count"), Entry.Expected, "integer write follows native ToInt32 coercion");
			g_Assert.equal(EventsHooks.GetInt(unValidationAddress, "Missing", Entry.Value), Entry.Expected, "integer default follows native ToInt32 coercion");
		}

		EventsHooks.SetInt(unValidationAddress, "Count", g_nMinimumInt32);

		for (const Value of [7n, Symbol("integer")]) {
			g_Assert.throws(() => EventsHooks.SetInt(unValidationAddress, "Count", Value), TypeError, "signed32 write rejects invalid input");
			g_Assert.throws(() => EventsHooks.GetInt(unValidationAddress, "Missing", Value), TypeError, "signed32 default rejects invalid input");
			g_Assert.equal(EventsHooks.GetInt(unValidationAddress, "Count"), g_nMinimumInt32, "failed signed32 write preserves the previous value");
		}

		g_Assert.equal(EventsHooks.SetFloat(unValidationAddress, "Scale", 0.1), true);
		g_Assert.equal(EventsHooks.GetFloat(unValidationAddress, "Scale"), Math.fround(0.1), "float storage preserves native float precision");
		g_Assert.equal(EventsHooks.GetFloat(unValidationAddress, "Missing", 0.1), Math.fround(0.1), "float defaults preserve native float precision");

		for (const Entry of [
			{ Value: "1", Expected: 1 },
			{ Value: true, Expected: 1 },
			{ Value: null, Expected: 0 },
			{ Value: { valueOf: () => 0.1 }, Expected: Math.fround(0.1) },
		]) {
			g_Assert.equal(EventsHooks.SetFloat(unValidationAddress, "Scale", Entry.Value), true);
			g_Assert.equal(EventsHooks.GetFloat(unValidationAddress, "Scale"), Entry.Expected, "float write performs numeric conversion before narrowing");
			g_Assert.equal(EventsHooks.GetFloat(unValidationAddress, "Missing", Entry.Value), Entry.Expected, "float default performs numeric conversion before narrowing");
		}

		EventsHooks.SetFloat(unValidationAddress, "Scale", 0.1);

		for (const Value of [g_dblMaximumFloat * 2, -g_dblMaximumFloat * 2, 1n, Symbol("float"), NaN, Infinity]) {
			g_Assert.throws(() => EventsHooks.SetFloat(unValidationAddress, "Scale", Value), TypeError, "float write rejects invalid input");
			g_Assert.throws(() => EventsHooks.GetFloat(unValidationAddress, "Missing", Value), TypeError, "float default rejects invalid input");
			g_Assert.equal(EventsHooks.GetFloat(unValidationAddress, "Scale"), Math.fround(0.1), "failed float write preserves the previous value");
		}

		for (const Value of [new Error("event conversion failed"), null, undefined, 0, false]) {
			const Input = {
				valueOf() {
					throw Value;
				},
			};

			for (const Execute of [
				() => EventsHooks.SetInt(unValidationAddress, "Count", Input),
				() => EventsHooks.GetInt(unValidationAddress, "Missing", Input),
				() => EventsHooks.SetFloat(unValidationAddress, "Scale", Input),
				() => EventsHooks.GetFloat(unValidationAddress, "Missing", Input),
			]) {
				let bThrew = false;

				try {
					Execute();
				} catch (CaughtError) {
					bThrew = true;
					g_Assert.equal(CaughtError, Value, "preserve a numeric conversion exception unchanged");
				}

				g_Assert.equal(bThrew, true, "conversion must fail before native access");
			}

			g_Assert.equal(EventsHooks.GetInt(unValidationAddress, "Count"), g_nMinimumInt32);
			g_Assert.equal(EventsHooks.GetFloat(unValidationAddress, "Scale"), Math.fround(0.1));
		}

		if (bHasUInt64) {
			g_Assert.equal(EventsHooks.SetUInt64(unValidationAddress, "Sequence", g_unMaximumUInt64), true);
			g_Assert.equal(EventsHooks.GetUInt64(unValidationAddress, "Sequence"), g_unMaximumUInt64);
			g_Assert.equal(EventsHooks.GetUInt64(unValidationAddress, "Missing", g_unMaximumUInt64), g_unMaximumUInt64);

			for (const Value of [-1n, g_unMaximumUInt64 + 1n, 42, "42"]) {
				g_Assert.throws(() => EventsHooks.SetUInt64(unValidationAddress, "Sequence", Value), TypeError, "uint64 write rejects invalid input");
				g_Assert.throws(() => EventsHooks.GetUInt64(unValidationAddress, "Missing", Value), TypeError, "uint64 default rejects invalid input");
				g_Assert.equal(EventsHooks.GetUInt64(unValidationAddress, "Sequence"), g_unMaximumUInt64, "failed uint64 write preserves the previous value");
			}
		}

		g_Assert.throws(() => ManagedDispatcher({ Arguments: [g_unManagerAddress] }), /three arguments/);
		g_Assert.throws(() => ManagedDispatcher({ Arguments: [g_unManagerAddress, "1000", false] }), /positive BigInt event address/);
		g_Assert.throws(() => ManagedDispatcher({ Arguments: [g_unManagerAddress, unValidationAddress, 0] }), /bDoNotBroadcast argument must be boolean/);
		Fixture.ActiveEvents.delete(unValidationAddress);
		g_Assert.equal(EventsHooks.OffPre("PayloadValidation", NoOperation), true);

		const ReducedNativeEvents = { ...Fixture.NativeEvents };
		delete ReducedNativeEvents.GetUInt64;
		delete ReducedNativeEvents.SetUInt64;
		const ReducedEventsHooks = LoadEventsHooks(ReducedNativeEvents, Fixture.MemoryHooks);
		g_Assert.deepEqual(Object.keys(ReducedEventsHooks).sort(), [...g_vecMinimumExports].sort());
		g_Assert.equal(Object.hasOwn(ReducedEventsHooks, "GetUInt64"), false);
		g_Assert.equal(Object.hasOwn(ReducedEventsHooks, "SetUInt64"), false);

		for (const [strCallbackName, Expression] of [
			["SetEventBooleanCallback", /SetBool\(unEventAddress, strKeyName, bValue\) expects bValue to be a boolean/],
			["SetEventStringCallback", /SetString\(unEventAddress, strKeyName, strValue\) expects strValue to be a string/],
			["GetEventBooleanCallback", /GetBool\(unEventAddress, strKeyName, bDefaultValue\?\) expects bDefaultValue to be a boolean/],
			["GetEventStringCallback", /GetString\(unEventAddress, strKeyName, strDefaultValue\?\) expects strDefaultValue to be a string/],
		]) {
			const strCallbackSource = GetNativeCallbackSource(strNativeSource, strCallbackName);
			g_Assert.match(strCallbackSource, Expression, `native diagnostic within ${strCallbackName}`);
			g_Assert.match(strCallbackSource, /GetEventHookKeyArgument/, `native key validation within ${strCallbackName}`);
		}

		g_Assert.doesNotMatch(GetNativeCallbackSource(strNativeSource, "SetEventBooleanCallback"), /BooleanValue\(pIsolate\)/, "native event boolean setter does not coerce values");

		const vecEventInformationDiagnosticNames = ["kArgumentError", "kConstructionError", "kContextError", "kOperationName"];
		const AssertEventInformationDiagnostics = strCallbackSource => {
			for (const strConstantName of vecEventInformationDiagnosticNames) {
				const strDiagnosticPrefix = 'constexpr char ' + strConstantName + '[] = "memory/hooks/events.EventInfo(';
				g_Assert.ok(strCallbackSource.includes(strDiagnosticPrefix), "native event information diagnostic: " + strConstantName);
			}

			g_Assert.doesNotMatch(strCallbackSource, /memory\/hooks\/events\.EventInformation\(/, "diagnostics must name the public EventInfo export");
		};

		const strEventInformationCallbackSource = GetNativeCallbackSource(strNativeSource, "GetEventInformationCallback");
		AssertEventInformationDiagnostics(strEventInformationCallbackSource);

		for (const strConstantName of vecEventInformationDiagnosticNames) {
			const strCorrectPrefix = 'constexpr char ' + strConstantName + '[] = "memory/hooks/events.EventInfo(';
			const strIncorrectPrefix = 'constexpr char ' + strConstantName + '[] = "memory/hooks/events.EventInformation(';
			const strChangedSource = strEventInformationCallbackSource.replace(strCorrectPrefix, strIncorrectPrefix);
			g_Assert.notEqual(strChangedSource, strEventInformationCallbackSource, "diagnostic regression must alter the actual callback: " + strConstantName);
			g_Assert.throws(() => AssertEventInformationDiagnostics(strChangedSource), g_Assert.AssertionError, "reject the obsolete public diagnostic: " + strConstantName);
		}

		g_Assert.throws(() => LoadEventsHooks(undefined, Fixture.MemoryHooks), (ErrorValue) => (ErrorValue.constructor === Error) && (ErrorValue.code !== "MODULE_NOT_FOUND") && (ErrorValue.message === "SourceJS module is not installed: memory/hooks/events"));
	} finally {
		// Private model cleanup only; this does not exercise native hook/context teardown.
		for (const Handle of Fixture.HookHandles) {
			Handle.Active = false;
			Handle.PreCallbacks.length = 0;
			Handle.PostCallbacks.length = 0;
		}

		Fixture.ActiveEvents.clear();
		Fixture.DeclaredEvents.clear();
		Fixture.RuntimeCallbacks.clear();
		Fixture.PhysicalFiles.clear();
		Fixture.FiredEvents.length = 0;
		Fixture.FreedAddresses.length = 0;
		Fixture.HookHandles.length = 0;
		Fixture.SetFailNextPreRegistration(false);
		Fixture.SetFailNextRemove(false);
	}
}

RunSmoke(4, 7, true);
RunSmoke(8, 11, true);
RunSmoke(4, 7, false);
RunSmoke(8, 11, false);

console.log("[  OK  ] memory hooks events smoke passed: four width/availability fixtures, fifty-two normal documentation executions and 30835 controlled cleanup cases; native hook/ABI execution not exercised");
