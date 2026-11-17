"use strict";

const g_strModuleName = "core/cache";
const g_strDefaultCachedPropertyName = "CachedProperty";
const g_setCachedProperties = new Set();
const g_setFunctionCacheStates = new Set();

function IsObjectOrFunction(Candidate) {
	return ((typeof Candidate === "object") && (Candidate !== null)) || (typeof Candidate === "function");
}

function IsPropertyKey(Candidate) {
	return (typeof Candidate === "string") || (typeof Candidate === "symbol");
}

function GetPropertyDescriptorGetter(PropertyDescriptor) {
	if (!IsObjectOrFunction(PropertyDescriptor)) {
		throw new TypeError("WrapPropertyDescriptor expects a property descriptor with a getter.");
	}

	const PropertyGetter = PropertyDescriptor.get;
	if (typeof PropertyGetter !== "function") {
		throw new TypeError("WrapPropertyDescriptor expects a property descriptor with a getter.");
	}

	return PropertyGetter;
}

class CachedProperty {
	constructor(Getter, Options = {}) {
		if (typeof Getter !== "function") {
			throw new TypeError("CachedProperty expects a getter function.");
		}

		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("CachedProperty options must be an object.");
		}

		const strRequestedPropertyName = Options.Name ?? null;
		const strRequestedCacheKey = Options.CacheKey ?? null;
		const bEnumerable = Options.Enumerable ?? false;
		const bConfigurable = Options.Configurable ?? true;

		if ((strRequestedPropertyName !== null) && (typeof strRequestedPropertyName !== "string")) {
			throw new TypeError("CachedProperty Name must be a string or null.");
		}

		if ((strRequestedCacheKey !== null) && (typeof strRequestedCacheKey !== "string")) {
			throw new TypeError("CachedProperty CacheKey must be a string or null.");
		}

		if (typeof bEnumerable !== "boolean") {
			throw new TypeError("CachedProperty Enumerable must be a boolean.");
		}

		if (typeof bConfigurable !== "boolean") {
			throw new TypeError("CachedProperty Configurable must be a boolean.");
		}

		let strResolvedPropertyName = strRequestedPropertyName;
		if (strResolvedPropertyName === null) {
			const strGetterName = Getter.name;
			if (typeof strGetterName !== "string") {
				throw new TypeError("CachedProperty getter name must be a string.");
			}

			strResolvedPropertyName = (strGetterName.length === 0) ? null : strGetterName;
		}

		const strCacheKeyDescription = strRequestedCacheKey ?? strResolvedPropertyName ?? g_strDefaultCachedPropertyName;

		this.Getter = Getter;
		this.Name = strResolvedPropertyName;
		this.CacheKey = Symbol(strCacheKeyDescription);
		this.Enumerable = bEnumerable;
		this.Configurable = bConfigurable;

		g_setCachedProperties.add(this);
	}

	GetCachedValue(Instance) {
		if (!IsObjectOrFunction(Instance)) {
			throw new TypeError("CachedProperty instance must be an object or function.");
		}

		const CacheKey = this.CacheKey;
		if (typeof CacheKey !== "symbol") {
			throw new TypeError("CachedProperty CacheKey must be a symbol.");
		}

		if (Object.prototype.hasOwnProperty.call(Instance, CacheKey)) {
			return Instance[CacheKey];
		}

		const Getter = this.Getter;
		if (typeof Getter !== "function") {
			throw new TypeError("CachedProperty getter must be a function.");
		}

		const CachedValue = Getter.call(Instance);
		Object.defineProperty(Instance, CacheKey, { configurable: true, value: CachedValue });

		return Instance[CacheKey];
	}

	ClearCachedValue(Instance) {
		if (!IsObjectOrFunction(Instance)) {
			throw new TypeError("CachedProperty instance must be an object or function.");
		}

		const CacheKey = this.CacheKey;
		if (typeof CacheKey !== "symbol") {
			throw new TypeError("CachedProperty CacheKey must be a symbol.");
		}

		return delete Instance[CacheKey];
	}

	GetPropertyDescriptor() {
		const CachedPropertyInstance = this;
		const bConfigurable = this.Configurable;
		const bEnumerable = this.Enumerable;
		if (typeof bConfigurable !== "boolean") {
			throw new TypeError("CachedProperty Configurable must be a boolean.");
		}

		if (typeof bEnumerable !== "boolean") {
			throw new TypeError("CachedProperty Enumerable must be a boolean.");
		}

		return {
			configurable: bConfigurable,
			enumerable: bEnumerable,
			get() {
				return CachedPropertyInstance.GetCachedValue(this);
			},
		};
	}

	InstallCachedProperty(Target, PropertyKey = undefined) {
		if (!IsObjectOrFunction(Target)) {
			throw new TypeError("CachedProperty target must be an object or function.");
		}

		const InstalledPropertyKey = (PropertyKey === undefined) ? this.Name : PropertyKey;
		if (!IsPropertyKey(InstalledPropertyKey)) {
			throw new TypeError("A cached property name is required.");
		}

		if ((typeof InstalledPropertyKey === "string") && (InstalledPropertyKey.length === 0)) {
			throw new TypeError("A cached property name is required.");
		}

		const PropertyDescriptor = this.GetPropertyDescriptor();
		Object.defineProperty(Target, InstalledPropertyKey, PropertyDescriptor);

		return this;
	}

	static WrapPropertyDescriptor(PropertyDescriptor, Options = {}) {
		const PropertyGetter = GetPropertyDescriptorGetter(PropertyDescriptor);

		return new CachedProperty(PropertyGetter, Options);
	}
}

function CreateCachedProperty(TargetOrGetter, PropertyKey = null, Descriptor = null) {
	const unDecoratorArgumentCount = 3;
	if (arguments.length >= unDecoratorArgumentCount) {
		if (!IsObjectOrFunction(TargetOrGetter)) {
			throw new TypeError("CreateCachedProperty target must be an object or function.");
		}

		if (!IsPropertyKey(PropertyKey)) {
			throw new TypeError("CreateCachedProperty decorator name must be a non-empty string or symbol.");
		}

		if ((typeof PropertyKey === "string") && (PropertyKey.length === 0)) {
			throw new TypeError("CreateCachedProperty decorator name must be a non-empty string or symbol.");
		}

		const PropertyGetter = GetPropertyDescriptorGetter(Descriptor);
		const bConfigurable = Descriptor.configurable ?? true;
		const bEnumerable = Descriptor.enumerable ?? false;
		const strCachedPropertyName = (typeof PropertyKey === "symbol") ? (PropertyKey.description ?? g_strDefaultCachedPropertyName) : PropertyKey;

		return new CachedProperty(PropertyGetter, { Configurable: bConfigurable, Enumerable: bEnumerable, Name: strCachedPropertyName }).GetPropertyDescriptor();
	}

	return new CachedProperty(TargetOrGetter, { Name: PropertyKey });
}

function CacheFunctionResult(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("CacheFunctionResult expects a function.");
	}

	const FunctionCacheState = { ReceiverResults: new WeakMap() };

	function CachedFunction(...vecArguments) {
		const Receiver = this;
		if (!IsObjectOrFunction(Receiver)) {
			throw new TypeError("A CacheFunctionResult receiver must be an object or function.");
		}

		const mapReceiverResults = FunctionCacheState.ReceiverResults;
		if (mapReceiverResults.has(Receiver)) {
			return mapReceiverResults.get(Receiver);
		}

		const Result = Callback.apply(Receiver, vecArguments);
		mapReceiverResults.set(Receiver, Result);

		return Result;
	}

	g_setFunctionCacheStates.add(FunctionCacheState);

	return CachedFunction;
}

function ClearCachedProperty(Instance, PropertyValue) {
	if (!IsObjectOrFunction(Instance)) {
		throw new TypeError("ClearCachedProperty instance must be an object or function.");
	}

	if (PropertyValue instanceof CachedProperty) {
		return PropertyValue.ClearCachedValue(Instance);
	}

	if (!IsPropertyKey(PropertyValue)) {
		throw new TypeError("ClearCachedProperty property must be a string, symbol, or CachedProperty.");
	}

	return delete Instance[PropertyValue];
}

function ClearAllCachedProperties(Instance) {
	if (!IsObjectOrFunction(Instance)) {
		throw new TypeError("ClearAllCachedProperties instance must be an object or function.");
	}

	const unStartingPropertyCount = g_setCachedProperties.size;
	let unClearedPropertyCount = 0;
	let unProcessedPropertyCount = 0;
	for (const CachedPropertyInstance of g_setCachedProperties) {
		if (unProcessedPropertyCount >= unStartingPropertyCount) {
			break;
		}

		++unProcessedPropertyCount;

		const bPropertyCleared = CachedPropertyInstance.ClearCachedValue(Instance);
		if (bPropertyCleared) {
			++unClearedPropertyCount;
		}
	}

	return unClearedPropertyCount;
}

function ClearFunctionCaches() {
	const unStartingCacheStateCount = g_setFunctionCacheStates.size;
	let unProcessedCacheStateCount = 0;
	for (const FunctionCacheState of g_setFunctionCacheStates) {
		if (unProcessedCacheStateCount >= unStartingCacheStateCount) {
			break;
		}

		++unProcessedCacheStateCount;

		FunctionCacheState.ReceiverResults = new WeakMap();
	}

	return unProcessedCacheStateCount;
}

module.exports = {
	MODULE_NAME: g_strModuleName,
	CachedProperty: CachedProperty,
	CacheFunctionResult: CacheFunctionResult,
	ClearAllCachedProperties: ClearAllCachedProperties,
	ClearCachedProperty: ClearCachedProperty,
	ClearFunctionCaches: ClearFunctionCaches,
	CreateCachedProperty: CreateCachedProperty,
};
