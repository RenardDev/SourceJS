"use strict";

const g_Assert = require("node:assert/strict");
const {
	MODULE_NAME,
	CachedProperty,
	CacheFunctionResult,
	ClearAllCachedProperties,
	ClearCachedProperty,
	ClearFunctionCaches,
	CreateCachedProperty,
} = require("../packages/sourcejs/core/cache");

function ReadValue() {
	++this.ReadCount;

	return this.Value;
}

g_Assert.equal(MODULE_NAME, "core/cache");

const g_PrimaryCache = new CachedProperty(ReadValue, { Name: "CachedValue" });
const g_FirstReceiver = { Value: undefined, ReadCount: 0 };
const g_SecondReceiver = { Value: false, ReadCount: 0 };
g_Assert.equal(g_PrimaryCache.GetCachedValue(g_FirstReceiver), undefined);
g_Assert.equal(g_PrimaryCache.GetCachedValue(g_FirstReceiver), undefined);
g_Assert.equal(g_FirstReceiver.ReadCount, 1);
g_Assert.equal(g_PrimaryCache.GetCachedValue(g_SecondReceiver), false);
g_Assert.equal(g_SecondReceiver.ReadCount, 1);
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_FirstReceiver, g_PrimaryCache.CacheKey), {
	configurable: true,
	enumerable: false,
	value: undefined,
	writable: false,
});

g_FirstReceiver.Value = "Updated";
g_Assert.equal(g_PrimaryCache.GetCachedValue(g_FirstReceiver), undefined);
g_Assert.equal(ClearCachedProperty(g_FirstReceiver, g_PrimaryCache), true);
g_Assert.equal(g_PrimaryCache.GetCachedValue(g_FirstReceiver), "Updated");
g_Assert.equal(g_FirstReceiver.ReadCount, 2);

const g_InheritedReceiver = Object.create(g_FirstReceiver);
g_InheritedReceiver.Value = "Inherited";
g_InheritedReceiver.ReadCount = 0;
g_Assert.equal(g_PrimaryCache.GetCachedValue(g_InheritedReceiver), "Inherited");
g_Assert.equal(g_InheritedReceiver.ReadCount, 1);
g_Assert.equal(g_FirstReceiver.ReadCount, 2);

g_Assert.equal(g_PrimaryCache.InstallCachedProperty(g_FirstReceiver), g_PrimaryCache);
g_Assert.equal(g_FirstReceiver.CachedValue, "Updated");
g_Assert.equal(Object.getOwnPropertyDescriptor(g_FirstReceiver, "CachedValue").enumerable, false);
g_Assert.equal(ClearCachedProperty(g_FirstReceiver, "CachedValue"), true);
g_Assert.equal(Object.hasOwn(g_FirstReceiver, g_PrimaryCache.CacheKey), true);

const g_InferredCache = new CachedProperty(ReadValue);
g_Assert.equal(g_InferredCache.Name, "ReadValue");
g_Assert.equal(g_InferredCache.CacheKey.description, "ReadValue");
g_Assert.notEqual(g_InferredCache.CacheKey, g_PrimaryCache.CacheKey);

const g_AnonymousCache = new CachedProperty(function() {
	return null;
});
g_Assert.equal(g_AnonymousCache.Name, null);
g_Assert.equal(g_AnonymousCache.CacheKey.description, "CachedProperty");
g_Assert.throws(() => g_AnonymousCache.InstallCachedProperty({}), TypeError);
g_Assert.equal(ClearAllCachedProperties(g_FirstReceiver), 3);
g_Assert.equal(Object.hasOwn(g_FirstReceiver, g_PrimaryCache.CacheKey), false);
g_Assert.equal(ClearAllCachedProperties(g_FirstReceiver), 3, "Absent keys still count as successful deletions");

const g_OriginalDescriptor = { configurable: false, enumerable: true, get: ReadValue };
const g_WrappedCache = CachedProperty.WrapPropertyDescriptor(g_OriginalDescriptor);
g_Assert.equal(g_WrappedCache.Getter, ReadValue);
g_Assert.equal(g_WrappedCache.Configurable, true);
g_Assert.equal(g_WrappedCache.Enumerable, false);

const g_FactoryCache = CreateCachedProperty(ReadValue, "FactoryValue");
g_Assert.ok(g_FactoryCache instanceof CachedProperty);
g_Assert.equal(g_FactoryCache.Name, "FactoryValue");

const g_SymbolPropertyKey = Symbol();
const g_DecoratorTarget = { Value: 42, ReadCount: 0 };
const g_DecoratorDescriptor = CreateCachedProperty(g_DecoratorTarget, g_SymbolPropertyKey, g_OriginalDescriptor);
g_Assert.equal(g_DecoratorDescriptor.configurable, false);
g_Assert.equal(g_DecoratorDescriptor.enumerable, true);
Object.defineProperty(g_DecoratorTarget, g_SymbolPropertyKey, g_DecoratorDescriptor);
g_Assert.equal(g_DecoratorTarget[g_SymbolPropertyKey], 42);
g_Assert.equal(g_DecoratorTarget[g_SymbolPropertyKey], 42);
g_Assert.equal(g_DecoratorTarget.ReadCount, 1);

const g_vecCacheSymbols = Object.getOwnPropertySymbols(g_DecoratorTarget).filter((PropertyKey) => PropertyKey !== g_SymbolPropertyKey);
g_Assert.equal(g_vecCacheSymbols.length, 1);
g_Assert.equal(g_vecCacheSymbols[0].description, "CachedProperty");

let g_unFunctionCalls = 0;
const g_CachedFunction = CacheFunctionResult(function(...vecArguments) {
	++g_unFunctionCalls;

	return { Value: this.Value, Arguments: vecArguments };
});
const g_FirstResult = g_CachedFunction.call(g_FirstReceiver, "First");
g_Assert.deepEqual(g_FirstResult, { Value: "Updated", Arguments: ["First"] });
g_Assert.equal(g_CachedFunction.call(g_FirstReceiver, "Ignored"), g_FirstResult);
g_Assert.equal(g_CachedFunction.call(g_SecondReceiver).Value, false);
g_Assert.equal(g_unFunctionCalls, 2);

let g_unUndefinedCalls = 0;
const g_CachedUndefined = CacheFunctionResult(() => {
	++g_unUndefinedCalls;

	return undefined;
});
g_Assert.equal(g_CachedUndefined.call(g_FirstReceiver), undefined);
g_Assert.equal(g_CachedUndefined.call(g_FirstReceiver), undefined);
g_Assert.equal(g_unUndefinedCalls, 1);
g_Assert.equal(ClearFunctionCaches(), 2);
g_Assert.notEqual(g_CachedFunction.call(g_FirstReceiver, "AfterClear"), g_FirstResult);
g_Assert.equal(g_unFunctionCalls, 3);
g_Assert.equal(g_CachedUndefined.call(g_FirstReceiver), undefined);
g_Assert.equal(g_unUndefinedCalls, 2);

for (const InvalidReceiver of [null, undefined, false, 0, "Receiver"]) {
	g_Assert.throws(() => g_PrimaryCache.GetCachedValue(InvalidReceiver), TypeError);
	g_Assert.throws(() => g_PrimaryCache.ClearCachedValue(InvalidReceiver), TypeError);
	g_Assert.throws(() => ClearAllCachedProperties(InvalidReceiver), TypeError);
	g_Assert.throws(() => g_CachedFunction.call(InvalidReceiver), TypeError);
}

for (const InvalidOptions of [null, false, 0, "Options", [], { Name: 1 }, { CacheKey: Symbol() }, { Enumerable: 1 }, { Configurable: 1 }]) {
	g_Assert.throws(() => new CachedProperty(ReadValue, InvalidOptions), TypeError);
}

g_Assert.throws(() => new CachedProperty(null), TypeError);
g_Assert.throws(() => CachedProperty.WrapPropertyDescriptor({ value: 1 }), TypeError);
g_Assert.throws(() => CreateCachedProperty({}, "", g_OriginalDescriptor), TypeError);
g_Assert.throws(() => CreateCachedProperty({}, "Value", { value: 1 }), TypeError);
g_Assert.throws(() => g_PrimaryCache.InstallCachedProperty({}, ""), TypeError);
g_Assert.throws(() => ClearCachedProperty({}, null), TypeError);
g_Assert.throws(() => CacheFunctionResult(null), TypeError);

console.log("Core cache lifecycle smoke checks passed (actual JavaScript module; no native IO).");
