"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_unProxyAddress = 100n;
const g_unHealthProperty = 200n;
const g_unVectorProperty = 204n;
const g_unOutputAddress = 300n;
const g_unInputAddress = 400n;
const g_mapValues = new Map();
const g_setCallbacks = new Set();
let g_unCreatedHookCount = 0;

const g_NativeProperties = {
	GetEntitySendProperty(nEntityIndex, strPropertyName) {
		if (nEntityIndex !== 4) {
			return null;
		}

		if (strPropertyName === "m_iHealth") {
			return { Address: g_unHealthProperty, ProxyFunctionAddress: g_unProxyAddress, Type: "int", Signed: true, BitCount: 10 };
		}

		if (strPropertyName === "m_vecOrigin") {
			return { Address: g_unVectorProperty, ProxyFunctionAddress: g_unProxyAddress, Type: "vector" };
		}

		if (strPropertyName === "NoProxy") {
			return { Address: 208n, ProxyFunctionAddress: 0n, Type: "int", Signed: true, BitCount: 10 };
		}

		return null;
	},

	CreateSendPropertyProxyHook(Definition) {
		g_Assert.equal(Definition.Address, g_unProxyAddress);
		g_Assert.equal(Definition.Convention, "cdecl");
		g_Assert.equal(Definition.ReturnType, "void");
		g_Assert.deepEqual(Array.from(Definition.Arguments), ["address", "address", "address", "address", "int", "int"]);
		g_unCreatedHookCount += 1;

		return {
			Created: true,
			Post(Callback) {
				g_setCallbacks.add(Callback);
				return true;
			},
			RemovePost(Callback) {
				return g_setCallbacks.delete(Callback);
			},
		};
	},
};

function ReadValue(unAddress, nOffset = 0n) {
	g_Assert.equal(unAddress, g_unOutputAddress, "Only DVariant output can be read.");

	return g_mapValues.get(unAddress + nOffset);
}

function WriteValue(unAddress, Value, nOffset = 0n) {
	g_Assert.equal(unAddress, g_unOutputAddress, "Only DVariant output can be written.");
	g_mapValues.set(unAddress + nOffset, Value);

	return true;
}

function RequireDependency(strName) {
	switch (strName) {
		case "internal/runtime":
			return {
				GetModule(strModuleName) {
					g_Assert.equal(strModuleName, "entities/props");
					return g_NativeProperties;
				},
			};

		case "memory/helpers":
			return { ReadFloat: ReadValue, ReadInt: ReadValue, ReadUInt: ReadValue, WriteFloat: WriteValue, WriteInt: WriteValue, WriteUInt: WriteValue };

		default:
			throw new Error("Unexpected dependency: " + strName);
	}
}

function RunProxy(unPropertyAddress, nEntityIndex, vecOriginalValues) {
	g_mapValues.set(g_unInputAddress, vecOriginalValues[0]);
	for (let unIndex = 0; unIndex < vecOriginalValues.length; ++unIndex) {
		g_mapValues.set(g_unOutputAddress + (4n * BigInt(unIndex)), vecOriginalValues[unIndex]);
	}

	for (const Callback of g_setCallbacks) {
		Callback({ Arguments: [unPropertyAddress, 0n, g_unInputAddress, g_unOutputAddress, 0, nEntityIndex] });
	}

	g_Assert.equal(g_mapValues.get(g_unInputAddress), vecOriginalValues[0], "The server-side value remains unchanged.");

	return vecOriginalValues.map((Value, unIndex) => g_mapValues.get(g_unOutputAddress + (4n * BigInt(unIndex))));
}

const g_strSource = g_Path.join(__dirname, "../packages/sourcejs/entities/props.js");
const g_Module = { exports: {} };
g_VM.runInNewContext(g_FileSystem.readFileSync(g_strSource, "utf8"), { module: g_Module, require: RequireDependency });

const { AddSendPropertyHook } = g_Module.exports;
g_Assert.equal(g_Module.exports, g_NativeProperties, "The package preserves native module identity.");
g_Assert.equal(AddSendPropertyHook(7, "m_iHealth", () => 42), null);
g_Assert.equal(AddSendPropertyHook(4, "NoProxy", () => 42), null);
g_Assert.equal(g_unCreatedHookCount, 0, "An absent ProxyFn cannot install a hook.");

const g_Health = AddSendPropertyHook(4, "m_iHealth", (ProxyResult) => {
	g_Assert.equal(ProxyResult.EntityIndex, 4);
	g_Assert.equal(ProxyResult.ElementIndex, 0);
	g_Assert.equal(ProxyResult.PropertyName, "m_iHealth");
	g_Assert.equal(ProxyResult.Value, 100);
	g_Assert.equal(Object.hasOwn(ProxyResult, "Recipient"), false);

	return 42;
});
const g_Vector = AddSendPropertyHook(4, "m_vecOrigin", (ProxyResult) => {
	g_Assert.deepEqual(Array.from(ProxyResult.Value), [1, 2, 3]);

	return [10, 20, 30];
});
g_Assert.equal(g_unCreatedHookCount, 1);
g_Assert.deepEqual(RunProxy(g_unHealthProperty, 4, [100]), [42]);
g_Assert.deepEqual(RunProxy(g_unHealthProperty, 5, [100]), [100]);
g_Assert.deepEqual(RunProxy(999n, 4, [100]), [100]);
g_Assert.deepEqual(RunProxy(g_unVectorProperty, 4, [1, 2, 3]), [10, 20, 30]);

g_Assert.ok(g_Health.Remove());
g_Assert.ok(g_Health.Remove());
g_Assert.deepEqual(RunProxy(g_unHealthProperty, 4, [100]), [100]);
g_Assert.deepEqual(RunProxy(g_unVectorProperty, 4, [1, 2, 3]), [10, 20, 30]);
g_Assert.ok(g_Vector.Remove());
g_Assert.equal(g_setCallbacks.size, 0);

const g_Invalid = AddSendPropertyHook(4, "m_vecOrigin", () => [10, Number.NaN, 30]);
g_Assert.throws(() => RunProxy(g_unVectorProperty, 4, [1, 2, 3]), { name: "TypeError" });
g_Assert.equal(g_mapValues.get(g_unOutputAddress), 1, "A bad replacement does not partially write the vector.");
g_Assert.ok(g_Invalid.Remove());

console.log("SendProp proxy hook smoke passed: shared proxy, entity/property isolation, output-only writes and callback removal.");
