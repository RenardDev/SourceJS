"use strict";

const g_Filesystem = require("filesystem");
const { GetModule } = require("internal/runtime");
const g_Paths = require("paths");

const g_ResourceExtensionPattern = /\.res$/i;
const g_EventResourceRuntime = GetModule("events/resource");
const g_NativeDescribeEventResource = g_EventResourceRuntime.DescribeEventResource.bind(g_EventResourceRuntime);
const g_NativeBuildEventResourceLine = g_EventResourceRuntime.BuildEventResourceLine.bind(g_EventResourceRuntime);
const g_NativeCreateEventResourceText = g_EventResourceRuntime.CreateEventResourceText.bind(g_EventResourceRuntime);
const g_NativeLoadEventsFromFile = g_EventResourceRuntime.LoadEventsFromFile.bind(g_EventResourceRuntime);

function NormalizeResourcePath(strResourceFilePath) {
	if (typeof strResourceFilePath !== "string") {
		throw new TypeError("EventResourceFile requires a string file path.");
	}

	const strNormalizedPath = strResourceFilePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").replace(g_ResourceExtensionPattern, "");
	if (strNormalizedPath.length === 0) {
		throw new TypeError("EventResourceFile requires a non-empty file path.");
	}

	if (strNormalizedPath.includes("\0")) {
		throw new TypeError("EventResourceFile paths must not contain NUL characters.");
	}

	if (/["]|[\r\n]/.test(strNormalizedPath)) {
		throw new TypeError("EventResourceFile paths must not contain quotes or line breaks.");
	}

	if (/^[A-Za-z]:/.test(strNormalizedPath)) {
		throw new TypeError("EventResourceFile paths must not contain drive prefixes.");
	}

	for (const strPathSegment of strNormalizedPath.split("/")) {
		if ((strPathSegment === ".") || (strPathSegment === "..")) {
			throw new TypeError("EventResourceFile paths must not contain relative traversal segments.");
		}
	}

	return strNormalizedPath;
}

function JoinResourcePath(strEventRootPath, strRelativePath) {
	if ((typeof strEventRootPath !== "string") || (typeof strRelativePath !== "string")) {
		throw new TypeError("EventResourceFile path components must be strings.");
	}

	if (strEventRootPath.length === 0) {
		throw new Error("EventResourceFile requires a non-empty paths.EVENT_ROOT value.");
	}

	const strPathSeparator = strEventRootPath.includes("\\") ? "\\" : "/";
	const strNormalizedRelativePath = strRelativePath.replace(/[\\/]+/g, strPathSeparator).replace(/^[\\/]+/, "");

	return (strEventRootPath.endsWith("/") || strEventRootPath.endsWith("\\")) ? `${strEventRootPath}${strNormalizedRelativePath}` : `${strEventRootPath}${strPathSeparator}${strNormalizedRelativePath}`;
}

function GetDirectoryName(strFilePath) {
	const nSeparatorIndex = Math.max(strFilePath.lastIndexOf("/"), strFilePath.lastIndexOf("\\"));

	return (nSeparatorIndex <= 0) ? "" : strFilePath.slice(0, nSeparatorIndex);
}

function RequireEventVariables(EventVariables) {
	if ((EventVariables === null) || (typeof EventVariables !== "object") || Array.isArray(EventVariables)) {
		throw new TypeError("EventResourceFile event variables must be an object.");
	}

	const Prototype = Object.getPrototypeOf(EventVariables);
	if ((Prototype !== Object.prototype) && (Prototype !== null)) {
		throw new TypeError("EventResourceFile event variables must be a plain object.");
	}

	return EventVariables;
}

function CreateEventResourceDescriptorValue(EventNameOrDescriptor, EventVariables = undefined) {
	if (typeof EventNameOrDescriptor === "string") {
		const strEventName = EventNameOrDescriptor.trim();
		if (strEventName.length === 0) {
			throw new TypeError("EventResourceFile event names must not be empty.");
		}

		const EventVariablesValue = RequireEventVariables((EventVariables === undefined) ? {} : EventVariables);
		return { EventName: strEventName, EventVariables: EventVariablesValue, Name: strEventName, Variables: EventVariablesValue };
	}

	if ((EventNameOrDescriptor === null) || (typeof EventNameOrDescriptor !== "object") || Array.isArray(EventNameOrDescriptor)) {
		throw new TypeError("EventResourceFile events must be event names or descriptors.");
	}

	if (EventVariables !== undefined) {
		throw new TypeError("EventResourceFile descriptor events do not accept a separate variables argument.");
	}

	const strEventName = Object.hasOwn(EventNameOrDescriptor, "EventName") ? EventNameOrDescriptor.EventName : EventNameOrDescriptor.Name;
	if ((typeof strEventName !== "string") || (strEventName.trim().length === 0)) {
		throw new TypeError("EventResourceFile event descriptors require a non-empty name.");
	}

	const EventVariablesValue = Object.hasOwn(EventNameOrDescriptor, "EventVariables") ? EventNameOrDescriptor.EventVariables : EventNameOrDescriptor.Variables;
	const NormalizedEventVariables = RequireEventVariables((EventVariablesValue === undefined) ? {} : EventVariablesValue);

	return { EventName: strEventName.trim(), EventVariables: NormalizedEventVariables, Name: strEventName.trim(), Variables: NormalizedEventVariables };
}

function RenderResourceText(strResourcePath, itEventResources) {
	let strResourceText = `"${strResourcePath}"\n{\n`;
	for (const EventResource of itEventResources) {
		const strEventResourceText = g_NativeCreateEventResourceText(EventResource.EventName, EventResource.EventVariables).trimEnd();
		for (const strEventResourceLine of strEventResourceText.split("\n")) {
			strResourceText += `\t${strEventResourceLine}\n`;
		}
	}

	return `${strResourceText}}\n`;
}

function RequireResourceEventName(strEventName) {
	if ((typeof strEventName !== "string") || (strEventName.length === 0)) {
		throw new TypeError("EventResourceFile event lookup names must be non-empty strings.");
	}

	return strEventName;
}

function DescribeEventResource(strEventName, EventVariables = {}) {
	return g_NativeDescribeEventResource(strEventName, EventVariables);
}

function BuildEventResourceLine(strEventVariableName, strEventVariableType) {
	return g_NativeBuildEventResourceLine(strEventVariableName, strEventVariableType);
}

function CreateEventResourceText(strEventName, EventVariables = {}) {
	return g_NativeCreateEventResourceText(strEventName, EventVariables);
}

function LoadEventsFromFile(strEventResourceFilePath) {
	if ((typeof strEventResourceFilePath === "string") && strEventResourceFilePath.includes("\0")) {
		throw new TypeError("LoadEventsFromFile(strEventResourceFilePath) paths must not contain NUL characters.");
	}

	return g_NativeLoadEventsFromFile(strEventResourceFilePath);
}

class EventResourceFile {
	constructor(strEventResourceFilePath, ...vecEventResourceDefinitions) {
		this.#m_strEventResourceFilePath = NormalizeResourcePath(strEventResourceFilePath);
		this.#m_mapEventResources = new Map();

		for (const EventResourceDefinition of vecEventResourceDefinitions) {
			this.AddEventResource(EventResourceDefinition);
		}
	}

	AddEventResource(EventResourceDefinition) {
		const EventResource = CreateEventResourceDescriptorValue(EventResourceDefinition);
		this.EventResources.set(EventResource.EventName, EventResource);

		return this;
	}

	SetEventResource(EventResourceDefinition, EventVariables = undefined) {
		const EventResource = CreateEventResourceDescriptorValue(EventResourceDefinition, EventVariables);
		this.EventResources.set(EventResource.EventName, EventResource);

		return this;
	}

	DeleteEventResource(strEventName) {
		return this.#m_mapEventResources.delete(RequireResourceEventName(strEventName));
	}

	ClearEventResources() {
		this.#m_mapEventResources.clear();
	}

	ForEach(Callback, ThisArgument = undefined) {
		if (typeof Callback !== "function") {
			throw new TypeError("EventResourceFile.ForEach() expects a callback function.");
		}

		const VisitEventResource = (EventResource, strEventName) => Callback.call(ThisArgument, EventResource, strEventName, this);
		this.#m_mapEventResources.forEach(VisitEventResource);

		return this;
	}

	CreateEventResourceText() {
		return RenderResourceText(this.#m_strEventResourceFilePath, this.#m_mapEventResources.values());
	}

	WriteEventResourceFile() {
		const strEventResourceFilePath = this.FullEventResourceFilePath;
		const strEventResourceDirectoryPath = GetDirectoryName(strEventResourceFilePath);
		if ((strEventResourceDirectoryPath.length > 0) && !g_Filesystem.EnsureDirectoryExists(strEventResourceDirectoryPath)) {
			throw new Error(`Unable to create event resource directory: ${strEventResourceDirectoryPath}`);
		}

		const strEventResourceText = this.CreateEventResourceText();
		if (!g_Filesystem.WriteTextFile(strEventResourceFilePath, strEventResourceText)) {
			throw new Error(`Unable to write event resource file: ${strEventResourceFilePath}`);
		}

		return strEventResourceFilePath;
	}

	LoadEventsFromFile() {
		return LoadEventsFromFile(this.FullEventResourceFilePath);
	}

	toString() {
		return this.CreateEventResourceText();
	}

	[Symbol.iterator]() {
		return this.Entries();
	}

	GetEventResource(strEventName) {
		return this.#m_mapEventResources.get(RequireResourceEventName(strEventName));
	}

	HasEventResource(strEventName) {
		return this.#m_mapEventResources.has(RequireResourceEventName(strEventName));
	}

	Keys() {
		return this.#m_mapEventResources.keys();
	}

	Values() {
		return this.#m_mapEventResources.values();
	}

	Entries() {
		return this.#m_mapEventResources.entries();
	}

	get EventResourceFilePath() {
		return this.#m_strEventResourceFilePath;
	}

	get EventResources() {
		return this.#m_mapEventResources;
	}

	get FullEventResourceFilePath() {
		return JoinResourcePath(g_Paths.EVENT_ROOT, `${this.#m_strEventResourceFilePath}.res`);
	}

	get EventResourceCount() {
		return this.EventResources.size;
	}

	#m_strEventResourceFilePath;
	#m_mapEventResources;
}

Object.assign(g_EventResourceRuntime, {
	DescribeEventResource,
	CreateEventResourceText,
	BuildEventResourceLine,
	EventResourceFile,
	LoadEventsFromFile,
});

module.exports = g_EventResourceRuntime;
