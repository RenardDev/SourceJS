"use strict";

const { GetModule } = require("internal/runtime");

// Table/column names and value-kind tags belong to the existing persistent database format.
const g_strPlayerTable = "sourcejs_settings_players";
const g_strValueTable = "sourcejs_settings_values";
const g_SettingsRuntime = GetModule("settings");
const g_SOCIRuntime = GetModule("soci");
const g_mapSettingsStorageRequests = new WeakMap();

function RequireSettingsNamespace(strSettingsNamespace) {
	if ((typeof strSettingsNamespace !== "string") || !/^[A-Za-z0-9_.-]+$/.test(strSettingsNamespace)) {
		throw new TypeError("Settings namespace must contain only letters, digits, dots, underscores and hyphens.");
	}

	return strSettingsNamespace;
}

function RequireNonEmptyString(strValue, strValueName) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strValueName} must be a non-empty string.`);
	}

	return strValue;
}

function RequireString(strValue, strValueName) {
	if (typeof strValue !== "string") {
		throw new TypeError(`${strValueName} must be a string.`);
	}

	return strValue;
}

function RequireSettingsRoot() {
	return RequireNonEmptyString(g_SettingsRuntime.Root, "Settings root");
}

function CreateSettingsValueRecord() {
	return Object.create(null);
}

function RequireSOCIColumnValue(SOCIRecord, strColumnName) {
	if (Object.hasOwn(SOCIRecord, strColumnName)) {
		return SOCIRecord[strColumnName];
	}

	throw new Error(`SOCI result is missing column '${strColumnName}'.`);
}

function EncodeSettingsValue(SettingsValue) {
	if (SettingsValue === null) {
		return { NumberValue: null, TextValue: null, ValueKind: "null" };
	}

	if (typeof SettingsValue === "boolean") {
		return { NumberValue: null, TextValue: SettingsValue ? "1" : "0", ValueKind: "boolean" };
	}

	if (typeof SettingsValue === "string") {
		return { NumberValue: null, TextValue: SettingsValue, ValueKind: "string" };
	}

	if (typeof SettingsValue === "number") {
		if (!Number.isFinite(SettingsValue)) {
			throw new TypeError("SettingsStorage only accepts finite numeric values.");
		}

		return { NumberValue: SettingsValue, TextValue: null, ValueKind: "number" };
	}

	if (typeof SettingsValue === "bigint") {
		return { NumberValue: null, TextValue: SettingsValue.toString(), ValueKind: "bigint" };
	}

	throw new TypeError("SettingsStorage values must be null, boolean, string, finite Number or BigInt.");
}

function DecodeSettingsValue(SOCIRecord) {
	const strSettingsValueKind = RequireSOCIColumnValue(SOCIRecord, "value_kind");
	if (typeof strSettingsValueKind !== "string") {
		throw new TypeError("SOCI value_kind must be a string.");
	}

	switch (strSettingsValueKind) {
		case "null":
			return null;

		case "boolean": {
			const strBooleanText = RequireString(RequireSOCIColumnValue(SOCIRecord, "value_text"), "SOCI boolean value");
			if ((strBooleanText !== "0") && (strBooleanText !== "1")) {
				throw new TypeError("SOCI boolean value must be '0' or '1'.");
			}

			return strBooleanText === "1";
		}

		case "string":
			return RequireString(RequireSOCIColumnValue(SOCIRecord, "value_text"), "SOCI string value");

		case "number": {
			const dblNumericValue = RequireSOCIColumnValue(SOCIRecord, "value_number");
			if ((typeof dblNumericValue !== "number") || !Number.isFinite(dblNumericValue)) {
				throw new TypeError("SOCI value_number must be a finite number.");
			}

			return dblNumericValue;
		}

		case "bigint":
			return BigInt(RequireNonEmptyString(RequireSOCIColumnValue(SOCIRecord, "value_text"), "SOCI BigInt value"));

		default:
			throw new Error(`Unknown settings value kind '${strSettingsValueKind}'.`);
	}
}

function RequireSettingsStorageOptions(StorageOptions, strStorageOptionsName) {
	if ((StorageOptions === null) || (typeof StorageOptions !== "object") || Array.isArray(StorageOptions)) {
		throw new TypeError(`${strStorageOptionsName} must be an object.`);
	}

	return StorageOptions;
}

function CopySettingsStorageOptionProperties(TargetStorageOptions, SourceStorageOptions) {
	for (const OptionName of Reflect.ownKeys(SourceStorageOptions)) {
		const OptionDescriptor = Object.getOwnPropertyDescriptor(SourceStorageOptions, OptionName);
		if ((OptionDescriptor === undefined) || !OptionDescriptor.enumerable) {
			continue;
		}

		const OptionValue = SourceStorageOptions[OptionName];
		Object.defineProperty(TargetStorageOptions, OptionName, { configurable: true, enumerable: true, value: OptionValue, writable: true });
	}
}

function CreateSettingsStorageOptions(DefaultStorageOptions, StorageOptions) {
	RequireSettingsStorageOptions(StorageOptions, "SettingsStorage options");
	RequireSettingsStorageOptions(DefaultStorageOptions, "SettingsStorage default options");

	const OwnedStorageOptions = {};
	CopySettingsStorageOptionProperties(OwnedStorageOptions, DefaultStorageOptions);
	CopySettingsStorageOptionProperties(OwnedStorageOptions, StorageOptions);

	return OwnedStorageOptions;
}

function ResolveSettingsDatabasePath(StorageOptions) {
	const strSettingsDatabasePath = StorageOptions.DatabasePath;
	if ((strSettingsDatabasePath === null) || (strSettingsDatabasePath === undefined)) {
		return `${RequireSettingsRoot()}/users.sqlite3`;
	}

	return RequireNonEmptyString(strSettingsDatabasePath, "Settings DatabasePath");
}

function RequireSettingsBackend(strSettingsBackend) {
	if ((strSettingsBackend !== null) && ((typeof strSettingsBackend !== "string") || (strSettingsBackend.length === 0))) {
		throw new TypeError("Settings Backend must be a non-empty string or null.");
	}

	return strSettingsBackend;
}

function ResolveSettingsConnectionString(strSettingsConnectionStringOption, strSettingsDatabasePath) {
	if (strSettingsConnectionStringOption === null) {
		return `dbname=${strSettingsDatabasePath}`;
	}

	return RequireNonEmptyString(strSettingsConnectionStringOption, "Settings ConnectionString");
}

function RequireSettingsSOCIHandle(hSOCIHandle) {
	if (!Number.isSafeInteger(hSOCIHandle) || (hSOCIHandle <= 0)) {
		throw new TypeError("Settings SOCI handle must be a positive safe integer.");
	}

	return hSOCIHandle;
}

function RequireSOCIBooleanResult(bSOCIResult, strSOCIOperationName) {
	if (typeof bSOCIResult !== "boolean") {
		throw new TypeError(`${strSOCIOperationName} callback result must be a boolean.`);
	}

	return bSOCIResult;
}

function RequireSuccessfulSOCIResult(bSOCIResult, strSOCIOperationName) {
	if (!RequireSOCIBooleanResult(bSOCIResult, strSOCIOperationName)) {
		throw new Error(`${strSOCIOperationName} failed.`);
	}

	return true;
}

function RequireSOCIQueryRows(vecSOCIRecords, strSOCIOperationName) {
	if (!Array.isArray(vecSOCIRecords)) {
		throw new TypeError(`${strSOCIOperationName} callback result must be an array.`);
	}

	for (let unSOCIRecordIndex = 0; unSOCIRecordIndex < vecSOCIRecords.length; unSOCIRecordIndex += 1) {
		const SOCIRecord = vecSOCIRecords[unSOCIRecordIndex];
		if ((SOCIRecord === null) || (typeof SOCIRecord !== "object") || Array.isArray(SOCIRecord)) {
			throw new TypeError(`${strSOCIOperationName} Row ${unSOCIRecordIndex} must be an object.`);
		}
	}

	return vecSOCIRecords;
}

function RequireSettingsRequestOptions(Options) {
	RequireSettingsStorageOptions(Options, "SettingsStorage request Options");

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("SettingsStorage request Options.Blocking must be a boolean.");
	}

	return { Blocking: bBlocking === true };
}

function RequireSettingsCallback(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("SettingsStorage Callback must be a function.");
	}

	return Callback;
}

function RequireSOCIExecutionResult(nAffectedRowCount) {
	if (typeof nAffectedRowCount !== "bigint") {
		throw new TypeError("soci.Execute() callback result must be a BigInt affected-row count.");
	}

	return nAffectedRowCount;
}

function NormalizeSettingsRequestFailure(Failure) {
	// A caught null must not become the callback's success sentinel.
	if (Failure === null) {
		return new Error("Settings request threw null.", { cause: Failure });
	}

	return Failure;
}

function InvokeSettingsRequest(Request, Callback) {
	let bRequestCompleted = false;
	const CompleteRequest = (RequestError, Result) => {
		if (bRequestCompleted) {
			return;
		}

		bRequestCompleted = true;
		Callback(RequestError, Result);
	};

	try {
		Request(CompleteRequest);
	} catch (RequestError) {
		if (bRequestCompleted) {
			throw RequestError;
		}

		CompleteRequest(NormalizeSettingsRequestFailure(RequestError));
	}
}

function RunSettingsSOCIRequest(Request, ValidateResult, Callback) {
	InvokeSettingsRequest(Request, (RequestError, Result) => {
		if (RequestError !== null) {
			Callback(RequestError);
			return;
		}

		let ValidatedResult = null;

		try {
			ValidatedResult = ValidateResult(Result);
		} catch (ValidationError) {
			Callback(NormalizeSettingsRequestFailure(ValidationError));
			return;
		}

		Callback(null, ValidatedResult);
	});
}

function RunSettingsOperations(vecOperations, Callback) {
	let unNextOperationIndex = 0;
	let bRunning = false;
	let bWaiting = false;
	let bCompleted = false;
	let bCallbackDelivered = false;
	let CompletionError = null;

	// Blocking requests complete inline; drain them iteratively instead of growing the callback stack.
	function ContinueOperations() {
		if (bRunning) {
			return;
		}

		bRunning = true;

		try {
			while (!bWaiting && !bCompleted) {
				if (unNextOperationIndex === vecOperations.length) {
					bCompleted = true;
					break;
				}

				const Operation = vecOperations[unNextOperationIndex];
				unNextOperationIndex++;
				bWaiting = true;
				InvokeSettingsRequest(Operation, (OperationError) => {
					if (OperationError !== null) {
						CompletionError = OperationError;
						bCompleted = true;
					}

					bWaiting = false;
					ContinueOperations();
				});
			}
		} finally {
			bRunning = false;
		}

		if (bCompleted && !bCallbackDelivered) {
			bCallbackDelivered = true;
			Callback(CompletionError, CompletionError === null);
		}
	}

	ContinueOperations();
}

function ExecuteSettingsStatement(hSOCIHandle, strSQL, Parameters, Options, Callback) {
	RunSettingsSOCIRequest((CompleteRequest) => g_SOCIRuntime.Execute(hSOCIHandle, strSQL, Parameters, Options, CompleteRequest), RequireSOCIExecutionResult, Callback);
}

function QuerySettingsRecords(hSOCIHandle, strSQL, Parameters, Options, Callback) {
	RunSettingsSOCIRequest((CompleteRequest) => g_SOCIRuntime.Query(hSOCIHandle, strSQL, Parameters, Options, CompleteRequest), (vecSOCIRecords) => RequireSOCIQueryRows(vecSOCIRecords, "soci.Query()"), Callback);
}

function CreateSettingsSchema(hSOCIHandle, Options, Callback) {
	const strPlayerSchemaStatement = `CREATE TABLE IF NOT EXISTS ${g_strPlayerTable} (namespace VARCHAR(128) NOT NULL, uniqueid VARCHAR(255) NOT NULL, PRIMARY KEY (namespace, uniqueid))`;
	const strValueSchemaStatement = `CREATE TABLE IF NOT EXISTS ${g_strValueTable} (namespace VARCHAR(128) NOT NULL, uniqueid VARCHAR(255) NOT NULL, setting_name VARCHAR(255) NOT NULL, value_kind VARCHAR(16) NOT NULL, value_text VARCHAR(4096), value_number DOUBLE PRECISION, PRIMARY KEY (namespace, uniqueid, setting_name))`;
	const vecSchemaOperations = [
		(CompleteRequest) => ExecuteSettingsStatement(hSOCIHandle, strPlayerSchemaStatement, {}, Options, CompleteRequest),
		(CompleteRequest) => ExecuteSettingsStatement(hSOCIHandle, strValueSchemaStatement, {}, Options, CompleteRequest),
	];
	RunSettingsOperations(vecSchemaOperations, Callback);
}

function RequireSettingsValueRecord(SettingsValueRecord, strSettingsValueRecordName) {
	if ((SettingsValueRecord === null) || (typeof SettingsValueRecord !== "object") || Array.isArray(SettingsValueRecord) || (Object.getPrototypeOf(SettingsValueRecord) !== null)) {
		throw new TypeError(`${strSettingsValueRecordName} must be a null-prototype object.`);
	}

	return SettingsValueRecord;
}

function CollectSettingsValueRecordEntries(SettingsValueRecord, strSettingsValueRecordName, strPropertyNameDescription) {
	RequireSettingsValueRecord(SettingsValueRecord, strSettingsValueRecordName);

	const vecSettingsValuePropertyKeys = Reflect.ownKeys(SettingsValueRecord);
	const vecSettingsValueEntries = [];
	for (const SettingsValuePropertyKey of vecSettingsValuePropertyKeys) {
		if (typeof SettingsValuePropertyKey !== "string") {
			throw new TypeError(`${strSettingsValueRecordName} must not contain symbol properties.`);
		}

		const strSettingsValuePropertyName = RequireNonEmptyString(SettingsValuePropertyKey, strPropertyNameDescription);
		const SettingsValuePropertyDescriptor = Object.getOwnPropertyDescriptor(SettingsValueRecord, strSettingsValuePropertyName);
		if ((SettingsValuePropertyDescriptor === undefined) || !Object.hasOwn(SettingsValuePropertyDescriptor, "value") || (SettingsValuePropertyDescriptor.configurable !== true) || (SettingsValuePropertyDescriptor.enumerable !== true) || (SettingsValuePropertyDescriptor.writable !== true)) {
			throw new TypeError(`${strSettingsValueRecordName} properties must be enumerable, configurable, writable data properties.`);
		}

		vecSettingsValueEntries.push({ PropertyName: strSettingsValuePropertyName, PropertyValue: SettingsValuePropertyDescriptor.value });
	}

	return vecSettingsValueEntries;
}

function EnsureSettingsPlayer(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, Options, Callback) {
	const hRequiredSOCIHandle = RequireSettingsSOCIHandle(hSOCIHandle);
	const strRequiredSettingsNamespace = RequireSettingsNamespace(strSettingsNamespace);
	const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
	const PlayerQueryParameters = { namespace: strRequiredSettingsNamespace, uniqueid: strRequiredPlayerUniqueID };
	const strPlayerSelectStatement = `SELECT uniqueid FROM ${g_strPlayerTable} WHERE namespace = :namespace AND uniqueid = :uniqueid`;
	QuerySettingsRecords(hRequiredSOCIHandle, strPlayerSelectStatement, PlayerQueryParameters, Options, (QueryError, vecPlayerRecords) => {
		if (QueryError !== null) {
			Callback(QueryError);
			return;
		}

		try {
			if (vecPlayerRecords.length > 1) {
				throw new Error("soci.Query() for one settings player returned multiple rows.");
			}

			if (vecPlayerRecords.length === 1) {
				const strQueriedPlayerUniqueID = RequireNonEmptyString(RequireSOCIColumnValue(vecPlayerRecords[0], "uniqueid"), "Player unique ID");
				if (strQueriedPlayerUniqueID !== strRequiredPlayerUniqueID) {
					throw new Error("soci.Query() for one settings player returned an unexpected player unique ID.");
				}
			}
		} catch (ValidationError) {
			Callback(NormalizeSettingsRequestFailure(ValidationError));
			return;
		}

		if (vecPlayerRecords.length === 1) {
			Callback(null, true);
			return;
		}

		const strPlayerInsertStatement = `INSERT INTO ${g_strPlayerTable} (namespace, uniqueid) VALUES (:namespace, :uniqueid)`;
		ExecuteSettingsStatement(hRequiredSOCIHandle, strPlayerInsertStatement, PlayerQueryParameters, Options, (InsertError) => Callback(InsertError, InsertError === null));
	});
}

function InsertEncodedSettingsValue(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, strSettingName, EncodedSettingsValue, Options, Callback) {
	const hRequiredSOCIHandle = RequireSettingsSOCIHandle(hSOCIHandle);
	const strRequiredSettingsNamespace = RequireSettingsNamespace(strSettingsNamespace);
	const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
	const strRequiredSettingName = RequireNonEmptyString(strSettingName, "Setting name");
	const strValueInsertStatement = `INSERT INTO ${g_strValueTable} (namespace, uniqueid, setting_name, value_kind, value_text, value_number) VALUES (:namespace, :uniqueid, :name, :kind, :text, :number)`;
	ExecuteSettingsStatement(hRequiredSOCIHandle, strValueInsertStatement, { kind: EncodedSettingsValue.ValueKind, name: strRequiredSettingName, namespace: strRequiredSettingsNamespace, number: EncodedSettingsValue.NumberValue, text: EncodedSettingsValue.TextValue, uniqueid: strRequiredPlayerUniqueID }, Options, Callback);
}

function InsertSettingsValue(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback) {
	const EncodedSettingsValue = EncodeSettingsValue(SettingsValue);
	InsertEncodedSettingsValue(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, strSettingName, EncodedSettingsValue, Options, Callback);
}

function CollectSettingsPlayerEntries(SettingsValues) {
	const vecSettingsPlayerProperties = CollectSettingsValueRecordEntries(SettingsValues, "Settings data", "Player unique ID");
	const vecSettingsPlayerEntries = [];
	for (const SettingsPlayerProperty of vecSettingsPlayerProperties) {
		const strPlayerUniqueID = SettingsPlayerProperty.PropertyName;
		const PlayerSettingsValues = RequireSettingsValueRecord(SettingsPlayerProperty.PropertyValue, `Settings values for player '${strPlayerUniqueID}'`);
		const vecSettingProperties = CollectSettingsValueRecordEntries(PlayerSettingsValues, `Settings values for player '${strPlayerUniqueID}'`, "Setting name");
		const vecSettingEntries = [];
		for (const SettingProperty of vecSettingProperties) {
			vecSettingEntries.push({ EncodedSettingsValue: EncodeSettingsValue(SettingProperty.PropertyValue), SettingName: SettingProperty.PropertyName });
		}

		vecSettingsPlayerEntries.push({ PlayerUniqueID: strPlayerUniqueID, SettingEntries: vecSettingEntries });
	}

	return vecSettingsPlayerEntries;
}

function DefineSettingsValueRecordEntry(SettingsValueRecord, SettingsEntry, strFailureMessage) {
	const bPropertyDefined = Reflect.defineProperty(SettingsValueRecord, SettingsEntry.PropertyName, { configurable: true, enumerable: true, value: SettingsEntry.PropertyValue, writable: true });
	if (!bPropertyDefined) {
		throw new TypeError(strFailureMessage);
	}
}

function RemoveSettingsValueRecordEntry(SettingsValueRecord, SettingsEntry, strFailureMessage) {
	if (!Reflect.deleteProperty(SettingsValueRecord, SettingsEntry.PropertyName)) {
		throw new TypeError(strFailureMessage);
	}
}

function ReplaceSettingsValueRecordContents(SettingsValueRecord, ReplacementSettingsValueRecord) {
	const vecCurrentSettingsEntries = CollectSettingsValueRecordEntries(SettingsValueRecord, "Current settings value record", "Settings property name");
	const vecReplacementSettingsEntries = CollectSettingsValueRecordEntries(ReplacementSettingsValueRecord, "Replacement settings value record", "Settings property name");
	const mapCurrentSettingsEntriesByPropertyName = new Map();
	const setReplacementSettingsPropertyNames = new Set();
	const bSettingsValueRecordExtensible = Object.isExtensible(SettingsValueRecord);
	const vecAttemptedReplacementSettingsEntries = [];
	const vecAttemptedRemovedSettingsEntries = [];

	for (const CurrentSettingsEntry of vecCurrentSettingsEntries) {
		mapCurrentSettingsEntriesByPropertyName.set(CurrentSettingsEntry.PropertyName, CurrentSettingsEntry);
	}

	for (const ReplacementSettingsEntry of vecReplacementSettingsEntries) {
		setReplacementSettingsPropertyNames.add(ReplacementSettingsEntry.PropertyName);

		if (!bSettingsValueRecordExtensible && !mapCurrentSettingsEntriesByPropertyName.has(ReplacementSettingsEntry.PropertyName)) {
			throw new TypeError("Settings value record must be extensible before new properties can be added.");
		}
	}

	try {
		for (const ReplacementSettingsEntry of vecReplacementSettingsEntries) {
			vecAttemptedReplacementSettingsEntries.push(ReplacementSettingsEntry);
			DefineSettingsValueRecordEntry(SettingsValueRecord, ReplacementSettingsEntry, "Settings value record could not define a replacement property.");
		}

		for (const CurrentSettingsEntry of vecCurrentSettingsEntries) {
			if (setReplacementSettingsPropertyNames.has(CurrentSettingsEntry.PropertyName)) {
				continue;
			}

			vecAttemptedRemovedSettingsEntries.push(CurrentSettingsEntry);
			RemoveSettingsValueRecordEntry(SettingsValueRecord, CurrentSettingsEntry, "Settings value record could not remove a stale property.");
		}
	} catch (SettingsValueRecordUpdateError) {
		const vecSettingsValueRecordRollbackErrors = [];
		for (let nRemovedSettingsEntryIndex = vecAttemptedRemovedSettingsEntries.length - 1; nRemovedSettingsEntryIndex >= 0; nRemovedSettingsEntryIndex -= 1) {
			const RemovedSettingsEntry = vecAttemptedRemovedSettingsEntries[nRemovedSettingsEntryIndex];
			try {
				DefineSettingsValueRecordEntry(SettingsValueRecord, RemovedSettingsEntry, "Settings value record rollback could not restore a removed property.");
			} catch (SettingsValueRecordRollbackError) {
				vecSettingsValueRecordRollbackErrors.push(SettingsValueRecordRollbackError);
			}
		}

		for (let nReplacementSettingsEntryIndex = vecAttemptedReplacementSettingsEntries.length - 1; nReplacementSettingsEntryIndex >= 0; nReplacementSettingsEntryIndex -= 1) {
			const ReplacementSettingsEntry = vecAttemptedReplacementSettingsEntries[nReplacementSettingsEntryIndex];
			const CurrentSettingsEntry = mapCurrentSettingsEntriesByPropertyName.get(ReplacementSettingsEntry.PropertyName);

			try {
				if (CurrentSettingsEntry === undefined) {
					RemoveSettingsValueRecordEntry(SettingsValueRecord, ReplacementSettingsEntry, "Settings value record rollback could not remove a new property.");

				} else {
					DefineSettingsValueRecordEntry(SettingsValueRecord, CurrentSettingsEntry, "Settings value record rollback could not restore a replaced property.");
				}
			} catch (SettingsValueRecordRollbackError) {
				vecSettingsValueRecordRollbackErrors.push(SettingsValueRecordRollbackError);
			}
		}

		if (vecSettingsValueRecordRollbackErrors.length === 0) {
			throw SettingsValueRecordUpdateError;
		}

		const vecSettingsValueRecordErrors = [SettingsValueRecordUpdateError];
		for (const SettingsValueRecordRollbackError of vecSettingsValueRecordRollbackErrors) {
			vecSettingsValueRecordErrors.push(SettingsValueRecordRollbackError);
		}

		throw new AggregateError(vecSettingsValueRecordErrors, "Settings value record update failed and rollback was unsuccessful.");
	}

	return SettingsValueRecord;
}

function CopySettingsValueRecord(SettingsValueRecord, strSettingsValueRecordName, strPropertyNameDescription) {
	const vecSettingsValueEntries = CollectSettingsValueRecordEntries(SettingsValueRecord, strSettingsValueRecordName, strPropertyNameDescription);
	const CopiedSettingsValueRecord = CreateSettingsValueRecord();
	for (const SettingsValueEntry of vecSettingsValueEntries) {
		DefineSettingsValueRecordEntry(CopiedSettingsValueRecord, SettingsValueEntry, `${strSettingsValueRecordName} could not be copied.`);
	}

	return CopiedSettingsValueRecord;
}

function ReplaceSettingsValueRecordContentsInTransaction(SettingsStorage, SettingsValueRecord, ReplacementSettingsValueRecord, DatabaseMutationCallback, Options, Callback) {
	const OriginalSettingsValueRecord = CopySettingsValueRecord(SettingsValueRecord, "Original settings value record", "Settings property name");
	let bSettingsValueRecordReplaced = false;
	const RunDatabaseMutation = (hSOCIHandle, RequestOptions, CompleteTransaction) => {
		InvokeSettingsRequest((CompleteMutation) => DatabaseMutationCallback(hSOCIHandle, RequestOptions, CompleteMutation), (MutationError, Result) => {
			if (MutationError !== null) {
				CompleteTransaction(MutationError);
				return;
			}

			try {
				ReplaceSettingsValueRecordContents(SettingsValueRecord, ReplacementSettingsValueRecord);
				bSettingsValueRecordReplaced = true;
			} catch (RecordError) {
				CompleteTransaction(NormalizeSettingsRequestFailure(RecordError));
				return;
			}

			CompleteTransaction(null, Result);
		});
	};
	const CompleteRecordTransaction = (TransactionError, Result) => {
		if ((TransactionError === null) || !bSettingsValueRecordReplaced) {
			Callback(TransactionError, Result);
			return;
		}

		try {
			ReplaceSettingsValueRecordContents(SettingsValueRecord, OriginalSettingsValueRecord);
		} catch (RestoreError) {
			Callback(new AggregateError([TransactionError, RestoreError], "Settings transaction failed and the live value record could not be restored."));
			return;
		}

		Callback(TransactionError);
	};
	SettingsStorage.RunTransactionRequest(RunDatabaseMutation, Options, CompleteRecordTransaction);
}

function ThrowSettingsCallbackErrors(RequestState) {
	const vecCallbackErrors = RequestState.CallbackErrors;
	if (vecCallbackErrors.length === 0) {
		return;
	}

	RequestState.CallbackErrors = [];

	if (vecCallbackErrors.length === 1) {
		throw vecCallbackErrors[0];
	}

	throw new AggregateError(vecCallbackErrors, "SettingsStorage completion callbacks failed.");
}

// Keep transactions on each session serial; different storage instances have independent queues.
function DrainSettingsRequests(Storage) {
	const RequestState = g_mapSettingsStorageRequests.get(Storage);
	if (RequestState.Draining || RequestState.Processing) {
		return;
	}

	RequestState.Draining = true;

	try {
		while (!RequestState.Processing && (RequestState.Requests.length > 0)) {
			const RequestEntry = RequestState.Requests.shift();
			RequestState.Processing = true;
			InvokeSettingsRequest((CompleteRequest) => RequestEntry.Request(RequestEntry.Options, CompleteRequest), (RequestError, Result) => {
				RequestState.Processing = false;

				try {
					RequestEntry.Callback(RequestError, Result);
				} catch (CallbackError) {
					RequestState.CallbackErrors.push(CallbackError);
				}

				DrainSettingsRequests(Storage);

				if (!RequestState.Draining) {
					ThrowSettingsCallbackErrors(RequestState);
				}
			});
		}
	} finally {
		RequestState.Draining = false;
	}

	ThrowSettingsCallbackErrors(RequestState);
}

function QueueSettingsRequest(Storage, Request, Options, Callback) {
	const RequestOptions = RequireSettingsRequestOptions(Options);
	RequireSettingsCallback(Callback);

	const RequestState = g_mapSettingsStorageRequests.get(Storage);
	if (RequestOptions.Blocking && (RequestState.Processing || (RequestState.Requests.length > 0))) {
		throw new Error("A Blocking settings request cannot wait behind a pending operation on the same storage.");
	}

	if (RequestOptions.Blocking) {
		RequestState.Processing = true;
		InvokeSettingsRequest((CompleteRequest) => Request(RequestOptions, CompleteRequest), (RequestError, Result) => {
			RequestState.Processing = false;

			try {
				Callback(RequestError, Result);
			} catch (CallbackError) {
				RequestState.CallbackErrors.push(CallbackError);
			}

			DrainSettingsRequests(Storage);
			ThrowSettingsCallbackErrors(RequestState);
		});
		return;
	}

	RequestState.Requests.push({ Request, Options: RequestOptions, Callback });
	DrainSettingsRequests(Storage);
}

function RequireSettingsSessionUsable(Storage, hSOCIHandle) {
	RequireSettingsSOCIHandle(hSOCIHandle);

	if ((hSOCIHandle === Storage.ValueHandle) && g_mapSettingsStorageRequests.get(Storage).TransactionFailed) {
		throw new Error("A settings transaction rollback failed; close the storage before reusing its session.");
	}
}

class SettingsStorage {
	constructor(strSettingsNamespace = "players", StorageOptions = {}) {
		const strNormalizedSettingsNamespace = RequireSettingsNamespace(strSettingsNamespace);
		const OwnedStorageOptions = CreateSettingsStorageOptions(SettingsStorage.Options, StorageOptions);
		const strSettingsDatabasePath = ResolveSettingsDatabasePath(OwnedStorageOptions);
		const strSettingsBackend = RequireSettingsBackend(OwnedStorageOptions.Backend);
		const strSettingsConnectionString = ResolveSettingsConnectionString(OwnedStorageOptions.ConnectionString, strSettingsDatabasePath);
		this.ValueNamespace = strNormalizedSettingsNamespace;
		this.ValueOptions = OwnedStorageOptions;
		this.ValuePath = strSettingsDatabasePath;
		this.ValueBackend = strSettingsBackend;
		this.ValueConnectionString = strSettingsConnectionString;
		this.ValueHandle = null;
		this.ValueLoaded = false;
		this.ValueData = CreateSettingsValueRecord();
		g_mapSettingsStorageRequests.set(this, { Processing: false, Draining: false, Requests: [], CallbackErrors: [], SchemaReady: false, TransactionFailed: false });
	}

	Open(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => this.OpenSession(RequestOptions, CompleteRequest), Options, Callback);
	}

	CreateSchema(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const hSOCIHandle = RequireSettingsSOCIHandle(this.ValueHandle);
			RequireSettingsSessionUsable(this, hSOCIHandle);

			CreateSettingsSchema(hSOCIHandle, RequestOptions, (SchemaError, Result) => {
				if (SchemaError === null) {
					g_mapSettingsStorageRequests.get(this).SchemaReady = true;
				}

				CompleteRequest(SchemaError, Result);
			});
		}, Options, Callback);
	}

	RunTransaction(TransactionCallback, Options, Callback) {
		if (typeof TransactionCallback !== "function") {
			throw new TypeError("TransactionCallback must be a function.");
		}

		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => this.RunTransactionRequest(TransactionCallback, RequestOptions, CompleteRequest), Options, Callback);
	}

	EnsureLoaded(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => this.LoadSettingsIfNeeded(RequestOptions, CompleteRequest), Options, Callback);
	}

	EnsurePlayer(hSOCIHandle, strPlayerUniqueID, Options, Callback) {
		const RequestOptions = RequireSettingsRequestOptions(Options);
		RequireSettingsCallback(Callback);
		RequireSettingsSessionUsable(this, hSOCIHandle);

		const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
		EnsureSettingsPlayer(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, RequestOptions, Callback);
	}

	Reload(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => this.ReloadSettings(RequestOptions, CompleteRequest), Options, Callback);
	}

	Save(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
			this.LoadSettingsIfNeeded(RequestOptions, (LoadError, SettingsValues) => {
				if (LoadError !== null) {
					CompleteRequest(LoadError);
					return;
				}

				let vecSettingsPlayerEntries = [];

				try {
					vecSettingsPlayerEntries = CollectSettingsPlayerEntries(SettingsValues);
				} catch (ValidationError) {
					CompleteRequest(NormalizeSettingsRequestFailure(ValidationError));
					return;
				}

				const SaveSettingsDatabase = (hSOCIHandle, TransactionOptions, CompleteTransaction) => {
					const vecOperations = [
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strValueTable + " WHERE namespace = :namespace", { namespace: strSettingsNamespace }, TransactionOptions, CompleteOperation),
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strPlayerTable + " WHERE namespace = :namespace", { namespace: strSettingsNamespace }, TransactionOptions, CompleteOperation),
					];
					for (const PlayerEntry of vecSettingsPlayerEntries) {
						vecOperations.push((CompleteOperation) => EnsureSettingsPlayer(hSOCIHandle, strSettingsNamespace, PlayerEntry.PlayerUniqueID, TransactionOptions, CompleteOperation));

						for (const SettingEntry of PlayerEntry.SettingEntries) {
							vecOperations.push((CompleteOperation) => InsertEncodedSettingsValue(hSOCIHandle, strSettingsNamespace, PlayerEntry.PlayerUniqueID, SettingEntry.SettingName, SettingEntry.EncodedSettingsValue, TransactionOptions, CompleteOperation));
						}
					}

					RunSettingsOperations(vecOperations, CompleteTransaction);
				};
				this.RunTransactionRequest(SaveSettingsDatabase, RequestOptions, CompleteRequest);
			});
		}, Options, Callback);
	}

	GetPlayerValues(strPlayerUniqueID, Options, Callback) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => this.LoadPlayerValues(strRequiredPlayerUniqueID, RequestOptions, CompleteRequest), Options, Callback);
	}

	// The established API allocates a view that borrows this storage, without I/O.
	GetSettingsForPlayer(strPlayerUniqueID) {
		return new PlayerSettingsView(this, strPlayerUniqueID);
	}

	HasPlayer(strPlayerUniqueID, Options, Callback) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			this.LoadSettingsIfNeeded(RequestOptions, (LoadError, SettingsValues) => {
				if (LoadError !== null) {
					CompleteRequest(LoadError);
					return;
				}

				let bHasPlayer = false;

				try {
					bHasPlayer = Object.hasOwn(SettingsValues, strRequiredPlayerUniqueID);
				} catch (RecordError) {
					CompleteRequest(NormalizeSettingsRequestFailure(RecordError));
					return;
				}

				CompleteRequest(null, bHasPlayer);
			});
		}, Options, Callback);
	}

	GetSetting(strPlayerUniqueID, strSettingName, DefaultValue = null, Options, Callback) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		const strRequiredSettingName = RequireNonEmptyString(strSettingName, "Setting name");
		RequireSettingsCallback(Callback);

		this.GetPlayerValues(strRequiredPlayerUniqueID, Options, (LoadError, PlayerValues) => {
			if (LoadError !== null) {
				Callback(LoadError);
				return;
			}

			let SettingsValue = DefaultValue;

			try {
				if (Object.hasOwn(PlayerValues, strRequiredSettingName)) {
					SettingsValue = PlayerValues[strRequiredSettingName];
				}
			} catch (ValueReadError) {
				Callback(NormalizeSettingsRequestFailure(ValueReadError));
				return;
			}

			Callback(null, SettingsValue);
		});
	}

	SetSetting(strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		const strRequiredSettingName = RequireNonEmptyString(strSettingName, "Setting name");
		const EncodedSettingsValue = EncodeSettingsValue(SettingsValue);
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
			this.LoadPlayerValues(strRequiredPlayerUniqueID, RequestOptions, (LoadError, PlayerValues) => {
				if (LoadError !== null) {
					CompleteRequest(LoadError);
					return;
				}

				let ReplacementValues = null;

				try {
					ReplacementValues = CopySettingsValueRecord(PlayerValues, "Player settings values", "Setting name");
					DefineSettingsValueRecordEntry(ReplacementValues, { PropertyName: strRequiredSettingName, PropertyValue: SettingsValue }, "Replacement player settings could not define a setting value.");
				} catch (ValidationError) {
					CompleteRequest(NormalizeSettingsRequestFailure(ValidationError));
					return;
				}

				const UpdateSetting = (hSOCIHandle, TransactionOptions, CompleteTransaction) => {
					const Parameters = { name: strRequiredSettingName, namespace: strSettingsNamespace, uniqueid: strRequiredPlayerUniqueID };
					const vecOperations = [
						(CompleteOperation) => EnsureSettingsPlayer(hSOCIHandle, strSettingsNamespace, strRequiredPlayerUniqueID, TransactionOptions, CompleteOperation),
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strValueTable + " WHERE namespace = :namespace AND uniqueid = :uniqueid AND setting_name = :name", Parameters, TransactionOptions, CompleteOperation),
						(CompleteOperation) => InsertEncodedSettingsValue(hSOCIHandle, strSettingsNamespace, strRequiredPlayerUniqueID, strRequiredSettingName, EncodedSettingsValue, TransactionOptions, CompleteOperation),
					];
					RunSettingsOperations(vecOperations, CompleteTransaction);
				};
				InvokeSettingsRequest((CompleteMutation) => ReplaceSettingsValueRecordContentsInTransaction(this, PlayerValues, ReplacementValues, UpdateSetting, RequestOptions, CompleteMutation), CompleteRequest);
			});
		}, Options, Callback);
	}

	InsertValue(hSOCIHandle, strPlayerUniqueID, strSettingName, SettingsValue, Options, Callback) {
		const RequestOptions = RequireSettingsRequestOptions(Options);
		RequireSettingsCallback(Callback);
		RequireSettingsSessionUsable(this, hSOCIHandle);

		const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
		InsertSettingsValue(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, strSettingName, SettingsValue, RequestOptions, Callback);
	}

	DeleteSetting(strPlayerUniqueID, strSettingName, Options, Callback) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		const strRequiredSettingName = RequireNonEmptyString(strSettingName, "Setting name");
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
			this.LoadPlayerValues(strRequiredPlayerUniqueID, RequestOptions, (LoadError, PlayerValues) => {
				if (LoadError !== null) {
					CompleteRequest(LoadError);
					return;
				}

				let bHasSetting = false;
				let ReplacementValues = null;

				try {
					bHasSetting = Object.hasOwn(PlayerValues, strRequiredSettingName);
					if (bHasSetting) {
						ReplacementValues = CopySettingsValueRecord(PlayerValues, "Player settings values", "Setting name");
						RemoveSettingsValueRecordEntry(ReplacementValues, { PropertyName: strRequiredSettingName }, "Replacement player settings could not remove a setting value.");
					}
				} catch (ValidationError) {
					CompleteRequest(NormalizeSettingsRequestFailure(ValidationError));
					return;
				}

				if (!bHasSetting) {
					CompleteRequest(null, false);
					return;
				}

				const Parameters = { name: strRequiredSettingName, namespace: strSettingsNamespace, uniqueid: strRequiredPlayerUniqueID };
				const DeleteValue = (hSOCIHandle, TransactionOptions, CompleteTransaction) => {
					ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strValueTable + " WHERE namespace = :namespace AND uniqueid = :uniqueid AND setting_name = :name", Parameters, TransactionOptions, (DeleteError) => CompleteTransaction(DeleteError, DeleteError === null));
				};
				InvokeSettingsRequest((CompleteMutation) => ReplaceSettingsValueRecordContentsInTransaction(this, PlayerValues, ReplacementValues, DeleteValue, RequestOptions, CompleteMutation), CompleteRequest);
			});
		}, Options, Callback);
	}

	ClearPlayer(strPlayerUniqueID, Options, Callback) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
			this.LoadSettingsIfNeeded(RequestOptions, (LoadError, SettingsValues) => {
				if (LoadError !== null) {
					CompleteRequest(LoadError);
					return;
				}

				const DeletePlayer = (hSOCIHandle, TransactionOptions, CompleteTransaction) => {
					const Parameters = { namespace: strSettingsNamespace, uniqueid: strRequiredPlayerUniqueID };
					RunSettingsOperations([
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strValueTable + " WHERE namespace = :namespace AND uniqueid = :uniqueid", Parameters, TransactionOptions, CompleteOperation),
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strPlayerTable + " WHERE namespace = :namespace AND uniqueid = :uniqueid", Parameters, TransactionOptions, CompleteOperation),
					], CompleteTransaction);
				};

				let ReplacementValues = null;

				try {
					if (Object.hasOwn(SettingsValues, strRequiredPlayerUniqueID)) {
						ReplacementValues = CopySettingsValueRecord(SettingsValues, "Settings data", "Player unique ID");
						RemoveSettingsValueRecordEntry(ReplacementValues, { PropertyName: strRequiredPlayerUniqueID }, "Replacement settings data could not remove a player record.");
					}
				} catch (ValidationError) {
					CompleteRequest(NormalizeSettingsRequestFailure(ValidationError));
					return;
				}

				if (ReplacementValues === null) {
					this.RunTransactionRequest(DeletePlayer, RequestOptions, CompleteRequest);
					return;
				}

				InvokeSettingsRequest((CompleteMutation) => ReplaceSettingsValueRecordContentsInTransaction(this, SettingsValues, ReplacementValues, DeletePlayer, RequestOptions, CompleteMutation), CompleteRequest);
			});
		}, Options, Callback);
	}

	ClearSettings(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
			this.LoadSettingsIfNeeded(RequestOptions, (LoadError, SettingsValues) => {
				if (LoadError !== null) {
					CompleteRequest(LoadError);
					return;
				}

				const ClearDatabase = (hSOCIHandle, TransactionOptions, CompleteTransaction) => {
					RunSettingsOperations([
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strValueTable + " WHERE namespace = :namespace", { namespace: strSettingsNamespace }, TransactionOptions, CompleteOperation),
						(CompleteOperation) => ExecuteSettingsStatement(hSOCIHandle, "DELETE FROM " + g_strPlayerTable + " WHERE namespace = :namespace", { namespace: strSettingsNamespace }, TransactionOptions, CompleteOperation),
					], CompleteTransaction);
				};
				InvokeSettingsRequest((CompleteMutation) => ReplaceSettingsValueRecordContentsInTransaction(this, SettingsValues, CreateSettingsValueRecord(), ClearDatabase, RequestOptions, CompleteMutation), CompleteRequest);
			});
		}, Options, Callback);
	}

	GetAllSettings(Options, Callback) {
		this.EnsureLoaded(Options, Callback);
	}

	// Collection methods return snapshots; each player view still borrows this storage.
	Keys() {
		return Object.keys(this.GetCachedSettings());
	}

	Values() {
		const vecPlayerSettingsViews = [];
		const vecPlayerUniqueIDs = this.Keys();
		for (const strPlayerUniqueID of vecPlayerUniqueIDs) {
			vecPlayerSettingsViews.push(this.GetSettingsForPlayer(strPlayerUniqueID));
		}

		return vecPlayerSettingsViews;
	}

	Entries() {
		const vecPlayerSettingsEntries = [];
		const vecPlayerUniqueIDs = this.Keys();
		for (const strPlayerUniqueID of vecPlayerUniqueIDs) {
			vecPlayerSettingsEntries.push([strPlayerUniqueID, this.GetSettingsForPlayer(strPlayerUniqueID)]);
		}

		return vecPlayerSettingsEntries;
	}

	ForEach(SettingsCallback, CallbackReceiver = undefined) {
		if (typeof SettingsCallback !== "function") {
			throw new TypeError("SettingsCallback must be a function.");
		}

		const vecSettingsEntries = this.Entries();
		for (const vecSettingsEntry of vecSettingsEntries) {
			const strPlayerUniqueID = vecSettingsEntry[0];
			const PlayerView = vecSettingsEntry[1];
			Reflect.apply(SettingsCallback, CallbackReceiver, [PlayerView, strPlayerUniqueID, this]);
		}
	}

	OnLevelShutdown(Options, Callback) {
		this.Save(Options, Callback);
	}

	Close(Options, Callback) {
		QueueSettingsRequest(this, (RequestOptions, CompleteRequest) => {
			const hSOCIHandle = this.ValueHandle;
			if (hSOCIHandle === null) {
				CompleteRequest(null, false);
				return;
			}

			RequireSettingsSOCIHandle(hSOCIHandle);
			RunSettingsSOCIRequest((CompleteClose) => g_SOCIRuntime.Close(hSOCIHandle, RequestOptions, CompleteClose), (bClosed) => RequireSuccessfulSOCIResult(bClosed, "soci.Close()"), (CloseError) => {
				if (CloseError !== null) {
					CompleteRequest(CloseError);
					return;
				}

				this.ValueHandle = null;
				this.ValueLoaded = false;
				g_mapSettingsStorageRequests.get(this).SchemaReady = false;
				g_mapSettingsStorageRequests.get(this).TransactionFailed = false;
				CompleteRequest(null, true);
			});
		}, Options, Callback);
	}

	[Symbol.iterator]() {
		return this.Entries()[Symbol.iterator]();
	}

	GetCachedSettings() {
		if (this.ValueLoaded !== true) {
			throw new Error("SettingsStorage must be loaded before synchronous cache access; call EnsureLoaded(Options, Callback) first.");
		}

		return RequireSettingsValueRecord(this.ValueData, "Settings data");
	}

	GetCachedPlayerValues(strPlayerUniqueID) {
		const strRequiredPlayerUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
		const SettingsValues = this.GetCachedSettings();
		if (!Object.hasOwn(SettingsValues, strRequiredPlayerUniqueID)) {
			return null;
		}

		return RequireSettingsValueRecord(SettingsValues[strRequiredPlayerUniqueID], "Player settings values");
	}

	get Namespace() {
		return this.ValueNamespace;
	}

	get Options() {
		return this.ValueOptions;
	}

	get Path() {
		return this.ValuePath;
	}

	get Backend() {
		return this.ValueBackend;
	}

	get ConnectionString() {
		return this.ValueConnectionString;
	}

	get Handle() {
		return this.ValueHandle;
	}

	get Loaded() {
		return this.ValueLoaded;
	}

	get Data() {
		return this.ValueData;
	}

	// Session helpers run inside the per-storage request queue, not as independent requests.
	OpenSession(Options, Callback) {
		const RequestState = g_mapSettingsStorageRequests.get(this);
		if (RequestState.TransactionFailed) {
			Callback(new Error("A settings transaction rollback failed; close the storage before reusing its session."));
			return;
		}

		const CompleteSchema = (hSOCIHandle) => {
			if (RequestState.SchemaReady) {
				Callback(null, hSOCIHandle);
				return;
			}

			CreateSettingsSchema(hSOCIHandle, Options, (SchemaError) => {
				if (SchemaError === null) {
					RequestState.SchemaReady = true;
					Callback(null, hSOCIHandle);
					return;
				}

				RunSettingsSOCIRequest((CompleteClose) => g_SOCIRuntime.Close(hSOCIHandle, Options, CompleteClose), (bClosed) => RequireSuccessfulSOCIResult(bClosed, "soci.Close()"), (CloseError) => {
					if (CloseError !== null) {
						Callback(new AggregateError([SchemaError, CloseError], "Settings schema creation and SOCI handle cleanup failed."));
						return;
					}

					this.ValueHandle = null;
					Callback(SchemaError);
				});
			});
		};
		const hCurrentSOCIHandle = this.ValueHandle;
		if (hCurrentSOCIHandle !== null) {
			const hSOCIHandle = RequireSettingsSOCIHandle(hCurrentSOCIHandle);
			RunSettingsSOCIRequest((CompleteCheck) => g_SOCIRuntime.IsConnected(hSOCIHandle, Options, CompleteCheck), (bConnected) => RequireSOCIBooleanResult(bConnected, "soci.IsConnected()"), (ConnectionError, bConnected) => {
				if (ConnectionError !== null) {
					Callback(ConnectionError);
					return;
				}

				if (bConnected) {
					CompleteSchema(hSOCIHandle);
					return;
				}

				RunSettingsSOCIRequest((CompleteReconnect) => g_SOCIRuntime.Reconnect(hSOCIHandle, Options, CompleteReconnect), (bReconnected) => RequireSuccessfulSOCIResult(bReconnected, "soci.Reconnect()"), (ReconnectError) => {
					if (ReconnectError !== null) {
						Callback(ReconnectError);
						return;
					}

					RequestState.SchemaReady = false;
					CompleteSchema(hSOCIHandle);
				});
			});
			return;
		}

		const strSettingsRoot = RequireSettingsRoot();
		const bSettingsDirectoryCreated = g_SettingsRuntime.EnsureDirectoryExists(strSettingsRoot);
		if (typeof bSettingsDirectoryCreated !== "boolean") {
			throw new TypeError("settings.EnsureDirectoryExists() must return a boolean.");
		}

		if (!bSettingsDirectoryCreated) {
			throw new Error("Unable to create settings directory '" + strSettingsRoot + "'.");
		}

		const strSettingsBackend = RequireSettingsBackend(this.ValueBackend);
		const strSettingsConnectionString = RequireNonEmptyString(this.ValueConnectionString, "Settings ConnectionString");
		const ConnectSession = (CompleteConnect) => {
			if (strSettingsBackend === null) {
				g_SOCIRuntime.Connect(strSettingsConnectionString, Options, CompleteConnect);
				return;
			}

			g_SOCIRuntime.Connect(strSettingsConnectionString, strSettingsBackend, Options, CompleteConnect);
		};
		RunSettingsSOCIRequest(ConnectSession, RequireSettingsSOCIHandle, (ConnectionError, hSOCIHandle) => {
			if (ConnectionError !== null) {
				Callback(ConnectionError);
				return;
			}

			this.ValueHandle = hSOCIHandle;
			RequestState.SchemaReady = false;
			CompleteSchema(hSOCIHandle);
		});
	}

	RunTransactionRequest(TransactionCallback, Options, Callback) {
		InvokeSettingsRequest((CompleteOpen) => this.OpenSession(Options, CompleteOpen), (OpenError, hSOCIHandle) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			const RollbackTransaction = (TransactionError) => {
				RunSettingsSOCIRequest((CompleteRollback) => g_SOCIRuntime.Rollback(hSOCIHandle, Options, CompleteRollback), (bRolledBack) => RequireSuccessfulSOCIResult(bRolledBack, "soci.Rollback()"), (RollbackError) => {
					if (RollbackError !== null) {
						g_mapSettingsStorageRequests.get(this).TransactionFailed = true;
					}

					Callback((RollbackError === null) ? TransactionError : new AggregateError([TransactionError, RollbackError], "Settings transaction failed and rollback was unsuccessful."));
				});
			};
			RunSettingsSOCIRequest((CompleteBegin) => g_SOCIRuntime.Begin(hSOCIHandle, Options, CompleteBegin), (bBegan) => RequireSuccessfulSOCIResult(bBegan, "soci.Begin()"), (BeginError) => {
				if (BeginError !== null) {
					Callback(BeginError);
					return;
				}

				InvokeSettingsRequest((CompleteTransaction) => TransactionCallback(hSOCIHandle, Options, CompleteTransaction), (TransactionError, Result) => {
					if (TransactionError !== null) {
						RollbackTransaction(TransactionError);
						return;
					}

					RunSettingsSOCIRequest((CompleteCommit) => g_SOCIRuntime.Commit(hSOCIHandle, Options, CompleteCommit), (bCommitted) => RequireSuccessfulSOCIResult(bCommitted, "soci.Commit()"), (CommitError) => {
						if (CommitError !== null) {
							RollbackTransaction(CommitError);
							return;
						}

						Callback(null, Result);
					});
				});
			});
		});
	}

	LoadSettingsIfNeeded(Options, Callback) {
		if (typeof this.ValueLoaded !== "boolean") {
			throw new TypeError("Settings loaded state must be a boolean.");
		}

		if (!this.ValueLoaded) {
			this.ReloadSettings(Options, Callback);
			return;
		}

		Callback(null, RequireSettingsValueRecord(this.ValueData, "Settings data"));
	}

	ReloadSettings(Options, Callback) {
		const SettingsValues = RequireSettingsValueRecord(this.ValueData, "Settings data");
		const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
		const LoadedValues = CreateSettingsValueRecord();
		this.OpenSession(Options, (OpenError, hSOCIHandle) => {
			if (OpenError !== null) {
				Callback(OpenError);
				return;
			}

			const vecLoadOperations = [
				(CompleteOperation) => {
					QuerySettingsRecords(hSOCIHandle, "SELECT uniqueid FROM " + g_strPlayerTable + " WHERE namespace = :namespace", { namespace: strSettingsNamespace }, Options, (QueryError, vecPlayerRecords) => {
						if (QueryError !== null) {
							CompleteOperation(QueryError);
							return;
						}

						try {
							for (const PlayerRecord of vecPlayerRecords) {
								const strPlayerUniqueID = RequireNonEmptyString(RequireSOCIColumnValue(PlayerRecord, "uniqueid"), "Player unique ID");
								if (Object.hasOwn(LoadedValues, strPlayerUniqueID)) {
									throw new Error("Duplicate settings player '" + strPlayerUniqueID + "' returned by soci.Query().");
								}

								LoadedValues[strPlayerUniqueID] = CreateSettingsValueRecord();
							}
						} catch (DecodeError) {
							CompleteOperation(NormalizeSettingsRequestFailure(DecodeError));
							return;
						}

						CompleteOperation(null);
					});
				},
				(CompleteOperation) => {
					QuerySettingsRecords(hSOCIHandle, "SELECT uniqueid, setting_name, value_kind, value_text, value_number FROM " + g_strValueTable + " WHERE namespace = :namespace", { namespace: strSettingsNamespace }, Options, (QueryError, vecValueRecords) => {
						if (QueryError !== null) {
							CompleteOperation(QueryError);
							return;
						}

						try {
							for (const ValueRecord of vecValueRecords) {
								const strPlayerUniqueID = RequireNonEmptyString(RequireSOCIColumnValue(ValueRecord, "uniqueid"), "Player unique ID");
								const strSettingName = RequireNonEmptyString(RequireSOCIColumnValue(ValueRecord, "setting_name"), "Setting name");
								if (!Object.hasOwn(LoadedValues, strPlayerUniqueID)) {
									LoadedValues[strPlayerUniqueID] = CreateSettingsValueRecord();
								}

								const PlayerValues = LoadedValues[strPlayerUniqueID];
								if (Object.hasOwn(PlayerValues, strSettingName)) {
									throw new Error("Duplicate setting '" + strSettingName + "' returned for player '" + strPlayerUniqueID + "'.");
								}

								PlayerValues[strSettingName] = DecodeSettingsValue(ValueRecord);
							}
						} catch (DecodeError) {
							CompleteOperation(NormalizeSettingsRequestFailure(DecodeError));
							return;
						}

						CompleteOperation(null);
					});
				},
			];
			RunSettingsOperations(vecLoadOperations, (LoadError) => {
				if (LoadError !== null) {
					Callback(LoadError);
					return;
				}

				try {
					ReplaceSettingsValueRecordContents(SettingsValues, LoadedValues);
					this.ValueLoaded = true;
				} catch (RecordError) {
					Callback(NormalizeSettingsRequestFailure(RecordError));
					return;
				}

				Callback(null, SettingsValues);
			});
		});
	}

	LoadPlayerValues(strPlayerUniqueID, Options, Callback) {
		const strSettingsNamespace = RequireSettingsNamespace(this.ValueNamespace);
		this.LoadSettingsIfNeeded(Options, (LoadError, SettingsValues) => {
			if (LoadError !== null) {
				Callback(LoadError);
				return;
			}

			let ExistingPlayerValues = null;

			try {
				if (Object.hasOwn(SettingsValues, strPlayerUniqueID)) {
					ExistingPlayerValues = RequireSettingsValueRecord(SettingsValues[strPlayerUniqueID], "Player settings values");
				}
			} catch (RecordError) {
				Callback(NormalizeSettingsRequestFailure(RecordError));
				return;
			}

			if (ExistingPlayerValues !== null) {
				Callback(null, ExistingPlayerValues);
				return;
			}

			const PlayerValues = CreateSettingsValueRecord();
			let ReplacementValues = null;

			try {
				ReplacementValues = CopySettingsValueRecord(SettingsValues, "Settings data", "Player unique ID");
				DefineSettingsValueRecordEntry(ReplacementValues, { PropertyName: strPlayerUniqueID, PropertyValue: PlayerValues }, "Replacement settings data could not add a player record.");
			} catch (RecordError) {
				Callback(NormalizeSettingsRequestFailure(RecordError));
				return;
			}

			const EnsurePlayer = (hSOCIHandle, TransactionOptions, CompleteTransaction) => EnsureSettingsPlayer(hSOCIHandle, strSettingsNamespace, strPlayerUniqueID, TransactionOptions, CompleteTransaction);
			InvokeSettingsRequest((CompleteMutation) => ReplaceSettingsValueRecordContentsInTransaction(this, SettingsValues, ReplacementValues, EnsurePlayer, Options, CompleteMutation), (MutationError) => Callback(MutationError, (MutationError === null) ? PlayerValues : undefined));
		});
	}
}

SettingsStorage.Options = { Backend: "sqlite3", ConnectionString: null, DatabasePath: null };

function RequireSettingsStorage(Storage) {
	if (!(Storage instanceof SettingsStorage)) {
		throw new TypeError("SettingsStorage must be a SettingsStorage instance.");
	}

	return Storage;
}

class PlayerSettingsView {
	constructor(SettingsStorageReference, strPlayerUniqueID) {
		this.ValueStorage = RequireSettingsStorage(SettingsStorageReference);
		this.ValueUniqueID = RequireNonEmptyString(strPlayerUniqueID, "Player unique ID");
	}

	Values(Options, Callback) {
		this.ValueStorage.GetPlayerValues(this.ValueUniqueID, Options, Callback);
	}

	GetSetting(strSettingName, DefaultValue = null, Options, Callback) {
		this.ValueStorage.GetSetting(this.ValueUniqueID, strSettingName, DefaultValue, Options, Callback);
	}

	SetSetting(strSettingName, SettingsValue, Options, Callback) {
		this.ValueStorage.SetSetting(this.ValueUniqueID, strSettingName, SettingsValue, Options, Callback);
	}

	HasSetting(strSettingName, Options, Callback) {
		const strRequiredSettingName = RequireNonEmptyString(strSettingName, "Setting name");
		RequireSettingsCallback(Callback);

		this.Values(Options, (LoadError, PlayerValues) => {
			if (LoadError !== null) {
				Callback(LoadError);
				return;
			}

			let bHasSetting = false;

			try {
				bHasSetting = Object.hasOwn(PlayerValues, strRequiredSettingName);
			} catch (RecordError) {
				Callback(NormalizeSettingsRequestFailure(RecordError));
				return;
			}

			Callback(null, bHasSetting);
		});
	}

	DeleteSetting(strSettingName, Options, Callback) {
		this.ValueStorage.DeleteSetting(this.ValueUniqueID, strSettingName, Options, Callback);
	}

	ClearSettings(Options, Callback) {
		this.ValueStorage.ClearPlayer(this.ValueUniqueID, Options, Callback);
	}

	Keys() {
		const PlayerValues = this.GetCachedValues();

		return (PlayerValues === null) ? [] : Object.keys(PlayerValues);
	}

	Entries() {
		const PlayerValues = this.GetCachedValues();

		return (PlayerValues === null) ? [] : Object.entries(PlayerValues);
	}

	ForEach(SettingsCallback, CallbackReceiver = undefined) {
		if (typeof SettingsCallback !== "function") {
			throw new TypeError("SettingsCallback must be a function.");
		}

		const vecSettingEntries = this.Entries();
		for (const vecSettingEntry of vecSettingEntries) {
			const strSettingName = vecSettingEntry[0];
			const SettingsValue = vecSettingEntry[1];
			Reflect.apply(SettingsCallback, CallbackReceiver, [SettingsValue, strSettingName, this]);
		}
	}

	GetCachedValues() {
		const Storage = RequireSettingsStorage(this.ValueStorage);
		const strPlayerUniqueID = RequireNonEmptyString(this.ValueUniqueID, "Player unique ID");

		return Storage.GetCachedPlayerValues(strPlayerUniqueID);
	}

	[Symbol.iterator]() {
		return this.Entries()[Symbol.iterator]();
	}

	get Size() {
		const PlayerValues = this.GetCachedValues();
		if (PlayerValues === null) {
			return 0;
		}

		let unSettingCount = 0;
		for (const strSettingName in PlayerValues) {
			if (Object.hasOwn(PlayerValues, strSettingName)) {
				unSettingCount++;
			}
		}

		return unSettingCount;
	}

	get UniqueID() {
		return this.ValueUniqueID;
	}

	get Storage() {
		return this.ValueStorage;
	}
}

const g_DefaultStorage = new SettingsStorage();

function CreateStorage(strSettingsNamespace = "players", StorageOptions = {}) {
	return new SettingsStorage(strSettingsNamespace, StorageOptions);
}

module.exports = {
	DEFAULT_STORAGE: g_DefaultStorage,
	get ROOT() {
		return RequireSettingsRoot();
	},

	set ROOT(strSettingsRoot) {
		g_SettingsRuntime.Root = RequireNonEmptyString(strSettingsRoot, "Settings root");
	},

	PlayerSettingsView,
	SettingsStorage,
	CreateStorage,
};
