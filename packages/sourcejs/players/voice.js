"use strict";

const { LogWarning } = require("core/logger");
const { ClientDisconnectManager } = require("listeners");
const { CreateFunctionHook } = require("memory/hooks");
const { GetPlayerIndex } = require("players/helpers");
const { GetModule } = require("internal/runtime");

const g_vecSetClientListeningArgumentTypes = Object.freeze(["address", "int", "int", "bool"]);
const g_unSetClientListeningReceiverArgumentIndex = 1;
const g_unSetClientListeningSenderArgumentIndex = 2;
const g_unSetClientListeningListenArgumentIndex = 3;

// The players facade imports voice; avoid capturing its incomplete circular exports.
const g_PlayersRuntime = GetModule("players");
const g_VoiceRuntime = GetModule("players/voice");
const g_setMuteManagers = new Set();

let g_SetClientListeningHook = null;
let g_SetClientListeningCallback = null;
let g_bSetClientListeningHookCreated = false;

function RequirePlayerIndex(PlayerReference, strArgumentName) {
	const unPlayerIndex = GetPlayerIndex(PlayerReference);
	const unMaximumClients = g_PlayersRuntime.GetMaximumClients();
	if (!Number.isInteger(unPlayerIndex) || (unPlayerIndex <= 0) || (unPlayerIndex > unMaximumClients)) {
		throw new RangeError(`${strArgumentName} must be a valid player index.`);
	}

	return unPlayerIndex;
}

function NormalizeReceiverIndexes(ReceiverReferences) {
	if (ReceiverReferences === null) {
		const unMaximumClients = g_PlayersRuntime.GetMaximumClients();
		const vecReceiverIndexes = [];
		for (let unReceiverIndex = 1; unReceiverIndex <= unMaximumClients; unReceiverIndex += 1) {
			vecReceiverIndexes.push(unReceiverIndex);
		}

		return vecReceiverIndexes;
	}

	if (!Array.isArray(ReceiverReferences)) {
		return [RequirePlayerIndex(ReceiverReferences, "receiver")];
	}

	const vecReceiverIndexes = [];
	for (const ReceiverReference of ReceiverReferences) {
		vecReceiverIndexes.push(RequirePlayerIndex(ReceiverReference, "receiver"));
	}

	return vecReceiverIndexes;
}

function GetClientListening(ReceiverReference, SenderReference) {
	const unReceiverIndex = RequirePlayerIndex(ReceiverReference, "receiver");
	const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");

	return g_VoiceRuntime.GetClientListening(unReceiverIndex, unSenderIndex);
}

function IsMutedForAnyManager(unSenderIndex, unReceiverIndex) {
	for (const MuteManager of g_setMuteManagers) {
		if (MuteManager.IsMutedForReceiver(unSenderIndex, unReceiverIndex)) {
			return true;
		}
	}

	return false;
}

function SetClientListening(ReceiverReference, SenderReference, bListen = true) {
	if (typeof bListen !== "boolean") {
		throw new TypeError("SetClientListening bListen must be a boolean.");
	}

	const unReceiverIndex = RequirePlayerIndex(ReceiverReference, "receiver");
	const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");
	const bShouldListen = IsMutedForAnyManager(unSenderIndex, unReceiverIndex) ? false : bListen;

	return g_VoiceRuntime.SetClientListening(unReceiverIndex, unSenderIndex, bShouldListen);
}

function SetClientProximity(ReceiverReference, SenderReference, bUseProximity = true) {
	if (typeof bUseProximity !== "boolean") {
		throw new TypeError("SetClientProximity bUseProximity must be a boolean.");
	}

	const unReceiverIndex = RequirePlayerIndex(ReceiverReference, "receiver");
	const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");

	return g_VoiceRuntime.SetClientProximity(unReceiverIndex, unSenderIndex, bUseProximity);
}

function GetSetClientListeningHookOptions() {
	return { Arguments: g_vecSetClientListeningArgumentTypes.slice(), Convention: "thiscall", Address: g_VoiceRuntime.SetClientListeningAddress, ReturnType: "bool" };
}

function CreateSetClientListeningCallback() {
	return (HookContext) => {
		const unReceiverIndex = HookContext.Arguments[g_unSetClientListeningReceiverArgumentIndex];
		const unSenderIndex = HookContext.Arguments[g_unSetClientListeningSenderArgumentIndex];
		if (IsMutedForAnyManager(unSenderIndex, unReceiverIndex)) {
			HookContext.SetHookArgument(g_unSetClientListeningListenArgumentIndex, false);
		}
	};
}

function RegisterSetClientListeningCallback(HookHandle) {
	const HookCallback = CreateSetClientListeningCallback();
	const bCallbackRegistered = HookHandle.Pre(HookCallback);
	if (typeof bCallbackRegistered !== "boolean") {
		throw new TypeError("SetClientListening hook Pre() must return a boolean.");
	}

	if (!bCallbackRegistered) {
		throw new Error("Unable to register the SetClientListening hook callback.");
	}

	return HookCallback;
}

function RethrowSetClientListeningRegistrationError(HookHandle, bHookCreated, RegistrationError) {
	if (!bHookCreated) {
		throw RegistrationError;
	}

	try {
		const bHookRemoved = HookHandle.Remove();
		if (typeof bHookRemoved !== "boolean") {
			throw new TypeError("SetClientListening hook Remove() must return a boolean.");
		}

		if (!bHookRemoved) {
			throw new Error("Unable to remove the unregistered SetClientListening hook.");
		}
	} catch (CleanupError) {
		g_SetClientListeningHook = HookHandle;
		g_SetClientListeningCallback = null;
		g_bSetClientListeningHookCreated = true;

		throw new AggregateError([RegistrationError, CleanupError], "SetClientListening hook registration and cleanup both failed.");
	}

	throw RegistrationError;
}

function HookSetClientListening() {
	if (g_SetClientListeningHook !== null) {
		if (g_SetClientListeningCallback === null) {
			g_SetClientListeningCallback = RegisterSetClientListeningCallback(g_SetClientListeningHook);
		}

		return g_SetClientListeningHook;
	}

	const HookHandle = CreateFunctionHook(GetSetClientListeningHookOptions());
	const bHookCreated = HookHandle.Created;
	if (typeof bHookCreated !== "boolean") {
		throw new TypeError("CreateFunctionHook() Created must be a boolean.");
	}

	let HookCallback = null;

	try {
		HookCallback = RegisterSetClientListeningCallback(HookHandle);
	} catch (RegistrationError) {
		RethrowSetClientListeningRegistrationError(HookHandle, bHookCreated, RegistrationError);
	}

	g_SetClientListeningHook = HookHandle;
	g_SetClientListeningCallback = HookCallback;
	g_bSetClientListeningHookCreated = bHookCreated;

	return g_SetClientListeningHook;
}

function UnhookSetClientListening() {
	if (g_SetClientListeningHook === null) {
		return false;
	}

	const HookHandle = g_SetClientListeningHook;
	const HookCallback = g_SetClientListeningCallback;
	if (HookCallback !== null) {
		const bCallbackRemoved = HookHandle.RemovePre(HookCallback);
		if (typeof bCallbackRemoved !== "boolean") {
			throw new TypeError("SetClientListening hook RemovePre() must return a boolean.");
		}

		if (!bCallbackRemoved) {
			return false;
		}

		g_SetClientListeningCallback = null;
	}

	if (!g_bSetClientListeningHookCreated) {
		g_SetClientListeningHook = null;
		return true;
	}

	const bHookRemoved = HookHandle.Remove();
	if (typeof bHookRemoved !== "boolean") {
		throw new TypeError("SetClientListening hook Remove() must return a boolean.");
	}

	if (!bHookRemoved) {
		return false;
	}

	g_SetClientListeningHook = null;
	g_bSetClientListeningHookCreated = false;

	return true;
}

function RequireMutedSenderMap(MuteManager) {
	const mapMutedSenderIndexesByReceiver = MuteManager.MutedSenderIndexesByReceiver;
	if (!(mapMutedSenderIndexesByReceiver instanceof Map)) {
		throw new TypeError("MuteManager MutedSenderIndexesByReceiver must be a Map.");
	}

	return mapMutedSenderIndexesByReceiver;
}

function RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex) {
	const setMutedSenderIndexes = mapMutedSenderIndexesByReceiver.get(unReceiverIndex);
	if ((setMutedSenderIndexes !== undefined) && !(setMutedSenderIndexes instanceof Set)) {
		throw new TypeError("MuteManager receiver entries must be Sets.");
	}

	return setMutedSenderIndexes;
}

function GetNativeClientListening(unReceiverIndex, unSenderIndex) {
	const bClientListening = g_VoiceRuntime.GetClientListening(unReceiverIndex, unSenderIndex);
	if (typeof bClientListening !== "boolean") {
		throw new TypeError("players/voice.GetClientListening() must return a boolean.");
	}

	return bClientListening;
}

function SetNativeClientListening(unReceiverIndex, unSenderIndex, bShouldListen) {
	const bListeningUpdated = g_VoiceRuntime.SetClientListening(unReceiverIndex, unSenderIndex, bShouldListen);
	if (typeof bListeningUpdated !== "boolean") {
		throw new TypeError("players/voice.SetClientListening() must return a boolean.");
	}

	if (!bListeningUpdated) {
		throw new Error("players/voice.SetClientListening() did not update the listening state.");
	}

	return true;
}

function ReleaseDisconnectedPlayer(MuteManager, unPlayerIndex) {
	const mapMutedSenders = RequireMutedSenderMap(MuteManager);
	const vecReceivers = [];

	// Both sides belong to the old connection; never roll this ownership back.
	mapMutedSenders.delete(unPlayerIndex);

	for (const [unReceiverIndex] of mapMutedSenders) {
		const setMutedSenders = RequireMutedSenderSet(mapMutedSenders, unReceiverIndex);
		if (setMutedSenders.delete(unPlayerIndex)) {
			vecReceivers.push(unReceiverIndex);

			if (setMutedSenders.size === 0) {
				mapMutedSenders.delete(unReceiverIndex);
			}
		}
	}

	for (const unReceiverIndex of vecReceivers) {
		try {
			if (!IsMutedForAnyManager(unPlayerIndex, unReceiverIndex)) {
				SetNativeClientListening(unReceiverIndex, unPlayerIndex, true);
			}
		} catch (Failure) {
			LogWarning(`Could not release voice route on disconnect (listener ${unReceiverIndex}, sender ${unPlayerIndex}): ${Failure?.message ?? "unknown error"}`);
		}
	}
}

function RestoreNativeListeningStates(vecListeningRestoreRecords) {
	const vecCleanupErrors = [];
	for (let nRecordIndex = vecListeningRestoreRecords.length - 1; nRecordIndex >= 0; nRecordIndex -= 1) {
		const ListeningRestoreRecord = vecListeningRestoreRecords[nRecordIndex];
		try {
			SetNativeClientListening(ListeningRestoreRecord.ReceiverIndex, ListeningRestoreRecord.SenderIndex, ListeningRestoreRecord.ShouldListen);
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	return vecCleanupErrors;
}

function RethrowWithCleanupErrors(OperationError, vecCleanupErrors, strMessage) {
	if (vecCleanupErrors.length !== 0) {
		throw new AggregateError([OperationError, ...vecCleanupErrors], strMessage);
	}

	throw OperationError;
}

class MuteManager {
	constructor() {
		this.MutedSenderIndexesByReceiver = new Map();
		this.DisconnectCallback = null;
	}

	GetReceiverIndexes(ReceiverReferences = null) {
		return NormalizeReceiverIndexes(ReceiverReferences);
	}

	GetMutedSenderIndexes(ReceiverReference) {
		const unReceiverIndex = RequirePlayerIndex(ReceiverReference, "receiver");
		const mapMutedSenderIndexesByReceiver = RequireMutedSenderMap(this);
		let setMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
		if (setMutedSenderIndexes === undefined) {
			setMutedSenderIndexes = new Set();
			mapMutedSenderIndexesByReceiver.set(unReceiverIndex, setMutedSenderIndexes);
		}

		return setMutedSenderIndexes;
	}

	IsMutedForReceiver(SenderReference, ReceiverReference) {
		const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");
		const unReceiverIndex = RequirePlayerIndex(ReceiverReference, "receiver");
		const mapMutedSenderIndexesByReceiver = RequireMutedSenderMap(this);
		const setMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);

		return (setMutedSenderIndexes !== undefined) && setMutedSenderIndexes.has(unSenderIndex);
	}

	EnsureDisconnectListener() {
		if (this.DisconnectCallback !== null) {
			return;
		}

		const DisconnectCallback = (unDisconnectedPlayerIndex) => ReleaseDisconnectedPlayer(this, unDisconnectedPlayerIndex);
		ClientDisconnectManager.RegisterListener(DisconnectCallback);
		this.DisconnectCallback = DisconnectCallback;
	}

	MutePlayer(SenderReference, ReceiverReferences = null) {
		const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");
		const vecReceiverIndexes = this.GetReceiverIndexes(ReceiverReferences);
		const mapMutedSenderIndexesByReceiver = RequireMutedSenderMap(this);
		const vecSenderOwnershipRecords = [];
		for (const unReceiverIndex of vecReceiverIndexes) {
			const setMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
			vecSenderOwnershipRecords.push({ MutedSenderIndexes: setMutedSenderIndexes, ReceiverIndex: unReceiverIndex });
		}

		const vecListeningRestoreRecords = [];
		try {
			for (const unReceiverIndex of vecReceiverIndexes) {
				const bShouldListen = GetNativeClientListening(unReceiverIndex, unSenderIndex);
				vecListeningRestoreRecords.push({ ReceiverIndex: unReceiverIndex, SenderIndex: unSenderIndex, ShouldListen: bShouldListen });
				SetNativeClientListening(unReceiverIndex, unSenderIndex, false);
			}
		} catch (MuteListeningError) {
			const vecListeningCleanupErrors = RestoreNativeListeningStates(vecListeningRestoreRecords);
			RethrowWithCleanupErrors(MuteListeningError, vecListeningCleanupErrors, "Muting and restoring client listening both failed.");
		}

		const bSetClientListeningHookAlreadyRegistered = g_SetClientListeningCallback !== null;
		try {
			HookSetClientListening();
			this.EnsureDisconnectListener();
		} catch (MuteRegistrationError) {
			const vecRegistrationCleanupErrors = RestoreNativeListeningStates(vecListeningRestoreRecords);
			if (!bSetClientListeningHookAlreadyRegistered && (g_setMuteManagers.size === 0) && (g_SetClientListeningHook !== null)) {
				try {
					if (!UnhookSetClientListening()) {
						throw new Error("Unable to remove the unused SetClientListening hook.");
					}
				} catch (HookCleanupError) {
					vecRegistrationCleanupErrors.push(HookCleanupError);
				}
			}

			RethrowWithCleanupErrors(MuteRegistrationError, vecRegistrationCleanupErrors, "Muting and registration cleanup both failed.");
		}

		for (const SenderOwnershipRecord of vecSenderOwnershipRecords) {
			let setMutedSenderIndexes = SenderOwnershipRecord.MutedSenderIndexes;
			if (setMutedSenderIndexes === undefined) {
				setMutedSenderIndexes = new Set();
				mapMutedSenderIndexesByReceiver.set(SenderOwnershipRecord.ReceiverIndex, setMutedSenderIndexes);
			}

			setMutedSenderIndexes.add(unSenderIndex);
		}

		g_setMuteManagers.add(this);

		return true;
	}

	UnmutePlayer(SenderReference, ReceiverReferences = null) {
		const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");
		const vecReceiverIndexes = this.GetReceiverIndexes(ReceiverReferences);
		const mapMutedSenderIndexesByReceiver = RequireMutedSenderMap(this);
		const vecSenderOwnershipRecords = [];
		for (const unReceiverIndex of vecReceiverIndexes) {
			const setMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
			if ((setMutedSenderIndexes === undefined) || !setMutedSenderIndexes.has(unSenderIndex)) {
				continue;
			}

			vecSenderOwnershipRecords.push({ MutedSenderIndexes: setMutedSenderIndexes, ReceiverIndex: unReceiverIndex });
		}

		for (const SenderOwnershipRecord of vecSenderOwnershipRecords) {
			const setMutedSenderIndexes = SenderOwnershipRecord.MutedSenderIndexes;
			setMutedSenderIndexes.delete(unSenderIndex);

			if (setMutedSenderIndexes.size === 0) {
				mapMutedSenderIndexesByReceiver.delete(SenderOwnershipRecord.ReceiverIndex);
			}
		}

		const vecListeningRestoreRecords = [];
		try {
			for (const SenderOwnershipRecord of vecSenderOwnershipRecords) {
				const unReceiverIndex = SenderOwnershipRecord.ReceiverIndex;
				let bMutedByAnotherManager = false;
				for (const MuteManager of g_setMuteManagers) {
					if ((MuteManager !== this) && MuteManager.IsMutedForReceiver(unSenderIndex, unReceiverIndex)) {
						bMutedByAnotherManager = true;
						break;
					}
				}

				if (bMutedByAnotherManager) {
					continue;
				}

				const bShouldListen = GetNativeClientListening(unReceiverIndex, unSenderIndex);
				vecListeningRestoreRecords.push({ ReceiverIndex: unReceiverIndex, SenderIndex: unSenderIndex, ShouldListen: bShouldListen });
				SetNativeClientListening(unReceiverIndex, unSenderIndex, true);
			}
		} catch (UnmuteListeningError) {
			const vecUnmuteCleanupErrors = RestoreNativeListeningStates(vecListeningRestoreRecords);
			for (const SenderOwnershipRecord of vecSenderOwnershipRecords) {
				try {
					const unReceiverIndex = SenderOwnershipRecord.ReceiverIndex;
					const setCurrentMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
					if (setCurrentMutedSenderIndexes === undefined) {
						mapMutedSenderIndexesByReceiver.set(unReceiverIndex, SenderOwnershipRecord.MutedSenderIndexes);

					} else if (setCurrentMutedSenderIndexes !== SenderOwnershipRecord.MutedSenderIndexes) {
						throw new Error("MuteManager receiver ownership changed while unmuting.");
					}

					SenderOwnershipRecord.MutedSenderIndexes.add(unSenderIndex);
				} catch (OwnershipCleanupError) {
					vecUnmuteCleanupErrors.push(OwnershipCleanupError);
				}
			}

			RethrowWithCleanupErrors(UnmuteListeningError, vecUnmuteCleanupErrors, "Unmuting and rollback both failed.");
		}

		return true;
	}

	IsMuted(SenderReference, ReceiverReferences = null) {
		const unSenderIndex = RequirePlayerIndex(SenderReference, "sender");
		for (const unReceiverIndex of this.GetReceiverIndexes(ReceiverReferences)) {
			if (!this.IsMutedForReceiver(unSenderIndex, unReceiverIndex)) {
				return false;
			}
		}

		return true;
	}

	ApplyMuteState(ReceiverReferences = null) {
		const vecReceiverIndexes = this.GetReceiverIndexes(ReceiverReferences);
		const mapMutedSenderIndexesByReceiver = RequireMutedSenderMap(this);
		const vecMutedPairRecords = [];
		for (const unReceiverIndex of vecReceiverIndexes) {
			const setMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
			if (setMutedSenderIndexes === undefined) {
				continue;
			}

			for (const unMutedSenderIndex of setMutedSenderIndexes) {
				const unSenderIndex = RequirePlayerIndex(unMutedSenderIndex, "muted sender");
				if (unSenderIndex !== unMutedSenderIndex) {
					throw new TypeError("MuteManager muted sender entries must be numeric player indexes.");
				}

				vecMutedPairRecords.push({ MutedSenderIndexes: setMutedSenderIndexes, ReceiverIndex: unReceiverIndex, SenderIndex: unSenderIndex });
			}
		}

		const vecListeningRestoreRecords = [];
		try {
			for (const MutedPairRecord of vecMutedPairRecords) {
				const bPreviousShouldListen = GetNativeClientListening(MutedPairRecord.ReceiverIndex, MutedPairRecord.SenderIndex);
				vecListeningRestoreRecords.push({ MutedSenderIndexes: MutedPairRecord.MutedSenderIndexes, ReceiverIndex: MutedPairRecord.ReceiverIndex, SenderIndex: MutedPairRecord.SenderIndex, ShouldListen: bPreviousShouldListen });
				SetNativeClientListening(MutedPairRecord.ReceiverIndex, MutedPairRecord.SenderIndex, false);
			}
		} catch (ApplyMuteStateError) {
			const vecApplyMuteStateCleanupErrors = [];
			const setReleasedMutedPairKeys = new Set();
			for (const ListeningRestoreRecord of vecListeningRestoreRecords) {
				try {
					const strMutedPairKey = `${ListeningRestoreRecord.ReceiverIndex}:${ListeningRestoreRecord.SenderIndex}`;
					if (setReleasedMutedPairKeys.has(strMutedPairKey)) {
						continue;
					}

					const unReceiverIndex = ListeningRestoreRecord.ReceiverIndex;
					const setCurrentMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
					if (setCurrentMutedSenderIndexes !== ListeningRestoreRecord.MutedSenderIndexes) {
						throw new Error("MuteManager receiver ownership changed while applying mute state.");
					}

					if (!setCurrentMutedSenderIndexes.delete(ListeningRestoreRecord.SenderIndex)) {
						throw new Error("MuteManager sender ownership changed while applying mute state.");
					}

					if ((setCurrentMutedSenderIndexes.size === 0) && !mapMutedSenderIndexesByReceiver.delete(unReceiverIndex)) {
						throw new Error("MuteManager receiver ownership could not be released during mute-state rollback.");
					}

					setReleasedMutedPairKeys.add(strMutedPairKey);
				} catch (OwnershipReleaseError) {
					vecApplyMuteStateCleanupErrors.push(OwnershipReleaseError);
				}
			}

			vecApplyMuteStateCleanupErrors.push(...RestoreNativeListeningStates(vecListeningRestoreRecords));

			for (const ListeningRestoreRecord of vecListeningRestoreRecords) {
				try {
					const unReceiverIndex = ListeningRestoreRecord.ReceiverIndex;
					const setCurrentMutedSenderIndexes = RequireMutedSenderSet(mapMutedSenderIndexesByReceiver, unReceiverIndex);
					if (setCurrentMutedSenderIndexes === undefined) {
						mapMutedSenderIndexesByReceiver.set(unReceiverIndex, ListeningRestoreRecord.MutedSenderIndexes);

					} else if (setCurrentMutedSenderIndexes !== ListeningRestoreRecord.MutedSenderIndexes) {
						throw new Error("MuteManager receiver ownership changed during mute-state rollback.");
					}

					ListeningRestoreRecord.MutedSenderIndexes.add(ListeningRestoreRecord.SenderIndex);
				} catch (OwnershipRestoreError) {
					vecApplyMuteStateCleanupErrors.push(OwnershipRestoreError);
				}
			}

			RethrowWithCleanupErrors(ApplyMuteStateError, vecApplyMuteStateCleanupErrors, "Applying mute state and rollback both failed.");
		}

		return true;
	}

	ClearMuteState() {
		const mapMutedSenderIndexesByReceiver = RequireMutedSenderMap(this);
		const vecReceiverOwnershipRecords = [];
		const vecMutedPairRecords = [];
		for (const vecReceiverEntry of mapMutedSenderIndexesByReceiver) {
			const unMutedReceiverIndex = vecReceiverEntry[0];
			const setMutedSenderIndexes = vecReceiverEntry[1];
			const unReceiverIndex = RequirePlayerIndex(unMutedReceiverIndex, "muted receiver");
			if (unReceiverIndex !== unMutedReceiverIndex) {
				throw new TypeError("MuteManager receiver keys must be numeric player indexes.");
			}

			if (!(setMutedSenderIndexes instanceof Set)) {
				throw new TypeError("MuteManager receiver entries must be Sets.");
			}

			vecReceiverOwnershipRecords.push({ MutedSenderIndexes: setMutedSenderIndexes, ReceiverIndex: unReceiverIndex });
			for (const unMutedSenderIndex of setMutedSenderIndexes) {
				const unSenderIndex = RequirePlayerIndex(unMutedSenderIndex, "muted sender");
				if (unSenderIndex !== unMutedSenderIndex) {
					throw new TypeError("MuteManager muted sender entries must be numeric player indexes.");
				}

				vecMutedPairRecords.push({ ReceiverIndex: unReceiverIndex, SenderIndex: unSenderIndex });
			}
		}

		mapMutedSenderIndexesByReceiver.clear();

		const vecListeningRestoreRecords = [];
		try {
			for (const MutedPairRecord of vecMutedPairRecords) {
				const unReceiverIndex = MutedPairRecord.ReceiverIndex;
				const unSenderIndex = MutedPairRecord.SenderIndex;
				const bShouldListen = !IsMutedForAnyManager(unSenderIndex, unReceiverIndex);
				const bPreviousShouldListen = GetNativeClientListening(unReceiverIndex, unSenderIndex);
				vecListeningRestoreRecords.push({ ReceiverIndex: unReceiverIndex, SenderIndex: unSenderIndex, ShouldListen: bPreviousShouldListen });
				SetNativeClientListening(unReceiverIndex, unSenderIndex, bShouldListen);
			}
		} catch (ClearMuteStateError) {
			const vecClearCleanupErrors = RestoreNativeListeningStates(vecListeningRestoreRecords);
			for (const ReceiverOwnershipRecord of vecReceiverOwnershipRecords) {
				try {
					const unReceiverIndex = ReceiverOwnershipRecord.ReceiverIndex;
					if (mapMutedSenderIndexesByReceiver.has(unReceiverIndex)) {
						throw new Error("MuteManager receiver ownership changed while clearing.");
					}

					mapMutedSenderIndexesByReceiver.set(unReceiverIndex, ReceiverOwnershipRecord.MutedSenderIndexes);
				} catch (OwnershipCleanupError) {
					vecClearCleanupErrors.push(OwnershipCleanupError);
				}
			}

			RethrowWithCleanupErrors(ClearMuteStateError, vecClearCleanupErrors, "Clearing mute state and rollback both failed.");
		}

		return true;
	}

	Unload() {
		this.ClearMuteState();

		if (this.DisconnectCallback !== null) {
			const bDisconnectListenerUnregistered = ClientDisconnectManager.UnregisterListener(this.DisconnectCallback);
			if (typeof bDisconnectListenerUnregistered !== "boolean") {
				throw new TypeError("ListenerManager.UnregisterListener() must return a boolean.");
			}

			if (!bDisconnectListenerUnregistered) {
				return false;
			}

			this.DisconnectCallback = null;
		}

		g_setMuteManagers.delete(this);

		if (g_setMuteManagers.size === 0) {
			return UnhookSetClientListening();
		}

		return true;
	}
}

const g_MuteManager = new MuteManager();

const g_VoiceAPI = {
	MUTE_MANAGER: g_MuteManager,
	MuteManager,
	GetClientListening,
	HookSetClientListening,
	SetClientListening,
	GetSetClientListeningHookOptions,
	SetClientProximity,
};

Object.defineProperty(g_VoiceAPI, "VoiceServer", {
	enumerable: true,
	get() {
		return g_VoiceRuntime.VoiceServer;
	},
});

module.exports = g_VoiceAPI;
