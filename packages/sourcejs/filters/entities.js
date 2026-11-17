"use strict";

const g_EntitiesAPI = require("entities");
const { IteratorObject } = require("filters/iterator");

const g_nMinimumInt32 = -2_147_483_648;
const g_nMaximumInt32 = 2_147_483_647;

function GetEntityClassName(Entity) {
	const strEntityClassName = Entity?.ClassName;
	if (typeof strEntityClassName !== "string") {
		throw new TypeError("Entity iterator values must expose a string ClassName property.");
	}

	return strEntityClassName;
}

function NormalizeEntityClassNames(ClassNames) {
	if ((ClassNames === null) || (ClassNames === undefined)) {
		return [];
	}

	if (typeof ClassNames === "string") {
		if (ClassNames.length === 0) {
			throw new TypeError("Entity iterator class names must be non-empty strings.");
		}

		return [ClassNames];
	}

	if (typeof ClassNames[Symbol.iterator] !== "function") {
		throw new TypeError("Entity iterator class names must be a string, iterable, null, or undefined.");
	}

	const vecNormalizedClassNames = Array.from(ClassNames);
	for (const strClassName of vecNormalizedClassNames) {
		if ((typeof strClassName !== "string") || (strClassName.length === 0)) {
			throw new TypeError("Entity iterator class names must be non-empty strings.");
		}
	}

	return vecNormalizedClassNames;
}

function ResolveEntityIndex(Entity) {
	const unResolvedEntityIndex = (typeof Entity === "number") ? Entity : Entity?.Index;
	if (!Number.isSafeInteger(unResolvedEntityIndex) || (unResolvedEntityIndex < 0)) {
		throw new TypeError("EntityTraceFilter requires entity indexes or objects with a non-negative safe integer Index property.");
	}

	return unResolvedEntityIndex;
}

function ResolveEntityIndexes(EntitiesToIgnore) {
	if ((EntitiesToIgnore === null) || (EntitiesToIgnore === undefined)) {
		return [];
	}

	if ((typeof EntitiesToIgnore !== "string") && (typeof EntitiesToIgnore[Symbol.iterator] === "function")) {
		return Array.from(EntitiesToIgnore, ResolveEntityIndex);
	}

	return [ResolveEntityIndex(EntitiesToIgnore)];
}

function RequireTraceType(nTraceType) {
	if (!Number.isInteger(nTraceType) || (nTraceType < g_nMinimumInt32) || (nTraceType > g_nMaximumInt32)) {
		throw new TypeError("EntityTraceFilter nTraceType must be a signed 32-bit integer from engines/trace.TraceType.");
	}

	return nTraceType;
}

function IsEntityValid(Entity) {
	if ((typeof Entity !== "object") || (Entity === null)) {
		return false;
	}

	const bEntityIsValid = Entity.Valid;
	const bEntityIsFree = Entity.Free;

	return (bEntityIsValid === true) && (bEntityIsFree === false);
}

function RegisterIteratorFilter(IteratorClass, strFilterName, FilterCallback) {
	if (!IteratorClass.HasFilter(strFilterName)) {
		IteratorClass.RegisterFilter(strFilterName, FilterCallback);
	}
}

class BaseEntityIterator extends IteratorObject {
	constructor(ClassNames = null, bExactMatch = true, RequiredFilters = null, ExcludedFilters = null) {
		if (typeof bExactMatch !== "boolean") {
			throw new TypeError("BaseEntityIterator bExactMatch must be a boolean.");
		}

		const vecNormalizedClassNames = NormalizeEntityClassNames(ClassNames);
		super(RequiredFilters, ExcludedFilters);
		this.#m_vecClassNames = vecNormalizedClassNames;
		this.#m_bExactMatch = bExactMatch;
	}

	static Iterator() {
		return g_EntitiesAPI.GetAllEntities();
	}

	static GetAllEntities() {
		return g_EntitiesAPI.GetAllEntities();
	}

	static DefaultFilters() {
		const DefaultFilterValues = Object.create(null);
		for (const strFilterName of this.GetFilterNames()) {
			DefaultFilterValues[strFilterName] = new Set(new this(null, true, strFilterName));
		}

		return DefaultFilterValues;
	}

	MatchesClassName(Entity) {
		const vecClassNames = this.ClassNames;
		const bExactMatch = this.ExactMatch;

		if (!Array.isArray(vecClassNames)) {
			throw new TypeError("BaseEntityIterator ClassNames must be an array.");
		}

		if (typeof bExactMatch !== "boolean") {
			throw new TypeError("BaseEntityIterator ExactMatch must be a boolean.");
		}

		if (vecClassNames.length === 0) {
			return true;
		}

		const strEntityClassName = GetEntityClassName(Entity);
		for (const strClassName of vecClassNames) {
			if ((typeof strClassName !== "string") || (strClassName.length === 0)) {
				throw new TypeError("BaseEntityIterator ClassNames must contain non-empty strings.");
			}

			if (bExactMatch && (strEntityClassName === strClassName)) {
				return true;
			}

			if (!bExactMatch && strEntityClassName.includes(strClassName)) {
				return true;
			}
		}

		return false;
	}

	IsValid(Entity) {
		return super.IsValid(Entity) && this.MatchesClassName(Entity);
	}

	get ClassNames() {
		return this.#m_vecClassNames;
	}

	set ClassNames(vecClassNames) {
		this.#m_vecClassNames = vecClassNames;
	}

	get ExactMatch() {
		return this.#m_bExactMatch;
	}

	set ExactMatch(bExactMatch) {
		this.#m_bExactMatch = bExactMatch;
	}

	#m_vecClassNames;
	#m_bExactMatch;
}

class EntityIterator extends BaseEntityIterator {
	static Iterator() {
		return g_EntitiesAPI.GetAllEntities().filter(IsEntityValid);
	}

	static GetAllEntities() {
		return g_EntitiesAPI.GetAllEntities().filter(IsEntityValid);
	}

	IsValid(Entity) {
		return IsEntityValid(Entity) && super.IsValid(Entity);
	}
}

class EntityTraceFilter {
	constructor(EntitiesToIgnore, nTraceType) {
		const nValidatedTraceType = RequireTraceType(nTraceType);
		const setIgnoredEntityIndexes = new Set(ResolveEntityIndexes(EntitiesToIgnore));

		this.#m_setIgnoredEntityIndexes = setIgnoredEntityIndexes;
		this.#m_nTraceType = nValidatedTraceType;
	}

	ShouldHitEntity(Entity) {
		const setIgnoredEntityIndexes = this.IgnoredEntityIndexes;
		if (!(setIgnoredEntityIndexes instanceof Set)) {
			throw new TypeError("EntityTraceFilter IgnoredEntityIndexes must be a Set.");
		}

		return !setIgnoredEntityIndexes.has(ResolveEntityIndex(Entity));
	}

	GetTraceType() {
		return RequireTraceType(this.TraceType);
	}

	get IgnoredEntityIndexes() {
		return this.#m_setIgnoredEntityIndexes;
	}

	set IgnoredEntityIndexes(setIgnoredEntityIndexes) {
		this.#m_setIgnoredEntityIndexes = setIgnoredEntityIndexes;
	}

	get TraceType() {
		return this.#m_nTraceType;
	}

	set TraceType(nTraceType) {
		this.#m_nTraceType = nTraceType;
	}

	#m_setIgnoredEntityIndexes;
	#m_nTraceType;
}

function GetAllEntities() {
	return g_EntitiesAPI.GetAllEntities();
}

function GetValidEntities() {
	return GetAllEntities().filter(IsEntityValid);
}

function IsEntityAlwaysValid() {
	return true;
}

RegisterIteratorFilter(BaseEntityIterator, "All", IsEntityAlwaysValid);
RegisterIteratorFilter(BaseEntityIterator, "Valid", IsEntityValid);
RegisterIteratorFilter(EntityIterator, "All", IsEntityAlwaysValid);
RegisterIteratorFilter(EntityIterator, "Valid", IsEntityValid);

const g_EntityFiltersAPI = {
	BaseEntityIterator,
	EntityIterator,
	EntityTraceFilter,
	GetAllEntities,
	GetValidEntities,
};

module.exports = g_EntityFiltersAPI;
