"use strict";

const { GetModule } = require("internal/runtime");
const { NetworkedEntityCreatedManager, NetworkedEntityDeletedManager } = require("listeners");

const g_DictionaryRuntime = GetModule("entities/dictionary");
const g_HelpersRuntime = GetModule("entities/helpers");

function ResolveEntityIndex(EntityReference) {
	let unResolvedEntityIndex = EntityReference;
	if ((EntityReference !== null) && (typeof EntityReference === "object")) {
		unResolvedEntityIndex = EntityReference.Index;
	}

	if (!Number.isSafeInteger(unResolvedEntityIndex) || (unResolvedEntityIndex < 0)) {
		throw new TypeError("Entity index must be a non-negative safe integer.");
	}

	return unResolvedEntityIndex;
}

function IsEntityMarkedForDeletion(EntityInstance) {
	if ((EntityInstance === null) || (typeof EntityInstance !== "object") || (typeof EntityInstance.IsEntityMarkedForDeletion !== "function")) {
		return false;
	}

	const bMarkedForDeletion = EntityInstance.IsEntityMarkedForDeletion();
	if (typeof bMarkedForDeletion !== "boolean") {
		throw new TypeError("Entity IsEntityMarkedForDeletion() must return a boolean.");
	}

	return bMarkedForDeletion;
}

function CreateDefaultEntityIterable() {
	return {
		[Symbol.iterator]() {
			return g_DictionaryRuntime.GetEntityDictionaryValues()[Symbol.iterator]();
		},
		IsEntityValid() {
			return true;
		},
	};
}

function Entity(EntityReference) {
	return g_DictionaryRuntime.GetEntityFromDictionary(ResolveEntityIndex(EntityReference));
}

class EntityDictionary extends Map {
	constructor(EntityFactory = Entity, ...vecFactoryArguments) {
		if ((EntityFactory !== null) && (typeof EntityFactory !== "function")) {
			throw new TypeError("EntityDictionary factory must be a function or null.");
		}

		super();
		this.EntityFactory = EntityFactory;
		this.EntityFactoryArguments = vecFactoryArguments;
		this.NetworkedEntityDeletedCallback = this.OnNetworkedEntityDeleted.bind(this);
		this.NetworkedEntityDeletedListenerRegistered = false;
		NetworkedEntityDeletedManager.RegisterListener(this.NetworkedEntityDeletedCallback);
		this.NetworkedEntityDeletedListenerRegistered = true;
	}

	CreateMissingEntity(unEntityIndex) {
		if (this.EntityFactory === null) {
			throw new Error(`Entity index is not cached: ${unEntityIndex}`);
		}

		let EntityInstance;
		try {
			EntityInstance = this.EntityFactory(unEntityIndex, ...this.EntityFactoryArguments);
		} catch (ErrorValue) {
			let strErrorMessage = "Unable to create entity: factory failure details are unavailable.";
			try {
				const strFactoryErrorMessage = (ErrorValue instanceof Error) ? ErrorValue.message : String(ErrorValue);
				strErrorMessage = `Unable to create entity for index ${unEntityIndex}: ${strFactoryErrorMessage}`;
			} catch {
				// Diagnostic conversion must not replace the factory failure retained as cause.
			}

			throw new Error(strErrorMessage, { cause: ErrorValue });
		}

		if ((EntityInstance === undefined) || (EntityInstance === null)) {
			throw new Error(`Unable to create entity for index ${unEntityIndex}.`);
		}

		if (!IsEntityMarkedForDeletion(EntityInstance)) {
			super.set(unEntityIndex, EntityInstance);
		}

		return EntityInstance;
	}

	delete(EntityReference) {
		return super.delete(ResolveEntityIndex(EntityReference));
	}

	FromIntegerHandle(unEntityHandle) {
		return this.get(g_HelpersRuntime.GetEntityIndexFromIntegerHandle(unEntityHandle));
	}

	OnAutomaticallyRemoved(unEntityIndex) {
	}

	OnNetworkedEntityDeleted(EntityReference) {
		const unResolvedEntityIndex = ResolveEntityIndex(EntityReference);
		if (!super.has(unResolvedEntityIndex)) {
			return false;
		}

		try {
			this.OnAutomaticallyRemoved(unResolvedEntityIndex);
		} finally {
			super.delete(unResolvedEntityIndex);
		}

		return true;
	}

	Unload() {
		if (!this.NetworkedEntityDeletedListenerRegistered) {
			return false;
		}

		NetworkedEntityDeletedManager.UnregisterListener(this.NetworkedEntityDeletedCallback);
		this.NetworkedEntityDeletedListenerRegistered = false;

		return true;
	}

	get(EntityReference) {
		const unResolvedEntityIndex = ResolveEntityIndex(EntityReference);
		if (super.has(unResolvedEntityIndex)) {
			return super.get(unResolvedEntityIndex);
		}

		return this.CreateMissingEntity(unResolvedEntityIndex);
	}

	has(EntityReference) {
		return super.has(ResolveEntityIndex(EntityReference));
	}

	keys() {
		return super.keys();
	}

	values() {
		return super.values();
	}

	entries() {
		return super.entries();
	}

	[Symbol.iterator]() {
		return super[Symbol.iterator]();
	}
}

class SyncedEntityDictionary extends EntityDictionary {
	constructor(EntityFactory = Entity, EntityIterable = null, ...vecFactoryArguments) {
		if (EntityFactory === null) {
			throw new Error("Factory cannot be null for synced dictionaries.");
		}

		const ResolvedEntityIterable = (EntityIterable === null) ? CreateDefaultEntityIterable() : EntityIterable;
		if (!ResolvedEntityIterable || (typeof ResolvedEntityIterable[Symbol.iterator] !== "function")) {
			throw new TypeError("SyncedEntityDictionary iterator must be iterable.");
		}

		const IsEntityValid = ResolvedEntityIterable.IsEntityValid;
		if ((IsEntityValid !== undefined) && (typeof IsEntityValid !== "function")) {
			throw new TypeError("SyncedEntityDictionary iterator IsEntityValid must be a function.");
		}

		super(EntityFactory, ...vecFactoryArguments);
		this.EntityIterator = ResolvedEntityIterable;
		this.NetworkedEntityCreatedCallback = this.OnNetworkedEntityCreated.bind(this);
		this.NetworkedEntityCreatedListenerRegistered = false;

		try {
			this.Resynchronize();
			NetworkedEntityCreatedManager.RegisterListener(this.NetworkedEntityCreatedCallback);
			this.NetworkedEntityCreatedListenerRegistered = true;
		} catch (ErrorValue) {
			try {
				super.Unload();
			} catch (CleanupError) {
				throw new AggregateError([ErrorValue, CleanupError], "SyncedEntityDictionary construction and deletion-listener cleanup failed.");
			}

			throw ErrorValue;
		}
	}

	CreateMissingEntity(unEntityIndex) {
		throw new Error(`Entity index is not synced: ${unEntityIndex}`);
	}

	Resynchronize() {
		super.clear();

		for (const EntityReference of this.EntityIterator) {
			this.OnNetworkedEntityCreated(EntityReference);
		}

		return this;
	}

	OnAutomaticallyCreated(unEntityIndex) {
	}

	OnNetworkedEntityCreated(EntityReference) {
		const IsEntityValid = this.EntityIterator.IsEntityValid;
		if (IsEntityValid !== undefined) {
			if (typeof IsEntityValid !== "function") {
				throw new TypeError("SyncedEntityDictionary iterator IsEntityValid must be a function.");
			}

			if (!IsEntityValid.call(this.EntityIterator, EntityReference)) {
				return false;
			}
		}

		const unResolvedEntityIndex = ResolveEntityIndex(EntityReference);
		EntityDictionary.prototype.CreateMissingEntity.call(this, unResolvedEntityIndex);
		this.OnAutomaticallyCreated(unResolvedEntityIndex);

		return true;
	}

	Unload() {
		const vecCleanupErrors = [];
		let bCreationListenerRemoved = false;
		let bDeletionListenerRemoved = false;
		try {
			if (this.NetworkedEntityCreatedListenerRegistered) {
				NetworkedEntityCreatedManager.UnregisterListener(this.NetworkedEntityCreatedCallback);
				this.NetworkedEntityCreatedListenerRegistered = false;
				bCreationListenerRemoved = true;
			}
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		try {
			bDeletionListenerRemoved = super.Unload();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}

		if (vecCleanupErrors.length === 1) {
			throw vecCleanupErrors[0];
		}

		if (vecCleanupErrors.length > 1) {
			throw new AggregateError(vecCleanupErrors, "SyncedEntityDictionary listener cleanup failed.");
		}

		return bCreationListenerRemoved || bDeletionListenerRemoved;
	}
}

const g_mapEntityDictionary = new EntityDictionary();

Object.assign(g_DictionaryRuntime, {
	ENTITY_DICTIONARY: g_mapEntityDictionary,
	Entity,
	EntityDictionary,
	SyncedEntityDictionary,
});

module.exports = g_DictionaryRuntime;
