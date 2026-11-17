"use strict";

function NormalizeFilterNames(FilterNames) {
	if ((FilterNames === null) || (FilterNames === undefined)) {
		return [];
	}

	if (typeof FilterNames === "string") {
		if (FilterNames.length === 0) {
			throw new TypeError("Filter names must be non-empty strings.");
		}

		return [FilterNames];
	}

	if (typeof FilterNames[Symbol.iterator] !== "function") {
		throw new TypeError("Filter names must be a string, iterable, null, or undefined.");
	}

	const vecNormalizedFilterNames = Array.from(FilterNames);
	for (const strFilterName of vecNormalizedFilterNames) {
		if ((typeof strFilterName !== "string") || (strFilterName.length === 0)) {
			throw new TypeError("Filter names must be non-empty strings.");
		}
	}

	return vecNormalizedFilterNames;
}

function RequireCallback(Callback, strOperationName) {
	if (typeof Callback !== "function") {
		throw new TypeError(`${strOperationName} expects a function.`);
	}

	return Callback;
}

function IsPlainObject(Value) {
	if ((typeof Value !== "object") || (Value === null)) {
		return false;
	}

	const ValuePrototype = Object.getPrototypeOf(Value);

	return (ValuePrototype === Object.prototype) || (ValuePrototype === null);
}

function GetOrCreateClassFilters(IteratorClass) {
	if (!Object.hasOwn(IteratorClass, "Filters")) {
		Object.defineProperty(IteratorClass, "Filters", { configurable: false, enumerable: true, value: new Map(), writable: false });
	}

	const mapClassFilters = IteratorClass.Filters;
	if (!(mapClassFilters instanceof Map)) {
		throw new TypeError("Iterator filter registries must be Map objects.");
	}

	return mapClassFilters;
}

class IteratorFilter {
	constructor(Items = [], Predicate = null) {
		if ((Predicate !== null) && (typeof Predicate !== "function")) {
			throw new TypeError("IteratorFilter Predicate must be a function or null.");
		}

		this.IteratorItems = Items;
		this.IteratorPredicate = Predicate;
	}

	Resolve() {
		const Predicate = this.IteratorPredicate;
		if ((Predicate !== null) && (typeof Predicate !== "function")) {
			throw new TypeError("IteratorFilter.IteratorPredicate must be a function or null.");
		}

		const ItemSource = this.IteratorItems;
		const ResolvedSource = (typeof ItemSource === "function") ? ItemSource.call(this) : ItemSource;
		let vecResolvedItems = [];
		if ((ResolvedSource === null) || (ResolvedSource === undefined)) {
			vecResolvedItems = [];
		} else if (Array.isArray(ResolvedSource)) {
			vecResolvedItems = ResolvedSource.slice();
		} else if (typeof ResolvedSource[Symbol.iterator] === "function") {
			vecResolvedItems = Array.from(ResolvedSource);
		} else if (IsPlainObject(ResolvedSource)) {
			vecResolvedItems = Object.values(ResolvedSource);
		} else {
			throw new TypeError("IteratorFilter.IteratorItems must resolve to an iterable, object with a plain prototype, null, or undefined.");
		}

		return (Predicate === null) ? vecResolvedItems : vecResolvedItems.filter(Predicate);
	}

	Values() {
		return this.Resolve();
	}

	ToArray() {
		return this.Resolve();
	}

	Count() {
		return this.Resolve().length;
	}

	First() {
		return this.Resolve()[0] ?? null;
	}

	Filter(Predicate) {
		const FilterCallback = RequireCallback(Predicate, "IteratorFilter.Filter");
		const ResolveFilteredItems = () => this.Resolve().filter(FilterCallback);

		return new IteratorFilter(ResolveFilteredItems);
	}

	Map(Callback) {
		const MapCallback = RequireCallback(Callback, "IteratorFilter.Map");

		return this.Resolve().map(MapCallback);
	}

	ForEach(Callback) {
		const ItemCallback = RequireCallback(Callback, "IteratorFilter.ForEach");
		this.Resolve().forEach(ItemCallback);

		return this;
	}

	[Symbol.iterator]() {
		return this.Resolve()[Symbol.iterator]();
	}
}

class IteratorObject extends IteratorFilter {
	constructor(RequiredFilters = null, ExcludedFilters = null) {
		super(function ResolveIteratorItems() {
			const IteratorSource = this.Iterate();
			if ((IteratorSource === null) || (IteratorSource === undefined) || (typeof IteratorSource[Symbol.iterator] !== "function")) {
				throw new TypeError(`${this.constructor.name}.Iterate() must return an iterable.`);
			}

			const vecValidItems = [];
			for (const SourceItem of IteratorSource) {
				if (this.IsValid(SourceItem)) {
					vecValidItems.push(SourceItem);
				}
			}

			return vecValidItems;
		});

		const vecRequiredFilterNames = NormalizeFilterNames(RequiredFilters);
		const vecExcludedFilterNames = NormalizeFilterNames(ExcludedFilters);
		const IteratorClass = this.constructor;
		if ((vecRequiredFilterNames.length > 0) || (vecExcludedFilterNames.length > 0)) {
			const mapClassFilters = GetOrCreateClassFilters(IteratorClass);
			for (const strFilterName of vecRequiredFilterNames) {
				if (!mapClassFilters.has(strFilterName)) {
					throw new ReferenceError(`${IteratorClass.name} filter does not exist: ${strFilterName}`);
				}
			}

			for (const strFilterName of vecExcludedFilterNames) {
				if (!mapClassFilters.has(strFilterName)) {
					throw new ReferenceError(`${IteratorClass.name} filter does not exist: ${strFilterName}`);
				}
			}
		}

		this.RequiredFilterNames = vecRequiredFilterNames;
		this.ExcludedFilterNames = vecExcludedFilterNames;
	}

	static Iterator() {
		throw new TypeError(`${this.name} must implement static Iterator().`);
	}

	static RegisterFilter(strFilterName, Callback) {
		if ((typeof strFilterName !== "string") || (strFilterName.length === 0)) {
			throw new TypeError(`${this.name}.RegisterFilter expects a non-empty filter name.`);
		}

		const FilterCallback = RequireCallback(Callback, `${this.name}.RegisterFilter`);
		const mapClassFilters = GetOrCreateClassFilters(this);
		if (mapClassFilters.has(strFilterName)) {
			throw new ReferenceError(`${this.name} filter already exists: ${strFilterName}`);
		}

		mapClassFilters.set(strFilterName, FilterCallback);

		return FilterCallback;
	}

	static UnregisterFilter(strFilterName) {
		if ((typeof strFilterName !== "string") || (strFilterName.length === 0)) {
			throw new TypeError(`${this.name}.UnregisterFilter expects a non-empty filter name.`);
		}

		const mapClassFilters = GetOrCreateClassFilters(this);
		if (!mapClassFilters.has(strFilterName)) {
			throw new ReferenceError(`${this.name} filter does not exist: ${strFilterName}`);
		}

		const bFilterRemoved = mapClassFilters.delete(strFilterName);

		return bFilterRemoved;
	}

	static HasFilter(strFilterName) {
		if ((typeof strFilterName !== "string") || (strFilterName.length === 0)) {
			throw new TypeError(`${this.name}.HasFilter expects a non-empty filter name.`);
		}

		return GetOrCreateClassFilters(this).has(strFilterName);
	}

	static GetFilterNames() {
		return Array.from(GetOrCreateClassFilters(this).keys());
	}

	static DefaultFilters() {
		const DefaultFilterValues = Object.create(null);
		for (const strFilterName of this.GetFilterNames()) {
			DefaultFilterValues[strFilterName] = new Set(new this(strFilterName));
		}

		return DefaultFilterValues;
	}

	Iterate() {
		const IteratorClass = this.constructor;

		return IteratorClass.Iterator.call(IteratorClass);
	}

	GetIteratorFilterCallback(strFilterName) {
		if ((typeof strFilterName !== "string") || (strFilterName.length === 0)) {
			throw new TypeError(`${this.constructor.name}.GetIteratorFilterCallback expects a non-empty filter name.`);
		}

		const mapClassFilters = GetOrCreateClassFilters(this.constructor);
		if (!mapClassFilters.has(strFilterName)) {
			throw new ReferenceError(`${this.constructor.name} filter does not exist: ${strFilterName}`);
		}

		return mapClassFilters.get(strFilterName);
	}

	IsValid(Item) {
		const vecRequiredFilterNames = this.RequiredFilterNames;
		const vecExcludedFilterNames = this.ExcludedFilterNames;
		if (!Array.isArray(vecRequiredFilterNames) || !Array.isArray(vecExcludedFilterNames)) {
			throw new TypeError("IteratorObject.RequiredFilterNames and IteratorObject.ExcludedFilterNames must be arrays.");
		}

		for (const strFilterName of vecRequiredFilterNames) {
			if (!this.GetIteratorFilterCallback(strFilterName)(Item)) {
				return false;
			}
		}

		for (const strFilterName of vecExcludedFilterNames) {
			if (this.GetIteratorFilterCallback(strFilterName)(Item)) {
				return false;
			}
		}

		return true;
	}
}

function FromItems(Items, Predicate = null) {
	return new IteratorFilter(Items, Predicate);
}

const g_IteratorAPI = { IteratorFilter, IteratorObject, FromItems };

module.exports = g_IteratorAPI;
