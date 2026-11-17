"use strict";

const { GetModule } = require("internal/runtime");

const g_vecRecipientOptionNames = Object.freeze([
	"ClearRecipients",
	"IncludeBots",
	"InitializationMessage",
	"Reliable",
]);

const g_NativeRecipients = GetModule("filters/recipients");

function RequireRecipientIndex(RecipientValue) {
	if (typeof RecipientValue === "number") {
		if (Number.isSafeInteger(RecipientValue) && (RecipientValue > 0)) {
			return RecipientValue;
		}
	} else if ((typeof RecipientValue === "object") && (RecipientValue !== null) && Object.hasOwn(RecipientValue, "Index")) {
		const unRecipientIndex = RecipientValue.Index;
		if (Number.isSafeInteger(unRecipientIndex) && (unRecipientIndex > 0)) {
			return unRecipientIndex;
		}
	}

	throw new TypeError("Recipient value must be a positive safe integer index or an object with an own positive safe integer Index property.");
}

function IsRecipientOptions(OptionsCandidate) {
	if ((typeof OptionsCandidate !== "object") || (OptionsCandidate === null) || Array.isArray(OptionsCandidate)) {
		return false;
	}

	const OptionsPrototype = Object.getPrototypeOf(OptionsCandidate);
	if ((OptionsPrototype !== null) && (OptionsPrototype !== Object.prototype)) {
		return false;
	}

	return !Object.hasOwn(OptionsCandidate, "Index") && !Object.hasOwn(OptionsCandidate, "RecipientIndexes") && !Object.hasOwn(OptionsCandidate, Symbol.iterator);
}

function CopyRecipientOptions(RecipientOptionsSource, strOperationName) {
	const CopiedRecipientOptions = Object.create(null);
	for (const OptionKey of Reflect.ownKeys(RecipientOptionsSource)) {
		if ((typeof OptionKey !== "string") || !g_vecRecipientOptionNames.includes(OptionKey)) {
			const strOptionDisplayName = (typeof OptionKey === "symbol") ? OptionKey.toString() : OptionKey;
			throw new TypeError(`${strOperationName} received an unknown option: ${strOptionDisplayName}`);
		}

		const bOptionValue = RecipientOptionsSource[OptionKey];
		if (typeof bOptionValue !== "boolean") {
			throw new TypeError(`Recipient option ${OptionKey} must be a boolean.`);
		}

		CopiedRecipientOptions[OptionKey] = bOptionValue;
	}

	return CopiedRecipientOptions;
}

function RequireRecipientOptions(RecipientOptions, strOperationName) {
	if (!IsRecipientOptions(RecipientOptions)) {
		throw new TypeError(`${strOperationName} options must be a plain or null-prototype object.`);
	}

	return CopyRecipientOptions(RecipientOptions, strOperationName);
}

function ReadBooleanOption(OptionSource, strOptionName, bDefaultValue) {
	if (!Object.hasOwn(OptionSource, strOptionName)) {
		return bDefaultValue;
	}

	const bOptionValue = OptionSource[strOptionName];
	if (typeof bOptionValue !== "boolean") {
		throw new TypeError(`Recipient option ${strOptionName} must be a boolean.`);
	}

	return bOptionValue;
}

function RequireRecipientFilterIndexes(RecipientFilterInformation, strErrorMessage) {
	if ((RecipientFilterInformation === null) || (RecipientFilterInformation === undefined) || (typeof RecipientFilterInformation !== "object")) {
		throw new TypeError(strErrorMessage);
	}

	const vecRecipientIndexes = RecipientFilterInformation.RecipientIndexes;
	if (!Array.isArray(vecRecipientIndexes)) {
		throw new TypeError(strErrorMessage);
	}

	return vecRecipientIndexes;
}

function RequireBoolean(bBooleanValue, strValueName) {
	if (typeof bBooleanValue !== "boolean") {
		throw new TypeError(`${strValueName} must be a boolean.`);
	}

	return bBooleanValue;
}

function ReadRecipientOptions(vecRecipientValues, DefaultRecipientOptions) {
	const RecipientOptions = { ...DefaultRecipientOptions };
	const LastRecipientValue = vecRecipientValues[vecRecipientValues.length - 1];
	if (IsRecipientOptions(LastRecipientValue)) {
		vecRecipientValues.pop();
		Object.assign(RecipientOptions, CopyRecipientOptions(LastRecipientValue, "RecipientFilter"));
	}

	return RecipientOptions;
}

function ExpandRecipientValues(RecipientValue) {
	if ((RecipientValue === null) || (RecipientValue === undefined)) {
		return [];
	}

	if (Array.isArray(RecipientValue)) {
		return RecipientValue.slice();
	}

	if (typeof RecipientValue === "object") {
		const vecRecipientIndexes = RecipientValue.RecipientIndexes;
		if (Array.isArray(vecRecipientIndexes)) {
			return vecRecipientIndexes.slice();
		}

		const RecipientIterator = RecipientValue[Symbol.iterator];
		if (typeof RecipientIterator === "function") {
			const GetRecipientValuesIterator = () => RecipientIterator.call(RecipientValue);
			return Array.from({ [Symbol.iterator]: GetRecipientValuesIterator });
		}
	}

	return [RecipientValue];
}

function NormalizeRecipientIndexes(vecRecipientValues, bIncludeBots) {
	const bValidatedIncludeBots = RequireBoolean(bIncludeBots, "NormalizeRecipientIndexes bIncludeBots");
	const vecExpandedRecipientIndexes = [];
	for (const RecipientValue of vecRecipientValues) {
		for (const NestedRecipientValue of ExpandRecipientValues(RecipientValue)) {
			vecExpandedRecipientIndexes.push(RequireRecipientIndex(NestedRecipientValue));
		}
	}

	if (vecExpandedRecipientIndexes.length === 0) {
		return [];
	}

	const NativeFilterInformation = g_NativeRecipients.CreateRecipientFilterFromValues(vecExpandedRecipientIndexes, bValidatedIncludeBots);
	const vecNativeRecipientIndexes = RequireRecipientFilterIndexes(NativeFilterInformation, "filters/recipients.CreateRecipientFilterFromValues returned an invalid recipient filter.");

	return vecNativeRecipientIndexes.map(RequireRecipientIndex);
}

function AppendUniqueRecipientIndex(vecRecipientIndexes, unRecipientIndex) {
	if (!vecRecipientIndexes.includes(unRecipientIndex)) {
		vecRecipientIndexes.push(unRecipientIndex);
	}
}

function ContainsRecipient(RecipientFilter, RecipientValue) {
	return g_NativeRecipients.ContainsRecipient(RecipientFilter, RequireRecipientIndex(RecipientValue));
}

function ResolveRecipientPlayers(RecipientFilter) {
	return g_NativeRecipients.ResolveRecipientPlayers(RecipientFilter);
}

class BaseRecipientFilter {
	constructor(RecipientValues = [], RecipientOptions = {}) {
		const ValidatedRecipientOptions = RequireRecipientOptions(RecipientOptions, "BaseRecipientFilter");
		this.RecipientSourceFilters = [];
		this.IncludeBots = ReadBooleanOption(ValidatedRecipientOptions, "IncludeBots", true);
		this.RecipientIndexes = [];
		this.Reliable = ReadBooleanOption(ValidatedRecipientOptions, "Reliable", false);
		this.InitializationMessage = ReadBooleanOption(ValidatedRecipientOptions, "InitializationMessage", false);

		if ((RecipientValues !== null) && (RecipientValues !== undefined)) {
			this.MergeRecipients(RecipientValues, true);
		}
	}

	static CreateRecipientFilterFromNativeInfo(NativeRecipientFilterInformation) {
		const strErrorMessage = `${this.name}.CreateRecipientFilterFromNativeInfo expects an object with a RecipientIndexes array.`;
		const vecNativeRecipientIndexes = RequireRecipientFilterIndexes(NativeRecipientFilterInformation, strErrorMessage);

		return new this(vecNativeRecipientIndexes, { InitializationMessage: ReadBooleanOption(NativeRecipientFilterInformation, "InitializationMessage", false), Reliable: ReadBooleanOption(NativeRecipientFilterInformation, "Reliable", false) });
	}

	ClearRecipients() {
		this.RecipientIndexes.length = 0;

		return this;
	}

	At(nRecipientPosition) {
		return this.RecipientIndexes.at(nRecipientPosition) ?? null;
	}

	Slice(nStartPosition = 0, nEndPosition = undefined) {
		return this.RecipientIndexes.slice(nStartPosition, nEndPosition);
	}

	IsRecipientFilterReliable() {
		return RequireBoolean(this.Reliable, "BaseRecipientFilter.Reliable");
	}

	IsRecipientFilterInitializationMessage() {
		return RequireBoolean(this.InitializationMessage, "BaseRecipientFilter.InitializationMessage");
	}

	GetRecipientIndex(nRecipientPosition) {
		const unRecipientIndex = this.RecipientIndexes.at(nRecipientPosition);

		return (unRecipientIndex === undefined) ? 0 : RequireRecipientIndex(unRecipientIndex);
	}

	AddRecipients(RecipientValue, bIncludeBots = this.IncludeBots) {
		for (const unRecipientIndex of NormalizeRecipientIndexes([RecipientValue], bIncludeBots)) {
			AppendUniqueRecipientIndex(this.RecipientIndexes, unRecipientIndex);
		}

		return this;
	}

	RemoveRecipients(RecipientValues) {
		const setRecipientIndexesToRemove = new Set(ExpandRecipientValues(RecipientValues).map(RequireRecipientIndex));
		for (let nRecipientPosition = this.RecipientIndexes.length - 1; nRecipientPosition >= 0; --nRecipientPosition) {
			if (setRecipientIndexesToRemove.has(this.RecipientIndexes[nRecipientPosition])) {
				this.RecipientIndexes.splice(nRecipientPosition, 1);
			}
		}

		return this;
	}

	AddAllPlayerRecipients(bIncludeBots = this.IncludeBots) {
		const bValidatedIncludeBots = RequireBoolean(bIncludeBots, "BaseRecipientFilter.AddAllPlayerRecipients bIncludeBots");
		const strNativeRecipientOperationName = bValidatedIncludeBots ? "GetAllRecipients" : "GetHumanRecipients";
		const NativeRecipientFilterInformation = bValidatedIncludeBots ? g_NativeRecipients.GetAllRecipients() : g_NativeRecipients.GetHumanRecipients();
		const vecNativeRecipientIndexes = RequireRecipientFilterIndexes(NativeRecipientFilterInformation, `filters/recipients.${strNativeRecipientOperationName} returned an invalid recipient filter.`);

		return this.MergeRecipients(vecNativeRecipientIndexes, true);
	}

	RemoveAllPlayerRecipients() {
		return this.ClearRecipients();
	}

	AddRecipient(RecipientValue) {
		return this.AddRecipients(RecipientValue, true);
	}

	RemoveRecipient(RecipientValue) {
		return this.RemoveRecipients(RecipientValue);
	}

	HasRecipient(RecipientValue) {
		return this.ContainsRecipient(RecipientValue);
	}

	ContainsRecipient(RecipientValue) {
		return ContainsRecipient(this, RecipientValue);
	}

	MergeRecipients(RecipientValues, bIncludeBots = this.IncludeBots) {
		for (const unRecipientIndex of NormalizeRecipientIndexes([RecipientValues], bIncludeBots)) {
			AppendUniqueRecipientIndex(this.RecipientIndexes, unRecipientIndex);
		}

		return this;
	}

	UpdateRecipients(...vecRecipientSources) {
		const RecipientOptions = ReadRecipientOptions(vecRecipientSources, { ClearRecipients: true, IncludeBots: this.IncludeBots });
		const bIncludeBots = RequireBoolean(RecipientOptions.IncludeBots, "BaseRecipientFilter.UpdateRecipients IncludeBots");
		const vecResolvedRecipientIndexes = [];
		const vecSources = (vecRecipientSources.length > 0) ? vecRecipientSources : this.RecipientSourceFilters;

		if (vecSources.length === 0) {
			const strNativeRecipientOperationName = bIncludeBots ? "GetAllRecipients" : "GetHumanRecipients";
			const NativeRecipientFilterInformation = bIncludeBots ? g_NativeRecipients.GetAllRecipients() : g_NativeRecipients.GetHumanRecipients();
			const vecNativeRecipientIndexes = RequireRecipientFilterIndexes(NativeRecipientFilterInformation, `filters/recipients.${strNativeRecipientOperationName} returned an invalid recipient filter.`);

			for (const unRecipientIndex of vecNativeRecipientIndexes) {
				AppendUniqueRecipientIndex(vecResolvedRecipientIndexes, RequireRecipientIndex(unRecipientIndex));
			}
		} else {
			for (const RecipientSource of vecSources) {
				for (const unRecipientIndex of NormalizeRecipientIndexes([RecipientSource], bIncludeBots)) {
					AppendUniqueRecipientIndex(vecResolvedRecipientIndexes, unRecipientIndex);
				}
			}
		}

		if (RecipientOptions.ClearRecipients) {
			this.ClearRecipients();
		}

		for (const unRecipientIndex of vecResolvedRecipientIndexes) {
			AppendUniqueRecipientIndex(this.RecipientIndexes, unRecipientIndex);
		}

		if (Object.hasOwn(RecipientOptions, "Reliable")) {
			this.Reliable = RecipientOptions.Reliable;
		}

		if (Object.hasOwn(RecipientOptions, "InitializationMessage")) {
			this.InitializationMessage = RecipientOptions.InitializationMessage;
		}

		return this;
	}

	ResolveRecipientPlayers() {
		return ResolveRecipientPlayers(this);
	}

	GetRecipientIndexes() {
		return this.RecipientIndexes.slice();
	}

	toString() {
		return `(${this.RecipientIndexes.join(", ")})`;
	}

	[Symbol.iterator]() {
		return this.RecipientIndexes[Symbol.iterator]();
	}

	get RecipientLength() {
		return this.RecipientIndexes.length;
	}

	get RecipientCount() {
		return this.RecipientIndexes.length;
	}
}

class RecipientFilter extends BaseRecipientFilter {
	constructor(...vecRecipientSourceFilters) {
		const RecipientOptions = ReadRecipientOptions(vecRecipientSourceFilters, { ClearRecipients: true, IncludeBots: true, InitializationMessage: false, Reliable: false });
		super(null, RecipientOptions);
		this.RecipientSourceFilters = vecRecipientSourceFilters;
		this.UpdateRecipients(...this.RecipientSourceFilters, { ClearRecipients: RecipientOptions.ClearRecipients, IncludeBots: this.IncludeBots });
	}
}

function WrapRecipientFilter(NativeRecipientFilterInformation, strNativeOperationName) {
	const strErrorMessage = `filters/recipients.${strNativeOperationName} returned an invalid recipient filter.`;
	const vecNativeRecipientIndexes = RequireRecipientFilterIndexes(NativeRecipientFilterInformation, strErrorMessage);

	return new RecipientFilter(vecNativeRecipientIndexes, { InitializationMessage: ReadBooleanOption(NativeRecipientFilterInformation, "InitializationMessage", false), Reliable: ReadBooleanOption(NativeRecipientFilterInformation, "Reliable", false) });
}

function GetHumanRecipients() {
	return WrapRecipientFilter(g_NativeRecipients.GetHumanRecipients(), "GetHumanRecipients");
}

function GetAllRecipients() {
	return WrapRecipientFilter(g_NativeRecipients.GetAllRecipients(), "GetAllRecipients");
}

function GetBotRecipients() {
	return WrapRecipientFilter(g_NativeRecipients.GetBotRecipients(), "GetBotRecipients");
}

function GetAliveRecipients() {
	return WrapRecipientFilter(g_NativeRecipients.GetAliveRecipients(), "GetAliveRecipients");
}

function GetDeadRecipients() {
	return WrapRecipientFilter(g_NativeRecipients.GetDeadRecipients(), "GetDeadRecipients");
}

function GetRecipientsByTeam(TeamValue, bIncludeBots = false) {
	return WrapRecipientFilter(g_NativeRecipients.GetRecipientsByTeam(TeamValue, RequireBoolean(bIncludeBots, "filters/recipients.GetRecipientsByTeam bIncludeBots")), "GetRecipientsByTeam");
}

function CreateRecipientFilterFromPlayer(RecipientValue, bIncludeBots = false) {
	return WrapRecipientFilter(g_NativeRecipients.CreateRecipientFilterFromPlayer(RequireRecipientIndex(RecipientValue), RequireBoolean(bIncludeBots, "filters/recipients.CreateRecipientFilterFromPlayer bIncludeBots")), "CreateRecipientFilterFromPlayer");
}

function CreateRecipientFilterFromValues(RecipientValues, bIncludeBots = false) {
	const vecRecipientIndexes = ExpandRecipientValues(RecipientValues).map(RequireRecipientIndex);

	return WrapRecipientFilter(g_NativeRecipients.CreateRecipientFilterFromValues(vecRecipientIndexes, RequireBoolean(bIncludeBots, "filters/recipients.CreateRecipientFilterFromValues bIncludeBots")), "CreateRecipientFilterFromValues");
}

const g_RecipientsAPI = {
	BaseRecipientFilter,
	ContainsRecipient,
	CreateRecipientFilterFromPlayer,
	CreateRecipientFilterFromValues,
	GetAliveRecipients,
	GetAllRecipients,
	GetBotRecipients,
	GetDeadRecipients,
	GetHumanRecipients,
	GetRecipientsByTeam,
	RecipientFilter,
	ResolveRecipientPlayers,
};

module.exports = g_RecipientsAPI;
