"use strict";

const { GetModule } = require("internal/runtime");
const { DEFAULT_STORAGE } = require("settings/storage");

const g_MissingValue = Symbol("missing setting value");
const g_mapRegisteredSettings = new Map();
const g_PlayersModule = GetModule("players");

function IsObjectRecord(CandidateValue) {
	return (CandidateValue !== null) && (typeof CandidateValue === "object") && !Array.isArray(CandidateValue);
}

function IsSettingStorage(SettingStorage) {
	return IsObjectRecord(SettingStorage) && (typeof SettingStorage.GetSetting === "function") && (typeof SettingStorage.SetSetting === "function") && (typeof SettingStorage.DeleteSetting === "function");
}

function NormalizeSettingName(strSettingName) {
	if ((typeof strSettingName !== "string") || (strSettingName.length === 0)) {
		throw new TypeError("Setting name must be a non-empty string.");
	}

	const strSettingNameCharacters = strSettingName.replace(/[_ ]/g, "");
	if (!/^[A-Za-z]+$/.test(strSettingNameCharacters)) {
		throw new TypeError(`Given setting name "${strSettingName}" is not valid.`);
	}

	return strSettingName;
}

function CreateSettingToken(strSettingName) {
	const vecSettingWords = NormalizeSettingName(strSettingName).split(/[ _]+/);
	let strSettingToken = "";
	for (const strSettingWord of vecSettingWords) {
		if (strSettingWord.length === 0) {
			continue;
		}

		strSettingToken += strSettingWord[0].toUpperCase() + strSettingWord.slice(1);
	}

	return strSettingToken;
}

function ResolvePlayerUniqueID(PlayerReference) {
	if ((typeof PlayerReference === "string") && (PlayerReference.length > 0)) {
		return PlayerReference;
	}

	if ((typeof PlayerReference === "number") || (PlayerReference && (typeof PlayerReference === "object") && Number.isSafeInteger(PlayerReference.Index))) {
		return g_PlayersModule.GetNetworkID(PlayerReference);
	}

	throw new TypeError("PlayerReference must be a unique ID string, player index, or native player object.");
}

function RequireSettingOptions(SettingOptions) {
	if (!IsObjectRecord(SettingOptions)) {
		throw new TypeError("Setting options must be an object.");
	}

	return SettingOptions;
}

function RequireSettingRequest(Options, Callback) {
	if (!IsObjectRecord(Options)) {
		throw new TypeError("Setting requests require an Options object.");
	}

	const bBlocking = Options.Blocking;
	if ((bBlocking !== undefined) && (typeof bBlocking !== "boolean")) {
		throw new TypeError("Setting Options.Blocking must be a boolean.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Setting requests require a Callback function.");
	}

	return { Blocking: bBlocking === true };
}

function ResolveSettingOption(SettingOptions, strSettingOptionName, DefaultSettingOptionValue) {
	const SettingOptionValue = SettingOptions[strSettingOptionName];
	if ((SettingOptionValue === null) || (SettingOptionValue === undefined)) {
		return DefaultSettingOptionValue;
	}

	return SettingOptionValue;
}

function RequireNumberOrNull(dblNumberValue, strNumberValueName, bRequireInteger = false) {
	if ((dblNumberValue === null) || (dblNumberValue === undefined)) {
		return null;
	}

	if ((typeof dblNumberValue !== "number") || !Number.isFinite(dblNumberValue) || (bRequireInteger && !Number.isInteger(dblNumberValue))) {
		throw new TypeError(`${strNumberValueName} must be ${bRequireInteger ? "an integer" : "a finite number"} or null.`);
	}

	return dblNumberValue;
}

function IsStringValue(CandidateValue) {
	return typeof CandidateValue === "string";
}

function IsBooleanValue(CandidateValue) {
	return typeof CandidateValue === "boolean";
}

function RequireTypedValue(CandidateValue, strExpectedValueDescription, ValuePredicate, strCandidateValueDescription) {
	if (!ValuePredicate(CandidateValue)) {
		const strActualValueType = (CandidateValue === null) ? "null" : typeof CandidateValue;
		throw new TypeError(`Given ${strCandidateValueDescription} must be ${strExpectedValueDescription}; received ${strActualValueType}.`);
	}

	return CandidateValue;
}

class SettingsType {
	constructor(strSettingName, DefaultValue = null, SettingOptions = {}) {
		const RequiredSettingOptions = RequireSettingOptions(SettingOptions);

		this.ValueName = NormalizeSettingName(strSettingName);
		this.ValueDefaultValue = DefaultValue;
		this.ValueText = ResolveSettingOption(RequiredSettingOptions, "Text", null);
		this.ValueDescription = ResolveSettingOption(RequiredSettingOptions, "Description", "");
		this.ValuePrefix = ResolveSettingOption(RequiredSettingOptions, "Prefix", "");
		this.ValueStorage = ResolveSettingOption(RequiredSettingOptions, "Storage", DEFAULT_STORAGE);
		this.ValueValidator = ResolveSettingOption(RequiredSettingOptions, "Validator", null);

		if ((typeof this.ValueDescription !== "string") || (typeof this.ValuePrefix !== "string") || ((this.ValueText !== null) && (typeof this.ValueText !== "string")) || ((this.ValueValidator !== null) && (typeof this.ValueValidator !== "function"))) {
			throw new TypeError("Setting text, description, prefix, and validator options have invalid types.");
		}

		if (!IsSettingStorage(this.ValueStorage)) {
			throw new TypeError("Setting storage must provide GetSetting(), SetSetting(), and DeleteSetting() methods.");
		}

		if ((this.ValueValidator !== null) && !this.ValueValidator(this.ValueDefaultValue)) {
			throw new TypeError(`Default value is invalid for setting ${this.ValueName}.`);
		}
	}

	Coerce(SettingsValue) {
		return SettingsValue;
	}

	IsValid(SettingsValue) {
		return (this.ValueValidator === null) || this.ValueValidator(SettingsValue);
	}

	GetDefaultValue() {
		return this.Coerce(this.ValueDefaultValue);
	}

	Get(PlayerReference, Options, Callback) {
		const RequestOptions = RequireSettingRequest(Options, Callback);
		const strPlayerUniqueID = ResolvePlayerUniqueID(PlayerReference);
		this.ValueStorage.GetSetting(strPlayerUniqueID, this.ConVar, g_MissingValue, RequestOptions, (RequestError, StoredSettingsValue) => {
			if (RequestError !== null) {
				Callback(RequestError, null);
				return;
			}

			let SettingsError = null;
			let SettingsValue = null;

			try {
				if (StoredSettingsValue === g_MissingValue) {
					SettingsValue = this.GetDefaultValue();

				} else {
					const CoercedSettingsValue = this.Coerce(StoredSettingsValue);
					SettingsValue = this.IsValid(CoercedSettingsValue) ? CoercedSettingsValue : this.GetDefaultValue();
				}
			} catch (ValidationError) {
				SettingsError = (ValidationError === null) ? new Error("Setting validation threw null.", { cause: ValidationError }) : ValidationError;
			}

			// Validation errors complete the request; callback errors belong to the caller.
			Callback(SettingsError, SettingsValue);
		});
	}

	Set(PlayerReference, SettingsValue, Options, Callback) {
		const RequestOptions = RequireSettingRequest(Options, Callback);
		const CoercedSettingsValue = this.Coerce(SettingsValue);
		if (!this.IsValid(CoercedSettingsValue)) {
			throw new TypeError(`Invalid value for setting ${this.ValueName}.`);
		}

		this.ValueStorage.SetSetting(ResolvePlayerUniqueID(PlayerReference), this.ConVar, CoercedSettingsValue, RequestOptions, Callback);
	}

	Delete(PlayerReference, Options, Callback) {
		const RequestOptions = RequireSettingRequest(Options, Callback);
		this.ValueStorage.DeleteSetting(ResolvePlayerUniqueID(PlayerReference), this.ConVar, RequestOptions, Callback);
	}

	get Name() {
		return this.ValueName;
	}

	set Name(strName) {
		this.ValueName = strName;
	}

	get DefaultValue() {
		return this.ValueDefaultValue;
	}

	get Text() {
		return this.ValueText;
	}

	set Text(strText) {
		this.ValueText = strText;
	}

	get Description() {
		return this.ValueDescription;
	}

	set Description(strDescription) {
		this.ValueDescription = strDescription;
	}

	get Prefix() {
		return this.ValuePrefix;
	}

	set Prefix(strPrefix) {
		this.ValuePrefix = strPrefix;
	}

	get Storage() {
		return this.ValueStorage;
	}

	get Validator() {
		return this.ValueValidator;
	}

	get ConVar() {
		return `${this.ValuePrefix}${CreateSettingToken(this.ValueName)}`;
	}
}

class StringSetting extends SettingsType {
	constructor(strSettingName, strDefaultValue = "", SettingOptions = {}) {
		const RequiredSettingOptions = RequireSettingOptions(SettingOptions);
		const vecSettingChoices = (RequiredSettingOptions.Choices === undefined) ? [] : RequiredSettingOptions.Choices;
		super(strSettingName, RequireTypedValue(strDefaultValue, "a string", IsStringValue, "default value"), RequiredSettingOptions);

		this.ValueOptions = new Map();

		if (!Array.isArray(vecSettingChoices)) {
			throw new TypeError("StringSetting choices must be an array.");
		}

		for (const strSettingChoice of vecSettingChoices) {
			this.AddOption(strSettingChoice);
		}

		if (!this.IsValid(this.DefaultValue)) {
			throw new TypeError(`Default value is not a valid option for setting ${this.Name}.`);
		}
	}

	Coerce(strSettingsValue) {
		return RequireTypedValue(strSettingsValue, "a string", IsStringValue, "setting value");
	}

	AddOption(strSettingOptionName, strSettingOptionText = null) {
		const strSettingOptionKey = NormalizeSettingName(strSettingOptionName);

		if ((strSettingOptionText !== null) && (typeof strSettingOptionText !== "string")) {
			throw new TypeError("StringSetting option text must be a string or null.");
		}

		if (this.ValueOptions.has(strSettingOptionKey)) {
			throw new Error(`Given setting option name "${strSettingOptionKey}" is already registered.`);
		}

		const SettingOption = { Name: strSettingOptionKey, Text: (strSettingOptionText === null) ? strSettingOptionKey : strSettingOptionText, Value: strSettingOptionKey };
		this.ValueOptions.set(strSettingOptionKey, SettingOption);

		return SettingOption;
	}

	RemoveOption(strSettingOptionName) {
		const strSettingOptionKey = NormalizeSettingName(strSettingOptionName);
		if (!this.ValueOptions.has(strSettingOptionKey)) {
			throw new Error(`Given setting option name "${strSettingOptionKey}" is not registered.`);
		}

		this.ValueOptions.delete(strSettingOptionKey);

		return true;
	}

	IsValid(strSettingsValue) {
		const strCoercedStringValue = this.Coerce(strSettingsValue);
		if ((this.ValueOptions.size > 0) && !this.ValueOptions.has(strCoercedStringValue)) {
			return false;
		}

		return super.IsValid(strCoercedStringValue);
	}

	get Options() {
		return this.ValueOptions;
	}

	// The established property returns a new array of the current option names.
	get Choices() {
		const vecSettingChoices = [];
		for (const strSettingOptionName of this.ValueOptions.keys()) {
			vecSettingChoices.push(strSettingOptionName);
		}

		return vecSettingChoices;
	}
}

class IntegerSetting extends SettingsType {
	constructor(strSettingName, nDefaultValue = 0, SettingOptions = {}) {
		const RequiredSettingOptions = RequireSettingOptions(SettingOptions);
		const IsIntegerValue = (CandidateValue) => Number.isInteger(CandidateValue);
		super(strSettingName, RequireTypedValue(nDefaultValue, "an integer", IsIntegerValue, "default value"), RequiredSettingOptions);

		this.ValueMinimum = RequireNumberOrNull(RequiredSettingOptions.Minimum, "Minimum", true);
		this.ValueMaximum = RequireNumberOrNull(RequiredSettingOptions.Maximum, "Maximum", true);

		if ((this.ValueMinimum !== null) && (this.ValueMaximum !== null) && (this.ValueMinimum >= this.ValueMaximum)) {
			throw new RangeError(`Minimum (${this.ValueMinimum}) must be less than maximum (${this.ValueMaximum}).`);
		}

		if (!this.IsValid(this.DefaultValue)) {
			throw new RangeError(`Default value is outside the bounds for setting ${this.Name}.`);
		}
	}

	Coerce(nSettingsValue) {
		if ((typeof nSettingsValue !== "number") || !Number.isInteger(nSettingsValue)) {
			throw new TypeError(`Invalid integer setting value: ${nSettingsValue}.`);
		}

		return nSettingsValue;
	}

	IsValid(nSettingsValue) {
		const nCoercedIntegerValue = this.Coerce(nSettingsValue);
		if ((this.ValueMinimum !== null) && (nCoercedIntegerValue < this.ValueMinimum)) {
			return false;
		}

		if ((this.ValueMaximum !== null) && (nCoercedIntegerValue > this.ValueMaximum)) {
			return false;
		}

		return super.IsValid(nCoercedIntegerValue);
	}

	get Minimum() {
		return this.ValueMinimum;
	}

	get Maximum() {
		return this.ValueMaximum;
	}
}

class FloatSetting extends SettingsType {
	constructor(strSettingName, dblDefaultValue = 0, SettingOptions = {}) {
		const RequiredSettingOptions = RequireSettingOptions(SettingOptions);
		const IsFiniteNumber = (CandidateValue) => Number.isFinite(CandidateValue);
		super(strSettingName, RequireTypedValue(dblDefaultValue, "a finite number", IsFiniteNumber, "default value"), RequiredSettingOptions);

		this.ValueMinimum = RequireNumberOrNull(RequiredSettingOptions.Minimum, "Minimum");
		this.ValueMaximum = RequireNumberOrNull(RequiredSettingOptions.Maximum, "Maximum");

		if ((this.ValueMinimum !== null) && (this.ValueMaximum !== null) && (this.ValueMinimum >= this.ValueMaximum)) {
			throw new RangeError(`Minimum (${this.ValueMinimum}) must be less than maximum (${this.ValueMaximum}).`);
		}

		if (!this.IsValid(this.DefaultValue)) {
			throw new RangeError(`Default value is outside the bounds for setting ${this.Name}.`);
		}
	}

	Coerce(dblSettingsValue) {
		if ((typeof dblSettingsValue !== "number") || !Number.isFinite(dblSettingsValue)) {
			throw new TypeError(`Invalid float setting value: ${dblSettingsValue}.`);
		}

		return dblSettingsValue;
	}

	IsValid(dblSettingsValue) {
		const dblCoercedFloatValue = this.Coerce(dblSettingsValue);
		if ((this.ValueMinimum !== null) && (dblCoercedFloatValue < this.ValueMinimum)) {
			return false;
		}

		if ((this.ValueMaximum !== null) && (dblCoercedFloatValue > this.ValueMaximum)) {
			return false;
		}

		return super.IsValid(dblCoercedFloatValue);
	}

	get Minimum() {
		return this.ValueMinimum;
	}

	get Maximum() {
		return this.ValueMaximum;
	}
}

class BooleanSetting extends SettingsType {
	constructor(strSettingName, bDefaultValue = false, SettingOptions = {}) {
		super(strSettingName, RequireTypedValue(bDefaultValue, "a boolean", IsBooleanValue, "default value"), SettingOptions);
	}

	Coerce(bSettingsValue) {
		return RequireTypedValue(bSettingsValue, "a boolean", IsBooleanValue, "setting value");
	}
}

class ChoiceSetting extends StringSetting {
	constructor(strSettingName, strDefaultValue, SettingOptions = {}) {
		const RequiredSettingOptions = RequireSettingOptions(SettingOptions);
		const vecSettingChoices = RequiredSettingOptions.Choices;
		if (!Array.isArray(vecSettingChoices) || (vecSettingChoices.length === 0)) {
			throw new TypeError("ChoiceSetting requires a non-empty choices array.");
		}

		super(strSettingName, strDefaultValue, RequiredSettingOptions);
	}
}

function RegisterSetting(SettingDefinition) {
	if (!(SettingDefinition instanceof SettingsType)) {
		throw new TypeError("Setting definition must be a SettingsType instance.");
	}

	const strRegisteredSettingName = NormalizeSettingName(SettingDefinition.Name);
	if (g_mapRegisteredSettings.has(strRegisteredSettingName)) {
		throw new Error(`Setting "${strRegisteredSettingName}" is already registered.`);
	}

	g_mapRegisteredSettings.set(strRegisteredSettingName, SettingDefinition);

	return SettingDefinition;
}

function UnregisterSetting(strSettingName) {
	return g_mapRegisteredSettings.delete(NormalizeSettingName(strSettingName));
}

function GetSetting(strSettingName) {
	const SettingDefinition = g_mapRegisteredSettings.get(NormalizeSettingName(strSettingName));
	if (SettingDefinition === undefined) {
		return null;
	}

	return SettingDefinition;
}

function ListSettings() {
	const vecSettingDefinitions = [];
	for (const SettingDefinition of g_mapRegisteredSettings.values()) {
		vecSettingDefinitions.push(SettingDefinition);
	}

	return vecSettingDefinitions;
}

const g_SettingsTypesAPI = {
	BooleanSetting,
	ChoiceSetting,
	FloatSetting,
	IntegerSetting,
	REGISTERED_SETTINGS: g_mapRegisteredSettings,
	RegisterSetting,
	SettingsType,
	StringSetting,
	GetSetting,
	ListSettings,
	UnregisterSetting,
};

module.exports = g_SettingsTypesAPI;
