"use strict";

const { GetModule } = require("internal/runtime");
const { SteamID } = require("steam");
const { Backend } = require("auth/index");
const { FlatFileBackend } = require("auth/backends/flatfile");
const { SQLBackend } = require("auth/backends/sql");

const g_AuthorizationRuntime = GetModule("auth");
const g_strGuestParentName = "guest";
const g_unSteamIDBitCount = 64;

function RequireText(strValue, strLabel) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strLabel} must be a non-empty string.`);
	}

	return strValue;
}

function RequireOptionalServerID(nServerID) {
	if (nServerID === null) {
		return null;
	}

	if (!Number.isInteger(nServerID)) {
		throw new TypeError("Server ID must be an integer or null.");
	}

	return nServerID;
}

function RequireUpdateFlag(bValue) {
	if (typeof bValue !== "boolean") {
		throw new TypeError("bUpdateBackend must be a boolean.");
	}

	return bValue;
}

function RequireAsyncArguments(Options, Callback, strMethodName) {
	if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
		throw new TypeError(`${strMethodName} expects an options object.`);
	}

	if (typeof Callback !== "function") {
		throw new TypeError(`${strMethodName} expects a callback function.`);
	}
}

function CompilePermission(strPermission) {
	const strEscapedPermission = RequireText(strPermission, "Permission").replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	// Native wildcards include line terminators, unlike the default RegExp dot.
	const strPermissionPattern = strEscapedPermission.replace(/\*/g, "[\\s\\S]*");

	return new RegExp(`^${strPermissionPattern}$`);
}

function NormalizeBackendName(strName) {
	return RequireText(strName, "Backend name").toLowerCase();
}

function NormalizeSteamID(Value) {
	if (typeof Value === "bigint") {
		if ((Value < BigInt(0)) || (BigInt.asUintN(g_unSteamIDBitCount, Value) !== Value)) {
			throw new TypeError("SteamID bigint must be an unsigned 64-bit integer.");
		}

		return Value.toString();
	}

	if ((typeof Value !== "string") || (Value.length === 0)) {
		throw new TypeError("SteamID must be a non-empty string or an unsigned 64-bit bigint.");
	}

	const strSteamIDText = Value.trim();
	if (strSteamIDText.toUpperCase() === "BOT") {
		return null;
	}

	return SteamID.Parse(strSteamIDText).ConvertSteamIDToUInt64().toString();
}

function CreateBuiltInBackends(Manager) {
	return [new FlatFileBackend({ Manager }), new SQLBackend({ Manager })];
}

function RunPermissionTraversal(CreateFrame, RootNode) {
	const vecFrames = [CreateFrame(RootNode)];
	let Result = undefined;

	try {
		while (vecFrames.length !== 0) {
			const itFrame = vecFrames[vecFrames.length - 1];
			const Step = itFrame.next(Result);
			if (Step.done) {
				vecFrames.pop();
				Result = Step.value;
			} else {
				vecFrames.push(CreateFrame(Step.value));
			}
		}
	} catch (Exception) {
		while (vecFrames.length !== 0) {
			const itFrame = vecFrames.pop();
			try {
				itFrame.return();
			} catch {
				// Iterator closing must not replace an already propagating thrown value.
			}
		}

		throw Exception;
	}

	return Result;
}

class PermissionBase extends Map {
	constructor(strName, Manager = null) {
		super();

		if ((Manager !== null) && (typeof Manager !== "object")) {
			throw new TypeError("Permission manager must be an object or null.");
		}

		const strPermissionName = RequireText(strName, "Permission node name");

		this.m_Manager = Manager;
		this.m_setParents = new Set();
		this.m_strName = strPermissionName;

		if ((this.m_strName !== g_strGuestParentName) && (this.m_Manager !== null)) {
			this.AddParent(g_strGuestParentName, {}, () => {
			}, false);
		}
	}

	Add(strPermission, Options, Callback, nServerID = null, bUpdateBackend = true) {
		RequireAsyncArguments(Options, Callback, "Permission.Add");

		const strPermissionName = RequireText(strPermission, "Permission");
		const nNormalizedServerID = RequireOptionalServerID(nServerID);
		const bShouldUpdateBackend = RequireUpdateFlag(bUpdateBackend);
		const Manager = this.m_Manager ?? g_mapAuthorizationManager;
		if (Manager.TargetsThisServer(nNormalizedServerID) && !this.HasDirectPermission(strPermissionName)) {
			this.set(strPermissionName, CompilePermission(strPermissionName));
		}

		if (!bShouldUpdateBackend) {
			Callback(null, this);
			return;
		}

		if (Manager.m_ActiveBackend === null) {
			Callback(new Error("Permission.Add requires an active authorization backend."));
			return;
		}

		Manager.m_ActiveBackend.PermissionAdded(this, strPermissionName, nNormalizedServerID ?? Manager.ServerID, Options, (BackendError) => {
			if (BackendError !== null) {
				Callback(BackendError);
				return;
			}

			Callback(null, this);
		});
	}

	Remove(strPermission, Options, Callback, nServerID = null, bUpdateBackend = true) {
		RequireAsyncArguments(Options, Callback, "Permission.Remove");

		const strPermissionName = RequireText(strPermission, "Permission");
		const nNormalizedServerID = RequireOptionalServerID(nServerID);
		const bShouldUpdateBackend = RequireUpdateFlag(bUpdateBackend);
		const Manager = this.m_Manager ?? g_mapAuthorizationManager;
		if (Manager.TargetsThisServer(nNormalizedServerID)) {
			this.delete(strPermissionName);
		}

		if (!bShouldUpdateBackend) {
			Callback(null, this);
			return;
		}

		if (Manager.m_ActiveBackend === null) {
			Callback(new Error("Permission.Remove requires an active authorization backend."));
			return;
		}

		Manager.m_ActiveBackend.PermissionRemoved(this, strPermissionName, nNormalizedServerID ?? Manager.ServerID, Options, (BackendError) => {
			if (BackendError !== null) {
				Callback(BackendError);
				return;
			}

			Callback(null, this);
		});
	}

	AddParent(strParentName, Options, Callback, bUpdateBackend = true) {
		RequireAsyncArguments(Options, Callback, "Permission.AddParent");

		const strNormalizedParentName = RequireText(strParentName, "Parent name");
		const bShouldUpdateBackend = RequireUpdateFlag(bUpdateBackend);
		const Manager = this.m_Manager ?? g_mapAuthorizationManager;
		const ParentNode = Manager.m_mapParents.GetOrCreate(strNormalizedParentName);
		if (!this.m_setParents.has(ParentNode)) {
			this.m_setParents.add(ParentNode);

			if (ParentNode instanceof ParentPermissions) {
				ParentNode.m_setChildren.add(this);
			}
		}

		if (!bShouldUpdateBackend) {
			Callback(null, this);
			return;
		}

		if (Manager.m_ActiveBackend === null) {
			Callback(new Error("Permission.AddParent requires an active authorization backend."));
			return;
		}

		Manager.m_ActiveBackend.ParentAdded(this, strNormalizedParentName, Options, (BackendError) => {
			if (BackendError !== null) {
				Callback(BackendError);
				return;
			}

			Callback(null, this);
		});
	}

	RemoveParent(strParentName, Options, Callback, bUpdateBackend = true) {
		RequireAsyncArguments(Options, Callback, "Permission.RemoveParent");

		const strNormalizedParentName = RequireText(strParentName, "Parent name");
		const bShouldUpdateBackend = RequireUpdateFlag(bUpdateBackend);
		const Manager = this.m_Manager ?? g_mapAuthorizationManager;
		const ParentNode = Manager.m_mapParents.get(strNormalizedParentName);
		if (this.m_setParents.delete(ParentNode) && (ParentNode instanceof ParentPermissions)) {
			ParentNode.m_setChildren.delete(this);
		}

		if (!bShouldUpdateBackend) {
			Callback(null, this);
			return;
		}

		if (Manager.m_ActiveBackend === null) {
			Callback(new Error("Permission.RemoveParent requires an active authorization backend."));
			return;
		}

		Manager.m_ActiveBackend.ParentRemoved(this, strNormalizedParentName, Options, (BackendError) => {
			if (BackendError !== null) {
				Callback(BackendError);
				return;
			}

			Callback(null, this);
		});
	}

	Has(strPermission) {
		return this.HasPermission(strPermission);
	}

	HasDirectPermission(strPermission) {
		return super.has(RequireText(strPermission, "Permission"));
	}

	HasPermission(strPermission, setVisited = new Set()) {
		if (!(setVisited instanceof Set)) {
			throw new TypeError("setVisited must be a Set.");
		}

		const strPermissionName = RequireText(strPermission, "Permission");
		const BaseHasPermission = PermissionBase.prototype.HasPermission;
		const CreateFrame = function* (PermissionNode) {
			if (setVisited.has(PermissionNode)) {
				return false;
			}

			setVisited.add(PermissionNode);

			for (const PermissionMatcher of PermissionNode.values()) {
				if (PermissionMatcher.test(strPermissionName)) {
					return true;
				}
			}

			for (const ParentPermission of PermissionNode.m_setParents) {
				const HasParentPermission = ParentPermission.HasPermission;
				let bHasPermission = false;
				if (HasParentPermission === BaseHasPermission) {
					bHasPermission = yield ParentPermission;
				} else {
					bHasPermission = Reflect.apply(HasParentPermission, ParentPermission, [strPermissionName, setVisited]);
				}

				if (bHasPermission) {
					return true;
				}
			}

			return false;
		};

		return RunPermissionTraversal(CreateFrame, this);
	}

	Flatten(setVisited = new Set()) {
		if (!(setVisited instanceof Set)) {
			throw new TypeError("setVisited must be a Set.");
		}

		const BaseFlatten = PermissionBase.prototype.Flatten;
		const CreateFrame = function* (PermissionNode) {
			if (setVisited.has(PermissionNode)) {
				return [];
			}

			setVisited.add(PermissionNode);

			const vecPermissionNames = Array.from(PermissionNode.keys());
			for (const ParentPermission of PermissionNode.m_setParents) {
				const FlattenParent = ParentPermission.Flatten;
				let vecParentPermissionNames = null;
				if (FlattenParent === BaseFlatten) {
					vecParentPermissionNames = yield ParentPermission;
				} else {
					vecParentPermissionNames = Reflect.apply(FlattenParent, ParentPermission, [setVisited]);
				}

				for (const strParentPermissionName of vecParentPermissionNames) {
					vecPermissionNames.push(strParentPermissionName);
				}
			}

			return vecPermissionNames;
		};

		return RunPermissionTraversal(CreateFrame, this);
	}

	Clear() {
		for (const ParentPermission of this.m_setParents) {
			if (ParentPermission instanceof ParentPermissions) {
				ParentPermission.m_setChildren.delete(this);
			}
		}

		super.clear();
		this.m_setParents.clear();

		return this;
	}

	get Name() {
		return this.m_strName;
	}

	get Manager() {
		return this.m_Manager;
	}

	get Parents() {
		return this.m_setParents;
	}
}

class PlayerPermissions extends PermissionBase {
	constructor(strPlayerName, strSteamID64, Manager = null) {
		const strNormalizedSteamID64 = RequireText(strSteamID64, "SteamID64");

		super(strPlayerName, Manager);
		this.m_strSteamID64 = strNormalizedSteamID64;
	}

	get SteamID64() {
		return this.m_strSteamID64;
	}
}

class ParentPermissions extends PermissionBase {
	constructor(strParentName, Manager = null) {
		super(strParentName, Manager);
		this.m_setChildren = new Set();
	}

	Clear() {
		for (const mapChildPermission of this.m_setChildren) {
			mapChildPermission.m_setParents.delete(this);
		}

		super.Clear();
		this.m_setChildren.clear();

		return this;
	}

	get Children() {
		return this.m_setChildren;
	}
}

class PermissionStore extends Map {
	Clear() {
		for (const mapPermissionNode of this.values()) {
			mapPermissionNode.Clear();
		}

		super.clear();
	}
}

class ParentPermissionStore extends PermissionStore {
	constructor(Manager) {
		super();

		if (!Manager || (typeof Manager !== "object")) {
			throw new TypeError("ParentPermissionStore Manager must be an object.");
		}

		this.m_Manager = Manager;
	}

	GetOrCreate(strParentName) {
		const strNormalizedParentName = RequireText(strParentName, "Parent name");
		if (!this.has(strNormalizedParentName)) {
			this.set(strNormalizedParentName, new ParentPermissions(strNormalizedParentName, this.m_Manager));
		}

		return this.get(strNormalizedParentName);
	}
}

class PlayerPermissionStore extends PermissionStore {
	constructor(Manager) {
		super();

		if (!Manager || (typeof Manager !== "object")) {
			throw new TypeError("PlayerPermissionStore Manager must be an object.");
		}

		this.m_Manager = Manager;
	}

	GetOrCreate(Value) {
		const strNormalizedSteamID64 = NormalizeSteamID(Value);
		if (strNormalizedSteamID64 === null) {
			return null;
		}

		if (!this.has(strNormalizedSteamID64)) {
			this.set(strNormalizedSteamID64, new PlayerPermissions(strNormalizedSteamID64, strNormalizedSteamID64, this.m_Manager));
		}

		return this.get(strNormalizedSteamID64);
	}
}

function NormalizeRuntimeOperationError(OperationError, strOperationName) {
	return OperationError || new AggregateError([OperationError], `${strOperationName} failed.`);
}

class AuthManager extends Map {
	constructor() {
		super();
		this.m_mapParents = new ParentPermissionStore(this);
		this.m_mapPlayers = new PlayerPermissionStore(this);
		this.m_ActiveBackend = null;
		this.m_nServerID = -1;
	}

	AddBackend(BackendInstance) {
		if (!(BackendInstance instanceof Backend)) {
			throw new TypeError("AuthManager.AddBackend expects an auth backend.");
		}

		this.set(NormalizeBackendName(BackendInstance.Name), BackendInstance);

		return BackendInstance;
	}

	FindAndAddAvailableBackends(vecBackends = null) {
		if ((vecBackends !== null) && !Array.isArray(vecBackends)) {
			throw new TypeError("AuthManager.FindAndAddAvailableBackends expects an array or null.");
		}

		const vecAvailableBackends = vecBackends ?? CreateBuiltInBackends(this);
		const vecAddedBackends = [];
		for (const BackendInstance of vecAvailableBackends) {
			vecAddedBackends.push(this.AddBackend(BackendInstance));
		}

		return vecAddedBackends;
	}

	SetActiveBackend(strBackendName, Options, Callback) {
		RequireAsyncArguments(Options, Callback, "AuthManager.SetActiveBackend");

		const strNormalizedBackendName = NormalizeBackendName(strBackendName);
		const BackendInstance = this.get(strNormalizedBackendName);
		if (BackendInstance === undefined) {
			throw new Error(`Backend '${strNormalizedBackendName}' does not exist.`);
		}

		this.UnloadActiveBackend(Options, (UnloadError) => {
			if (UnloadError !== null) {
				Callback(UnloadError);
				return;
			}

			BackendInstance.Load(Options, (LoadError) => {
				if (LoadError !== null) {
					Callback(LoadError);
					return;
				}

				this.m_ActiveBackend = BackendInstance;
				Callback(null, BackendInstance);
			});
		});
	}

	UnloadActiveBackend(Options, Callback) {
		RequireAsyncArguments(Options, Callback, "AuthManager.UnloadActiveBackend");

		const CompleteUnload = (UnloadError) => {
			if (UnloadError !== null) {
				Callback(UnloadError);
				return;
			}

			this.m_mapParents.Clear();
			this.m_mapPlayers.Clear();
			this.m_ActiveBackend = null;
			Callback(null, true);
		};

		if (this.m_ActiveBackend === null) {
			CompleteUnload(null);
			return;
		}

		this.m_ActiveBackend.Unload(Options, CompleteUnload);
	}

	Load(strBackendName, Options, Callback) {
		RequireAsyncArguments(Options, Callback, "AuthManager.Load");

		if (strBackendName !== null) {
			this.SetActiveBackend(strBackendName, Options, Callback);
			return;
		}

		try {
			g_AuthorizationRuntime.Reload();
			this.RefreshFromRuntime();
		} catch (Exception) {
			Callback(NormalizeRuntimeOperationError(Exception, "AuthManager.Load"));
			return;
		}

		Callback(null, this);
	}

	Unload(Options, Callback) {
		RequireAsyncArguments(Options, Callback, "AuthManager.Unload");

		this.UnloadActiveBackend(Options, Callback);
	}

	Synchronize(Options, Callback) {
		RequireAsyncArguments(Options, Callback, "AuthManager.Synchronize");

		if (this.m_ActiveBackend !== null) {
			this.m_ActiveBackend.Synchronize(Options, Callback);
			return;
		}

		let AuthorizationState;
		try {
			AuthorizationState = this.RefreshFromRuntime();
		} catch (Exception) {
			Callback(NormalizeRuntimeOperationError(Exception, "AuthManager.Synchronize"));
			return;
		}

		Callback(null, AuthorizationState);
	}

	IsBackendLoaded(strBackendName) {
		if (this.m_ActiveBackend === null) {
			return false;
		}

		const strNormalizedActiveBackendName = NormalizeBackendName(this.m_ActiveBackend.Name);
		const strNormalizedBackendName = NormalizeBackendName(strBackendName);

		return strNormalizedActiveBackendName === strNormalizedBackendName;
	}

	GetPlayerPermissions(unClientIndex) {
		return this.GetPlayerPermissionsFromSteamID(g_AuthorizationRuntime.NetworkID(unClientIndex));
	}

	GetPlayerPermissionsFromSteamID(Value) {
		return this.m_mapPlayers.GetOrCreate(Value);
	}

	IsPlayerAuthorized(unClientIndex, strPermission) {
		const mapPlayerPermissions = this.GetPlayerPermissions(unClientIndex);
		if (mapPlayerPermissions === null) {
			return false;
		}

		return mapPlayerPermissions.HasPermission(strPermission);
	}

	GetParentPermissions(strParentName) {
		return this.m_mapParents.GetOrCreate(strParentName);
	}

	IsParentAuthorized(strParentName, strPermission) {
		return this.GetParentPermissions(strParentName).HasPermission(strPermission);
	}

	TargetsThisServer(nServerID) {
		const nNormalizedServerID = RequireOptionalServerID(nServerID);

		return (nNormalizedServerID === null) || (nNormalizedServerID === -1) || (nNormalizedServerID === this.m_nServerID);
	}

	RefreshFromRuntime() {
		this.m_mapParents.Clear();
		this.m_mapPlayers.Clear();

		for (const [strParentName, ParentRecord] of Object.entries(g_AuthorizationRuntime.Parents())) {
			const mapParentNode = this.m_mapParents.GetOrCreate(strParentName);
			for (const strPermissionName of ParentRecord.Permissions) {
				mapParentNode.Add(strPermissionName, {}, () => {
				}, null, false);
			}

			for (const strInheritedParentName of ParentRecord.Parents) {
				mapParentNode.AddParent(strInheritedParentName, {}, () => {
				}, false);
			}
		}

		for (const [strPlayerSteamID, PlayerRecord] of Object.entries(g_AuthorizationRuntime.Players())) {
			const mapPlayerNode = this.m_mapPlayers.GetOrCreate(strPlayerSteamID);
			if (mapPlayerNode === null) {
				continue;
			}

			for (const strPermissionName of PlayerRecord.Permissions) {
				mapPlayerNode.Add(strPermissionName, {}, () => {
				}, null, false);
			}

			for (const strParentName of PlayerRecord.Parents) {
				mapPlayerNode.AddParent(strParentName, {}, () => {
				}, false);
			}
		}

		return this;
	}

	get Parents() {
		return this.m_mapParents;
	}

	get Players() {
		return this.m_mapPlayers;
	}

	get ActiveBackend() {
		return this.m_ActiveBackend;
	}

	get ServerID() {
		return this.m_nServerID;
	}

	set ServerID(nServerID) {
		if (!Number.isInteger(nServerID)) {
			throw new TypeError("AuthManager ServerID must be an integer.");
		}

		this.m_nServerID = nServerID;
	}
}

const g_mapAuthorizationManager = new AuthManager();

module.exports = {
	AUTH_MANAGER: g_mapAuthorizationManager,
	AuthManager: AuthManager,
	GUEST_PARENT_NAME: g_strGuestParentName,
	ParentPermissionStore: ParentPermissionStore,
	ParentPermissions: ParentPermissions,
	PermissionBase: PermissionBase,
	PermissionStore: PermissionStore,
	PlayerPermissionStore: PlayerPermissionStore,
	PlayerPermissions: PlayerPermissions,
};
