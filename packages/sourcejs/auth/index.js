"use strict";

function GetBackendName(Instance) {
	const strBackendName = Instance.constructor.BackendName;
	if ((typeof strBackendName !== "string") || (strBackendName.length === 0)) {
		throw new Error("Auth backend must define a name.");
	}

	return strBackendName.toLowerCase();
}

class Backend {
	constructor(Options = {}) {
		const DefaultOptions = this.constructor.Options ?? {};
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth backend options must be an object.");
		}

		this.m_Options = { ...DefaultOptions, ...Options };
		this.m_bLoaded = false;
	}

	Load(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.Load expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.Load expects a callback function.");
		}

		this.m_bLoaded = true;
		Callback(null, this);
	}

	Unload(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.Unload expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.Unload expects a callback function.");
		}

		this.m_bLoaded = false;
		Callback(null, this);
	}

	Synchronize(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.Synchronize expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.Synchronize expects a callback function.");
		}

		throw new Error(`${this.Name} auth backend must define Synchronize().`);
	}

	PermissionAdded(Node, strPermission, nServerID, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.PermissionAdded expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.PermissionAdded expects a callback function.");
		}

		Callback(null);
	}

	PermissionRemoved(Node, strPermission, nServerID, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.PermissionRemoved expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.PermissionRemoved expects a callback function.");
		}

		Callback(null);
	}

	ParentAdded(Node, strParentName, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.ParentAdded expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.ParentAdded expects a callback function.");
		}

		Callback(null);
	}

	ParentRemoved(Node, strParentName, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Auth Backend.ParentRemoved expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("Auth Backend.ParentRemoved expects a callback function.");
		}

		Callback(null);
	}

	get Name() {
		return GetBackendName(this);
	}

	get Options() {
		return this.m_Options;
	}

	get Loaded() {
		return this.m_bLoaded;
	}
}

Object.defineProperties(Backend, {
	BackendName: {
		configurable: true,
		enumerable: true,
		value: "",
		writable: true,
	},
	Options: {
		configurable: true,
		enumerable: true,
		value: {},
		writable: true,
	},
});

module.exports = {
	Backend: Backend,
};
