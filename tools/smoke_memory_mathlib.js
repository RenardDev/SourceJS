#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strMathlibDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "mathlib.md");
const g_strMemoryDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory.md");
const g_strMemoryHelpersDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory-helpers.md");
const g_strMemoryHooksDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory-hooks.md");
const g_strMemoryManagerDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory-manager.md");
const g_strMathlibPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "mathlib.js");
const g_strMemoryPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory.js");
const g_strMemoryGameDataPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "gamedata.js");
const g_strMemoryHelpersPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "helpers.js");
const g_strMemoryHooksPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "hooks.js");
const g_strMemoryManagerPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "manager.js");
const g_strRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_unMaximumMockAddress = 0xFFFFFFFFn;
const g_dblMaximumMockFloat = 3.4028234663852886e38;
const g_vecKeyValuesBufferLoads = [];
const g_SourceModGameDataValue = {
	Games: {
		tf: {
			Signatures: {
				Burn: {
					library: "server",
					linux: "@_ZN15CTFPlayerShared4BurnEP9CTFPlayerP13CTFWeaponBasef",
					linux64: "@_ZN15CTFPlayerShared4BurnEP9CTFPlayerP13CTFWeaponBasef",
					windows: "",
					windows64: "\\x48\\x83\\xEC\\x2A",
				},
			},
		},
	},
};

const g_KeyValuesModuleMock = {
	KeyValues: {
		CreateKeyValuesFromBuffer(strKeyValuesText, bUsesEscapeSequences = false) {
			const KeyValuesLoad = {
				Destroyed: false,
				PreserveDuplicateKeys: false,
				UsesEscapeSequences: bUsesEscapeSequences,
				Text: strKeyValuesText,
			};
			g_vecKeyValuesBufferLoads.push(KeyValuesLoad);

			return {
				Name: "Games",

				ConvertKeyValuesToObject(bPreserveDuplicateKeys = false) {
					KeyValuesLoad.PreserveDuplicateKeys = bPreserveDuplicateKeys;

					return g_SourceModGameDataValue.Games;
				},

				DestroyKeyValues() {
					KeyValuesLoad.Destroyed = true;

					return true;
				},
			};
		},
	},
};

const g_OriginalModuleLoad = g_Module._load;
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_NativeBridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_ModuleCacheDescriptors = Object.getOwnPropertyDescriptors(require.cache);

function DefineLegacyStorageTraps(Target, vecMemberNames, strOwnerRole) {
	for (const strMemberName of vecMemberNames) {
		g_Assert.equal(strMemberName in Target, false, `Memory ${strOwnerRole} must not expose ${strMemberName}.`);
		Object.defineProperty(Target, strMemberName, {
			get() {
				throw new Error(`Legacy ${strOwnerRole} storage must not be read: ${strMemberName}`);
			},

			set() {
				g_Assert.fail(`Legacy ${strOwnerRole} storage must not be written: ${strMemberName}`);
			},
		});
	}

	return vecMemberNames.length;
}

function CheckFloatStructurePrivateStorage(Mathlib) {
	const vecStorageNames = ["m_vecComponentNames", "m_unAddress", "m_vecValues"];
	for (const StructureType of [Mathlib.Vector, Mathlib.QAngle, Mathlib.Quaternion, Mathlib.RadianEuler]) {
		const Structure = new StructureType();
		const vecComponentNames = Structure.ComponentNames;
		const vecLocalValues = Structure.Values;
		g_Assert.equal(Object.isFrozen(vecComponentNames), true);
		g_Assert.equal(Object.getOwnPropertyNames(Structure).some(strName => strName.startsWith("m_")), false, "Float-derived structures must not expose m_* backing fields.");

		for (const strStorageName of vecStorageNames) {
			g_Assert.equal(strStorageName in Structure, false);
			Object.defineProperty(Structure, strStorageName, {
				get() {
					throw new Error(`Public legacy field must not control float storage: ${strStorageName}`);
				},
			});
		}

		const vecExpectedValues = [];
		let unComponentValue = 1;
		for (const strComponentName of vecComponentNames) {
			Structure[strComponentName] = unComponentValue;
			vecExpectedValues.push(unComponentValue);
			unComponentValue += 1;
		}

		g_Assert.equal(Structure.Address, 0n);
		g_Assert.equal(Structure.HasMemoryAddress(), false);
		g_Assert.deepEqual(Structure.ConvertMathStructureToArray(), vecExpectedValues);
		g_Assert.deepEqual([...Structure], vecExpectedValues);
		g_Assert.strictEqual(Structure.Values, vecLocalValues);
		g_Assert.strictEqual(Structure.ComponentNames, vecComponentNames);
		const Copy = Structure.CopyMathStructure();
		g_Assert.equal(Structure.IsMathStructureEqual(Copy), true);
		Copy.X = 73;
		g_Assert.equal(Structure.X, 1);
		g_Assert.strictEqual(Copy.CopyMathStructureFrom(Structure), Copy);
		g_Assert.strictEqual(Structure.CopyMathStructureTo(Copy), Copy);
		vecLocalValues[0] = 29;
		g_Assert.equal(Structure.X, 29, "The documented detached Values array must remain mutable.");
		g_Assert.equal(Structure.IsMathStructureValid(), true);
		g_Assert.strictEqual(Structure.InvalidateMathStructure(), Structure);
		g_Assert.equal(Structure.IsMathStructureValid(), false);
	}

	console.log("[  OK  ] mathlib float private storage: 4 families and 12 legacy-field traps passed");
}

function CheckPlanePrivateStorage(Mathlib) {
	const PlaneValue = new Mathlib.Plane(new Mathlib.Vector(1, 2, 3), 4, 5, 6);
	const Normal = PlaneValue.Normal;
	g_Assert.deepEqual(Reflect.ownKeys(PlaneValue), [], "Plane must not expose m_* backing fields.");

	for (const strStorageName of ["m_unAddress", "m_LocalNormal", "m_flLocalDistance", "m_unLocalType", "m_unLocalSignBits"]) {
		g_Assert.equal(strStorageName in PlaneValue, false);
		Object.defineProperty(PlaneValue, strStorageName, {
			get() {
				throw new Error(`Public legacy field must not control Plane storage: ${strStorageName}`);
			},
		});
	}

	g_Assert.equal(PlaneValue.Address, 0n);
	g_Assert.equal(PlaneValue.HasMemoryAddress(), false);
	g_Assert.equal(PlaneValue.Distance, 4);
	g_Assert.equal(PlaneValue.Type, 5);
	g_Assert.equal(PlaneValue.SignBits, 6);
	const Copy = PlaneValue.CopyPlane();
	g_Assert.equal(PlaneValue.IsPlaneEqual(Copy), true);
	g_Assert.notStrictEqual(Copy.Normal, Normal);
	PlaneValue.Normal = new Mathlib.Vector(7, 8, 9);
	PlaneValue.Distance = 10;
	PlaneValue.Type = 11;
	PlaneValue.SignBits = 12;
	g_Assert.strictEqual(PlaneValue.Normal, Normal, "Detached Normal assignment must preserve its existing vector.");
	g_Assert.deepEqual(Normal.ConvertMathStructureToArray(), [7, 8, 9]);
	g_Assert.equal(PlaneValue.Distance, 10);
	g_Assert.equal(PlaneValue.Type, 11);
	g_Assert.equal(PlaneValue.SignBits, 12);
	g_Assert.strictEqual(Copy.CopyPlaneFrom(PlaneValue), Copy);
	g_Assert.strictEqual(PlaneValue.CopyPlaneTo(Copy), Copy);
	g_Assert.equal(PlaneValue.IsPlaneEqual(Copy), true);
	g_Assert.equal(PlaneValue.IsPlaneValid(), true);
	g_Assert.strictEqual(PlaneValue.InvalidatePlane(), PlaneValue);
	g_Assert.equal(PlaneValue.IsPlaneValid(), false);
	g_Assert.equal(Normal.IsMathStructureValid(), false);
	g_Assert.equal(Number.isNaN(PlaneValue.Distance), true);
	g_Assert.equal(PlaneValue.Type, 0);
	g_Assert.equal(PlaneValue.SignBits, 0);

	console.log("[  OK  ] mathlib Plane private storage: 5 legacy-field traps and PascalCase accessors passed");
}

function CheckMatrixPrivateStorage(Mathlib) {
	for (const MatrixType of [Mathlib.Matrix3x4, Mathlib.VMatrix]) {
		const Matrix = new MatrixType();
		const unRowCount = (MatrixType === Mathlib.Matrix3x4) ? 3 : 4;
		g_Assert.equal(Object.getOwnPropertyNames(Matrix).some(strName => strName.startsWith("m_")), false, "Matrices must not expose m_* backing fields.");

		for (const strStorageName of ["m_unRowCount", "m_unAddress", "m_vecValues"]) {
			g_Assert.equal(strStorageName in Matrix, false);
			Object.defineProperty(Matrix, strStorageName, {
				get() {
					throw new Error(`Public legacy field must not control matrix storage: ${strStorageName}`);
				},
			});
		}

		g_Assert.equal(Matrix.RowCount, unRowCount);
		g_Assert.equal(Matrix.Address, 0n);
		g_Assert.equal(Matrix.HasMemoryAddress(), false);
		const vecValues = Matrix.Values;
		g_Assert.equal(vecValues.length, unRowCount * 4);
		g_Assert.strictEqual(Matrix.Values, vecValues);
		vecValues[0] = 73;
		g_Assert.equal(Matrix[0][0], 73);
		const Row = Matrix.GetMatrixRow(0);
		g_Assert.strictEqual(Row.Matrix, Matrix);
		g_Assert.equal(Row.RowIndex, 0);
		Row[1] = 29;
		g_Assert.equal(Matrix.GetMatrixComponent(0, 1), 29);
		g_Assert.deepEqual([...Row], [73, 29, 0, 0]);
		const Copy = Matrix.CopyMathStructure();
		g_Assert.equal(Matrix.IsMatrixEqual(Copy), true);
		Copy[0][0] = 5;
		g_Assert.equal(Matrix[0][0], 73);
		g_Assert.strictEqual(Copy.CopyMathStructureFrom(Matrix), Copy);
		g_Assert.strictEqual(Matrix.CopyMathStructureTo(Copy), Copy);
		g_Assert.equal(Matrix.IsMathStructureValid(), true);
		const View = MatrixType.CreateFromAddress(0x1234n, 4);
		g_Assert.equal(View.Address, 0x1238n, "Borrowed matrix construction must attach the exact BigInt address without a public field.");
		g_Assert.equal(View.HasMemoryAddress(), true);
		g_Assert.equal(Object.getOwnPropertyNames(View).some(strName => strName.startsWith("m_")), false);
		g_Assert.equal(MatrixType.CreateFromAddress(0n).Address, 0n);

		if (typeof Matrix.InvalidateMatrix3x4 === "function") {
			g_Assert.strictEqual(Matrix.InvalidateMatrix3x4(), Matrix);
			g_Assert.equal(Matrix.IsMathStructureValid(), false);
		}
	}

	console.log("[  OK  ] mathlib matrix private storage: 2 families and 6 legacy-field traps passed");
}

function CheckGlobalAddressAccessorCall(Fixture) {
	const Memory = Fixture.Memory;
	const Manager = new Memory.Manager.TypeManager();

	class AccessorCallView extends Memory.Manager.CustomType {
	}

	Manager.DefineType("AccessorCallView", AccessorCallView, { Size: 1 });
	g_Assert.equal(Object.hasOwn(Fixture.RootHooks, "Call"), false, "The native fixture must not invent a Call alias.");
	const OriginalDescriptor = Object.getOwnPropertyDescriptor(Fixture.RootHooks, "CallFunction");
	g_Assert.ok(OriginalDescriptor && OriginalDescriptor.configurable);
	const unBackingAddress = Memory.Allocate(32);
	let unCallCount = 0;
	let ReturnValue = unBackingAddress + 16n;
	let InjectedFailure = null;

	try {
		g_Assert.equal(Fixture.Helpers.WriteAddress(unBackingAddress, 4n), true);
		Object.defineProperty(Fixture.RootHooks, "CallFunction", {
			...OriginalDescriptor,

			value(Options) {
				g_Assert.strictEqual(this, Fixture.RootHooks);
				g_Assert.deepEqual(Options, { Address: unBackingAddress + 8n, Arguments: [], Convention: "cdecl", ReturnType: "address" });
				unCallCount++;

				if (InjectedFailure !== null) {
					throw InjectedFailure.Value;
				}

				return ReturnValue;
			},
		});

		const View = Manager.GlobalAddress("AccessorCallView", "server", unBackingAddress, 4n, 0, true, true, 0n);
		g_Assert.equal(View.Address, unBackingAddress + 16n);
		g_Assert.equal(View.OwnsAddress, false);
		g_Assert.strictEqual(Manager.GetGlobalAddress("AccessorCallView"), View);
		g_Assert.equal(View.Deallocate(), false);
		g_Assert.equal(unCallCount, 1);

		for (const NullResult of [null, 0n]) {
			ReturnValue = NullResult;
			g_Assert.throws(() => Manager.GlobalAddress("AccessorCallView", "server", unBackingAddress, 4n, 0, true, true, 0n), /accessor returned a null address/);
			g_Assert.strictEqual(Manager.GetGlobalAddress("AccessorCallView"), View, "Failed accessor calls preserve the prior global address.");
		}

		for (const Failure of [new Error("Accessor call failed"), null, undefined, false, 0]) {
			InjectedFailure = { Value: Failure };
			let bThrew = false;
			let CaughtValue = undefined;

			try {
				Manager.GlobalAddress("AccessorCallView", "server", unBackingAddress, 4n, 0, true, true, 0n);
			} catch (ErrorValue) {
				bThrew = true;
				CaughtValue = ErrorValue;
			}

			g_Assert.equal(bThrew, true);
			g_Assert.strictEqual(CaughtValue, Failure, "Accessor calls preserve exact native-interface failures.");
			g_Assert.strictEqual(Manager.GetGlobalAddress("AccessorCallView"), View);
		}

		InjectedFailure = null;
		const DirectView = Manager.GlobalAddress("AccessorCallView", "server", unBackingAddress, 4n);
		g_Assert.equal(DirectView.Address, unBackingAddress + 4n);
		g_Assert.equal(DirectView.OwnsAddress, false);
		g_Assert.equal(unCallCount, 8, "Non-accessor lookup must not call native code.");
	} finally {
		Object.defineProperty(Fixture.RootHooks, "CallFunction", OriginalDescriptor);
		Manager.GlobalAddresses.clear();
		g_Assert.equal(Memory.Deallocate(unBackingAddress), true);
	}

	console.log("[  OK  ] global address accessor CallFunction: 9 dispatch/null/falsy-failure/non-accessor cases passed with native doubles");
}

function CheckMemoryManagerPrivateStorage(Memory, MemoryManager) {
	let unTrapCount = 0;
	const Manager = new MemoryManager.TypeManager();
	unTrapCount += DefineLegacyStorageTraps(Manager, ["m_mapGlobalAddresses", "m_mapConverters", "m_mapFunctionTypedefs"], "manager");
	g_Assert.equal(Object.getOwnPropertySymbols(Manager).length, 0);

	for (const strPropertyName of ["GlobalAddresses", "Converters", "FunctionTypedefs"]) {
		const mapValues = Manager[strPropertyName];
		g_Assert.ok(mapValues instanceof Map);
		g_Assert.strictEqual(Manager[strPropertyName], mapValues);
		g_Assert.throws(() => {
			Manager[strPropertyName] = new Map();
		}, TypeError, "Manager tables remain read-only properties with live mutable collections.");
	}

	const ConvertAddress = unAddress => unAddress;
	g_Assert.strictEqual(Manager.RegisterConverter("PrivateStorageAddress", ConvertAddress), ConvertAddress);
	g_Assert.strictEqual(Manager.Converters.get("PrivateStorageAddress"), ConvertAddress);
	g_Assert.equal(Manager.UnregisterConverter("PrivateStorageAddress"), true);
	g_Assert.equal(Manager.Converters.has("PrivateStorageAddress"), false);

	let unDestructorCalls = 0;
	class PrivateStorageOwner extends MemoryManager.CustomType {
	}

	Manager.DefineType("PrivateStorageOwner", PrivateStorageOwner, {
		Size: 8,

		DestructorCallback() {
			unDestructorCalls++;
		},
	});
	unTrapCount += DefineLegacyStorageTraps(PrivateStorageOwner.prototype, ["m_bOwnsAddress", "m_bServerAddressCheck", "m_setAllocatedAddresses", "m_mapAddressValues"], "manager");
	const Owner = new PrivateStorageOwner();
	const setChildAddresses = Owner.AllocatedAddresses;
	const mapRetainedValues = Owner.AddressValues;

	try {
		g_Assert.equal(Object.getOwnPropertySymbols(Owner).length, 0);
		g_Assert.equal(Owner.OwnsAddress, true);
		g_Assert.strictEqual(Owner.AllocatedAddresses, setChildAddresses);
		g_Assert.strictEqual(Owner.AddressValues, mapRetainedValues);

		Owner.ServerAddressCheck = false;
		g_Assert.equal(Owner.ServerAddressCheck, false);
		g_Assert.equal(PrivateStorageOwner.ServerCheck, true);

		for (const strPropertyName of ["OwnsAddress", "AllocatedAddresses", "AddressValues"]) {
			g_Assert.throws(() => {
				Owner[strPropertyName] = null;
			}, TypeError, "CustomType ownership properties remain read-only.");
		}

		const View = PrivateStorageOwner.CreateFromAddress(Owner.Address);
		const ArithmeticView = Owner.Add(0n);
		g_Assert.equal(View.OwnsAddress, false);
		g_Assert.equal(ArithmeticView.OwnsAddress, false);
		g_Assert.equal(ArithmeticView.Address, Owner.Address);
		g_Assert.notStrictEqual(View.AllocatedAddresses, setChildAddresses);
		g_Assert.notStrictEqual(View.AddressValues, mapRetainedValues);
		g_Assert.equal(View.Deallocate(), false);
		g_Assert.equal(ArithmeticView.Deallocate(), false);
		g_Assert.equal(unDestructorCalls, 0);
		Owner.Write("int", 73);
		g_Assert.equal(Owner.Read("int"), 73);

		const unChildAddress = Memory.Allocate(1);
		setChildAddresses.add(unChildAddress);
		mapRetainedValues.set("Retained", View);

		g_Assert.equal(Owner.Deallocate(), true);
		g_Assert.equal(Owner.OwnsAddress, false);
		g_Assert.equal(Owner.Address, 0n);
		g_Assert.equal(setChildAddresses.size, 0);
		g_Assert.equal(mapRetainedValues.size, 0);
		g_Assert.equal(unDestructorCalls, 1);
		g_Assert.equal(Owner.Deallocate(), false);
		g_Assert.equal(unDestructorCalls, 1);
	} finally {
		if (Owner.OwnsAddress) {
			g_Assert.equal(Owner.Deallocate(), true);
		}
	}

	g_Assert.equal(unTrapCount, 7);
	console.log("[  OK  ] memory manager private storage: 7 legacy-field traps, owned/wrapped views and PascalCase ownership collections passed");
}

function CheckMemoryHelperPrivateStorage(Helpers, NativeHooks) {
	let unTrapCount = 0;
	const setAllocatedAddresses = new Set();
	const mapAddressValues = new Map();
	const View = new Helpers.ArrayView(null, false, Helpers.Type.Int, 0n, 2, setAllocatedAddresses, mapAddressValues);
	g_Assert.equal(Object.getOwnPropertySymbols(View).length, 0);
	unTrapCount += DefineLegacyStorageTraps(View, ["m_TypeManager", "m_bAddressArray", "m_strTypeName", "m_unLength", "m_setAllocatedAddresses", "m_mapAddressValues"], "helper");
	g_Assert.equal(View.TypeManager, null);
	g_Assert.equal(View.AddressArray, false);
	g_Assert.equal(View.TypeName, Helpers.Type.Int);
	g_Assert.equal(View.Length, 2);
	g_Assert.strictEqual(View.AllocatedAddresses, setAllocatedAddresses);
	g_Assert.strictEqual(View.AddressValues, mapAddressValues);
	g_Assert.equal(View.GetOffset(1), BigInt(Helpers.Type.GetDataTypeSize(Helpers.Type.Int)));
	g_Assert.equal(View.Add(4n).Address, 4n);
	g_Assert.equal(View.Add(4n).Subtract(4n).Address, 0n);
	g_Assert.strictEqual(View.Add(4n).AllocatedAddresses, setAllocatedAddresses);
	g_Assert.strictEqual(View.Add(4n).AddressValues, mapAddressValues);

	for (const strPropertyName of ["TypeManager", "AddressArray", "TypeName", "Length", "AllocatedAddresses", "AddressValues"]) {
		g_Assert.throws(() => {
			View[strPropertyName] = undefined;
		}, TypeError, `${strPropertyName} remains read-only.`);
	}

	View.At = (unArrayIndex) => 100 + unArrayIndex;
	g_Assert.deepEqual(View.ToArray(), [100, 101]);
	g_Assert.deepEqual([...View.Keys()], [0, 1]);
	g_Assert.deepEqual([...View.Entries()], [[0, 100], [1, 101]]);
	g_Assert.deepEqual([...View.Values()], [100, 101]);
	const vecCallbackValues = [];
	View.ForEach((ElementValue) => vecCallbackValues.push(ElementValue));
	g_Assert.deepEqual(vecCallbackValues, [100, 101]);

	const ThisObject = {};
	const vecArgumentTypes = ["int"];
	const Callable = new Helpers.MemberFunction(null, "int", 0x5000n, ThisObject, vecArgumentTypes, "cdecl");
	g_Assert.equal(Object.getOwnPropertySymbols(Callable).length, 0);
	unTrapCount += DefineLegacyStorageTraps(Callable, ["m_TypeManager", "m_strReturnType", "m_unFunctionAddress", "m_ThisObject", "m_vecArgumentTypes", "m_strConvention"], "helper");
	g_Assert.equal(Callable.TypeManager, null);
	g_Assert.equal(Callable.ReturnType, "int");
	g_Assert.equal(Callable.FunctionAddress, 0x5000n);
	g_Assert.strictEqual(Callable.ThisObject, ThisObject);
	g_Assert.strictEqual(Callable.ArgumentTypes, vecArgumentTypes);
	g_Assert.equal(Callable.Convention, "cdecl");
	const OriginalCallFunction = NativeHooks.CallFunction;
	const vecCalls = [];

	try {
		NativeHooks.CallFunction = function CallFunction(Options) {
			g_Assert.strictEqual(this, NativeHooks);
			vecCalls.push(Options);

			return (Options.ReturnType === "void") ? undefined : 17;
		};

		g_Assert.equal(Callable.Call(7), 17);
		g_Assert.deepEqual(vecCalls[0], { Address: 0x5000n, Convention: "cdecl", ReturnType: "int", ThisObject, Arguments: [{ Type: "int", Value: 7 }] });

		const TypeManager = {};
		const NewThisObject = {};
		const vecNewArgumentTypes = ["float"];
		Callable.TypeManager = TypeManager;
		// Uppercase input deliberately verifies the public type normalizer.
		Callable.ReturnType = "VOID";
		Callable.FunctionAddress = 0x6000n;
		Callable.ThisObject = NewThisObject;
		Callable.ArgumentTypes = vecNewArgumentTypes;
		Callable.Convention = "thiscall";
		g_Assert.strictEqual(Callable.TypeManager, TypeManager);
		g_Assert.equal(Callable.ReturnType, "void");
		g_Assert.equal(Callable.FunctionAddress, 0x6000n);
		g_Assert.strictEqual(Callable.ThisObject, NewThisObject);
		g_Assert.strictEqual(Callable.ArgumentTypes, vecNewArgumentTypes);
		g_Assert.equal(Callable.Convention, "thiscall");
		g_Assert.equal(Callable.Call(1.25), undefined);
		g_Assert.deepEqual(vecCalls[1], { Address: 0x6000n, Convention: "thiscall", ReturnType: "void", ThisObject: NewThisObject, Arguments: [{ Type: "float", Value: 1.25 }] });

		for (const InvalidAssignment of [
			{ PropertyName: "ReturnType", Value: "" },
			{ PropertyName: "FunctionAddress", Value: 17 },
			{ PropertyName: "ArgumentTypes", Value: ["void"] },
			{ PropertyName: "Convention", Value: "invalid" },
		]) {
			const PreviousValue = Callable[InvalidAssignment.PropertyName];
			g_Assert.throws(() => {
				Callable[InvalidAssignment.PropertyName] = InvalidAssignment.Value;
			});
			g_Assert.strictEqual(Callable[InvalidAssignment.PropertyName], PreviousValue, "Failed normalization preserves prior private state.");
		}
	} finally {
		NativeHooks.CallFunction = OriginalCallFunction;
	}

	g_Assert.equal(unTrapCount, 12);
	console.log("[  OK  ] memory helpers private storage: 12 legacy-field traps, read-only ArrayView metadata and editable PascalCase MemberFunction properties passed");
}

function CheckBaseAddressPrivateStorage(Memory) {
	const BaseAddress = Object.getPrototypeOf(Memory.Address);
	let unCaseCount = 0;
	for (const AddressType of [BaseAddress, Memory.Address]) {
		for (const unInitialAddress of [0n, 0x5000n, null]) {
			const AddressValue = new AddressType(unInitialAddress);
			g_Assert.equal("m_unAddress" in AddressValue, false, "Address storage must not expose the legacy m_unAddress accessor.");
			g_Assert.equal("m_bNull" in AddressValue, false);
			g_Assert.equal(Object.getOwnPropertySymbols(AddressValue).length, 0);

			// Legacy names are deliberately poisoned negative-test inputs.
			Object.defineProperties(AddressValue, {
				m_unAddress: {
					get() {
						throw new Error("Legacy address storage must not be read.");
					},

					set(unAddress) {
						g_Assert.fail(`Legacy address storage must not be written (${typeof unAddress}).`);
					},
				},
				m_bNull: {
					get() {
						throw new Error("Legacy null storage must not be read.");
					},
				},
			});
			g_Assert.equal(AddressValue.Null, (unInitialAddress === null) || (unInitialAddress === 0n));
			g_Assert.equal(AddressValue.HasAddress(), !AddressValue.Null);
			g_Assert.throws(() => {
				AddressValue.Address = 0n;
			}, TypeError, "Address remains a read-only public property.");
			BaseAddress.RebindAddress(AddressValue, 0x6000n);
			g_Assert.equal(AddressValue.Address, 0x6000n);
			g_Assert.equal(AddressValue.Null, false);
			g_Assert.equal(AddressValue.HasAddress(), true);
			g_Assert.equal(AddressValue.valueOf(), 0x6000n);
			g_Assert.equal(AddressValue.toString(), "0x6000");
			g_Assert.equal(AddressValue.Add(8n).Address, 0x6008n);
			g_Assert.equal(AddressValue.Subtract(8n).Address, 0x5FF8n);

			for (const InvalidAddress of [1, -1n, "0x6000", Infinity, {}]) {
				g_Assert.throws(() => BaseAddress.RebindAddress(AddressValue, InvalidAddress));
				g_Assert.equal(AddressValue.Address, 0x6000n, "Failed normalization must not change private storage.");
			}

			BaseAddress.RebindAddress(AddressValue, null);
			g_Assert.equal(AddressValue.Address, 0n);
			g_Assert.equal(AddressValue.Null, true);
			g_Assert.equal(AddressValue.HasAddress(), false);
			unCaseCount += 1;
		}
	}

	g_Assert.throws(() => BaseAddress.RebindAddress({}, 0n), TypeError);
	g_Assert.equal(unCaseCount, 6);
	console.log("[  OK  ] memory private address storage: 6 wrapper cases, 30 invalid rebinds and read-only PascalCase properties passed");
}

function VerifyManagerFailureIdentity(vecInjectedValues, vecFailures, bThrown, CaughtValue, strContext) {
	const setInjectedValues = new Set(vecInjectedValues);
	const CollectFailureLeaves = Value => (!setInjectedValues.has(Value) && (Value instanceof AggregateError)) ? Value.errors.flatMap(CollectFailureLeaves) : [Value];
	const vecActualFailures = bThrown ? CollectFailureLeaves(CaughtValue) : [];
	g_Assert.equal(vecActualFailures.length, vecFailures.length, strContext + " must retain all failures");

	for (let unIndex = 0; unIndex < vecFailures.length; unIndex++) {
		g_Assert.strictEqual(vecActualFailures[unIndex], vecFailures[unIndex], strContext + " must preserve failure identity and order");
	}
}

function CreateControlledManagerArrayDescriptor(Descriptor, unSuccessfulGetCount, Primary, ThrowFailure) {
	let unGetCount = 0;

	return {
		...Descriptor,

		get() {
			const View = Descriptor.get.call(this);
			unGetCount++;

			if (unGetCount > unSuccessfulGetCount) {
				if (Primary.Mode === "THROW") {
					ThrowFailure(Primary.Value);
				}

				if (Primary.Mode === "WRONG") {
					return {
						Address: 0n,
						Length: 0,

						At() {
							return 0;
						},
					};
				}
			}

			return View;
		},
	};
}

function VerifyManagerAllocationAndConverterDocumentation(vecExamples, MemoryManager, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const vecValues = [
		new Error("Controlled manager workflow failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([undefined, 0], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecRegistryExamples = [
		{ Index: 2, Name: "AddressHexadecimal", Kind: "CONVERTER" },
		{ Index: 33, Name: "ExportAddress", Kind: "CONVERTER" },
		{ Index: 34, Name: "AddressHexadecimal", Kind: "CONVERTER" },
		{ Index: 50, Name: "InterfaceFactory", Kind: "TYPEDEF" },
		{ Index: 57, Name: "InterfaceAddressView", Kind: "CONVERTER" },
		{ Index: 61, Name: "AddressView", Kind: "CONVERTER" },
	];
	const mapOwnerExamples = new Map([
		["COUNTER", 1],
		["FLAGS", 16],
		["DEALLOCATE", 28],
		["ADDRESS", 30],
		["DESTRUCTOR", 31],
		["CREATED", 42],
		["OBJECT", 43],
		["DEFINED", 46],
		["GET_CLASS", 51],
		["REGISTERED", 58],
		["STATIC_VALUE", 59],
		["STATIC_ADDRESS", 60],
	]);
	const vecCases = [];
	for (const Primary of vecPrimaryFailures) {
		for (const Cleanup of vecCleanupFailures) {
			for (const strKind of mapOwnerExamples.keys()) {
				vecCases.push({ Kind: strKind, Primary, Cleanup });
			}

			for (const Example of vecRegistryExamples) {
				vecCases.push({ Kind: Example.Kind, Example, Stage: "CONVERT", Primary, Cleanup });
			}
		}
	}

	for (const Example of vecRegistryExamples) {
		for (const Value of vecValues) {
			vecCases.push({ Kind: Example.Kind, Example, Stage: "REGISTER_BEFORE", Primary: { Mode: "THROW", Value }, Cleanup: { Mode: "NONE" } });

			for (const Cleanup of vecCleanupFailures) {
				vecCases.push({ Kind: Example.Kind, Example, Stage: "REGISTER_AFTER", Primary: { Mode: "THROW", Value }, Cleanup });
			}
		}

		for (const Cleanup of vecCleanupFailures) {
			vecCases.push({ Kind: Example.Kind, Example, Stage: "REGISTER_WRONG", Primary: { Mode: "WRONG" }, Cleanup });
		}

		if (Example.Kind === "CONVERTER") {
			vecCases.push({ Kind: Example.Kind, Example, Stage: "REGISTER_FOREIGN", Primary: { Mode: "THROW", Value: vecValues[0] }, Cleanup: { Mode: "NONE" } });
		}
	}

	const { CustomType, TypeManager } = MemoryManager;
	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		const vecInstances = [];
		const vecManagers = [];
		const ForeignCallback = unAddress => unAddress;
		const bRegistryScenario = ["CONVERTER", "TYPEDEF"].includes(Scenario.Kind);
		let unDeallocateCalls = 0;
		let unUnregisterCalls = 0;
		let bFixtureCleanup = false;
		const strConverterName = Scenario.Example?.Name ?? "AddressHexadecimal";
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		const ApplyCleanup = Cleanup => {
			if (Scenario.Cleanup.Mode === "THROW") {
				ThrowFailure(Scenario.Cleanup.Value);
			}

			if (Scenario.Cleanup.Mode === "FALSE") {
				return false;
			}

			const Result = Cleanup();

			if (Scenario.Cleanup.Mode === "THROW_AFTER") {
				ThrowFailure(Scenario.Cleanup.Value);
			}

			return (Scenario.Cleanup.Mode === "WRONG") ? undefined : Result;
		};

		class ControlledCustomType extends CustomType {
			constructor(...vecArguments) {
				super(...vecArguments);
				vecInstances.push(this);
			}

			GetMemoryAddress() {
				const unAddress = super.GetMemoryAddress();

				if (["COUNTER", "ADDRESS"].includes(Scenario.Kind) && (Scenario.Primary.Mode === "THROW")) {
					ThrowFailure(Scenario.Primary.Value);
				}

				return (["COUNTER", "ADDRESS"].includes(Scenario.Kind) && (Scenario.Primary.Mode === "WRONG")) ? 0n : unAddress;
			}

			Deallocate() {
				unDeallocateCalls++;

				if (unDeallocateCalls === 1) {
					return ApplyCleanup(() => super.Deallocate());
				}

				const bReleased = super.Deallocate();

				if ((Scenario.Kind === "DEALLOCATE") && (Scenario.Primary.Mode === "THROW")) {
					ThrowFailure(Scenario.Primary.Value);
				}

				return ((Scenario.Kind === "DEALLOCATE") && (Scenario.Primary.Mode === "WRONG")) ? true : bReleased;
			}

			OnDeallocate() {
				super.OnDeallocate();

				if (!bFixtureCleanup && (Scenario.Kind === "DESTRUCTOR")) {
					if (Scenario.Primary.Mode === "THROW") {
						ThrowFailure(Scenario.Primary.Value);
					}

					if (Scenario.Primary.Mode === "WRONG") {
						super.OnDeallocate();
					}
				}
			}
		}

		class ControlledTypeManager extends TypeManager {
			constructor() {
				super();
				vecManagers.push(this);
				TypeManager.prototype.RegisterConverter.call(this, "ForeignConverter", ForeignCallback);

				if (Scenario.Kind === "TYPEDEF") {
					const mapTypedefs = this.FunctionTypedefs;
					Map.prototype.set.call(mapTypedefs, "ForeignTypedef", ForeignCallback);

					mapTypedefs.delete = function Delete(strName) {
						unUnregisterCalls++;

						return ApplyCleanup(() => Map.prototype.delete.call(this, strName));
					};
				}
			}

			CreateType(strTypeName, TypeDescriptor = {}, BaseType = ControlledCustomType) {
				return super.CreateType(strTypeName, TypeDescriptor, BaseType);
			}

			CreateTypeFromObject(strTypeName, TypeDefinition, BaseType = ControlledCustomType) {
				return super.CreateTypeFromObject(strTypeName, TypeDefinition, BaseType);
			}

			StaticInstanceArray(...vecArguments) {
				const Descriptor = super.StaticInstanceArray(...vecArguments);

				return (Scenario.Kind === "STATIC_VALUE") ? CreateControlledManagerArrayDescriptor(Descriptor, 5, Scenario.Primary, ThrowFailure) : Descriptor;
			}

			StaticAddressArray(...vecArguments) {
				const Descriptor = super.StaticAddressArray(...vecArguments);

				return (Scenario.Kind === "STATIC_ADDRESS") ? CreateControlledManagerArrayDescriptor(Descriptor, 3, Scenario.Primary, ThrowFailure) : Descriptor;
			}

			RegisterConverter(strName, Converter) {
				if (Scenario.Stage === "REGISTER_BEFORE") {
					ThrowFailure(Scenario.Primary.Value);
				}

				const Result = super.RegisterConverter(strName, Converter);

				if (Scenario.Stage === "REGISTER_AFTER") {
					ThrowFailure(Scenario.Primary.Value);
				}

				if (Scenario.Stage === "REGISTER_FOREIGN") {
					super.RegisterConverter(strName, ForeignCallback);
					ThrowFailure(Scenario.Primary.Value);
				}

				return (Scenario.Stage === "REGISTER_WRONG") ? undefined : Result;
			}

			GetClass(strName) {
				const TypeConstructor = super.GetClass(strName);
				const bBodyCheck = ["FLAGS", "CREATED", "OBJECT", "DEFINED", "REGISTERED"].includes(Scenario.Kind) || ((Scenario.Kind === "GET_CLASS") && (strName === "MissingType"));
				if (bBodyCheck && (Scenario.Primary.Mode === "THROW")) {
					ThrowFailure(Scenario.Primary.Value);
				}

				if (bBodyCheck && (Scenario.Primary.Mode === "WRONG")) {
					return (Scenario.Kind === "GET_CLASS") ? ControlledCustomType : null;
				}

				return TypeConstructor;
			}

			FunctionTypedef(...vecArguments) {
				if (Scenario.Stage === "REGISTER_BEFORE") {
					ThrowFailure(Scenario.Primary.Value);
				}

				const Factory = super.FunctionTypedef(...vecArguments);

				if (Scenario.Stage === "REGISTER_AFTER") {
					ThrowFailure(Scenario.Primary.Value);
				}

				if (Scenario.Stage === "REGISTER_WRONG") {
					return undefined;
				}

				return function CreateControlledCallable(unAddress) {
					const Callable = Factory(unAddress);

					return new Proxy(Callable, {
						apply(Target, ThisArgument, vecArguments) {
							const Result = Reflect.apply(Target, ThisArgument, vecArguments);

							if (Scenario.Primary.Mode === "THROW") {
								ThrowFailure(Scenario.Primary.Value);
							}

							return (Scenario.Primary.Mode === "WRONG") ? 0n : Result;
						},
					});
				};
			}

			Convert(strName, unAddress) {
				const Result = super.Convert(strName, unAddress);

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				return (Scenario.Primary.Mode === "WRONG") ? "Wrong conversion" : Result;
			}

			UnregisterConverter(strName) {
				unUnregisterCalls++;

				return ApplyCleanup(() => super.UnregisterConverter(strName));
			}
		}

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => {
			if (strName !== "memory/manager") {
				return RequireDocumentation(strName);
			}

			const Runtime = { ...MemoryManager, CustomType: ControlledCustomType, TypeManager: ControlledTypeManager };
			if (["FLAGS", "DEALLOCATE", "ADDRESS", "DESTRUCTOR"].includes(Scenario.Kind)) {
				Runtime.Manager = new ControlledTypeManager();
			}

			return Runtime;
		};

		const unExampleIndex = bRegistryScenario ? Scenario.Example.Index : mapOwnerExamples.get(Scenario.Kind);
		const Run = new Function("require", "Error", '"use strict";\n' + vecExamples[unExampleIndex]);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				const Context = g_VM.createContext({ Run, Require, RecordedError });
				new g_VM.Script("Run(Require, RecordedError);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, Scenario.Kind);
			g_Assert.equal(bThrown, (Scenario.Primary.Mode !== "NONE") || (Scenario.Cleanup.Mode !== "NONE"), Scenario.Kind);
			g_Assert.equal(vecManagers.length, 1, Scenario.Kind);
			g_Assert.strictEqual(vecManagers[0].Converters.get("ForeignConverter"), ForeignCallback, "unrelated converter must remain registered");

			if (!bRegistryScenario) {
				g_Assert.equal(vecInstances.length, 1);
				const bFailed = (Scenario.Primary.Mode !== "NONE") || (Scenario.Cleanup.Mode !== "NONE");
				const bSuccessfulProbe = ["COUNTER", "DESTRUCTOR"].includes(Scenario.Kind) && !bFailed;
				const bDeallocateProbe = (Scenario.Kind === "DEALLOCATE") && (Scenario.Cleanup.Mode === "NONE");
				g_Assert.equal(unDeallocateCalls, (bSuccessfulProbe || bDeallocateProbe) ? 2 : 1, "failed release must not be silently retried");
				const bRetained = (Scenario.Cleanup.Mode === "THROW") || (Scenario.Cleanup.Mode === "FALSE") || ((Scenario.Kind === "DESTRUCTOR") && (Scenario.Primary.Mode === "THROW"));
				const unRetainedAllocations = (vecInstances[0].OwnsAddress ? 1 : 0) + vecInstances[0].AllocatedAddresses.size;
				g_Assert.equal(GetAllocationCount(), unAllocationsBefore + unRetainedAllocations);
				g_Assert.equal(vecInstances[0].OwnsAddress, bRetained);

			} else {
				const bRegistered = !["REGISTER_BEFORE", "REGISTER_FOREIGN"].includes(Scenario.Stage);
				const bSuccessfulRemovalProbe = (Scenario.Example.Index === 61) && (Scenario.Stage === "CONVERT") && (Scenario.Primary.Mode === "NONE") && (Scenario.Cleanup.Mode === "NONE");
				g_Assert.equal(unUnregisterCalls, bSuccessfulRemovalProbe ? 2 : (bRegistered ? 1 : 0), "failed cleanup must not be silently retried");
				const mapRegistrations = (Scenario.Kind === "TYPEDEF") ? vecManagers[0].FunctionTypedefs : vecManagers[0].Converters;
				const Converter = mapRegistrations.get(strConverterName);
				const bRetained = bRegistered && ((Scenario.Cleanup.Mode === "THROW") || (Scenario.Cleanup.Mode === "FALSE"));
				if (Scenario.Stage === "REGISTER_FOREIGN") {
					g_Assert.strictEqual(Converter, ForeignCallback);

				} else {
					g_Assert.equal(typeof Converter, bRetained ? "function" : "undefined");
				}

				if (Scenario.Kind === "TYPEDEF") {
					g_Assert.strictEqual(mapRegistrations.get("ForeignTypedef"), ForeignCallback);
				}
			}

			unCaseCount++;
		} finally {
			bFixtureCleanup = true;

			for (const Instance of vecInstances) {
				if (Instance.OwnsAddress) {
					g_Assert.equal(CustomType.prototype.Deallocate.call(Instance), true);
				}
			}

			for (const Manager of vecManagers) {
				if (Scenario.Kind === "TYPEDEF") {
					// Either delete result leaves this fixture-only entry absent.
					Map.prototype.delete.call(Manager.FunctionTypedefs, strConverterName);
					g_Assert.equal(Manager.FunctionTypedefs.has(strConverterName), false);

				} else {
					TypeManager.prototype.UnregisterConverter.call(Manager, strConverterName);
					g_Assert.equal(Manager.Converters.has(strConverterName), false);
				}
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	}

	g_Assert.equal(unCaseCount, 2831);

	return unCaseCount;
}

function VerifyManagerFileDocumentation(vecExamples, MemoryManager, RequireDocumentation, GetFileCount, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const FileSystem = RequireDocumentation("filesystem");
	const vecValues = [
		new Error("Controlled GameData failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([null, ""], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }, { Mode: "EXIST_BEFORE", Value }, { Mode: "EXIST_VERIFY", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
		{ Mode: "RETAIN" },
	];
	const vecWriteFailures = [
		...vecValues.flatMap(Value => [{ Mode: "THROW_BEFORE", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE_BEFORE" },
		{ Mode: "FALSE_AFTER" },
		{ Mode: "WRONG_AFTER" },
	];
	const vecOwnerFailures = [
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecSpecifications = [
		{ Index: 7, File: "memory-manager-options.json", Operation: "CreateGameDataCallableOptions", WrongValue: null, Writes: 1 },
		{ Index: 10, File: "memory-manager-files.json", Operation: "GetAllGameDataFiles", WrongValue: [], Writes: 1 },
		{ Index: 13, File: "memory-manager-get.json", Operation: "GetGameDataValue", WrongValue: "Wrong value", Writes: 1 },
		{ Index: 14, File: "memory-manager-load.json", Operation: "LoadGameDataFile", WrongValue: { Revision: -1 }, Writes: 2 },
		{ Index: 17, File: "memory-manager-offset.json", Operation: "GetGameDataOffset", WrongValue: -1, Writes: 1 },
		{ Index: 20, File: "memory-manager-address.json", Operation: "GetGameDataAddress", WrongValue: null, Writes: 1 },
		{ Index: 23, File: "memory-manager-signature.json", Operation: "GetGameDataSignature", WrongValue: null, Writes: 1 },
		{ Index: 35, File: "memory-manager-function-typedefs.json", Operation: "CreateFunctionTypedefsFromFile", WrongValue: {}, Writes: 1, ClassMethod: true, Registry: "TYPEDEF" },
		{ Index: 37, File: "memory-manager-global-addresses.json", Operation: "CreateGlobalAddressesFromFile", WrongValue: {}, Writes: 1, ClassMethod: true },
		{ Index: 41, File: "memory-manager-pipe.json", Operation: "CreatePipeFromFile", WrongValue: null, Writes: 1, ClassMethod: true, RootFile: true },
		{ Index: 44, File: "memory-manager-counter-type.json", Operation: "CreateTypeFromFile", Writes: 1, ClassMethod: true, RootFile: true, OwnedType: true },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		for (const Primary of vecPrimaryFailures) {
			for (const Cleanup of vecCleanupFailures) {
				vecCases.push({ Specification, Primary, Cleanup });
			}
		}

		for (let unWriteIndex = 1; unWriteIndex <= Specification.Writes; unWriteIndex++) {
			for (const Write of vecWriteFailures) {
				for (const Cleanup of vecCleanupFailures) {
					vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanup, Write, WriteIndex: unWriteIndex });
				}
			}
		}

		vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanup: { Mode: "NONE" }, Preexisting: true });

		if (Specification.Registry === "TYPEDEF") {
			const vecRegistryFailures = [
				{ Mode: "THROW", Value: vecValues[0] },
				{ Mode: "FALSE" },
				{ Mode: "WRONG" },
				{ Mode: "RETAIN" },
				{ Mode: "HAS_BEFORE", Value: undefined },
				{ Mode: "HAS_VERIFY", Value: null },
			];
			for (const Registry of vecRegistryFailures) {
				for (const Primary of [{ Mode: "NONE" }, { Mode: "THROW", Value: 0 }]) {
					for (const Cleanup of [{ Mode: "NONE" }, { Mode: "THROW", Value: vecValues[0] }]) {
						vecCases.push({ Specification, Registry, Primary, Cleanup });
					}
				}
			}
		}

		if (Specification.OwnedType) {
			for (const OwnerCleanup of vecOwnerFailures) {
				for (const Primary of [{ Mode: "NONE" }, { Mode: "WRONG" }]) {
					for (const Cleanup of vecCleanupFailures) {
						vecCases.push({ Specification, OwnerCleanup, Primary, Cleanup });
					}
				}
			}

			for (const Value of vecValues) {
				for (const Cleanup of vecCleanupFailures) {
					vecCases.push({ Specification, Constructor: { Value }, Primary: { Mode: "NONE" }, Cleanup });
				}
			}
		}
	}

	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const { Specification } = Scenario;
		const strFilePath = Specification.RootFile ? `${MemoryManager.ROOT}/${Specification.File}` : `${MemoryManager.ROOT}/sourcejs-docs/${Specification.File}`;
		const unFilesBefore = GetFileCount();
		const unAllocationsBefore = GetAllocationCount();
		g_Assert.equal(FileSystem.DoesFileExist(strFilePath), false, "the controlled fixture never overwrites an existing file");
		const vecFailures = [];
		const vecManagers = [];
		const vecInstances = [];
		const Registry = Scenario.Registry ?? { Mode: "NONE" };
		const OwnerCleanup = Scenario.OwnerCleanup ?? { Mode: "NONE" };
		const ForeignTypedef = unAddress => unAddress;
		let unExistsCalls = 0;
		let unWriteCalls = 0;
		let unRemoveCalls = 0;
		let unRegistryPresenceCalls = 0;
		let unRegistryDeleteCalls = 0;
		let unOwnerReleaseCalls = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const ControlledFileSystem = {
			...FileSystem,

			DoesFileExist(strPath) {
				g_Assert.equal(strPath, strFilePath);
				unExistsCalls++;

				if (((unExistsCalls === 2) && (Scenario.Cleanup.Mode === "EXIST_BEFORE")) || ((unExistsCalls === 3) && (Scenario.Cleanup.Mode === "EXIST_VERIFY"))) {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				return FileSystem.DoesFileExist(strPath);
			},

			WriteTextFile(strPath, strText) {
				g_Assert.equal(strPath, strFilePath);
				unWriteCalls++;
				const bControlled = (Scenario.Write !== undefined) && (unWriteCalls === Scenario.WriteIndex);
				if (bControlled && (Scenario.Write.Mode === "THROW_BEFORE")) {
					ThrowFailure(Scenario.Write.Value);
				}

				if (bControlled && (Scenario.Write.Mode === "FALSE_BEFORE")) {
					return false;
				}

				g_Assert.equal(FileSystem.WriteTextFile(strPath, strText), true);

				if (bControlled && (Scenario.Write.Mode === "THROW_AFTER")) {
					ThrowFailure(Scenario.Write.Value);
				}

				if (bControlled && (Scenario.Write.Mode === "FALSE_AFTER")) {
					return false;
				}

				return (bControlled && (Scenario.Write.Mode === "WRONG_AFTER")) ? {} : true;
			},

			RemoveFile(strPath) {
				g_Assert.equal(strPath, strFilePath);
				unRemoveCalls++;

				if (Scenario.Cleanup.Mode === "THROW") {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				if (["FALSE", "RETAIN"].includes(Scenario.Cleanup.Mode)) {
					return Scenario.Cleanup.Mode === "RETAIN";
				}

				g_Assert.equal(FileSystem.RemoveFile(strPath), true);

				if (Scenario.Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				return (Scenario.Cleanup.Mode === "WRONG") ? {} : true;
			},
		};

		class ControlledCustomType extends MemoryManager.CustomType {
			constructor(...vecArguments) {
				if (Scenario.Constructor) {
					ThrowFailure(Scenario.Constructor.Value);
				}

				super(...vecArguments);
				vecInstances.push(this);
			}

			Deallocate() {
				unOwnerReleaseCalls++;

				if (OwnerCleanup.Mode === "THROW") {
					ThrowFailure(OwnerCleanup.Value);
				}

				if (OwnerCleanup.Mode === "FALSE") {
					return false;
				}

				const bReleased = super.Deallocate();

				if (OwnerCleanup.Mode === "THROW_AFTER") {
					ThrowFailure(OwnerCleanup.Value);
				}

				return (OwnerCleanup.Mode === "WRONG") ? {} : bReleased;
			}
		}

		class ControlledTypeManager extends MemoryManager.TypeManager {
			constructor() {
				super();
				vecManagers.push(this);

				if (Specification.Registry !== "TYPEDEF") {
					return;
				}

				const mapTypedefs = this.FunctionTypedefs;
				Map.prototype.set.call(mapTypedefs, "ForeignTypedef", ForeignTypedef);

				mapTypedefs.has = function Has(strName) {
					g_Assert.equal(strName, "DocumentationCreateInterface");
					unRegistryPresenceCalls++;

					if (((unRegistryPresenceCalls === 1) && (Registry.Mode === "HAS_BEFORE")) || ((unRegistryPresenceCalls === 2) && (Registry.Mode === "HAS_VERIFY"))) {
						ThrowFailure(Registry.Value);
					}

					return Map.prototype.has.call(this, strName);
				};

				mapTypedefs.delete = function Delete(strName) {
					g_Assert.equal(strName, "DocumentationCreateInterface");
					unRegistryDeleteCalls++;

					if (Registry.Mode === "THROW") {
						ThrowFailure(Registry.Value);
					}

					if (["FALSE", "RETAIN"].includes(Registry.Mode)) {
						return Registry.Mode === "RETAIN";
					}

					g_Assert.equal(Map.prototype.delete.call(this, strName), true);

					return (Registry.Mode === "WRONG") ? {} : true;
				};
			}
		}

		const ControlledManager = { ...MemoryManager, TypeManager: ControlledTypeManager };
		const InvokeOperation = function InvokeControlledOperation(...vecArguments) {
			const Owner = Specification.ClassMethod ? MemoryManager.TypeManager.prototype : MemoryManager;
			const vecCallArguments = Specification.OwnedType ? [...vecArguments, ControlledCustomType] : vecArguments;
			const Result = Owner[Specification.Operation].apply(this, vecCallArguments);

			if (Scenario.Primary.Mode === "THROW") {
				ThrowFailure(Scenario.Primary.Value);
			}

			if (Specification.OwnedType && (Scenario.Primary.Mode === "WRONG")) {
				Result.TypeSize = 8;
				return Result;
			}

			return (Scenario.Primary.Mode === "WRONG") ? Specification.WrongValue : Result;
		};

		if (Specification.ClassMethod) {
			ControlledTypeManager.prototype[Specification.Operation] = InvokeOperation;

		} else {
			ControlledManager[Specification.Operation] = InvokeOperation;
		}

		const Require = strName => (strName === "filesystem") ? ControlledFileSystem : ((strName === "memory/manager") ? ControlledManager : RequireDocumentation(strName));
		const Run = new Function("require", "Error", '"use strict";\n' + vecExamples[Specification.Index]);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			if (Scenario.Preexisting) {
				g_Assert.equal(FileSystem.WriteTextFile(strFilePath, "Foreign file contents"), true);
			}

			try {
				const Context = g_VM.createContext({ Run, Require, RecordedError });
				new g_VM.Script("Run(Require, RecordedError);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "GameData");
			g_Assert.equal(bThrown, !!Scenario.Preexisting || !!Scenario.Write || !!Scenario.Constructor || (Scenario.Primary.Mode !== "NONE") || (Scenario.Cleanup.Mode !== "NONE") || (Registry.Mode !== "NONE") || (OwnerCleanup.Mode !== "NONE"));
			g_Assert.equal(unExistsCalls, Scenario.Preexisting ? 1 : 3, "cleanup presence check and verification each run once");
			const bAbsentWrite = (Scenario.WriteIndex === 1) && ["THROW_BEFORE", "FALSE_BEFORE"].includes(Scenario.Write?.Mode);
			g_Assert.equal(unRemoveCalls, (Scenario.Preexisting || bAbsentWrite || (Scenario.Cleanup.Mode === "EXIST_BEFORE")) ? 0 : 1, "removal is never silently retried");
			const bRetained = Scenario.Preexisting || (!bAbsentWrite && ["THROW", "FALSE", "RETAIN", "EXIST_BEFORE"].includes(Scenario.Cleanup.Mode));
			g_Assert.equal(FileSystem.DoesFileExist(strFilePath), !!bRetained);
			g_Assert.equal(GetFileCount(), unFilesBefore + (bRetained ? 1 : 0));

			if (Scenario.Preexisting) {
				g_Assert.equal(unWriteCalls, 0);
				g_Assert.equal(FileSystem.ReadTextFile(strFilePath), "Foreign file contents");
			}

			g_Assert.equal(vecManagers.length, Specification.ClassMethod ? 1 : 0);
			const bConstructed = (Specification.OwnedType === true) && !Scenario.Preexisting && !Scenario.Write && !Scenario.Constructor && (Scenario.Primary.Mode !== "THROW");
			g_Assert.equal(vecInstances.length, bConstructed ? 1 : 0);
			g_Assert.equal(unOwnerReleaseCalls, vecInstances.length, "each file-defined owner gets one release attempt");
			const bOwnerRetained = bConstructed && ["THROW", "FALSE"].includes(OwnerCleanup.Mode);
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + (bOwnerRetained ? 1 : 0));

			if (Specification.Registry === "TYPEDEF") {
				const mapTypedefs = vecManagers[0].FunctionTypedefs;
				const bRegistered = !Scenario.Preexisting && !Scenario.Write;
				const bRegistryRetained = bRegistered && ["THROW", "FALSE", "RETAIN", "HAS_BEFORE"].includes(Registry.Mode);
				g_Assert.equal(Map.prototype.has.call(mapTypedefs, "DocumentationCreateInterface"), bRegistryRetained, "partial typedef registration must be cleaned independently of the file");
				g_Assert.equal(unRegistryPresenceCalls, Scenario.Preexisting ? 0 : 2);
				g_Assert.equal(unRegistryDeleteCalls, (bRegistered && (Registry.Mode !== "HAS_BEFORE")) ? 1 : 0);
				g_Assert.strictEqual(Map.prototype.get.call(mapTypedefs, "ForeignTypedef"), ForeignTypedef);
			}

			unCaseCount++;
		} finally {
			for (const Instance of vecInstances) {
				if (Instance.OwnsAddress) {
					g_Assert.equal(MemoryManager.CustomType.prototype.Deallocate.call(Instance), true);
				}
			}

			for (const Manager of vecManagers) {
				const mapTypedefs = Manager.FunctionTypedefs;
				// Either deletion result leaves only this fixture-owned entry absent.
				Map.prototype.delete.call(mapTypedefs, "DocumentationCreateInterface");
				g_Assert.equal(Map.prototype.has.call(mapTypedefs, "DocumentationCreateInterface"), false);
			}

			if (FileSystem.DoesFileExist(strFilePath)) {
				g_Assert.equal(FileSystem.RemoveFile(strFilePath), true);
			}

			g_Assert.equal(GetFileCount(), unFilesBefore);
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	}

	g_Assert.equal(unCaseCount, 8491);

	return unCaseCount;
}

function VerifyManagerBackingAllocationDocumentation(vecExamples, MemoryManager, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const Memory = RequireDocumentation("memory");
	const MemoryHelpers = RequireDocumentation("memory/helpers");
	const vecValues = [
		new Error("Controlled backing allocation failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([undefined, null], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecSpecifications = [
		{ Index: 27, Method: "Add", Static: false, Kind: "VIEW" },
		{ Index: 29, Method: "CreateFromAddress", Static: true, Kind: "VIEW" },
		{ Index: 32, Method: "Subtract", Static: false, Kind: "VIEW" },
		{ Index: 47, Method: "DynamicInstanceArray", Kind: "ARRAY" },
		{ Index: 48, Method: "DynamicAddressArray", Kind: "ARRAY" },
		{ Index: 49, Kind: "FUNCTION" },
		{ Index: 54, Kind: "INSTANCE" },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		const vecOwnerFailures = (Specification.Kind === "ARRAY") ? vecCleanupFailures : [{ Mode: "NONE" }];
		for (const Primary of vecPrimaryFailures) {
			for (const Cleanup of vecCleanupFailures) {
				for (const OwnerCleanup of vecOwnerFailures) {
					vecCases.push({ Specification, Primary, Cleanup, OwnerCleanup });
				}
			}
		}

		if (Specification.Kind === "ARRAY") {
			for (const Value of vecValues) {
				for (const Cleanup of vecCleanupFailures) {
					vecCases.push({ Specification, Constructor: { Value }, Primary: { Mode: "NONE" }, Cleanup, OwnerCleanup: { Mode: "NONE" } });
				}
			}
		}
	}

	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const { Specification, Primary, Cleanup, OwnerCleanup } = Scenario;
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		const vecOwners = [];
		const vecReleaseOrder = [];
		let unBackingAddress = 0n;
		let unAllocateCalls = 0;
		let unDeallocateCalls = 0;
		let unOwnerReleaseCalls = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		const Release = (Mode, Deallocate) => {
			if (Mode.Mode === "THROW") {
				ThrowFailure(Mode.Value);
			}

			if (Mode.Mode === "FALSE") {
				return false;
			}

			const bReleased = Deallocate();

			if (Mode.Mode === "THROW_AFTER") {
				ThrowFailure(Mode.Value);
			}

			return (Mode.Mode === "WRONG") ? {} : bReleased;
		};

		class ControlledCustomType extends MemoryManager.CustomType {
			constructor(...vecArguments) {
				if (Scenario.Constructor) {
					ThrowFailure(Scenario.Constructor.Value);
				}

				super(...vecArguments);

				if (this.OwnsAddress) {
					vecOwners.push(this);
				}
			}

			static CreateFromAddress(...vecArguments) {
				const View = super.CreateFromAddress(...vecArguments);

				if (Specification.Kind === "INSTANCE") {
					if (Primary.Mode === "THROW") {
						ThrowFailure(Primary.Value);
					}

					if (Primary.Mode === "WRONG") {
						return {};
					}
				}

				return View;
			}

			Deallocate() {
				if (!this.OwnsAddress) {
					return super.Deallocate();
				}

				unOwnerReleaseCalls++;
				vecReleaseOrder.push("OWNER");

				return Release(OwnerCleanup, () => super.Deallocate());
			}
		}

		class ControlledTypeManager extends MemoryManager.TypeManager {
			DynamicInstanceArray(...vecArguments) {
				return CreateControlledManagerArrayDescriptor(super.DynamicInstanceArray(...vecArguments), 3, Primary, ThrowFailure);
			}

			DynamicAddressArray(...vecArguments) {
				return CreateControlledManagerArrayDescriptor(super.DynamicAddressArray(...vecArguments), 3, Primary, ThrowFailure);
			}
		}

		const Manager = new ControlledTypeManager();
		if (Specification.Kind === "VIEW") {
			const CreateType = Manager.CreateType;
			Manager.CreateType = function CreateControlledType(...vecArguments) {
				const TypeConstructor = CreateType.apply(this, vecArguments);
				const ResolveView = Specification.Static ? TypeConstructor.CreateFromAddress : MemoryManager.CustomType.prototype[Specification.Method];
				const CreateControlledView = function CreateControlledView(...vecViewArguments) {
					const View = ResolveView.apply(this, vecViewArguments);

					if (Primary.Mode === "THROW") {
						ThrowFailure(Primary.Value);
					}

					return (Primary.Mode === "WRONG") ? {} : View;
				};

				if (Specification.Static) {
					TypeConstructor[Specification.Method] = CreateControlledView;

				} else {
					TypeConstructor.prototype[Specification.Method] = CreateControlledView;
				}

				return TypeConstructor;
			};
		}

		const ControlledMemory = {
			...Memory,

			Allocate(unByteCount) {
				unAllocateCalls++;
				unBackingAddress = Memory.Allocate(unByteCount);

				return unBackingAddress;
			},

			Deallocate(unAddress) {
				g_Assert.equal(unAddress, unBackingAddress);
				unDeallocateCalls++;
				vecReleaseOrder.push("BACKING");

				return Release(Cleanup, () => Memory.Deallocate(unAddress));
			},
		};

		const ControlledHelpers = {
			...MemoryHelpers,

			Write(...vecArguments) {
				const bWritten = MemoryHelpers.Write(...vecArguments);

				if (Specification.Kind === "FUNCTION") {
					if (Primary.Mode === "THROW") {
						ThrowFailure(Primary.Value);
					}

					if (Primary.Mode === "WRONG") {
						return false;
					}
				}

				return bWritten;
			},
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => {
			if (strName === "memory") {
				return ControlledMemory;
			}

			if (strName === "memory/helpers") {
				return ControlledHelpers;
			}

			if (strName === "memory/manager") {
				return { ...MemoryManager, Manager, CustomType: ControlledCustomType, TypeManager: ControlledTypeManager };
			}

			return RequireDocumentation(strName);
		};

		const Run = new Function("require", "Error", '"use strict";\n' + vecExamples[Specification.Index]);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				const Context = g_VM.createContext({ Run, Require, RecordedError });
				new g_VM.Script("Run(Require, RecordedError);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Backing allocation");
			g_Assert.equal(bThrown, !!Scenario.Constructor || (Primary.Mode !== "NONE") || (Cleanup.Mode !== "NONE") || (OwnerCleanup.Mode !== "NONE"), "backing allocation must report failed operations and releases");
			g_Assert.equal(unAllocateCalls, 1);
			g_Assert.equal(unDeallocateCalls, 1, "backing release must not be silently retried");
			g_Assert.equal(vecOwners.length, ((Specification.Kind === "ARRAY") && !Scenario.Constructor) ? 1 : 0);
			g_Assert.equal(unOwnerReleaseCalls, vecOwners.length);
			g_Assert.deepEqual(vecReleaseOrder, (vecOwners.length === 1) ? ["OWNER", "BACKING"] : ["BACKING"], "both releases must be attempted in ownership order");
			const bBackingRetained = ["THROW", "FALSE"].includes(Cleanup.Mode);
			const unOwnerAllocations = vecOwners.reduce((unCount, Owner) => unCount + (Owner.OwnsAddress ? 1 : 0) + Owner.AllocatedAddresses.size, 0);
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + (bBackingRetained ? 1 : 0) + unOwnerAllocations);
			unCaseCount++;
		} finally {
			for (const Owner of vecOwners) {
				if (Owner.OwnsAddress) {
					g_Assert.equal(MemoryManager.CustomType.prototype.Deallocate.call(Owner), true);
				}
			}

			if (["THROW", "FALSE"].includes(Cleanup.Mode)) {
				g_Assert.equal(Memory.Deallocate(unBackingAddress), true);
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	}

	g_Assert.equal(unCaseCount, 4380);

	return unCaseCount;
}

function VerifyManagerAddressAttributeDocumentation(strExample, MemoryManager, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const Memory = RequireDocumentation("memory");
	const vecValues = [
		new Error("Controlled address attribute failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([0, null], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecCases = [];
	for (const Primary of vecPrimaryFailures) {
		for (const ParentCleanup of vecCleanupFailures) {
			for (const NestedCleanup of vecCleanupFailures) {
				vecCases.push({ Primary, ParentCleanup, NestedCleanup });
			}
		}
	}

	for (const Value of vecValues) {
		for (const ParentCleanup of vecCleanupFailures) {
			vecCases.push({ Primary: { Mode: "NONE" }, ParentCleanup, NestedCleanup: { Mode: "NONE" }, Constructor: { Value } });
		}
	}

	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		const vecOwners = [];
		const vecReleaseOrder = [];
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		class ControlledCustomType extends MemoryManager.CustomType {
			constructor(...vecArguments) {
				if (Scenario.Constructor && (new.target.name === "NestedIntValue")) {
					ThrowFailure(Scenario.Constructor.Value);
				}

				super(...vecArguments);

				if (this.OwnsAddress) {
					vecOwners.push(this);
				}
			}

			Deallocate() {
				if (!this.OwnsAddress) {
					return super.Deallocate();
				}

				const bParent = this.constructor.name === "OwnedIntAddress";
				const Cleanup = bParent ? Scenario.ParentCleanup : Scenario.NestedCleanup;
				vecReleaseOrder.push(bParent ? "PARENT" : "NESTED");

				if (Cleanup.Mode === "THROW") {
					ThrowFailure(Cleanup.Value);
				}

				if (Cleanup.Mode === "FALSE") {
					return false;
				}

				const bReleased = super.Deallocate();

				if (Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Cleanup.Value);
				}

				return (Cleanup.Mode === "WRONG") ? undefined : bReleased;
			}
		}

		class ControlledTypeManager extends MemoryManager.TypeManager {
			AddressAttribute(strTypeName, ...vecArguments) {
				const Descriptor = super.AddressAttribute(strTypeName, ...vecArguments);
				if (strTypeName !== Memory.DataType.Int) {
					return Descriptor;
				}

				return {
					...Descriptor,

					get() {
						const Value = Descriptor.get.call(this);

						if (Scenario.Primary.Mode === "THROW") {
							ThrowFailure(Scenario.Primary.Value);
						}

						return (Scenario.Primary.Mode === "WRONG") ? 0 : Value;
					},
				};
			}
		}

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => (strName === "memory/manager") ? { ...MemoryManager, CustomType: ControlledCustomType, TypeManager: ControlledTypeManager } : RequireDocumentation(strName);
		const Run = new Function("require", "Error", '"use strict";\n' + strExample);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				const Context = g_VM.createContext({ Run, Require, RecordedError });
				new g_VM.Script("Run(Require, RecordedError);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Address attribute");
			g_Assert.equal(bThrown, !!Scenario.Constructor || (Scenario.Primary.Mode !== "NONE") || (Scenario.ParentCleanup.Mode !== "NONE") || (Scenario.NestedCleanup.Mode !== "NONE"));
			g_Assert.equal(vecOwners.length, Scenario.Constructor ? 1 : 2);
			g_Assert.deepEqual(vecReleaseOrder, Scenario.Constructor ? ["PARENT"] : ["PARENT", "NESTED"], "each independent owner must be released once in ownership order");
			const unRetainedAllocations = vecOwners.reduce((unCount, Owner) => unCount + (Owner.OwnsAddress ? 1 : 0) + Owner.AllocatedAddresses.size, 0);
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + unRetainedAllocations);
			unCaseCount++;
		} finally {
			for (const Owner of vecOwners) {
				if (Owner.OwnsAddress) {
					g_Assert.equal(MemoryManager.CustomType.prototype.Deallocate.call(Owner), true);
				}
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	}

	g_Assert.equal(unCaseCount, 1890);

	return unCaseCount;
}

function VerifyMemoryAllocationDocumentation(vecExamples, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const Memory = RequireDocumentation("memory");
	const vecValues = [
		new Error("Controlled root memory failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([undefined, 0], "Controlled aggregate value"),
	];
	const vecInvalidAddresses = [undefined, null, 0n, 1, "1", -1n];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecAcquisitionFailures = [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		...vecInvalidAddresses.map(Value => ({ Mode: "INVALID", Value })),
	];
	const vecSpecifications = [
		{ Index: 1, Kind: "RAW" },
		{ Index: 3, Kind: "RESIZE" },
		{ Index: 4, Kind: "COPY" },
		{ Index: 6, Kind: "COUNTER" },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		for (const Primary of vecPrimaryFailures) {
			for (const SourceCleanup of vecCleanupFailures) {
				for (const TargetCleanup of (Specification.Kind === "COPY") ? vecCleanupFailures : [{ Mode: "NONE" }]) {
					vecCases.push({ Specification, Primary, SourceCleanup, TargetCleanup });
				}
			}
		}

		for (const Fault of vecAcquisitionFailures) {
			vecCases.push({ Specification, Primary: { Mode: "NONE" }, SourceCleanup: { Mode: "NONE" }, TargetCleanup: { Mode: "NONE" }, FirstAllocation: Fault });

			if (["RESIZE", "COPY"].includes(Specification.Kind)) {
				for (const SourceCleanup of vecCleanupFailures) {
					vecCases.push({ Specification, Primary: { Mode: "NONE" }, SourceCleanup, TargetCleanup: { Mode: "NONE" }, Resize: (Specification.Kind === "RESIZE") ? Fault : null, SecondAllocation: (Specification.Kind === "COPY") ? Fault : null });
				}
			}
		}
	}

	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const unAllocationsBefore = GetAllocationCount();
		const vecOwners = [];
		const vecReleaseOrder = [];
		const vecFailures = [];
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		const FailAcquisition = Fault => {
			if (Fault.Mode === "THROW") {
				ThrowFailure(Fault.Value);
			}

			return Fault.Value;
		};

		const Allocate = Acquire => {
			const Fault = (vecOwners.length === 0) ? Scenario.FirstAllocation : Scenario.SecondAllocation;
			if (Fault) {
				return FailAcquisition(Fault);
			}

			const unAddress = Acquire();
			g_Assert.equal(typeof unAddress, "bigint");
			g_Assert(unAddress > 0n);
			vecOwners.push({ Address: unAddress, Released: false });

			return unAddress;
		};

		const CheckValue = Value => {
			if (Scenario.Primary.Mode === "THROW") {
				ThrowFailure(Scenario.Primary.Value);
			}

			return (Scenario.Primary.Mode === "WRONG") ? undefined : Value;
		};

		class ControlledAddress extends Memory.Address {
			GetInt(...vecArguments) {
				return CheckValue(super.GetInt(...vecArguments));
			}
		}

		const Runtime = {
			...Memory,
			Address: ControlledAddress,

			Allocate(unByteCount) {
				return Allocate(() => Memory.Allocate(unByteCount));
			},

			AllocateObject(ObjectTypeValue) {
				return Allocate(() => Memory.AllocateObject(ObjectTypeValue));
			},

			Reallocate(unAddress, unByteCount) {
				g_Assert.equal(unAddress, vecOwners[0].Address);

				if (Scenario.Resize) {
					return FailAcquisition(Scenario.Resize);
				}

				const unResizedAddress = Memory.Reallocate(unAddress, unByteCount);
				vecOwners[0].Address = unResizedAddress;

				return unResizedAddress;
			},

			CopyAddressToObject(...vecArguments) {
				return CheckValue(Memory.CopyAddressToObject(...vecArguments));
			},

			Deallocate(unAddress) {
				const nOwnerIndex = vecOwners.findIndex(Owner => (Owner.Address === unAddress) && !Owner.Released);
				g_Assert(nOwnerIndex >= 0, "cleanup must use a live owned address, including after resize");
				const Owner = vecOwners[nOwnerIndex];
				const Cleanup = (nOwnerIndex === 0) ? Scenario.SourceCleanup : Scenario.TargetCleanup;
				vecReleaseOrder.push(nOwnerIndex);

				if (Cleanup.Mode === "THROW") {
					ThrowFailure(Cleanup.Value);
				}

				if (Cleanup.Mode === "FALSE") {
					return false;
				}

				const bReleased = Memory.Deallocate(unAddress);
				g_Assert.equal(bReleased, true);
				Owner.Released = true;

				if (Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Cleanup.Value);
				}

				return (Cleanup.Mode === "WRONG") ? {} : bReleased;
			},
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => (strName === "memory") ? Runtime : RequireDocumentation(strName);
		const Run = new Function("require", "Error", '"use strict";\n' + vecExamples[Scenario.Specification.Index]);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				const Context = g_VM.createContext({ Run, Require, RecordedError });
				new g_VM.Script("Run(Require, RecordedError);").runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Root allocation");
			g_Assert.equal(bThrown, !!Scenario.FirstAllocation || !!Scenario.SecondAllocation || !!Scenario.Resize || (Scenario.Primary.Mode !== "NONE") || (Scenario.SourceCleanup.Mode !== "NONE") || (Scenario.TargetCleanup.Mode !== "NONE"));
			const unExpectedOwners = Scenario.FirstAllocation ? 0 : (((Scenario.Specification.Kind === "COPY") && !Scenario.SecondAllocation) ? 2 : 1);
			g_Assert.equal(vecOwners.length, unExpectedOwners);
			g_Assert.deepEqual(vecReleaseOrder, (unExpectedOwners === 2) ? [1, 0] : ((unExpectedOwners === 1) ? [0] : []), "each acquired allocation must have exactly one independent release attempt");
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + vecOwners.filter(Owner => !Owner.Released).length);
			unCaseCount++;
		} finally {
			for (const Owner of vecOwners) {
				if (!Owner.Released) {
					g_Assert.equal(Memory.Deallocate(Owner.Address), true);
				}
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	}

	g_Assert.equal(unCaseCount, 2568);

	return unCaseCount;
}

function VerifyMemoryChainDocumentation(strExample, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const Memory = RequireDocumentation("memory");
	const Run = new Function("require", "Error", '"use strict";\n' + strExample);
	const Context = g_VM.createContext({ Run });
	const Script = new g_VM.Script("Run(Require, RecordedError);");
	const vecValues = [
		new Error("Controlled address chain failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([0, undefined], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecAcquisitionFailures = [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		...[undefined, null, 0n, 1, "1", -1n].map(Value => ({ Mode: "INVALID", Value })),
	];
	const vecCleanupConfigurations = [[{ Mode: "NONE" }, { Mode: "NONE" }, { Mode: "NONE" }]];
	const unAddressChainAllocationCount = vecCleanupConfigurations[0].length;
	for (let unFirstSlot = 0; unFirstSlot < unAddressChainAllocationCount; unFirstSlot++) {
		for (const First of vecCleanupFailures.slice(1)) {
			const vecSingleFailure = [{ Mode: "NONE" }, { Mode: "NONE" }, { Mode: "NONE" }];
			vecSingleFailure[unFirstSlot] = First;
			vecCleanupConfigurations.push(vecSingleFailure);

			for (let unSecondSlot = unFirstSlot + 1; unSecondSlot < unAddressChainAllocationCount; unSecondSlot++) {
				for (const Second of vecCleanupFailures.slice(1)) {
					const vecPairFailures = [...vecSingleFailure];
					vecPairFailures[unSecondSlot] = Second;
					vecCleanupConfigurations.push(vecPairFailures);
				}
			}
		}
	}

	for (const Cleanup of vecCleanupFailures.slice(1)) {
		vecCleanupConfigurations.push([Cleanup, Cleanup, Cleanup]);
	}

	const vecCases = [];
	for (const Primary of vecPrimaryFailures) {
		for (const vecCleanup of vecCleanupConfigurations) {
			vecCases.push({ Primary, Cleanup: vecCleanup });
		}
	}

	for (let unFailedSlot = 0; unFailedSlot < unAddressChainAllocationCount; unFailedSlot++) {
		for (const Failure of vecAcquisitionFailures) {
			for (const First of (unFailedSlot > 0) ? vecCleanupFailures : [{ Mode: "NONE" }]) {
				for (const Second of (unFailedSlot > 1) ? vecCleanupFailures : [{ Mode: "NONE" }]) {
					vecCases.push({ Primary: { Mode: "NONE" }, Cleanup: [First, Second, { Mode: "NONE" }], Fault: { Slot: unFailedSlot, Failure } });
				}
			}
		}
	}

	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const unAllocationsBefore = GetAllocationCount();
		const vecOwners = [];
		const vecReleaseOrder = [];
		const vecFailures = [];
		let unAllocateCalls = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		class ControlledBinaryFile extends Memory.BinaryFile {
			DereferenceBinaryAddress(...vecArguments) {
				const unAddress = super.DereferenceBinaryAddress(...vecArguments);

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				return (Scenario.Primary.Mode === "WRONG") ? 0n : unAddress;
			}
		}

		const Runtime = {
			...Memory,
			BinaryFile: ControlledBinaryFile,

			Allocate(unByteCount) {
				const unSlot = unAllocateCalls++;
				if (Scenario.Fault && (Scenario.Fault.Slot === unSlot)) {
					if (Scenario.Fault.Failure.Mode === "THROW") {
						ThrowFailure(Scenario.Fault.Failure.Value);
					}

					return Scenario.Fault.Failure.Value;
				}

				const unAddress = Memory.Allocate(unByteCount);
				g_Assert.equal(typeof unAddress, "bigint");
				g_Assert(unAddress > 0n);
				vecOwners.push({ Address: unAddress, Slot: unSlot, Released: false });

				return unAddress;
			},

			Deallocate(unAddress) {
				const Owner = vecOwners.find(Entry => Entry.Address === unAddress);
				g_Assert(Owner && !Owner.Released, "address-chain cleanup must own a live allocation");
				g_Assert(!vecReleaseOrder.includes(Owner.Slot), "address-chain cleanup must not silently retry a failed release");
				vecReleaseOrder.push(Owner.Slot);
				const Cleanup = Scenario.Cleanup[Owner.Slot];

				if (Cleanup.Mode === "THROW") {
					ThrowFailure(Cleanup.Value);
				}

				if (Cleanup.Mode === "FALSE") {
					return false;
				}

				const bReleased = Memory.Deallocate(unAddress);
				g_Assert.equal(bReleased, true);
				Owner.Released = true;

				if (Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Cleanup.Value);
				}

				return (Cleanup.Mode === "WRONG") ? {} : bReleased;
			},
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => (strName === "memory") ? Runtime : RequireDocumentation(strName);
		Context.Require = Require;
		Context.RecordedError = RecordedError;
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Address chain");
			g_Assert.equal(bThrown, !!Scenario.Fault || (Scenario.Primary.Mode !== "NONE") || Scenario.Cleanup.some(Cleanup => Cleanup.Mode !== "NONE"));
			const unExpectedOwners = Scenario.Fault ? Scenario.Fault.Slot : unAddressChainAllocationCount;
			g_Assert.equal(unAllocateCalls, Scenario.Fault ? (unExpectedOwners + 1) : unAddressChainAllocationCount, "invalid allocation results must stop further acquisition immediately");
			g_Assert.equal(vecOwners.length, unExpectedOwners);
			g_Assert.deepEqual(vecReleaseOrder, [0, 1, 2].slice(0, unExpectedOwners).reverse(), "all acquired chain allocations must have one independent release attempt in reverse order");
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + vecOwners.filter(Owner => !Owner.Released).length);
			unCaseCount++;
		} finally {
			for (const Owner of vecOwners) {
				if (!Owner.Released) {
					g_Assert.equal(Memory.Deallocate(Owner.Address), true);
				}
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	}

	g_Assert.equal(unCaseCount, 8052);

	return unCaseCount;
}

function VerifyMemoryFunctionRegistrationFailures(Fixture) {
	const Memory = Fixture.Memory;
	const NativeHooks = Fixture.RootHooks;
	const CreateFunctionHook = NativeHooks.CreateFunctionHook;
	const vecValues = [
		new Error("Controlled callback registration failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([0, null], "Controlled aggregate value"),
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecCases = [];
	for (const strOperation of ["Pre", "Post"]) {
		for (const bAfterRegistration of [false, true]) {
			for (const Value of vecValues) {
				for (const Cleanup of vecCleanupFailures) {
					vecCases.push({ Operation: strOperation, AfterRegistration: bAfterRegistration, Value, Cleanup, Kind: "NEW" });
				}

				for (const strKind of ["EXISTING", "FOREIGN"]) {
					vecCases.push({ Operation: strOperation, AfterRegistration: bAfterRegistration, Value, Cleanup: { Mode: "NONE" }, Kind: strKind });
				}
			}
		}
	}

	const unManagerCallCount = Fixture.ManagerCalls.length;
	const unFunctionAddress = Memory.Manager.GetBinarySymbol("server", "CreateInterface");
	g_Assert.equal(Fixture.ManagerCalls.length, unManagerCallCount + 1);
	const vecLookup = Fixture.ManagerCalls.pop();
	g_Assert.deepEqual(vecLookup, ["SYMBOL", "server", "CreateInterface"], "remove only this helper's lookup record from the shared fixture trace");
	let unCaseCount = 0;
	for (const Scenario of vecCases) {
		const unActiveBefore = Fixture.ActiveHookCount();
		const Callable = new Memory.Function(unFunctionAddress, Memory.Convention.Cdecl, [Memory.DataType.String, Memory.DataType.Address], Memory.DataType.Address);
		const ForeignHook = { Kind: "FOREIGN" };
		let Hook = null;
		let Remove = null;
		let bNativeRemoved = false;
		let unRemovalCalls = 0;
		let unExistingCallbackCalls = 0;
		let unNewCallbackCalls = 0;
		const Callback = () => {
			unNewCallbackCalls++;
		};

		const PrepareHook = Handle => {
			Hook = Handle;
			Remove = Handle.Remove;
			const Register = Handle[Scenario.Operation];
			Handle[Scenario.Operation] = function RegisterWithFailure(CallbackValue) {
				if (Scenario.AfterRegistration) {
					Register.call(this, CallbackValue);
				}

				if (Scenario.Kind === "FOREIGN") {
					Callable.Hook = ForeignHook;
				}

				throw Scenario.Value;
			};

			Handle.Remove = function RemoveWithFailure() {
				unRemovalCalls++;

				if (Scenario.Cleanup.Mode === "THROW") {
					throw Scenario.Cleanup.Value;
				}

				if (Scenario.Cleanup.Mode === "FALSE") {
					return false;
				}

				const bRemoved = Remove.call(this);
				g_Assert.equal(bRemoved, true);
				bNativeRemoved = true;

				if (Scenario.Cleanup.Mode === "THROW_AFTER") {
					throw Scenario.Cleanup.Value;
				}

				return (Scenario.Cleanup.Mode === "WRONG") ? undefined : bRemoved;
			};

			return Handle;
		};

		const strMethod = (Scenario.Operation === "Pre") ? "AddPreHook" : "AddPostHook";
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			if (Scenario.Kind === "EXISTING") {
				const ExistingCallback = () => {
					unExistingCallbackCalls++;
				};
				g_Assert.equal(Callable[strMethod](ExistingCallback), true);
				PrepareHook(Callable.Hook);

			} else {
				NativeHooks.CreateFunctionHook = function CreateControlledFunction(...vecArguments) {
					g_Assert.strictEqual(this, NativeHooks);

					return PrepareHook(CreateFunctionHook.apply(this, vecArguments));
				};
			}

			try {
				Callable[strMethod](Callback);
			} catch (ErrorValue) {
				bThrown = true;
				CaughtValue = ErrorValue;
			}

			g_Assert.equal(bThrown, true, "registration exceptions must propagate");

			if ((Scenario.Kind === "NEW") && (Scenario.Cleanup.Mode !== "NONE")) {
				g_Assert(CaughtValue instanceof AggregateError, "registration and rollback failures must both be reported");
				g_Assert.equal(CaughtValue.errors.length, 2);
				g_Assert.strictEqual(CaughtValue.errors[0], Scenario.Value);

				if (["THROW", "THROW_AFTER"].includes(Scenario.Cleanup.Mode)) {
					g_Assert.strictEqual(CaughtValue.errors[1], Scenario.Cleanup.Value);

				} else {
					g_Assert(CaughtValue.errors[1] instanceof Error);
					g_Assert.match(CaughtValue.errors[1].message, /could not remove the native hook/);
				}

			} else {
				g_Assert.strictEqual(CaughtValue, Scenario.Value);
			}

			const bExisting = Scenario.Kind === "EXISTING";
			g_Assert.equal(unRemovalCalls, bExisting ? 0 : 1, "rollback removes only newly acquired hooks, once");
			g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore + (bNativeRemoved ? 0 : 1));
			const ExpectedHook = (Scenario.Kind === "FOREIGN") ? ForeignHook : (((Scenario.Kind === "NEW") && (Scenario.Cleanup.Mode === "NONE")) ? null : Hook);
			g_Assert.strictEqual(Callable.Hook, ExpectedHook, "failed rollback must retain ownership and must not overwrite a replacement hook");

			if (bExisting) {
				if (Scenario.Operation === "Pre") {
					Hook.InvokePre([]);

				} else {
					Hook.InvokePost([], 0n);
				}

				g_Assert.equal(unExistingCallbackCalls, 1, "failed additions must not remove existing callbacks");
				g_Assert.equal(unNewCallbackCalls, Scenario.AfterRegistration ? 1 : 0);
			}

			unCaseCount++;
		} finally {
			NativeHooks.CreateFunctionHook = CreateFunctionHook;

			if ((Hook !== null) && !bNativeRemoved) {
				g_Assert.equal(Remove.call(Hook), true);
			}

			Callable.Hook = null;
			g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore);
		}
	}

	for (const Failure of [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "NULL" },
	]) {
		const unActiveBefore = Fixture.ActiveHookCount();
		const Callable = new Memory.Function(unFunctionAddress);
		NativeHooks.CreateFunctionHook = function FailCreation() {
			if (Failure.Mode === "THROW") {
				throw Failure.Value;
			}

			return null;
		};

		try {
			let bThrown = false;
			let CaughtValue = undefined;

			try {
				Callable.AddPreHook(() => undefined);
			} catch (ErrorValue) {
				bThrown = true;
				CaughtValue = ErrorValue;
			}

			g_Assert.equal(bThrown, true);

			if (Failure.Mode === "THROW") {
				g_Assert.strictEqual(CaughtValue, Failure.Value);

			} else {
				g_Assert.match(CaughtValue.message, /could not create the native hook/);
			}

			g_Assert.strictEqual(Callable.Hook, null);
			g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore);
			unCaseCount++;
		} finally {
			NativeHooks.CreateFunctionHook = CreateFunctionHook;
		}
	}

	g_Assert.equal(unCaseCount, 415);

	return unCaseCount;
}

function VerifyMemoryFunctionNativeReuse(Fixture) {
	const Memory = Fixture.Memory;
	const NativeHooks = Fixture.RootHooks;
	const CreateFunctionHook = NativeHooks.CreateFunctionHook;
	const unFunctionAddress = 0x7F00n;
	const vecFailures = [new Error("Controlled reused hook registration failure"), undefined, null, false, 0, ""];
	const vecCases = [{ Mode: "SUCCESS" }, { Mode: "FALSE" }, ...vecFailures.map(Value => ({ Mode: "THROW", Value }))];
	g_Assert.equal(Object.hasOwn(NativeHooks, "CreateFunction"), false, "the fixture must expose the actual native factory, without a legacy alias");
	let unCaseCount = 0;
	for (const strOperation of ["Pre", "Post"]) {
		for (const bReuseNativeHook of [false, true]) {
			for (const bAfterRegistration of [false, true]) {
				for (const Scenario of vecCases) {
					const unActiveBefore = Fixture.ActiveHookCount();
					const Callable = new Memory.Function(unFunctionAddress);
					let ForeignHook = null;
					let Hook = null;
					let Register = null;
					let Remove = null;
					let unCreationCalls = 0;
					let unRemovalCalls = 0;
					let unForeignCallbackCalls = 0;
					let unCallbackCalls = 0;
					const Callback = () => {
						unCallbackCalls++;
					};

					try {
						if (bReuseNativeHook) {
							ForeignHook = CreateFunctionHook.call(NativeHooks, { Address: unFunctionAddress, Arguments: [], Convention: Memory.Convention.Cdecl, ReturnType: Memory.DataType.Void });
							g_Assert.equal(ForeignHook.Created, true);
							g_Assert.equal(ForeignHook[strOperation](() => {
								unForeignCallbackCalls++;
							}), true);
							ForeignHook[strOperation] = () => {
								throw new Error("A reused native handle must not inherit another handle's JavaScript method replacement.");
							};
						}

						NativeHooks.CreateFunctionHook = function CreateControlledNativeHook(...vecArguments) {
							g_Assert.strictEqual(this, NativeHooks);
							unCreationCalls++;
							Hook = CreateFunctionHook.apply(this, vecArguments);
							g_Assert.equal(Object.hasOwn(Hook, "Created"), true);
							g_Assert.equal(Hook.Created, !bReuseNativeHook);
							g_Assert.notStrictEqual(Hook, ForeignHook);
							Register = Hook[strOperation];
							Remove = Hook.Remove;
							Hook[strOperation] = function RegisterWithControlledResult(CallbackValue) {
								if ((Scenario.Mode === "SUCCESS") || bAfterRegistration) {
									g_Assert.equal(Register.call(this, CallbackValue), true);
								}

								// Rollback must use the captured native creation result, not callback-mutated metadata.
								this.Created = bReuseNativeHook;
								if (Scenario.Mode === "THROW") {
									throw Scenario.Value;
								}

								return Scenario.Mode === "SUCCESS";
							};
							Hook.Remove = function RemoveControlledNativeHook() {
								unRemovalCalls++;
								if (bReuseNativeHook) {
									throw new Error("Registration rollback must not remove a shared native hook.");
								}

								return Remove.call(this);
							};

							return Hook;
						};

						let bThrown = false;
						let CaughtValue = undefined;
						let Result = undefined;
						try {
							Result = Callable.AddHook(NativeHooks.HookType[strOperation], Callback);
						} catch (ErrorValue) {
							bThrown = true;
							CaughtValue = ErrorValue;
						}

						g_Assert.equal(bThrown, Scenario.Mode === "THROW");
						if (bThrown) {
							g_Assert.strictEqual(CaughtValue, Scenario.Value);
						} else {
							g_Assert.equal(Result, Scenario.Mode === "SUCCESS");
						}

						const bRolledBack = !bReuseNativeHook && (Scenario.Mode !== "SUCCESS");
						g_Assert.equal(unCreationCalls, 1);
						g_Assert.equal(unRemovalCalls, bRolledBack ? 1 : 0);
						g_Assert.strictEqual(Callable.Hook, bRolledBack ? null : Hook);
						g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore + (bRolledBack ? 0 : 1));
						if (strOperation === "Pre") {
							Hook.InvokePre([]);
						} else {
							Hook.InvokePost([], undefined);
						}

						g_Assert.equal(unForeignCallbackCalls, bReuseNativeHook ? 1 : 0);
						const bCallbackInstalled = !bRolledBack && ((Scenario.Mode === "SUCCESS") || bAfterRegistration);
						g_Assert.equal(unCallbackCalls, bCallbackInstalled ? 1 : 0);
						if (bReuseNativeHook && (Scenario.Mode !== "SUCCESS")) {
							Hook[strOperation] = Register;
							g_Assert.equal(Callable.AddHook(NativeHooks.HookType[strOperation], Callback), true);
							g_Assert.equal(unCreationCalls, 1, "retry must reuse the cached handle without creating another native record");
							g_Assert.equal(Callable.RemoveHook(NativeHooks.HookType[strOperation], Callback), true);
							g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore + 1);
							g_Assert.equal(unRemovalCalls, 0);
						}

						unCaseCount++;
					} finally {
						NativeHooks.CreateFunctionHook = CreateFunctionHook;
						if (Fixture.ActiveHookCount() > unActiveBefore) {
							const CleanupHook = (ForeignHook === null) ? Hook : ForeignHook;
							const Cleanup = (ForeignHook === null) ? Remove : ForeignHook.Remove;
							g_Assert.equal(Cleanup.call(CleanupHook), true);
						}

						g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore);
					}
				}
			}
		}
	}

	g_Assert.equal(unCaseCount, 64);
	console.log("[  OK  ] memory Function.AddHook: 64 native creation/reuse and retry cases passed; controlled native records only.");
}

function VerifyMemoryFunctionHookDocumentation(vecExamples, Fixture, RequireDocumentation) {
	const unExampleTimeoutMilliseconds = 1000;
	const unCasesPerBatch = 64;
	const Memory = Fixture.Memory;
	const NativeHooks = Fixture.RootHooks;
	const CreateFunctionHook = NativeHooks.CreateFunctionHook;
	const vecValues = [
		new Error("Controlled function hook failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([null, 0], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecRegistrationFailures = [
		...vecValues.flatMap(Value => [{ Mode: "BEFORE", Value }, { Mode: "AFTER", Value }, { Mode: "CREATE_THROW", Value }]),
		{ Mode: "FALSE_BEFORE" },
		{ Mode: "FALSE_AFTER" },
		{ Mode: "WRONG_AFTER" },
		{ Mode: "CREATE_NULL" },
	];
	const vecPartialCleanups = [
		...vecCleanupFailures.map(Native => ({ Native, Callback: { Mode: "NONE" } })),
		...vecCleanupFailures.slice(1).map(Callback => ({ Callback, Native: { Mode: "NONE" } })),
	];
	const vecSpecifications = [
		{ Index: 3, Kind: "CALL" },
		{ Index: 4, Kind: "CALL" },
		{ Index: 5, Kind: "CALL" },
		{ Index: 8, Kind: "STATE" },
		{ Index: 9, Kind: "CALL" },
		{ Index: 10, Kind: "CALL" },
		{ Index: 11, Kind: "CALL" },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		for (const Primary of vecPrimaryFailures) {
			for (const Callback of vecCleanupFailures) {
				for (const Native of vecCleanupFailures) {
					vecCases.push({ Specification, Primary, Callback, Native, Registration: { Mode: "NONE" } });
				}
			}
		}

		for (const Registration of vecRegistrationFailures) {
			for (const Cleanup of vecPartialCleanups) {
				vecCases.push({ Specification, Primary: { Mode: "NONE" }, Registration, ...Cleanup });
			}
		}
	}

	// Each invocation has fresh function-local bindings; reuse only the outer execution context and compiled example.
	const mapRunners = new Map(vecSpecifications.map(Specification => [Specification.Index, new Function("require", "Error", '"use strict";\n' + vecExamples[Specification.Index])]));
	const Context = g_VM.createContext({});
	const Script = new g_VM.Script("for (const Scenario of Scenarios) {\n\tRunScenario(Scenario);\n}");
	let unCaseCount = 0;
	const RunScenario = Scenario => {
		const unActiveBefore = Fixture.ActiveHookCount();
		const vecFailures = [];
		const setOpaqueFailures = new Set(vecValues);
		const vecCallables = [];
		const vecNativeRemovalPhases = [];
		let Hook = null;
		let Remove = null;
		let bNativeRemoved = false;
		let bRegistering = false;
		let bOwnedAfterRegistration = false;
		let unCallbackRemovalCalls = 0;
		let unIsHookedCalls = 0;
		const ThrowCleanup = Value => {
			if (!bRegistering) {
				vecFailures.push(Value);
			}

			throw Value;
		};

		const CompleteCleanup = (Failure, Cleanup) => {
			if (Failure.Mode === "THROW") {
				ThrowCleanup(Failure.Value);
			}

			if (Failure.Mode === "FALSE") {
				return false;
			}

			const Result = Cleanup();

			if (Failure.Mode === "THROW_AFTER") {
				ThrowCleanup(Failure.Value);
			}

			return (Failure.Mode === "WRONG") ? undefined : Result;
		};

		const CheckPrimary = Value => {
			if (Scenario.Primary.Mode === "THROW") {
				vecFailures.push(Scenario.Primary.Value);
				throw Scenario.Primary.Value;
			}

			return (Scenario.Primary.Mode === "WRONG") ? 0n : Value;
		};

		class ControlledFunction extends Memory.Function {
			constructor(...vecArguments) {
				super(...vecArguments);
				vecCallables.push(this);
			}

			AddHook(...vecArguments) {
				bRegistering = true;

				try {
					return super.AddHook(...vecArguments);
				} catch (RegistrationError) {
					vecFailures.push(RegistrationError);
					setOpaqueFailures.add(RegistrationError);
					throw RegistrationError;
				} finally {
					bOwnedAfterRegistration = this.Hook !== null;
					bRegistering = false;
				}
			}

			Call(...vecArguments) {
				return CheckPrimary(super.Call(...vecArguments));
			}

			IsHooked() {
				const bHooked = super.IsHooked();
				unIsHookedCalls++;

				if ((Scenario.Specification.Kind === "STATE") && (unIsHookedCalls === 2)) {
					return CheckPrimary(bHooked);
				}

				return bHooked;
			}
		}

		NativeHooks.CreateFunctionHook = function CreateControlledFunction(...vecArguments) {
			if (Scenario.Registration.Mode === "CREATE_THROW") {
				throw Scenario.Registration.Value;
			}

			if (Scenario.Registration.Mode === "CREATE_NULL") {
				return null;
			}

			Hook = CreateFunctionHook.apply(this, vecArguments);
			Remove = Hook.Remove;

			for (const strOperation of ["Pre", "Post"]) {
				const Register = Hook[strOperation];
				Hook[strOperation] = function RegisterControlledCallback(Callback) {
					if (Scenario.Registration.Mode === "BEFORE") {
						throw Scenario.Registration.Value;
					}

					if (Scenario.Registration.Mode === "FALSE_BEFORE") {
						return false;
					}

					const Result = Register.call(this, Callback);

					if (Scenario.Registration.Mode === "AFTER") {
						throw Scenario.Registration.Value;
					}

					if (Scenario.Registration.Mode === "FALSE_AFTER") {
						return false;
					}

					return (Scenario.Registration.Mode === "WRONG_AFTER") ? {} : Result;
				};

				const RemoveCallback = Hook["Remove" + strOperation];
				Hook["Remove" + strOperation] = function RemoveControlledCallback(Callback) {
					unCallbackRemovalCalls++;

					return CompleteCleanup(Scenario.Callback, () => RemoveCallback.call(this, Callback));
				};
			}

			Hook.Remove = function RemoveControlledNativeHook() {
				vecNativeRemovalPhases.push(bRegistering ? "ROLLBACK" : "CLEANUP");

				return CompleteCleanup(Scenario.Native, () => {
					const bRemoved = Remove.call(this);
					bNativeRemoved = bNativeRemoved || (bRemoved === true);

					return bRemoved;
				});
			};

			return Hook;
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => (strName === "memory") ? { ...Memory, Function: ControlledFunction } : RequireDocumentation(strName);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				mapRunners.get(Scenario.Specification.Index)(Require, RecordedError);
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity([...setOpaqueFailures], vecFailures, bThrown, CaughtValue, "Function hook documentation");
			g_Assert.equal(bThrown, (Scenario.Registration.Mode !== "NONE") || (Scenario.Primary.Mode !== "NONE") || (Scenario.Callback.Mode !== "NONE") || (Scenario.Native.Mode !== "NONE"));
			g_Assert.equal(vecCallables.length, 1);
			g_Assert.equal(unCallbackRemovalCalls, bOwnedAfterRegistration ? 1 : 0, "callback removal must be attempted once, without silently retrying a failed explicit removal");
			g_Assert.equal(vecNativeRemovalPhases.filter(strPhase => strPhase === "CLEANUP").length, bOwnedAfterRegistration ? 1 : 0, "native cleanup must remain independent of callback removal");
			const bRollbackExpected = ["BEFORE", "AFTER", "FALSE_BEFORE", "FALSE_AFTER"].includes(Scenario.Registration.Mode);
			g_Assert.equal(vecNativeRemovalPhases.filter(strPhase => strPhase === "ROLLBACK").length, bRollbackExpected ? 1 : 0);
			g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore + (((Hook !== null) && !bNativeRemoved) ? 1 : 0));
			unCaseCount++;
		} finally {
			NativeHooks.CreateFunctionHook = CreateFunctionHook;

			if ((Hook !== null) && !bNativeRemoved) {
				g_Assert.equal(Remove.call(Hook), true);
			}

			g_Assert.equal(Fixture.ActiveHookCount(), unActiveBefore);
		}
	};

	// Every scenario restores the hook factory and ownership before the next; the batch watchdog also bounds all callback work.
	Context.RunScenario = RunScenario;
	for (let unBatchIndex = 0; unBatchIndex < vecCases.length; unBatchIndex += unCasesPerBatch) {
		Context.Scenarios = vecCases.slice(unBatchIndex, unBatchIndex + unCasesPerBatch);
		Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
	}

	g_Assert.equal(unCaseCount, 17066);

	return unCaseCount;
}

function VerifyMemoryAddressDocumentation(vecExamples, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const unCasesPerBatch = 64;
	const Memory = RequireDocumentation("memory");
	const MemoryHelpers = RequireDocumentation("memory/helpers");
	const ForeignTypeError = g_VM.runInNewContext('new TypeError("Controlled foreign-realm type error");');
	const vecValues = [
		new Error("Controlled Address workflow failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([0, undefined], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecAllocationFailures = [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		...[undefined, null, 0n, 1, "1", -1n].map(Value => ({ Mode: "INVALID", Value })),
	];
	const vecSpecifications = [
		{ Index: 0, Kind: "GENERIC", Owned: true },
		{ Index: 1, Kind: "CONSTRUCTOR", Owned: false },
		{ Index: 2, Kind: "PROPERTY", Owned: false },
		{ Index: 3, Kind: "EXPLICIT", Owned: true },
		{ Index: 5, Kind: "STATIC", Owned: false },
		{ Index: 6, Kind: "ADD", Owned: false },
		{ Index: 11, Kind: "DEALLOCATE", Owned: true },
		{ Index: 12, Kind: "EQUALS", Owned: false },
		{ Index: 13, Kind: "BOOL", Owned: false },
		{ Index: 14, Kind: "CHAR", Owned: false },
		{ Index: 15, Kind: "DOUBLE", Owned: false },
		{ Index: 16, Kind: "FLOAT", Owned: false },
		{ Index: 17, Kind: "INT", Owned: false },
		{ Index: 18, Kind: "LONG", Owned: false },
		{ Index: 18, Kind: "LONG", WideLong: true, Owned: false },
		{ Index: 19, Kind: "LONG_LONG", Owned: false },
		{ Index: 20, Kind: "SHORT", Owned: false },
		{ Index: 22, Kind: "UCHAR", Owned: false },
		{ Index: 23, Kind: "UINT", Owned: false },
		{ Index: 24, Kind: "ULONG", Owned: false },
		{ Index: 24, Kind: "ULONG", WideLong: true, Owned: false },
		{ Index: 25, Kind: "ULONG_LONG", Owned: false },
		{ Index: 26, Kind: "USHORT", Owned: false },
		{ Index: 28, Kind: "OVERLAP", Owned: false },
		{ Index: 31, Kind: "MOVE_FROM", Owned: false },
		{ Index: 32, Kind: "MOVE_TO", Owned: false },
		{ Index: 34, Kind: "REALLOCATE", Owned: true },
		{ Index: 35, Kind: "SEARCH", Owned: false },
		{ Index: 51, Kind: "SUBTRACT", Owned: false },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		for (const Cleanup of vecCleanupFailures) {
			for (const Primary of vecPrimaryFailures) {
				vecCases.push({ Specification, Primary, Cleanup });
			}

			for (const Value of vecValues) {
				for (const strStage of ["BEFORE", "AFTER"]) {
					vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanup, Constructor: { Stage: strStage, Value } });
				}
			}

			if (Specification.Kind === "GENERIC") {
				for (const strMode of ["WRITE_WRONG", "ADDRESS_WRITE_WRONG"]) {
					vecCases.push({ Specification, Primary: { Mode: strMode }, Cleanup });
				}
			}

			if (Specification.Kind === "OVERLAP") {
				for (const Value of vecValues) {
					vecCases.push({ Specification, Primary: { Mode: "INVALID_THROW", Value }, Cleanup });
				}

				vecCases.push({ Specification, Primary: { Mode: "INVALID_ACCEPT" }, Cleanup });
				vecCases.push({ Specification, Primary: { Mode: "INVALID_TYPE_ERROR", Value: ForeignTypeError }, Cleanup });
			}

			if (Specification.Kind === "REALLOCATE") {
				for (const Value of vecValues) {
					vecCases.push({ Specification, Primary: { Mode: "BEFORE", Value }, Cleanup });
				}

				for (const strMode of ["SET_WRONG", "READ_WRONG"]) {
					vecCases.push({ Specification, Primary: { Mode: strMode }, Cleanup });
				}
			}

			if (Specification.Kind === "SEARCH") {
				vecCases.push({ Specification, Primary: { Mode: "MISSING_WRONG" }, Cleanup });
			}

			if (Specification.Kind === "SUBTRACT") {
				for (const strMode of ["SOURCE_WRONG", "OWNERSHIP_WRONG"]) {
					vecCases.push({ Specification, Primary: { Mode: strMode }, Cleanup });
				}
			}
		}

		for (const Allocation of vecAllocationFailures) {
			vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanup: { Mode: "NONE" }, Allocation });
		}
	}

	const mapRunners = new Map(vecSpecifications.map(Specification => [Specification.Index, new Function("require", "Error", '"use strict";\n' + vecExamples[Specification.Index])]));
	const Context = g_VM.createContext({});
	const Script = new g_VM.Script("for (const Scenario of Scenarios) {\n\tRunScenario(Scenario);\n}");
	let unCaseCount = 0;
	const RunScenario = Scenario => {
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		let unAllocationAddress = 0n;
		let bNativeAllocated = false;
		let bNativeReleased = false;
		let PublishedOwner = null;
		let unConstructionCalls = 0;
		let unWrapperReleaseCalls = 0;
		let unRawReleaseCalls = 0;
		let unNullReads = 0;
		let unSearchCalls = 0;
		let unIntegerWrites = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		const CheckPrimary = Value => {
			if (Scenario.Primary.Mode === "THROW") {
				ThrowFailure(Scenario.Primary.Value);
			}

			return (Scenario.Primary.Mode === "WRONG") ? 0n : Value;
		};

		const CompleteCleanup = Release => {
			if (Scenario.Cleanup.Mode === "THROW") {
				ThrowFailure(Scenario.Cleanup.Value);
			}

			if (Scenario.Cleanup.Mode === "FALSE") {
				return false;
			}

			const bReleased = Release();
			g_Assert.equal(bReleased, true);
			bNativeReleased = true;

			if (Scenario.Cleanup.Mode === "THROW_AFTER") {
				ThrowFailure(Scenario.Cleanup.Value);
			}

			return (Scenario.Cleanup.Mode === "WRONG") ? undefined : bReleased;
		};

		class ControlledAddress extends Memory.Address {
			constructor(...vecArguments) {
				unConstructionCalls++;

				if (Scenario.Constructor?.Stage === "BEFORE") {
					ThrowFailure(Scenario.Constructor.Value);
				}

				super(...vecArguments);

				if (Scenario.Constructor?.Stage === "AFTER") {
					ThrowFailure(Scenario.Constructor.Value);
				}

				if (Scenario.Specification.Owned) {
					PublishedOwner = this;
				}
			}

			static CreateFromAddress(...vecArguments) {
				unConstructionCalls++;

				if (Scenario.Constructor?.Stage === "BEFORE") {
					ThrowFailure(Scenario.Constructor.Value);
				}

				const View = Memory.Address.CreateFromAddress(...vecArguments);

				if (Scenario.Constructor?.Stage === "AFTER") {
					ThrowFailure(Scenario.Constructor.Value);
				}

				return CheckPrimary(View);
			}

			GetMemoryAddress() {
				const unAddress = super.GetMemoryAddress();

				return (Scenario.Specification.Kind === "GENERIC") ? CheckPrimary(unAddress) : unAddress;
			}

			get Address() {
				const unAddress = super.Address;

				return ["CONSTRUCTOR", "PROPERTY"].includes(Scenario.Specification.Kind) ? CheckPrimary(unAddress) : unAddress;
			}

			get Null() {
				const bNull = super.Null;
				unNullReads++;

				if ((Scenario.Specification.Kind === "EXPLICIT") && (unNullReads === 1)) {
					if (Scenario.Primary.Mode === "THROW") {
						ThrowFailure(Scenario.Primary.Value);
					}

					return (Scenario.Primary.Mode === "WRONG") ? true : bNull;
				}

				return bNull;
			}

			Write(...vecArguments) {
				const bWritten = super.Write(...vecArguments);

				return (Scenario.Primary.Mode === "WRITE_WRONG") ? {} : bWritten;
			}

			WriteAddress(...vecArguments) {
				const bWritten = super.WriteAddress(...vecArguments);

				return (Scenario.Primary.Mode === "ADDRESS_WRITE_WRONG") ? {} : bWritten;
			}

			Add(...vecArguments) {
				const View = super.Add(...vecArguments);
				if (Scenario.Specification.Kind === "MOVE_FROM") {
					const MoveFrom = View.MoveFrom;
					View.MoveFrom = function MoveControlledBytesFrom(...vecMoveArguments) {
						const Result = CheckPrimary(MoveFrom.apply(this, vecMoveArguments));

						return (Scenario.Primary.Mode === "WRONG") ? {} : Result;
					};
				}

				if (Scenario.Specification.Kind !== "ADD") {
					return View;
				}

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				return (Scenario.Primary.Mode === "WRONG") ? { Address: 0n, Owned: false, GetInt: () => View.GetInt() } : View;
			}

			Subtract(...vecArguments) {
				const View = super.Subtract(...vecArguments);

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				if (Scenario.Primary.Mode === "SOURCE_WRONG") {
					Object.getPrototypeOf(Memory.Address).RebindAddress(this, super.Address + 0x1n);
				}

				if (Scenario.Primary.Mode === "OWNERSHIP_WRONG") {
					return { Address: View.Address, Owned: true };
				}

				return (Scenario.Primary.Mode === "WRONG") ? { Address: 0n, Owned: false } : View;
			}

			Equals(...vecArguments) {
				const bEqual = super.Equals(...vecArguments);

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				return (Scenario.Primary.Mode === "WRONG") ? !bEqual : bEqual;
			}

			GetBool(...vecArguments) {
				const bValue = super.GetBool(...vecArguments);

				return CheckPrimary(bValue);
			}

			GetChar(...vecArguments) {
				const nValue = super.GetChar(...vecArguments);

				return CheckPrimary(nValue);
			}

			GetDouble(...vecArguments) {
				const dblValue = super.GetDouble(...vecArguments);

				return CheckPrimary(dblValue);
			}

			GetFloat(...vecArguments) {
				const flValue = super.GetFloat(...vecArguments);

				return CheckPrimary(flValue);
			}

			GetInt(...vecArguments) {
				const nValue = super.GetInt(...vecArguments);
				if ((Scenario.Specification.Kind === "REALLOCATE") && (Scenario.Primary.Mode === "READ_WRONG")) {
					return nValue + 1;
				}

				return (Scenario.Specification.Kind === "INT") ? CheckPrimary(nValue) : nValue;
			}

			SetInt(...vecArguments) {
				const Owner = super.SetInt(...vecArguments);
				unIntegerWrites++;

				return ((Scenario.Specification.Kind === "REALLOCATE") && (Scenario.Primary.Mode === "SET_WRONG") && (unIntegerWrites === 2)) ? {} : Owner;
			}

			IsOverlapping(AddressLike, unByteCount) {
				if (unByteCount === 0) {
					if (Scenario.Primary.Mode === "INVALID_TYPE_ERROR") {
						throw Scenario.Primary.Value;
					}

					if (Scenario.Primary.Mode === "INVALID_THROW") {
						ThrowFailure(Scenario.Primary.Value);
					}

					if (Scenario.Primary.Mode === "INVALID_ACCEPT") {
						return false;
					}
				}

				return CheckPrimary(super.IsOverlapping(AddressLike, unByteCount));
			}

			MoveTo(...vecArguments) {
				const Result = CheckPrimary(super.MoveTo(...vecArguments));

				return (Scenario.Primary.Mode === "WRONG") ? {} : Result;
			}

			Reallocate(...vecArguments) {
				if (Scenario.Primary.Mode === "BEFORE") {
					ThrowFailure(Scenario.Primary.Value);
				}

				return CheckPrimary(super.Reallocate(...vecArguments));
			}

			SearchBytes(...vecArguments) {
				const unAddress = super.SearchBytes(...vecArguments);
				unSearchCalls++;

				return ((Scenario.Primary.Mode === "MISSING_WRONG") && (unSearchCalls === 2)) ? 0x1n : CheckPrimary(unAddress);
			}

			SetLong(nValue, nAddressOffset = 0n) {
				if (!Scenario.Specification.WideLong) {
					return super.SetLong(nValue, nAddressOffset);
				}

				g_Assert.equal(typeof nValue, "bigint");
				g_Assert.equal(MemoryHelpers.Write(super.Address, Memory.DataType.LongLong, nValue, nAddressOffset), true);

				return this;
			}

			GetLong(nAddressOffset = 0n) {
				const nValue = Scenario.Specification.WideLong ? MemoryHelpers.Read(super.Address, Memory.DataType.LongLong, nAddressOffset) : super.GetLong(nAddressOffset);

				return CheckPrimary(nValue);
			}

			GetLongLong(...vecArguments) {
				const nValue = super.GetLongLong(...vecArguments);

				return CheckPrimary(nValue);
			}

			GetShort(...vecArguments) {
				const nValue = super.GetShort(...vecArguments);

				return CheckPrimary(nValue);
			}

			GetUChar(...vecArguments) {
				const unValue = super.GetUChar(...vecArguments);

				return CheckPrimary(unValue);
			}

			GetUInt(...vecArguments) {
				const unValue = super.GetUInt(...vecArguments);

				return CheckPrimary(unValue);
			}

			SetULong(unValue, nAddressOffset = 0n) {
				if (!Scenario.Specification.WideLong) {
					return super.SetULong(unValue, nAddressOffset);
				}

				g_Assert.equal(typeof unValue, "bigint");
				g_Assert.equal(MemoryHelpers.Write(super.Address, Memory.DataType.ULongLong, unValue, nAddressOffset), true);

				return this;
			}

			GetULong(nAddressOffset = 0n) {
				const unValue = Scenario.Specification.WideLong ? MemoryHelpers.Read(super.Address, Memory.DataType.ULongLong, nAddressOffset) : super.GetULong(nAddressOffset);

				return CheckPrimary(unValue);
			}

			GetULongLong(...vecArguments) {
				const unValue = super.GetULongLong(...vecArguments);

				return CheckPrimary(unValue);
			}

			GetUShort(...vecArguments) {
				const unValue = super.GetUShort(...vecArguments);

				return CheckPrimary(unValue);
			}

			Deallocate() {
				unWrapperReleaseCalls++;
				const bReleased = CompleteCleanup(() => super.Deallocate());

				return (Scenario.Specification.Kind === "DEALLOCATE") ? CheckPrimary(bReleased) : bReleased;
			}
		}

		const Runtime = {
			...Memory,
			Address: ControlledAddress,
			// This explicit fixture profile exercises the LP64 documentation branch through real 64-bit storage operations, not a native long ABI.
			TYPE_SIZES: Scenario.Specification.WideLong ? { ...Memory.TYPE_SIZES, [Memory.DataType.Long]: 8, [Memory.DataType.ULong]: 8 } : Memory.TYPE_SIZES,

			Allocate(unByteCount) {
				if (Scenario.Allocation) {
					if (Scenario.Allocation.Mode === "THROW") {
						ThrowFailure(Scenario.Allocation.Value);
					}

					return Scenario.Allocation.Value;
				}

				unAllocationAddress = Memory.Allocate(unByteCount);
				g_Assert.equal(typeof unAllocationAddress, "bigint");
				g_Assert(unAllocationAddress > 0n);
				bNativeAllocated = true;

				return unAllocationAddress;
			},

			Deallocate(unAddress) {
				g_Assert.equal(unAddress, unAllocationAddress);
				unRawReleaseCalls++;

				return CompleteCleanup(() => Memory.Deallocate(unAddress));
			},
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => (strName === "memory") ? Runtime : RequireDocumentation(strName);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				mapRunners.get(Scenario.Specification.Index)(Require, RecordedError);
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			if (bThrown && (vecFailures.length === 0)) {
				g_Assert.fail("Unexpected Address documentation failure Index=" + Scenario.Specification.Index + " WideLong=" + !!Scenario.Specification.WideLong + " Failure=" + (CaughtValue?.stack ?? String(CaughtValue)));
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Address documentation");
			const bExpectedPrimaryFailure = !["NONE", "INVALID_TYPE_ERROR"].includes(Scenario.Primary.Mode);
			g_Assert.equal(bThrown, !!Scenario.Allocation || !!Scenario.Constructor || bExpectedPrimaryFailure || (Scenario.Cleanup.Mode !== "NONE"));
			const unExpectedConstructionCalls = ((Scenario.Specification.Kind === "EQUALS") && !Scenario.Constructor && (Scenario.Primary.Mode !== "THROW")) ? 2 : 1;
			g_Assert.equal(unConstructionCalls, bNativeAllocated ? unExpectedConstructionCalls : 0);
			g_Assert.equal(unWrapperReleaseCalls, (PublishedOwner !== null) ? 1 : 0, "failed owning release must not be silently retried");
			g_Assert.equal(unRawReleaseCalls, (bNativeAllocated && (PublishedOwner === null)) ? 1 : 0, "raw fallback is used only before ownership transfer or for borrowed views");
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + ((bNativeAllocated && !bNativeReleased) ? 1 : 0));
			unCaseCount++;
		} finally {
			if (bNativeAllocated && !bNativeReleased) {
				if (PublishedOwner !== null) {
					g_Assert.equal(Memory.Address.prototype.Deallocate.call(PublishedOwner), true);

				} else {
					g_Assert.equal(Memory.Deallocate(unAllocationAddress), true);
				}
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	};

	// A bounded batch avoids a watchdog thread per case without sharing any example-local bindings or fixture ownership.
	Context.RunScenario = RunScenario;
	for (let unBatchIndex = 0; unBatchIndex < vecCases.length; unBatchIndex += unCasesPerBatch) {
		Context.Scenarios = vecCases.slice(unBatchIndex, unBatchIndex + unCasesPerBatch);
		Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
	}

	g_Assert.equal(unCaseCount, 9363);

	return unCaseCount;
}

function VerifyMemoryAddressPairDocumentation(vecExamples, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const unCasesPerBatch = 64;
	const Memory = RequireDocumentation("memory");
	const vecValues = [
		new Error("Controlled Address pair failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([0, undefined], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecAllocationFailures = [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		...[undefined, null, 0n, 1, "1", -1n].map(Value => ({ Mode: "INVALID", Value })),
	];
	const vecSpecifications = [
		{ Index: 7, Kind: "COMPARE" },
		{ Index: 8, Kind: "COMPARE_TO" },
		{ Index: 9, Kind: "COPY_FROM" },
		{ Index: 10, Kind: "COPY_TO" },
		{ Index: 21, Kind: "STRING", AdditionalPrimaryModes: ["NULL_WRONG"] },
		{ Index: 27, Kind: "VIRTUAL", HasSymbol: true, AdditionalPrimaryModes: ["ENTRY_WRONG", "TABLE_WRONG"] },
		{ Index: 30, Kind: "VIRTUAL_FUNCTION", HasSymbol: true, AdditionalPrimaryModes: ["THIS_WRONG", "OPTIONS_WRONG"] },
		{ Index: 30, Kind: "VIRTUAL_FUNCTION", HasSymbol: true, UseFunctionInformation: true, AdditionalPrimaryModes: ["THIS_WRONG", "OPTIONS_WRONG"] },
		{ Index: 33, Kind: "ADDRESS", AdditionalPrimaryModes: ["NULL_ADDRESS_WRONG"] },
		{ Index: 43, Kind: "SET_ADDRESS", AdditionalPrimaryModes: ["READ_WRONG"] },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		for (const FirstCleanup of vecCleanupFailures) {
			for (const SecondCleanup of vecCleanupFailures) {
				for (const Primary of vecPrimaryFailures) {
					vecCases.push({ Specification, Primary, Cleanups: [FirstCleanup, SecondCleanup] });
				}

				for (const strMode of Specification.AdditionalPrimaryModes ?? []) {
					vecCases.push({ Specification, Primary: { Mode: strMode }, Cleanups: [FirstCleanup, SecondCleanup] });
				}
			}

			for (const Allocation of vecAllocationFailures) {
				vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanups: [FirstCleanup, { Mode: "NONE" }], Acquisition: { ...Allocation, Index: 1 } });
			}

			if (Specification.Kind === "COMPARE_TO") {
				vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanups: [FirstCleanup], Duplicate: true });
			}
		}

		for (const Allocation of vecAllocationFailures) {
			vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanups: [], Acquisition: { ...Allocation, Index: 0 } });
		}

		if (Specification.HasSymbol) {
			for (const SymbolFailure of vecAllocationFailures) {
				vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanups: [], Symbol: SymbolFailure });
			}
		}
	}

	const mapRunners = new Map(vecSpecifications.map(Specification => [Specification.Index, new Function("require", "Error", '"use strict";\n' + vecExamples[Specification.Index])]));
	const Context = g_VM.createContext({});
	const Script = new g_VM.Script("for (const Scenario of Scenarios) {\n\tRunScenario(Scenario);\n}");
	let unCaseCount = 0;
	const RunScenario = Scenario => {
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		const vecAllocations = [];
		const vecReleaseOrder = [];
		let unAcquisitionCount = 0;
		let unSymbolLookupCount = 0;
		let unReadCount = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		const CheckPrimary = Value => {
			if (Scenario.Primary.Mode === "THROW") {
				ThrowFailure(Scenario.Primary.Value);
			}

			if (Scenario.Primary.Mode === "WRONG") {
				return Scenario.Specification.Kind.startsWith("COPY") ? {} : 1;
			}

			return Value;
		};

		class ControlledAddress extends Memory.Address {
			Compare(...vecArguments) {
				return CheckPrimary(super.Compare(...vecArguments));
			}

			CompareTo(...vecArguments) {
				return CheckPrimary(super.CompareTo(...vecArguments));
			}

			CopyFrom(...vecArguments) {
				return CheckPrimary(super.CopyFrom(...vecArguments));
			}

			CopyTo(...vecArguments) {
				return CheckPrimary(super.CopyTo(...vecArguments));
			}

			GetStringAddress(...vecArguments) {
				const strText = super.GetStringAddress(...vecArguments);
				unReadCount++;

				return ((Scenario.Primary.Mode === "NULL_WRONG") && (unReadCount === 2)) ? "" : CheckPrimary(strText);
			}

			GetVirtualFunction(...vecArguments) {
				const unAddress = super.GetVirtualFunction(...vecArguments);
				if (Scenario.Specification.Kind !== "VIRTUAL") {
					return unAddress;
				}

				unReadCount++;

				if (((Scenario.Primary.Mode === "ENTRY_WRONG") && (unReadCount === 2)) || ((Scenario.Primary.Mode === "TABLE_WRONG") && (unReadCount === 3))) {
					return 0x1n;
				}

				return CheckPrimary(unAddress);
			}

			MakeVirtualFunction(...vecArguments) {
				// Exercise the real alternate overload and signature split without invoking or hooking its illustrative member ABI.
				const Information = Scenario.Specification.UseFunctionInformation ? new Memory.FunctionInfo({
					IsVirtual: true,
					ThisAddressOffset: 0x4,
					VTableIndex: vecArguments[0],
					VTableOffset: 0x8,
					CallingConvention: vecArguments[1],
					ArgumentTypes: [Memory.DataType.Address, Memory.DataType.Int],
					ReturnType: vecArguments[3],
				}) : null;
				const Callable = Information ? super.MakeVirtualFunction(Information) : super.MakeVirtualFunction(...vecArguments);
				if (Information) {
					g_Assert.deepEqual(Array.from(Callable.ArgumentTypes), [Memory.DataType.Int]);
					g_Assert.deepEqual(Array.from(Callable.SignatureArgumentTypes), [Memory.DataType.Address, Memory.DataType.Int]);
					g_Assert.deepEqual(Array.from(Callable.Options.Arguments), [Memory.DataType.Address, Memory.DataType.Int]);
				}

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				if (Scenario.Primary.Mode === "WRONG") {
					return { Address: 0n, ThisObject: Callable.ThisObject, Options: Callable.Options };
				}

				if (Scenario.Primary.Mode === "THIS_WRONG") {
					return { Address: Callable.Address, ThisObject: 0n, Options: Callable.Options };
				}

				if (Scenario.Primary.Mode === "OPTIONS_WRONG") {
					return { Address: Callable.Address, ThisObject: Callable.ThisObject, Options: { ...Callable.Options, ThisObject: 0n } };
				}

				return Callable;
			}

			ReadAddress(...vecArguments) {
				const unAddress = super.ReadAddress(...vecArguments);
				unReadCount++;

				if ((Scenario.Specification.Kind === "SET_ADDRESS") && (Scenario.Primary.Mode === "READ_WRONG")) {
					return 0n;
				}

				return ((Scenario.Primary.Mode === "NULL_ADDRESS_WRONG") && (unReadCount === 2)) ? 0x1n : CheckPrimary(unAddress);
			}

			SetAddress(...vecArguments) {
				const Receiver = super.SetAddress(...vecArguments);

				return (Scenario.Specification.Kind === "SET_ADDRESS") ? CheckPrimary(Receiver) : Receiver;
			}
		}

		const Runtime = {
			...Memory,
			Address: ControlledAddress,

			Allocate(unByteCount) {
				const unIndex = unAcquisitionCount++;
				if (Scenario.Acquisition?.Index === unIndex) {
					if (Scenario.Acquisition.Mode === "THROW") {
						ThrowFailure(Scenario.Acquisition.Value);
					}

					return Scenario.Acquisition.Value;
				}

				if (Scenario.Duplicate && (unIndex === 1)) {
					return vecAllocations[0].Address;
				}

				const unAddress = Memory.Allocate(unByteCount);
				g_Assert.equal(typeof unAddress, "bigint");
				g_Assert(unAddress > 0n);
				vecAllocations.push({ Address: unAddress, Released: false });

				return unAddress;
			},

			Deallocate(unAddress) {
				const nIndex = vecAllocations.findIndex(Allocation => Allocation.Address === unAddress);
				g_Assert(nIndex >= 0, "invalid allocation results must not reach cleanup");
				g_Assert.equal(vecReleaseOrder.includes(nIndex), false, "each acquired allocation is released at most once");
				vecReleaseOrder.push(nIndex);
				const Cleanup = Scenario.Cleanups[nIndex];
				if (Cleanup.Mode === "THROW") {
					ThrowFailure(Cleanup.Value);
				}

				if (Cleanup.Mode === "FALSE") {
					return false;
				}

				g_Assert.equal(Memory.Deallocate(unAddress), true);
				vecAllocations[nIndex].Released = true;

				if (Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Cleanup.Value);
				}

				return (Cleanup.Mode === "WRONG") ? {} : true;
			},
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => {
			if (strName === "memory") {
				return Runtime;
			}

			if ((strName === "memory/manager") && Scenario.Specification.HasSymbol) {
				const Manager = RequireDocumentation(strName);

				return {
					...Manager,

					GetBinarySymbol(...vecArguments) {
						unSymbolLookupCount++;

						if (Scenario.Symbol) {
							if (Scenario.Symbol.Mode === "THROW") {
								ThrowFailure(Scenario.Symbol.Value);
							}

							return Scenario.Symbol.Value;
						}

						return Manager.GetBinarySymbol(...vecArguments);
					},
				};
			}

			return RequireDocumentation(strName);
		};

		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				mapRunners.get(Scenario.Specification.Index)(Require, RecordedError);
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Address pair documentation");
			g_Assert.equal(bThrown, !!Scenario.Acquisition || !!Scenario.Duplicate || !!Scenario.Symbol || (Scenario.Primary.Mode !== "NONE") || Scenario.Cleanups.some(Cleanup => Cleanup.Mode !== "NONE"));
			let unExpectedAcquisitions = 2;
			if (Scenario.Symbol) {
				unExpectedAcquisitions = 0;

			} else if (Scenario.Acquisition) {
				unExpectedAcquisitions = Scenario.Acquisition.Index + 1;
			}

			g_Assert.equal(unAcquisitionCount, unExpectedAcquisitions);
			g_Assert.equal(unSymbolLookupCount, Scenario.Specification.HasSymbol ? 1 : 0);
			g_Assert.deepEqual(vecReleaseOrder, [...vecAllocations.keys()].reverse(), "cleanup continues in reverse order after any release failure");
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + vecAllocations.filter(Allocation => !Allocation.Released).length);
			unCaseCount++;
		} finally {
			for (const Allocation of vecAllocations) {
				if (!Allocation.Released) {
					g_Assert.equal(Memory.Deallocate(Allocation.Address), true);
				}
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	};

	// One timeout covers each batch; every example invocation still has fresh function-local state and independent fixture cleanup.
	Context.RunScenario = RunScenario;
	for (let unBatchIndex = 0; unBatchIndex < vecCases.length; unBatchIndex += unCasesPerBatch) {
		Context.Scenarios = vecCases.slice(unBatchIndex, unBatchIndex + unCasesPerBatch);
		Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
	}

	g_Assert.equal(unCaseCount, 21996);

	return unCaseCount;
}

function VerifyMemoryAddressSetterDocumentation(vecExamples, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const unCasesPerBatch = 64;
	const Memory = RequireDocumentation("memory");
	const MemoryHelpers = RequireDocumentation("memory/helpers");
	const vecValues = [
		new Error("Controlled Address setter failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([undefined, 0], "Controlled aggregate value"),
	];
	const vecPrimaryFailures = [
		{ Mode: "NONE" },
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		{ Mode: "WRONG" },
	];
	const vecReadFailures = [
		...vecValues.map(Value => ({ Mode: "READ_THROW", Value })),
		{ Mode: "READ_WRONG" },
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecAllocationFailures = [
		...vecValues.map(Value => ({ Mode: "THROW", Value })),
		...[undefined, null, 0n, 1, "1", -1n].map(Value => ({ Mode: "INVALID", Value })),
	];
	const vecSpecifications = [
		{ Index: 36, Setter: "SetBool", Getter: "GetBool" },
		{ Index: 37, Setter: "SetChar", Getter: "GetChar" },
		{ Index: 38, Setter: "SetDouble", Getter: "GetDouble" },
		{ Index: 39, Setter: "SetFloat", Getter: "GetFloat" },
		{ Index: 40, Setter: "SetInt", Getter: "GetInt" },
		{ Index: 41, Setter: "SetLong", Getter: "GetLong" },
		{ Index: 41, Setter: "SetLong", Getter: "GetLong", WideLong: true },
		{ Index: 42, Setter: "SetLongLong", Getter: "GetLongLong" },
		{ Index: 44, Setter: "SetProtection" },
		{ Index: 45, Setter: "SetShort", Getter: "GetShort" },
		{ Index: 46, Setter: "SetUChar", Getter: "GetUChar" },
		{ Index: 47, Setter: "SetUInt", Getter: "GetUInt" },
		{ Index: 48, Setter: "SetULong", Getter: "GetULong" },
		{ Index: 48, Setter: "SetULong", Getter: "GetULong", WideLong: true, WideDataType: Memory.DataType.ULongLong },
		{ Index: 49, Setter: "SetULongLong", Getter: "GetULongLong" },
		{ Index: 50, Setter: "SetUShort", Getter: "GetUShort" },
	];
	const vecCases = [];
	for (const Specification of vecSpecifications) {
		for (const Cleanup of vecCleanupFailures) {
			for (const Primary of [...vecPrimaryFailures, ...(Specification.Getter ? vecReadFailures : [])]) {
				vecCases.push({ Specification, Primary, Cleanup });
			}

			for (const Value of vecValues) {
				for (const strStage of ["BEFORE", "AFTER"]) {
					vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanup, Constructor: { Stage: strStage, Value } });
				}
			}
		}

		for (const Allocation of vecAllocationFailures) {
			vecCases.push({ Specification, Primary: { Mode: "NONE" }, Cleanup: { Mode: "NONE" }, Allocation });
		}
	}

	const mapRunners = new Map(vecSpecifications.map(Specification => [Specification.Index, new Function("require", "Error", '"use strict";\n' + vecExamples[Specification.Index])]));
	const Context = g_VM.createContext({});
	const Script = new g_VM.Script("for (const Scenario of Scenarios) {\n\tRunScenario(Scenario);\n}");
	let unCaseCount = 0;
	const RunScenario = Scenario => {
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		let unAllocationAddress = 0n;
		let bAllocated = false;
		let bReleased = false;
		let unConstructorCalls = 0;
		let unWriteCalls = 0;
		let unReadCalls = 0;
		let unReleaseCalls = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		class ControlledAddress extends Memory.Address {
			constructor(...vecArguments) {
				unConstructorCalls++;

				if (Scenario.Constructor?.Stage === "BEFORE") {
					ThrowFailure(Scenario.Constructor.Value);
				}

				super(...vecArguments);

				if (Scenario.Constructor?.Stage === "AFTER") {
					ThrowFailure(Scenario.Constructor.Value);
				}
			}
		}

		const strWideDataType = Scenario.Specification.WideDataType ?? Memory.DataType.LongLong;
		const Setter = Memory.Address.prototype[Scenario.Specification.Setter];
		Object.defineProperty(ControlledAddress.prototype, Scenario.Specification.Setter, {
			value: function WriteControlledValue(...vecArguments) {
				unWriteCalls++;
				let Result = null;
				if (Scenario.Specification.WideLong) {
					g_Assert.equal(typeof vecArguments[0], "bigint");
					g_Assert.equal(MemoryHelpers.Write(this.Address, strWideDataType, vecArguments[0], vecArguments[1] ?? 0n), true);
					Result = this;

				} else {
					Result = Setter.apply(this, vecArguments);
				}

				g_Assert.equal(Result, Scenario.Specification.Getter ? this : true);

				if (Scenario.Primary.Mode === "THROW") {
					ThrowFailure(Scenario.Primary.Value);
				}

				return (Scenario.Primary.Mode === "WRONG") ? {} : Result;
			},
		});

		if (Scenario.Specification.Getter) {
			const Getter = Memory.Address.prototype[Scenario.Specification.Getter];
			Object.defineProperty(ControlledAddress.prototype, Scenario.Specification.Getter, {
				value: function ReadControlledValue(...vecArguments) {
					unReadCalls++;
					const Value = Scenario.Specification.WideLong ? MemoryHelpers.Read(this.Address, strWideDataType, vecArguments[0] ?? 0n) : Getter.apply(this, vecArguments);

					if (Scenario.Primary.Mode === "READ_THROW") {
						ThrowFailure(Scenario.Primary.Value);
					}

					if (Scenario.Primary.Mode !== "READ_WRONG") {
						return Value;
					}

					if (typeof Value === "boolean") {
						return {};
					}

					if (typeof Value === "bigint") {
						return Value + 1n;
					}

					return Value + 1;
				},
			});
		}

		const Runtime = {
			...Memory,
			Address: ControlledAddress,
			// This selected-width fixture uses real 64-bit storage operations, not a native LP64 long ABI or an OS page-protection test.
			TYPE_SIZES: Scenario.Specification.WideLong ? { ...Memory.TYPE_SIZES, [Memory.DataType.Long]: 8, [Memory.DataType.ULong]: 8 } : Memory.TYPE_SIZES,

			Allocate(unByteCount) {
				if (Scenario.Allocation) {
					if (Scenario.Allocation.Mode === "THROW") {
						ThrowFailure(Scenario.Allocation.Value);
					}

					return Scenario.Allocation.Value;
				}

				if (Scenario.Specification.WideLong) {
					g_Assert.equal(unByteCount, 8);
				}

				unAllocationAddress = Memory.Allocate(unByteCount);
				g_Assert.equal(typeof unAllocationAddress, "bigint");
				g_Assert(unAllocationAddress > 0n);
				bAllocated = true;

				return unAllocationAddress;
			},

			Deallocate(unAddress) {
				g_Assert.equal(unAddress, unAllocationAddress);
				unReleaseCalls++;

				if (Scenario.Cleanup.Mode === "THROW") {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				if (Scenario.Cleanup.Mode === "FALSE") {
					return false;
				}

				g_Assert.equal(Memory.Deallocate(unAddress), true);
				bReleased = true;

				if (Scenario.Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				return (Scenario.Cleanup.Mode === "WRONG") ? undefined : true;
			},
		};

		const RecordedError = function CreateRecordedError(strMessage) {
			const Failure = new Error(strMessage);
			vecFailures.push(Failure);

			return Failure;
		};

		const Require = strName => (strName === "memory") ? Runtime : RequireDocumentation(strName);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				mapRunners.get(Scenario.Specification.Index)(Require, RecordedError);
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity(vecValues, vecFailures, bThrown, CaughtValue, "Address setter documentation");
			g_Assert.equal(bThrown, !!Scenario.Allocation || !!Scenario.Constructor || (Scenario.Primary.Mode !== "NONE") || (Scenario.Cleanup.Mode !== "NONE"), "setter documentation must reject injected failures");
			g_Assert.equal(unConstructorCalls, bAllocated ? 1 : 0);
			g_Assert.equal(unWriteCalls, (bAllocated && !Scenario.Constructor) ? 1 : 0);
			g_Assert.equal(unReadCalls, (bAllocated && !Scenario.Constructor && Scenario.Specification.Getter && (Scenario.Primary.Mode !== "THROW")) ? 1 : 0);
			g_Assert.equal(unReleaseCalls, bAllocated ? 1 : 0, "setter allocation cleanup must be attempted exactly once");
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + ((bAllocated && !bReleased) ? 1 : 0));
			unCaseCount++;
		} finally {
			if (bAllocated && !bReleased) {
				g_Assert.equal(Memory.Deallocate(unAllocationAddress), true);
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	};

	Context.RunScenario = RunScenario;
	for (let unBatchIndex = 0; unBatchIndex < vecCases.length; unBatchIndex += unCasesPerBatch) {
		Context.Scenarios = vecCases.slice(unBatchIndex, unBatchIndex + unCasesPerBatch);
		Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
	}

	g_Assert.equal(unCaseCount, 6567);

	return unCaseCount;
}

function VerifyMemoryErrorDocumentation(strExample, RequireDocumentation, GetAllocationCount) {
	const unExampleTimeoutMilliseconds = 1000;
	const unConstructorTargetIndex = 0;
	const unReallocateTargetIndex = 1;
	const unBooleanWriteTargetIndex = 2;
	const unErrorTargetCount = 3;
	const unCasesPerBatch = 64;
	const Memory = RequireDocumentation("memory");
	const ForeignError = g_VM.runInNewContext('new Error("Controlled foreign-realm memory error");');
	const vecUnexpectedValues = [undefined, null, 0, "", {}, 0n, ForeignError];
	const vecCleanupValues = [
		new Error("Controlled error-example cleanup failure"),
		undefined,
		null,
		0,
		"",
		new AggregateError([undefined, 0], "Controlled aggregate value"),
	];
	const vecCleanupFailures = [
		{ Mode: "NONE" },
		...vecCleanupValues.flatMap(Value => [{ Mode: "THROW", Value }, { Mode: "THROW_AFTER", Value }]),
		{ Mode: "FALSE" },
		{ Mode: "WRONG" },
	];
	const vecAllocationFailures = [
		...vecCleanupValues.map(Value => ({ Mode: "THROW", Value })),
		...[undefined, null, 0n, 1, "1", -1n].map(Value => ({ Mode: "INVALID", Value })),
	];
	const vecCases = [];
	for (const Cleanup of vecCleanupFailures) {
		vecCases.push({ Mode: "NONE", Cleanup });
		vecCases.push({ Mode: "NATIVE_ERROR", Cleanup });

		for (let unTarget = 0; unTarget < unErrorTargetCount; unTarget++) {
			for (const Value of vecUnexpectedValues) {
				vecCases.push({ Mode: "THROW", Target: unTarget, Value, Cleanup });
			}

			vecCases.push({ Mode: "MISSING", Target: unTarget, Cleanup });
		}
	}

	for (const Allocation of vecAllocationFailures) {
		vecCases.push({ Mode: "NONE", Cleanup: { Mode: "NONE" }, Allocation });
	}

	const RunExample = new Function("require", "Error", '"use strict";\n' + strExample);
	const Context = g_VM.createContext({});
	const Script = new g_VM.Script("for (const Scenario of Scenarios) {\n\tRunScenario(Scenario);\n}");
	let unCaseCount = 0;
	const RunScenario = Scenario => {
		const unAllocationsBefore = GetAllocationCount();
		const vecFailures = [];
		let unAllocationAddress = 0n;
		let bAllocated = false;
		let bReleased = false;
		let unConstructorCalls = 0;
		let unReallocateCalls = 0;
		let unWriteCalls = 0;
		let unReleaseCalls = 0;
		const ThrowFailure = Value => {
			vecFailures.push(Value);
			throw Value;
		};

		class ControlledAddress extends Memory.Address {
			constructor(...vecArguments) {
				const unOperationIndex = unConstructorCalls++;
				if ((Scenario.Target === unConstructorTargetIndex) && (unOperationIndex === 0)) {
					if (Scenario.Mode === "THROW") {
						ThrowFailure(Scenario.Value);
					}

					if (Scenario.Mode === "MISSING") {
						return new Memory.Address(unAllocationAddress);
					}
				}

				try {
					super(...vecArguments);
				} catch (CaughtError) {
					if ((Scenario.Mode === "NATIVE_ERROR") && (unOperationIndex === 0)) {
						g_Assert(CaughtError instanceof Error);
						throw new Error("Native-shaped invalid address error");
					}

					throw CaughtError;
				}
			}

			Reallocate(...vecArguments) {
				unReallocateCalls++;

				if (Scenario.Target === unReallocateTargetIndex) {
					if (Scenario.Mode === "THROW") {
						ThrowFailure(Scenario.Value);
					}

					if (Scenario.Mode === "MISSING") {
						return this;
					}
				}

				return super.Reallocate(...vecArguments);
			}

			SetBool(...vecArguments) {
				unWriteCalls++;

				if (Scenario.Target === unBooleanWriteTargetIndex) {
					if (Scenario.Mode === "THROW") {
						ThrowFailure(Scenario.Value);
					}

					if (Scenario.Mode === "MISSING") {
						return this;
					}
				}

				try {
					return super.SetBool(...vecArguments);
				} catch (CaughtError) {
					if (Scenario.Mode === "NATIVE_ERROR") {
						g_Assert(CaughtError instanceof Error);
						throw new Error("Native-shaped invalid boolean error");
					}

					throw CaughtError;
				}
			}
		}

		const Runtime = {
			...Memory,
			Address: ControlledAddress,

			Allocate(unByteCount) {
				if (Scenario.Allocation) {
					if (Scenario.Allocation.Mode === "THROW") {
						ThrowFailure(Scenario.Allocation.Value);
					}

					return Scenario.Allocation.Value;
				}

				unAllocationAddress = Memory.Allocate(unByteCount);
				g_Assert.equal(typeof unAllocationAddress, "bigint");
				g_Assert(unAllocationAddress > 0n);
				bAllocated = true;

				return unAllocationAddress;
			},

			Deallocate(unAddress) {
				g_Assert.equal(unAddress, unAllocationAddress);
				unReleaseCalls++;

				if (Scenario.Cleanup.Mode === "THROW") {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				if (Scenario.Cleanup.Mode === "FALSE") {
					return false;
				}

				g_Assert.equal(Memory.Deallocate(unAddress), true);
				bReleased = true;

				if (Scenario.Cleanup.Mode === "THROW_AFTER") {
					ThrowFailure(Scenario.Cleanup.Value);
				}

				return (Scenario.Cleanup.Mode === "WRONG") ? undefined : true;
			},
		};

		// Preserve Error.prototype and instanceof while observing only diagnostics created by the example.
		const RecordedError = new Proxy(Error, {
			construct(Target, vecArguments) {
				const Failure = Reflect.construct(Target, vecArguments);
				vecFailures.push(Failure);

				return Failure;
			},
		});
		const Require = strName => (strName === "memory") ? Runtime : RequireDocumentation(strName);
		let bThrown = false;
		let CaughtValue = undefined;

		try {
			try {
				RunExample(Require, RecordedError);
			} catch (CaughtError) {
				bThrown = true;
				CaughtValue = CaughtError;
			}

			VerifyManagerFailureIdentity([...vecCleanupValues, ...vecUnexpectedValues], vecFailures, bThrown, CaughtValue, "Memory error documentation");
			g_Assert.equal(bThrown, !!Scenario.Allocation || ["THROW", "MISSING"].includes(Scenario.Mode) || (Scenario.Cleanup.Mode !== "NONE"));
			const unExpectedConstructors = ["THROW", "MISSING"].includes(Scenario.Mode) ? (Scenario.Target + 1) : unErrorTargetCount;
			g_Assert.equal(unConstructorCalls, bAllocated ? unExpectedConstructors : 0);
			g_Assert.equal(unReallocateCalls, (bAllocated && (unExpectedConstructors >= (unReallocateTargetIndex + 1))) ? 1 : 0);
			g_Assert.equal(unWriteCalls, (bAllocated && (unExpectedConstructors >= (unBooleanWriteTargetIndex + 1))) ? 1 : 0);
			g_Assert.equal(unReleaseCalls, bAllocated ? 1 : 0, "error-example cleanup must be attempted exactly once");
			g_Assert.equal(GetAllocationCount(), unAllocationsBefore + ((bAllocated && !bReleased) ? 1 : 0));
			unCaseCount++;
		} finally {
			if (bAllocated && !bReleased) {
				g_Assert.equal(Memory.Deallocate(unAllocationAddress), true);
			}

			g_Assert.equal(GetAllocationCount(), unAllocationsBefore);
		}
	};

	Context.RunScenario = RunScenario;
	for (let unBatchIndex = 0; unBatchIndex < vecCases.length; unBatchIndex += unCasesPerBatch) {
		Context.Scenarios = vecCases.slice(unBatchIndex, unBatchIndex + unCasesPerBatch);
		Script.runInContext(Context, { timeout: unExampleTimeoutMilliseconds });
	}

	g_Assert.equal(unCaseCount, 402);

	return unCaseCount;
}

try {
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		if (strRequestName === "keyvalues") {
			return g_KeyValuesModuleMock;
		}

		if (strRequestName === "memory/hooks/index") {
			return require(g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "memory", "hooks", "index.js"));
		}

		if (/^(?:memory|bitbuffers|filters|messages|filesystem|globals|paths)(?:\/|$)/.test(strRequestName)) {
			const vecPathParts = strRequestName.split("/");
			const strPackageRoot = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", ...vecPathParts);
			const strFilePath = `${strPackageRoot}.js`;
			if (g_FileSystem.existsSync(strFilePath)) {
				return require(strFilePath);
			}

			const strIndexPath = g_Path.join(strPackageRoot, "index.js");
			if (g_FileSystem.existsSync(strIndexPath)) {
				return require(strIndexPath);
			}
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_vecMemoryHelpersExports = Object.freeze([
		"Add",
		"ArrayView",
		"BaseAddress",
		"CALLING_CONVENTIONS",
		"Compare",
		"Copy",
		"DATA_TYPES",
		"DataKey",
		"Difference",
		"GetDataTypeSize",
		"IsNull",
		"KeyError",
		"MemberFunction",
		"Move",
		"NO_DEFAULT",
		"NormalizeConvention",
		"NormalizeDataType",
		"ADDRESS_SIZE",
		"ParseData",
		"Address",
		"Read",
		"ReadBool",
		"ReadDouble",
		"ReadFloat",
		"ReadInt",
		"ReadAddress",
		"ReadUInt",
		"SearchBytes",
		"SetProtection",
		"Subtract",
		"TYPE_SIZES",
		"Type",
		"VirtualFunction",
		"VirtualTable",
		"Write",
		"WriteBool",
		"WriteDouble",
		"WriteFloat",
		"WriteInt",
		"WriteAddress",
		"WriteUInt",
	].sort());

	const g_mapAllocations = new Map();
	const g_mapObjectTypes = new Map();
	let g_unNextAddress = 0x1000n;

	function CheckWorldObjectAllocationExamples(MemoryManager, Memory, MemoryHelpers, Mathlib) {
		class QAngle {
		}

		const unExecutionTimeoutMilliseconds = 1000;
		const strExampleSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js"), "utf8").replace(/\r\n/g, "\n");
		const vecImportProfiles = [
			{ ModuleName: "memory/manager", Exports: MemoryManager },
			{ ModuleName: "memory", Exports: Memory },
			{ ModuleName: "memory/helpers", Exports: MemoryHelpers },
			{ ModuleName: "mathlib", Exports: Mathlib },
		];
		for (const ImportProfile of vecImportProfiles) {
			const ImportExpression = new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*require\\("${ImportProfile.ModuleName}"\\);`, "g");
			const vecImports = [...strExampleSource.matchAll(ImportExpression)];
			g_Assert.equal(vecImports.length, 1, ImportProfile.ModuleName);
			for (const strBinding of vecImports[0][1].split(",").map((strValue) => strValue.trim()).filter(Boolean)) {
				const strExportName = strBinding.split(":")[0].trim();
				g_Assert.ok(Object.hasOwn(ImportProfile.Exports, strExportName), `World example imports absent ${ImportProfile.ModuleName}.${strExportName}`);
			}
		}

		const nCleanupStart = strExampleSource.indexOf("\nfunction UseCleanup(");
		const nCleanupEnd = strExampleSource.indexOf("\nfunction GetCommandArguments(", nCleanupStart);
		g_Assert.ok((nCleanupStart >= 0) && (nCleanupEnd > nCleanupStart));
		const strCleanupHelper = strExampleSource.slice(nCleanupStart, nCleanupEnd);
		const FlattenErrors = (ErrorValue) => Array.isArray(ErrorValue?.errors) ? Array.from(ErrorValue.errors).flatMap(FlattenErrors) : [ErrorValue];
		let unWorldMemoryScenarios = 0;
		for (const Fixture of [
			{ Label: "memory.MakeObject QAngle", Count: 1 },
			{ Label: "memory.CopyObjectToAddress/CopyAddressToObject QAngle", Count: 2 },
			{ Label: "memory.Address typed read/write", Count: 1, Typed: true },
			{ Label: "memory.MakeObject Color", Count: 1, Color: true },
			{ Label: "engines/precache.Model", Count: 1, Resource: true },
			{ Label: "memory/manager.Manager.CreateType", Count: 1, Managed: true },
			{ Label: "memory/manager.Manager.CreateType", Count: 1, Managed: true, Existing: true },
			{ Label: "memory/manager.Manager.DefineType", Count: 1, Managed: true, Manual: true },
			{ Label: "memory/manager.Manager.DefineType", Count: 1, Managed: true, Manual: true, Existing: true },
		]) {
			const strMarker = `LogResult("${Fixture.Label}", `;
			const nMarkerIndex = strExampleSource.indexOf(strMarker);
			g_Assert.ok(nMarkerIndex >= 0);
			g_Assert.equal(strExampleSource.indexOf(strMarker, nMarkerIndex + strMarker.length), -1);
			const nCallbackStart = nMarkerIndex + strMarker.length;
			const nCallbackEnd = strExampleSource.indexOf("\n\t});", nCallbackStart);
			g_Assert.ok(nCallbackEnd > nCallbackStart);
			const strCallback = strExampleSource.slice(nCallbackStart, nCallbackEnd + 3);
			const vecProfiles = [
				{},
				{ FailAllocation: 1 },
				{ FailBody: true },
				{ FailRelease: 1 },
			];
			if (Fixture.Count === 2) {
				vecProfiles.push({ FailAllocation: 2 }, { ThrowAllocation: 2 });
			}

			for (const BodyError of [undefined, null, false, 0, "opaque body error", Object.freeze(new Error("opaque body error"))]) {
				vecProfiles.push({ OpaqueBody: true, BodyError }, { OpaqueBody: true, BodyError, FailRelease: 1 }, { OpaqueBody: true, BodyError, ThrowRelease: 1 });

				if (Fixture.Count === 2) {
					vecProfiles.push({ OpaqueBody: true, BodyError, FailRelease: 2 }, { OpaqueBody: true, BodyError, FailReleases: [1, 2] }, { OpaqueBody: true, BodyError, ThrowRelease: 2 }, { ThrowAllocation: 2, OpaqueAllocation: true, AllocationError: BodyError, FailRelease: 1 });
				}
			}

			for (const Profile of vecProfiles) {
				const ReleaseError = Object.freeze(new Error("Native release outcome is unknown."));
				const mapAllocations = new Map();
				const vecAllocated = [];
				const vecReleased = [];
				let unAllocationCount = 0;
				const CreateValue = () => ({
					constructor: QAngle,
					X: 0,
					Y: 0,
					Z: 0,

					ConvertMathStructureToArray() {
						return [this.X, this.Y, this.Z];
					},

					CopyMathStructureFrom(Value) {
						Object.assign(this, { X: Value.X, Y: Value.Y, Z: Value.Z });

						return this;
					},
				});

				const Context = {
					QAngle,

					AllocateObject: (ObjectType) => {
						g_Assert.equal(ObjectType, QAngle);
						unAllocationCount += 1;
						if (unAllocationCount === Profile.ThrowAllocation) {
							if (Profile.OpaqueAllocation) {
								throw Profile.AllocationError;
							}

							throw new Error("Fixture allocation failed.");
						}

						if (unAllocationCount === Profile.FailAllocation) {
							return 0n;
						}

						const unAddress = 0x1000n + (BigInt(unAllocationCount) * 0x100n);
						mapAllocations.set(unAddress, CreateValue());
						vecAllocated.push(unAddress);

						return unAddress;
					},

					MakeObject: (ObjectType, unAddress) => {
						if (Fixture.Managed) {
							g_Assert.equal(typeof ObjectType, "function");

						} else {
							g_Assert.equal(ObjectType, Fixture.Color ? Context.Color : QAngle);
						}

						g_Assert.ok(mapAllocations.has(unAddress));

						if (Profile.OpaqueBody) {
							throw Profile.BodyError;
						}

						if (Profile.FailBody) {
							throw new Error("Fixture object view failed.");
						}

						const Value = mapAllocations.get(unAddress);
						if (Fixture.Color) {
							Object.assign(Value, {
								CopyColorFrom(ColorValue) {
									Object.assign(this, ColorValue);
								},

								GetColorAddress() {
									return unAddress;
								},

								ConvertColorToArray() {
									return [this.Red, this.Green, this.Blue, this.Alpha];
								},

								ConvertColorToHexString() {
									return `#${this.ConvertColorToArray().map((unComponent) => unComponent.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
								},
							});
						}

						return Value;
					},

					GetObjectAddress: (Value) => [...mapAllocations].find((vecEntry) => vecEntry[1] === Value)[0],

					CopyObjectToAddress(Value, unAddress) {
						mapAllocations.get(unAddress).CopyMathStructureFrom(Value);

						return unAddress;
					},

					CopyAddressToObject: (unAddress, Target) => ((typeof Target === "function") ? CreateValue() : Target).CopyMathStructureFrom(mapAllocations.get(unAddress)),

					Deallocate: (unAddress) => {
						vecReleased.push(unAddress);
						g_Assert.ok(mapAllocations.has(unAddress));

						if (vecReleased.length === Profile.ThrowRelease) {
							mapAllocations.delete(unAddress);
							throw ReleaseError;
						}

						if ((vecReleased.length === Profile.FailRelease) || Profile.FailReleases?.includes(vecReleased.length)) {
							return false;
						}

						return mapAllocations.delete(unAddress);
					},
				};

				Context.Allocate = (unByteCount) => {
					g_Assert.equal(unByteCount, Fixture.Color ? 4 : 8);

					return Context.AllocateObject(QAngle);
				};

				Context.COLOR_SIZE = 4;

				Context.Color = class {
				};

				Context.PURPLE = { CreateColorWithAlpha: (unAlpha) => ({ Red: 128, Green: 0, Blue: 128, Alpha: unAlpha }) };
				Context.Type = { Int: "int" };

				Context.GetServer = () => ({ IsServerActive: () => true, GetMapName: () => "fixture" });

				Context.PrecacheResourceError = class extends Error {
					constructor(strPath, strTableName) {
						super("Fixture missing resource.");
						this.ResourcePath = strPath;
						this.TableName = strTableName;
					}
				};

				Context.ModelPrecacheResource = class {
					constructor(strPath) {
						this.ResourcePath = strPath;
						this.Registered = true;
						this.ResourceIdentity = Context.AllocateObject(QAngle);
						if (this.ResourceIdentity === 0n) {
							throw new Error("Fixture resource acquisition failed.");
						}
					}

					GetPrecacheIndex() {
						if (Profile.OpaqueBody) {
							throw Profile.BodyError;
						}

						if (Profile.FailBody) {
							throw new Error("Fixture precache index failed.");
						}

						return 7;
					}

					Unload() {
						return Context.Deallocate(this.ResourceIdentity);
					}
				};

				Context.CustomType = class {
					constructor() {
						this.Address = Context.AllocateObject(QAngle);
						if (this.Address === 0n) {
							throw new Error("Fixture instance allocation failed.");
						}
					}

					static get TypeSize() {
						return 4;
					}

					get Value() {
						return mapAllocations.get(this.Address).Value;
					}

					set Value(nValue) {
						if (Profile.OpaqueBody) {
							throw Profile.BodyError;
						}

						if (Profile.FailBody) {
							throw new Error("Fixture instance write failed.");
						}

						mapAllocations.get(this.Address).Value = nValue;
					}

					Deallocate() {
						return Context.Deallocate(this.Address);
					}
				};

				const strTypeName = Fixture.Manual ? "SourceJSManualType" : "SourceJSExampleType";
				const CheckDescriptor = (TypeDescriptor) => {
					g_Assert.equal(TypeDescriptor.Size, 4);
					g_Assert.ok(Object.hasOwn(TypeDescriptor.Properties, "Value"));
				};

				Context.Manager = {
					GetClass: (strName) => {
						g_Assert.equal(strName, strTypeName);

						return Fixture.Existing ? Context.CustomType : null;
					},

					CreateType: (strName, TypeDescriptor) => {
						g_Assert.equal(strName, strTypeName);
						CheckDescriptor(TypeDescriptor);

						return Context.CustomType;
					},

					DefineType: (strName, TypeConstructor, TypeDescriptor) => {
						g_Assert.equal(strName, strTypeName);
						CheckDescriptor(TypeDescriptor);

						return TypeConstructor;
					},

					InstanceAttribute: (strType, nOffset) => {
						g_Assert.equal(strType, "int");
						g_Assert.equal(nOffset, 0n);

						return {};
					},
				};

				Context.Address = class {
					constructor(unAddress, bOwned) {
						g_Assert.equal(bOwned, true);
						this.Address = unAddress;
					}

					HasMemoryAddress() {
						return this.Address !== 0n;
					}

					SetInt(nValue, nOffset) {
						g_Assert.equal(nOffset, 0n);

						if (Profile.OpaqueBody) {
							throw Profile.BodyError;
						}

						if (Profile.FailBody) {
							throw new Error("Fixture typed write failed.");
						}

						mapAllocations.get(this.Address).Integer = nValue;
					}

					SetFloat(flValue, nOffset) {
						g_Assert.equal(nOffset, 0x4n);
						mapAllocations.get(this.Address).Float = flValue;
					}

					GetMemoryAddress() {
						return this.Address;
					}

					GetInt() {
						return mapAllocations.get(this.Address).Integer;
					}

					GetFloat(nOffset) {
						g_Assert.equal(nOffset, 0x4n);

						return mapAllocations.get(this.Address).Float;
					}

					Deallocate() {
						return Context.Deallocate(this.Address);
					}
				};

				let Result = null;
				let CaughtError = null;
				let bCaught = false;

				try {
					Result = g_VM.runInNewContext(`${strCleanupHelper}\n(${strCallback})()`, Context, { timeout: unExecutionTimeoutMilliseconds });
				} catch (ErrorValue) {
					bCaught = true;
					CaughtError = ErrorValue;
				}

				const bExpectedFailure = Boolean(Profile.FailAllocation || Profile.ThrowAllocation || Profile.FailBody || Profile.OpaqueBody || Profile.FailRelease || Profile.FailReleases || Profile.ThrowRelease);
				if (bExpectedFailure) {
					g_Assert.equal(bCaught, true, `${Fixture.Label} must report its failed operation`);
					const vecFailures = FlattenErrors(CaughtError);
					if (Profile.OpaqueBody || Profile.OpaqueAllocation) {
						g_Assert.equal(vecFailures[0], Profile.OpaqueBody ? Profile.BodyError : Profile.AllocationError, "Primary failure was replaced by cleanup");
					}

					if (Profile.ThrowRelease) {
						g_Assert.equal(vecFailures.at(-1), ReleaseError);
					}

					const unCleanupFailures = Number(Boolean(Profile.FailRelease)) + (Profile.FailReleases?.length ?? 0) + Number(Boolean(Profile.ThrowRelease));
					g_Assert.equal(vecFailures.length, Number(Boolean(Profile.FailAllocation || Profile.ThrowAllocation || Profile.FailBody || Profile.OpaqueBody)) + unCleanupFailures);

				} else {
					g_Assert.equal(bCaught, false);

					if (Fixture.Managed) {
						if (Fixture.Manual) {
							g_Assert.equal(Result.Value, 2026);
							g_Assert.equal(Result.Size, 4);
							g_Assert.equal(Result.ClassName, Fixture.Existing ? Context.CustomType.name : "SourceJSManualType");

						} else {
							g_Assert.equal(Result.InitialValue, 1337);
							g_Assert.equal(Result.LiveValue, 2026);
						}

					} else if (Fixture.Color) {
						g_Assert.deepEqual(Array.from(Result.Value), [0x80, 0x60, 0x80, 0xC0]);
						g_Assert.equal(Result.Hex, "#806080C0");

					} else if (Fixture.Resource) {
						g_Assert.equal(Result.Path, "maps/fixture.bsp");
						g_Assert.equal(Result.Registered, true);
						g_Assert.equal(Result.Index, 7);
						g_Assert.equal(Result.Error.Path, "models/sourcejs_missing.mdl");
						g_Assert.equal(Result.Error.TableName, "modelprecache");

					} else if (Fixture.Typed) {
						g_Assert.equal(Result.Integer, 2026);
						g_Assert.equal(Result.Float, 7.5);

					} else {
						g_Assert.deepEqual(Array.from((Fixture.Count === 1) ? Result.Value : Result.InitialCopy), (Fixture.Count === 1) ? [90, 45, 0] : [15, 30, 45]);
					}

					if (Fixture.Count === 2) {
						g_Assert.deepEqual(Array.from(Result.CopiedIntoObject), [60, 75, 90]);
					}
				}

				g_Assert.deepEqual(vecReleased, vecAllocated.slice().reverse(), `${Fixture.Label} must attempt every owned release in reverse acquisition order`);
				g_Assert.equal(mapAllocations.size, Array.from(vecReleased.keys()).filter((unIndex) => ((unIndex + 1) === Profile.FailRelease) || Profile.FailReleases?.includes(unIndex + 1)).length);
				unWorldMemoryScenarios += 1;
			}
		}

		console.log(`[world memory/resource examples] ${unWorldMemoryScenarios} allocation/opaque-error/cleanup scenarios; controlled memory/resource doubles, not native heap proof`);
	}

	function Allocate(unSize) {
		const arrBytes = Buffer.alloc(unSize);
		const unAddress = g_unNextAddress;
		g_unNextAddress += BigInt(unSize) + 0x100n;
		g_mapAllocations.set(unAddress, arrBytes);

		return unAddress;
	}

	function Deallocate(unAddress) {
		if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
			throw new TypeError("mock memory address must be a positive BigInt.");
		}

		if (!g_mapAllocations.delete(unAddress)) {
			throw new RangeError(`mock memory address is not allocated: ${unAddress}`);
		}

		return true;
	}

	function GetMemoryView(unAddress) {
		if ((typeof unAddress !== "bigint") || (unAddress < 0n)) {
			throw new TypeError("mock memory address must be a non-negative BigInt.");
		}

		for (const [unBaseAddress, arrBytes] of g_mapAllocations) {
			if ((unAddress >= unBaseAddress) && (unAddress < (unBaseAddress + BigInt(arrBytes.length)))) {
				return { Buffer: arrBytes, Offset: Number(unAddress - unBaseAddress) };
			}
		}

		throw new RangeError(`mock memory address is not allocated: ${unAddress}`);
	}

	function GetMemoryRange(unAddress, unSize) {
		const bSizeIsBigInteger = typeof unSize === "bigint";
		if ((!bSizeIsBigInteger && !Number.isSafeInteger(unSize)) || (unSize <= 0)) {
			throw new TypeError("mock memory range size must be a positive BigInt or safe integer Number");
		}

		const View = GetMemoryView(unAddress);
		const unRemainingByteCount = View.Buffer.length - View.Offset;
		if (unSize > unRemainingByteCount) {
			throw new RangeError(`mock memory range exceeds its allocation: ${unAddress} + ${unSize}`);
		}

		const unByteCount = Number(unSize);

		return {
			Buffer: View.Buffer,
			End: View.Offset + unByteCount,
			Offset: View.Offset,
		};
	}

	function RequireMockNumber(dblValue, strType) {
		if ((typeof dblValue !== "number") || !Number.isFinite(dblValue)) {
			throw new TypeError(`mock ${strType} value must be a finite number`);
		}

		return dblValue;
	}

	function RequireMockInteger(nValue, strType) {
		if (!Number.isSafeInteger(nValue)) {
			throw new TypeError(`mock ${strType} value must be a safe integer`);
		}

		return nValue;
	}

	function RequireMockBigInt(nValue, strType) {
		if (typeof nValue !== "bigint") {
			throw new TypeError(`mock ${strType} value must be a BigInt`);
		}

		return nValue;
	}

	function ReadMockString(unAddress) {
		const View = GetMemoryView(unAddress);
		let unEnd = View.Offset;
		while ((unEnd < View.Buffer.length) && (View.Buffer[unEnd] !== 0)) {
			++unEnd;
		}

		if (unEnd === View.Buffer.length) {
			throw new RangeError("mock string is not null terminated");
		}

		return View.Buffer.toString("utf8", View.Offset, unEnd);
	}

	// These scalar storage helpers model four-byte addresses and long values, not the host ABI.
	function Read(unAddress, strType, nOffset = 0) {
		const View = GetMemoryView(unAddress + BigInt(nOffset));

		switch (strType) {
			case "bool":
				return View.Buffer.readUInt8(View.Offset) !== 0;

			case "char":
				return View.Buffer.readInt8(View.Offset);

			case "double":
				return View.Buffer.readDoubleLE(View.Offset);

			case "float":
				return View.Buffer.readFloatLE(View.Offset);

			case "int":
				return View.Buffer.readInt32LE(View.Offset);

			case "long":
				return View.Buffer.readInt32LE(View.Offset);

			case "longlong":
				return View.Buffer.readBigInt64LE(View.Offset);

			case "address":
				return BigInt(View.Buffer.readUInt32LE(View.Offset));

			case "short":
				return View.Buffer.readInt16LE(View.Offset);

			case "string":
				return ReadMockString(unAddress + BigInt(nOffset));

			case "stringaddress": {
				const unStringAddress = BigInt(View.Buffer.readUInt32LE(View.Offset));
				return (unStringAddress === 0n) ? null : ReadMockString(unStringAddress);
			}

			case "uchar":
				return View.Buffer.readUInt8(View.Offset);

			case "uint":
				return View.Buffer.readUInt32LE(View.Offset);

			case "ulong":
				return View.Buffer.readUInt32LE(View.Offset);

			case "ulonglong":
				return View.Buffer.readBigUInt64LE(View.Offset);

			case "ushort":
				return View.Buffer.readUInt16LE(View.Offset);

			default:
				throw new TypeError(`unsupported mock read type: ${strType}`);
		}
	}

	function Write(unAddress, strType, DataValue, nOffset = 0) {
		const View = GetMemoryView(unAddress + BigInt(nOffset));

		switch (strType) {
			case "bool":
				if (typeof DataValue !== "boolean") {
					throw new TypeError("mock bool value must be a boolean");
				}

				View.Buffer.writeUInt8(DataValue ? 1 : 0, View.Offset);
				break;

			case "char":
				View.Buffer.writeInt8(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "double":
				View.Buffer.writeDoubleLE(RequireMockNumber(DataValue, strType), View.Offset);
				break;

			case "float": {
				const dblValue = RequireMockNumber(DataValue, strType);
				if ((dblValue < -g_dblMaximumMockFloat) || (dblValue > g_dblMaximumMockFloat)) {
					throw new RangeError("mock float value must fit a finite float");
				}

				View.Buffer.writeFloatLE(dblValue, View.Offset);
				break;
			}

			case "int":
				View.Buffer.writeInt32LE(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "long":
				View.Buffer.writeInt32LE(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "longlong":
				View.Buffer.writeBigInt64LE(RequireMockBigInt(DataValue, strType), View.Offset);
				break;

			case "address":
				if ((typeof DataValue !== "bigint") || (DataValue < 0n) || (DataValue > g_unMaximumMockAddress)) {
					throw new TypeError("mock address value must be a non-negative 32-bit BigInt");
				}

				View.Buffer.writeUInt32LE(Number(DataValue), View.Offset);
				break;

			case "short":
				View.Buffer.writeInt16LE(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "uchar":
				View.Buffer.writeUInt8(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "uint":
				View.Buffer.writeUInt32LE(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "ulong":
				View.Buffer.writeUInt32LE(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			case "ulonglong":
				View.Buffer.writeBigUInt64LE(RequireMockBigInt(DataValue, strType), View.Offset);
				break;

			case "ushort":
				View.Buffer.writeUInt16LE(RequireMockInteger(DataValue, strType), View.Offset);
				break;

			default:
				throw new TypeError(`unsupported mock write type: ${strType}`);
		}

		return true;
	}

	const g_dblHalfTurnDegrees = 180;
	const g_flDefaultMathTolerance = 0.000001;
	const g_flParallelAxisThreshold = 0.999;

	function CreateVectorResult(flX, flY, flZ) {
		return { X: flX, Y: flY, Z: flZ };
	}

	function GetVectorComponents(Value) {
		if (typeof Value === "number") {
			return [Value, Value, Value];
		}

		return [Value.X, Value.Y, Value.Z];
	}

	function CreateVectorRecord(vecComponents) {
		return CreateVectorResult(vecComponents[0], vecComponents[1], vecComponents[2]);
	}

	function CreateComponentRecord(vecComponents) {
		return { X: vecComponents[0], Y: vecComponents[1], Z: vecComponents[2] };
	}

	function ComputeVectorBinaryOperation(Left, Right, Operation) {
		const vecLeftComponents = GetVectorComponents(Left);
		const vecRightComponents = GetVectorComponents(Right);

		return CreateVectorRecord(vecLeftComponents.map((flValue, unIndex) => Operation(flValue, vecRightComponents[unIndex])));
	}

	function ComputeVectorLengthSquared(Value) {
		const [flX, flY, flZ] = GetVectorComponents(Value);

		return flX * flX + flY * flY + flZ * flZ;
	}

	function NormalizeVector(Value) {
		const vecComponents = GetVectorComponents(Value);
		const flLength = Math.sqrt(ComputeVectorLengthSquared(Value));
		if (flLength === 0) {
			return { Components: [0, 0, 0], Length: flLength };
		}

		return { Components: vecComponents.map((flComponent) => flComponent / flLength), Length: flLength };
	}

	function ComputeCrossComponents(Left, Right) {
		const [flLeftX, flLeftY, flLeftZ] = GetVectorComponents(Left);
		const [flRightX, flRightY, flRightZ] = GetVectorComponents(Right);

		return [flLeftY * flRightZ - flLeftZ * flRightY, flLeftZ * flRightX - flLeftX * flRightZ, flLeftX * flRightY - flLeftY * flRightX];
	}

	function ComputeAngleVectors(Value) {
		const [flPitchDegrees, flYawDegrees, flRollDegrees] = GetVectorComponents(Value);
		const flPitch = flPitchDegrees * Math.PI / g_dblHalfTurnDegrees;
		const flYaw = flYawDegrees * Math.PI / g_dblHalfTurnDegrees;
		const flRoll = flRollDegrees * Math.PI / g_dblHalfTurnDegrees;
		const flPitchSine = Math.sin(flPitch);
		const flPitchCosine = Math.cos(flPitch);
		const flYawSine = Math.sin(flYaw);
		const flYawCosine = Math.cos(flYaw);
		const flRollSine = Math.sin(flRoll);
		const flRollCosine = Math.cos(flRoll);

		return {
			Forward: {
				X: flPitchCosine * flYawCosine,
				Y: flPitchCosine * flYawSine,
				Z: -flPitchSine,
			},
			Right: {
				X: -flRollSine * flPitchSine * flYawCosine + flRollCosine * flYawSine,
				Y: -flRollSine * flPitchSine * flYawSine - flRollCosine * flYawCosine,
				Z: -flRollSine * flPitchCosine,
			},
			Up: {
				X: flRollCosine * flPitchSine * flYawCosine + flRollSine * flYawSine,
				Y: flRollCosine * flPitchSine * flYawSine - flRollSine * flYawCosine,
				Z: flRollCosine * flPitchCosine,
			},
		};
	}

	function ComputePerpendicularVectors(Value) {
		const vecForward = NormalizeVector(Value).Components;
		const vecReferenceUp = (Math.abs(vecForward[2]) < g_flParallelAxisThreshold) ? [0, 0, 1] : [0, 1, 0];
		const vecRight = NormalizeVector(CreateComponentRecord(ComputeCrossComponents(CreateComponentRecord(vecForward), CreateComponentRecord(vecReferenceUp)))).Components;
		const vecUp = NormalizeVector(CreateComponentRecord(ComputeCrossComponents(CreateComponentRecord(vecRight), CreateComponentRecord(vecForward)))).Components;

		return {
			Right: CreateComponentRecord(vecRight),
			Up: CreateComponentRecord(vecUp),
		};
	}

	function ComputeVectorAngles(Value, PseudoUp = null) {
		const vecNormalizedForward = NormalizeVector(Value).Components;
		const flHorizontalLength = Math.sqrt(vecNormalizedForward[0] * vecNormalizedForward[0] + vecNormalizedForward[1] * vecNormalizedForward[1]);
		const flPitch = Math.atan2(-vecNormalizedForward[2], flHorizontalLength);
		const flYaw = Math.atan2(vecNormalizedForward[1], vecNormalizedForward[0]);
		let flRoll = 0;

		if ((PseudoUp !== null) && (flHorizontalLength > Number.EPSILON)) {
			const vecRightComponents = NormalizeVector(CreateComponentRecord(ComputeCrossComponents(Value, PseudoUp))).Components;
			const vecUpComponents = NormalizeVector(CreateComponentRecord(ComputeCrossComponents(CreateComponentRecord(vecRightComponents), Value))).Components;

			flRoll = Math.atan2(-vecRightComponents[2], vecUpComponents[2]);
		}

		return { Pitch: flPitch * g_dblHalfTurnDegrees / Math.PI, Yaw: flYaw * g_dblHalfTurnDegrees / Math.PI, Roll: flRoll * g_dblHalfTurnDegrees / Math.PI };
	}

	function CreateQuaternionFromEuler(Value) {
		const [flX, flY, flZ] = GetVectorComponents(Value);
		const flXSine = Math.sin(flX / 2);
		const flXCosine = Math.cos(flX / 2);
		const flYSine = Math.sin(flY / 2);
		const flYCosine = Math.cos(flY / 2);
		const flZSine = Math.sin(flZ / 2);
		const flZCosine = Math.cos(flZ / 2);

		return {
			W: flXCosine * flYCosine * flZCosine + flXSine * flYSine * flZSine,
			X: flXSine * flYCosine * flZCosine - flXCosine * flYSine * flZSine,
			Y: flXCosine * flYSine * flZCosine + flXSine * flYCosine * flZSine,
			Z: flXCosine * flYCosine * flZSine - flXSine * flYSine * flZCosine,
		};
	}

	function CreateEulerFromQuaternion(Value) {
		const flXSine = 2 * (Value.W * Value.X + Value.Y * Value.Z);
		const flXCosine = 1 - 2 * (Value.X * Value.X + Value.Y * Value.Y);
		const flYSine = Math.max(-1, Math.min(1, 2 * (Value.W * Value.Y - Value.Z * Value.X)));
		const flZSine = 2 * (Value.W * Value.Z + Value.X * Value.Y);
		const flZCosine = 1 - 2 * (Value.Y * Value.Y + Value.Z * Value.Z);

		return { X: Math.atan2(flXSine, flXCosine), Y: Math.asin(flYSine), Z: Math.atan2(flZSine, flZCosine) };
	}

	function AssertApproximately(flActual, flExpected, strMessage, flTolerance = g_flDefaultMathTolerance) {
		g_Assert.ok(Math.abs(flActual - flExpected) <= flTolerance, `${strMessage}: expected ${flExpected}, received ${flActual}`);
	}

	function AssertArrayApproximately(vecActual, vecExpected, strMessage, flTolerance = g_flDefaultMathTolerance) {
		g_Assert.equal(vecActual.length, vecExpected.length, `${strMessage} length`);

		for (let unIndex = 0; unIndex < vecExpected.length; unIndex += 1) {
			AssertApproximately(vecActual[unIndex], vecExpected[unIndex], `${strMessage} component ${unIndex}`, flTolerance);
		}
	}

	function GetMarkdownAnchor(strHeading) {
		return strHeading.trim().toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-");
	}

	function DoesInlineCodeReferenceName(vecInlineCodeTokens, strName) {
		if (strName === "[Symbol.iterator]") {
			return vecInlineCodeTokens.some((strToken) => strToken.includes(strName));
		}

		return vecInlineCodeTokens.some((strToken) => {
			const vecIdentifiers = strToken.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];

			return vecIdentifiers.includes(strName);
		});
	}

	const g_Runtime = {
		FLOAT_SIZE: 0x4,
		MATRIX3X4_SIZE: 0x30,
		PLANE_SIZE: 0x14,
		QANGLE_SIZE: 0xC,
		QUATERNION_SIZE: 0x10,
		RADIAN_EULER_SIZE: 0xC,
		VECTOR_SIZE: 0xC,
		VMATRIX_SIZE: 0x40,

		GetDirectionVectorsFromAngle(Value) {
			return ComputeAngleVectors(Value);
		},

		ComputeVectorCrossProduct(Left, Right) {
			return CreateVectorRecord(ComputeCrossComponents(Left, Right));
		},

		ComputeVectorDistance(Left, Right) {
			return Math.sqrt(g_Runtime.ComputeVectorDistanceSquared(Left, Right));
		},

		ComputeVectorDistanceSquared(Left, Right) {
			const vecDifference = GetVectorComponents(Left).map((flValue, unIndex) => flValue - GetVectorComponents(Right)[unIndex]);

			return ComputeVectorLengthSquared(CreateComponentRecord(vecDifference));
		},

		ComputeVectorDotProduct(Left, Right) {
			const vecLeftComponents = GetVectorComponents(Left);
			const vecRightComponents = GetVectorComponents(Right);

			return vecLeftComponents.reduce((flResult, flValue, unIndex) => flResult + flValue * vecRightComponents[unIndex], 0);
		},

		IsVectorWithinBox(Value, FirstCorner, SecondCorner) {
			const vecComponents = GetVectorComponents(Value);
			const vecFirstComponents = GetVectorComponents(FirstCorner);
			const vecSecondComponents = GetVectorComponents(SecondCorner);

			return vecComponents.every((flComponent, unIndex) => (flComponent >= Math.min(vecFirstComponents[unIndex], vecSecondComponents[unIndex])) && (flComponent <= Math.max(vecFirstComponents[unIndex], vecSecondComponents[unIndex])));
		},

		GetVectorLength(Value) {
			return Math.sqrt(ComputeVectorLengthSquared(Value));
		},

		GetVectorLength2D(Value) {
			return Math.sqrt(g_Runtime.GetVectorLength2DSquared(Value));
		},

		GetVectorLength2DSquared(Value) {
			const [flX, flY] = GetVectorComponents(Value);

			return flX * flX + flY * flY;
		},

		GetVectorLengthSquared(Value) {
			return ComputeVectorLengthSquared(Value);
		},

		GetVectorMaximum(Left, Right) {
			return ComputeVectorBinaryOperation(Left, Right, Math.max);
		},

		GetVectorMinimum(Left, Right) {
			return ComputeVectorBinaryOperation(Left, Right, Math.min);
		},

		GetMatrix3x4Angles(vecMatrix) {
			return ComputeVectorAngles({ X: vecMatrix[0][0], Y: vecMatrix[1][0], Z: vecMatrix[2][0] }, { X: vecMatrix[0][2], Y: vecMatrix[1][2], Z: vecMatrix[2][2] });
		},

		CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position) {
			const vecXComponents = GetVectorComponents(XAxis);
			const vecYComponents = GetVectorComponents(YAxis);
			const vecZComponents = GetVectorComponents(ZAxis);
			const vecPositionComponents = GetVectorComponents(Position);

			return [
				[vecXComponents[0], vecYComponents[0], vecZComponents[0], vecPositionComponents[0]],
				[vecXComponents[1], vecYComponents[1], vecZComponents[1], vecPositionComponents[1]],
				[vecXComponents[2], vecYComponents[2], vecZComponents[2], vecPositionComponents[2]],
			];
		},

		CreateMatrix3x4FromVMatrix(vecMatrix) {
			return vecMatrix.slice(0, 3);
		},

		InvalidateMatrix3x4() {
			return Array.from({ length: 3 }, () => new Array(4).fill(Number.NaN));
		},

		GetMatrix3x4Position(vecMatrix) {
			return { X: vecMatrix[0][3], Y: vecMatrix[1][3], Z: vecMatrix[2][3] };
		},

		MultiplyAddVectors(First, Second, flScalar) {
			return CreateVectorRecord(GetVectorComponents(First).map((flValue, unIndex) => flValue + GetVectorComponents(Second)[unIndex] * flScalar));
		},

		NormalizeVector(Value) {
			const Result = NormalizeVector(Value);

			return { Length: Result.Length, ...CreateComponentRecord(Result.Components) };
		},

		ConvertRadianEulerToQuaternion(Value) {
			return CreateQuaternionFromEuler(Value);
		},

		ConvertQAngleToRadianEuler(Value) {
			const [flPitch, flYaw, flRoll] = GetVectorComponents(Value);
			const RadianResult = CreateEulerFromQuaternion(CreateQuaternionFromEuler({ X: flRoll * Math.PI / g_dblHalfTurnDegrees, Y: flPitch * Math.PI / g_dblHalfTurnDegrees, Z: flYaw * Math.PI / g_dblHalfTurnDegrees }));

			return CreateVectorResult(RadianResult.X, RadianResult.Y, RadianResult.Z);
		},

		ConvertQuaternionToRadianEuler(Value) {
			const Result = CreateEulerFromQuaternion(Value);

			return CreateVectorResult(Result.X, Result.Y, Result.Z);
		},

		ConvertRadianEulerToQAngle(Value) {
			const RadianResult = CreateEulerFromQuaternion(CreateQuaternionFromEuler(Value));

			return { Pitch: RadianResult.Y * g_dblHalfTurnDegrees / Math.PI, Yaw: RadianResult.Z * g_dblHalfTurnDegrees / Math.PI, Roll: RadianResult.X * g_dblHalfTurnDegrees / Math.PI };
		},

		AddVectors(Left, Right) {
			return ComputeVectorBinaryOperation(Left, Right, (flLeftValue, flRightValue) => flLeftValue + flRightValue);
		},

		GetAngleFromVector(Value, PseudoUp = null) {
			const Result = ComputeVectorAngles(Value, PseudoUp);

			return Result;
		},

		DivideVectors(Left, Right) {
			return ComputeVectorBinaryOperation(Left, Right, (flLeftValue, flRightValue) => flLeftValue / flRightValue);
		},

		IsVectorLengthGreaterThan(Value, flThreshold) {
			return ComputeVectorLengthSquared(Value) > (flThreshold * flThreshold);
		},

		IsVectorLengthLessThan(Value, flThreshold) {
			return ComputeVectorLengthSquared(Value) < (flThreshold * flThreshold);
		},

		IsVectorZero(Value, flTolerance) {
			return GetVectorComponents(Value).every((flComponent) => Math.abs(flComponent) <= flTolerance);
		},

		MultiplyVectors(Left, Right) {
			return ComputeVectorBinaryOperation(Left, Right, (flLeftValue, flRightValue) => flLeftValue * flRightValue);
		},

		NegateVector(Value) {
			return CreateVectorRecord(GetVectorComponents(Value).map((flComponent) => -flComponent));
		},

		CreateRandomVector(flMinimum, flMaximum) {
			// Deterministic fixture value; this does not test the native random distribution.
			const flMidpoint = (flMinimum + flMaximum) / 2;

			return CreateVectorResult(flMidpoint, flMidpoint, flMidpoint);
		},

		SubtractVectors(Left, Right) {
			return ComputeVectorBinaryOperation(Left, Right, (flLeftValue, flRightValue) => flLeftValue - flRightValue);
		},

		GetPerpendicularVectorsFromVector(Value) {
			return ComputePerpendicularVectors(Value);
		},

		GetVMatrixAngles(vecMatrix) {
			return ComputeVectorAngles({ X: vecMatrix[0][0], Y: vecMatrix[1][0], Z: vecMatrix[2][0] }, { X: vecMatrix[0][2], Y: vecMatrix[1][2], Z: vecMatrix[2][2] });
		},

		CreateVMatrixFromMatrix3x4(vecMatrix) {
			return [...vecMatrix, [0, 0, 0, 1]];
		},

		CreateIdentityVMatrix() {
			return [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1],
			];
		},

		GetVMatrixPosition(vecMatrix) {
			return { X: vecMatrix[0][3], Y: vecMatrix[1][3], Z: vecMatrix[2][3] };
		},
	};

	function GetMockMemoryAddress(unBaseAddress, nByteOffset = 0n, bAllowNull = false, bSubtractOffset = false) {
		if ((typeof unBaseAddress !== "bigint") || (unBaseAddress < 0n) || (unBaseAddress > g_unMaximumMockAddress) || (!bAllowNull && (unBaseAddress === 0n))) {
			throw new TypeError("mock memory base address must fit the selected 32-bit storage model");
		}

		const nNormalizedByteOffset = nByteOffset ?? 0n;
		if (typeof nNormalizedByteOffset !== "bigint") {
			throw new TypeError("mock native byte offset must be a BigInt");
		}

		const nMaximumOffset = (1n << 63n) - 1n;
		const nMinimumOffset = -(1n << 63n);
		if ((nNormalizedByteOffset < nMinimumOffset) || (nNormalizedByteOffset > nMaximumOffset)) {
			throw new RangeError("mock native byte offset must fit the signed 64-bit range");
		}

		const unAddress = bSubtractOffset ? (unBaseAddress - nNormalizedByteOffset) : (unBaseAddress + nNormalizedByteOffset);
		if ((unAddress < 0n) || (unAddress > g_unMaximumMockAddress)) {
			throw new RangeError("mock native address arithmetic overflow");
		}

		return unAddress;
	}

	const g_MemoryHelpers = {
		Add(unAddress, nByteOffset = 0n) {
			return GetMockMemoryAddress(unAddress, nByteOffset, true);
		},

		Read(unAddress, strType = "address", nByteOffset = 0n) {
			return Read(GetMockMemoryAddress(unAddress, nByteOffset), strType);
		},

		ReadFloat(unAddress, nByteOffset = 0n) {
			return Read(GetMockMemoryAddress(unAddress, nByteOffset), "float");
		},

		Write(unAddress, strType, DataValue, nByteOffset = 0n) {
			return Write(GetMockMemoryAddress(unAddress, nByteOffset), strType, DataValue);
		},

		WriteFloat(unAddress, flValue, nByteOffset = 0n) {
			return Write(GetMockMemoryAddress(unAddress, nByteOffset), "float", flValue);
		},
	};

	const g_MemoryModule = {
		Allocate,
		Deallocate,

		RegisterObjectType(strName, Constructor, Options) {
			g_mapObjectTypes.set(strName, { Constructor, Options });

			return true;
		},

		MakeObject(Constructor, unAddress) {
			if ((typeof Constructor !== "function") || (typeof Constructor.CreateFromAddress !== "function")) {
				throw new TypeError("mock memory constructor must provide CreateFromAddress(unAddress).");
			}

			return Constructor.CreateFromAddress(unAddress);
		},
	};

	function InstallDependency(strModulePath, Exports) {
		delete require.cache[strModulePath];
		require.cache[strModulePath] = {
			exports: Exports,
			filename: strModulePath,
			id: strModulePath,
			loaded: true,
		};
	}

	function TestMemoryHooksModule() {
		const BridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
		const vecCacheSnapshots = [g_strMemoryHooksPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
		const HookType = { Post: "post", Pre: "pre" };
		let bHooksDisabled = false;
		const HooksRuntime = {
			HookType,

			CallFunction() {
				return null;
			},

			GetHooksDisabled() {
				return bHooksDisabled;
			},

			GetHookList() {
				return [];
			},

			AddPostHook() {
				return false;
			},

			AddPreHook() {
				return false;
			},

			RemoveHook() {
				return false;
			},

			RemoveAllHooks() {
				return true;
			},

			SetHooksDisabled(bRequestedHooksDisabled) {
				g_Assert.equal(this, HooksRuntime, "memory/hooks SetHooksDisabled receiver");
				bHooksDisabled = bRequestedHooksDisabled;

				return bHooksDisabled;
			},
		};

		function RemoveHookCallback(vecCallbacks, Callback) {
			const nCallbackIndex = vecCallbacks.indexOf(Callback);
			if (nCallbackIndex === -1) {
				return false;
			}

			vecCallbacks.splice(nCallbackIndex, 1);

			return true;
		}

		function CreateHookHandle() {
			const vecPostCallbacks = [];
			const vecPreCallbacks = [];
			const HookHandle = {
				FailedRemovalCallback: null,
				RegistrationEnabled: true,

				Post(Callback) {
					g_Assert.equal(this, HookHandle, "MemoryHookDecorator Post receiver");

					if (!this.RegistrationEnabled) {
						return false;
					}

					vecPostCallbacks.push(Callback);

					return true;
				},

				Pre(Callback) {
					g_Assert.equal(this, HookHandle, "MemoryHookDecorator Pre receiver");

					if (!this.RegistrationEnabled) {
						return false;
					}

					vecPreCallbacks.push(Callback);

					return true;
				},

				RemovePost(Callback) {
					g_Assert.equal(this, HookHandle, "MemoryHookDecorator RemovePost receiver");

					if (Callback === this.FailedRemovalCallback) {
						return false;
					}

					return RemoveHookCallback(vecPostCallbacks, Callback);
				},

				RemovePre(Callback) {
					g_Assert.equal(this, HookHandle, "MemoryHookDecorator RemovePre receiver");

					if (Callback === this.FailedRemovalCallback) {
						return false;
					}

					return RemoveHookCallback(vecPreCallbacks, Callback);
				},
			};

			return { HookHandle, PostCallbacks: vecPostCallbacks, PreCallbacks: vecPreCallbacks };
		}

		try {
			Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "memory/hooks": HooksRuntime } });
			for (const CacheSnapshot of vecCacheSnapshots) {
				delete require.cache[CacheSnapshot.Path];
			}

			const MemoryHooks = require(g_strMemoryHooksPath);
			const FirstHookFixture = CreateHookHandle();
			const FirstCallback = function FirstCallback() {
			};

			const SecondCallback = function SecondCallback() {
			};

			const Decorator = new MemoryHooks.MemoryHookDecorator(FirstHookFixture.HookHandle, MemoryHooks.HookType.Pre, FirstCallback);

			g_Assert.equal(MemoryHooks, HooksRuntime, "memory/hooks exports the exact native runtime");
			g_Assert.equal(MemoryHooks.HookType, HookType, "memory/hooks preserves the native HookType identity");
			g_Assert.equal(Object.isFrozen(MemoryHooks.HookType), true, "memory/hooks freezes HookType");
			g_Assert.deepEqual(FirstHookFixture.PreCallbacks, [FirstCallback], "MemoryHookDecorator initial registration");

			FirstHookFixture.HookHandle.RegistrationEnabled = false;
			g_Assert.throws(() => Decorator.Register(SecondCallback), /register/, "MemoryHookDecorator failed replacement registration");
			g_Assert.deepEqual(FirstHookFixture.PreCallbacks, [FirstCallback], "MemoryHookDecorator retains the previous callback");

			FirstHookFixture.HookHandle.RegistrationEnabled = true;
			FirstHookFixture.HookHandle.FailedRemovalCallback = FirstCallback;
			g_Assert.throws(() => Decorator.Register(SecondCallback), /previous/, "MemoryHookDecorator failed previous removal");
			g_Assert.deepEqual(FirstHookFixture.PreCallbacks, [FirstCallback], "MemoryHookDecorator rolls back its replacement");

			FirstHookFixture.HookHandle.FailedRemovalCallback = null;
			g_Assert.equal(Decorator.Register(SecondCallback), SecondCallback, "MemoryHookDecorator replacement result");
			g_Assert.deepEqual(FirstHookFixture.PreCallbacks, [SecondCallback], "MemoryHookDecorator replacement state");

			const ReplacementHookFixture = CreateHookHandle();
			Decorator.Hook = ReplacementHookFixture.HookHandle;
			Decorator.HookType = MemoryHooks.HookType.Post;
			g_Assert.equal(Decorator.Dispose(), true, "MemoryHookDecorator captured disposal");
			g_Assert.deepEqual(FirstHookFixture.PreCallbacks, [], "MemoryHookDecorator removes the captured callback");
			g_Assert.deepEqual(ReplacementHookFixture.PostCallbacks, [], "MemoryHookDecorator ignores edited ownership fields");

			const RetryCallback = function RetryCallback() {
			};

			const RetryDecorator = new MemoryHooks.PreHook(FirstHookFixture.HookHandle, RetryCallback);

			FirstHookFixture.HookHandle.FailedRemovalCallback = RetryCallback;
			g_Assert.equal(RetryDecorator.Dispose(), false, "MemoryHookDecorator failed disposal result");
			g_Assert.equal(RetryDecorator.Callback, RetryCallback, "MemoryHookDecorator failed disposal ownership");
			FirstHookFixture.HookHandle.FailedRemovalCallback = null;
			g_Assert.equal(RetryDecorator.Dispose(), true, "MemoryHookDecorator disposal retry");

			const ReplacementCreateFunction = function ReplacementCreateFunction() {
			};

			HooksRuntime.CreateFunctionHook = ReplacementCreateFunction;
			g_Assert.equal(MemoryHooks.CreateFunctionHook, ReplacementCreateFunction, "memory/hooks exposes live native methods");
			g_Assert.equal(MemoryHooks.WithHooksDisabled(() => bHooksDisabled, true), true, "WithHooksDisabled callback state");
			g_Assert.equal(bHooksDisabled, false, "WithHooksDisabled restoration");

			const CallbackError = new Error("memory hook callback failed");
			g_Assert.throws(
				() => MemoryHooks.WithHooksDisabled(() => {
					throw CallbackError;
				}, true),
				(ErrorValue) => ErrorValue === CallbackError,
				"WithHooksDisabled callback error identity",
			);
			g_Assert.equal(bHooksDisabled, false, "WithHooksDisabled callback-error restoration");

			let unSetDisabledCallCount = 0;
			HooksRuntime.SetHooksDisabled = function SetHooksDisabled(bRequestedHooksDisabled) {
				unSetDisabledCallCount += 1;

				if (unSetDisabledCallCount === 2) {
					throw new Error("memory hook restoration failed");
				}

				bHooksDisabled = bRequestedHooksDisabled;

				return bHooksDisabled;
			};

			g_Assert.throws(
				() => MemoryHooks.WithHooksDisabled(() => {
					throw CallbackError;
				}, true),
				(ErrorValue) => (ErrorValue instanceof AggregateError)
					&& (ErrorValue.errors[0] === CallbackError)
					&& /restoration failed/.test(ErrorValue.errors[1].message),
				"WithHooksDisabled aggregate failure",
			);
		} finally {
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

	TestMemoryHooksModule();

	const g_strMemoryHooksDocumentation = g_FileSystem.readFileSync(g_strMemoryHooksDocumentationPath, "utf8");
	const g_vecMemoryHooksJavaScriptBlocks = [];

	for (const vecMatch of g_strMemoryHooksDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecMemoryHooksJavaScriptBlocks.push(vecMatch[1]);
	}

	g_Assert.equal(g_vecMemoryHooksJavaScriptBlocks.length, 20, "memory/hooks documentation JavaScript block count");

	for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMemoryHooksJavaScriptBlocks.entries()) {
		new g_VM.Script(`"use strict";\n(() => {\n${strDocumentationBlock}\n})();`, { filename: `memory-hooks-doc-${unDocumentationBlockIndex + 1}.js` });
	}

	function CheckNativeMathlibBindingNames() {
		const strNativeBindingsSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
		const NativePropertyPattern = /Set(?:Function|Integer)\([^\r\n]*\bLocalMathLibraryModule,\s*"([^"]+)"/g;
		const setNativeProperties = new Set(Array.from(strNativeBindingsSource.matchAll(NativePropertyPattern), vecMatch => vecMatch[1]));
		g_Assert.ok(setNativeProperties.has("FLOAT_SIZE"), "the actual native mathlib registration must be found");

		for (const strPropertyName of Object.keys(g_Runtime)) {
			g_Assert.ok(setNativeProperties.has(strPropertyName), "the mathlib double must expose an actual native property: " + strPropertyName);
		}

		const strPackageSource = g_FileSystem.readFileSync(g_strMathlibPath, "utf8");
		for (const vecPropertyMatch of strPackageSource.matchAll(/\bg_MathlibRuntime\.([A-Za-z][A-Za-z0-9]*)/g)) {
			g_Assert.ok(setNativeProperties.has(vecPropertyMatch[1]), "the package must call an actual native property: " + vecPropertyMatch[1]);
		}
	}

	function InstallNativeBridge(Modules) {
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, value: Modules, writable: true });
	}

	function LoadMathlib() {
		delete require.cache[g_strMathlibPath];
		InstallNativeBridge({ mathlib: g_Runtime });

		InstallDependency(g_strMemoryPath, g_MemoryModule);
		InstallDependency(g_strMemoryHelpersPath, g_MemoryHelpers);

		return require(g_strMathlibPath);
	}

	function CheckNativeMathlibDefaults() {
		const Mathlib = LoadMathlib();
		g_Assert.deepEqual(Mathlib.GetRandomVector(), { X: 0.5, Y: 0.5, Z: 0.5 });
		g_Assert.deepEqual(Mathlib.GetRandomVector(undefined, 2), { X: 1, Y: 1, Z: 1 });
		g_Assert.equal(Mathlib.IsVectorZero({ X: 0, Y: 0, Z: 0 }), true);
		g_Assert.equal(Mathlib.IsVectorZero({ X: 0, Y: 0, Z: 0 }, undefined), true);
	}

	function CheckNativeRadianEulerComponentOrder() {
		const Mathlib = LoadMathlib();
		const flComponentTolerance = 0.0001;
		const RadianAngles = Mathlib.ConvertQAngleToRadianEuler({ X: 30, Y: 60, Z: 90 });
		const vecExpectedRadianComponents = [Math.PI / 2, Math.PI / 6, Math.PI / 3];
		for (const [unComponentIndex, strComponentName] of ["X", "Y", "Z"].entries()) {
			g_Assert.ok(Math.abs(RadianAngles[strComponentName] - vecExpectedRadianComponents[unComponentIndex]) <= flComponentTolerance, "SDK RadianEuler component order must be roll/pitch/yaw: " + strComponentName);
		}

		const DegreeAngles = Mathlib.ConvertRadianEulerToQAngle({ X: Math.PI / 6, Y: Math.PI / 3, Z: Math.PI / 2 });
		const vecExpectedDegreeComponents = [60, 90, 30];
		for (const [unComponentIndex, strComponentName] of ["X", "Y", "Z"].entries()) {
			g_Assert.ok(Math.abs(DegreeAngles[strComponentName] - vecExpectedDegreeComponents[unComponentIndex]) <= flComponentTolerance, "SDK QAngle component order must be pitch/yaw/roll: " + strComponentName);
		}

		const YawQuaternion = new Mathlib.Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2);
		const YawRadians = Mathlib.ConvertQuaternionToRadianEuler(YawQuaternion);
		g_Assert.ok(Math.abs(YawRadians.X) <= flComponentTolerance);
		g_Assert.ok(Math.abs(YawRadians.Y) <= flComponentTolerance);
		g_Assert.ok(Math.abs(YawRadians.Z - (Math.PI / 2)) <= flComponentTolerance);
		const ConvertedYawQuaternion = Mathlib.Quaternion.CreateQuaternionFromRadianEuler(new Mathlib.RadianEuler(new Mathlib.QAngle(0, 90, 0)));
		g_Assert.ok(Math.abs(ConvertedYawQuaternion.X) <= flComponentTolerance);
		g_Assert.ok(Math.abs(ConvertedYawQuaternion.Y) <= flComponentTolerance);
		g_Assert.ok(Math.abs(ConvertedYawQuaternion.Z - Math.SQRT1_2) <= flComponentTolerance);
		g_Assert.ok(Math.abs(ConvertedYawQuaternion.W - Math.SQRT1_2) <= flComponentTolerance);
	}

	function CheckNativeQAngleOutputShape() {
		const strBindings = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
		const vecRecordMatch = /\n(\t+)v8::Local<v8::Object> MakeQAngleObject\([^\r\n]+\) \{/.exec(strBindings);
		g_Assert.ok(vecRecordMatch, "the actual native QAngle record builder must exist");
		const nRecordStart = vecRecordMatch.index;
		const strRecordClosingLine = "\n" + vecRecordMatch[1] + "}";
		const nRecordEnd = strBindings.indexOf(strRecordClosingLine, nRecordStart + vecRecordMatch[0].length);
		g_Assert.ok(nRecordEnd > nRecordStart);
		const strRecordBody = strBindings.slice(nRecordStart, nRecordEnd + strRecordClosingLine.length);
		const vecNativeProperties = Array.from(strRecordBody.matchAll(/SetRecordProperty\([^\r\n]*,\s*"([^"]+)"/g), vecMatch => vecMatch[1]);
		g_Assert.deepEqual(vecNativeProperties, ["Pitch", "Yaw", "Roll"], "fixture fields must match the actual C++ record builder");

		const Mathlib = LoadMathlib();
		const vecIdentityMatrixRows = [
			[1, 0, 0, 0],
			[0, 1, 0, 0],
			[0, 0, 1, 0],
		];
		const vecNativeAngleSources = [
			() => g_Runtime.GetAngleFromVector({ X: 1, Y: 0, Z: 0 }),
			() => g_Runtime.ConvertRadianEulerToQAngle({ X: 0, Y: 0, Z: 0 }),
			() => g_Runtime.GetMatrix3x4Angles(vecIdentityMatrixRows),
			() => g_Runtime.GetVMatrixAngles([...vecIdentityMatrixRows, [0, 0, 0, 1]]),
		];
		for (const NativeAngleSource of vecNativeAngleSources) {
			const NativeAngle = NativeAngleSource();
			g_Assert.deepEqual(Object.keys(NativeAngle), ["Pitch", "Yaw", "Roll"], "the native double must match MakeQAngleObject fields");
			for (const strComponentName of ["Pitch", "Yaw", "Roll"]) {
				g_Assert.equal(typeof Object.getOwnPropertyDescriptor(NativeAngle, strComponentName).value, "number");
			}
		}

		const vecPublicAngleSources = [
			() => Mathlib.ConvertVectorToQAngle({ X: 1, Y: 0, Z: 0 }),
			() => Mathlib.ConvertRadianEulerToQAngle({ X: 0, Y: 0, Z: 0 }),
			() => Mathlib.GetMatrix3x4Angles(vecIdentityMatrixRows),
			() => Mathlib.GetVMatrixAngles([...vecIdentityMatrixRows, [0, 0, 0, 1]]),
		];
		for (const PublicAngleSource of vecPublicAngleSources) {
			const PublicAngle = PublicAngleSource();
			g_Assert.deepEqual(Object.keys(PublicAngle), ["X", "Y", "Z"], "public QAngle records keep the documented X/Y/Z contract");
			g_Assert.ok((PublicAngle.X === 0) && (PublicAngle.Y === 0) && (PublicAngle.Z === 0), "native signed zero is a valid zero component");
		}

		const vecClassAngles = [
			new Mathlib.Vector(1, 0, 0).ConvertVectorToQAngle(),
			new Mathlib.RadianEuler().ConvertRadianEulerToQAngle(),
			new Mathlib.Matrix3x4(vecIdentityMatrixRows).Angles,
			new Mathlib.VMatrix([...vecIdentityMatrixRows, [0, 0, 0, 1]]).Angles,
		];
		for (const ClassAngle of vecClassAngles) {
			g_Assert.ok(ClassAngle instanceof Mathlib.QAngle);
			const vecComponents = ClassAngle.ConvertMathStructureToArray();
			g_Assert.equal(vecComponents.length, 3);
			g_Assert.ok(vecComponents.every(flComponent => flComponent === 0));
		}
	}

	function CheckNativeFloatStructureContract() {
		const unMatrixColumnCount = 4;

		const OriginalRead = g_MemoryHelpers.Read;
		const OriginalReadFloat = g_MemoryHelpers.ReadFloat;
		const OriginalWriteFloat = g_MemoryHelpers.WriteFloat;
		const OriginalWrite = g_MemoryHelpers.Write;
		const OriginalIsVectorWithinBox = g_Runtime.IsVectorWithinBox;
		const OriginalInvalidateMatrix3x4 = g_Runtime.InvalidateMatrix3x4;
		const OriginalCreateIdentityVMatrix = g_Runtime.CreateIdentityVMatrix;
		const vecNativeOffsets = [];
		let unAddress = 0n;
		let unPlaneAddress = 0n;
		let unMatrixAddress = 0n;
		let unVMatrixAddress = 0n;

		try {
			const RequireNativeOffset = (nAddressOffset) => {
				if (typeof nAddressOffset !== "bigint") {
					throw new TypeError("Native memory helpers require a BigInt offset.");
				}

				vecNativeOffsets.push(nAddressOffset);
			};

			g_MemoryHelpers.Read = (unBaseAddress, strDataType, nAddressOffset = 0n) => {
				RequireNativeOffset(nAddressOffset);

				return OriginalRead(unBaseAddress, strDataType, nAddressOffset);
			};

			g_MemoryHelpers.ReadFloat = (unBaseAddress, nAddressOffset = 0n) => {
				RequireNativeOffset(nAddressOffset);

				return OriginalReadFloat(unBaseAddress, nAddressOffset);
			};

			g_MemoryHelpers.WriteFloat = (unBaseAddress, flValue, nAddressOffset = 0n) => {
				RequireNativeOffset(nAddressOffset);

				if (!Number.isFinite(flValue)) {
					throw new TypeError("Native float writes require a finite value.");
				}

				return OriginalWriteFloat(unBaseAddress, flValue, nAddressOffset);
			};

			g_MemoryHelpers.Write = (unBaseAddress, strDataType, DataValue, nAddressOffset = 0n) => {
				RequireNativeOffset(nAddressOffset);

				return OriginalWrite(unBaseAddress, strDataType, DataValue, nAddressOffset);
			};

			const Mathlib = LoadMathlib();
			const vecPublicStructureTypes = [
				Mathlib.Vector,
				Mathlib.QAngle,
				Mathlib.Quaternion,
				Mathlib.RadianEuler,
				Mathlib.Plane,
				Mathlib.Matrix3x4,
				Mathlib.VMatrix,
			];
			for (const StructureType of vecPublicStructureTypes) {
				g_Assert.deepEqual(Object.getOwnPropertyDescriptor(StructureType, "TYPE_SIZE"), { configurable: true, enumerable: true, value: StructureType.TYPE_SIZE, writable: true });
			}

			const vecDeclaredStructureTypes = [
				Mathlib.Vector,
				Mathlib.QAngle,
				Mathlib.Quaternion,
				Mathlib.RadianEuler,
				Mathlib.Plane,
				Mathlib.Matrix3x4,
				Mathlib.VMatrix,
				Object.getPrototypeOf(Mathlib.Vector),
				Object.getPrototypeOf(Mathlib.Quaternion),
				Object.getPrototypeOf(Mathlib.Matrix3x4),
			];
			for (const StructureType of vecDeclaredStructureTypes) {
				let bAccessorSeen = false;
				for (const strMemberName of Object.getOwnPropertyNames(StructureType.prototype)) {
					// Selected-SDK capabilities are installed conditionally after their class declarations.
					if (((StructureType === Mathlib.Vector) && (strMemberName === "IsVectorWithinBox")) || ((StructureType === Mathlib.Matrix3x4) && (strMemberName === "InvalidateMatrix3x4")) || ((StructureType === Mathlib.VMatrix) && (strMemberName === "SetIdentityVMatrix"))) {
						continue;
					}

					const Descriptor = Object.getOwnPropertyDescriptor(StructureType.prototype, strMemberName);
					if ((typeof Descriptor.get === "function") || (typeof Descriptor.set === "function")) {
						bAccessorSeen = true;

					} else {
						g_Assert.equal(bAccessorSeen, false, `${StructureType.name}.${strMemberName}: declared operations precede accessors`);
					}
				}
			}

			if (typeof Mathlib.IsVectorWithinBox === "function") {
				const MinimumCorner = new Mathlib.Vector(0, 0, 0);
				const MaximumCorner = new Mathlib.Vector(4, 4, 4);
				const InsideVector = new Mathlib.Vector(1, 2, 3);
				const OutsideVector = new Mathlib.Vector(8, 2, 3);
				g_Assert.equal(Mathlib.IsVectorWithinBox(InsideVector, MinimumCorner, MaximumCorner), true);
				g_Assert.equal(InsideVector.IsVectorWithinBox(MinimumCorner, MaximumCorner), true);
				g_Assert.equal(OutsideVector.IsVectorWithinBox(MinimumCorner, MaximumCorner), false);
			}

			unAddress = Allocate(Mathlib.VECTOR_SIZE);
			g_Assert.notEqual(unAddress, 0n, "native-float regression uses an attached allocation");
			const VectorValue = Mathlib.Vector.CreateFromAddress(unAddress);
			g_Assert.strictEqual(VectorValue.InitializeMathStructure(1, 2, 3), VectorValue);
			g_Assert.deepEqual(VectorValue.ConvertMathStructureToArray(), [1, 2, 3]);
			g_Assert.strictEqual(VectorValue.InvalidateMathStructure(), VectorValue);
			g_Assert.equal(VectorValue.IsMathStructureValid(), false);
			g_Assert.equal(VectorValue.ConvertMathStructureToArray().every(Number.isNaN), true);
			g_Assert.deepEqual(new Set(vecNativeOffsets), new Set([0n, BigInt(Mathlib.FLOAT_SIZE), BigInt(2 * Mathlib.FLOAT_SIZE)]));
			g_Assert.throws(() => g_MemoryHelpers.WriteFloat(unAddress, Number.NaN, 0n), /finite value/);

			vecNativeOffsets.length = 0;
			unPlaneAddress = Allocate(Mathlib.PLANE_SIZE);
			g_Assert.notEqual(unPlaneAddress, 0n, "native-plane regression uses an attached allocation");
			const PlaneValue = Mathlib.Plane.CreateFromAddress(unPlaneAddress);
			PlaneValue.Normal = { X: 1, Y: 2, Z: 3 };
			PlaneValue.Distance = 4.5;
			PlaneValue.Type = 2;
			PlaneValue.SignBits = 0x3;
			g_Assert.deepEqual(PlaneValue.Normal.ConvertMathStructureToArray(), [1, 2, 3]);
			g_Assert.equal(PlaneValue.Distance, 4.5);
			g_Assert.equal(PlaneValue.Type, 2);
			g_Assert.equal(PlaneValue.SignBits, 0x3);
			g_Assert.strictEqual(PlaneValue.InvalidatePlane(), PlaneValue);
			g_Assert.equal(PlaneValue.IsPlaneValid(), false);
			g_Assert.equal(PlaneValue.Normal.ConvertMathStructureToArray().every(Number.isNaN), true);
			g_Assert.equal(Number.isNaN(PlaneValue.Distance), true);
			g_Assert.equal(PlaneValue.Type, 0);
			g_Assert.equal(PlaneValue.SignBits, 0);
			g_Assert.deepEqual(new Set(vecNativeOffsets), new Set([
				0n,
				BigInt(Mathlib.FLOAT_SIZE),
				BigInt(2 * Mathlib.FLOAT_SIZE),
				BigInt(Mathlib.VECTOR_SIZE),
				BigInt(Mathlib.VECTOR_SIZE + Mathlib.FLOAT_SIZE),
				BigInt(Mathlib.VECTOR_SIZE + Mathlib.FLOAT_SIZE + 0x1),
			]));

			unMatrixAddress = Allocate(Mathlib.MATRIX3X4_SIZE);
			g_Assert.notEqual(unMatrixAddress, 0n, "native-matrix regression uses an attached allocation");
			const MatrixValue = Mathlib.Matrix3x4.CreateFromAddress(unMatrixAddress);
			const vecExpectedRows = [];
			for (let unRowIndex = 0; unRowIndex < MatrixValue.RowCount; unRowIndex += 1) {
				const vecExpectedRow = [];
				for (let unColumnIndex = 0; unColumnIndex < unMatrixColumnCount; unColumnIndex += 1) {
					const flValue = unRowIndex * unMatrixColumnCount + unColumnIndex + 0.5;
					g_Assert.strictEqual(MatrixValue.SetMatrixComponent(unRowIndex, unColumnIndex, flValue), MatrixValue);
					vecExpectedRow.push(flValue);
				}

				vecExpectedRows.push(vecExpectedRow);
			}

			g_Assert.deepEqual(MatrixValue.ConvertMatrixToArray(), vecExpectedRows);
			g_Assert.equal(MatrixValue[1][2], vecExpectedRows[1][2]);
			const DetachedMatrix = MatrixValue.CopyMathStructure();
			g_Assert.equal(DetachedMatrix.Address, 0n);
			g_Assert.deepEqual(DetachedMatrix.ConvertMatrixToArray(), vecExpectedRows);

			if (typeof MatrixValue.InvalidateMatrix3x4 === "function") {
				g_Assert.strictEqual(MatrixValue.InvalidateMatrix3x4(), MatrixValue);
				g_Assert.equal(MatrixValue.IsMathStructureValid(), false);
				g_Assert.equal(MatrixValue.ConvertMatrixToArray().flat().every(Number.isNaN), true);
				g_Assert.strictEqual(DetachedMatrix.InvalidateMatrix3x4(), DetachedMatrix);
				g_Assert.equal(DetachedMatrix.IsMathStructureValid(), false);
				g_Assert.equal(DetachedMatrix.ConvertMatrixToArray().flat().every(Number.isNaN), true);
			}

			vecNativeOffsets.length = 0;
			unVMatrixAddress = Allocate(Mathlib.VMATRIX_SIZE);
			g_Assert.notEqual(unVMatrixAddress, 0n, "native-vmatrix regression uses an attached allocation");
			const VMatrixValue = Mathlib.VMatrix.CreateFromAddress(unVMatrixAddress);
			const vecExpectedVMatrixRows = [];
			const vecExpectedVMatrixOffsets = [];
			for (let unRowIndex = 0; unRowIndex < VMatrixValue.RowCount; unRowIndex += 1) {
				const vecExpectedRow = [];
				for (let unColumnIndex = 0; unColumnIndex < unMatrixColumnCount; unColumnIndex += 1) {
					const flValue = unRowIndex * unMatrixColumnCount + unColumnIndex + 0.25;
					g_Assert.strictEqual(VMatrixValue.SetMatrixComponent(unRowIndex, unColumnIndex, flValue), VMatrixValue);
					vecExpectedRow.push(flValue);
					vecExpectedVMatrixOffsets.push(BigInt((unRowIndex * unMatrixColumnCount + unColumnIndex) * Mathlib.FLOAT_SIZE));
				}

				vecExpectedVMatrixRows.push(vecExpectedRow);
			}

			g_Assert.deepEqual(VMatrixValue.ConvertMatrixToArray(), vecExpectedVMatrixRows);
			const DetachedVMatrix = new Mathlib.VMatrix();
			g_Assert.strictEqual(VMatrixValue.CopyVMatrixTo(DetachedVMatrix), DetachedVMatrix);
			g_Assert.equal(DetachedVMatrix.Address, 0n);
			g_Assert.deepEqual(DetachedVMatrix.ConvertMatrixToArray(), vecExpectedVMatrixRows);
			g_Assert.deepEqual(new Set(vecNativeOffsets), new Set(vecExpectedVMatrixOffsets));

			if (typeof VMatrixValue.SetIdentityVMatrix === "function") {
				g_Assert.strictEqual(VMatrixValue.SetIdentityVMatrix(), VMatrixValue);
				g_Assert.deepEqual(VMatrixValue.ConvertMatrixToArray(), [
					[1, 0, 0, 0],
					[0, 1, 0, 0],
					[0, 0, 1, 0],
					[0, 0, 0, 1],
				]);
			}

			g_Runtime.IsVectorWithinBox = undefined;
			g_Runtime.InvalidateMatrix3x4 = undefined;
			g_Runtime.CreateIdentityVMatrix = undefined;
			const ReducedMathlib = LoadMathlib();
			g_Assert.equal("IsVectorWithinBox" in ReducedMathlib, false);
			g_Assert.equal("IsVectorWithinBox" in ReducedMathlib.Vector.prototype, false);
			g_Assert.equal("InvalidateMatrix3x4" in ReducedMathlib, false);
			g_Assert.equal("InvalidateMatrix3x4" in ReducedMathlib.Matrix3x4.prototype, false);
			g_Assert.equal("CreateIdentityVMatrix" in ReducedMathlib, false);
			g_Assert.equal("SetIdentityVMatrix" in ReducedMathlib.VMatrix.prototype, false);
		} finally {
			g_MemoryHelpers.Read = OriginalRead;
			g_MemoryHelpers.ReadFloat = OriginalReadFloat;
			g_MemoryHelpers.WriteFloat = OriginalWriteFloat;
			g_MemoryHelpers.Write = OriginalWrite;
			g_Runtime.IsVectorWithinBox = OriginalIsVectorWithinBox;
			g_Runtime.InvalidateMatrix3x4 = OriginalInvalidateMatrix3x4;
			g_Runtime.CreateIdentityVMatrix = OriginalCreateIdentityVMatrix;

			for (const unOwnedAddress of [unAddress, unPlaneAddress, unMatrixAddress, unVMatrixAddress]) {
				if (unOwnedAddress !== 0n) {
					g_Assert.equal(Deallocate(unOwnedAddress), true);
				}
			}
		}
	}

	function LoadMemoryRoot() {
		const unServerBinaryByteCount = 0x40;
		const unServerSignatureByteCount = 0x10;
		const unNativeAddressByteCount = 0x4;
		const unPlayerInformationVTableEntryCount = 2;

		const vecManagerCalls = [];
		const unServerBinaryAddress = Allocate(unServerBinaryByteCount);
		const arrServerBinaryBytes = g_mapAllocations.get(unServerBinaryAddress);
		const strManagerRoot = "C:/sourcejs-game/addons/sourcejs/gamedata";
		const strManagerDataRoot = strManagerRoot;
		const mapManagerFiles = new Map();
		const mapManagerBuiltinFiles = new Map([
			["l4d2/server", {
				Functions: {
					UTIL_Remove: {
						Arguments: ["address"],
						Convention: "cdecl",
						Identifier: "UTIL_Remove",
						ReturnType: "void",
					},
				},
			}],
		]);
		mapManagerFiles.set(`${strManagerRoot}/l4d2/server`, JSON.stringify(mapManagerBuiltinFiles.get("l4d2/server")));

		for (let unByteIndex = 0; unByteIndex < arrServerBinaryBytes.length; unByteIndex += 1) {
			arrServerBinaryBytes.writeUInt8((unByteIndex * 17 + 3) & 0xFF, unByteIndex);
		}

		const strServerSignature = [...arrServerBinaryBytes.subarray(0, unServerSignatureByteCount)].map((unValue) => unValue.toString(16).padStart(2, "0")).join(" ");
		g_SourceModGameDataValue.Games.tf.Signatures.Burn.windows = strServerSignature;
		const unPlayerInformationVTableAddress = Allocate(unNativeAddressByteCount * unPlayerInformationVTableEntryCount);
		const unPlayerInformationManagerAddress = Allocate(unNativeAddressByteCount);

		Write(unPlayerInformationManagerAddress, "address", unPlayerInformationVTableAddress);
		Write(unPlayerInformationVTableAddress, "address", 0x1300n, 0);
		Write(unPlayerInformationVTableAddress, "address", 0x1500n, unNativeAddressByteCount);

		function NormalizeManagerPath(strFilePath) {
			return String(strFilePath).replace(/\\/g, "/");
		}

		function CloneManagerValue(Value) {
			return JSON.parse(JSON.stringify(Value));
		}

		function GetManagerFileValue(strFilePath) {
			const strNormalizedPath = NormalizeManagerPath(strFilePath);
			const vecCandidates = [strNormalizedPath];
			if (!/\.[^/]+$/.test(strNormalizedPath)) {
				vecCandidates.push(`${strNormalizedPath}.json`, `${strNormalizedPath}.ini`, `${strNormalizedPath}.txt`);
			}

			for (const strCandidate of vecCandidates) {
				if (mapManagerFiles.has(strCandidate)) {
					if (strCandidate.toLowerCase().endsWith("/sm-tf2.games.txt")) {
						return CloneManagerValue(g_SourceModGameDataValue);
					}

					return JSON.parse(mapManagerFiles.get(strCandidate));
				}

				if (mapManagerBuiltinFiles.has(strCandidate)) {
					return CloneManagerValue(mapManagerBuiltinFiles.get(strCandidate));
				}
			}

			return null;
		}

		function SelectManagerValue(Value) {
			let SelectedValue = Value;

			while (SelectedValue && (typeof SelectedValue === "object") && !Array.isArray(SelectedValue)) {
				let bSelected = false;

				for (const strKey of ["l4d2", "windows", "x86"]) {
					if (Object.hasOwn(SelectedValue, strKey)) {
						SelectedValue = SelectedValue[strKey];
						bSelected = true;
						break;
					}
				}

				if (!bSelected) {
					break;
				}
			}

			return SelectedValue;
		}

		function GetManagerSymbol(strTargetModule, strSymbolName) {
			if (strTargetModule !== "server") {
				return null;
			}

			if (strSymbolName === "CreateInterface") {
				return 0x1400n;
			}

			return (strSymbolName === "UTIL_Remove") ? 0x1600n : null;
		}

		function ScanManager(strTargetModule, strPattern) {
			if (strTargetModule !== "server") {
				return null;
			}

			if (strPattern === "55 8B EC ? ?") {
				return 0x1200n;
			}

			return (strPattern.toLowerCase() === strServerSignature) ? unServerBinaryAddress : null;
		}

		function ResolveManagerRecord(strTargetModule, Record) {
			const SelectedRecord = SelectManagerValue(Record);
			if (typeof SelectedRecord === "bigint") {
				return SelectedRecord;
			}

			if (typeof SelectedRecord === "number") {
				throw new TypeError("Binary addresses must be bigint values.");
			}

			if (typeof SelectedRecord === "string") {
				return GetManagerSymbol(strTargetModule, SelectedRecord) ?? ScanManager(strTargetModule, SelectedRecord);
			}

			if (!SelectedRecord || (typeof SelectedRecord !== "object") || Array.isArray(SelectedRecord)) {
				return null;
			}

			const vecIdentifierKeys = ["Address", "Identifier", "Symbol", "Pattern"].filter((strIdentifierKey) => Object.hasOwn(SelectedRecord, strIdentifierKey));
			if (vecIdentifierKeys.length !== 1) {
				throw new TypeError("Binary identifier objects must contain exactly one of Address, Identifier, Symbol or Pattern.");
			}

			const strIdentifierKey = vecIdentifierKeys[0];
			const strResolvedBinaryName = Object.hasOwn(SelectedRecord, "Module") ? SelectedRecord.Module : strTargetModule;

			return ResolveManagerRecord(strResolvedBinaryName, SelectedRecord[strIdentifierKey]);
		}

		const NativeMemory = {
			Allocate,
			Deallocate,

			Reallocate(unAddress, unSize) {
				const arrAllocation = g_mapAllocations.get(unAddress);
				if (arrAllocation === undefined) {
					throw new RangeError(`mock memory address is not allocated: ${unAddress}`);
				}

				const unReplacementAddress = Allocate(unSize);
				const arrReplacementAllocation = g_mapAllocations.get(unReplacementAddress);
				arrAllocation.copy(arrReplacementAllocation, 0, 0, Math.min(arrAllocation.length, arrReplacementAllocation.length));
				g_Assert.equal(Deallocate(unAddress), true, "native reallocation double releases old storage");

				return unReplacementAddress;
			},
		};

		const NativeMemoryManager = {
			ARCHITECTURE: "x86",

			GetAllBinaries() {
				return [{
					Name: "server",
					Path: "game/bin/server.dll",
					Address: unServerBinaryAddress,
					Size: arrServerBinaryBytes.length,
				}];
			},

			GetBinary(strBinaryName = "") {
				if ((strBinaryName !== "") && (strBinaryName !== "server")) {
					return null;
				}

				return {
					Name: "server",
					Path: "game/bin/server.dll",
					Address: unServerBinaryAddress,
					Size: arrServerBinaryBytes.length,
				};
			},

			BRANCH: "l4d2",
			DATA_ROOT: strManagerDataRoot,
			SOURCE_MOD_GAME_DATA_ROOT: `${strManagerDataRoot}/SourceMod`,

			GetPackagedGameDataRootPath() {
				return strManagerDataRoot;
			},

			GetAllGameDataFiles() {
				const vecRecords = [];
				for (const strFilePath of mapManagerFiles.keys()) {
					const strPrefix = `${strManagerRoot}/`;
					if (strFilePath.startsWith(strPrefix)) {
						vecRecords.push({
							Name: strFilePath.slice(strPrefix.length).replace(/\.(?:json|ini|txt)$/i, ""),
							Path: strFilePath,
						});
					}
				}

				return vecRecords;
			},

			GetGameDataValue(strFilePath, strPropertyPath = null) {
				let Value = GetManagerFileValue(strFilePath);
				if (Value === null) {
					return null;
				}

				if (strPropertyPath !== null) {
					for (const strPropertyName of String(strPropertyPath).split(".")) {
						if (!Value || (typeof Value !== "object") || !Object.hasOwn(Value, strPropertyName)) {
							return null;
						}

						Value = Value[strPropertyName];
					}
				}

				return SelectManagerValue(Value);
			},

			LoadGameDataFile(strFilePath) {
				return GetManagerFileValue(strFilePath);
			},

			GetGameDataOffset(strFilePath, strOffsetName) {
				const Data = GetManagerFileValue(strFilePath);

				return (Data?.Offsets && Object.hasOwn(Data.Offsets, strOffsetName)) ? SelectManagerValue(Data.Offsets[strOffsetName]) : null;
			},

			CreateGameDataCallableOptions(strFilePath, strCallableName) {
				vecManagerCalls.push(["OPTIONS", strFilePath, strCallableName]);

				const Functions = GetManagerFileValue(strFilePath)?.Functions ?? null;
				if ((Functions === null) || !Object.hasOwn(Functions, strCallableName)) {
					return null;
				}

				const FunctionValue = SelectManagerValue(Functions[strCallableName]);
				if ((FunctionValue === null) || (typeof FunctionValue !== "object") || Array.isArray(FunctionValue)) {
					return null;
				}

				return {
					Arguments: FunctionValue.Arguments ?? [],
					Convention: FunctionValue.Convention ?? "thiscall",
					Address: ResolveManagerRecord(FunctionValue.Module ?? "server", FunctionValue.Address ?? FunctionValue.Identifier),
					ReturnType: FunctionValue.ReturnType ?? "void",
				};
			},

			GetGameDataAddress(strFilePath, strCallableName) {
				const Data = GetManagerFileValue(strFilePath);
				const SignatureRecord = Data?.Signatures?.[strCallableName];
				if (SignatureRecord !== undefined) {
					return ResolveManagerRecord(SignatureRecord?.Module ?? "server", SignatureRecord);
				}

				return NativeMemoryManager.CreateGameDataCallableOptions(strFilePath, strCallableName)?.Address ?? null;
			},

			ScanBinary(strTargetModule, strPattern) {
				vecManagerCalls.push(["SCAN", strTargetModule, strPattern]);

				return ScanManager(strTargetModule, strPattern);
			},

			SelectRuntimeValue(Value) {
				return SelectManagerValue(Value);
			},

			GetGameDataSignature(strFilePath, strSignatureName) {
				const Data = GetManagerFileValue(strFilePath);

				return (Data?.Signatures && Object.hasOwn(Data.Signatures, strSignatureName)) ? SelectManagerValue(Data.Signatures[strSignatureName]) : null;
			},

			GetBinarySymbol(strTargetModule, strSymbolName) {
				vecManagerCalls.push(["SYMBOL", strTargetModule, strSymbolName]);

				return GetManagerSymbol(strTargetModule, strSymbolName);
			},

			PLATFORM: "windows",

			ResolveBinaryIdentifier(strTargetModule, Identifier) {
				return ResolveManagerRecord(strTargetModule, Identifier);
			},

			ROOT: strManagerRoot,

			GetProjectGameDataRootPath() {
				return strManagerRoot;
			},
		};

		const ManagerFilesystem = {
			DoesFileExist(strFilePath) {
				return mapManagerFiles.has(NormalizeManagerPath(strFilePath));
			},

			RemoveFile(strFilePath) {
				return mapManagerFiles.delete(NormalizeManagerPath(strFilePath));
			},

			ReadTextFile(strFilePath) {
				return mapManagerFiles.get(NormalizeManagerPath(strFilePath)) ?? "";
			},

			WriteTextFile(strFilePath, strText) {
				if (typeof strText !== "string") {
					throw new TypeError("mock manager file text must be a string");
				}

				mapManagerFiles.set(NormalizeManagerPath(strFilePath), strText);

				return true;
			},
		};

		const RootGameData = {
			HasGameData(strGameDataKind, strGameDataFileName) {
				return ((strGameDataKind === "entities") && (strGameDataFileName === "CBaseEntity.ini")) || ((strGameDataKind === "memory") && (strGameDataFileName === "GlobalAddresses.ini"));
			},

			LoadGameData(strGameDataKind, strGameDataFileName) {
				if ((strGameDataKind === "entities") && (strGameDataFileName === "CBaseEntity.ini")) {
					return {
						Input: {
							AddContext: "AddContext",
						},
					};
				}

				if ((strGameDataKind === "memory") && (strGameDataFileName === "GlobalAddresses.ini")) {
					return {
						DocumentationGlobalInterface: {
							Binary: "server",
							Identifier: "CreateInterface",
						},
					};
				}

				return {};
			},

			GetGameDataPaths(strGameDataKind, strGameDataFileName) {
				return [
					`addons/sourcejs/data/sourcejs/${strGameDataKind}/${strGameDataFileName}`,
					`addons/sourcejs/data/sourcejs/${strGameDataKind}/l4d2/${strGameDataFileName}`,
				];
			},
		};

		const vecInterfaceRecords = Object.freeze([
			Object.freeze({ Name: "ServerGameDLL005", Address: 0x5000n }),
			Object.freeze({ Name: "PlayerInfoManager002", Address: unPlayerInformationManagerAddress }),
		]);
		const setActiveHooks = new Set();

		function GetCallArgumentValue(Argument) {
			if (Argument && (typeof Argument === "object") && Object.hasOwn(Argument, "Value")) {
				return Argument.Value;
			}

			return Argument;
		}

		function CallCreateInterface(Options) {
			if (Options.Address !== 0x1400n) {
				throw new RangeError(`mock function address is not callable: ${Options.Address}`);
			}

			const vecArgumentValues = Options.Arguments.map(GetCallArgumentValue);
			const NameArgument = Options.ThisObject?.Address ?? Options.ThisObject ?? vecArgumentValues[0];
			const strInterfaceName = (typeof NameArgument === "bigint") ? ReadMockString(NameArgument) : NameArgument;
			const InterfaceRecord = vecInterfaceRecords.find((Record) => Record.Name === strInterfaceName);

			return InterfaceRecord?.Address ?? 0n;
		}

		// This double models the memory/hooks package facade, not the raw native module.
		const RootHooks = {
			HookType: Object.freeze({
				Post: "post",
				Pre: "pre",
			}),

			CallFunction(Options) {
				const vecArgumentValues = Options.Arguments.map(GetCallArgumentValue);
				for (const Hook of setActiveHooks) {
					if (Hook.Options.Address === Options.Address) {
						Hook.InvokePre(vecArgumentValues);
					}
				}

				const ReturnValue = (Options.Address === 0x1500n) ? 0x7000n : CallCreateInterface(Options);
				for (const Hook of setActiveHooks) {
					if (Hook.Options.Address === Options.Address) {
						Hook.InvokePost(vecArgumentValues, ReturnValue);
					}
				}

				return ReturnValue;
			},

			CreateFunctionHook(Options) {
				for (const Record of setActiveHooks) {
					if (Record.Options.Address === Options.Address) {
						return Record.CreateHandle(false);
					}
				}

				const setPreCallbacks = new Set();
				const setPostCallbacks = new Set();
				const Record = {
					Options,

					InvokePost(vecArguments, ReturnValue) {
						for (const Callback of setPostCallbacks) {
							Callback({ Arguments: [...vecArguments], ReturnValue });
						}
					},

					InvokePre(vecArguments) {
						for (const Callback of setPreCallbacks) {
							Callback({ Arguments: [...vecArguments] });
						}
					},
				};
				const CreateHandle = (bCreated) => ({
					Created: bCreated,
					Options,
					InvokePost: Record.InvokePost,
					InvokePre: Record.InvokePre,

					Post(Callback) {
						if (typeof Callback !== "function") {
							throw new TypeError("mock Post-hook callback must be a function");
						}

						setPostCallbacks.add(Callback);

						return true;
					},

					Pre(Callback) {
						if (typeof Callback !== "function") {
							throw new TypeError("mock Pre-hook callback must be a function");
						}

						setPreCallbacks.add(Callback);

						return true;
					},

					Remove() {
						const bRemoved = setActiveHooks.delete(Record);

						setPreCallbacks.clear();
						setPostCallbacks.clear();

						return bRemoved;
					},

					RemovePost(Callback) {
						return setPostCallbacks.delete(Callback);
					},

					RemovePre(Callback) {
						return setPreCallbacks.delete(Callback);
					},
				});
				Record.CreateHandle = CreateHandle;

				setActiveHooks.add(Record);

				return CreateHandle(true);
			},
		};

		const RootHelpers = {
			CALLING_CONVENTIONS: Object.freeze(["cdecl", "stdcall", "thiscall", "fastcall"]),
			DATA_TYPES: Object.freeze([
				"void",
				"bool",
				"char",
				"uchar",
				"short",
				"ushort",
				"int",
				"uint",
				"long",
				"ulong",
				"longlong",
				"ulonglong",
				"float",
				"double",
				"address",
				"string",
				"stringaddress",
				"stringarray",
			]),
			DATA_TYPE_SIZES: Object.freeze({
				bool: 0x1,
				char: 0x1,
				double: 0x8,
				float: 0x4,
				int: 0x4,
				long: 0x4,
				longlong: 0x8,
				address: 0x4,
				short: 0x2,
				string: 0x4,
				stringarray: 0x4,
				stringaddress: 0x4,
				uchar: 0x1,
				uint: 0x4,
				ulong: 0x4,
				ulonglong: 0x8,
				ushort: 0x2,
			}),
			ADDRESS_SIZE: 0x4,
			Add: g_MemoryHelpers.Add,

			Compare(unLeftAddress, unRightAddress, unByteCount) {
				const LeftRange = GetMemoryRange(unLeftAddress, unByteCount);
				const RightRange = GetMemoryRange(unRightAddress, unByteCount);

				return Buffer.compare(LeftRange.Buffer.subarray(LeftRange.Offset, LeftRange.End), RightRange.Buffer.subarray(RightRange.Offset, RightRange.End));
			},

			Copy(unSourceAddress, unDestinationAddress, unByteCount) {
				const unSourceBaseAddress = GetMockMemoryAddress(unSourceAddress);
				const unDestinationBaseAddress = GetMockMemoryAddress(unDestinationAddress);
				const SourceRange = GetMemoryRange(unSourceBaseAddress, unByteCount);
				const DestinationRange = GetMemoryRange(unDestinationBaseAddress, unByteCount);
				const unAddressDistance = (unSourceBaseAddress < unDestinationBaseAddress) ? (unDestinationBaseAddress - unSourceBaseAddress) : (unSourceBaseAddress - unDestinationBaseAddress);
				if (unAddressDistance < BigInt(SourceRange.End - SourceRange.Offset)) {
					throw new RangeError("mock Copy requires non-overlapping memory ranges; use Move for overlap");
				}

				const arrBytes = Buffer.from(SourceRange.Buffer.subarray(SourceRange.Offset, SourceRange.End));
				arrBytes.copy(DestinationRange.Buffer, DestinationRange.Offset);

				return true;
			},

			GetDifference(unLeftAddress, unRightAddress) {
				return GetMockMemoryAddress(unLeftAddress, 0n, true) - GetMockMemoryAddress(unRightAddress, 0n, true);
			},

			IsNull(unAddress) {
				return GetMockMemoryAddress(unAddress, 0n, true) === 0n;
			},

			Move(unSourceAddress, unDestinationAddress, unByteCount) {
				const SourceRange = GetMemoryRange(unSourceAddress, unByteCount);
				const DestinationRange = GetMemoryRange(unDestinationAddress, unByteCount);
				const arrBytes = Buffer.from(SourceRange.Buffer.subarray(SourceRange.Offset, SourceRange.End));
				arrBytes.copy(DestinationRange.Buffer, DestinationRange.Offset);

				return true;
			},

			GetAddress(unAddress = 0n) {
				return GetMockMemoryAddress(unAddress ?? 0n, 0n, true);
			},

			Read: g_MemoryHelpers.Read,

			ReadAddress(unAddress, nAddressOffset = 0n) {
				return g_MemoryHelpers.Read(unAddress, "address", nAddressOffset);
			},

			SearchBytes(unAddress, BytePattern, unByteCount) {
				const Range = GetMemoryRange(unAddress, unByteCount);
				const arrPattern = Buffer.from(BytePattern);
				const nIndex = Range.Buffer.subarray(Range.Offset, Range.End).indexOf(arrPattern);

				return (nIndex === -1) ? 0n : (unAddress + BigInt(nIndex));
			},

			SetProtection() {
				// No OS page-protection behavior is modeled by this storage fixture.
				return true;
			},

			Subtract(unAddress, nAddressOffset = 0n) {
				return GetMockMemoryAddress(unAddress, nAddressOffset, true, true);
			},

			GetVirtualFunction(unObjectAddress, unVirtualFunctionIndex) {
				const unMaximumVirtualFunctionIndex = 0x7FFFFFFF;
				if (!Number.isInteger(unVirtualFunctionIndex) || (unVirtualFunctionIndex < 0) || (unVirtualFunctionIndex > unMaximumVirtualFunctionIndex)) {
					throw new RangeError("mock virtual function index must be a non-negative int32");
				}

				const unVirtualTableAddress = g_MemoryHelpers.Read(unObjectAddress, "address");
				if (unVirtualTableAddress === 0n) {
					return 0n;
				}

				return g_MemoryHelpers.Read(unVirtualTableAddress, "address", BigInt(unVirtualFunctionIndex) * BigInt(RootHelpers.ADDRESS_SIZE));
			},

			GetVirtualTable(unObjectAddress) {
				return g_MemoryHelpers.Read(unObjectAddress, "address");
			},

			Write: g_MemoryHelpers.Write,
		};

		InstallNativeBridge({
			filesystem: ManagerFilesystem,
			memory: NativeMemory,
			"memory/helpers": RootHelpers,
			"memory/hooks": RootHooks,
			"memory/manager": NativeMemoryManager,
		});

		InstallDependency(g_strMemoryGameDataPath, RootGameData);
		delete require.cache[g_strMemoryHelpersPath];
		const CanonicalRootHelpers = require(g_strMemoryHelpersPath);

		InstallDependency(g_strMemoryHelpersPath, CanonicalRootHelpers);
		InstallDependency(g_strMemoryHooksPath, RootHooks);
		delete require.cache[g_strMemoryManagerPath];
		delete require.cache[g_strMemoryPath];

		return {
			ActiveHookCount() {
				return setActiveHooks.size;
			},

			InterfaceRecords: vecInterfaceRecords,

			ManagerFileCount() {
				return mapManagerFiles.size;
			},

			ManagerFilesystem,
			ManagerCalls: vecManagerCalls,
			Helpers: CanonicalRootHelpers,
			Memory: require(g_strMemoryPath),
			NativeMemory,
			NativeMemoryManager,
			RootGameData,
			RootHelpers,
			RootHooks,
		};
	}

	function CheckRootMemoryHelperContract(RawHelpers, Helpers) {
		const vecExpectedNativeNames = [
			"ADDRESS_SIZE",
			"CALLING_CONVENTIONS",
			"DATA_TYPES",
			"DATA_TYPE_SIZES",
			"Add",
			"Compare",
			"Copy",
			"GetAddress",
			"GetDifference",
			"GetVirtualFunction",
			"GetVirtualTable",
			"IsNull",
			"Move",
			"Read",
			"ReadAddress",
			"SearchBytes",
			"SetProtection",
			"Subtract",
			"Write",
		];
		g_Assert.deepEqual(Object.keys(RawHelpers).sort(), vecExpectedNativeNames.sort(), "raw helper double must not add package-only aliases");
		const NullAddress = new Helpers.BaseAddress();
		g_Assert.equal(NullAddress.Address, 0n);
		g_Assert.equal(NullAddress.Null, true);
		g_Assert.equal(NullAddress.HasAddress(), false);
		g_Assert.equal(RawHelpers.GetAddress(), 0n);
		g_Assert.equal(RawHelpers.Add(0n, 0n), 0n);
		g_Assert.equal(RawHelpers.Subtract(0n, -0x80000000n), 0x80000000n, "subtraction validates the signed offset before negation");
		g_Assert.equal(RawHelpers.GetDifference(0n, 0x1n), -0x1n);

		for (const InvalidAddress of [0, -0x1n, 0x100000000n, "0"]) {
			g_Assert.throws(() => RawHelpers.GetAddress(InvalidAddress));
		}

		for (const InvalidOffset of [0, "0", 1n << 63n, -(1n << 63n) - 1n]) {
			g_Assert.throws(() => RawHelpers.Add(0x1n, InvalidOffset));
			g_Assert.throws(() => RawHelpers.Subtract(0x1n, InvalidOffset));
		}

		g_Assert.throws(() => RawHelpers.Add(0xFFFFFFFFn, 0x1n), /overflow/);
		g_Assert.throws(() => RawHelpers.Subtract(0n, 0x1n), /overflow/);
		const unAddress = Allocate(0x10);

		try {
			const Base = new Helpers.BaseAddress(unAddress);
			g_Assert.equal(Base.Add(0x4n).Add(-0x4n).Address, unAddress);
			g_Assert.equal(Base.Subtract(-0x4n).Address, unAddress + 0x4n);
			Helpers.WriteAddress(unAddress, unAddress + 0x8n);
			g_Assert.equal(Helpers.ReadAddress(unAddress), unAddress + 0x8n);
			g_Assert.equal(Helpers.Read(unAddress), unAddress + 0x8n);
			Helpers.WriteInt(unAddress, -73, 0x4n);
			g_Assert.equal(Helpers.ReadInt(unAddress, 0x4n), -73);
			Helpers.WriteBool(unAddress, true, 0x8n);
			g_Assert.equal(Helpers.ReadBool(unAddress, 0x8n), true);
			Helpers.WriteUInt(unAddress, 0xFFFFFFFF, 0xCn);
			g_Assert.equal(Helpers.ReadUInt(unAddress, 0xCn), 0xFFFFFFFF);
			g_Assert.throws(() => RawHelpers.Read(unAddress, "int", 0), /BigInt/);
			g_Assert.throws(() => RawHelpers.ReadAddress(unAddress, 0), /BigInt/);
			g_Assert.throws(() => RawHelpers.Write(unAddress, "int", 12, 0), /BigInt/);
			g_Assert.equal(Helpers.ReadInt(unAddress, 0x4n), -73, "invalid native offset does not change storage");
			g_Assert.equal(RawHelpers.GetVirtualTable(unAddress), unAddress + 0x8n);
			g_Assert.equal(RawHelpers.GetVirtualFunction(unAddress, 1), 0xFFFFFFFFn);

			for (const InvalidIndex of [-1, 0.5, "1", 1n, 0x80000000]) {
				g_Assert.throws(() => RawHelpers.GetVirtualFunction(unAddress, InvalidIndex), /index/);
			}
		} finally {
			g_Assert.equal(Deallocate(unAddress), true);
		}
	}

	const g_RootMemoryFixture = LoadMemoryRoot();
	const g_RootMemory = g_RootMemoryFixture.Memory;
	CheckBaseAddressPrivateStorage(g_RootMemory);
	CheckMemoryHelperPrivateStorage(g_RootMemoryFixture.Helpers, g_RootMemoryFixture.RootHooks);
	const g_RootMemoryManager = g_RootMemory.Manager;
	CheckMemoryManagerPrivateStorage(g_RootMemory, g_RootMemoryManager);
	CheckGlobalAddressAccessorCall(g_RootMemoryFixture);
	g_Assert.equal(VerifyMemoryFunctionRegistrationFailures(g_RootMemoryFixture), 415);
	VerifyMemoryFunctionNativeReuse(g_RootMemoryFixture);

	CheckRootMemoryHelperContract(g_RootMemoryFixture.RootHelpers, g_RootMemoryFixture.Helpers);

	g_Assert.equal(g_RootMemoryManager.Manager instanceof g_RootMemoryManager.TypeManager, true, "memory/manager default manager");
	g_Assert.equal("GetBinarySymbol" in g_RootMemoryManager, true, "memory/manager must expose canonical GetBinarySymbol");
	g_Assert.equal("Manager" in g_RootMemoryManager, true, "memory/manager must expose Manager");
	g_Assert.equal("manager" in g_RootMemoryManager, false, "memory/manager must not expose manager alias");
	g_Assert.equal("MANAGER" in g_RootMemoryManager, false, "memory/manager must not expose MANAGER alias");
	const g_strSourceModGameDataText = '\uFEFF/* SourceMod header comment */\n"Games" // line comment\n{\n\t"tf"\n\t{\n\t\t"Signatures"\n\t\t{\n\t\t\t"Burn" /* section comment */\n\t\t\t{\n\t\t\t\t"library" "server" ; semicolon comment\n\t\t\t\t"linux64" "@_ZN15CTFPlayerShared4BurnEP9CTFPlayerP13CTFWeaponBasef" // trailing comment\n\t\t\t\t"CommentMarkers" "//literal;/*literal*/"\n\t\t\t}\n\t\t}\n\t}\n}\n';
	const g_strSourceModGameDataPath = `${g_RootMemoryManager.DATA_ROOT}/sm-tf2.games.txt`;
	g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, g_strSourceModGameDataText);
	const g_SourceModGameData = g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath);
	g_Assert.deepEqual(Object.keys(g_SourceModGameData), ["Games"], "SourceMod loader preserves the native root name");
	g_Assert.equal(g_SourceModGameData.Games, g_SourceModGameDataValue.Games, "SourceMod KeyValues GameData children");
	g_Assert.equal(g_vecKeyValuesBufferLoads.length, 1, "SourceMod gamedata KeyValues buffer parse count");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Text.includes("\uFEFF"), false, "SourceMod gamedata BOM removed before KeyValues parsing");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Text.includes("SourceMod header comment"), false, "SourceMod block comments removed before KeyValues parsing");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Text.includes("line comment"), false, "SourceMod line comments removed before KeyValues parsing");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Text.includes("semicolon comment"), false, "SourceMod semicolon comments removed before KeyValues parsing");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Text.includes('"CommentMarkers" "//literal;/*literal*/"'), true, "comment markers preserved inside quoted SourceMod values");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Text.includes('"linux64" "@_ZN15CTFPlayerShared4BurnEP9CTFPlayerP13CTFWeaponBasef"'), true, "SourceMod signature escapes and markers preserved");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].Destroyed, true, "SourceMod gamedata KeyValues cleanup");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].UsesEscapeSequences, false, "SourceMod signature bytes do not enable KeyValues escape decoding");
	g_Assert.equal(g_vecKeyValuesBufferLoads[0].PreserveDuplicateKeys, true, "SourceMod loading preserves repeated section and supported-game keys");
	g_Assert.equal(g_RootMemoryManager.SelectRuntimeValue({ windows64: "x64", windows: "x86" }), "x86", "SourceMod x86 platform selection");

	const g_strSnapshotGameDataPath = `${g_RootMemoryManager.SOURCE_MOD_GAME_DATA_ROOT}/sm-tf2.games.txt`;
	g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSnapshotGameDataPath, g_strSourceModGameDataText.replace("//literal;", "//snapshot;"));
	try {
		g_RootMemoryManager.LoadGameDataFile("sm-tf2.games.txt");
		g_Assert.match(g_vecKeyValuesBufferLoads.at(-1).Text, /\/\/snapshot;/, "relative SourceMod GameData prefers the active snapshot");
		g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath);
		g_Assert.match(g_vecKeyValuesBufferLoads.at(-1).Text, /\/\/literal;/, "absolute SourceMod GameData paths bypass the snapshot");
	} finally {
		g_RootMemoryFixture.ManagerFilesystem.RemoveFile(g_strSnapshotGameDataPath);
	}

	g_RootMemoryManager.LoadGameDataFile("sm-tf2.games.txt");
	g_Assert.match(g_vecKeyValuesBufferLoads.at(-1).Text, /\/\/literal;/, "missing snapshot entries fall back to bundled GameData");

	function CheckSourceModDuplicatePaths() {
		const CreateOriginalKeyValuesFromBuffer = g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer;
		const ParsedData = { Games: { "#default": [{ Keys: { Label: "First" } }, { Keys: { Label: "Second" } }] } };
		let strRootName = "Games";
		let NameFailure = null;
		let unDestructionCount = 0;

		try {
			g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer = () => ({
				get Name() {
					if (NameFailure) {
						throw NameFailure;
					}

					return strRootName;
				},

				ConvertKeyValuesToObject(bPreserveDuplicateKeys) {
					g_Assert.equal(bPreserveDuplicateKeys, true, "raw SourceMod loading opts into duplicate preservation");

					return ParsedData.Games;
				},

				DestroyKeyValues() {
					++unDestructionCount;

					return true;
				},
			});

			g_Assert.equal(g_RootMemoryManager.GetGameDataValue(g_strSourceModGameDataPath, "Games.#default.0.Keys.Label"), "First");
			g_Assert.equal(g_RootMemoryManager.GetGameDataValue(g_strSourceModGameDataPath, "Games.#default.1.Keys.Label"), "Second");
			g_Assert.equal(g_RootMemoryManager.GetGameDataValue(g_strSourceModGameDataPath, "Games.#default.2.Keys.Label"), null);
			g_Assert.equal(g_RootMemoryManager.GetGameDataValue(g_strSourceModGameDataPath, "Games.#default"), ParsedData.Games["#default"]);
			g_Assert.equal(unDestructionCount, 4, "every dotted-path read releases its temporary parsed tree");

			strRootName = "__proto__";
			const PrototypeRoot = g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath);
			g_Assert.equal(Object.hasOwn(PrototypeRoot, "__proto__"), true, "native root names are literal data properties");
			g_Assert.equal(PrototypeRoot.__proto__, ParsedData.Games);

			NameFailure = new Error("Native root name read failed.");
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), (ErrorValue) => ErrorValue === NameFailure);
			g_Assert.equal(unDestructionCount, 6, "root-name failures still release their temporary native tree");
		} finally {
			g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer = CreateOriginalKeyValuesFromBuffer;
		}
	}

	CheckSourceModDuplicatePaths();

	function CheckSourceModKeySpelling() {
		const CreateOriginalKeyValuesFromBuffer = g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer;
		let strCurrentRootName = "Games";
		let CurrentNativeValue = {};
		let unLoadCount = 0;
		let unDestructionCount = 0;
		const FreezeNativeValue = (Value) => {
			if ((Value !== null) && (typeof Value === "object")) {
				for (const Child of Object.values(Value)) {
					FreezeNativeValue(Child);
				}

				Object.freeze(Value);
			}

			return Value;
		};

		const RunCase = (strRootName, NativeValue, strText, Expected) => {
			strCurrentRootName = strRootName;
			CurrentNativeValue = FreezeNativeValue(NativeValue);
			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, strText);

			const Parsed = g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath);
			g_Assert.deepEqual(Parsed, Expected, "retain source spelling without changing native scalar values or duplicate order");

			return Parsed;
		};

		try {
			g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer = (strText, bUsesEscapeSequences) => {
				g_Assert.equal(bUsesEscapeSequences, false);
				g_Assert.equal(typeof strText, "string");
				++unLoadCount;

				return {
					Name: strCurrentRootName,

					ConvertKeyValuesToObject(bPreserveDuplicateKeys) {
						g_Assert.equal(bPreserveDuplicateKeys, true);

						return CurrentNativeValue;
					},

					DestroyKeyValues() {
						++unDestructionCount;

						return true;
					},
				};
			};

			RunCase(
				"gAmEs",
				{ Left4Dead2: { OFFSETS: { GIVENAMEDITEM: 432 } } },
				'"Games" { "left4dead2" { "Offsets" { "GiveNamedItem" "432" } } }',
				{ Games: { left4dead2: { Offsets: { GiveNamedItem: 432 } } } });
			RunCase(
				"GAMES",
				{ THING: ["First", "Second", "Third"] },
				'"Games" { "Thing" "First" "thing" "Second" "Thing" "Third" }',
				{ Games: { Thing: ["First", "Third"], thing: "Second" } });
			RunCase(
				"GAMES",
				{ "#DEFAULT": [{ KEYS: { LABEL: "First" } }, { KEYS: { LABEL: "Second" } }] },
				'"Games" { "#default" { "Keys" { "Label" "First" } } "#default" { "Keys" { "Label" "Second" } } }',
				{ Games: { "#default": [{ Keys: { Label: "First" } }, { Keys: { Label: "Second" } }] } });
			RunCase(
				"Games",
				{ Foo: 1, foo: 2 },
				'Games { Foo "1" foo "2" }',
				{ Games: { Foo: 1, foo: 2 } });
			RunCase(
				"Games",
				{ "ÅNGSTRöM": "One", "ångström": "Two" },
				'"Games" { "Ångström" "One" "ångström" "Two" }',
				{ Games: { "Ångström": "One", "ångström": "Two" } });

			const PrototypeRoot = RunCase(
				"__PROTO__",
				JSON.parse('{"__PROTO__":{"POLLUTED":"yes"},"CONSTRUCTOR":"literal","TOSTRING":"value"}'),
				'"__proto__" { "__proto__" { "Polluted" "yes" } "constructor" "literal" "toString" "value" }',
				JSON.parse('{"__proto__":{"__proto__":{"Polluted":"yes"},"constructor":"literal","toString":"value"}}'));
			g_Assert.equal(Object.getPrototypeOf(PrototypeRoot), Object.prototype);
			g_Assert.equal(Object.getPrototypeOf(PrototypeRoot.__proto__), Object.prototype);
			g_Assert.equal(Object.hasOwn(PrototypeRoot.__proto__, "__proto__"), true);
			g_Assert.equal(Object.prototype.Polluted, undefined);

			const vecScalarValues = [
				0,
				false,
				7.5,
				18446744073709551615n,
				"",
				"\\x48\\x2A//;/*literal*/",
			];
			for (let unCaseIndex = 0; unCaseIndex < vecScalarValues.length; ++unCaseIndex) {
				const strName = `arbitrarySourceField${unCaseIndex}`;
				const NativeValue = vecScalarValues[unCaseIndex];
				RunCase("Games", { [strName.toUpperCase()]: NativeValue }, `"Games" { "${strName}" "opaque-native-value" }`, { Games: { [strName]: NativeValue } });
			}

			RunCase("Games", { PATTERN: "\\x48\\x2A" }, 'Games { Pattern "\\x48\\x2A" }', { Games: { Pattern: "\\x48\\x2A" } });
			RunCase("Games", { Included: "native-expansion" }, '#base "common.txt" "Games" {}', { Games: { Included: "native-expansion" } });
			RunCase("Games", { Filtered: "native-selection" }, '"Games" { "Filtered" "native-selection" [$LINUX] }', { Games: { Filtered: "native-selection" } });
			g_Assert.equal(unLoadCount, 15, "cover nested, repeated, differently cased, prototype, typed, literal and native-extension records");
			g_Assert.equal(unDestructionCount, unLoadCount, "every spelling-recovery read releases exactly one native owner");
		} finally {
			g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer = CreateOriginalKeyValuesFromBuffer;
			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, g_strSourceModGameDataText);
		}
	}

	CheckSourceModKeySpelling();

	function CheckSourceModGameDataParsingAndCleanup() {
		const CreateOriginalKeyValuesFromBuffer = g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer;
		const DestructionFailure = new Error("SourceMod cleanup failure");
		let ConversionFailure = new Error("SourceMod conversion failure");
		let bConversionFails = false;
		let bDestructionSucceeds = true;
		let bDestructionThrows = false;
		let unDestructionAttempts = 0;

		try {
			for (const unBackslashCount of [1, 2, 3]) {
				const strSignatureValue = "\\x48" + "\\".repeat(unBackslashCount);
				const strInputText = '"Games" { "Pattern" "' + strSignatureValue + '" /* trailing block comment */ }\r\n';
				g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, strInputText);
				g_Assert.equal(g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath).Games, g_SourceModGameDataValue.Games);

				const KeyValuesLoad = g_vecKeyValuesBufferLoads[g_vecKeyValuesBufferLoads.length - 1];
				g_Assert.equal(KeyValuesLoad.Text.includes(strSignatureValue), true, "literal signature backslashes survive stripping");
				g_Assert.equal(KeyValuesLoad.Text.includes("trailing block comment"), false, "comments after a literal-backslash token are removed");
				g_Assert.equal(KeyValuesLoad.Text.length, strInputText.length, "comment replacement preserves source offsets");
				g_Assert.equal(KeyValuesLoad.Text.endsWith("}\r\n"), true, "comment replacement preserves CRLF boundaries");
				g_Assert.equal(KeyValuesLoad.UsesEscapeSequences, false);
				g_Assert.equal(KeyValuesLoad.Destroyed, true);
			}

			const unLoadsBeforeInvalidComment = g_vecKeyValuesBufferLoads.length;
			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, '"Games" {} /* unterminated comment');
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), /unterminated block comment/);
			g_Assert.equal(g_vecKeyValuesBufferLoads.length, unLoadsBeforeInvalidComment, "invalid comments fail before native allocation");
			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, '"Games" { "Value" "unterminated\r\n// still quoted');
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), /unterminated quoted string/);
			g_Assert.equal(g_vecKeyValuesBufferLoads.length, unLoadsBeforeInvalidComment, "invalid quoted strings fail before native allocation");

			const strMultilineText = '"Games" { "Value" "First\r\n//literal\r\n;literal\r\n/*literal*/\r\nLast" }\r\n';
			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, strMultilineText);
			g_Assert.equal(g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath).Games, g_SourceModGameDataValue.Games);
			g_Assert.equal(g_vecKeyValuesBufferLoads[g_vecKeyValuesBufferLoads.length - 1].Text, strMultilineText, "line breaks do not move quoted content into comment parsing");

			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, g_strSourceModGameDataText);

			g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer = (strText, bUsesEscapeSequences) => {
				const KeyValuesInstance = CreateOriginalKeyValuesFromBuffer.call(g_KeyValuesModuleMock.KeyValues, strText, bUsesEscapeSequences);
				const DestroyOriginalKeyValues = KeyValuesInstance.DestroyKeyValues;

				KeyValuesInstance.ConvertKeyValuesToObject = () => {
					if (bConversionFails) {
						throw ConversionFailure;
					}

					return g_SourceModGameDataValue.Games;
				};

				KeyValuesInstance.DestroyKeyValues = () => {
					unDestructionAttempts++;
					g_Assert.equal(DestroyOriginalKeyValues.call(KeyValuesInstance), true, "injected cleanup still releases its fixture");

					if (bDestructionThrows) {
						throw DestructionFailure;
					}

					return bDestructionSucceeds;
				};

				return KeyValuesInstance;
			};

			bDestructionSucceeds = false;
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), /Could not release/);
			g_Assert.equal(unDestructionAttempts, 1, "failed cleanup status is checked once");

			bDestructionSucceeds = true;
			bConversionFails = true;
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), (ErrorValue) => ErrorValue === ConversionFailure);
			g_Assert.equal(unDestructionAttempts, 2, "conversion failures release the native owner");

			bDestructionSucceeds = false;
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), (ErrorValue) => {
				g_Assert.equal(ErrorValue instanceof AggregateError, true);
				g_Assert.equal(ErrorValue.errors.length, 2);
				g_Assert.equal(ErrorValue.errors[0], ConversionFailure);
				g_Assert.match(ErrorValue.errors[1].message, /Could not release/);

				return true;
			});

			bDestructionThrows = true;
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), (ErrorValue) => {
				g_Assert.equal(ErrorValue instanceof AggregateError, true);
				g_Assert.deepEqual(ErrorValue.errors, [ConversionFailure, DestructionFailure]);

				return true;
			});

			bConversionFails = false;
			g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), (ErrorValue) => ErrorValue === DestructionFailure);

			bConversionFails = true;
			bDestructionThrows = false;

			for (const PrimitiveFailure of [null, undefined, 0, false]) {
				ConversionFailure = PrimitiveFailure;
				g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(g_strSourceModGameDataPath), (ErrorValue) => {
					g_Assert.equal(ErrorValue instanceof AggregateError, true);
					g_Assert.equal(ErrorValue.errors[0], PrimitiveFailure, "falsy thrown values are preserved");
					g_Assert.match(ErrorValue.errors[1].message, /Could not release/);

					return true;
				});
			}

			g_Assert.equal(unDestructionAttempts, 9, "all cleanup paths make exactly one destruction attempt");
		} finally {
			g_KeyValuesModuleMock.KeyValues.CreateKeyValuesFromBuffer = CreateOriginalKeyValuesFromBuffer;
			g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strSourceModGameDataPath, g_strSourceModGameDataText);
		}
	}

	function CheckGameDataPropertyPathValidation() {
		const ReadOriginalTextFile = g_RootMemoryFixture.ManagerFilesystem.ReadTextFile;
		let unReadCount = 0;
		g_RootMemoryFixture.ManagerFilesystem.ReadTextFile = () => {
			unReadCount++;

			return '{"Values":{"Name":"selected"}}';
		};

		try {
			for (const InvalidPropertyPath of ["", 0, false, {}, []]) {
				g_Assert.throws(() => g_RootMemoryManager.GetGameDataValue("property-path.json", InvalidPropertyPath), /GameData property paths must be non-empty strings or null/);
				g_Assert.equal(unReadCount, 0, "invalid property paths fail before filesystem access");
			}

			g_Assert.equal(g_RootMemoryManager.GetGameDataValue("property-path.json", "Values.Name"), "selected");
			g_Assert.equal(g_RootMemoryManager.GetGameDataValue("property-path.json", "Values.Missing"), null);
			g_Assert.equal(g_RootMemoryManager.GetGameDataValue("property-path.json", "Values.toString"), null, "property traversal excludes inherited values");
			g_Assert.deepEqual(g_RootMemoryManager.GetGameDataValue("property-path.json"), { Values: { Name: "selected" } });
			g_Assert.equal(unReadCount, 4, "valid paths perform one read per request");
		} finally {
			g_RootMemoryFixture.ManagerFilesystem.ReadTextFile = ReadOriginalTextFile;
		}
	}

	function CheckGameDataFilePathResolution() {
		const ReadOriginalTextFile = g_RootMemoryFixture.ManagerFilesystem.ReadTextFile;
		const vecReadPaths = [];
		let unPathCoercions = 0;
		g_RootMemoryFixture.ManagerFilesystem.ReadTextFile = (strFilePath) => {
			vecReadPaths.push(strFilePath);

			return '{"Marker":true}';
		};

		try {
			const vecPathCases = [
				{ Path: "relative.json", ResolvedPath: `${g_RootMemoryManager.DATA_ROOT}/relative.json` },
				{ Path: "custom/relative.json", ResolvedPath: `${g_RootMemoryManager.DATA_ROOT}/custom/relative.json` },
				{ Path: "custom\\relative.json", ResolvedPath: `${g_RootMemoryManager.DATA_ROOT}/custom\\relative.json` },
				{ Path: "C:/GameData/absolute.json", ResolvedPath: "C:/GameData/absolute.json" },
				{ Path: "C:\\GameData\\absolute.json", ResolvedPath: "C:\\GameData\\absolute.json" },
				{ Path: "\\\\Host\\Share\\absolute.json", ResolvedPath: "\\\\Host\\Share\\absolute.json" },
				{ Path: "\\Rooted\\absolute.json", ResolvedPath: "\\Rooted\\absolute.json" },
				{ Path: "C:drive-relative.json", ResolvedPath: "C:drive-relative.json" },
				{ Path: "/rooted/absolute.json", ResolvedPath: "/rooted/absolute.json" },
			];
			for (const PathCase of vecPathCases) {
				const unReadCountBefore = vecReadPaths.length;
				g_Assert.deepEqual(g_RootMemoryManager.LoadGameDataFile(PathCase.Path), { Marker: true });
				g_Assert.equal(vecReadPaths.length, unReadCountBefore + 1, "one native filesystem read per GameData request");
				g_Assert.equal(vecReadPaths.at(-1), PathCase.ResolvedPath, "resolve only ordinary relative GameData paths");
			}

			g_Assert.equal(g_RootMemoryManager.GetGameDataValue("custom/relative.json", "Marker"), true);
			g_Assert.equal(vecReadPaths.at(-1), `${g_RootMemoryManager.DATA_ROOT}/custom/relative.json`, "value lookup shares canonical path resolution");

			const unReadCountBeforeInvalidPaths = vecReadPaths.length;
			const CoerciblePath = {
				toString() {
					unPathCoercions++;

					return "relative.json";
				},
			};
			for (const InvalidPath of ["", null, undefined, 0, false, {}, [], CoerciblePath]) {
				g_Assert.throws(() => g_RootMemoryManager.LoadGameDataFile(InvalidPath), TypeError, "invalid file paths fail before native filesystem access");
			}

			g_Assert.equal(vecReadPaths.length, unReadCountBeforeInvalidPaths, "invalid GameData paths perform no reads");
			g_Assert.equal(unPathCoercions, 0, "GameData paths do not invoke caller-defined string conversion");
		} finally {
			g_RootMemoryFixture.ManagerFilesystem.ReadTextFile = ReadOriginalTextFile;
		}
	}

	CheckSourceModGameDataParsingAndCleanup();
	CheckGameDataPropertyPathValidation();
	CheckGameDataFilePathResolution();

	function CheckCustomTypeStaticPropertyDescriptors() {
		const vecPropertyNames = [
			"Manager",
			"Binary",
			"ServerCheck",
			"TypeSize",
			"ClassInfo",
			"ConstructorCallback",
			"DestructorCallback",
		];
		g_Assert.deepEqual(Object.keys(g_RootMemoryManager.CustomType), vecPropertyNames, "CustomType static property order remains stable");

		for (const strPropertyName of vecPropertyNames) {
			const Descriptor = Object.getOwnPropertyDescriptor(g_RootMemoryManager.CustomType, strPropertyName);
			g_Assert.equal(Descriptor.configurable, true);
			g_Assert.equal(Descriptor.enumerable, true);
			g_Assert.equal(Descriptor.writable, true);
			g_Assert.equal(Object.hasOwn(Descriptor, "value"), true, "CustomType metadata remains an ordinary data property");
		}

		g_Assert.equal(g_RootMemoryManager.CustomType.Manager, null);
		g_Assert.equal(g_RootMemoryManager.CustomType.Binary, null);
		g_Assert.equal(g_RootMemoryManager.CustomType.ServerCheck, true);
		g_Assert.equal(g_RootMemoryManager.CustomType.TypeSize, null);
		g_Assert.deepEqual(g_RootMemoryManager.CustomType.ClassInfo, {});
		g_Assert.equal(g_RootMemoryManager.CustomType.ConstructorCallback, null);
		g_Assert.equal(g_RootMemoryManager.CustomType.DestructorCallback, null);
	}

	CheckCustomTypeStaticPropertyDescriptors();

	for (const strRemovedCustomTypeMember of [
		"g_bServerAddressCheck",
		"g_ConstructorCallBack",
		"g_DestructorCallBack",
		"g_objClassInformation",
		"g_objTypeManager",
		"g_unTypeByteCount",
	]) {
		g_Assert.equal(strRemovedCustomTypeMember in g_RootMemoryManager.CustomType, false, `CustomType must not expose ${strRemovedCustomTypeMember} alias`);
	}

	const g_unCustomConstructorTypeByteCount = 0x1;

	const g_unCustomConstructorAllocationCount = g_mapAllocations.size;
	const g_CustomConstructorManager = new g_RootMemoryManager.TypeManager();
	const g_CustomConstructorArgument = { WrapAddress: true };
	const g_CustomConstructorFailure = new Error("custom constructor failure");
	let g_ReceivedCustomConstructorArgument = null;
	let g_unCustomDestructorCallCount = 0;

	class SmokeCustomConstructorArgument extends g_RootMemoryManager.CustomType {
	}

	class SmokeFailingCustomConstructor extends g_RootMemoryManager.CustomType {
	}

	class SmokeRetryingDestructor extends g_RootMemoryManager.CustomType {
	}

	g_CustomConstructorManager.DefineType("SmokeCustomConstructorArgument", SmokeCustomConstructorArgument, {
		ConstructorCallback(ConstructorArgument) {
			g_ReceivedCustomConstructorArgument = ConstructorArgument;
		},

		Size: g_unCustomConstructorTypeByteCount,
	});

	g_CustomConstructorManager.DefineType("SmokeFailingCustomConstructor", SmokeFailingCustomConstructor, {
		ConstructorCallback() {
			throw g_CustomConstructorFailure;
		},

		Size: g_unCustomConstructorTypeByteCount,
	});

	g_CustomConstructorManager.DefineType("SmokeRetryingDestructor", SmokeRetryingDestructor, {
		DestructorCallback() {
			g_unCustomDestructorCallCount += 1;
		},

		Size: g_unCustomConstructorTypeByteCount,
	});

	function RestoreAllocationDelete(Descriptor) {
		if (Descriptor === undefined) {
			g_Assert.equal(Reflect.deleteProperty(g_mapAllocations, "delete"), true);

		} else {
			Object.defineProperty(g_mapAllocations, "delete", Descriptor);
		}

		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_mapAllocations, "delete"), Descriptor, "allocation release override restores its exact original descriptor");
	}

	const g_CustomConstructorInstance = new SmokeCustomConstructorArgument(g_CustomConstructorArgument);

	try {
		g_Assert.equal(g_ReceivedCustomConstructorArgument, g_CustomConstructorArgument, "CustomType ordinary constructor argument");
		g_Assert.equal(g_CustomConstructorInstance.OwnsAddress, true, "CustomType ordinary constructor allocation ownership");
	} finally {
		g_Assert.equal(g_CustomConstructorInstance.Deallocate(), true, "CustomType ordinary constructor allocation cleanup");
	}

	g_Assert.throws(() => new SmokeFailingCustomConstructor(), (ErrorValue) => ErrorValue === g_CustomConstructorFailure, "CustomType constructor error identity");

	const g_RetryingDestructorInstance = new SmokeRetryingDestructor();
	const g_unRetryingDestructorAddress = g_RetryingDestructorInstance.Address;
	const g_AllocationDeleteDescriptor = Object.getOwnPropertyDescriptor(g_mapAllocations, "delete");
	const g_OriginalAllocationDelete = g_mapAllocations.delete;
	g_mapAllocations.delete = function DeleteAllocation(unAddress) {
		if (unAddress === g_unRetryingDestructorAddress) {
			return false;
		}

		return Reflect.apply(g_OriginalAllocationDelete, this, [unAddress]);
	};

	try {
		g_Assert.throws(() => g_RetryingDestructorInstance.Deallocate(), /not allocated/, "CustomType deallocation failure");
		g_Assert.equal(g_unCustomDestructorCallCount, 1, "CustomType destructor first attempt");
	} finally {
		try {
			RestoreAllocationDelete(g_AllocationDeleteDescriptor);
		} finally {
			g_Assert.equal(g_RetryingDestructorInstance.Deallocate(), true, "CustomType deallocation retry");
		}
	}

	g_Assert.equal(g_unCustomDestructorCallCount, 1, "CustomType destructor retry suppression");
	g_Assert.equal(g_mapAllocations.size, g_unCustomConstructorAllocationCount, "CustomType constructor rollback cleanup");

	function CheckCustomTypeInitializationRollback() {
		const unTypeByteCount = 0x1;

		const setOriginalAllocationAddresses = new Set(g_mapAllocations.keys());
		const OriginalDeleteDescriptor = Object.getOwnPropertyDescriptor(g_mapAllocations, "delete");
		const BaseAddress = Object.getPrototypeOf(g_RootMemoryManager.CustomType);
		const OriginalRebindDescriptor = Object.getOwnPropertyDescriptor(BaseAddress, "RebindAddress");
		const OriginalWeakMapSetDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set");
		const BaseInitializationFailure = new Error("custom base initialization failure");
		const StateInitializationFailure = new Error("custom ownership initialization failure");
		let unFailedAllocationAddress = 0n;
		let unPartialDestructorCalls = 0;

		class FailingBaseInitialization extends g_RootMemoryManager.CustomType {
		}

		class FailingStateInitialization extends g_RootMemoryManager.CustomType {
		}

		g_CustomConstructorManager.DefineType("FailingBaseInitialization", FailingBaseInitialization, { Size: unTypeByteCount });

		g_CustomConstructorManager.DefineType("FailingStateInitialization", FailingStateInitialization, {
			DestructorCallback() {
				unPartialDestructorCalls++;
			},

			Size: unTypeByteCount,
		});

		Object.defineProperty(BaseAddress, "RebindAddress", {
			...OriginalRebindDescriptor,
			value(AddressValue, unAddress) {
				if (AddressValue instanceof FailingBaseInitialization) {
					unFailedAllocationAddress = unAddress;
					throw BaseInitializationFailure;
				}

				return OriginalRebindDescriptor.value.call(this, AddressValue, unAddress);
			},
		});

		Object.defineProperty(WeakMap.prototype, "set", {
			...OriginalWeakMapSetDescriptor,
			value(Target, State) {
				if (Target instanceof FailingStateInitialization) {
					g_Assert.equal(typeof State.m_mapAddressValues.set, "function");
					unFailedAllocationAddress = Target.Address;
					throw StateInitializationFailure;
				}

				return OriginalWeakMapSetDescriptor.value.call(this, Target, State);
			},
		});

		try {
			g_Assert.throws(() => new FailingBaseInitialization(), (ErrorValue) => ErrorValue === BaseInitializationFailure);
			g_Assert.equal(g_mapAllocations.has(unFailedAllocationAddress), false, "a failed base constructor releases the raw address without accessing this");
			g_Assert.throws(() => new FailingStateInitialization(), (ErrorValue) => ErrorValue === StateInitializationFailure);
			g_Assert.equal(g_mapAllocations.has(unFailedAllocationAddress), false, "partial ownership state does not leak its allocation");
			g_Assert.equal(unPartialDestructorCalls, 0, "partial initialization does not invoke a destructor on incomplete state");

			g_mapAllocations.delete = function RejectAllocationRelease(unAddress) {
				g_Assert.equal(unAddress, unFailedAllocationAddress, "rollback attempts to free its own allocation");

				return false;
			};

			try {
				g_Assert.throws(() => new FailingBaseInitialization(), (ErrorValue) => {
					g_Assert.equal(ErrorValue instanceof AggregateError, true);
					g_Assert.equal(ErrorValue.errors.length, 2);
					g_Assert.equal(ErrorValue.errors[0], BaseInitializationFailure);
					g_Assert.match(ErrorValue.errors[1].message, /not allocated/);

					return true;
				});
				g_Assert.equal(g_mapAllocations.has(unFailedAllocationAddress), true, "failed native cleanup is not presented as a released allocation");
			} finally {
				RestoreAllocationDelete(OriginalDeleteDescriptor);
			}

			g_Assert.equal(g_RootMemory.Deallocate(unFailedAllocationAddress), true, "release the deliberately retained rollback fixture");
			g_Assert.equal(g_mapAllocations.size, setOriginalAllocationAddresses.size, "custom initialization failure scenarios do not leak fixtures");
		} finally {
			Object.defineProperty(BaseAddress, "RebindAddress", OriginalRebindDescriptor);
			Object.defineProperty(WeakMap.prototype, "set", OriginalWeakMapSetDescriptor);

			for (const unAddress of g_mapAllocations.keys()) {
				if (!setOriginalAllocationAddresses.has(unAddress)) {
					g_Assert.equal(g_RootMemory.Deallocate(unAddress), true, "release a failed assertion's newly owned fixture");
				}
			}
		}
	}

	function CheckCustomTypeCallbackAndPartialReleaseContracts() {
		const unOwnerTypeByteCount = 0x4;
		const unChildAllocationByteCount = 0x1;

		const setOriginalAllocationAddresses = new Set(g_mapAllocations.keys());
		const OriginalDeleteDescriptor = Object.getOwnPropertyDescriptor(g_mapAllocations, "delete");
		const ChildReleaseFailure = new Error("custom child release failure");
		const Manager = new g_RootMemoryManager.TypeManager();
		let unConstructorCalls = 0;
		let unDestructorCalls = 0;

		class CallbackResultOwner extends g_RootMemoryManager.CustomType {
		}

		Manager.DefineType("CallbackResultOwner", CallbackResultOwner, {
			ConstructorCallback() {
				unConstructorCalls++;

				return Promise.resolve("ignored constructor result");
			},

			DestructorCallback() {
				unDestructorCalls++;

				return Promise.resolve("ignored destructor result");
			},

			Size: unOwnerTypeByteCount,
		});

		try {
			const Owner = new CallbackResultOwner();
			g_Assert.equal(Owner instanceof CallbackResultOwner, true, "constructor promise return is not the constructed instance");
			g_Assert.equal(Owner.OwnsAddress, true);
			g_Assert.equal(unConstructorCalls, 1);
			const unOwnerAddress = Owner.Address;
			const unFirstChildAddress = g_RootMemory.Allocate(unChildAllocationByteCount);
			const unSecondChildAddress = g_RootMemory.Allocate(unChildAllocationByteCount);

			Owner.AllocatedAddresses.add(unFirstChildAddress);
			Owner.AllocatedAddresses.add(unSecondChildAddress);
			Owner.AddressValues.set("Retained", "child release failed");
			g_mapAllocations.delete = function RejectSecondChildRelease(unAddress) {
				if (unAddress === unSecondChildAddress) {
					throw ChildReleaseFailure;
				}

				return Map.prototype.delete.call(this, unAddress);
			};

			try {
				g_Assert.throws(() => Owner.Deallocate(), (Failure) => Failure === ChildReleaseFailure);
			} finally {
				RestoreAllocationDelete(OriginalDeleteDescriptor);
			}

			g_Assert.equal(g_mapAllocations.has(unFirstChildAddress), false, "completed child release is not rolled back");
			g_Assert.equal(Owner.AllocatedAddresses.has(unFirstChildAddress), false);
			g_Assert.equal(g_mapAllocations.has(unSecondChildAddress), true);
			g_Assert.equal(Owner.AllocatedAddresses.has(unSecondChildAddress), true);
			g_Assert.equal(g_mapAllocations.has(unOwnerAddress), true);
			g_Assert.equal(Owner.Address, unOwnerAddress);
			g_Assert.equal(Owner.OwnsAddress, true);
			g_Assert.equal(Owner.AddressValues.get("Retained"), "child release failed");
			g_Assert.equal(unDestructorCalls, 1);

			g_Assert.equal(Owner.Deallocate(), true, "promise-returning destructor does not make release asynchronous");
			g_Assert.equal(Owner.Address, 0n);
			g_Assert.equal(Owner.OwnsAddress, false);
			g_Assert.equal(Owner.AllocatedAddresses.size, 0);
			g_Assert.equal(Owner.AddressValues.size, 0);
			g_Assert.equal(unDestructorCalls, 1, "retry does not invoke a completed destructor twice");
			g_Assert.equal(Owner.Deallocate(), false);
		} finally {
			RestoreAllocationDelete(OriginalDeleteDescriptor);

			for (const unAddress of g_mapAllocations.keys()) {
				if (!setOriginalAllocationAddresses.has(unAddress)) {
					g_Assert.equal(g_RootMemory.Deallocate(unAddress), true, "release a failed assertion's owned fixture");
				}
			}
		}
	}

	CheckCustomTypeInitializationRollback();
	CheckCustomTypeCallbackAndPartialReleaseContracts();

	function CheckNativeMemoryHelperMetadata() {
		const RawHelpers = g_RootMemoryFixture.RootHelpers;
		const AddressSizeDescriptor = Object.getOwnPropertyDescriptor(RawHelpers, "ADDRESS_SIZE");
		const DataTypesDescriptor = Object.getOwnPropertyDescriptor(RawHelpers, "DATA_TYPES");
		const CacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strMemoryHelpersPath);

		try {
			RawHelpers.ADDRESS_SIZE = String(AddressSizeDescriptor.value);
			delete require.cache[g_strMemoryHelpersPath];
			g_Assert.throws(() => require(g_strMemoryHelpersPath), /positive safe integer/, "memory helpers reject a coerced address size");

			Object.defineProperty(RawHelpers, "ADDRESS_SIZE", AddressSizeDescriptor);
			const vecNativeMemoryDataTypes = DataTypesDescriptor.value;
			RawHelpers.DATA_TYPES = Object.freeze([...vecNativeMemoryDataTypes, vecNativeMemoryDataTypes[0]]);
			delete require.cache[g_strMemoryHelpersPath];
			const MemoryHelpersWithDuplicateType = require(g_strMemoryHelpersPath);
			const unExpectedMemoryDataTypeCount = vecNativeMemoryDataTypes.length + 1;
			g_Assert.equal(MemoryHelpersWithDuplicateType.DATA_TYPES.length, unExpectedMemoryDataTypeCount, "memory helpers native data-type count");
			g_Assert.equal(MemoryHelpersWithDuplicateType.DATA_TYPES.at(-1), vecNativeMemoryDataTypes[0], "memory helpers native data-type order");
		} finally {
			Object.defineProperty(RawHelpers, "ADDRESS_SIZE", AddressSizeDescriptor);
			Object.defineProperty(RawHelpers, "DATA_TYPES", DataTypesDescriptor);

			if (CacheDescriptor === undefined) {
				delete require.cache[g_strMemoryHelpersPath];

			} else {
				Object.defineProperty(require.cache, g_strMemoryHelpersPath, CacheDescriptor);
			}
		}

		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(RawHelpers, "ADDRESS_SIZE"), AddressSizeDescriptor, "metadata test restores the raw address-size descriptor");
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(RawHelpers, "DATA_TYPES"), DataTypesDescriptor, "metadata test restores the raw type-table descriptor");
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(require.cache, g_strMemoryHelpersPath), CacheDescriptor, "metadata test restores the original module-cache entry");
	}

	CheckNativeMemoryHelperMetadata();

	const g_CanonicalMemoryHelpers = g_RootMemoryFixture.Helpers;
	const g_ExpectedTypeValues = {
		Bool: "bool",
		Char: "char",
		UChar: "uchar",
		Short: "short",
		UShort: "ushort",
		Int: "int",
		UInt: "uint",
		Long: "long",
		ULong: "ulong",
		LongLong: "longlong",
		ULongLong: "ulonglong",
		Float: "float",
		Double: "double",
		Address: "address",
		StringAddress: "stringaddress",
		StringArray: "stringarray",
	};
	for (const [strPropertyName, strDataType] of Object.entries(g_ExpectedTypeValues)) {
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_CanonicalMemoryHelpers.Type, strPropertyName), { configurable: true, enumerable: true, value: strDataType, writable: true });
	}

	g_Assert.deepEqual(Object.getOwnPropertyNames(g_CanonicalMemoryHelpers.Type), [
		"length",
		"name",
		"prototype",
		"NormalizeDataType",
		"IsNativeDataType",
		"GetDataTypeSize",
		...Object.keys(g_ExpectedTypeValues),
	]);

	function CheckCallingConventionContracts() {
		const strBindingsSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
		const vecNativeConventionTables = [...strBindingsSource.matchAll(/constexpr char const\* const kCallingConventionNames\[\] = \{([^}]+)\};/g)];
		g_Assert.equal(vecNativeConventionTables.length, 1, "exactly one native calling-convention table is required");

		const vecNativeConventionNames = [...vecNativeConventionTables[0][1].matchAll(/"([^"]+)"/g)].map(vecMatch => vecMatch[1]);
		const strCallManagerSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "MemoryHookManager.cpp"), "utf8");
		const vecAcceptedNativeConventionNames = [...strCallManagerSource.matchAll(/CallRequest\.m_strConvention != "([^"]+)"/g)].map(vecMatch => vecMatch[1]);
		g_Assert.deepEqual(vecNativeConventionNames, ["cdecl", "stdcall", "thiscall", "fastcall"], "native exports contain only supported prototype conventions");
		g_Assert.deepEqual(vecNativeConventionNames, vecAcceptedNativeConventionNames, "native exports and memory.Call rejection guard agree");
		g_Assert.deepEqual(Array.from(g_CanonicalMemoryHelpers.CALLING_CONVENTIONS), vecNativeConventionNames, "the JavaScript fixture mirrors the actual native exports");
		g_Assert.deepEqual(Object.keys(g_RootMemory.Convention), ["Cdecl", "Thiscall", "Stdcall", "Fastcall"], "the public convention enumeration contains only supported entries");
		g_Assert.deepEqual(Object.values(g_RootMemory.Convention).sort(), [...vecNativeConventionNames].sort(), "public memory conventions and native exports agree");

		for (const strConvention of vecNativeConventionNames) {
			g_Assert.equal(g_CanonicalMemoryHelpers.NormalizeConvention(strConvention), strConvention, "supported conventions retain their canonical spelling");
		}

		for (const strConvention of ["sysv", "win64", "CDECL"]) {
			g_Assert.throws(() => g_CanonicalMemoryHelpers.NormalizeConvention(strConvention), /Unknown SourceJS calling convention/, "foreign ABI names and noncanonical casing are rejected");
		}
	}

	function CheckBorrowedViewDocumentationAllocationFailures() {
		const unDocumentationTimeoutMilliseconds = 1000;

		const strDocumentationSource = g_FileSystem.readFileSync(g_strMemoryManagerDocumentationPath, "utf8");
		const vecExampleMatches = [...strDocumentationSource.matchAll(/### `CustomType\.CreateFromAddress`\r?\n[\s\S]*?```js\r?\n([\s\S]*?)\r?\n```/g)];
		g_Assert.equal(vecExampleMatches.length, 1, "exactly one borrowed-view factory example is required");

		const Script = new g_VM.Script('"use strict";\n(() => {\n' + vecExampleMatches[0][1] + '\n})();', { filename: `${g_strMemoryManagerDocumentationPath}:CustomType.CreateFromAddress` });
		for (const AllocationResult of [0n, -0x1n, 42, null, undefined]) {
			const Counters = { CreateView: 0, Read: 0, Deallocate: 0 };
			const Memory = {
				Allocate() {
					return AllocationResult;
				},

				DataType: { Int: "int" },

				Deallocate() {
					Counters.Deallocate += 1;

					return true;
				},
			};

			const Helpers = {
				Read() {
					Counters.Read += 1;
					throw new Error("Reading an invalid allocation is forbidden.");
				},
			};

			const Manager = {
				InstanceAttribute() {
					return {};
				},

				CreateType() {
					return {
						CreateFromAddress() {
							Counters.CreateView += 1;
							throw new Error("Constructing a view over an invalid allocation is forbidden.");
						},
					};
				},
			};

			const Require = strModuleName => {
				switch (strModuleName) {
					case "memory":
						return Memory;

					case "memory/helpers":
						return Helpers;

					case "memory/manager":
						return { Manager };

					default:
						throw new Error(`Unexpected borrowed-view example module: ${strModuleName}`);
				}
			};

			g_Assert.throws(() => Script.runInNewContext({ require: Require, Error }, { timeout: unDocumentationTimeoutMilliseconds }), /The backing allocation failed\./, "borrowed-view documentation rejects invalid allocation results before constructing a view");
			g_Assert.deepEqual(Counters, { CreateView: 0, Read: 0, Deallocate: 0 }, "invalid allocation results never reach native view, read, or cleanup operations");
		}
	}

	CheckCallingConventionContracts();
	CheckBorrowedViewDocumentationAllocationFailures();

	const g_CoercibleMemoryDataType = { toString: () => "int" };
	const g_NormalizeCoercibleMemoryDataType = () => g_CanonicalMemoryHelpers.NormalizeDataType(g_CoercibleMemoryDataType);
	const g_CoercibleCallingConvention = { toString: () => "cdecl" };
	const g_NormalizeCoercibleCallingConvention = () => g_CanonicalMemoryHelpers.NormalizeConvention(g_CoercibleCallingConvention);

	g_Assert.throws(g_NormalizeCoercibleMemoryDataType, /must be a string/, "memory helpers reject coerced data types");
	g_Assert.throws(g_NormalizeCoercibleCallingConvention, /must be a string/, "memory helpers reject coerced conventions");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.Type.IsNativeDataType({}), /must be strings/, "Type.IsNativeDataType rejects non-string names");
	g_Assert.equal(g_CanonicalMemoryHelpers.Type.IsNativeDataType("SmokeCustomType"), false, "Type.IsNativeDataType custom type result");
	g_Assert.equal("Normalize" in g_CanonicalMemoryHelpers.Type, false, "Type.Normalize alias is absent");
	g_Assert.equal("IsNative" in g_CanonicalMemoryHelpers.Type, false, "Type.IsNative alias is absent");
	g_Assert.equal("Size" in g_CanonicalMemoryHelpers.Type, false, "Type.Size alias is absent");
	const g_CanonicalBaseAddress = new g_CanonicalMemoryHelpers.BaseAddress(0n);
	g_Assert.equal("address" in g_CanonicalBaseAddress, false, "BaseAddress address storage is private");
	g_Assert.equal("IsNull" in g_CanonicalBaseAddress, false, "BaseAddress IsNull alias is absent");
	g_Assert.equal(g_CanonicalBaseAddress.Null, true, "BaseAddress null state is canonical");

	const g_CanonicalNonNullAddress = new g_CanonicalMemoryHelpers.BaseAddress(0x5000n);
	g_Assert.equal(g_CanonicalNonNullAddress.Address, 0x5000n, "BaseAddress exposes the exact BigInt address");
	g_Assert.equal(g_CanonicalNonNullAddress.Null, false, "BaseAddress public null accessor matches its storage");
	g_Assert.equal(g_CanonicalNonNullAddress.HasAddress(), true, "BaseAddress detects attached storage");
	g_Assert.equal(g_CanonicalNonNullAddress.Add(0x8n).Address, 0x5008n, "BaseAddress.Add preserves BigInt address arithmetic");
	g_Assert.equal(g_CanonicalNonNullAddress.Subtract(0x8n).Address, 0x4FF8n, "BaseAddress.Subtract preserves BigInt address arithmetic");
	g_Assert.equal(g_CanonicalNonNullAddress.valueOf(), 0x5000n, "BaseAddress preserves the standard valueOf hook");
	g_Assert.equal(g_CanonicalNonNullAddress.toString(), "0x5000", "BaseAddress preserves the standard toString hook");

	// Exercise explicit internal rebinding; the public Address accessor remains read-only.
	g_CanonicalMemoryHelpers.BaseAddress.RebindAddress(g_CanonicalNonNullAddress, 0n);
	g_Assert.equal(g_CanonicalNonNullAddress.Address, 0n, "BaseAddress address accessor follows updates");
	g_Assert.equal(g_CanonicalNonNullAddress.Null, true, "BaseAddress null accessor follows updates");
	g_Assert.equal(g_CanonicalNonNullAddress.HasAddress(), false, "BaseAddress detects detached storage");

	const g_vecMemoryDataKeyContractNames = Object.freeze([
		"Binary",
		"ServerCheck",
		"Size",
		"Offset",
		"TypeName",
		"Length",
		"Level",
		"Accessor",
		"AccessorOffset",
		"Arguments",
		"ReturnType",
		"Convention",
		"Identifier",
		"Documentation",
	]);

	for (const strKeyName of g_vecMemoryDataKeyContractNames) {
		g_Assert.equal(g_CanonicalMemoryHelpers.DataKey[strKeyName], strKeyName, `DataKey.${strKeyName} uses its PascalCase schema key`);
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_CanonicalMemoryHelpers.DataKey, strKeyName), { configurable: true, enumerable: true, value: strKeyName, writable: true });
	}

	g_Assert.deepEqual(Object.getOwnPropertyNames(g_CanonicalMemoryHelpers.DataKey), [
		"length",
		"name",
		"prototype",
		"AsBoolean",
		"AsArguments",
		"AsReturnType",
		"AsIdentifier",
		"AsConvention",
		"AsAttributeType",
		"AsString",
		"AsInteger",
		"AsInt64",
		...g_vecMemoryDataKeyContractNames,
	]);

	const g_DataKeyDefinitions = { TakeDamage: { Offset: "0x130", Arguments: ["address", "float"], ReturnType: "bool" } };
	const g_vecDataKeyDescriptors = [
		[g_CanonicalMemoryHelpers.DataKey.Offset, g_CanonicalMemoryHelpers.DataKey.AsInt64],
		[g_CanonicalMemoryHelpers.DataKey.Arguments, g_CanonicalMemoryHelpers.DataKey.AsArguments],
		[g_CanonicalMemoryHelpers.DataKey.ReturnType, g_CanonicalMemoryHelpers.DataKey.AsReturnType],
	];

	g_Assert.deepEqual([...g_CanonicalMemoryHelpers.ParseData(null, g_DataKeyDefinitions, g_vecDataKeyDescriptors)], [["TakeDamage", [0x130n, ["address", "float"], "bool"]]], "DataKey PascalCase keys preserve native discriminator values and BigInt offsets");
	g_Assert.throws(() => [...g_CanonicalMemoryHelpers.ParseData(null, { TakeDamage: { offset: "0x130" } }, g_vecDataKeyDescriptors)], { name: "KeyError" }, "DataKey does not accept a legacy lowercase Offset alias");
	g_Assert.throws(() => [...g_CanonicalMemoryHelpers.ParseData(null, { TakeDamage: { Offset: "0x130", Arguments: [], returnType: "bool" } }, g_vecDataKeyDescriptors)], { name: "KeyError" }, "DataKey does not accept a legacy camelCase ReturnType alias");

	g_Assert.equal(g_CanonicalMemoryHelpers.DataKey.AsBoolean(null, "TRUE"), true, "DataKey.AsBoolean true text");
	g_Assert.equal(g_CanonicalMemoryHelpers.DataKey.AsBoolean(null, "false"), false, "DataKey.AsBoolean false text");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.DataKey.AsBoolean(null, "yes"), /Cannot convert/, "DataKey.AsBoolean rejects aliases");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.DataKey.AsArguments(null, null), /must be an array/, "DataKey.AsArguments rejects null");
	g_Assert.equal(g_CanonicalMemoryHelpers.DataKey.AsReturnType(null, undefined), "void", "DataKey.AsReturnType undefined default");
	const g_NormalizeNullMemoryReturnType = () => g_CanonicalMemoryHelpers.DataKey.AsReturnType(null, null);
	const g_NormalizeObjectMemoryAttributeType = () => g_CanonicalMemoryHelpers.DataKey.AsAttributeType(null, {});
	const g_NormalizeObjectFunctionIdentifier = () => g_CanonicalMemoryHelpers.DataKey.AsIdentifier(null, {});
	const g_ParsePartialMemoryInteger = () => g_CanonicalMemoryHelpers.DataKey.AsInteger(null, "12invalid");

	g_Assert.throws(g_NormalizeNullMemoryReturnType, /non-empty strings or undefined/, "DataKey.AsReturnType rejects null");
	g_Assert.equal(g_CanonicalMemoryHelpers.DataKey.AsIdentifier(null, 0x5000n), 0x5000n, "DataKey.AsIdentifier BigInt address");
	g_Assert.throws(g_NormalizeObjectFunctionIdentifier, /non-negative BigInt addresses/, "DataKey.AsIdentifier rejects objects");
	g_Assert.throws(g_NormalizeObjectMemoryAttributeType, /non-empty strings/, "DataKey.AsAttributeType strict name");
	g_Assert.equal(g_CanonicalMemoryHelpers.DataKey.AsInteger(null, "-0x20"), -32, "DataKey.AsInteger signed hexadecimal");
	g_Assert.throws(g_ParsePartialMemoryInteger, /Cannot convert/, "DataKey.AsInteger rejects partial text");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.DataKey.AsInteger(null, BigInt(Number.MAX_SAFE_INTEGER) + 1n), /safe JavaScript integer range/, "DataKey.AsInteger rejects unsafe bigints");

	const g_vecSignedInt64MetadataCases = Object.freeze([
		[0n, 0n],
		[-32n, -32n],
		[17, 17n],
		[-17, -17n],
		[" +0x20 ", 32n],
		[" -0X20 ", -32n],
		["+42", 42n],
		["-42", -42n],
		["-0x8000000000000000", -(1n << 63n)],
		["0x7FFFFFFFFFFFFFFF", (1n << 63n) - 1n],
		[-(1n << 63n), -(1n << 63n)],
		[(1n << 63n) - 1n, (1n << 63n) - 1n],
	]);

	for (const vecMetadataCase of g_vecSignedInt64MetadataCases) {
		g_Assert.equal(g_CanonicalMemoryHelpers.DataKey.AsInt64(null, vecMetadataCase[0]), vecMetadataCase[1], "DataKey.AsInt64 preserves exact signed metadata");
	}

	const g_vecInvalidInt64Metadata = Object.freeze([
		null,
		undefined,
		true,
		{},
		[],
		"",
		"12invalid",
		"0x",
		"1.5",
		"--1",
	]);
	for (const InvalidMetadata of g_vecInvalidInt64Metadata) {
		g_Assert.throws(() => g_CanonicalMemoryHelpers.DataKey.AsInt64(null, InvalidMetadata), TypeError, "DataKey.AsInt64 rejects invalid types and incomplete integer text");
	}

	const g_vecOutOfRangeInt64Metadata = Object.freeze([
		1.5,
		NaN,
		Infinity,
		-Infinity,
		Number.MAX_SAFE_INTEGER + 1,
		Number.MIN_SAFE_INTEGER - 1,
		1n << 63n,
		-(1n << 63n) - 1n,
		"9223372036854775808",
		"-9223372036854775809",
	]);
	for (const InvalidMetadata of g_vecOutOfRangeInt64Metadata) {
		g_Assert.throws(() => g_CanonicalMemoryHelpers.DataKey.AsInt64(null, InvalidMetadata), RangeError, "DataKey.AsInt64 rejects fractional, unsafe, and overflowing metadata");
	}

	function VerifyMemoryBytePatternExceptionBoundary(strHelperSource) {
		const nFrameStart = strHelperSource.indexOf("v8::TryCatch MemoryArgumentReadFailure(pIsolate);");
		const nTryStart = strHelperSource.indexOf("\t\ttry {");
		const nStandardCatchStart = strHelperSource.indexOf("\t\t} catch (std::exception const&) {");
		const nCatchStart = strHelperSource.indexOf("\t\t} catch (...) {");
		g_Assert.ok((nFrameStart >= 0) && (nTryStart > nFrameStart) && (nStandardCatchStart > nTryStart) && (nCatchStart > nStandardCatchStart), "native byte-pattern conversion preserves V8 errors across both C++ exception boundaries");

		const vecAllocatingOperations = Object.freeze([
			"vecParsedBytePattern.reserve(",
			"vecParsedBytePattern.push_back(",
			"v8::String::Utf8Value(pIsolate, LocalBytePatternValue)",
			"vecParsedBytePattern.assign(",
		]);
		for (const strOperation of vecAllocatingOperations) {
			const nOperationIndex = strHelperSource.indexOf(strOperation);
			g_Assert.ok((nOperationIndex > nTryStart) && (nOperationIndex < nCatchStart), `native byte-pattern allocation ${strOperation} is protected`);
		}

		const nOutputCommit = strHelperSource.indexOf("vecBytePatternOut.swap(vecParsedBytePattern);");
		g_Assert.ok((nOutputCommit > nTryStart) && (nOutputCommit < nCatchStart), "native byte-pattern output commits only on the successful path");
		g_Assert.match(strHelperSource.slice(nCatchStart), /RethrowV8InstallationFailure\(pIsolate, MemoryArgumentReadFailure, kPatternConversionErrorMessage\);\s*}\s*return false;/, "native byte-pattern failure preserves or translates the V8 error and returns explicit false");
	}

	// Source guards supplement compilation; they do not simulate native V8 allocation failure.
	const g_strNativeMemoryBindings = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
	const g_vecMemoryBytePatternDefinition = /^(\t{1,2})bool RequireMemoryBytePatternFromValue\([^\n]+\) \{$/m.exec(g_strNativeMemoryBindings);
	g_Assert(g_vecMemoryBytePatternDefinition, "native byte-pattern helper source is present");

	const g_unMemoryBytePatternHelperStart = g_vecMemoryBytePatternDefinition.index;
	const g_strMemoryBytePatternIndentation = g_vecMemoryBytePatternDefinition[1];
	const g_strMemoryBytePatternClosingLine = "\n" + g_strMemoryBytePatternIndentation + "}";
	const g_nMemoryBytePatternHelperEnd = g_strNativeMemoryBindings.indexOf(g_strMemoryBytePatternClosingLine + "\n", g_unMemoryBytePatternHelperStart);
	g_Assert.ok(g_nMemoryBytePatternHelperEnd > g_unMemoryBytePatternHelperStart, "native byte-pattern helper source boundary is present");

	const g_unMemoryBytePatternHelperLimit = g_nMemoryBytePatternHelperEnd + g_strMemoryBytePatternClosingLine.length;
	const g_strNativeMemoryBytePatternHelper = g_strNativeMemoryBindings.slice(g_unMemoryBytePatternHelperStart, g_unMemoryBytePatternHelperLimit);
	const g_strMemoryBytePatternContractView = g_strNativeMemoryBytePatternHelper.split("\n").map(strLine => strLine.startsWith(g_strMemoryBytePatternIndentation) ? ("\t" + strLine.slice(g_strMemoryBytePatternIndentation.length)) : strLine).join("\n");
	const g_strMemoryBytePatternRoundTrip = g_strMemoryBytePatternContractView.split("\n").map(strLine => strLine.startsWith("\t") ? (g_strMemoryBytePatternIndentation + strLine.slice(1)) : strLine).join("\n");
	g_Assert.equal(g_strMemoryBytePatternRoundTrip, g_strNativeMemoryBytePatternHelper, "The byte-pattern contract view must round-trip to the exact helper.");
	VerifyMemoryBytePatternExceptionBoundary(g_strMemoryBytePatternContractView);

	const g_vecMemoryBytePatternBoundaryMutations = Object.freeze([
		g_strMemoryBytePatternContractView.replace("\t\ttry {", "\t\t{"),
		g_strMemoryBytePatternContractView.replace("\t\t} catch (...) {", "\t\t}"),
		g_strMemoryBytePatternContractView.replace("\t\t} catch (...) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, MemoryArgumentReadFailure, kPatternConversionErrorMessage);", "\t\t} catch (...) {\n\t\t\treturn true;"),
		g_strMemoryBytePatternContractView.replace("vecBytePatternOut.swap(vecParsedBytePattern);", "vecBytePatternOut.clear();"),
		g_strMemoryBytePatternContractView.replace("v8::TryCatch MemoryArgumentReadFailure(pIsolate);", ""),
		g_strMemoryBytePatternContractView.replace("catch (std::exception const&)", "catch (int)"),
	]);

	for (const strMutatedHelper of g_vecMemoryBytePatternBoundaryMutations) {
		g_Assert.notEqual(strMutatedHelper, g_strMemoryBytePatternContractView, "Each byte-pattern regression must change the contract view.");
		const strActualMutatedHelper = strMutatedHelper.split("\n").map(strLine => strLine.startsWith("\t") ? (g_strMemoryBytePatternIndentation + strLine.slice(1)) : strLine).join("\n");
		const strMutatedSource = g_strNativeMemoryBindings.slice(0, g_unMemoryBytePatternHelperStart) + strActualMutatedHelper + g_strNativeMemoryBindings.slice(g_unMemoryBytePatternHelperLimit);
		g_Assert.notEqual(strMutatedSource, g_strNativeMemoryBindings, "Each byte-pattern regression must change the actual source region.");
		g_Assert.throws(() => VerifyMemoryBytePatternExceptionBoundary(strMutatedHelper), g_Assert.AssertionError, "native byte-pattern source guards reject a broken exception/output boundary");
	}

	const g_strMemorySearchPattern = "A\0Б";
	const g_vecMemorySearchBytes = [0x7F, 0x41, 0x00, 0xD0, 0x91, 0x7F];
	const g_unMemorySearchAddress = g_RootMemory.Allocate(g_vecMemorySearchBytes.length);

	try {
		for (const [unByteOffset, unByteValue] of g_vecMemorySearchBytes.entries()) {
			g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unMemorySearchAddress, g_CanonicalMemoryHelpers.Type.UChar, unByteValue, BigInt(unByteOffset)), true, "search pattern fixture byte initialization");
		}

		const unExpectedMemorySearchAddress = g_unMemorySearchAddress + 0x1n;
		g_Assert.equal(g_CanonicalMemoryHelpers.SearchBytes(g_unMemorySearchAddress, g_strMemorySearchPattern, g_vecMemorySearchBytes.length), unExpectedMemorySearchAddress, "SearchBytes forwards UTF-8 strings with embedded zero bytes");
		g_Assert.equal(g_CanonicalMemoryHelpers.SearchBytes(g_unMemorySearchAddress, [0x41, 0x00, 0xD0, 0x91], g_vecMemorySearchBytes.length), unExpectedMemorySearchAddress, "SearchBytes forwards the equivalent byte array");
		g_Assert.equal(g_CanonicalMemoryHelpers.SearchBytes(g_unMemorySearchAddress, "ZZ", g_vecMemorySearchBytes.length), 0n, "SearchBytes string no-match returns the BigInt sentinel");
	} finally {
		g_Assert.equal(g_RootMemory.Deallocate(g_unMemorySearchAddress), true, "release the string and byte-array search fixture");
	}

	const g_StrictMemberFunction = new g_CanonicalMemoryHelpers.MemberFunction(null, "void", 0x5000n, null, ["address"], "cdecl");
	g_Assert.throws(() => g_StrictMemberFunction.Call(), /expected 1 arguments but received 0/, "MemberFunction argument count");
	g_Assert.equal("options" in g_StrictMemberFunction, false, "MemberFunction has no snapshot options field");
	g_Assert.equal(g_StrictMemberFunction.TypeManager, null, "MemberFunction exposes its type manager explicitly");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.MemberFunction(null, "", 0x5000n), { name: "TypeError", message: "MemberFunction strReturnType must be a non-empty string." }, "member function return-type diagnostic");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.MemberFunction(null, "void", 0x5000n, null, "address", "cdecl"), { name: "TypeError", message: "MemberFunction vecArgumentTypes must be an array." }, "MemberFunction rejects non-array argument types");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.MemberFunction(null, "void", 0x5000n, null, ["void"], "cdecl"), /cannot use the void type/, "MemberFunction rejects void arguments");

	const g_vecLiveMemberArgumentTypes = ["INT"];
	const g_vecMemberConversionCalls = [];

	const g_MemberTypeManager = {
		Convert(strTypeName, unAddressValue) {
			g_Assert.equal(typeof unAddressValue, "bigint", "MemberFunction custom conversion receives an exact BigInt address");
			g_vecMemberConversionCalls.push({ Address: unAddressValue, TypeName: strTypeName });

			return { Address: unAddressValue, TypeName: strTypeName };
		},
	};

	const g_LiveMemberFunction = new g_CanonicalMemoryHelpers.MemberFunction(g_MemberTypeManager, "SmokeMemberResult", 0x5000n, null, g_vecLiveMemberArgumentTypes, "cdecl");
	g_Assert.equal(Object.hasOwn(g_RootMemoryFixture.RootHooks, "Call"), false, "Native hooks fixture must not expose the absent Call export");

	const g_OriginalMemberCall = g_RootMemoryFixture.RootHooks.CallFunction;
	let g_MemberCallOptions = null;

	try {
		g_RootMemoryFixture.RootHooks.CallFunction = function CallFunction(FunctionOptions) {
			g_Assert.equal(this, g_RootMemoryFixture.RootHooks, "MemberFunction preserves the native call receiver");
			g_MemberCallOptions = FunctionOptions;

			if (FunctionOptions.ReturnType === "void") {
				return undefined;
			}

			g_Assert.equal(FunctionOptions.ReturnType, "address");

			return 0x7100n;
		};

		const CustomMemberResult = g_LiveMemberFunction.Call(7);
		g_Assert.deepEqual(CustomMemberResult, { Address: 0x7100n, TypeName: "SmokeMemberResult" }, "MemberFunction custom result");
		g_Assert.equal(g_MemberCallOptions.ReturnType, "address", "MemberFunction custom native return type");
		g_Assert.deepEqual(g_MemberCallOptions.Arguments, [{ Type: "int", Value: 7 }], "MemberFunction preserves normalized integer argument metadata");
		g_Assert.deepEqual(g_vecMemberConversionCalls, [{ Address: 0x7100n, TypeName: "SmokeMemberResult" }], "MemberFunction conversion call");
		g_Assert.equal(g_LiveMemberFunction.ArgumentTypes, g_vecLiveMemberArgumentTypes, "MemberFunction live argument-type identity");

		const vecNativeCallCases = [
			{ TypeName: "bool", Value: true },
			{ TypeName: "char", Value: -1 },
			{ TypeName: "uchar", Value: 255 },
			{ TypeName: "short", Value: -32768 },
			{ TypeName: "ushort", Value: 65535 },
			{ TypeName: "int", Value: -2147483648 },
			{ TypeName: "uint", Value: 4294967295 },
			{ TypeName: "long", Value: -23 },
			{ TypeName: "ulong", Value: 23 },
			{ TypeName: "longlong", Value: -9223372036854775808n },
			{ TypeName: "ulonglong", Value: 18446744073709551615n },
			{ TypeName: "address", Value: 0x5100n },
			{ TypeName: "float", Value: 1.25 },
			{ TypeName: "double", Value: 1.25 },
			{ TypeName: "string", Value: "Text" },
			{ TypeName: "stringaddress", Value: "Text", NativeTypeName: "string" },
			{ TypeName: "stringarray", Value: "Text", NativeTypeName: "string" },
		];
		for (const ArgumentCase of vecNativeCallCases) {
			g_vecLiveMemberArgumentTypes[0] = ArgumentCase.TypeName;
			g_LiveMemberFunction.Call(ArgumentCase.Value);
			g_Assert.deepEqual(g_MemberCallOptions.Arguments, [{ Type: ArgumentCase.NativeTypeName ?? ArgumentCase.TypeName, Value: ArgumentCase.Value }], "MemberFunction preserves every native scalar type and exact value");

			const ScalarCallable = new g_RootMemory.Function(0x5000n, g_RootMemory.Convention.Cdecl, [ArgumentCase.TypeName], g_RootMemory.DataType.Void);
			g_MemberCallOptions = null;
			ScalarCallable.Call(ArgumentCase.Value);
			g_Assert.notEqual(g_MemberCallOptions, null, "Function.Call must reach the current native call handler");
			g_Assert.deepEqual(g_MemberCallOptions.Arguments, [{ Type: ArgumentCase.NativeTypeName ?? ArgumentCase.TypeName, Value: ArgumentCase.Value }], "Function preserves every native scalar type and exact value");
		}

		g_vecLiveMemberArgumentTypes[0] = "FLOAT";
		g_LiveMemberFunction.ReturnType = "VOID";
		g_LiveMemberFunction.Convention = "thiscall";
		Object.defineProperty(g_LiveMemberFunction, "TypeManager", {
			configurable: true,

			get() {
				throw new Error("native MemberFunction return read TypeManager");
			},
		});

		const NativeMemberResult = g_LiveMemberFunction.Call(1.25);
		g_Assert.equal(NativeMemberResult, undefined, "MemberFunction native void result");
		g_Assert.equal(g_MemberCallOptions.ReturnType, "void", "MemberFunction normalized void return type");
		g_Assert.equal(g_MemberCallOptions.Convention, "thiscall", "MemberFunction uses the live convention");
		g_Assert.deepEqual(g_MemberCallOptions.Arguments, [{ Type: "float", Value: 1.25 }], "MemberFunction normalized live float argument");
	} finally {
		g_RootMemoryFixture.RootHooks.CallFunction = g_OriginalMemberCall;
	}

	const g_unStrictWriteAddress = g_RootMemory.Allocate(g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Double));

	try {
		g_Assert.throws(() => g_CanonicalMemoryHelpers.WriteBool(g_unStrictWriteAddress, 1), /boolean/, "WriteBool strict value");
		g_Assert.throws(() => g_CanonicalMemoryHelpers.WriteInt(g_unStrictWriteAddress, "1"), /integer/, "WriteInt strict value");
		g_Assert.throws(() => g_CanonicalMemoryHelpers.WriteUInt(g_unStrictWriteAddress, "1"), /integer/, "WriteUInt strict value");
		g_Assert.throws(() => g_CanonicalMemoryHelpers.WriteFloat(g_unStrictWriteAddress, "1"), /number/, "WriteFloat strict value");
		g_Assert.throws(() => g_CanonicalMemoryHelpers.WriteDouble(g_unStrictWriteAddress, "1"), /number/, "WriteDouble strict value");
	} finally {
		g_Assert.equal(g_RootMemory.Deallocate(g_unStrictWriteAddress), true, "release the strict scalar-write fixture");
	}

	const g_ParseDataDefinition = { Sample: { Value: "1" } };
	g_Assert.throws(() => g_CanonicalMemoryHelpers.ParseData(null, g_ParseDataDefinition, [{ Convert: Number.parseInt, Name: "Value" }]), /must be arrays/, "ParseData rejects object descriptors");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.ParseData(null, g_ParseDataDefinition, [["Value", null]]), /must be a function/, "ParseData rejects missing converters");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.ParseData(null, null, []), { name: "TypeError", message: "ParseData Definitions must be an object." }, "ParseData rejects a null definition collection");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.ParseData(null, [], []), { name: "TypeError", message: "ParseData Definitions must be an object." }, "ParseData rejects an array definition collection");
	g_Assert.throws(() => g_CanonicalMemoryHelpers.ParseData(null, g_ParseDataDefinition, null), { name: "TypeError", message: "ParseData vecKeyDescriptors must be an array." }, "ParseData rejects a null descriptor collection");

	const g_ParseDataTypeManager = {};
	const g_vecParseDataConversionCalls = [];
	const g_LiveParseDataDefinitions = Object.create({ Inherited: { Value: "0" } });
	const g_LiveParseDataDefinition = { Value: "1" };
	const g_vecLiveParseDataDescriptors = [
		[
			"Value",
			(TypeManager, DescriptorValue) => {
				g_vecParseDataConversionCalls.push({ DescriptorValue, TypeManager });

				return Number.parseInt(DescriptorValue, 10);
			},
		],
	];

	g_LiveParseDataDefinitions.Sample = g_LiveParseDataDefinition;

	const g_itLiveParseData = g_CanonicalMemoryHelpers.ParseData(g_ParseDataTypeManager, g_LiveParseDataDefinitions, g_vecLiveParseDataDescriptors);
	g_Assert.equal(Array.isArray(g_itLiveParseData), false, "ParseData returns an iterator instead of a row snapshot");
	g_LiveParseDataDefinition.Value = "2";
	g_vecLiveParseDataDescriptors[0][0] = "Missing";
	g_Assert.deepEqual(g_itLiveParseData.next(), { done: false, value: ["Sample", [2]] }, "ParseData reads live definition values through its owned schema");
	g_Assert.deepEqual(g_vecParseDataConversionCalls, [{ DescriptorValue: "2", TypeManager: g_ParseDataTypeManager }], "ParseData forwards the exact type manager and live descriptor value");
	g_Assert.deepEqual(g_itLiveParseData.next(), { done: true, value: undefined }, "ParseData ignores inherited definitions");

	const g_ParseDataDefaultValue = {};
	const g_itParseDataDefault = g_CanonicalMemoryHelpers.ParseData(null, { Sample: {} }, [
		["Optional", () => {
			throw new Error("ParseData converted a default value");
		}, g_ParseDataDefaultValue],
	]);
	const g_ParseDataDefaultRow = g_itParseDataDefault.next();
	g_Assert.equal(g_ParseDataDefaultRow.value[1][0], g_ParseDataDefaultValue, "ParseData preserves an exact default value");

	const g_itMalformedParseData = g_CanonicalMemoryHelpers.ParseData(null, { Sample: null }, [["Value", Number.parseInt]]);
	g_Assert.throws(() => g_itMalformedParseData.next(), /Descriptor data must be an object/, "ParseData rejects null descriptor data");

	g_Assert.throws(() => new g_CanonicalMemoryHelpers.ArrayView(null, "false", g_CanonicalMemoryHelpers.Type.Int, 0n, 1), { name: "TypeError", message: "ArrayView bIsAddressArray must be a boolean." }, "ArrayView rejects coerced address-array flags");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n, "1"), { name: "RangeError", message: "ArrayView unArrayLength must be a non-negative safe integer or null." }, "ArrayView rejects coerced lengths");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n, 1, []), { name: "TypeError", message: "ArrayView setAllocatedAddresses must be a Set or null." }, "ArrayView rejects malformed allocation ownership");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n, 1, null, []), { name: "TypeError", message: "ArrayView mapAddressValues must be a Map." }, "ArrayView rejects malformed address-value retention");
	g_Assert.throws(() => new g_CanonicalMemoryHelpers.ArrayView(null, false, "", 0n, 1), { name: "TypeError", message: "ArrayView strTypeName must be a non-empty string." }, "ArrayView type-name diagnostic");

	const g_unStrictArrayIndexAddress = g_RootMemory.Allocate(g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int));

	try {
		const StrictArrayIndexView = new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, g_unStrictArrayIndexAddress, 1);
		g_Assert.throws(() => StrictArrayIndexView.At("0"), /non-negative safe integers/, "ArrayView rejects coerced indexes");
		g_Assert.equal(StrictArrayIndexView[0], undefined, "ArrayView has no Proxy index access");
		g_Assert.equal(StrictArrayIndexView.TypeManager, null, "ArrayView public type-manager property");
		g_Assert.equal("manager" in StrictArrayIndexView, false, "ArrayView has no generic manager field");
	} finally {
		g_Assert.equal(g_RootMemory.Deallocate(g_unStrictArrayIndexAddress), true, "release the strict array-index fixture");
	}

	class StrictArrayCustomType {
	}

	StrictArrayCustomType.TypeSize = 0x4;

	const g_StrictArrayTypeManager = {
		GetClass(strTypeName) {
			g_Assert.equal(this, g_StrictArrayTypeManager, "ArrayView preserves the type-manager receiver");
			g_Assert.equal(strTypeName, "StrictArrayCustomType", "ArrayView forwards the custom type name");

			return StrictArrayCustomType;
		},
	};

	const g_StrictCustomArrayView = new g_CanonicalMemoryHelpers.ArrayView(g_StrictArrayTypeManager, false, "StrictArrayCustomType", 0n);
	g_Assert.equal(g_StrictCustomArrayView.GetOffset(2), 0x8n, "ArrayView uses the live custom type size");
	StrictArrayCustomType.TypeSize = 0;
	g_Assert.throws(() => g_StrictCustomArrayView.GetOffset(0), /positive safe integer/, "ArrayView rejects malformed live custom type sizes");

	const g_LargeOffsetArrayView = new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n);
	const g_StrictAddressArrayView = new g_CanonicalMemoryHelpers.ArrayView(null, true, g_CanonicalMemoryHelpers.Type.Int, 0n, 1);

	g_Assert.throws(() => {
		g_StrictAddressArrayView.TypeName = null;
	}, TypeError, "ArrayView type names remain read-only");
	g_Assert.throws(() => {
		g_StrictAddressArrayView.AddressArray = "true";
	}, TypeError, "ArrayView address-array flags remain read-only");
	g_Assert.equal(g_StrictAddressArrayView.GetOffset(0), 0n, "Rejected metadata assignments preserve the view");

	g_Assert.equal(g_LargeOffsetArrayView.GetOffset(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER) * BigInt(g_RootMemory.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int)), "ArrayView preserves large element offsets as BigInt");

	const g_LiveArrayLengthView = new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n, 2);
	const g_itLiveArrayKey = g_LiveArrayLengthView.Keys();
	g_Assert.deepEqual(g_itLiveArrayKey.next(), { done: false, value: 0 }, "ArrayView keys first live index");
	g_Assert.throws(() => {
		g_LiveArrayLengthView.Length = 3;
	}, TypeError, "ArrayView length is fixed at construction");
	g_Assert.deepEqual(g_itLiveArrayKey.next(), { done: false, value: 1 }, "ArrayView keys next declared index");
	g_Assert.deepEqual(g_itLiveArrayKey.next(), { done: true, value: undefined }, "ArrayView keys completion");
	g_Assert.deepEqual(g_itLiveArrayKey.next(), { done: true, value: undefined }, "ArrayView keys remains complete");
	const g_LengthlessArrayView = new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n);
	g_Assert.throws(() => g_LengthlessArrayView.Keys(), /length/, "ArrayView keys rejects an omitted length");
	g_Assert.throws(() => g_LengthlessArrayView.Entries(), /length/, "ArrayView entries rejects an omitted length");
	g_Assert.throws(() => g_LengthlessArrayView.Values(), /length/, "ArrayView values rejects an omitted length");
	g_Assert.throws(() => g_LengthlessArrayView.ForEach(() => undefined), /length/, "ArrayView ForEach rejects an omitted length");
	g_Assert.throws(() => g_LengthlessArrayView.ToArray(), /length/, "ArrayView ToArray rejects an omitted length");

	const g_LiveArrayEntryView = new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n, 2);
	let g_bFailArrayEntryRead = true;

	g_LiveArrayEntryView.At = function At(unArrayIndex) {
		g_Assert.equal(this, g_LiveArrayEntryView, "ArrayView entries preserves the view receiver");

		if (g_bFailArrayEntryRead) {
			throw new Error("ArrayView entry read failed");
		}

		return 100 + unArrayIndex;
	};

	const g_itLiveArrayEntry = g_LiveArrayEntryView.Entries();
	g_Assert.throws(() => g_itLiveArrayEntry.next(), /entry read failed/, "ArrayView entries propagates read failures");
	g_bFailArrayEntryRead = false;
	g_Assert.deepEqual(g_itLiveArrayEntry.next(), { done: false, value: [0, 100] }, "ArrayView entries retries the failed index");
	g_Assert.deepEqual(g_itLiveArrayEntry.next(), { done: false, value: [1, 101] }, "ArrayView entries reads the next declared index");
	g_Assert.deepEqual(g_itLiveArrayEntry.next(), { done: true, value: undefined }, "ArrayView entries completion");
	g_Assert.deepEqual(g_itLiveArrayEntry.next(), { done: true, value: undefined }, "ArrayView entries remains complete");

	const g_LiveArrayValueView = new g_CanonicalMemoryHelpers.ArrayView(null, false, g_CanonicalMemoryHelpers.Type.Int, 0n, 2);
	g_LiveArrayValueView.At = function At(unArrayIndex) {
		g_Assert.equal(this, g_LiveArrayValueView, "ArrayView values preserves the view receiver");

		return 200 + unArrayIndex;
	};

	const g_itLiveArrayValue = g_LiveArrayValueView.Values();
	g_Assert.deepEqual(g_itLiveArrayValue.next(), { done: false, value: 200 }, "ArrayView values first live element");
	g_Assert.deepEqual(g_itLiveArrayValue.next(), { done: false, value: 201 }, "ArrayView values reads the next declared index");
	g_Assert.deepEqual(g_itLiveArrayValue.next(), { done: true, value: undefined }, "ArrayView values completion");
	g_Assert.deepEqual(g_itLiveArrayValue.next(), { done: true, value: undefined }, "ArrayView values remains complete");

	const g_ArrayForEachReceiver = {};
	const g_vecArrayForEachCalls = [];

	g_LiveArrayValueView.ForEach(function ForEach(ElementValue, unArrayIndex, ArrayView) {
		g_vecArrayForEachCalls.push({ ArrayIndex: unArrayIndex, ArrayView, ElementValue, Receiver: this });
	}, g_ArrayForEachReceiver);
	g_Assert.deepEqual(
		g_vecArrayForEachCalls,
		[
			{ ArrayIndex: 0, ArrayView: g_LiveArrayValueView, ElementValue: 200, Receiver: g_ArrayForEachReceiver },
			{ ArrayIndex: 1, ArrayView: g_LiveArrayValueView, ElementValue: 201, Receiver: g_ArrayForEachReceiver },
		],
		"ArrayView ForEach callback contract");

	let g_unCustomAddressSlot = 0n;
	let g_unCustomArrayTargetAddress = 0n;
	const g_mapCustomArrayAddressValues = new Map();
	const g_CustomAddressArrayManager = {
		Convert(strTypeName, unAddressValue) {
			g_Assert.equal(this, g_CustomAddressArrayManager, "ArrayView preserves the conversion receiver");
			g_Assert.equal(strTypeName, "RetainedCustomArrayValue", "ArrayView forwards the converted type name");

			return { Address: unAddressValue, TypeName: strTypeName };
		},
	};

	try {
		g_unCustomAddressSlot = g_RootMemory.Allocate(g_CanonicalMemoryHelpers.ADDRESS_SIZE);
		g_unCustomArrayTargetAddress = g_RootMemory.Allocate(g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int));
		const RetainedCustomArrayValue = { Address: g_unCustomArrayTargetAddress };
		const ReplacementCustomArrayValue = { Address: g_unCustomArrayTargetAddress };
		const CustomAddressArrayView = new g_CanonicalMemoryHelpers.ArrayView(g_CustomAddressArrayManager, true, "RetainedCustomArrayValue", g_unCustomAddressSlot, 1, null, g_mapCustomArrayAddressValues);
		g_Assert.equal(CustomAddressArrayView.Set(0, RetainedCustomArrayValue), CustomAddressArrayView, "custom address ArrayView set result");
		g_Assert.equal(g_CanonicalMemoryHelpers.ReadAddress(g_unCustomAddressSlot), g_unCustomArrayTargetAddress, "custom address ArrayView memory value");
		g_Assert.equal(g_mapCustomArrayAddressValues.get(g_unCustomAddressSlot), RetainedCustomArrayValue, "custom address ArrayView retention");
		g_Assert.deepEqual(CustomAddressArrayView.At(0), { Address: g_unCustomArrayTargetAddress, TypeName: "RetainedCustomArrayValue" }, "custom address ArrayView conversion");
		g_Assert.equal(CustomAddressArrayView.Add(BigInt(g_CanonicalMemoryHelpers.ADDRESS_SIZE)).AddressValues, g_mapCustomArrayAddressValues, "shifted ArrayView retention identity");

		const OriginalArrayWrite = g_RootMemoryFixture.RootHelpers.Write;

		try {
			g_RootMemoryFixture.RootHelpers.Write = () => false;
			g_Assert.throws(() => CustomAddressArrayView.Set(0, ReplacementCustomArrayValue), /could not store its custom element address/, "custom address ArrayView write failure");
			g_Assert.equal(g_mapCustomArrayAddressValues.get(g_unCustomAddressSlot), RetainedCustomArrayValue, "custom address ArrayView retention rollback");
		} finally {
			g_RootMemoryFixture.RootHelpers.Write = OriginalArrayWrite;
		}
	} finally {
		try {
			if (g_unCustomArrayTargetAddress !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(g_unCustomArrayTargetAddress), true, "release the custom array target");
			}
		} finally {
			if (g_unCustomAddressSlot !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(g_unCustomAddressSlot), true, "release the custom array address slot");
			}
		}
	}

	const g_unAllocatedAddressSlot = g_RootMemory.Allocate(g_CanonicalMemoryHelpers.ADDRESS_SIZE);
	const g_setAllocatedArrayAddresses = new Set();
	const g_AllocatingAddressArrayView = new g_CanonicalMemoryHelpers.ArrayView(null, true, g_CanonicalMemoryHelpers.Type.Int, g_unAllocatedAddressSlot, 1, g_setAllocatedArrayAddresses);
	const g_OriginalAllocationWrite = g_RootMemoryFixture.RootHelpers.Write;
	const g_OriginalAllocationDeallocate = g_RootMemoryFixture.NativeMemory.Deallocate;
	let g_unRolledBackArrayAddress = 0n;
	g_Assert.equal(g_unRolledBackArrayAddress, 0n, "allocation rollback starts with an exact BigInt null address");

	try {
		g_RootMemoryFixture.RootHelpers.Write = () => false;
		g_RootMemoryFixture.NativeMemory.Deallocate = function Deallocate(unAddressValue) {
			g_unRolledBackArrayAddress = unAddressValue;

			return g_OriginalAllocationDeallocate.call(this, unAddressValue);
		};

		g_Assert.throws(() => g_AllocatingAddressArrayView.Set(0, 27), /could not store its allocated element address/, "native address ArrayView allocation write failure");
		g_Assert.equal((typeof g_unRolledBackArrayAddress === "bigint") && (g_unRolledBackArrayAddress > 0n), true, "native address ArrayView rollback address");
		g_Assert.equal(g_setAllocatedArrayAddresses.size, 0, "native address ArrayView allocation ownership rollback");
	} finally {
		g_RootMemoryFixture.RootHelpers.Write = g_OriginalAllocationWrite;
		g_RootMemoryFixture.NativeMemory.Deallocate = g_OriginalAllocationDeallocate;
		g_Assert.equal(g_RootMemory.Deallocate(g_unAllocatedAddressSlot), true, "release the allocating array address slot");
	}

	g_Assert.deepEqual(Object.keys(g_RootMemory).sort(), [
		"Allocate",
		"AllocateObject",
		"BinaryFile",
		"Convention",
		"CopyObjectToAddress",
		"CopyAddressToObject",
		"DataType",
		"Deallocate",
		"Function",
		"FunctionInfo",
		"GameData",
		"GetClass",
		"GetClassInfo",
		"GetClassName",
		"GetDataTypeSize",
		"GetFunctionInfo",
		"GetObjectAddress",
		"GetVirtualFunction",
		"Helpers",
		"MakeObject",
		"Manager",
		"NULL",
		"ObjectType",
		"ObjectTypeInfo",
		"ObjectTypeSize",
		"Address",
		"Protection",
		"Reallocate",
		"Register",
		"RegisterObjectType",
		"TYPE_SIZES",
	].sort(), "root memory export inventory");
	g_Assert.equal(g_RootMemory.GameData, g_RootMemoryFixture.RootGameData, "root memory GameData identity");
	g_Assert.equal(g_RootMemoryManager, require(g_strMemoryManagerPath), "root memory manager identity");
	g_Assert.equal(g_RootMemory, g_RootMemoryFixture.NativeMemory, "root memory native runtime identity");
	g_Assert.equal(g_RootMemory.Allocate, g_RootMemoryFixture.NativeMemory.Allocate, "root memory native allocation identity");

	try {
		g_RootMemoryFixture.NativeMemory.LiveNativeMemoryValue = 37;
		g_Assert.equal(g_RootMemory.LiveNativeMemoryValue, 37, "root memory live native field visibility");
	} finally {
		g_Assert.equal(Reflect.deleteProperty(g_RootMemoryFixture.NativeMemory, "LiveNativeMemoryValue"), true);
	}

	const g_unOverlapByteCount = 0x8;

	const g_OverlapAddress = new g_RootMemory.Address(0x64n);
	g_Assert.equal(g_OverlapAddress.IsOverlapping(0x68n, g_unOverlapByteCount), true, "Address.IsOverlapping intersecting ranges");
	g_Assert.equal(g_OverlapAddress.IsOverlapping(0x6Cn, g_unOverlapByteCount), false, "Address.IsOverlapping adjacent ranges");
	g_Assert.throws(() => g_OverlapAddress.IsOverlapping(0x68n, "8"), /positive safe integer/, "Address.IsOverlapping strict size type");
	g_Assert.throws(() => g_OverlapAddress.IsOverlapping(0x68n, 0), /positive safe integer/, "Address.IsOverlapping positive size");

	g_Assert.throws(() => new g_RootMemory.FunctionInfo({ IsVirtual: null }), /IsVirtual/, "FunctionInfo strict virtual flag");
	g_Assert.throws(() => new g_RootMemory.FunctionInfo({ ThisAddressOffset: null }), /ThisAddressOffset/, "FunctionInfo strict this address offset");
	g_Assert.throws(() => new g_RootMemory.FunctionInfo({ VTableIndex: null }), /VTableIndex/, "FunctionInfo strict vtable index");
	g_Assert.throws(() => new g_RootMemory.FunctionInfo({ VTableOffset: null }), /VTableOffset/, "FunctionInfo strict vtable offset");
	g_Assert.throws(() => new g_RootMemory.FunctionInfo({ CallingConvention: null }), /CallingConvention/, "FunctionInfo strict convention");

	const g_vecFunctionArgumentTypes = [g_RootMemory.DataType.StringAddress, g_RootMemory.DataType.Address];
	const g_StrictFunction = new g_RootMemory.Function(0x1400n, g_RootMemory.Convention.Cdecl, g_vecFunctionArgumentTypes, g_RootMemory.DataType.Address);
	g_Assert.equal(g_StrictFunction.ArgumentTypes, g_StrictFunction.SignatureArgumentTypes, "Function shared normalized signature arguments");
	g_Assert.throws(() => new g_RootMemory.Function(0x1400n, g_RootMemory.Convention.Cdecl, [], g_RootMemory.DataType.Address, {}), /ReturnConverter/, "Function strict return converter");

	g_StrictFunction.ReturnConverter = {};
	g_Assert.throws(() => g_StrictFunction.Call("ServerGameDLL005", 0n), /ReturnConverter/, "Function live return converter validation");
	g_StrictFunction.ReturnConverter = null;

	const g_unActiveHookCountBeforeInvalidCallback = g_RootMemoryFixture.ActiveHookCount();

	g_Assert.throws(() => g_StrictFunction.AddHook(g_RootMemoryFixture.RootHooks.HookType.Pre, null), /HookCallback/, "Function strict hook callback");
	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeInvalidCallback, "Function invalid callback hook isolation");

	const g_StrictHookCallback = () => undefined;
	let g_RetainedHookHandle = null;
	let g_RetainedHookRemoveDescriptor = null;

	try {
		g_Assert.equal(g_StrictFunction.AddPreHook(g_StrictHookCallback), true, "Function native hook registration");
		g_RetainedHookHandle = g_StrictFunction.Hook;
		g_RetainedHookRemoveDescriptor = Object.getOwnPropertyDescriptor(g_RetainedHookHandle, "Remove");

		try {
			g_RetainedHookHandle.Remove = () => false;
			g_Assert.equal(g_StrictFunction.RemoveHook(), false, "Function failed native hook removal result");
			g_Assert.equal(g_StrictFunction.Hook, g_RetainedHookHandle, "Function failed native hook removal ownership");
		} finally {
			Object.defineProperty(g_RetainedHookHandle, "Remove", g_RetainedHookRemoveDescriptor);
		}

		g_Assert.equal(g_StrictFunction.RemoveHook(), true, "Function native hook removal retry");
		g_Assert.equal(g_StrictFunction.Hook, null, "Function successful native hook removal state");
	} finally {
		try {
			if (g_RetainedHookHandle !== null) {
				Object.defineProperty(g_RetainedHookHandle, "Remove", g_RetainedHookRemoveDescriptor);
			}
		} finally {
			if (g_StrictFunction.Hook !== null) {
				g_Assert.equal(g_StrictFunction.RemoveHook(), true, "release the hook after a failed assertion");
			}
		}
	}

	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeInvalidCallback, "Function native hook cleanup");
	g_Assert.throws(() => g_StrictFunction.RemoveHook(g_RootMemoryFixture.RootHooks.HookType.Pre), /requires HookCallback/, "Function strict hook removal arguments");

	class InvalidObjectTypeSize {
	}

	g_Assert.throws(() => g_RootMemory.RegisterObjectType("InvalidObjectTypeSize", InvalidObjectTypeSize, { Size: "4" }), /positive safe integer/, "RegisterObjectType strict explicit size");
	g_Assert.equal(g_RootMemory.ObjectType("InvalidObjectTypeSize"), null, "RegisterObjectType validation before registry mutation");

	class FunctionMetadataType {
		constructor(unAddress) {
			this.Address = unAddress;
		}

		static CreateFromAddress(unAddress) {
			return new FunctionMetadataType(unAddress);
		}
	}

	g_RootMemory.RegisterObjectType("FunctionMetadataType", FunctionMetadataType, {
		ClassInfo: {
			Run: [{ ArgumentTypes: [], ReturnType: g_RootMemory.DataType.Void }],
		},
		Size: null,
	});

	const g_FunctionMetadataRecord = g_RootMemory.ObjectTypeInfo("FunctionMetadataType");
	g_Assert.equal(g_RootMemory.GetFunctionInfo("FunctionMetadataType", "Run"), g_FunctionMetadataRecord.ClassInfo.Run[0], "live function metadata");

	Object.setPrototypeOf(g_FunctionMetadataRecord.ClassInfo, { Inherited: g_FunctionMetadataRecord.ClassInfo.Run });
	g_Assert.throws(() => g_RootMemory.GetFunctionInfo("FunctionMetadataType", "Inherited"), /Unknown SourceJS function info/, "function metadata own-property lookup");

	g_FunctionMetadataRecord.ClassInfo.Run = [];
	g_Assert.throws(() => g_RootMemory.GetFunctionInfo("FunctionMetadataType", "Run"), /function info is malformed/, "live malformed function metadata");

	let g_unSourceAddressForSingleRead = 0n;
	let g_unDestinationAddressForSingleRead = 0n;
	let g_unGetMemoryAddressMethodReadCount = 0;
	let g_unGetMemoryAddressCallCount = 0;
	const g_SingleReadAddress = {};
	Object.defineProperty(g_SingleReadAddress, "GetMemoryAddress", {
		get() {
			g_unGetMemoryAddressMethodReadCount += 1;

			return function GetMemoryAddress() {
				g_unGetMemoryAddressCallCount += 1;

				return g_unSourceAddressForSingleRead;
			};
		},
	});

	try {
		g_unSourceAddressForSingleRead = g_RootMemory.Allocate(g_RootMemory.TYPE_SIZES.address);
		g_unDestinationAddressForSingleRead = g_RootMemory.Allocate(g_RootMemory.TYPE_SIZES.address);
		g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unSourceAddressForSingleRead, g_RootMemory.DataType.Address, 0x1400n), true, "initialize the single-read source address");
		g_Assert.equal(g_RootMemory.CopyObjectToAddress(g_SingleReadAddress, g_unDestinationAddressForSingleRead, "Address"), g_unDestinationAddressForSingleRead, "CopyObjectToAddress returns the destination BigInt address");

		g_Assert.equal(g_unGetMemoryAddressMethodReadCount, 1, "CopyObjectToAddress GetMemoryAddress method read count");
		g_Assert.equal(g_unGetMemoryAddressCallCount, 1, "CopyObjectToAddress GetMemoryAddress call count");
		g_Assert.equal(g_CanonicalMemoryHelpers.Read(g_unDestinationAddressForSingleRead, g_RootMemory.DataType.Address), 0x1400n, "CopyObjectToAddress single-read address copy");
	} finally {
		try {
			if (g_unSourceAddressForSingleRead !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(g_unSourceAddressForSingleRead), true, "release the single-read source");
			}
		} finally {
			if (g_unDestinationAddressForSingleRead !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(g_unDestinationAddressForSingleRead), true, "release the single-read destination");
			}
		}
	}

	g_Assert.equal(g_RootMemoryManager.ScanBinary("server", "55 8B EC ? ?"), 0x1200n, "scan address");
	g_Assert.equal(g_RootMemoryManager.ScanBinary("server", "DE AD BE EF"), null, "missing signature");
	g_Assert.equal(g_RootMemoryManager.GetBinarySymbol("server", "CreateInterface"), 0x1400n, "symbol address");
	g_Assert.equal(g_RootMemoryManager.GetBinarySymbol("server", "MissingExport"), null, "missing symbol");
	g_Assert.deepEqual(g_RootMemoryManager.CreateGameDataCallableOptions("l4d2/server", "UTIL_Remove"), { Arguments: ["address"], Convention: "cdecl", Address: 0x1600n, ReturnType: "void" }, "native call and hook options");

	for (const strRemovedMemoryManagerMember of [
		"Get",
		"GetDataRootPath",
		"GetFiles",
		"GetOffset",
		"GetOptions",
		"GetAddress",
		"GetRootPath",
		"GetSignature",
		"GetSymbol",
		"GetBinaries",
		"Load",
		"Resolve",
		"Scan",
		"Select",
	]) {
		g_Assert.equal(strRemovedMemoryManagerMember in g_RootMemoryManager, false, `memory/manager must not expose ${strRemovedMemoryManagerMember} alias`);
	}

	g_Assert.equal("callOptions" in g_RootMemoryManager, false, "memory manager must not expose callOptions");
	g_Assert.equal("createGlobalAddressesFromGamedata" in g_RootMemoryManager, false, "memory manager must not expose global-address forwarding alias");
	g_Assert.equal("createTypeFromGamedata" in g_RootMemoryManager, false, "memory manager must not expose type forwarding alias");
	g_Assert.equal("functionOptions" in g_RootMemoryManager, false, "memory manager must not expose functionOptions");
	g_Assert.equal("hookOptions" in g_RootMemoryManager, false, "memory manager must not expose hookOptions");
	g_Assert.equal("reload" in g_RootMemoryManager, false, "memory manager must not expose reload");
	g_Assert.equal("findSignature" in g_RootMemoryManager, false, "memory manager must not export findSignature");
	g_Assert.equal("findSymbol" in g_RootMemoryManager, false, "memory manager must not export findSymbol");
	g_Assert.equal("moduleName" in g_RootMemoryManager, false, "memory manager must not export moduleName");
	g_Assert.deepEqual(g_RootMemoryFixture.ManagerCalls, [
		["SCAN", "server", "55 8B EC ? ?"],
		["SCAN", "server", "DE AD BE EF"],
		["SYMBOL", "server", "CreateInterface"],
		["SYMBOL", "server", "MissingExport"],
		["SYMBOL", "server", "UTIL_Remove"],
	], "memory manager lookup calls");

	const g_unManagedDefinitionMinimumByteCount = 0x1;
	const g_unManagedDefinitionIntegerByteCount = 0x4;

	class SmokeManagedType extends g_RootMemoryManager.CustomType {
	}

	class SmokeStableConstructorName extends g_RootMemoryManager.CustomType {
	}

	class SmokeDescriptorOverride extends g_RootMemoryManager.CustomType {
	}

	class SmokeCreatedBaseType extends g_RootMemoryManager.CustomType {
	}

	class SmokeAtomicDefinition extends g_RootMemoryManager.CustomType {
	}

	class SmokeNullPropertiesDefinition extends g_RootMemoryManager.CustomType {
	}

	g_RootMemoryManager.Manager.DefineType("SmokeManagedType", SmokeManagedType, { Size: g_unManagedDefinitionIntegerByteCount });

	const g_StrictDefinitionManager = new g_RootMemoryManager.TypeManager();
	let g_unExplicitBinaryFallbackReadCount = 0;

	Object.defineProperty(SmokeDescriptorOverride, "Binary", {
		configurable: true,

		get() {
			g_unExplicitBinaryFallbackReadCount += 1;

			return "fallback";
		},
	});

	g_StrictDefinitionManager.DefineType("SmokeStableRegistryName", SmokeStableConstructorName, { Size: g_unManagedDefinitionMinimumByteCount });
	g_Assert.equal(SmokeStableConstructorName.name, "SmokeStableConstructorName", "DefineType constructor name preservation");

	g_StrictDefinitionManager.DefineType("SmokeDescriptorOverride", SmokeDescriptorOverride, { Binary: "server", Size: g_unManagedDefinitionMinimumByteCount });
	g_Assert.equal(g_unExplicitBinaryFallbackReadCount, 0, "DefineType explicit metadata skips constructor fallback access");

	const g_SmokeCreatedType = g_StrictDefinitionManager.CreateType("SmokeCreatedType", { Size: g_unManagedDefinitionMinimumByteCount }, SmokeCreatedBaseType);
	let g_unAttributeSectionReadCount = 0;
	const g_GetterTypeDefinition = { Size: g_unManagedDefinitionIntegerByteCount };
	Object.defineProperty(g_GetterTypeDefinition, "InstanceAttribute", {
		enumerable: true,

		get() {
			g_unAttributeSectionReadCount += 1;

			return {
				Value: {
					Offset: 0,
					TypeName: g_RootMemory.DataType.Int,
				},
			};
		},
	});

	g_StrictDefinitionManager.CreateTypeFromObject("SmokeGetterType", g_GetterTypeDefinition);

	g_Assert.equal(g_SmokeCreatedType.name, "SmokeCreatedType", "CreateType computed class name");
	g_Assert.equal(g_unAttributeSectionReadCount, 1, "CreateTypeFromObject one-read section");
	g_Assert.throws(() => g_StrictDefinitionManager.CreateType(7), TypeError, "CreateType strict type name");
	g_Assert.throws(() => g_StrictDefinitionManager.CreateType("SmokeInvalidDescriptor", null), TypeError, "CreateType strict descriptor");
	g_Assert.throws(
		() => g_StrictDefinitionManager.CreateType("SmokeInvalidBase", {}, class {
		}),
		TypeError,
		"CreateType strict base type");
	g_Assert.throws(() => g_StrictDefinitionManager.CreateTypeFromObject("SmokeNullSection", { InstanceAttribute: null, Size: g_unManagedDefinitionMinimumByteCount }), TypeError, "CreateTypeFromObject strict null section");
	g_Assert.throws(() => g_StrictDefinitionManager.DefineType(SmokeNullPropertiesDefinition, { Size: g_unManagedDefinitionMinimumByteCount }), /non-empty strTypeName/, "DefineType removed constructor overload");
	g_Assert.throws(() => g_StrictDefinitionManager.DefineType("SmokeNullPropertiesDefinition", SmokeNullPropertiesDefinition, { Properties: null, Size: g_unManagedDefinitionMinimumByteCount }), /Properties must be an object/, "DefineType strict Properties validation");
	g_Assert.equal(Object.hasOwn(SmokeNullPropertiesDefinition, "TypeSize"), false, "DefineType invalid Properties metadata immutability");
	g_Assert.throws(() => g_StrictDefinitionManager.DefineType("SmokeAtomicDefinition", SmokeAtomicDefinition, {
		Binary: "server",
		ClassInfo: {
			Broken: null,
		},
		Properties: {
			LiveValue: {
				get() {
					return 1;
				},
			},
		},
		Size: g_unManagedDefinitionMinimumByteCount,
	}), TypeError, "DefineType registration failure");
	g_Assert.equal(Object.hasOwn(SmokeAtomicDefinition, "Binary"), false, "DefineType failed Binary rollback");
	g_Assert.equal(Object.hasOwn(SmokeAtomicDefinition, "TypeSize"), false, "DefineType failed TypeSize rollback");
	g_Assert.equal(Object.hasOwn(SmokeAtomicDefinition.prototype, "LiveValue"), false, "DefineType failed property rollback");
	g_Assert.equal(g_StrictDefinitionManager.has("SmokeAtomicDefinition"), false, "DefineType failed local registration rollback");
	g_Assert.equal(g_RootMemory.ObjectType("SmokeAtomicDefinition"), null, "DefineType failed global registration rollback");

	g_Assert.equal(g_RootMemoryManager.Manager.GetClass("SmokeManagedType"), SmokeManagedType, "TypeManager.GetClass registered constructor");
	g_Assert.equal(g_RootMemoryManager.Manager.GetClass("FunctionMetadataType"), FunctionMetadataType, "GetClass generic object type");
	g_Assert.equal(g_RootMemoryManager.Manager.GetClass("MissingSmokeType"), null, "GetClass missing constructor");
	g_Assert.throws(() => g_RootMemoryManager.Manager.GetClass(7), TypeError, "TypeManager.GetClass strict type name");

	const g_OwnedManagedType = new SmokeManagedType();
	let g_ManagedTypeView = null;

	try {
		g_ManagedTypeView = g_OwnedManagedType.Subtract(0n);
		g_Assert.equal(g_ManagedTypeView.Address, g_OwnedManagedType.Address, "CustomType.Subtract address");
		g_Assert.equal(g_ManagedTypeView.OwnsAddress, false, "CustomType.Subtract ownership");
		g_Assert.equal("sub" in g_OwnedManagedType, false, "CustomType must not expose sub alias");
		g_Assert.equal(g_ManagedTypeView.Deallocate(), false, "non-owning CustomType view deallocation");
	} finally {
		g_Assert.equal(g_OwnedManagedType.Deallocate(), true, "owned CustomType deallocation");
	}

	function ReleaseOwnedMemoryFixture(Owner, unBackingAddress, strOwnerMessage, strBackingMessage) {
		try {
			if (Owner !== null) {
				g_Assert.equal(Owner.Deallocate(), true, strOwnerMessage);
			}
		} finally {
			if (unBackingAddress !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(unBackingAddress), true, strBackingMessage);
			}
		}
	}

	function CheckOwnedMemoryFixtureCleanup() {
		const unBackingByteCount = 0x1;

		const unAllocationCount = g_mapAllocations.size;
		const ReleaseFailure = new Error("owned fixture release failed");
		const vecBackingAddresses = [];
		const Owner = {
			Deallocate() {
				throw ReleaseFailure;
			},
		};

		try {
			const unFirstAddress = g_RootMemory.Allocate(unBackingByteCount);
			vecBackingAddresses.push(unFirstAddress);
			g_Assert.throws(() => ReleaseOwnedMemoryFixture(Owner, unFirstAddress, "release the failing owner", "release backing after owner failure"), (Failure) => Failure === ReleaseFailure);
			g_Assert.equal(g_mapAllocations.has(unFirstAddress), false, "owner failure still releases independent backing storage");

			const unSecondAddress = g_RootMemory.Allocate(unBackingByteCount);
			vecBackingAddresses.push(unSecondAddress);
			ReleaseOwnedMemoryFixture(null, unSecondAddress, "no owner expected", "release backing after constructor failure");
			g_Assert.equal(g_mapAllocations.has(unSecondAddress), false);
			ReleaseOwnedMemoryFixture(null, 0n, "no owner expected", "no backing expected");
		} finally {
			for (const unAddress of vecBackingAddresses) {
				if (g_mapAllocations.has(unAddress)) {
					g_Assert.equal(g_RootMemory.Deallocate(unAddress), true, "release a failed cleanup-check fixture");
				}
			}
		}

		g_Assert.equal(g_mapAllocations.size, unAllocationCount, "cleanup checks leave the allocation count unchanged");
	}

	CheckOwnedMemoryFixtureCleanup();

	const g_unDynamicArrayElementCount = 3;
	const g_unAllocationCountBeforeDynamicInstanceArray = g_mapAllocations.size;
	const g_DynamicInstanceArrayManager = new g_RootMemoryManager.TypeManager();

	class SmokeDynamicInstanceArray extends g_RootMemoryManager.CustomType {
	}

	g_DynamicInstanceArrayManager.DefineType("SmokeDynamicInstanceArray", SmokeDynamicInstanceArray, {
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Address),
		Properties: {
			Values: g_DynamicInstanceArrayManager.DynamicInstanceArray(g_RootMemory.DataType.Int, 0n, g_unDynamicArrayElementCount),
		},
	});

	let g_unDynamicInstanceValuesAddress = 0n;
	let g_DynamicInstanceArray = null;

	try {
		g_unDynamicInstanceValuesAddress = g_RootMemory.Allocate(g_unDynamicArrayElementCount * g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int));
		g_DynamicInstanceArray = new SmokeDynamicInstanceArray();
		g_Assert.equal(g_DynamicInstanceArray.WriteAddress(g_unDynamicInstanceValuesAddress), true, "initialize the dynamic instance-array backing address");

		g_DynamicInstanceArray.Values.Set(0, 120);
		g_DynamicInstanceArray.Values.Set(1, 95);
		g_DynamicInstanceArray.Values.Set(2, 140);

		g_Assert.deepEqual(g_DynamicInstanceArray.Values.ToArray(), [120, 95, 140], "dynamic instance array live values");

		g_DynamicInstanceArray.Values = [75, 85, 100];

		g_Assert.deepEqual(g_DynamicInstanceArray.Values.ToArray(), [75, 85, 100], "dynamic instance array bulk setter");
	} finally {
		ReleaseOwnedMemoryFixture(g_DynamicInstanceArray, g_unDynamicInstanceValuesAddress, "dynamic instance array owner deallocation", "dynamic instance array backing deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeDynamicInstanceArray, "dynamic instance array allocation cleanup");

	const g_unAllocationCountBeforeDynamicAddressArray = g_mapAllocations.size;
	const g_DynamicAddressArrayManager = new g_RootMemoryManager.TypeManager();

	class SmokeDynamicAddressArray extends g_RootMemoryManager.CustomType {
	}

	const g_unDynamicAddressSize = g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Address);
	g_DynamicAddressArrayManager.DefineType("SmokeDynamicAddressArray", SmokeDynamicAddressArray, {
		Size: g_unDynamicAddressSize,
		Properties: {
			Values: g_DynamicAddressArrayManager.DynamicAddressArray(g_RootMemory.DataType.Int, 0n, g_unDynamicArrayElementCount),
		},
	});

	let g_unDynamicAddressSlots = 0n;
	let g_DynamicAddressArray = null;

	try {
		g_unDynamicAddressSlots = g_RootMemory.Allocate(g_unDynamicArrayElementCount * g_unDynamicAddressSize);
		g_DynamicAddressArray = new SmokeDynamicAddressArray();

		for (let unIndex = 0; unIndex < g_unDynamicArrayElementCount; unIndex += 1) {
			g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unDynamicAddressSlots, g_RootMemory.DataType.Address, 0n, BigInt(unIndex * g_unDynamicAddressSize)), true, "dynamic address array null-slot initialization");
		}

		g_Assert.equal(g_DynamicAddressArray.WriteAddress(g_unDynamicAddressSlots), true, "initialize the dynamic address-array slots address");
		g_DynamicAddressArray.Values.Set(0, 120);
		g_DynamicAddressArray.Values.Set(1, 95);
		g_DynamicAddressArray.Values.Set(2, 140);

		g_Assert.deepEqual(g_DynamicAddressArray.Values.ToArray(), [120, 95, 140], "dynamic address array live values");
		g_Assert.equal(g_DynamicAddressArray.AllocatedAddresses.size, g_unDynamicArrayElementCount, "dynamic address array owned pointees");

		g_DynamicAddressArray.Values = [75, 85, 100];

		g_Assert.deepEqual(g_DynamicAddressArray.Values.ToArray(), [75, 85, 100], "dynamic address array bulk setter");
		g_Assert.equal(g_DynamicAddressArray.AllocatedAddresses.size, g_unDynamicArrayElementCount, "dynamic address array bulk setter reuses pointees");
	} finally {
		ReleaseOwnedMemoryFixture(g_DynamicAddressArray, g_unDynamicAddressSlots, "dynamic address array owner deallocation", "dynamic address array slots deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeDynamicAddressArray, "dynamic address array allocation cleanup");

	const g_unAllocationCountBeforeObjectArray = g_mapAllocations.size;
	const g_ObjectArrayManager = new g_RootMemoryManager.TypeManager();

	class SmokeObjectArrayElement extends g_RootMemoryManager.CustomType {
	}

	g_ObjectArrayManager.DefineType("SmokeObjectArrayElement", SmokeObjectArrayElement, {
		Properties: {
			Value: g_ObjectArrayManager.InstanceAttribute(g_RootMemory.DataType.Int, 0n),
		},
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int),
	});

	const g_unObjectArrayElementCount = 2;
	const g_unObjectArrayElementSize = g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int);
	let g_unObjectArrayAddress = 0n;
	let g_SourceObjectArrayElement = null;
	let g_ObjectArrayView = null;

	try {
		g_unObjectArrayAddress = g_RootMemory.Allocate(g_unObjectArrayElementSize * g_unObjectArrayElementCount);
		g_SourceObjectArrayElement = new SmokeObjectArrayElement();
		g_ObjectArrayView = new g_CanonicalMemoryHelpers.ArrayView(g_ObjectArrayManager, false, "SmokeObjectArrayElement", g_unObjectArrayAddress, g_unObjectArrayElementCount);

		g_Assert.equal(g_SourceObjectArrayElement.Write(g_RootMemory.DataType.Int, 417), true, "initialize the object-array source value");
		g_ObjectArrayView.Set(1, g_SourceObjectArrayElement);

		g_Assert.equal(g_ObjectArrayView.At(1).Read(g_RootMemory.DataType.Int), 417, "ArrayView copies registered object bytes");
	} finally {
		ReleaseOwnedMemoryFixture(g_SourceObjectArrayElement, g_unObjectArrayAddress, "object array source deallocation", "object array backing deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeObjectArray, "object array allocation cleanup");

	const g_unAllocationCountBeforeMemberFunction = g_mapAllocations.size;
	const g_MemberFunctionManager = new g_RootMemoryManager.TypeManager();
	const g_vecMemberFunctionArgumentTypes = [g_RootMemory.DataType.Address];

	class SmokeInterfaceNameArgument extends g_RootMemoryManager.CustomType {
	}

	g_MemberFunctionManager.DefineType("SmokeInterfaceNameArgument", SmokeInterfaceNameArgument, {
		Binary: "server",
		Size: g_unManagedDefinitionMinimumByteCount,
		Properties: {
			CreateInterface: g_MemberFunctionManager.Function("CreateInterface", g_vecMemberFunctionArgumentTypes, g_RootMemory.DataType.Address, g_RootMemory.Convention.Cdecl),
		},
	});

	const g_strMemberFunctionInterfaceName = "ServerGameDLL005";
	const g_unMemberFunctionNameAddress = g_RootMemory.Allocate(g_strMemberFunctionInterfaceName.length + 1);

	try {
		for (let unIndex = 0; unIndex < g_strMemberFunctionInterfaceName.length; unIndex += 1) {
			g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unMemberFunctionNameAddress, g_RootMemory.DataType.UChar, g_strMemberFunctionInterfaceName.charCodeAt(unIndex), BigInt(unIndex)), true, "initialize an interface-name byte");
		}

		g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unMemberFunctionNameAddress, g_RootMemory.DataType.UChar, 0, BigInt(g_strMemberFunctionInterfaceName.length)), true, "terminate the interface-name bytes");

		const NameArgument = SmokeInterfaceNameArgument.CreateFromAddress(g_unMemberFunctionNameAddress);
		const CreateInterfaceMethod = NameArgument.CreateInterface;
		g_Assert.equal(CreateInterfaceMethod.Options.Arguments, g_vecMemberFunctionArgumentTypes, "TypeManager.Function live argument types");
		g_Assert.equal(CreateInterfaceMethod.Options.ThisObject, NameArgument, "TypeManager.Function bound object context");
		g_Assert.equal(CreateInterfaceMethod(0n), 0x5000n, "TypeManager.Function bound first argument");

		g_vecMemberFunctionArgumentTypes[0] = g_RootMemory.DataType.Void;

		g_Assert.throws(() => CreateInterfaceMethod(0n), /cannot use the void type/, "TypeManager.Function edited argument type");

		g_vecMemberFunctionArgumentTypes[0] = g_RootMemory.DataType.Address;

		g_Assert.equal(CreateInterfaceMethod(0n), 0x5000n, "TypeManager.Function restored live argument types");
		g_Assert.equal(NameArgument.OwnsAddress, false, "TypeManager.Function wrapped address ownership");
	} finally {
		g_Assert.equal(g_RootMemory.Deallocate(g_unMemberFunctionNameAddress), true, "TypeManager.Function argument deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemberFunction, "TypeManager.Function allocation cleanup");

	const g_FunctionTypedefManager = new g_RootMemoryManager.TypeManager();
	const g_CreateInterfaceFromAddress = g_FunctionTypedefManager.FunctionTypedef("SmokeInterfaceFactory", [g_RootMemory.DataType.StringAddress, g_RootMemory.DataType.Address], g_RootMemory.DataType.Address, g_RootMemory.Convention.Cdecl);
	const g_CreateInterface = g_CreateInterfaceFromAddress(g_RootMemoryManager.GetBinarySymbol("server", "CreateInterface"));
	g_Assert.equal(g_CreateInterface("ServerGameDLL005", 0n), 0x5000n, "function typedef string-address call");
	g_Assert.deepEqual(g_CreateInterface.Options, { Arguments: [g_RootMemory.DataType.StringAddress, g_RootMemory.DataType.Address], Convention: g_RootMemory.Convention.Cdecl, Address: 0x1400n, ReturnType: g_RootMemory.DataType.Address, ThisObject: null }, "function typedef callable options");
	g_Assert.equal(g_CreateInterface.Options, g_CreateInterface.Options, "function typedef stable live options");

	g_CreateInterface.Address = 0n;
	g_Assert.equal(g_CreateInterface.Options.Address, 0n, "function typedef live address option");
	g_CreateInterface.Options.Address = 0x1400n;
	g_CreateInterface.Options.Arguments[0] = g_RootMemory.DataType.Void;
	g_Assert.throws(() => g_CreateInterface("ServerGameDLL005", 0n), /cannot use the void type/, "function typedef live argument types");
	g_CreateInterface.Options.Arguments[0] = g_RootMemory.DataType.StringAddress;
	g_Assert.equal(g_CreateInterface("ServerGameDLL005", 0n), 0x5000n, "function typedef restored live options");
	g_Assert.equal(g_FunctionTypedefManager.Convert("SmokeInterfaceFactory", 0x1400n)("ServerGameDLL005", 0n), 0x5000n, "function typedef registered converter");
	g_Assert.throws(() => g_FunctionTypedefManager.FunctionTypedef(7), TypeError, "function typedef strict type name");
	g_Assert.equal(g_FunctionTypedefManager.FunctionTypedefs.has("7"), false, "function typedef numeric name immutability");

	const g_strFunctionTypedefFilePath = `${g_RootMemoryManager.DATA_ROOT}/sourcejs-smoke/memory-manager-function-typedefs.json`;
	g_Assert.equal(g_RootMemoryFixture.ManagerFilesystem.DoesFileExist(g_strFunctionTypedefFilePath), false, "function typedef fixture never overwrites an existing file");

	try {
		g_Assert.equal(g_RootMemoryFixture.ManagerFilesystem.WriteTextFile(g_strFunctionTypedefFilePath, JSON.stringify({
			SmokeFirstFileFunction: {},
			SmokeSecondFileFunction: {},
		})), true, "function typedef file write");
		g_Assert.equal(g_FunctionTypedefManager.CreateFunctionTypedefsFromFile(g_strFunctionTypedefFilePath), undefined, "function typedef file result");

		const FirstFileFunction = g_FunctionTypedefManager.FunctionTypedefs.get("SmokeFirstFileFunction")(0x1400n);
		const SecondFileFunction = g_FunctionTypedefManager.FunctionTypedefs.get("SmokeSecondFileFunction")(0x1400n);

		g_Assert.notEqual(FirstFileFunction.Options.Arguments, SecondFileFunction.Options.Arguments, "file typedef argument-array isolation");

		FirstFileFunction.Options.Arguments.push(g_RootMemory.DataType.Address);

		g_Assert.equal(SecondFileFunction.Options.Arguments.length, 0, "file typedef independent argument mutation");
	} finally {
		g_FunctionTypedefManager.FunctionTypedefs.delete("SmokeSecondFileFunction");
		g_FunctionTypedefManager.FunctionTypedefs.delete("SmokeFirstFileFunction");

		if (g_RootMemoryFixture.ManagerFilesystem.DoesFileExist(g_strFunctionTypedefFilePath)) {
			g_Assert.equal(g_RootMemoryFixture.ManagerFilesystem.RemoveFile(g_strFunctionTypedefFilePath), true, "function typedef file cleanup");
		}
	}

	const g_GlobalAddressManager = new g_RootMemoryManager.TypeManager();

	class SmokeGlobalExport extends g_RootMemoryManager.CustomType {
	}

	g_GlobalAddressManager.DefineType("SmokeGlobalExport", SmokeGlobalExport, { Size: g_unManagedDefinitionMinimumByteCount });

	const g_GlobalExport = g_GlobalAddressManager.GlobalAddress(SmokeGlobalExport, "server", "CreateInterface", 0n, 0, false);
	g_Assert.equal(g_GlobalExport.Address, 0x1400n, "global address resolved address");
	g_Assert.equal(g_GlobalExport.OwnsAddress, false, "global address view ownership");
	g_Assert.equal(g_GlobalExport.ServerAddressCheck, false, "global address server-check metadata");

	try {
		g_GlobalExport.ServerAddressCheck = true;
		g_Assert.equal(g_GlobalExport.ServerAddressCheck, true, "global address editable server-check metadata");
	} finally {
		g_GlobalExport.ServerAddressCheck = false;
	}

	g_Assert.equal(g_GlobalExport.ServerAddressCheck, false, "global address server-check fixture restoration");
	g_Assert.equal(g_GlobalAddressManager.GetGlobalAddress("SmokeGlobalExport"), g_GlobalExport, "global address name lookup");
	g_Assert.equal(g_GlobalAddressManager.GetGlobalAddress(SmokeGlobalExport), g_GlobalExport, "global address constructor lookup");
	g_Assert.throws(() => g_GlobalAddressManager.GetGlobalAddress("MissingGlobalExport"), /No global address found/, "missing global address lookup");
	g_Assert.throws(() => g_GlobalAddressManager.GlobalAddress(SmokeGlobalExport, "server", "CreateInterface", 0n, 0, 1), TypeError, "global address strict server-check flag");
	g_Assert.equal(g_GlobalAddressManager.GetGlobalAddress(SmokeGlobalExport), g_GlobalExport, "global address invalid-call immutability");
	g_Assert.throws(() => g_GlobalAddressManager.CreateGlobalAddressesFromObject(null), TypeError, "global address definitions strict object");
	g_Assert.throws(() => g_GlobalAddressManager.GetGlobalAddress(""), TypeError, "global address strict lookup name");

	const g_unAllocationCountBeforeInstanceAttribute = g_mapAllocations.size;
	const g_InstanceAttributeManager = new g_RootMemoryManager.TypeManager();

	class SmokePlayerVitals extends g_RootMemoryManager.CustomType {
	}

	const g_unVitalsFloatByteSize = g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Float);
	const g_nMaximumHealthByteOffset = BigInt(g_unVitalsFloatByteSize);

	g_InstanceAttributeManager.DefineType("SmokePlayerVitals", SmokePlayerVitals, {
		Size: 2 * g_unVitalsFloatByteSize,
		Properties: {
			Health: g_InstanceAttributeManager.InstanceAttribute(g_RootMemory.DataType.Float, 0n),
			MaxHealth: g_InstanceAttributeManager.InstanceAttribute(g_RootMemory.DataType.Float, g_nMaximumHealthByteOffset),
		},
	});

	const g_PlayerVitals = new SmokePlayerVitals();

	try {
		g_Assert.equal(g_PlayerVitals.Write(g_RootMemory.DataType.Float, 73.5, 0n), true, "initialize the live health field");
		g_Assert.equal(g_PlayerVitals.Write(g_RootMemory.DataType.Float, 100, g_nMaximumHealthByteOffset), true, "initialize the live maximum-health field");

		g_Assert.equal(g_PlayerVitals.Read(g_RootMemory.DataType.Float, 0n), 73.5, "instance attribute live read");
		g_Assert.equal(g_CanonicalMemoryHelpers.Read(g_PlayerVitals.Address, g_RootMemory.DataType.Float, g_nMaximumHealthByteOffset), 100, "instance attribute direct memory write");
		g_Assert.equal(g_PlayerVitals.Health, 73.5, "instance attribute public health getter");
		g_Assert.equal(g_PlayerVitals.MaxHealth, 100, "instance attribute public maximum-health getter");
		g_PlayerVitals.MaxHealth = 125;
		g_Assert.equal(g_PlayerVitals.Read(g_RootMemory.DataType.Float, g_nMaximumHealthByteOffset), 125, "instance attribute public setter writes live memory");
	} finally {
		g_Assert.equal(g_PlayerVitals.Deallocate(), true, "instance attribute owner deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeInstanceAttribute, "instance attribute allocation cleanup");

	const g_PipeFunctionManager = new g_RootMemoryManager.TypeManager();
	const g_PipedCreateInterface = g_PipeFunctionManager.PipeFunction("server", "CreateInterface", [g_RootMemory.DataType.StringAddress, g_RootMemory.DataType.Address], g_RootMemory.DataType.Address, g_RootMemory.Convention.Cdecl);
	const g_PipedCreateInterfaceFromAddress = g_PipeFunctionManager.PipeFunction("server", 0x1400n, [g_RootMemory.DataType.StringAddress, g_RootMemory.DataType.Address], g_RootMemory.DataType.Address, g_RootMemory.Convention.Cdecl);

	g_Assert.equal(g_PipedCreateInterface("ServerGameDLL005", 0n), 0x5000n, "pipe function call");
	g_Assert.equal(g_PipedCreateInterface.Address, 0x1400n, "pipe function address");
	g_Assert.equal(g_PipedCreateInterface.ServerAddressCheck, true, "pipe function server-check metadata");
	g_Assert.equal(g_PipedCreateInterfaceFromAddress("ServerGameDLL005", 0n), 0x5000n, "pipe function BigInt identifier call");
	g_Assert.equal(g_PipedCreateInterfaceFromAddress.Address, 0x1400n, "pipe function BigInt identifier address");
	g_Assert.throws(() => g_PipeFunctionManager.PipeFunction("server", 0x1400), { name: "TypeError", message: "Binary addresses must be bigint values." }, "pipe function rejects Number address");
	g_Assert.throws(() => g_PipeFunctionManager.PipeFunction("", 0x1400n), { name: "TypeError", message: "PipeFunction strBinaryName must be a non-empty string." }, "pipe function binary-name diagnostic");
	g_Assert.throws(() => g_PipeFunctionManager.PipeFunction("server", 0x1400n, null), { name: "TypeError", message: "PipeFunction vecArgumentTypes must be an array." }, "pipe function arguments diagnostic");
	g_Assert.throws(() => g_PipeFunctionManager.PipeFunction("server", 0x1400n, [], ""), { name: "TypeError", message: "PipeFunction strReturnType must be a non-empty string." }, "pipe function return-type diagnostic");
	g_Assert.throws(() => g_PipeFunctionManager.PipeFunction("server", 0x1400n, [], "void", "cdecl", 1), { name: "TypeError", message: "PipeFunction bServerCheck must be a boolean." }, "pipe function server-check diagnostic");
	g_Assert.throws(() => g_PipeFunctionManager.PipeFunction("server", 0x1400n, [], "void", "cdecl", true, false), { name: "TypeError", message: "PipeFunction strDocumentationText must be a string or null." }, "pipe function documentation diagnostic");

	const g_PipeDescriptor = { CreateInterface: g_PipedCreateInterface };
	const g_InterfacePipe = g_PipeFunctionManager.CreatePipe(g_PipeDescriptor);

	g_PipeDescriptor.CreateInterface = null;

	g_Assert.equal(typeof g_InterfacePipe, "function", "CreatePipe class result");
	g_Assert.equal(g_InterfacePipe.name, "Pipe", "CreatePipe class name");
	g_Assert.equal(g_InterfacePipe.CreateInterface, g_PipedCreateInterface, "CreatePipe static descriptor");
	g_Assert.throws(() => g_PipeFunctionManager.CreatePipe(null), TypeError, "CreatePipe strict descriptor");

	const g_GeneratedPipe = g_PipeFunctionManager.CreatePipeFromObject({
		First: {
			Binary: "server",
			Identifier: "CreateInterface",
		},
		Second: {
			Binary: "server",
			Identifier: "CreateInterface",
		},
		FromAddress: {
			Binary: "server",
			Identifier: 0x1400n,
			Arguments: [g_RootMemory.DataType.StringAddress, g_RootMemory.DataType.Address],
			ReturnType: g_RootMemory.DataType.Address,
		},
	});

	g_Assert.notEqual(g_GeneratedPipe.First.Options.Arguments, g_GeneratedPipe.Second.Options.Arguments, "pipe argument-array isolation");
	g_Assert.equal(g_GeneratedPipe.FromAddress.Address, 0x1400n, "generated pipe BigInt identifier address");
	g_Assert.equal(g_GeneratedPipe.FromAddress("ServerGameDLL005", 0n), 0x5000n, "generated pipe BigInt identifier call");

	g_GeneratedPipe.First.Options.Arguments.push(g_RootMemory.DataType.Address);

	g_Assert.equal(g_GeneratedPipe.Second.Options.Arguments.length, 0, "pipe argument-array independent mutation");

	const g_unAllocationCountBeforeCustomInstanceAttribute = g_mapAllocations.size;
	const g_CustomInstanceAttributeManager = new g_RootMemoryManager.TypeManager();

	class SmokeInlineValue extends g_RootMemoryManager.CustomType {
	}

	class SmokeInlineOwner extends g_RootMemoryManager.CustomType {
	}

	g_CustomInstanceAttributeManager.DefineType("SmokeInlineValue", SmokeInlineValue, {
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int),
		Properties: {
			Value: g_CustomInstanceAttributeManager.InstanceAttribute(g_RootMemory.DataType.Int, 0n),
		},
	});
	g_CustomInstanceAttributeManager.DefineType("SmokeInlineOwner", SmokeInlineOwner, {
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int),
		Properties: {
			Nested: g_CustomInstanceAttributeManager.InstanceAttribute("SmokeInlineValue", 0n),
		},
	});

	function ReleaseConstructedMemoryFixtures(vecFixtures) {
		const vecFailures = [];
		for (const Fixture of vecFixtures) {
			if (Fixture.Owner === null) {
				continue;
			}

			try {
				g_Assert.equal(Fixture.Owner.Deallocate(), true, Fixture.Message);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		if (vecFailures.length === 1) {
			throw vecFailures[0];
		}

		if (vecFailures.length > 1) {
			throw new AggregateError(vecFailures, "Could not release all constructed memory fixtures.");
		}
	}

	function CheckConstructedMemoryFixtureCleanup() {
		const FirstFailure = new Error("first constructed fixture release failed");
		const SecondFailure = new Error("second constructed fixture release failed");
		const vecReleaseOrder = [];
		const vecFixtures = [
			{ Owner: null, Message: "no owner expected" },
			{
				Owner: {
					Deallocate() {
						vecReleaseOrder.push("First");
						throw FirstFailure;
					},
				},
				Message: "first owner",
			},
			{
				Owner: {
					Deallocate() {
						vecReleaseOrder.push("Second");
						throw SecondFailure;
					},
				},
				Message: "second owner",
			},
			{
				Owner: {
					Deallocate() {
						vecReleaseOrder.push("Third");

						return true;
					},
				},
				Message: "third owner",
			},
		];
		g_Assert.throws(() => ReleaseConstructedMemoryFixtures(vecFixtures), (Failure) => {
			g_Assert.ok(Failure instanceof AggregateError);
			g_Assert.deepEqual(Failure.errors, [FirstFailure, SecondFailure]);

			return true;
		});
		g_Assert.deepEqual(vecReleaseOrder, ["First", "Second", "Third"], "one failed release never skips a later constructed fixture");
		g_Assert.throws(() => ReleaseConstructedMemoryFixtures([vecFixtures[1]]), (Failure) => Failure === FirstFailure, "one cleanup failure preserves error identity");
	}

	CheckConstructedMemoryFixtureCleanup();

	let g_InlineSource = null;
	let g_InlineOwner = null;

	try {
		g_InlineSource = new SmokeInlineValue();
		g_InlineOwner = new SmokeInlineOwner();
		g_Assert.equal(typeof g_InlineSource.Address, "bigint", "custom inline source address initialization");
		g_Assert.equal(typeof g_InlineOwner.Address, "bigint", "custom inline owner address initialization");
		g_InlineSource.Value = 73;
		g_InlineOwner.Nested = g_InlineSource;

		g_Assert.equal(g_InlineOwner.Nested.Value, 73, "custom instance attribute byte copy");

		g_InlineSource.Value = 91;

		g_Assert.equal(g_InlineOwner.Nested.Value, 73, "custom instance attribute independent storage");

		g_InlineOwner.Nested.Value = 37;

		g_Assert.equal(g_InlineOwner.Read(g_RootMemory.DataType.Int), 37, "custom instance attribute live inline view");

		const InlineArrayView = new g_CanonicalMemoryHelpers.ArrayView(g_CustomInstanceAttributeManager, false, "SmokeInlineValue", g_InlineOwner.Address, 1);
		g_Assert.equal(InlineArrayView.Set(0, g_InlineSource), InlineArrayView, "custom inline ArrayView.Set returns its receiver");
		g_Assert.equal(InlineArrayView.At(0).Value, 91, "custom inline ArrayView.Set copies the source bytes");
	} finally {
		ReleaseConstructedMemoryFixtures([
			{ Owner: g_InlineOwner, Message: "custom instance attribute owner deallocation" },
			{ Owner: g_InlineSource, Message: "custom instance attribute source deallocation" },
		]);
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeCustomInstanceAttribute, "custom instance attribute allocation cleanup");

	const g_unAllocationCountBeforeAddressAttribute = g_mapAllocations.size;
	const g_AddressAttributeManager = new g_RootMemoryManager.TypeManager();

	class SmokeOwnedIntAddress extends g_RootMemoryManager.CustomType {
	}

	g_AddressAttributeManager.DefineType("SmokeOwnedIntAddress", SmokeOwnedIntAddress, {
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Address),
		Properties: {
			Value: g_AddressAttributeManager.AddressAttribute(g_RootMemory.DataType.Int, 0n),
		},
	});

	const g_OwnedIntAddress = new SmokeOwnedIntAddress();

	try {
		g_Assert.equal(g_OwnedIntAddress.WriteAddress(0n), true, "initialize the address-attribute null slot");

		const unAllocationCountBeforeFailedAddressAttribute = g_mapAllocations.size;
		const OriginalAddressAttributeWrite = g_RootMemoryFixture.RootHelpers.Write;
		let unAddressAttributeWriteCallCount = 0;

		try {
			g_RootMemoryFixture.RootHelpers.Write = function Write(...vecWriteArguments) {
				unAddressAttributeWriteCallCount += 1;

				if (unAddressAttributeWriteCallCount === 1) {
					return false;
				}

				return Reflect.apply(OriginalAddressAttributeWrite, this, vecWriteArguments);
			};

			g_Assert.throws(
				() => {
					g_OwnedIntAddress.Value = 12;
				},
				/Unable to store the allocated native attribute address/,
				"address attribute allocation write failure");
			g_Assert.equal(g_OwnedIntAddress.ReadAddress(), 0n, "address attribute slot rollback");
			g_Assert.equal(g_OwnedIntAddress.AllocatedAddresses.size, 0, "address attribute ownership rollback");
			g_Assert.equal(g_mapAllocations.size, unAllocationCountBeforeFailedAddressAttribute, "address attribute allocation rollback");
		} finally {
			g_RootMemoryFixture.RootHelpers.Write = OriginalAddressAttributeWrite;
		}

		g_OwnedIntAddress.Value = 64;

		const unPointeeAddress = g_OwnedIntAddress.ReadAddress();
		g_Assert.equal(typeof unPointeeAddress, "bigint", "address attribute pointee is a BigInt");
		g_Assert.ok(unPointeeAddress > 0n, "address attribute allocated pointee");
		g_Assert.equal(g_OwnedIntAddress.Value, 64, "address attribute live value");
		g_Assert.equal(g_OwnedIntAddress.AllocatedAddresses.size, 1, "address attribute pointee ownership");
	} finally {
		g_Assert.equal(g_OwnedIntAddress.Deallocate(), true, "address attribute owner deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeAddressAttribute, "address attribute allocation cleanup");

	const g_unAllocationCountBeforeCustomAddressAttribute = g_mapAllocations.size;
	const g_CustomAddressAttributeManager = new g_RootMemoryManager.TypeManager();

	class SmokeRetainedAddressValue extends g_RootMemoryManager.CustomType {
	}

	class SmokeOwnedCustomAddress extends g_RootMemoryManager.CustomType {
	}

	g_CustomAddressAttributeManager.DefineType("SmokeRetainedAddressValue", SmokeRetainedAddressValue, {
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int),
		Properties: {
			Value: g_CustomAddressAttributeManager.InstanceAttribute(g_RootMemory.DataType.Int, 0n),
		},
	});

	g_CustomAddressAttributeManager.DefineType("SmokeOwnedCustomAddress", SmokeOwnedCustomAddress, {
		Size: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Address),
		Properties: {
			Nested: g_CustomAddressAttributeManager.AddressAttribute("SmokeRetainedAddressValue", 0n),
		},
	});

	let g_FirstRetainedAddressValue = null;
	let g_SecondRetainedAddressValue = null;
	let g_OwnedCustomAddress = null;

	try {
		g_FirstRetainedAddressValue = new SmokeRetainedAddressValue();
		g_SecondRetainedAddressValue = new SmokeRetainedAddressValue();
		g_OwnedCustomAddress = new SmokeOwnedCustomAddress();
		g_FirstRetainedAddressValue.Value = 31;
		g_SecondRetainedAddressValue.Value = 47;
		g_Assert.equal(g_OwnedCustomAddress.WriteAddress(0n), true, "initialize the custom address-attribute null slot");
		g_OwnedCustomAddress.Nested = g_FirstRetainedAddressValue;

		g_Assert.equal(g_OwnedCustomAddress.ReadAddress(), g_FirstRetainedAddressValue.Address, "custom address attribute memory value");
		g_Assert.equal(g_OwnedCustomAddress.AddressValues.get(0n), g_FirstRetainedAddressValue, "custom address attribute retention");
		g_Assert.equal(g_OwnedCustomAddress.Nested.Value, 31, "custom address attribute live conversion");

		const OriginalCustomAddressAttributeWrite = g_RootMemoryFixture.RootHelpers.Write;
		let unCustomAddressAttributeWriteCallCount = 0;

		try {
			g_RootMemoryFixture.RootHelpers.Write = function Write(...vecWriteArguments) {
				unCustomAddressAttributeWriteCallCount += 1;

				if (unCustomAddressAttributeWriteCallCount === 1) {
					return false;
				}

				return Reflect.apply(OriginalCustomAddressAttributeWrite, this, vecWriteArguments);
			};

			g_Assert.throws(
				() => {
					g_OwnedCustomAddress.Nested = g_SecondRetainedAddressValue;
				},
				/Unable to store the custom attribute address/,
				"custom address attribute write failure");
			g_Assert.equal(g_OwnedCustomAddress.ReadAddress(), g_FirstRetainedAddressValue.Address, "custom address attribute slot rollback");
			g_Assert.equal(g_OwnedCustomAddress.AddressValues.get(0n), g_FirstRetainedAddressValue, "custom address retention rollback");
		} finally {
			g_RootMemoryFixture.RootHelpers.Write = OriginalCustomAddressAttributeWrite;
		}

		g_OwnedCustomAddress.Nested = g_SecondRetainedAddressValue;

		g_Assert.equal(g_OwnedCustomAddress.ReadAddress(), g_SecondRetainedAddressValue.Address, "custom address attribute replacement");
		g_Assert.equal(g_OwnedCustomAddress.AddressValues.get(0n), g_SecondRetainedAddressValue, "custom address replacement retention");
	} finally {
		ReleaseConstructedMemoryFixtures([
			{ Owner: g_OwnedCustomAddress, Message: "custom address attribute owner deallocation" },
			{ Owner: g_SecondRetainedAddressValue, Message: "second custom address value deallocation" },
			{ Owner: g_FirstRetainedAddressValue, Message: "first custom address value deallocation" },
		]);
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeCustomAddressAttribute, "custom address attribute allocation cleanup");

	const g_ConverterManager = new g_RootMemoryManager.TypeManager();
	const g_ToAddressView = g_ConverterManager.RegisterConverter("SmokeAddressView", (unAddress) => new g_RootMemory.Address(unAddress));
	const g_ConvertedAddress = g_ConverterManager.Convert("SmokeAddressView", 0x5000n);
	const g_CreatedAddressViewConverter = g_ConverterManager.CreateConverter("SmokeAddressView");

	g_Assert.equal(g_ConverterManager.Converters.get("SmokeAddressView"), g_ToAddressView, "registered converter identity");
	g_Assert.equal(g_ConvertedAddress.Address, 0x5000n, "registered converter address");
	g_Assert.equal(g_CreatedAddressViewConverter(0x6000n).Address, 0x6000n, "created converter address");
	g_Assert.throws(() => g_ConverterManager.RegisterConverter(7, g_ToAddressView), TypeError, "RegisterConverter strict name");
	g_Assert.equal(g_ConverterManager.Converters.has("7"), false, "RegisterConverter numeric name immutability");
	g_Assert.throws(() => g_ConverterManager.RegisterConverter("InvalidConverter", 1), { name: "TypeError", message: "RegisterConverter Converter must be a function." }, "RegisterConverter function validation");
	g_Assert.throws(() => g_ConverterManager.CreateConverter(7), TypeError, "CreateConverter strict type name");
	g_Assert.throws(() => g_ConverterManager.Convert("SmokeAddressView", 0.5), TypeError, "Convert strict address");
	g_Assert.throws(() => g_ConverterManager.UnregisterConverter(7), TypeError, "UnregisterConverter strict name");
	g_Assert.equal(g_ConverterManager.UnregisterConverter("SmokeAddressView"), true, "UnregisterConverter removal");
	g_Assert.equal(g_ConverterManager.UnregisterConverter("SmokeAddressView"), false, "UnregisterConverter missing entry");
	g_Assert.throws(() => g_ConverterManager.Convert("SmokeAddressView", 0x5000n), /No class, function typedef or converter/, "unregistered converter lookup");

	const g_unAllocationCountBeforeRegisteredType = g_mapAllocations.size;
	const g_RegisteredTypeManager = new g_RootMemoryManager.TypeManager();

	class SmokeRegisteredCounter extends g_RootMemoryManager.CustomType {
		get Value() {
			return this.Read(g_RootMemory.DataType.UInt);
		}

		set Value(unValue) {
			g_Assert.equal(this.Write(g_RootMemory.DataType.UInt, unValue), true, "registered counter writes its value");
		}
	}

	Object.defineProperty(SmokeRegisteredCounter, "TypeSize", { configurable: true, enumerable: true, value: g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.UInt), writable: true });

	g_RegisteredTypeManager.RegisterType("SmokeRegisteredCounter", SmokeRegisteredCounter);
	const g_RegisteredCounter = new SmokeRegisteredCounter();

	try {
		g_RegisteredCounter.Value = 128;

		g_Assert.equal(g_RegisteredCounter.Value, 128, "registered type live value");
		g_Assert.equal(g_RegisteredTypeManager.GetClass("SmokeRegisteredCounter"), SmokeRegisteredCounter, "registered type constructor lookup");
	} finally {
		g_Assert.equal(g_RegisteredCounter.Deallocate(), true, "registered type owner deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeRegisteredType, "registered type allocation cleanup");
	g_Assert.throws(
		() => g_RegisteredTypeManager.RegisterType("InvalidRegisteredType", class {
		}),
		/must extend CustomType/,
		"RegisterType subclass validation");

	class SmokeInvalidNameType extends g_RootMemoryManager.CustomType {
	}

	class SmokeFrozenRegisteredType extends g_RootMemoryManager.CustomType {
	}

	Object.freeze(SmokeFrozenRegisteredType);
	g_Assert.throws(() => g_RegisteredTypeManager.RegisterType(7, SmokeInvalidNameType), /non-empty strTypeName/, "RegisterType strict name validation");
	g_Assert.equal(g_RegisteredTypeManager.has("7"), false, "RegisterType numeric name immutability");
	g_Assert.throws(() => g_RegisteredTypeManager.RegisterType("SmokeFrozenRegisteredType", SmokeFrozenRegisteredType), TypeError, "RegisterType frozen constructor validation");
	g_Assert.equal(g_RegisteredTypeManager.has("SmokeFrozenRegisteredType"), false, "RegisterType frozen constructor manager immutability");
	g_Assert.equal(g_RootMemory.ObjectType("SmokeFrozenRegisteredType"), null, "RegisterType frozen constructor global immutability");

	const g_unStaticArrayElementCount = 3;
	const g_unAllocationCountBeforeStaticInstanceArray = g_mapAllocations.size;
	const g_StaticInstanceArrayManager = new g_RootMemoryManager.TypeManager();

	class SmokeStaticInstanceArray extends g_RootMemoryManager.CustomType {
	}

	g_StaticInstanceArrayManager.DefineType("SmokeStaticInstanceArray", SmokeStaticInstanceArray, {
		Size: g_unStaticArrayElementCount * g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Float),
		Properties: {
			Values: g_StaticInstanceArrayManager.StaticInstanceArray(g_RootMemory.DataType.Float, 0n, g_unStaticArrayElementCount),
		},
	});

	const g_StaticInstanceArray = new SmokeStaticInstanceArray();

	try {
		g_StaticInstanceArray.Values.Set(0, 12.5);
		g_StaticInstanceArray.Values.Set(1, 12);
		g_StaticInstanceArray.Values.Set(2, 21.25);

		g_Assert.deepEqual(g_StaticInstanceArray.Values.ToArray(), [12.5, 12, 21.25], "static instance array values");

		g_StaticInstanceArray.Values.Set(1, g_StaticInstanceArray.Values.At(1) + 4);

		g_Assert.deepEqual(g_StaticInstanceArray.Values.ToArray(), [12.5, 16, 21.25], "static instance array live values");

		g_StaticInstanceArray.Values = [7.5, 8, 9.25];

		g_Assert.deepEqual(g_StaticInstanceArray.Values.ToArray(), [7.5, 8, 9.25], "static instance array bulk setter");
		g_Assert.throws(() => {
			g_StaticInstanceArray.Values = [11.5, 12, 13.25, 14];
		}, RangeError, "static instance array bulk setter bounds");
		g_Assert.deepEqual(g_StaticInstanceArray.Values.ToArray(), [11.5, 12, 13.25], "static instance array bulk setter preserves completed prefix on failure");
	} finally {
		g_Assert.equal(g_StaticInstanceArray.Deallocate(), true, "static instance array owner deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeStaticInstanceArray, "static instance array allocation cleanup");

	const g_unAllocationCountBeforeStaticAddressArray = g_mapAllocations.size;
	const g_StaticAddressArrayManager = new g_RootMemoryManager.TypeManager();
	const g_unStaticAddressArraySize = g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Address);

	class SmokeStaticAddressArray extends g_RootMemoryManager.CustomType {
	}

	g_StaticAddressArrayManager.DefineType("SmokeStaticAddressArray", SmokeStaticAddressArray, {
		Size: g_unStaticArrayElementCount * g_unStaticAddressArraySize,
		Properties: {
			Values: g_StaticAddressArrayManager.StaticAddressArray(g_RootMemory.DataType.Int, 0n, g_unStaticArrayElementCount),
		},
	});

	const g_StaticAddressArray = new SmokeStaticAddressArray();

	try {
		for (let unIndex = 0; unIndex < g_unStaticArrayElementCount; unIndex += 1) {
			g_Assert.equal(g_StaticAddressArray.WriteAddress(0n, BigInt(unIndex * g_unStaticAddressArraySize)), true, "static address array null-slot initialization");
		}

		g_StaticAddressArray.Values.Set(0, 120);
		g_StaticAddressArray.Values.Set(1, 95);
		g_StaticAddressArray.Values.Set(2, 140);

		g_Assert.deepEqual(g_StaticAddressArray.Values.ToArray(), [120, 95, 140], "static address array values");
		g_Assert.equal(g_StaticAddressArray.AllocatedAddresses.size, g_unStaticArrayElementCount, "static address array pointee ownership");

		g_StaticAddressArray.Values = [75, 85, 100];

		g_Assert.deepEqual(g_StaticAddressArray.Values.ToArray(), [75, 85, 100], "static address array bulk setter");
		g_Assert.equal(g_StaticAddressArray.AllocatedAddresses.size, g_unStaticArrayElementCount, "static address array bulk setter reuses pointees");
	} finally {
		g_Assert.equal(g_StaticAddressArray.Deallocate(), true, "static address array owner deallocation");
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeStaticAddressArray, "static address array allocation cleanup");

	const g_unAllocationCountBeforeVirtualFunction = g_mapAllocations.size;
	const g_VirtualFunctionManager = new g_RootMemoryManager.TypeManager();
	const g_vecVirtualFunctionArgumentTypes = [];
	const g_unGlobalVariablesVirtualIndex = 1;
	const g_unVirtualAddressByteSize = g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Address);

	class SmokePlayerInformationManagerView extends g_RootMemoryManager.CustomType {
	}

	g_VirtualFunctionManager.DefineType("SmokePlayerInformationManagerView", SmokePlayerInformationManagerView, {
		Size: g_unManagedDefinitionMinimumByteCount,
		Properties: {
			GetGlobalVariables: g_VirtualFunctionManager.VirtualFunction(g_unGlobalVariablesVirtualIndex, g_vecVirtualFunctionArgumentTypes, g_RootMemory.DataType.Address, g_RootMemory.Convention.Thiscall),
		},
	});

	// Synthetic storage fixture; this does not establish an SDK vtable layout.
	let g_unVirtualTableAddress = 0n;
	let g_unPlayerInformationManagerAddress = 0n;

	try {
		g_unVirtualTableAddress = g_RootMemory.Allocate((g_unGlobalVariablesVirtualIndex + 1) * g_unVirtualAddressByteSize);
		g_unPlayerInformationManagerAddress = g_RootMemory.Allocate(g_unVirtualAddressByteSize);
		g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unPlayerInformationManagerAddress, g_RootMemory.DataType.Address, g_unVirtualTableAddress), true, "initialize the virtual object table address");
		g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unVirtualTableAddress, g_RootMemory.DataType.Address, 0n, 0n), true, "initialize the unused virtual slot");
		g_Assert.equal(g_CanonicalMemoryHelpers.Write(g_unVirtualTableAddress, g_RootMemory.DataType.Address, 0x1500n, BigInt(g_unGlobalVariablesVirtualIndex * g_unVirtualAddressByteSize)), true, "initialize the synthetic global-variables function slot");

		const PlayerInformationManager = SmokePlayerInformationManagerView.CreateFromAddress(g_unPlayerInformationManagerAddress);
		const GetGlobalVariables = PlayerInformationManager.GetGlobalVariables;

		g_Assert.equal(GetGlobalVariables.FunctionAddress, 0x1500n, "virtual function vtable address");
		g_Assert.equal(GetGlobalVariables.ThisObject, PlayerInformationManager, "virtual function bound context");
		g_Assert.equal(GetGlobalVariables.ArgumentTypes, g_vecVirtualFunctionArgumentTypes, "virtual function live argument types");
		g_Assert.equal(GetGlobalVariables.Call(), 0x7000n, "virtual function return address");

		g_vecVirtualFunctionArgumentTypes.push(g_RootMemory.DataType.Void);

		g_Assert.throws(() => GetGlobalVariables.Call(), /cannot use the void type/, "virtual function edited argument type");

		g_vecVirtualFunctionArgumentTypes.pop();

		g_Assert.equal(GetGlobalVariables.Call(), 0x7000n, "virtual function restored live argument types");
	} finally {
		try {
			if (g_unPlayerInformationManagerAddress !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(g_unPlayerInformationManagerAddress), true, "virtual function object deallocation");
			}
		} finally {
			if (g_unVirtualTableAddress !== 0n) {
				g_Assert.equal(g_RootMemory.Deallocate(g_unVirtualTableAddress), true, "virtual function table deallocation");
			}
		}
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeVirtualFunction, "virtual function allocation cleanup");
	g_Assert.throws(() => g_VirtualFunctionManager.VirtualFunction(-1), RangeError, "VirtualFunction strict vtable index");

	function GetDocumentedMemoryConstantMembers(strDocumentation, strHeading, strNextHeading, unColumnIndex, unMaximumMemberCount) {
		const nSectionStart = strDocumentation.indexOf(strHeading);
		g_Assert.notEqual(nSectionStart, -1, "memory constant documentation section " + strHeading);

		const nSectionEnd = strDocumentation.indexOf(strNextHeading, nSectionStart + strHeading.length);
		g_Assert.notEqual(nSectionEnd, -1, "memory constant documentation boundary " + strNextHeading);

		const strSection = strDocumentation.slice(nSectionStart, nSectionEnd);
		const vecMembers = [];
		for (const vecRow of strSection.matchAll(/^\| (.+) \|$/gm)) {
			let strCell = vecRow[1].split(" | ")[unColumnIndex];
			g_Assert.equal(typeof strCell, "string", "memory constant documentation column " + strHeading);
			for (const vecRange of strCell.matchAll(/`([A-Z]+)(\d+)` through `\1(\d+)`/g)) {
				const unFirstIndex = Number(vecRange[2]);
				const unLastIndex = Number(vecRange[3]);
				g_Assert.ok(Number.isSafeInteger(unFirstIndex) && Number.isSafeInteger(unLastIndex) && (unLastIndex >= unFirstIndex), "memory constant documentation has a valid ascending integer range");
				g_Assert.ok((unLastIndex - unFirstIndex) < unMaximumMemberCount, "memory constant documentation range fits its actual inventory");
				const vecRangeMembers = [];
				for (let unIndex = unFirstIndex; unIndex <= unLastIndex; ++unIndex) {
					vecRangeMembers.push("`" + vecRange[1] + unIndex + "`");
				}

				strCell = strCell.replace(vecRange[0], vecRangeMembers.join(", "));
			}

			for (const vecMember of strCell.matchAll(/`([^`]+)`/g)) {
				g_Assert.ok(vecMembers.length < unMaximumMemberCount, "memory constant documentation member count fits its actual inventory");
				vecMembers.push(vecMember[1]);
			}
		}

		return vecMembers.sort();
	}

	function CheckMemoryModuleDocumentationConstants(strDocumentation) {
		const vecDataTypeMembers = Object.keys(g_RootMemory.DataType).sort();
		const vecConventionMembers = Object.keys(g_RootMemory.Convention).sort();
		const vecRegisterMembers = Object.keys(g_RootMemory.Register).sort();
		g_Assert.deepEqual(GetDocumentedMemoryConstantMembers(strDocumentation, "### `DataType`", "### `Convention`", 0, vecDataTypeMembers.length), vecDataTypeMembers, "memory documented DataType members");
		g_Assert.deepEqual(GetDocumentedMemoryConstantMembers(strDocumentation, "### `Convention`", "### `Protection`", 0, vecConventionMembers.length), vecConventionMembers, "memory documented Convention members");
		g_Assert.deepEqual(GetDocumentedMemoryConstantMembers(strDocumentation, "### `Register`", "### `NULL` and `TYPE_SIZES`", 1, vecRegisterMembers.length), vecRegisterMembers, "memory documented Register members");
		g_Assert.equal(strDocumentation.includes("same uppercase string values"), true, "memory documented uppercase register values");

		for (const strRegisterName of Object.keys(g_RootMemory.Register)) {
			g_Assert.equal(g_RootMemory.Register[strRegisterName], strRegisterName, "memory canonical register value " + strRegisterName);
		}
	}

	const g_strMemoryDocumentation = g_FileSystem.readFileSync(g_strMemoryDocumentationPath, "utf8");
	CheckMemoryModuleDocumentationConstants(g_strMemoryDocumentation);

	const g_strMemoryHelpersDocumentation = g_FileSystem.readFileSync(g_strMemoryHelpersDocumentationPath, "utf8");
	const g_strMemoryManagerDocumentation = g_FileSystem.readFileSync(g_strMemoryManagerDocumentationPath, "utf8");
	g_Assert(g_strMemoryManagerDocumentation.includes("`LoadGameDataFile()` instead resolves ordinary relative paths under `ROOT`/`DATA_ROOT`"), "memory/manager lifecycle documents GameData root resolution");
	g_Assert.equal(g_strMemoryManagerDocumentation.includes("relative paths use the process working directory"), false, "memory/manager lifecycle must not teach process-working-directory resolution");

	g_Assert.deepEqual(Object.keys(g_CanonicalMemoryHelpers).sort(), g_vecMemoryHelpersExports, "memory/helpers export inventory");
	g_Assert.equal("moduleName" in g_CanonicalMemoryHelpers, false, "memory/helpers must not expose moduleName");
	g_Assert.equal("toJSON" in g_CanonicalMemoryHelpers.BaseAddress.prototype, false, "BaseAddress must not expose an address snapshot");
	g_Assert.equal(g_strMemoryHelpersDocumentation.includes("Generated by"), false, "memory/helpers documentation generated marker");

	const g_vecCallingConventionParagraph = /`CALLING_CONVENTIONS` contains ([^;]+);/.exec(g_strMemoryHelpersDocumentation);
	g_Assert(g_vecCallingConventionParagraph, "memory/helpers documents the calling-convention inventory");
	const g_vecDocumentedCallingConventions = [...g_vecCallingConventionParagraph[1].matchAll(/`([^`]+)`/g)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(g_vecDocumentedCallingConventions, Array.from(g_CanonicalMemoryHelpers.CALLING_CONVENTIONS), "documented calling conventions match the native-backed public inventory");

	const g_nMemoryHelpersExportTableStart = g_strMemoryHelpersDocumentation.indexOf("## Exports");
	g_Assert.notEqual(g_nMemoryHelpersExportTableStart, -1, "memory/helpers export table start");

	const g_nMemoryHelpersExportTableEnd = g_strMemoryHelpersDocumentation.indexOf("## Constants", g_nMemoryHelpersExportTableStart);
	g_Assert.notEqual(g_nMemoryHelpersExportTableEnd, -1, "memory/helpers export table boundary");

	const g_vecDocumentedMemoryHelperExports = [...g_strMemoryHelpersDocumentation.slice(g_nMemoryHelpersExportTableStart, g_nMemoryHelpersExportTableEnd).matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)].map((vecMatch) => vecMatch[1]).sort();
	g_Assert.deepEqual(g_vecDocumentedMemoryHelperExports, g_vecMemoryHelpersExports, "memory/helpers documented export inventory");

	const g_nMemoryHelpersDocumentationStart = g_strMemoryHelpersDocumentation.indexOf("### `ArrayView`");
	g_Assert.notEqual(g_nMemoryHelpersDocumentationStart, -1, "memory/helpers ArrayView documentation start");

	const g_nMemoryHelpersDocumentationEnd = g_strMemoryHelpersDocumentation.indexOf("### `Type`", g_nMemoryHelpersDocumentationStart);
	g_Assert.notEqual(g_nMemoryHelpersDocumentationEnd, -1, "memory/helpers Type documentation boundary");

	const g_strMemoryHelpersPreambleDocumentation = g_strMemoryHelpersDocumentation.slice(0, g_nMemoryHelpersDocumentationStart);
	const g_vecMemoryHelpersPreambleJavaScriptBlocks = [...g_strMemoryHelpersPreambleDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMemoryHelpersPreambleJavaScriptBlocks.length, 1, "memory/helpers preamble documentation block count");

	const g_strMemoryHelpersInitialDocumentation = g_strMemoryHelpersDocumentation.slice(g_nMemoryHelpersDocumentationStart, g_nMemoryHelpersDocumentationEnd);
	const g_vecMemoryHelpersInitialJavaScriptBlocks = [...g_strMemoryHelpersInitialDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMemoryHelpersInitialJavaScriptBlocks.length, 9, "memory/helpers initial documentation block count");
	// Deliberate legacy-spelling and invalid-input fixtures guard against stale documentation.
	g_Assert.equal(g_strMemoryHelpersInitialDocumentation.includes("new ArrayView(1"), false, "memory/helpers documentation fabricated ArrayView");
	g_Assert.equal(g_strMemoryHelpersInitialDocumentation.includes("const functionAddress = symbol"), false, "memory/helpers documentation unused function address");

	const g_nMemoryHelpersTypeDocumentationStart = g_nMemoryHelpersDocumentationEnd;
	const g_nMemoryHelpersTypeDocumentationEnd = g_strMemoryHelpersDocumentation.indexOf("### `ReadAddress`", g_nMemoryHelpersTypeDocumentationStart);
	g_Assert.notEqual(g_nMemoryHelpersTypeDocumentationEnd, -1, "memory/helpers ReadAddress documentation boundary");

	const g_strMemoryHelpersTypeDocumentation = g_strMemoryHelpersDocumentation.slice(g_nMemoryHelpersTypeDocumentationStart, g_nMemoryHelpersTypeDocumentationEnd);
	const g_vecMemoryHelpersTypeJavaScriptBlocks = [...g_strMemoryHelpersTypeDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMemoryHelpersTypeJavaScriptBlocks.length, 18, "memory/helpers Type through ReadInt documentation block count");
	g_Assert.equal(g_strMemoryHelpersTypeDocumentation.includes("new Type("), false, "memory/helpers Type must remain static");
	g_Assert.equal(g_strMemoryHelpersTypeDocumentation.includes("-1)"), false, "memory/helpers documentation negative byte size");
	g_Assert.equal(g_strMemoryHelpersTypeDocumentation.includes('symbol("server"'), false, "memory/helpers documentation executable-symbol memory access");
	g_Assert.equal(g_strMemoryHelpersTypeDocumentation.includes("parseData(1, 2"), false, "memory/helpers documentation fabricated parseData inputs");

	const g_nMemoryHelpersAddressDocumentationStart = g_nMemoryHelpersTypeDocumentationEnd;
	const g_nMemoryHelpersAddressDocumentationEnd = g_strMemoryHelpersDocumentation.indexOf("### `ArrayView.Keys`", g_nMemoryHelpersAddressDocumentationStart);
	g_Assert.notEqual(g_nMemoryHelpersAddressDocumentationEnd, -1, "memory/helpers ArrayView.Keys documentation boundary");

	const g_strMemoryHelpersAddressDocumentation = g_strMemoryHelpersDocumentation.slice(g_nMemoryHelpersAddressDocumentationStart, g_nMemoryHelpersAddressDocumentationEnd);
	const g_vecMemoryHelpersAddressJavaScriptBlocks = [...g_strMemoryHelpersAddressDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMemoryHelpersAddressJavaScriptBlocks.length, 18, "memory/helpers ReadAddress through ArrayView.GetOffset documentation block count");
	g_Assert.equal(g_strMemoryHelpersAddressDocumentation.includes("### `WriteAddress`"), true, "memory/helpers WriteAddress documentation section");
	g_Assert.equal(g_strMemoryHelpersAddressDocumentation.includes("searchBytes(addressValue, 2, -1)"), false, "memory/helpers searchBytes negative byte size");
	g_Assert.equal(g_strMemoryHelpersAddressDocumentation.includes("setProtection(addressValue, -1"), false, "memory/helpers setProtection negative byte size");
	g_Assert.equal(g_strMemoryHelpersAddressDocumentation.includes('symbol("server"'), false, "memory/helpers address documentation executable-symbol memory access");
	g_Assert.equal(g_strMemoryHelpersAddressDocumentation.includes("new ArrayView(1"), false, "memory/helpers address documentation fabricated ArrayView");
	g_Assert.equal(g_strMemoryHelpersAddressDocumentation.includes("setProtection(addressValue, -1, 3)"), false, "memory/helpers address documentation magic protection mode");
	g_Assert.equal(g_strMemoryDocumentation.includes("previous protection returned by the native layer"), false, "memory protection documentation return contract");

	const g_nMemoryHelpersCollectionDocumentationStart = g_nMemoryHelpersAddressDocumentationEnd;
	const g_nMemoryHelpersCollectionDocumentationEnd = g_strMemoryHelpersDocumentation.indexOf("### `DataKey.AsInteger`", g_nMemoryHelpersCollectionDocumentationStart);
	g_Assert.notEqual(g_nMemoryHelpersCollectionDocumentationEnd, -1, "memory/helpers DataKey.AsInteger documentation boundary");

	const g_strMemoryHelpersCollectionDocumentation = g_strMemoryHelpersDocumentation.slice(g_nMemoryHelpersCollectionDocumentationStart, g_nMemoryHelpersCollectionDocumentationEnd);
	const g_vecMemoryHelpersCollectionJavaScriptBlocks = [...g_strMemoryHelpersCollectionDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMemoryHelpersCollectionJavaScriptBlocks.length, 20, "memory/helpers ArrayView.Keys through DataKey.AsInt64 documentation block count");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("### `DataKey.AsInt64`"), true, "memory/helpers signed 64-bit metadata documentation section");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("new ArrayView(1"), false, "memory/helpers collection documentation fabricated ArrayView");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes('symbol("server"'), false, "memory/helpers collection documentation executable-symbol memory access");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("new BaseAddress(100)"), false, "memory/helpers collection documentation arbitrary BaseAddress");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("DataKey.asArguments(1, 100)"), false, "memory/helpers collection documentation fabricated DataKey arguments");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("DataKey.asAttributeType(1, 100)"), false, "memory/helpers collection documentation fabricated attribute type");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("DataKey.asBoolean(1, 100)"), false, "memory/helpers collection documentation fabricated boolean");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("DataKey.asConvention(1, 100)"), false, "memory/helpers collection documentation fabricated convention");
	g_Assert.equal(g_strMemoryHelpersCollectionDocumentation.includes("DataKey.asIdentifier(1, 100)"), false, "memory/helpers collection documentation fabricated identifier");

	const g_strMemoryHelpersFinalDocumentation = g_strMemoryHelpersDocumentation.slice(g_nMemoryHelpersCollectionDocumentationEnd);
	const g_vecMemoryHelpersFinalJavaScriptBlocks = [...g_strMemoryHelpersFinalDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMemoryHelpersFinalJavaScriptBlocks.length, 7, "memory/helpers DataKey.AsInteger through Type.Size documentation block count");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes("DataKey.asInteger(1, 100)"), false, "memory/helpers final documentation fabricated integer");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes("DataKey.asReturnType(1, 100)"), false, "memory/helpers final documentation fabricated return type");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes("DataKey.asString(1, 100)"), false, "memory/helpers final documentation fabricated string");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes("new MemberFunction(1"), false, "memory/helpers final documentation fabricated member-function manager");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes("MemberFunction.options"), false, "memory/helpers final documentation snapshot options");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes("_ZN16CCoreDispSurface4InitEv"), false, "memory/helpers final documentation arbitrary Linux member function");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes('GetBinarySymbol("server", "CreateInterface")'), true, "memory/helpers final documentation real callable symbol");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes('Type.IsNativeDataType("server")'), false, "memory/helpers final documentation fabricated native type");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes('Type.NormalizeDataType("server")'), false, "memory/helpers final documentation fabricated normalized type");
	g_Assert.equal(g_strMemoryHelpersFinalDocumentation.includes('Type.GetDataTypeSize("server")'), false, "memory/helpers final documentation fabricated type size");

	const g_MemoryHelpersDocumentationConsole = {
		log() {
			throw new Error("memory/helpers documentation examples must verify results instead of printing them");
		},
	};

	const g_MemoryHelpersDocumentationInterfaces = {
		GetAllInterfaceNames() {
			return g_RootMemoryFixture.InterfaceRecords.map((Record) => Record.Name);
		},

		GetInterfaceRecord(strInterfaceName) {
			const InterfaceRecord = g_RootMemoryFixture.InterfaceRecords.find((Record) => Record.Name === strInterfaceName);

			return InterfaceRecord ? {
				Name: InterfaceRecord.Name,
				Available: true,
				Address: InterfaceRecord.Address,
			} : null;
		},
	};

	const g_RequireMemoryHelpersDocumentation = (strModuleName) => {
		switch (strModuleName) {
			case "interfaces":
				return g_MemoryHelpersDocumentationInterfaces;

			case "memory":
				return g_RootMemory;

			case "memory/helpers":
				return g_CanonicalMemoryHelpers;

			case "memory/manager":
				return g_RootMemoryManager;

			default:
				throw new Error(`Unexpected memory/helpers documentation dependency: ${strModuleName}`);
		}
	};

	const g_unAllocationCountBeforeMemoryHelpersDocumentation = g_mapAllocations.size;
	const g_unActiveHookCountBeforeMemoryHelpersDocumentation = g_RootMemoryFixture.ActiveHookCount();
	const g_vecMemoryHelpersDocumentationExamples = [
		...g_vecMemoryHelpersPreambleJavaScriptBlocks.map((strBlock, unIndex) => [`preamble-example-${unIndex + 1}`, strBlock]),
		...g_vecMemoryHelpersInitialJavaScriptBlocks.map((strBlock, unIndex) => [`initial-example-${unIndex + 1}`, strBlock]),
		...g_vecMemoryHelpersTypeJavaScriptBlocks.map((strBlock, unIndex) => [`type-example-${unIndex + 1}`, strBlock]),
		...g_vecMemoryHelpersAddressJavaScriptBlocks.map((strBlock, unIndex) => [`address-example-${unIndex + 1}`, strBlock]),
		...g_vecMemoryHelpersCollectionJavaScriptBlocks.map((strBlock, unIndex) => [`collection-example-${unIndex + 1}`, strBlock]),
		...g_vecMemoryHelpersFinalJavaScriptBlocks.map((strBlock, unIndex) => [`final-example-${unIndex + 1}`, strBlock]),
	];

	const g_unDocumentationTimeoutMilliseconds = 1000;
	for (const [strExampleName, strBlock] of g_vecMemoryHelpersDocumentationExamples) {
		const Script = new g_VM.Script(`"use strict";\n(() => {\n${strBlock}\n})();`, { filename: `docs/api/memory-helpers.md#${strExampleName}` });
		const Context = g_VM.createContext({
			console: g_MemoryHelpersDocumentationConsole,
			require: g_RequireMemoryHelpersDocumentation,
		});
		Script.runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
		g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemoryHelpersDocumentation, `memory/helpers ${strExampleName} allocation cleanup`);
		g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeMemoryHelpersDocumentation, `memory/helpers ${strExampleName} hook cleanup`);
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemoryHelpersDocumentation, "memory/helpers documentation allocation cleanup");
	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeMemoryHelpersDocumentation, "memory/helpers documentation hook cleanup");
	g_Assert.equal(g_strMemoryHelpersDocumentation.includes("console."), false, "memory/helpers documentation console-only examples");

	const g_vecMemoryManagerDocumentationBlocks = [...g_strMemoryManagerDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	const g_vecMemoryManagerExportSection = g_strMemoryManagerDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
	g_Assert.notEqual(g_vecMemoryManagerExportSection, null, "memory/manager documentation export section");
	g_Assert.equal(g_vecMemoryManagerDocumentationBlocks.length, 63, "memory/manager documentation JavaScript block count");
	g_Assert.equal(g_strMemoryManagerDocumentation.includes("console."), false, "memory/manager examples must verify results instead of printing them");
	g_Assert.equal(g_strMemoryManagerDocumentation.includes("l4d2/server"), false, "memory/manager documentation has no L4D2-only project gamedata");
	g_Assert.equal(g_strMemoryManagerDocumentation.includes("Assume `addons/sourcejs/gamedata"), false, "memory/manager documentation has no missing prerequisite files");
	g_Assert.doesNotMatch(g_strMemoryManagerDocumentation, /require\([^\r\n]+\)\./, "memory/manager documentation uses direct imports");

	const g_vecDocumentedMemoryManagerExports = [...g_vecMemoryManagerExportSection[1].matchAll(/^\| (?:\[)?`([^`(]+)(?:\([^`]*)?`(?:\]\(#[^)]*\))? \|/gm)].map((vecMatch) => vecMatch[1]);
	g_Assert.deepEqual(g_vecDocumentedMemoryManagerExports.filter((strExportName) => !Object.hasOwn(g_RootMemoryManager, strExportName)), [], "memory/manager documented exports must exist on the runtime");

	for (const [, strMethodName] of g_strMemoryManagerDocumentation.matchAll(/### `TypeManager\.([A-Z][A-Za-z0-9_]*)`/g)) {
		g_Assert.equal(typeof g_RootMemoryManager.TypeManager.prototype[strMethodName], "function", `memory/manager TypeManager.${strMethodName} implementation`);
	}

	for (const strMethodName of ["Add", "CreateFromAddress", "Deallocate", "GetMemoryAddress", "OnDeallocate", "Subtract"]) {
		const MethodOwner = (strMethodName === "CreateFromAddress") ? g_RootMemoryManager.CustomType : g_RootMemoryManager.CustomType.prototype;
		g_Assert.equal(typeof MethodOwner[strMethodName], "function", `memory/manager CustomType.${strMethodName} implementation`);
		g_Assert.equal(g_strMemoryManagerDocumentation.includes(`CustomType.${strMethodName}`), true, `memory/manager CustomType.${strMethodName} example`);
	}

	const g_MemoryManagerDocumentationInterfaces = {
		GetAllInterfaceNames() {
			return g_RootMemoryFixture.InterfaceRecords.map((Record) => Record.Name);
		},

		GetInterfaceRecord(strInterfaceName) {
			const InterfaceRecord = g_RootMemoryFixture.InterfaceRecords.find((Record) => Record.Name === strInterfaceName);

			return InterfaceRecord ? {
				Name: InterfaceRecord.Name,
				Available: true,
				Address: InterfaceRecord.Address,
			} : null;
		},
	};

	const g_RequireMemoryManagerDocumentation = (strModuleName) => {
		switch (strModuleName) {
			case "filesystem":
				return g_RootMemoryFixture.ManagerFilesystem;

			case "globals":
				return {
					GetGlobalVariables() {
						return { Address: 0x7000n };
					},
				};

			case "interfaces":
				return g_MemoryManagerDocumentationInterfaces;

			case "memory":
				return g_RootMemory;

			case "memory/helpers":
				return g_CanonicalMemoryHelpers;

			case "memory/manager":
				return g_RootMemoryManager;

			default:
				throw new Error(`Unexpected memory/manager documentation dependency: ${strModuleName}`);
		}
	};

	const g_unAllocationCountBeforeMemoryManagerDocumentation = g_mapAllocations.size;
	const g_unActiveHookCountBeforeMemoryManagerDocumentation = g_RootMemoryFixture.ActiveHookCount();
	const g_unManagerFileCountBeforeDocumentation = g_RootMemoryFixture.ManagerFileCount();
	for (const [unIndex, strBlock] of g_vecMemoryManagerDocumentationBlocks.entries()) {
		const Script = new g_VM.Script(`"use strict";\n(() => {\n${strBlock}\n})();`, { filename: `docs/api/memory-manager.md#example-${unIndex + 1}` });
		const Context = g_VM.createContext({
			Error,
			RangeError,
			ReferenceError,
			require: g_RequireMemoryManagerDocumentation,
			TypeError,
		});
		Script.runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
		g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemoryManagerDocumentation, `memory/manager example-${unIndex + 1} allocation cleanup`);
		g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeMemoryManagerDocumentation, `memory/manager example-${unIndex + 1} hook cleanup`);
		g_Assert.equal(g_RootMemoryFixture.ManagerFileCount(), g_unManagerFileCountBeforeDocumentation, `memory/manager example-${unIndex + 1} file cleanup`);
	}

	g_Assert.equal(VerifyManagerAllocationAndConverterDocumentation(g_vecMemoryManagerDocumentationBlocks, g_RootMemoryManager, g_RequireMemoryManagerDocumentation, () => g_mapAllocations.size), 2831);
	g_Assert.equal(VerifyManagerFileDocumentation(g_vecMemoryManagerDocumentationBlocks, g_RootMemoryManager, g_RequireMemoryManagerDocumentation, () => g_RootMemoryFixture.ManagerFileCount(), () => g_mapAllocations.size), 8491);
	g_Assert.equal(VerifyManagerBackingAllocationDocumentation(g_vecMemoryManagerDocumentationBlocks, g_RootMemoryManager, g_RequireMemoryManagerDocumentation, () => g_mapAllocations.size), 4380);
	g_Assert.equal(VerifyManagerAddressAttributeDocumentation(g_vecMemoryManagerDocumentationBlocks[56], g_RootMemoryManager, g_RequireMemoryManagerDocumentation, () => g_mapAllocations.size), 1890);

	const g_strShortBinaryScanExample = g_vecMemoryManagerDocumentationBlocks.find((strBlock) => strBlock.includes("The server binary is not available for signature scanning."));
	g_Assert.equal(typeof g_strShortBinaryScanExample, "string", "memory/manager binary-size documentation example");

	const g_ShortBinaryScanScript = new g_VM.Script(`"use strict";\n(() => {\n${g_strShortBinaryScanExample}\n})();`, { filename: "docs/api/memory-manager.md#short-binary-scan" });
	const g_ShortBinaryScanContext = g_VM.createContext({
		Error,
		require(strModuleName) {
			if (strModuleName === "memory") {
				return g_RootMemory;
			}

			if (strModuleName === "memory/manager") {
				return {
					...g_RootMemoryManager,
					GetBinary(strBinaryName) {
						return { ...g_RootMemoryManager.GetBinary(strBinaryName), ByteCount: 0xF };
					},
				};
			}

			throw new Error(`Unexpected short-binary documentation dependency: ${strModuleName}`);
		},
	});
	g_Assert.throws(() => g_ShortBinaryScanScript.runInContext(g_ShortBinaryScanContext, { timeout: g_unDocumentationTimeoutMilliseconds }), /The server binary is not available for signature scanning\./, "ScanBinary documentation rejects a binary shorter than the requested signature");

	function CheckManagerCallableDocumentationProfiles() {
		const vecSectionNames = [
			"TypeManager.CreateFunctionTypedefsFromFile",
			"TypeManager.CreatePipe",
			"TypeManager.CreatePipeFromObject",
			"TypeManager.CreatePipeFromFile",
			"TypeManager.Function",
			"TypeManager.FunctionTypedef",
			"TypeManager.PipeFunction",
			"TypeManager.VirtualFunction",
		];
		const vecExamples = vecSectionNames.map(strSectionName => {
			const strHeading = "### `" + strSectionName + "`";
			g_Assert.equal(g_strMemoryManagerDocumentation.split(strHeading).length, 2, "one exact callable-documentation heading");

			const nSectionStart = g_strMemoryManagerDocumentation.indexOf(strHeading);
			const nSectionEnd = g_strMemoryManagerDocumentation.indexOf("\n### ", nSectionStart + strHeading.length);
			const strSection = g_strMemoryManagerDocumentation.slice(nSectionStart, (nSectionEnd < 0) ? undefined : nSectionEnd);
			const vecBlocks = [...strSection.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)];
			g_Assert.equal(vecBlocks.length, 1, "one complete example per callable section");

			return { Name: strSectionName, Code: vecBlocks[0][1] };
		});

		const Convention = new Proxy(g_RootMemory.Convention, {
			get(Enumeration, Property, Receiver) {
				g_Assert.ok(Object.hasOwn(Enumeration, Property), "callable documentation references only public convention entries");

				return Reflect.get(Enumeration, Property, Receiver);
			},
		});

		const MemoryRuntime = { ...g_RootMemory, Convention };
		const vecPlatforms = ["windows", "linux"];
		const vecArchitectures = ["x86", "x64"];

		let unExecutedExampleCount = 0;
		for (const strPlatform of vecPlatforms) {
			for (const strArchitecture of vecArchitectures) {
				// Fixture metadata exposed to the example varies; native execution remains doubled.
				const ManagerRuntime = { ...g_RootMemoryManager, ARCHITECTURE: strArchitecture, PLATFORM: strPlatform };
				const Require = strModuleName => (strModuleName === "memory/manager") ? ManagerRuntime : ((strModuleName === "memory") ? MemoryRuntime : g_RequireMemoryManagerDocumentation(strModuleName));

				for (const Example of vecExamples) {
					const Script = new g_VM.Script('"use strict";\n(() => {\n' + Example.Code + '\n})();', { filename: `docs/api/memory-manager.md#${Example.Name}-${strPlatform}-${strArchitecture}` });
					g_Assert.doesNotThrow(() => Script.runInNewContext({ Error, RangeError, ReferenceError, require: Require, TypeError }, { timeout: g_unDocumentationTimeoutMilliseconds }), "callable documentation must use conventions accepted by the actual JavaScript manager in every metadata profile");
					unExecutedExampleCount += 1;
				}
			}
		}

		g_Assert.equal(unExecutedExampleCount, vecExamples.length * vecPlatforms.length * vecArchitectures.length, "all callable examples exercise all platform/architecture selections");
	}

	function CheckManagerDefinitionAndPipeDescriptorContracts() {
		const Manager = new g_RootMemoryManager.TypeManager();
		const strFilePath = g_RootMemoryManager.ROOT + "/sourcejs-smoke/manager-partial-function-typedefs.json";
		const Filesystem = g_RootMemoryFixture.ManagerFilesystem;
		g_Assert.equal(Filesystem.DoesFileExist(strFilePath), false, "the partial-registration fixture never overwrites an existing file");

		try {
			g_Assert.equal(Filesystem.WriteTextFile(strFilePath, JSON.stringify({
				ContractFirstCallable: { Convention: "cdecl", ReturnType: "address" },
				ContractSecondCallable: { Convention: "win64", ReturnType: "address" },
			})), true, "write the partial-registration fixture");
			g_Assert.throws(() => Manager.CreateFunctionTypedefsFromFile(strFilePath), /Unknown SourceJS calling convention/, "later invalid metadata fails registration");
			g_Assert.equal(Manager.FunctionTypedefs.has("ContractFirstCallable"), true, "earlier typedef registration is retained");
			g_Assert.equal(Manager.FunctionTypedefs.has("ContractSecondCallable"), false, "the invalid typedef is not registered");
		} finally {
			if (Filesystem.DoesFileExist(strFilePath)) {
				g_Assert.equal(Filesystem.RemoveFile(strFilePath), true, "partial-registration fixture cleanup");
			}
		}

		const KnownType = Manager.CreateType("ContractKnownGlobal", { Size: g_unManagedDefinitionMinimumByteCount });
		g_Assert.throws(() => Manager.CreateGlobalAddressesFromObject({
			ContractKnownGlobal: { Binary: "server", Identifier: "CreateInterface" },
			ContractUnknownGlobal: { Binary: "server", Identifier: "CreateInterface" },
		}), /registered TypeReference/, "an unregistered later global type fails resolution");

		const GlobalView = Manager.GlobalAddresses.get("ContractKnownGlobal");
		g_Assert.equal(GlobalView instanceof KnownType, true, "earlier typed global view is retained");
		g_Assert.equal(GlobalView.Address, g_RootMemoryManager.GetBinarySymbol("server", "CreateInterface"));
		g_Assert.equal(GlobalView.OwnsAddress, false, "retained global views never own native storage");
		g_Assert.equal(Manager.GlobalAddresses.has("ContractUnknownGlobal"), false);

		const SharedValue = { Value: 1 };
		const HiddenKey = Symbol("ContractHiddenPipeValue");
		const Descriptor = {
			SharedValue,

			get Receiver() {
				return this;
			},
		};
		Object.defineProperty(Descriptor, HiddenKey, { configurable: false, enumerable: false, value: SharedValue, writable: false });

		const Pipe = Manager.CreatePipe(Descriptor);
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Pipe, HiddenKey), Object.getOwnPropertyDescriptor(Descriptor, HiddenKey), "symbol and non-enumerable descriptor flags are preserved");
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Pipe, "Receiver"), Object.getOwnPropertyDescriptor(Descriptor, "Receiver"), "accessor descriptors are copied without invoking them");
		g_Assert.equal(Pipe.Receiver, Pipe, "static accessor receiver is the pipe class");
		g_Assert.equal(Pipe.SharedValue, SharedValue, "object-valued descriptors are shallow copies");

		Descriptor.SharedValue = {};
		g_Assert.equal(Pipe.SharedValue, SharedValue, "replacing the descriptor's value does not replace the installed member");

		Pipe.SharedValue.Value = 2;
		g_Assert.equal(SharedValue.Value, 2, "the installed object reference remains shared");

		g_Assert.throws(() => Manager.CreatePipe({ prototype: {} }), TypeError, "incompatible protected class descriptors are rejected");
	}

	CheckManagerCallableDocumentationProfiles();
	CheckManagerDefinitionAndPipeDescriptorContracts();

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemoryManagerDocumentation, "memory/manager documentation allocation cleanup");
	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeMemoryManagerDocumentation, "memory/manager documentation hook cleanup");
	g_Assert.equal(g_RootMemoryFixture.ManagerFileCount(), g_unManagerFileCountBeforeDocumentation, "memory/manager documentation file cleanup");

	for (const [strDocumentationName, strDocumentation] of [
		["memory", g_strMemoryDocumentation],
		["memory/manager", g_strMemoryManagerDocumentation],
	]) {
		const strScanExample = 'ScanBinary("server",';

		g_Assert.equal(strDocumentation.includes("findSignature"), false, `${strDocumentationName} documentation findSignature alias`);
		g_Assert.equal(strDocumentation.includes("findSymbol"), false, `${strDocumentationName} documentation findSymbol alias`);
		g_Assert.equal(strDocumentation.includes(strScanExample), true, `${strDocumentationName} documentation signature scan example`);
		g_Assert.equal(strDocumentation.includes('GetBinarySymbol("server", "_ZN16CCoreDispSurface4InitEv")'), true, `${strDocumentationName} documentation Linux symbol example`);
	}

	const g_CanonicalBinaryFile = new g_RootMemory.BinaryFile("server");
	g_Assert.equal(g_CanonicalBinaryFile.DereferenceBinaryAddress("MissingExport", 0n, 1), 0n, "missing binary address dereference");
	g_Assert.equal("ResolveAddress" in g_CanonicalBinaryFile, false, "BinaryFile must not expose ResolveAddress alias");
	g_Assert.equal("DeReferenceAddress" in g_CanonicalBinaryFile, false, "BinaryFile must not expose DeReferenceAddress alias");
	g_Assert.equal("Info" in g_CanonicalBinaryFile, false, "BinaryFile must not expose Info alias");
	g_Assert.equal("Address" in g_CanonicalBinaryFile, true, "BinaryFile must expose Address property");
	g_Assert.equal("address" in g_CanonicalBinaryFile, false, "BinaryFile must not expose address alias");
	g_Assert.equal("Size" in g_CanonicalBinaryFile, false, "BinaryFile must not expose Size alias");

	CheckNativeMathlibBindingNames();
	CheckNativeMathlibDefaults();
	CheckNativeRadianEulerComponentOrder();
	CheckNativeQAngleOutputShape();
	CheckNativeFloatStructureContract();

	const g_Mathlib = LoadMathlib();
	CheckFloatStructurePrivateStorage(g_Mathlib);
	CheckPlanePrivateStorage(g_Mathlib);
	CheckMatrixPrivateStorage(g_Mathlib);

	g_Assert.equal(g_RootMemory.RegisterObjectType("Vector", g_Mathlib.Vector, { Size: g_Mathlib.VECTOR_SIZE }), true, "root memory Vector registration");

	const g_nMemoryFunctionDocumentationStart = g_strMemoryDocumentation.indexOf("### `BinaryFile.DereferenceBinaryAddress`");
	g_Assert.notEqual(g_nMemoryFunctionDocumentationStart, -1, "memory BinaryFile documentation start");

	const g_nMemoryFunctionDocumentationEnd = g_strMemoryDocumentation.indexOf("## Address", g_nMemoryFunctionDocumentationStart);
	g_Assert.notEqual(g_nMemoryFunctionDocumentationEnd, -1, "memory Address documentation boundary");

	const g_strMemoryFunctionDocumentation = g_strMemoryDocumentation.slice(g_nMemoryFunctionDocumentationStart, g_nMemoryFunctionDocumentationEnd);
	const g_vecMemoryFunctionJavaScriptBlocks = [...g_strMemoryFunctionDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	const g_strMemoryInitialDocumentation = g_strMemoryDocumentation.slice(0, g_nMemoryFunctionDocumentationStart);
	const g_vecMemoryInitialJavaScriptBlocks = [...g_strMemoryInitialDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	g_Assert.equal(g_vecMemoryInitialJavaScriptBlocks.length, 10, "memory root documentation block count");
	g_Assert.equal(g_vecMemoryFunctionJavaScriptBlocks.length, 20, "memory BinaryFile/Function/FunctionInfo documentation block count");
	g_Assert.equal(g_strMemoryFunctionDocumentation.includes("_ZN16CCoreDispSurface4InitEv"), false, "memory Function examples must not invent a Linux symbol ABI");
	g_Assert.equal(g_strMemoryFunctionDocumentation.includes("addHook(DataType"), false, "memory Function.AddHook must use HookType");
	g_Assert.equal(g_strMemoryFunctionDocumentation.includes("removeHook(DataType"), false, "memory Function.RemoveHook must use HookType");

	const g_MemoryDocumentationConsole = {
		log() {
			throw new Error("memory documentation must verify results instead of printing them");
		},
	};

	const g_MemoryDocumentationInterfaces = {
		GetAllInterfaceNames() {
			return g_RootMemoryFixture.InterfaceRecords.map((Record) => Record.Name);
		},

		GetInterfaceRecord(strInterfaceName) {
			const InterfaceRecord = g_RootMemoryFixture.InterfaceRecords.find((Record) => Record.Name === strInterfaceName);

			return InterfaceRecord ? {
				Name: InterfaceRecord.Name,
				Available: true,
				Address: InterfaceRecord.Address,
			} : null;
		},
	};

	const g_RequireMemoryDocumentation = (strModuleName) => {
		switch (strModuleName) {
			case "interfaces":
				return g_MemoryDocumentationInterfaces;

			case "engines/server":
				return {
					GetServer() {
						return {
							GetAllocatedClientCount() {
								return 0;
							},

							GetClient() {
								throw new Error("No client is allocated in the memory smoke fixture");
							},
						};
					},
				};

			case "mathlib":
				return g_Mathlib;

			case "memory":
				return g_RootMemory;

			case "memory/gamedata":
				return g_RootMemory.GameData;

			case "memory/helpers":
				return g_RootMemory.Helpers;

			case "memory/hooks":
				return g_RootMemoryFixture.RootHooks;

			case "memory/manager":
				return g_RootMemoryManager;

			case "players/baseclient":
				return {
					CreateBaseClientFromAddress() {
						throw new Error("BaseClient profile is unavailable in the memory smoke fixture");
					},

					GetBaseClientType() {
						throw new Error("BaseClient profile is unavailable in the memory smoke fixture");
					},

					HasBaseClientGameData() {
						return false;
					},
				};

			default:
				throw new Error(`Unexpected memory documentation dependency: ${strModuleName}`);
		}
	};

	function ExecuteMemoryDocumentationBlocks(vecBlocks, strLabel) {
		const unAllocationCount = g_mapAllocations.size;
		const unHookCount = g_RootMemoryFixture.ActiveHookCount();
		for (const [unIndex, strBlock] of vecBlocks.entries()) {
			const Script = new g_VM.Script(`"use strict";\n(() => {\n${strBlock}\n})();`, { filename: `docs/api/memory.md#${strLabel}-example-${unIndex + 1}` });
			const Context = g_VM.createContext({
				console: g_MemoryDocumentationConsole,
				Error,
				RangeError,
				ReferenceError,
				require: g_RequireMemoryDocumentation,
				TypeError,
			});
			Script.runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
			g_Assert.equal(g_mapAllocations.size, unAllocationCount, `memory ${strLabel} example-${unIndex + 1} allocation cleanup`);
			g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), unHookCount, `memory ${strLabel} example-${unIndex + 1} hook cleanup`);
		}
	}

	function CheckBinaryFileAddressChainAllocationFailures(strChainExample) {
		for (const unFailureIndex of [1, 2, 3]) {
			for (const strFailureMode of ["THROW", "NULL"]) {
				const unAllocationCount = g_mapAllocations.size;
				const vecAllocatedAddresses = [];
				const setReleasedAddresses = new Set();
				let unAllocateCallCount = 0;
				const MemoryRuntime = {
					Address: g_RootMemory.Address,
					BinaryFile: g_RootMemory.BinaryFile,
					DataType: g_RootMemory.DataType,
					GetDataTypeSize: g_RootMemory.GetDataTypeSize,

					Allocate(unByteSize) {
						++unAllocateCallCount;

						if (unAllocateCallCount === unFailureIndex) {
							if (strFailureMode === "THROW") {
								throw new Error("Injected address-chain allocation failure.");
							}

							return 0n;
						}

						const unAddress = g_RootMemory.Allocate(unByteSize);
						vecAllocatedAddresses.push(unAddress);

						return unAddress;
					},

					Deallocate(unAddress) {
						g_Assert.equal(vecAllocatedAddresses.includes(unAddress), true, "address-chain cleanup owns this allocation");
						g_Assert.equal(setReleasedAddresses.has(unAddress), false, "address-chain cleanup never releases twice");
						setReleasedAddresses.add(unAddress);

						return g_RootMemory.Deallocate(unAddress);
					},
				};

				function Require(strModuleName) {
					g_Assert.equal(strModuleName, "memory", "address-chain example dependency");

					return MemoryRuntime;
				}

				const Script = new g_VM.Script('"use strict";\n' + strChainExample, { filename: "memory.md address-chain partial allocation" });
				const FailurePattern = (strFailureMode === "THROW") ? /Injected address-chain allocation failure\./ : /Allocate\(\) failed to create address-chain storage\./;
				g_Assert.throws(() => Script.runInNewContext({ require: Require, Error }, { timeout: g_unDocumentationTimeoutMilliseconds }), FailurePattern, "address-chain allocation failure " + strFailureMode + " at " + unFailureIndex);
				g_Assert.equal(setReleasedAddresses.size, vecAllocatedAddresses.length, "address-chain releases every acquired allocation");
				g_Assert.equal(g_mapAllocations.size, unAllocationCount, "address-chain partial allocation leaves no storage");
			}
		}
	}

	CheckBinaryFileAddressChainAllocationFailures(g_vecMemoryFunctionJavaScriptBlocks[0]);
	g_Assert.equal(VerifyMemoryChainDocumentation(g_vecMemoryFunctionJavaScriptBlocks[0], g_RequireMemoryDocumentation, () => g_mapAllocations.size), 8052);

	const g_unAllocationCountBeforeMemoryInitialDocumentation = g_mapAllocations.size;
	const g_unActiveHookCountBeforeMemoryInitialDocumentation = g_RootMemoryFixture.ActiveHookCount();

	ExecuteMemoryDocumentationBlocks(g_vecMemoryInitialJavaScriptBlocks, "root");
	g_Assert.equal(VerifyMemoryAllocationDocumentation(g_vecMemoryInitialJavaScriptBlocks, g_RequireMemoryDocumentation, () => g_mapAllocations.size), 2568);

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemoryInitialDocumentation, "memory root documentation allocation cleanup");
	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeMemoryInitialDocumentation, "memory root documentation hook cleanup");

	const g_unAllocationCountBeforeMemoryDocumentation = g_mapAllocations.size;
	const g_unActiveHookCountBeforeMemoryDocumentation = g_RootMemoryFixture.ActiveHookCount();

	ExecuteMemoryDocumentationBlocks(g_vecMemoryFunctionJavaScriptBlocks, "binary-function");
	g_Assert.equal(VerifyMemoryFunctionHookDocumentation(g_vecMemoryFunctionJavaScriptBlocks, g_RootMemoryFixture, g_RequireMemoryDocumentation), 17066);

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeMemoryDocumentation, "memory documentation allocation cleanup");
	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeMemoryDocumentation, "memory documentation hook cleanup");

	function CheckAddressDocumentationAllocationFailures(strExample, strMemberName) {
		for (const unFailureIndex of [1, 2]) {
			for (const strFailureMode of ["THROW", "NULL"]) {
				const unAllocationCount = g_mapAllocations.size;
				const vecAllocatedAddresses = [];
				const setReleasedAddresses = new Set();
				let unAllocateCallCount = 0;
				const MemoryRuntime = {
					Address: g_RootMemory.Address,
					DataType: g_RootMemory.DataType,
					TYPE_SIZES: g_RootMemory.TYPE_SIZES,

					Allocate(unByteSize) {
						++unAllocateCallCount;

						if (unAllocateCallCount === unFailureIndex) {
							if (strFailureMode === "THROW") {
								throw new Error("Injected Address example allocation failure.");
							}

							return 0n;
						}

						const unAddress = g_RootMemory.Allocate(unByteSize);
						vecAllocatedAddresses.push(unAddress);

						return unAddress;
					},

					Deallocate(unAddress) {
						g_Assert.equal(vecAllocatedAddresses.includes(unAddress), true, strMemberName + " cleanup owns this allocation");
						g_Assert.equal(setReleasedAddresses.has(unAddress), false, strMemberName + " cleanup never releases twice");
						setReleasedAddresses.add(unAddress);

						return g_RootMemory.Deallocate(unAddress);
					},
				};

				function Require(strModuleName) {
					if (strModuleName === "memory/manager") {
						return g_RequireMemoryDocumentation(strModuleName);
					}

					g_Assert.equal(strModuleName, "memory", strMemberName + " example dependency");

					return MemoryRuntime;
				}

				const Script = new g_VM.Script('"use strict";\n' + strExample, { filename: "memory.md " + strMemberName + " partial allocation" });
				const FailurePattern = (strFailureMode === "THROW") ? /Injected Address example allocation failure\./ : /Allocate\(\) failed to create/;
				g_Assert.throws(() => Script.runInNewContext({ require: Require, Error }, { timeout: g_unDocumentationTimeoutMilliseconds }), FailurePattern, strMemberName + " allocation failure " + strFailureMode + " at " + unFailureIndex);
				g_Assert.equal(setReleasedAddresses.size, vecAllocatedAddresses.length, strMemberName + " releases every acquired allocation");
				g_Assert.equal(g_mapAllocations.size, unAllocationCount, strMemberName + " partial allocation leaves no storage");
			}
		}
	}

	function CheckAddressDocumentationConstructionFailure(strExample, strMemberName) {
		const unAllocationCount = g_mapAllocations.size;
		const vecAllocatedAddresses = [];
		const setReleasedAddresses = new Set();
		const MemoryRuntime = {
			DataType: g_RootMemory.DataType,
			GetDataTypeSize: g_RootMemory.GetDataTypeSize,
			Address: new Proxy(g_RootMemory.Address, {
				construct() {
					throw new Error("Injected Address example construction failure.");
				},
			}),

			Allocate(unByteSize) {
				const unAddress = g_RootMemory.Allocate(unByteSize);
				vecAllocatedAddresses.push(unAddress);

				return unAddress;
			},

			Deallocate(unAddress) {
				g_Assert.equal(vecAllocatedAddresses.includes(unAddress), true, strMemberName + " construction cleanup owns this allocation");
				g_Assert.equal(setReleasedAddresses.has(unAddress), false, strMemberName + " construction cleanup never releases twice");
				setReleasedAddresses.add(unAddress);

				return g_RootMemory.Deallocate(unAddress);
			},
		};

		function Require(strModuleName) {
			g_Assert.equal(strModuleName, "memory", strMemberName + " construction example dependency");

			return MemoryRuntime;
		}

		const Script = new g_VM.Script('"use strict";\n' + strExample, { filename: "memory.md " + strMemberName + " construction failure" });
		g_Assert.throws(() => Script.runInNewContext({ require: Require, Error }, { timeout: g_unDocumentationTimeoutMilliseconds }), /Injected Address example construction failure\./, strMemberName + " constructor failure");
		g_Assert.equal(vecAllocatedAddresses.length, 1, strMemberName + " acquired one raw allocation");
		g_Assert.equal(setReleasedAddresses.size, 1, strMemberName + " releases raw allocation after constructor failure");
		g_Assert.equal(g_mapAllocations.size, unAllocationCount, strMemberName + " constructor failure leaves no storage");
	}

	const g_nAddressDocumentationStart = g_nMemoryFunctionDocumentationEnd;
	g_Assert.notEqual(g_nAddressDocumentationStart, -1, "memory Address documentation start");

	const g_nAddressDocumentationEnd = g_strMemoryDocumentation.indexOf("## Address-backed QAngle examples", g_nAddressDocumentationStart);
	g_Assert.ok(g_nAddressDocumentationEnd > g_nAddressDocumentationStart, "memory Address documentation end");

	const g_strAddressDocumentation = g_strMemoryDocumentation.slice(g_nAddressDocumentationStart, g_nAddressDocumentationEnd);
	const g_vecAddressJavaScriptBlocks = [...g_strAddressDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecAddressJavaScriptBlocks.length, 53, "memory Address documentation block count");
	g_Assert.equal(g_strAddressDocumentation.includes("_ZN16CCoreDispSurface4InitEv"), false, "memory Address examples must not write to a Linux symbol");
	g_Assert.equal(g_strAddressDocumentation.includes("setProtection(1, -1)"), false, "memory Address examples must use a valid protection range");

	const g_unAllocationCountBeforeAddressDocumentation = g_mapAllocations.size;
	const g_unActiveHookCountBeforeAddressDocumentation = g_RootMemoryFixture.ActiveHookCount();

	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[7], "Address.Compare");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[8], "Address.CompareTo");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[9], "Address.CopyFrom");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[10], "Address.CopyTo");
	CheckAddressDocumentationConstructionFailure(g_vecAddressJavaScriptBlocks[0], "Address identity");
	CheckAddressDocumentationConstructionFailure(g_vecAddressJavaScriptBlocks[3], "Address.Owned");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[21], "Address.GetStringAddress");
	CheckAddressDocumentationConstructionFailure(g_vecAddressJavaScriptBlocks[11], "Address.Deallocate");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[27], "Address.GetVirtualFunction");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[30], "Address.MakeVirtualFunction");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[33], "Address.ReadAddress");
	CheckAddressDocumentationConstructionFailure(g_vecAddressJavaScriptBlocks[34], "Address.Reallocate");
	CheckAddressDocumentationAllocationFailures(g_vecAddressJavaScriptBlocks[43], "Address.SetAddress");

	ExecuteMemoryDocumentationBlocks(g_vecAddressJavaScriptBlocks, "address");
	g_Assert.equal(VerifyMemoryAddressDocumentation(g_vecAddressJavaScriptBlocks, g_RequireMemoryDocumentation, () => g_mapAllocations.size), 9363);
	g_Assert.equal(VerifyMemoryAddressPairDocumentation(g_vecAddressJavaScriptBlocks, g_RequireMemoryDocumentation, () => g_mapAllocations.size), 21996);
	g_Assert.equal(VerifyMemoryAddressSetterDocumentation(g_vecAddressJavaScriptBlocks, g_RequireMemoryDocumentation, () => g_mapAllocations.size), 6567);
	g_Assert.equal(VerifyMemoryErrorDocumentation(g_vecAddressJavaScriptBlocks[52], g_RequireMemoryDocumentation, () => g_mapAllocations.size), 402);

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeAddressDocumentation, "memory Address documentation allocation cleanup");
	g_Assert.equal(g_RootMemoryFixture.ActiveHookCount(), g_unActiveHookCountBeforeAddressDocumentation, "memory Address documentation hook cleanup");
	g_Assert.throws(() => new g_RootMemory.Address(0n, "true"), /boolean/, "Address owned state must be strict");

	const g_unStrictAddressValue = g_RootMemory.Allocate(2 * g_RootMemory.GetDataTypeSize(g_RootMemory.DataType.Int));

	try {
		const StrictAddress = new g_RootMemory.Address(g_unStrictAddressValue);
		g_Assert.throws(() => StrictAddress.SetBool(1), /boolean/, "Address.SetBool must reject numeric booleans");
		g_Assert.throws(() => StrictAddress.SetInt("1"), /safe integer/, "Address.SetInt must reject numeric strings");
	} finally {
		g_Assert.equal(g_RootMemory.Deallocate(g_unStrictAddressValue), true, "strict Address fixture allocation cleanup");
	}

	const g_vecCanonicalMathlibExports = Object.freeze([
		"AddVector",
		"CalculateVectorCrossProduct",
		"CalculateVectorDistance",
		"CalculateVectorDistanceSquared",
		"CalculateVectorDotProduct",
		"ConvertMatrix3x4ToVMatrix",
		"ConvertQAngleToRadianEuler",
		"ConvertQAngleToVectors",
		"ConvertQuaternionToRadianEuler",
		"ConvertRadianEulerToQAngle",
		"ConvertRadianEulerToQuaternion",
		"ConvertVMatrixToMatrix3x4",
		"ConvertVectorToQAngle",
		"CreateIdentityVMatrix",
		"CreateMatrix3x4FromAxes",
		"DivideVector",
		"FLOAT_SIZE",
		"GetMatrix3x4Angles",
		"GetMatrix3x4Position",
		"GetMaximumVector",
		"GetMinimumVector",
		"GetRandomVector",
		"GetVMatrixAngles",
		"GetVMatrixPosition",
		"GetVectorLength",
		"GetVectorLength2D",
		"GetVectorLength2DSquared",
		"GetVectorLengthSquared",
		"GetVectorPerpendicularBasis",
		"InvalidateMatrix3x4",
		"IsVectorLengthGreaterThan",
		"IsVectorLengthLessThan",
		"IsVectorWithinBox",
		"IsVectorZero",
		"MATRIX3X4_SIZE",
		"Matrix3x4",
		"MultiplyAndAddVector",
		"MultiplyVector",
		"NegateVector",
		"NormalizeVector",
		"PLANE_SIZE",
		"Plane",
		"QANGLE_SIZE",
		"QAngle",
		"QUATERNION_SIZE",
		"Quaternion",
		"RADIAN_EULER_SIZE",
		"RadianEuler",
		"SubtractVector",
		"VECTOR_SIZE",
		"VMATRIX_SIZE",
		"VMatrix",
		"Vector",
	].sort());
	g_Assert.deepEqual(Object.keys(g_Mathlib).sort(), g_vecCanonicalMathlibExports, "canonical mathlib export inventory");
	g_Assert.equal("FromAddress" in g_Mathlib.Vector, false, "mathlib must not expose address aliases");
	g_Assert.equal("ToArray" in new g_Mathlib.Vector(), false, "mathlib must not expose array aliases");

	const g_CanonicalVector = new g_Mathlib.Vector(1, 2, 3);
	g_Assert.deepEqual(g_CanonicalVector.ConvertMathStructureToArray(), [1, 2, 3], "canonical Vector values");
	g_Assert.deepEqual(g_CanonicalVector.AddScalar(9).ConvertMathStructureToArray(), [10, 11, 12], "canonical Vector scalar addition");
	g_Assert.equal(g_CanonicalVector.GetMemoryAddress(), 0n, "detached Vector address");
	g_Assert.equal(g_CanonicalVector.IsMathStructureValid(), true, "canonical Vector validity");

	g_Assert.equal(typeof g_Mathlib.IsVectorWithinBox, "function", "canonical Vector box predicate");
	g_Assert.equal(g_Mathlib.IsVectorWithinBox(g_CanonicalVector, new g_Mathlib.Vector(0, 0, 0), new g_Mathlib.Vector(2, 3, 4)), true, "canonical Vector box test");

	const g_CanonicalMatrix = new g_Mathlib.Matrix3x4();
	g_Assert.deepEqual(g_CanonicalMatrix.ConvertMatrixToArray(), [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "canonical Matrix3x4 values");
	g_Assert.equal(g_CanonicalMatrix.GetMatrixComponent(0, 0), 0, "canonical Matrix3x4 component");
	g_Assert.equal(g_CanonicalMatrix.GetMatrix3x4Row(0).Matrix, g_CanonicalMatrix, "canonical MatrixRow owner");

	g_Assert.equal(typeof g_CanonicalMatrix.InvalidateMatrix3x4, "function", "canonical Matrix3x4 invalidation method");
	g_CanonicalMatrix.InvalidateMatrix3x4();
	g_Assert.equal(g_CanonicalMatrix.IsMathStructureValid(), false, "canonical Matrix3x4 invalidation");

	const g_strMathlibDocumentation = g_FileSystem.readFileSync(g_strMathlibDocumentationPath, "utf8");
	const g_vecFenceMatches = [...g_strMathlibDocumentation.matchAll(/^```([^\r\n]*)/gm)];
	const g_vecMathlibJavaScriptBlocks = [...g_strMathlibDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecMathlibJavaScriptBlocks.length, 28, "mathlib documentation JavaScript block count");
	g_Assert.equal(g_vecFenceMatches.length, g_vecMathlibJavaScriptBlocks.length * 2, "mathlib documentation fence count");

	for (let unFenceIndex = 0; unFenceIndex < g_vecFenceMatches.length; unFenceIndex += 1) {
		const strExpectedLanguage = ((unFenceIndex % 2) === 0) ? "js" : "";
		g_Assert.equal(g_vecFenceMatches[unFenceIndex][1], strExpectedLanguage, `mathlib documentation fence ${unFenceIndex + 1}`);
	}

	const g_vecInlineCodeTokens = [...g_strMathlibDocumentation.matchAll(/`([^`\r\n]+)`/g)].map((vecMatch) => vecMatch[1]);
	const g_setDocumentedAPINames = new Set(g_vecCanonicalMathlibExports);
	for (const strMatrixRowMember of ["Matrix", "RowIndex", "GetMatrixRowComponent", "SetMatrixRowComponent", "ConvertMatrixRowToArray", "[Symbol.iterator]"]) {
		g_setDocumentedAPINames.add(strMatrixRowMember);
	}

	for (const strName of g_setDocumentedAPINames) {
		g_Assert.equal(DoesInlineCodeReferenceName(g_vecInlineCodeTokens, strName), true, `mathlib documentation must reference ${strName} as code`);
	}

	for (const strStaleText of [
		"Generated API reference",
		"Generated from",
		"_ZN16CCoreDispSurface4InitEv",
		"console.log(result)",
		"copyTo_example",
		"## Remaining sections",
		"The native runtime name `AngleVectors` is retained",
		"The selected runtime also exposes",
		"Vector instances also provide `Add`",
	]) {
		g_Assert.equal(g_strMathlibDocumentation.includes(strStaleText), false, `mathlib documentation contains stale text: ${strStaleText}`);
	}

	const g_vecDocumentationLines = g_strMathlibDocumentation.split(/\r?\n/);
	g_Assert.equal(g_vecDocumentationLines.findIndex((strLine) => /[\t ]+$/.test(strLine)), -1, "mathlib documentation trailing whitespace");
	g_Assert.equal(/\r?\n\r?\n\r?\n/.test(g_strMathlibDocumentation), false, "mathlib documentation consecutive blank lines");

	const g_setDocumentationHeadings = new Set([...g_strMathlibDocumentation.matchAll(/^#{1,6} (.+)$/gm)].map((vecMatch) => GetMarkdownAnchor(vecMatch[1])));
	const g_mapLinkedHeadingCache = new Map();
	for (const vecMatch of g_strMathlibDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strTarget = vecMatch[1];
		if (/^[a-z][a-z0-9+.-]*:/i.test(strTarget) || strTarget.startsWith("/")) {
			continue;
		}

		const [strRelativePath, strFragment = ""] = strTarget.split("#", 2);
		if (strRelativePath === "") {
			g_Assert.equal(g_setDocumentationHeadings.has(strFragment), true, `mathlib documentation local anchor: #${strFragment}`);
			continue;
		}

		const strLinkedPath = g_Path.resolve(g_Path.dirname(g_strMathlibDocumentationPath), strRelativePath);
		g_Assert.equal(g_FileSystem.existsSync(strLinkedPath), true, `mathlib documentation relative link: ${strTarget}`);

		if (strFragment === "") {
			continue;
		}

		if (!g_mapLinkedHeadingCache.has(strLinkedPath)) {
			const strLinkedDocumentation = g_FileSystem.readFileSync(strLinkedPath, "utf8");
			g_mapLinkedHeadingCache.set(strLinkedPath, new Set([...strLinkedDocumentation.matchAll(/^#{1,6} (.+)$/gm)].map((vecMatch) => GetMarkdownAnchor(vecMatch[1]))));
		}

		g_Assert.equal(g_mapLinkedHeadingCache.get(strLinkedPath).has(strFragment), true, `mathlib documentation linked anchor: ${strTarget}`);
	}

	const g_DocumentationConsole = {
		log() {
			throw new Error("mathlib documentation must verify results instead of printing them");
		},
	};

	const g_RequireMathlibDocumentation = (strModuleName) => {
		if (strModuleName === "mathlib") {
			return g_Mathlib;
		}

		if (strModuleName === "memory") {
			return g_MemoryModule;
		}

		throw new Error(`unexpected mathlib documentation dependency: ${strModuleName}`);
	};

	function CheckAddressViewExampleFailures() {
		g_Assert.equal(g_CanonicalMemoryHelpers.Address(), 0n);

		for (const AddressValue of [undefined, null]) {
			g_Assert.equal(g_CanonicalMemoryHelpers.Address(AddressValue), 0n);

			const EmptyAddress = new g_CanonicalMemoryHelpers.BaseAddress(AddressValue);
			g_Assert.equal(EmptyAddress.Address, 0n);
			g_Assert.equal(EmptyAddress.Null, true);
			g_Assert.equal(EmptyAddress.HasAddress(), false);
		}

		for (const Constants of [g_CanonicalMemoryHelpers.Type, g_CanonicalMemoryHelpers.DataKey]) {
			for (const strPropertyName of Object.keys(Constants)) {
				const Descriptor = Object.getOwnPropertyDescriptor(Constants, strPropertyName);
				g_Assert.equal(Descriptor.writable, true, strPropertyName);
				g_Assert.equal(Descriptor.configurable, true, strPropertyName);
			}
		}

		const DefaultArrayView = new g_CanonicalMemoryHelpers.ArrayView(null, false, "int", 0n, 0);
		g_Assert.equal(DefaultArrayView.AllocatedAddresses, null);
		g_Assert.equal(DefaultArrayView.AddressValues instanceof Map, true);

		const setOwnedAddresses = new Set();
		const mapRetainedValues = new Map();
		const TrackedArrayView = new g_CanonicalMemoryHelpers.ArrayView(null, true, "int", 0n, 0, setOwnedAddresses, mapRetainedValues);
		g_Assert.equal(TrackedArrayView.AllocatedAddresses, setOwnedAddresses);
		g_Assert.equal(TrackedArrayView.AddressValues, mapRetainedValues);

		const UnresolvedCustomView = new g_CanonicalMemoryHelpers.ArrayView(null, false, "MissingDocumentationClass", 0n);
		g_Assert.equal(UnresolvedCustomView.TypeName, "MissingDocumentationClass");
		g_Assert.throws(() => UnresolvedCustomView.GetOffset(0), /custom types require a type manager/);

		const vecConfigurations = [
			{ Name: "Vector", Size: g_Mathlib.VECTOR_SIZE, Marker: "Address-backed Vector views do not share live storage.", Method: "InitializeMathStructure" },
			{ Name: "Plane", Size: g_Mathlib.PLANE_SIZE, Marker: "Second Plane view did not observe the native writes.", Setter: "Distance" },
			{ Name: "Matrix3x4", Size: g_Mathlib.MATRIX3X4_SIZE, Marker: "Native Matrix3x4 write-through failed.", Method: "SetMatrixComponent" },
			{ Name: "VMatrix", Size: g_Mathlib.VMATRIX_SIZE, Marker: "Native VMatrix storage did not preserve the affine transform.", Method: "SetMatrixComponent" },
			{ Name: "Quaternion", Size: g_Mathlib.QUATERNION_SIZE, Marker: "Second Quaternion view changed component ", Method: "SetMathStructureComponent" },
			{ Name: "HelpersImport", ClassName: "BaseAddress", Helpers: true, Size: g_CanonicalMemoryHelpers.Type.GetDataTypeSize("int"), Marker: "memory/helpers import check failed.", Method: "Write" },
			{ Name: "HelpersArrayView", ClassName: "ArrayView", Helpers: true, Size: g_CanonicalMemoryHelpers.Type.GetDataTypeSize("int") * 3, Marker: "ArrayView did not expose the written live value.", Method: "Set" },
			{ Name: "HelpersBaseAddress", ClassName: "BaseAddress", Helpers: true, Size: g_CanonicalMemoryHelpers.Type.GetDataTypeSize("int"), Marker: "BaseAddress live state is inconsistent.", Method: "Write" },
		];
		const vecFailures = [
			{ Mode: "NONE" },
			...[
				new Error("Controlled storage failure"),
				null,
				undefined,
				0,
				false,
			].map((Value) => ({ Mode: "THROW", Value })),
		];
		const vecCleanupFailures = [...vecFailures, { Mode: "FALSE" }];
		const unForeignAddress = Allocate(0x4);
		g_mapAllocations.get(unForeignAddress).fill(0xA5);
		const vecExpectedAddresses = Array.from(g_mapAllocations.keys());
		let unCaseCount = 0;

		try {
			for (const Configuration of vecConfigurations) {
				const vecBlocks = Configuration.Helpers ? [...g_vecMemoryHelpersPreambleJavaScriptBlocks, ...g_vecMemoryHelpersInitialJavaScriptBlocks] : g_vecMathlibJavaScriptBlocks;
				const vecExamples = vecBlocks.filter((strExample) => strExample.includes(Configuration.Marker));
				g_Assert.equal(vecExamples.length, 1, Configuration.Name);

				const Run = new Function("require", '"use strict";\n' + vecExamples[0]);
				const StructureConstructor = Configuration.Helpers ? g_CanonicalMemoryHelpers[Configuration.ClassName] : g_Mathlib[Configuration.Name];
				const MemoryModule = Configuration.Helpers ? g_RootMemory : g_MemoryModule;
				for (const Primary of vecFailures) {
					for (const Cleanup of vecCleanupFailures) {
						let unOwnedAddress = 0n;
						let unCleanupCalls = 0;
						let bOwnedAddressReleased = false;
						const ConfigureWriteFailure = (View) => {
							const Descriptor = Configuration.Setter ? Object.getOwnPropertyDescriptor(StructureConstructor.prototype, Configuration.Setter) : null;
							const WriteValue = Descriptor ? Descriptor.set : View[Configuration.Method];
							const WriteWithFailure = function WriteWithFailure(...vecWriteArguments) {
								const Result = WriteValue.apply(this, vecWriteArguments);

								if (Primary.Mode === "THROW") {
									throw Primary.Value;
									}

								return Result;
							};

							if (Descriptor) {
								Object.defineProperty(View, Configuration.Setter, { get: Descriptor.get, set: WriteWithFailure });

							} else {
								View[Configuration.Method] = WriteWithFailure;
							}

							return View;
						};

						class ControlledStructure extends StructureConstructor {
							constructor(...vecArguments) {
								super(...vecArguments);

								if (Configuration.Helpers) {
									ConfigureWriteFailure(this);
								}
							}

							static CreateFromAddress(...vecArguments) {
								return ConfigureWriteFailure(StructureConstructor.CreateFromAddress(...vecArguments));
							}
						}

						const Memory = {
							...MemoryModule,

							Allocate(unSize) {
								g_Assert.equal(unSize, Configuration.Size);
								unOwnedAddress = MemoryModule.Allocate(unSize);

								return unOwnedAddress;
							},

							Deallocate(unAddress) {
								g_Assert.equal(unAddress, unOwnedAddress);
								unCleanupCalls++;
								const bReleased = MemoryModule.Deallocate(unAddress);
								g_Assert.equal(bReleased, true);
								bOwnedAddressReleased = true;

								if (Cleanup.Mode === "THROW") {
									throw Cleanup.Value;
								}

								return (Cleanup.Mode === "FALSE") ? false : bReleased;
							},
						};

						const Require = (strName) => {
							const strStructureModuleName = Configuration.Helpers ? "memory/helpers" : "mathlib";
							g_Assert.equal((strName === "memory") || (strName === strStructureModuleName), true);

							if (strName === "memory") {
								return Memory;
							}

							return Configuration.Helpers ? { ...g_CanonicalMemoryHelpers, [Configuration.ClassName]: ControlledStructure } : { ...g_Mathlib, [Configuration.Name]: ControlledStructure };
						};

						let bThrown = false;
						let CaughtValue = undefined;

						try {
							const Context = g_VM.createContext({ Run, Require });
							try {
								new g_VM.Script("Run(Require);").runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
							} catch (CaughtError) {
								bThrown = true;
								CaughtValue = CaughtError;
							}

							const vecExpectedFailures = [Primary, Cleanup].filter((Failure) => Failure.Mode !== "NONE");
							g_Assert.equal(unCleanupCalls, 1, Configuration.Name);
							g_Assert.equal(bThrown, vecExpectedFailures.length > 0, Configuration.Name);

							if (vecExpectedFailures.length > 1) {
								g_Assert.equal(CaughtValue instanceof AggregateError, true, Configuration.Name + " cleanup must not hide its operation failure");
							}

							const vecActualFailures = (vecExpectedFailures.length > 1) ? CaughtValue.errors : (bThrown ? [CaughtValue] : []);
							g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length);
							for (let unIndex = 0; unIndex < vecExpectedFailures.length; unIndex++) {
								const Failure = vecExpectedFailures[unIndex];
								if (Failure.Mode === "THROW") {
									g_Assert.equal(vecActualFailures[unIndex], Failure.Value);

								} else {
									g_Assert.equal(vecActualFailures[unIndex] instanceof Error, true);
									g_Assert.match(vecActualFailures[unIndex].message, /allocation cleanup failed/);
								}
							}

							g_Assert.deepEqual(Array.from(g_mapAllocations.keys()), vecExpectedAddresses);
							g_Assert.equal(g_mapAllocations.get(unForeignAddress).toString("hex"), "a5a5a5a5");
							unCaseCount++;
						} finally {
							if ((unOwnedAddress !== 0n) && !bOwnedAddressReleased) {
								g_Assert.equal(MemoryModule.Deallocate(unOwnedAddress), true);
							}
						}
					}
				}
			}

			g_Assert.equal(unCaseCount, 336);
		} finally {
			g_Assert.equal(Deallocate(unForeignAddress), true);
		}
	}

	CheckAddressViewExampleFailures();

	function CheckMemoryHelperByteOperationExamples() {
		const unMinimumStorageByteCount = 0x1;
		const unIntegerStorageByteCount = 0x4;
		const unPairStorageByteCount = 0x8;
		const unRangeStorageByteCount = 0x10;
		const unCopiedByteCount = 0x4n;

		const itRequiredRows = g_CanonicalMemoryHelpers.ParseData(null, { Health: {} }, [[g_CanonicalMemoryHelpers.DataKey.Offset, g_CanonicalMemoryHelpers.DataKey.AsInt64, g_CanonicalMemoryHelpers.NO_DEFAULT]]);
		g_Assert.throws(() => itRequiredRows.next(), g_CanonicalMemoryHelpers.KeyError);

		const unMaximumAddress = 0xFFFFFFFFn;
		g_Assert.equal(g_CanonicalMemoryHelpers.Add(0n, unMaximumAddress), unMaximumAddress);
		g_Assert.equal(g_CanonicalMemoryHelpers.Add(unMaximumAddress, -unMaximumAddress), 0n);
		g_Assert.equal(g_CanonicalMemoryHelpers.Add(0x1n, null), 0x1n);
		g_Assert.throws(() => g_CanonicalMemoryHelpers.Add(0n, 1n << 63n));
		g_Assert.throws(() => g_CanonicalMemoryHelpers.Add(0n, -(1n << 63n) - 1n));

		const vecContractAddresses = [];
		const vecContractErrors = [];

		try {
			for (let unIndex = 0; unIndex < 2; unIndex++) {
				vecContractAddresses.push(g_RootMemory.Allocate(unPairStorageByteCount));
			}

			const unSourceAddress = vecContractAddresses[0];
			const unDestinationAddress = vecContractAddresses[1];
			g_Assert.equal(g_CanonicalMemoryHelpers.WriteInt(unSourceAddress, 73), true);
			g_Assert.equal(g_CanonicalMemoryHelpers.Copy(unSourceAddress, unDestinationAddress, unCopiedByteCount), true);
			g_Assert.equal(g_CanonicalMemoryHelpers.Compare(unSourceAddress, unDestinationAddress, unCopiedByteCount), 0);
			g_Assert.equal(g_CanonicalMemoryHelpers.Move(unSourceAddress, unDestinationAddress, unCopiedByteCount), true);
			g_Assert.throws(() => g_CanonicalMemoryHelpers.Copy(unSourceAddress, unSourceAddress, 0x4));
			g_Assert.throws(() => g_CanonicalMemoryHelpers.Copy(unSourceAddress, unSourceAddress + 0x1n, 0x4));
			g_Assert.equal(g_CanonicalMemoryHelpers.ReadInt(unSourceAddress), 73);
		} catch (ContractError) {
			vecContractErrors.push(ContractError);
		} finally {
			for (const unAddress of vecContractAddresses.reverse()) {
				try {
					g_Assert.equal(g_RootMemory.Deallocate(unAddress), true);
				} catch (CleanupError) {
					vecContractErrors.push(CleanupError);
				}
			}
		}

		if (vecContractErrors.length === 1) {
			throw vecContractErrors[0];
		}

		if (vecContractErrors.length > 1) {
			throw new AggregateError(vecContractErrors, "Memory helper contract checks and cleanup failed.");
		}

		const vecConfigurations = [
			{ Name: "AddressTable", Marker: "Address-table readback failed.", Operation: "WriteAddress", Sizes: [unMinimumStorageByteCount, unMinimumStorageByteCount, g_CanonicalMemoryHelpers.ADDRESS_SIZE * 2] },
			{ Name: "Add", Marker: "Address-arithmetic readback failed.", Operation: "Add", Sizes: [unPairStorageByteCount] },
			{ Name: "Compare", Marker: "Compare() did not distinguish equal and changed byte ranges.", Operation: "Compare", Sizes: [unIntegerStorageByteCount, unIntegerStorageByteCount] },
			{ Name: "Copy", Marker: "Copy() did not reproduce the source bytes.", Operation: "Copy", Sizes: [unIntegerStorageByteCount, unIntegerStorageByteCount] },
			{ Name: "Difference", Marker: "Difference() returned the wrong byte offset.", Operation: "Difference", Sizes: [unRangeStorageByteCount] },
			{ Name: "IsNull", Marker: "IsNull() classified a BigInt address incorrectly.", Operation: "IsNull", Sizes: [unMinimumStorageByteCount] },
			{ Name: "Move", Marker: "Move() produced incorrect value ", Operation: "Move", Sizes: [0xC] },
			{ Name: "Address", Marker: "Address() changed a valid BigInt address.", Operation: "Address", Sizes: [unMinimumStorageByteCount] },
			{ Name: "Read", Marker: "Generic memory read/write did not round-trip an integer.", Operation: "Read", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int)] },
			{ Name: "ReadBool", Marker: "ReadBool() did not return the written boolean.", Operation: "ReadBool", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Bool)] },
			{ Name: "ReadDouble", Marker: "ReadDouble() did not return the written value.", Operation: "ReadDouble", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Double)] },
			{ Name: "ReadFloat", Marker: "ReadFloat() did not return the written float32 value.", Operation: "ReadFloat", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Float)] },
			{ Name: "ReadInt", Marker: "ReadInt() did not return the offset value.", Operation: "ReadInt", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 2] },
			{ Name: "ReadAddress", Marker: "ReadAddress() did not return the written BigInt address.", Operation: "ReadAddress", Sizes: [unMinimumStorageByteCount, g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Address)] },
			{ Name: "ReadUInt", Marker: "ReadUInt() did not return the written value.", Operation: "ReadUInt", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.UInt)] },
			{ Name: "SearchBytes", Marker: "SearchBytes() returned an unexpected match address.", Operation: "SearchBytes", Sizes: [unPairStorageByteCount] },
			{ Name: "SetProtection", Marker: "SetProtection() returned failure.", Operation: "SetProtection", Sizes: [0x40] },
			{ Name: "Subtract", Marker: "Subtract() returned the wrong BigInt address.", Operation: "Subtract", Sizes: [unRangeStorageByteCount] },
			{ Name: "VirtualFunction", Marker: "VirtualFunction() returned the wrong slot address.", Operation: "VirtualFunction", Sizes: [g_CanonicalMemoryHelpers.ADDRESS_SIZE * 3 + 0x2] },
			{ Name: "VirtualTable", Marker: "VirtualTable() did not return the stored table address.", Operation: "VirtualTable", Sizes: [g_CanonicalMemoryHelpers.ADDRESS_SIZE * 2] },
			{ Name: "Write", Marker: "Write() did not store the integer at the requested offset.", Operation: "Write", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 2] },
			{ Name: "WriteAddress", Marker: "WriteAddress() did not store the BigInt target address.", Operation: "WriteAddress", Sizes: [g_CanonicalMemoryHelpers.ADDRESS_SIZE, unMinimumStorageByteCount] },
			{ Name: "WriteBool", Marker: "WriteBool() did not store true.", Operation: "WriteBool", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Bool)] },
			{ Name: "WriteDouble", Marker: "WriteDouble() did not store the supplied value.", Operation: "WriteDouble", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Double)] },
			{ Name: "WriteFloat", Marker: "WriteFloat() did not store the float32 value.", Operation: "WriteFloat", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Float)] },
			{ Name: "WriteInt", Marker: "WriteInt() did not store the supplied value.", Operation: "WriteInt", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int)] },
			{ Name: "WriteUInt", Marker: "WriteUInt() did not store the supplied value.", Operation: "WriteUInt", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.UInt)] },
			{ Name: "ArrayView.At", Marker: "ArrayView.At() did not return the live element.", Operation: "ArrayView", Method: "At", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.Entries", Marker: "ArrayView.Entries() returned the wrong pair count.", Operation: "ArrayView", Method: "Entries", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.ForEach", Marker: "ArrayView.ForEach() did not return undefined.", Operation: "ArrayView", Method: "ForEach", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.GetOffset", Marker: "ArrayView.GetOffset() returned an unexpected byte offset.", Operation: "ArrayView", Method: "GetOffset", Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.Keys", Marker: "ArrayView.Keys() did not return every valid index in order.", Operation: "ArrayView", Method: "Keys", Collection: true, Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.Set", Marker: "ArrayView.Set() did not write through to native memory.", Operation: "ArrayView", Method: "Set", Collection: true, Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.ToArray", Marker: "ArrayView.ToArray() did not return an independent point-in-time copy.", Operation: "ArrayView", Method: "ToArray", Collection: true, Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "ArrayView.Values", Marker: "ArrayView.Values() did not read each element live.", Operation: "ArrayView", Method: "Values", Collection: true, Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 3] },
			{ Name: "BaseAddress.Add", Marker: "BaseAddress.Add() returned an incorrect BigInt address.", Operation: "BaseAddress", Method: "Add", Collection: true, Sizes: [unRangeStorageByteCount] },
			{ Name: "BaseAddress.Address", Marker: "BaseAddress.Address did not contain the wrapped BigInt address.", Operation: "BaseAddress", Property: "Address", Collection: true, Sizes: [unMinimumStorageByteCount] },
			{ Name: "BaseAddress.HasAddress", Marker: "BaseAddress.HasAddress() did not reflect the wrapped address state.", Operation: "BaseAddress", Method: "HasAddress", Collection: true, Sizes: [unMinimumStorageByteCount] },
			{ Name: "BaseAddress.Read", Marker: "BaseAddress.Read() did not return the value at the requested offset.", Operation: "BaseAddress", Method: "Read", Collection: true, Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int) * 2] },
			{ Name: "BaseAddress.ReadAddress", Marker: "BaseAddress.ReadAddress() did not return the stored BigInt address.", Operation: "BaseAddress", Method: "ReadAddress", Collection: true, Sizes: [g_CanonicalMemoryHelpers.ADDRESS_SIZE + 0x1] },
			{ Name: "BaseAddress.Subtract", Marker: "BaseAddress.Subtract() returned an incorrect BigInt address.", Operation: "BaseAddress", Method: "Subtract", Collection: true, Sizes: [unRangeStorageByteCount] },
			{ Name: "BaseAddress.toString", Marker: "BaseAddress.toString() returned an unexpected diagnostic string.", Operation: "BaseAddress", Method: "toString", Collection: true, Sizes: [unMinimumStorageByteCount] },
			{ Name: "BaseAddress.valueOf", Marker: "BaseAddress.valueOf() did not expose the wrapped BigInt address.", Operation: "BaseAddress", Method: "valueOf", Collection: true, Sizes: [unMinimumStorageByteCount] },
			{ Name: "BaseAddress.Write", Marker: "BaseAddress.Write() did not store the supplied value.", Operation: "BaseAddress", Method: "Write", Collection: true, Sizes: [g_CanonicalMemoryHelpers.Type.GetDataTypeSize(g_CanonicalMemoryHelpers.Type.Int)] },
			{ Name: "BaseAddress.WriteAddress", Marker: "BaseAddress.WriteAddress() did not store the BigInt target address.", Operation: "BaseAddress", Method: "WriteAddress", Collection: true, Sizes: [g_CanonicalMemoryHelpers.ADDRESS_SIZE + 0x1] },
		];
		const vecFailures = [
			{ Mode: "NONE" },
			...[
				new Error("Controlled byte-operation failure"),
				null,
				undefined,
				0,
				false,
			].map((Value) => ({ Mode: "THROW", Value })),
		];
		const vecCleanupFailures = [...vecFailures, { Mode: "FALSE" }];
		const unForeignAddress = g_RootMemory.Allocate(unIntegerStorageByteCount);
		let unCaseCount = 0;

		try {
			g_Assert.equal(g_CanonicalMemoryHelpers.WriteInt(unForeignAddress, 0x5A5A5A5A), true);

			const vecExpectedAddresses = Array.from(g_mapAllocations.keys());
			for (const Configuration of vecConfigurations) {
				const vecExampleBlocks = Configuration.Collection ? g_vecMemoryHelpersCollectionJavaScriptBlocks : [...g_vecMemoryHelpersInitialJavaScriptBlocks, ...g_vecMemoryHelpersTypeJavaScriptBlocks, ...g_vecMemoryHelpersAddressJavaScriptBlocks];
				const vecExamples = vecExampleBlocks.filter((strExample) => strExample.includes(Configuration.Marker));
				g_Assert.equal(vecExamples.length, 1, Configuration.Name);

				const Run = new Function("require", '"use strict";\n' + vecExamples[0]);
				const RunCase = (Primary, unAllocationFailureIndex, AllocationFailure, vecCleanupRules) => {
					const vecOwnedAddresses = [];
					const vecCleanupCalls = [];
					const setReleasedAddresses = new Set();
					const vecExpectedCleanupFailures = [];
					let unAllocationCalls = 0;
					let bOperationReached = false;
					const Memory = {
						...g_RootMemory,

						Allocate(unSize) {
							g_Assert.equal(unSize, Configuration.Sizes[unAllocationCalls], Configuration.Name);
							unAllocationCalls++;

							if (unAllocationCalls === unAllocationFailureIndex) {
								if (AllocationFailure.Mode === "THROW") {
									throw AllocationFailure.Value;
								}

								return 0n;
							}

							const unAddress = g_RootMemory.Allocate(unSize);
							vecOwnedAddresses.push({ Address: unAddress, Cleanup: vecCleanupRules[unAllocationCalls - 1] });

							return unAddress;
						},

						Deallocate(unAddress) {
							const Owned = vecOwnedAddresses.find((Entry) => Entry.Address === unAddress);
							g_Assert(Owned, Configuration.Name + " attempted to release foreign memory");
							vecCleanupCalls.push(unAddress);
							g_Assert.equal(setReleasedAddresses.has(unAddress), false, Configuration.Name);
							g_Assert.equal(g_RootMemory.Deallocate(unAddress), true);
							setReleasedAddresses.add(unAddress);

							if (Owned.Cleanup.Mode !== "NONE") {
								vecExpectedCleanupFailures.push(Owned.Cleanup);
							}

							if (Owned.Cleanup.Mode === "THROW") {
								throw Owned.Cleanup.Value;
							}

							return Owned.Cleanup.Mode !== "FALSE";
						},
					};

					const Helpers = {
						...g_CanonicalMemoryHelpers,

						[Configuration.Operation](...vecArguments) {
							const Result = g_CanonicalMemoryHelpers[Configuration.Operation](...vecArguments);
							bOperationReached = true;

							if (Primary.Mode === "THROW") {
								throw Primary.Value;
							}

							return Result;
						},
					};

					if (Configuration.Property) {
						Helpers[Configuration.Operation] = class ControlledAddressView extends g_CanonicalMemoryHelpers[Configuration.Operation] {
							get [Configuration.Property]() {
								const Result = super[Configuration.Property];
								bOperationReached = true;

								if (Primary.Mode === "THROW") {
									throw Primary.Value;
								}

								return Result;
							}
						};

					} else if (Configuration.Method) {
						Helpers[Configuration.Operation] = class ControlledAddressView extends g_CanonicalMemoryHelpers[Configuration.Operation] {
							[Configuration.Method](...vecArguments) {
								const Result = super[Configuration.Method](...vecArguments);
								bOperationReached = true;

								if (Primary.Mode === "THROW") {
									throw Primary.Value;
								}

								return Result;
							}
						};
					}

					const Require = (strName) => {
						g_Assert.equal((strName === "memory") || (strName === "memory/helpers"), true);

						return (strName === "memory") ? Memory : Helpers;
					};

					let bThrown = false;
					let CaughtValue = undefined;

					try {
						try {
							const Context = g_VM.createContext({ Run, Require });
							new g_VM.Script("Run(Require);").runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });
						} catch (CaughtError) {
							bThrown = true;
							CaughtValue = CaughtError;
						}

						const vecExpectedOrder = vecOwnedAddresses.map((Owned) => Owned.Address).reverse();
						g_Assert.deepEqual(vecCleanupCalls, vecExpectedOrder, Configuration.Name + " cleanup must attempt every owned allocation in reverse order");
						const unExpectedAllocationCalls = (AllocationFailure.Mode === "THROW") ? unAllocationFailureIndex : Configuration.Sizes.length;
						g_Assert.equal(unAllocationCalls, unExpectedAllocationCalls, Configuration.Name);
						g_Assert.equal(bOperationReached, unAllocationFailureIndex === 0, Configuration.Name);

						const vecExpectedFailures = unAllocationFailureIndex ? [AllocationFailure, ...vecExpectedCleanupFailures] : [...((Primary.Mode === "NONE") ? [] : [Primary]), ...vecExpectedCleanupFailures];
						g_Assert.equal(bThrown, vecExpectedFailures.length > 0, Configuration.Name);

						if (vecExpectedFailures.length > 1) {
							g_Assert.equal(CaughtValue instanceof AggregateError, true, Configuration.Name + " cleanup must not hide operation or cleanup failures");
						}

						const vecActualFailures = (vecExpectedFailures.length > 1) ? CaughtValue.errors : (bThrown ? [CaughtValue] : []);
						g_Assert.equal(vecActualFailures.length, vecExpectedFailures.length, Configuration.Name);
						for (let unIndex = 0; unIndex < vecExpectedFailures.length; unIndex++) {
							const Failure = vecExpectedFailures[unIndex];
							if (Failure.Mode === "THROW") {
								g_Assert.equal(vecActualFailures[unIndex], Failure.Value, Configuration.Name);

							} else {
								g_Assert.equal(vecActualFailures[unIndex] instanceof Error, true, Configuration.Name);
								g_Assert.match(vecActualFailures[unIndex].message, (Failure.Mode === "ZERO") ? /allocation failed/ : /allocation cleanup failed/);
							}
						}

						g_Assert.equal(g_CanonicalMemoryHelpers.ReadInt(unForeignAddress), 0x5A5A5A5A);
						g_Assert.deepEqual(Array.from(g_mapAllocations.keys()), vecExpectedAddresses);
						unCaseCount++;
					} finally {
						for (const Owned of vecOwnedAddresses.slice().reverse()) {
							if (!setReleasedAddresses.has(Owned.Address)) {
								g_Assert.equal(g_RootMemory.Deallocate(Owned.Address), true);
							}
						}
					}
				};
				for (const Primary of vecFailures) {
					const unCombinationCount = vecCleanupFailures.length ** Configuration.Sizes.length;
					for (let unCombination = 0; unCombination < unCombinationCount; unCombination++) {
						let unRemaining = unCombination;
						const vecCleanupRules = [];
						for (let unIndex = 0; unIndex < Configuration.Sizes.length; unIndex++) {
							vecCleanupRules.push(vecCleanupFailures[unRemaining % vecCleanupFailures.length]);
							unRemaining = Math.floor(unRemaining / vecCleanupFailures.length);
						}

						RunCase(Primary, 0, { Mode: "NONE" }, vecCleanupRules);
					}
				}

				for (let unFailureIndex = 1; unFailureIndex <= Configuration.Sizes.length; unFailureIndex++) {
					for (const Failure of [...vecFailures.slice(1), { Mode: "ZERO" }]) {
						const unRemainingOwners = (Failure.Mode === "THROW") ? (unFailureIndex - 1) : (Configuration.Sizes.length - 1);
						const vecApplicableCleanupFailures = unRemainingOwners ? vecCleanupFailures : [vecCleanupFailures[0]];
						for (const Cleanup of vecApplicableCleanupFailures) {
							RunCase({ Mode: "NONE" }, unFailureIndex, Failure, Configuration.Sizes.map(() => Cleanup));
						}
					}
				}
			}

			g_Assert.equal(unCaseCount, 5466);
		} finally {
			g_Assert.equal(g_RootMemory.Deallocate(unForeignAddress), true);
		}
	}

	CheckMemoryHelperByteOperationExamples();

	function CheckMatrixStorageContracts() {
		const unColumnCount = 4;
		for (const Configuration of [
			{ Constructor: g_Mathlib.Matrix3x4, Size: g_Mathlib.MATRIX3X4_SIZE, CopyTo: "CopyMatrix3x4To" },
			{ Constructor: g_Mathlib.VMatrix, Size: g_Mathlib.VMATRIX_SIZE, CopyTo: "CopyVMatrixTo" },
		]) {
			const MatrixConstructor = Configuration.Constructor;
			const unRowCount = new MatrixConstructor().RowCount;
			const unComponentCount = unRowCount * unColumnCount;
			const vecComponents = [];
			for (let unIndex = 0; unIndex <= unComponentCount; unIndex++) {
				vecComponents.push(unIndex);
			}

			const vecRows = [];
			for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex++) {
				const vecRow = vecComponents.slice(unRowIndex * unColumnCount, (unRowIndex + 1) * unColumnCount);
				vecRow.push(Number.NaN);
				vecRows.push(vecRow);
			}

			g_Assert.deepEqual(new MatrixConstructor(vecRows).Values, vecComponents.slice(0, unComponentCount));

			const Matrix = new MatrixConstructor(...vecComponents);
			g_Assert.deepEqual(Matrix.Values, vecComponents.slice(0, unComponentCount));
			g_Assert.equal(Matrix.Values.length, unComponentCount);
			g_Assert.equal(Matrix.Values, Matrix.Values);
			g_Assert.throws(() => {
				Matrix.Values = [];
			}, TypeError);

			Matrix.Values[0] = 7;
			g_Assert.equal(Matrix.GetMatrixComponent(0, 0), 7);

			Matrix.Values[0] = Number.NaN;
			g_Assert.equal(Number.isNaN(Matrix.GetMatrixComponent(0, 0)), true);
			g_Assert.equal(Matrix.IsMathStructureValid(), false);

			class DerivedMatrix extends MatrixConstructor {
			}

			const Source = new DerivedMatrix(...vecComponents);
			const BaseTarget = new MatrixConstructor();
			const DerivedTarget = new DerivedMatrix();
			g_Assert.equal(Source[Configuration.CopyTo](BaseTarget), BaseTarget);
			g_Assert.deepEqual(BaseTarget.Values, vecComponents.slice(0, unComponentCount));
			g_Assert.throws(() => Source.CopyMathStructureTo(BaseTarget), TypeError);
			g_Assert.equal(Source.CopyMathStructureTo(DerivedTarget), DerivedTarget);
			g_Assert.deepEqual(DerivedTarget.Values, vecComponents.slice(0, unComponentCount));

			const vecAddressesBefore = Array.from(g_mapAllocations.keys());
			const unAddress = Allocate(Configuration.Size);

			try {
				const View = MatrixConstructor.CreateFromAddress(unAddress);
				View.SetMatrixComponent(0, 0, 37);
				View.Values[0] = 95;
				g_Assert.equal(View.Values.length, unComponentCount);
				g_Assert.equal(View.GetMatrixComponent(0, 0), 37);
				g_Assert.equal(View.Values[0], 95);
			} finally {
				if (g_mapAllocations.has(unAddress)) {
					Deallocate(unAddress);
				}
			}

			g_Assert.deepEqual(Array.from(g_mapAllocations.keys()), vecAddressesBefore);
		}
	}

	CheckMatrixStorageContracts();

	function CheckStrictFactoryInputs() {
		for (const StructureConstructor of [g_Mathlib.Vector, g_Mathlib.QAngle, g_Mathlib.Quaternion, g_Mathlib.RadianEuler]) {
			const vecNames = new StructureConstructor().ComponentNames;
			const vecZeros = new Array(vecNames.length).fill(0);
			g_Assert.deepEqual(StructureConstructor.CreateMathStructureFromValue({ X: 0 }).ConvertMathStructureToArray(), vecZeros);

			for (const strName of vecNames) {
				const Input = { X: 0 };
				Input[strName] = undefined;
				g_Assert.deepEqual(StructureConstructor.CreateMathStructureFromValue(Input).ConvertMathStructureToArray(), vecZeros);

				Input[strName] = null;
				g_Assert.throws(() => StructureConstructor.CreateMathStructureFromValue(Input), TypeError);
			}

			const GetterError = new Error("Controlled component getter failure");
			const Input = {};
			Object.defineProperty(Input, "X", {
				get() {
					throw GetterError;
				},
			});
			g_Assert.throws(() => StructureConstructor.CreateMathStructureFromValue(Input), (Failure) => Failure === GetterError);
		}

		for (const MatrixConstructor of [g_Mathlib.Matrix3x4, g_Mathlib.VMatrix]) {
			const unRowCount = new MatrixConstructor().RowCount;
			const vecRows = [];
			for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex++) {
				vecRows.push([1, 2, 3, 4]);
			}

			g_Assert.deepEqual(new MatrixConstructor(vecRows).ConvertMatrixToArray(), vecRows);

			const vecExtraRows = [...vecRows, [5, 6, 7, 8]];
			g_Assert.throws(() => new MatrixConstructor(vecExtraRows), TypeError);
		}
	}

	CheckStrictFactoryInputs();

	const g_unAllocationCountBeforeDocumentation = g_mapAllocations.size;
	for (let unBlockIndex = 0; unBlockIndex < g_vecMathlibJavaScriptBlocks.length; unBlockIndex += 1) {
		const Script = new g_VM.Script(`"use strict";\n(() => {\n${g_vecMathlibJavaScriptBlocks[unBlockIndex]}\n})();`, { filename: `docs/api/mathlib.md#example-${unBlockIndex + 1}` });
		g_Assert.doesNotThrow(() => Script.runInNewContext({ console: g_DocumentationConsole, Error, RangeError, ReferenceError, require: g_RequireMathlibDocumentation, TypeError }, { timeout: g_unDocumentationTimeoutMilliseconds }), `mathlib documentation JavaScript block ${unBlockIndex + 1}`);
		g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeDocumentation, `mathlib documentation example-${unBlockIndex + 1} allocation cleanup`);
	}

	g_Assert.equal(g_mapAllocations.size, g_unAllocationCountBeforeDocumentation, "mathlib documentation examples must release owned memory");

	function CheckAddressBackedQAngleExamples() {
		const strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory.md");
		const strDocumentation = g_FileSystem.readFileSync(strDocumentationPath, "utf8");
		const nWrappingStart = strDocumentation.indexOf("## Address-backed QAngle examples");
		g_Assert.notEqual(nWrappingStart, -1, "QAngle mathlib section");

		const strWrappingDocumentation = strDocumentation.slice(nWrappingStart);
		const vecJavaScriptBlocks = [...strWrappingDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
		g_Assert.equal(vecJavaScriptBlocks.length, 2, "QAngle allocation example count");

		// LoadMathlib registers with the mathlib double, not the separate root-memory fixture.
		g_Assert.equal(g_RootMemory.RegisterObjectType("QAngle", g_Mathlib.QAngle, { Size: g_Mathlib.QANGLE_SIZE }), true, "QAngle fixture registration");

		const ExecuteExample = (unBlockIndex, MemoryModule = g_RootMemory) => {
			const RequireExample = (strModuleName) => (strModuleName === "memory") ? MemoryModule : g_RequireMemoryDocumentation(strModuleName);
			const Script = new g_VM.Script(`"use strict";\n(() => {\n${vecJavaScriptBlocks[unBlockIndex]}\n})();`, { filename: `docs/api/memory.md#mathlib-example-${unBlockIndex + 1}` });

			return Script.runInNewContext({ Error, RangeError, ReferenceError, require: RequireExample, TypeError }, { timeout: g_unDocumentationTimeoutMilliseconds });
		};

		for (let unBlockIndex = 0; unBlockIndex < vecJavaScriptBlocks.length; unBlockIndex += 1) {
			const unAllocationCountBeforeExample = g_mapAllocations.size;
			g_Assert.doesNotThrow(() => ExecuteExample(unBlockIndex), `QAngle allocation example ${unBlockIndex + 1}`);
			g_Assert.equal(g_mapAllocations.size, unAllocationCountBeforeExample, "QAngle allocation cleanup");
		}

		const unAllocationCountBeforeFailures = g_mapAllocations.size;
		let unAllocationAttempt = 0;
		g_Assert.throws(() => ExecuteExample(1, {
			...g_RootMemory,

			AllocateObject(ObjectTypeValue) {
				unAllocationAttempt += 1;

				if (unAllocationAttempt === 2) {
					throw new Error("Injected second allocation failure");
				}

				return g_RootMemory.AllocateObject(ObjectTypeValue);
			},
		}), /Injected second allocation failure/, "QAngle second allocation failure");
		g_Assert.equal(unAllocationAttempt, 2, "QAngle second allocation reached");
		g_Assert.equal(g_mapAllocations.size, unAllocationCountBeforeFailures, "second allocation failure releases source");

		g_Assert.throws(() => ExecuteExample(1, {
			...g_RootMemory,

			CopyObjectToAddress() {
				return 0n;
			},
		}), /different target address/, "QAngle copy address result checked");
		g_Assert.equal(g_mapAllocations.size, unAllocationCountBeforeFailures, "copy status failure releases both owners");

		let unCleanupCount = 0;
		g_Assert.throws(() => ExecuteExample(1, {
			...g_RootMemory,

			Deallocate(unAddress) {
				unCleanupCount += 1;
				g_Assert.equal(g_RootMemory.Deallocate(unAddress), true, "target cleanup failure probe deallocation");

				if (unCleanupCount === 1) {
					throw new Error("Injected target cleanup failure");
				}

				return true;
			},
		}), /Injected target cleanup failure/, "QAngle target cleanup failure");
		g_Assert.equal(unCleanupCount, 2, "source cleanup still runs after target cleanup failure");
		g_Assert.equal(g_mapAllocations.size, unAllocationCountBeforeFailures, "cleanup failure probe releases both owners");

		for (const unBlockIndex of [0, 1]) {
			g_Assert.throws(() => ExecuteExample(unBlockIndex, {
				...g_RootMemory,

				Deallocate(unAddress) {
					g_Assert.equal(g_RootMemory.Deallocate(unAddress), true, "negative cleanup status probe deallocation");

					return false;
				},
			}), /allocation was not released/, "QAngle negative cleanup status checked");
			g_Assert.equal(g_mapAllocations.size, unAllocationCountBeforeFailures, "negative cleanup status probe releases memory");
		}
	}

	CheckAddressBackedQAngleExamples();
	CheckWorldObjectAllocationExamples(g_RootMemoryManager, g_RootMemory, g_CanonicalMemoryHelpers, g_Mathlib);
} finally {
	try {
		Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
	} finally {
		try {
			if (g_NativeBridgeDescriptor === undefined) {
				delete globalThis.sourcejs;

			} else {
				Object.defineProperty(globalThis, "sourcejs", g_NativeBridgeDescriptor);
			}
		} finally {
			for (const strModulePath of Object.keys(require.cache)) {
				if (!Object.hasOwn(g_ModuleCacheDescriptors, strModulePath)) {
					delete require.cache[strModulePath];
				}
			}

			Object.defineProperties(require.cache, g_ModuleCacheDescriptors);
		}
	}
}

console.log("[smoke] mathlib package, native doubles, live-address fixture, and documentation contracts plus 2831 manager cleanup, 8491 GameData file, 4380 backing allocation, 1890 address attribute, 2568 root allocation, 8052 address chain, 415 function registration, 17066 function hook documentation, 9363 Address documentation, 21996 Address pair documentation, 6567 Address setter documentation and 402 memory error documentation cases passed; native SDK execution not exercised");
