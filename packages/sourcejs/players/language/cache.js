"use strict";

const {
	ClientDisconnectManager,
	ClientFullyConnectManager,
	ClientSettingsChangedManager,
} = require("listeners");
const { GetClientLanguage: g_GetNativeClientLanguage, GetPlayerIndex } = require("players/helpers");

const g_mapLanguageCacheListenerRegistrations = new WeakMap();
const g_mapLanguageCacheClientLanguages = new WeakMap();

function RequirePlayerIndex(PlayerReference) {
	const unClientIndex = GetPlayerIndex(PlayerReference);
	if (!Number.isSafeInteger(unClientIndex) || (unClientIndex <= 0)) {
		throw new RangeError("Player index must be a positive integer.");
	}

	return unClientIndex;
}

function RequireClientLanguages(LanguageCache) {
	const mapClientLanguages = g_mapLanguageCacheClientLanguages.get(LanguageCache);
	if (!(mapClientLanguages instanceof Map)) {
		throw new TypeError("LanguageCache ClientLanguages must be a Map.");
	}

	return mapClientLanguages;
}

function RequireListenerCallback(ListenerCallback, strListenerCallbackName) {
	if (typeof ListenerCallback !== "function") {
		throw new TypeError(`LanguageCache ${strListenerCallbackName} must be a function.`);
	}

	return ListenerCallback;
}

function RequireLanguageCacheListenerRegistrations(LanguageCache) {
	if (!g_mapLanguageCacheListenerRegistrations.has(LanguageCache)) {
		throw new TypeError("LanguageCache method called with an invalid receiver.");
	}

	const vecListenerRegistrations = g_mapLanguageCacheListenerRegistrations.get(LanguageCache);
	if (!Array.isArray(vecListenerRegistrations)) {
		throw new TypeError("LanguageCache listener registration state must be an array.");
	}

	return vecListenerRegistrations;
}

function CreateLanguageCacheListenerRegistrations(LanguageCache) {
	const ClientDisconnectCallback = RequireListenerCallback(LanguageCache.ClientDisconnectCallback, "ClientDisconnectCallback");
	const ClientFullyConnectCallback = RequireListenerCallback(LanguageCache.ClientFullyConnectCallback, "ClientFullyConnectCallback");
	const ClientSettingsChangedCallback = RequireListenerCallback(LanguageCache.ClientSettingsChangedCallback, "ClientSettingsChangedCallback");

	return [
		{ ListenerCallback: ClientDisconnectCallback, ListenerManager: ClientDisconnectManager, ListenerName: "client disconnect listener" },
		{ ListenerCallback: ClientFullyConnectCallback, ListenerManager: ClientFullyConnectManager, ListenerName: "client fully-connect listener" },
		{ ListenerCallback: ClientSettingsChangedCallback, ListenerManager: ClientSettingsChangedManager, ListenerName: "client settings-changed listener" },
	];
}

function RethrowWithCleanupErrors(OperationError, vecCleanupErrors, strAggregateMessage) {
	if (vecCleanupErrors.length === 0) {
		throw OperationError;
	}

	const vecOperationErrors = [OperationError];
	for (const CleanupError of vecCleanupErrors) {
		vecOperationErrors.push(CleanupError);
	}

	throw new AggregateError(vecOperationErrors, strAggregateMessage);
}

class LanguageCache {
	constructor() {
		g_mapLanguageCacheClientLanguages.set(this, new Map());

		this.ClientDisconnectCallback = (PlayerReference) => {
			this.DeleteClientLanguage(PlayerReference);
		};
		this.ClientFullyConnectCallback = (PlayerReference) => {
			this.RefreshClientLanguage(PlayerReference);
		};
		this.ClientSettingsChangedCallback = (PlayerReference) => {
			this.RefreshClientLanguage(PlayerReference);
		};

		g_mapLanguageCacheListenerRegistrations.set(this, []);
		this.RegisterListeners();
	}

	RegisterListeners() {
		const vecActiveListenerRegistrations = RequireLanguageCacheListenerRegistrations(this);
		if (vecActiveListenerRegistrations.length !== 0) {
			return false;
		}

		const vecListenerRegistrations = CreateLanguageCacheListenerRegistrations(this);
		let unRegisteredListenerCount = 0;

		try {
			for (const ListenerRegistration of vecListenerRegistrations) {
				const RegisteredListenerCallback = ListenerRegistration.ListenerManager.RegisterListener(ListenerRegistration.ListenerCallback);
				unRegisteredListenerCount += 1;

				if (RegisteredListenerCallback !== ListenerRegistration.ListenerCallback) {
					throw new TypeError(`LanguageCache ${ListenerRegistration.ListenerName} registration returned an invalid value.`);
				}
			}
		} catch (RegistrationError) {
			const vecRetainedListenerRegistrations = [];
			const vecCleanupErrors = [];
			for (let nRegistrationIndex = unRegisteredListenerCount - 1; nRegistrationIndex >= 0; nRegistrationIndex -= 1) {
				const ListenerRegistration = vecListenerRegistrations[nRegistrationIndex];
				try {
					const bListenerRemoved = ListenerRegistration.ListenerManager.UnregisterListener(ListenerRegistration.ListenerCallback);
					if (bListenerRemoved !== true) {
						throw new TypeError(`LanguageCache ${ListenerRegistration.ListenerName} rollback returned an invalid value.`);
					}
				} catch (CleanupError) {
					vecRetainedListenerRegistrations.unshift(ListenerRegistration);
					vecCleanupErrors.push(CleanupError);
				}
			}

			g_mapLanguageCacheListenerRegistrations.set(this, vecRetainedListenerRegistrations);
			RethrowWithCleanupErrors(RegistrationError, vecCleanupErrors, "LanguageCache registration and rollback failed.");
		}

		g_mapLanguageCacheListenerRegistrations.set(this, vecListenerRegistrations);

		return true;
	}

	UnregisterListeners() {
		const vecListenerRegistrations = RequireLanguageCacheListenerRegistrations(this);
		if (vecListenerRegistrations.length === 0) {
			return false;
		}

		const mapClientLanguages = RequireClientLanguages(this);
		const vecRetainedListenerRegistrations = [];
		const vecRemovalErrors = [];
		for (const ListenerRegistration of vecListenerRegistrations) {
			try {
				const bListenerRemoved = ListenerRegistration.ListenerManager.UnregisterListener(ListenerRegistration.ListenerCallback);
				if (bListenerRemoved !== true) {
					throw new TypeError(`LanguageCache ${ListenerRegistration.ListenerName} removal returned an invalid value.`);
				}
			} catch (RemovalError) {
				vecRetainedListenerRegistrations.push(ListenerRegistration);
				vecRemovalErrors.push(RemovalError);
			}
		}

		g_mapLanguageCacheListenerRegistrations.set(this, vecRetainedListenerRegistrations);

		if (vecRemovalErrors.length === 1) {
			throw vecRemovalErrors[0];
		}

		if (vecRemovalErrors.length > 1) {
			throw new AggregateError(vecRemovalErrors, "LanguageCache listener removal failed.");
		}

		mapClientLanguages.clear();

		return true;
	}

	GetClientLanguage(PlayerReference) {
		const unClientIndex = RequirePlayerIndex(PlayerReference);
		const mapClientLanguages = RequireClientLanguages(this);
		if (!mapClientLanguages.has(unClientIndex)) {
			return this.RefreshClientLanguage(unClientIndex);
		}

		const strClientLanguage = mapClientLanguages.get(unClientIndex);
		if (typeof strClientLanguage !== "string") {
			throw new TypeError("Cached client language must be a string.");
		}

		return strClientLanguage;
	}

	SetClientLanguage(PlayerReference, strClientLanguage) {
		const unClientIndex = RequirePlayerIndex(PlayerReference);
		if (typeof strClientLanguage !== "string") {
			throw new TypeError("Player language must be a string.");
		}

		RequireClientLanguages(this).set(unClientIndex, strClientLanguage);

		return strClientLanguage;
	}

	HasClientLanguage(PlayerReference) {
		return RequireClientLanguages(this).has(RequirePlayerIndex(PlayerReference));
	}

	DeleteClientLanguage(PlayerReference) {
		return RequireClientLanguages(this).delete(RequirePlayerIndex(PlayerReference));
	}

	ClearClientLanguages() {
		RequireClientLanguages(this).clear();

		return true;
	}

	RefreshClientLanguage(PlayerReference) {
		const unClientIndex = RequirePlayerIndex(PlayerReference);
		const strClientLanguage = g_GetNativeClientLanguage(unClientIndex);

		return this.SetClientLanguage(unClientIndex, strClientLanguage);
	}

	get ListenersRegistered() {
		return RequireLanguageCacheListenerRegistrations(this).length !== 0;
	}

	get ClientLanguages() {
		return RequireClientLanguages(this);
	}
}

const g_LanguageCache = new LanguageCache();

function GetClientLanguage(PlayerReference) {
	return g_LanguageCache.GetClientLanguage(PlayerReference);
}

const g_LanguageCacheAPI = {
	LANGUAGE_CACHE: g_LanguageCache,
	LanguageCache,
	GetClientLanguage,
};

module.exports = g_LanguageCacheAPI;
