"use strict";

const { GetModule } = require("internal/runtime");
const { Backend } = require("auth/index");

const g_AuthorizationRuntime = GetModule("auth");

function GetPermissionNodeIdentity(Node) {
	if ((Node === null) || (typeof Node !== "object")) {
		throw new TypeError("FlatFileBackend expects a permission node.");
	}

	const strSteamID64 = Node.SteamID64;
	if ((typeof strSteamID64 === "string") && (strSteamID64.length !== 0)) {
		return { Player: true, Identifier: strSteamID64 };
	}

	const strNodeName = Node.Name;
	if ((typeof strNodeName !== "string") || (strNodeName.length === 0)) {
		throw new TypeError("FlatFileBackend permission node must define Name or SteamID64.");
	}

	return { Player: false, Identifier: strNodeName };
}

function ReportOperationFailure(Callback, OperationError, strOperationName) {
	Callback(OperationError || new AggregateError([OperationError], `${strOperationName} failed.`));
}

class FlatFileBackend extends Backend {
	constructor(Options = {}) {
		super(Options);
		this.m_Manager = this.m_Options.Manager;
		if ((this.m_Manager !== null) && (typeof this.m_Manager !== "object")) {
			throw new TypeError("FlatFileBackend Manager must be an object or null.");
		}
	}

	Load(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.Load expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.Load expects a callback function.");
		}

		let AuthorizationState;
		try {
			AuthorizationState = g_AuthorizationRuntime.Reload();
			this.SynchronizeManager(AuthorizationState);
			this.m_bLoaded = true;
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.Load");
			return;
		}

		Callback(null, AuthorizationState);
	}

	Unload(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.Unload expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.Unload expects a callback function.");
		}

		this.m_bLoaded = false;
		Callback(null, true);
	}

	Synchronize(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.Synchronize expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.Synchronize expects a callback function.");
		}

		let AuthorizationState;
		try {
			AuthorizationState = g_AuthorizationRuntime.Reload();
			this.SynchronizeManager(AuthorizationState);
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.Synchronize");
			return;
		}

		Callback(null, AuthorizationState);
	}

	Save(Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.Save expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.Save expects a callback function.");
		}

		let bSaveResult = false;
		try {
			bSaveResult = g_AuthorizationRuntime.Save();
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.Save");
			return;
		}

		Callback(null, bSaveResult);
	}

	SynchronizeManager(AuthorizationState) {
		if (this.m_Manager === null) {
			return AuthorizationState;
		}

		this.m_Manager.m_mapParents.Clear();
		this.m_Manager.m_mapPlayers.Clear();

		const Options = {};
		const Callback = () => {
		};

		for (const strParentName of Object.keys(AuthorizationState.Parents)) {
			this.m_Manager.m_mapParents.GetOrCreate(strParentName);
		}

		for (const [strParentName, ParentRecord] of Object.entries(AuthorizationState.Parents)) {
			const ParentNode = this.m_Manager.m_mapParents.GetOrCreate(strParentName);
			for (const strPermission of ParentRecord.Permissions) {
				ParentNode.Add(strPermission, Options, Callback, null, false);
			}

			for (const strInheritedParentName of ParentRecord.Parents) {
				ParentNode.AddParent(strInheritedParentName, Options, Callback, false);
			}
		}

		for (const [strPlayerIdentifier, PlayerRecord] of Object.entries(AuthorizationState.Players)) {
			const PlayerNode = this.m_Manager.m_mapPlayers.GetOrCreate(strPlayerIdentifier);
			if (PlayerNode === null) {
				throw new TypeError(`Flat-file auth player identifier '${strPlayerIdentifier}' is invalid.`);
			}

			for (const strPermission of PlayerRecord.Permissions) {
				PlayerNode.Add(strPermission, Options, Callback, null, false);
			}

			for (const strParentName of PlayerRecord.Parents) {
				PlayerNode.AddParent(strParentName, Options, Callback, false);
			}
		}

		return AuthorizationState;
	}

	PermissionAdded(Node, strPermission, nServerID, Options, Callback) {
		if ((nServerID !== null) && !Number.isInteger(nServerID)) {
			throw new TypeError("FlatFileBackend.PermissionAdded expects an integer server ID or null.");
		}

		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.PermissionAdded expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.PermissionAdded expects a callback function.");
		}

		let bResult = false;
		try {
			const NodeIdentity = GetPermissionNodeIdentity(Node);
			bResult = NodeIdentity.Player ? g_AuthorizationRuntime.AddPlayerPermission(NodeIdentity.Identifier, strPermission) : g_AuthorizationRuntime.AddParentPermission(NodeIdentity.Identifier, strPermission);
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.PermissionAdded");
			return;
		}

		Callback(null, bResult);
	}

	PermissionRemoved(Node, strPermission, nServerID, Options, Callback) {
		if ((nServerID !== null) && !Number.isInteger(nServerID)) {
			throw new TypeError("FlatFileBackend.PermissionRemoved expects an integer server ID or null.");
		}

		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.PermissionRemoved expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.PermissionRemoved expects a callback function.");
		}

		let bResult = false;
		try {
			const NodeIdentity = GetPermissionNodeIdentity(Node);
			bResult = NodeIdentity.Player ? g_AuthorizationRuntime.RemovePlayerPermission(NodeIdentity.Identifier, strPermission) : g_AuthorizationRuntime.RemoveParentPermission(NodeIdentity.Identifier, strPermission);
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.PermissionRemoved");
			return;
		}

		Callback(null, bResult);
	}

	ParentAdded(Node, strParentName, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.ParentAdded expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.ParentAdded expects a callback function.");
		}

		let bResult = false;
		try {
			const NodeIdentity = GetPermissionNodeIdentity(Node);
			bResult = NodeIdentity.Player ? g_AuthorizationRuntime.AddPlayerParent(NodeIdentity.Identifier, strParentName) : g_AuthorizationRuntime.AddParentParent(NodeIdentity.Identifier, strParentName);
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.ParentAdded");
			return;
		}

		Callback(null, bResult);
	}

	ParentRemoved(Node, strParentName, Options, Callback) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("FlatFileBackend.ParentRemoved expects an options object.");
		}

		if (typeof Callback !== "function") {
			throw new TypeError("FlatFileBackend.ParentRemoved expects a callback function.");
		}

		let bResult = false;
		try {
			const NodeIdentity = GetPermissionNodeIdentity(Node);
			bResult = NodeIdentity.Player ? g_AuthorizationRuntime.RemovePlayerParent(NodeIdentity.Identifier, strParentName) : g_AuthorizationRuntime.RemoveParentParent(NodeIdentity.Identifier, strParentName);
		} catch (OperationError) {
			ReportOperationFailure(Callback, OperationError, "FlatFileBackend.ParentRemoved");
			return;
		}

		Callback(null, bResult);
	}
}

Object.defineProperties(FlatFileBackend, {
	BackendName: {
		configurable: true,
		enumerable: true,
		value: "flatfile",
		writable: true,
	},
	Options: {
		configurable: true,
		enumerable: true,
		value: { Manager: null },
		writable: true,
	},
});

const g_FlatFileBackend = new FlatFileBackend();
module.exports = {
	FLAT_FILE_BACKEND: g_FlatFileBackend,
	FlatFileBackend: FlatFileBackend,
};
