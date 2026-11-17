"use strict";

const { GetCurrentWeapon, Remove } = require("weapons");

// The engine's class prefix remains exact; public object fields use PascalCase.
const g_strWeaponClassPrefix = "weapon_";

function RequireWeaponName(WeaponValue) {
	let strWeaponName = null;

	if (typeof WeaponValue === "string") {
		strWeaponName = WeaponValue;
	} else if (WeaponValue && (typeof WeaponValue === "object")) {
		const strValueWeaponName = WeaponValue.Weapon;
		if (typeof strValueWeaponName === "string") {
			strWeaponName = strValueWeaponName;
		}
	}

	if (strWeaponName !== null) {
		const strNormalizedName = strWeaponName.trim().toLowerCase();
		let strShortName = strNormalizedName;
		if (strShortName.startsWith(g_strWeaponClassPrefix)) {
			strShortName = strShortName.slice(g_strWeaponClassPrefix.length);
		}

		if (strShortName.length > 0) {
			return strShortName;
		}
	}

	throw new TypeError("Weapon restriction requires a weapon name or weapon object.");
}

function RequirePlayerUserID(PlayerValue) {
	if (Number.isSafeInteger(PlayerValue) && (PlayerValue > 0)) {
		return PlayerValue;
	}

	if (PlayerValue && (typeof PlayerValue === "object")) {
		const unPlayerUserID = PlayerValue.UserID;
		if (Number.isSafeInteger(unPlayerUserID) && (unPlayerUserID > 0)) {
			return unPlayerUserID;
		}
	}

	throw new TypeError("Weapon restriction requires a positive player user ID.");
}

function RequireTeamNumber(TeamValue) {
	let unResolvedTeamNumber = TeamValue;

	if (TeamValue && (typeof TeamValue === "object")) {
		unResolvedTeamNumber = TeamValue.TeamNumber;
	}

	if (!Number.isSafeInteger(unResolvedTeamNumber) || (unResolvedTeamNumber < 0)) {
		throw new TypeError("Weapon restriction requires a non-negative team number.");
	}

	return unResolvedTeamNumber;
}

function GetPlayerTeamNumber(Player) {
	if (!Player || (typeof Player !== "object")) {
		return null;
	}

	const unTeamNumber = Player.Team;
	if (!Number.isSafeInteger(unTeamNumber) || (unTeamNumber < 0)) {
		return null;
	}

	return unTeamNumber;
}

function RequireWeaponNames(vecWeaponValues) {
	if (!Array.isArray(vecWeaponValues)) {
		throw new TypeError("Weapon restrictions must be an array.");
	}

	const vecWeaponNames = [];
	for (const WeaponValue of vecWeaponValues) {
		vecWeaponNames.push(RequireWeaponName(WeaponValue));
	}

	return vecWeaponNames;
}

function FindOrCreateRestrictionSet(mapRestrictionsByScope, unScopeIdentifier, bCreateIfMissing) {
	let setRestriction = mapRestrictionsByScope.get(unScopeIdentifier);
	if ((setRestriction === undefined) && bCreateIfMissing) {
		setRestriction = new Set();
		mapRestrictionsByScope.set(unScopeIdentifier, setRestriction);
	}

	if (setRestriction === undefined) {
		return null;
	}

	return setRestriction;
}

function AddWeaponRestrictions(setRestriction, vecWeaponNames) {
	const vecAddedWeaponNames = [];
	for (const strWeaponName of vecWeaponNames) {
		if (!setRestriction.has(strWeaponName)) {
			setRestriction.add(strWeaponName);
			vecAddedWeaponNames.push(strWeaponName);
		}
	}

	return vecAddedWeaponNames;
}

function RemoveWeaponRestrictions(setRestriction, vecWeaponValues) {
	const vecWeaponNames = RequireWeaponNames(vecWeaponValues);

	if (!setRestriction) {
		return false;
	}

	let bRestrictionRemoved = false;
	for (const strWeaponName of vecWeaponNames) {
		if (setRestriction.delete(strWeaponName)) {
			bRestrictionRemoved = true;
		}
	}

	return bRestrictionRemoved;
}

class WeaponRestrictionManager {
	constructor() {
		this.ValueHandlers = new Set();
	}

	AddHandler(Handler) {
		if (!(Handler instanceof WeaponRestrictionHandler)) {
			throw new TypeError("Weapon restriction handler must be a WeaponRestrictionHandler.");
		}

		this.ValueHandlers.add(Handler);

		return Handler;
	}

	RemoveHandler(Handler) {
		return this.ValueHandlers.delete(Handler);
	}

	Clear() {
		for (const Handler of this.ValueHandlers) {
			Handler.Clear();
		}

		return true;
	}

	IsPlayerRestricted(Player, WeaponValue) {
		for (const Handler of this.ValueHandlers) {
			if (Handler.IsPlayerRestricted(Player, WeaponValue)) {
				return true;
			}
		}

		return false;
	}

	IsTeamRestricted(TeamValue, WeaponValue) {
		for (const Handler of this.ValueHandlers) {
			if (Handler.IsTeamRestricted(TeamValue, WeaponValue)) {
				return true;
			}
		}

		return false;
	}

	OnPlayerBumpingWeapon(Player, WeaponValue) {
		for (const Handler of this.ValueHandlers) {
			if (Handler.OnPlayerBumpingWeapon(Player, WeaponValue) === false) {
				return true;
			}
		}

		return null;
	}

	OnPlayerPurchasingWeapon(Player, WeaponValue) {
		for (const Handler of this.ValueHandlers) {
			if (Handler.OnPlayerPurchasingWeapon(Player, WeaponValue) === false) {
				return true;
			}
		}

		return null;
	}

	[Symbol.iterator]() {
		return this.ValueHandlers[Symbol.iterator]();
	}

	get Handlers() {
		return this.ValueHandlers;
	}

	get Size() {
		return this.ValueHandlers.size;
	}
}

// These classes refer to each other only when methods run, after module setup.
class WeaponRestrictionHandler {
	constructor(Options = {}) {
		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("WeaponRestrictionHandler options must be an object.");
		}

		const bAutoRegister = Options.AutoRegister;
		if ((bAutoRegister !== undefined) && (typeof bAutoRegister !== "boolean")) {
			throw new TypeError("WeaponRestrictionHandler AutoRegister must be a boolean.");
		}

		this.ValueGlobalRestrictions = new Set();
		this.ValuePlayerRestrictions = new Map();
		this.ValueTeamRestrictions = new Map();
		this.ValueManager = g_WeaponRestrictionManager;

		const Manager = Options.Manager;
		if (Manager !== undefined) {
			this.ValueManager = Manager;
		}

		if ((this.ValueManager !== null) && !(this.ValueManager instanceof WeaponRestrictionManager)) {
			throw new TypeError("WeaponRestrictionHandler Manager must be a WeaponRestrictionManager or null.");
		}

		if (this.ValueManager && (bAutoRegister !== false)) {
			this.ValueManager.AddHandler(this);
		}
	}

	Clear() {
		this.ValueGlobalRestrictions.clear();
		this.ValuePlayerRestrictions.clear();
		this.ValueTeamRestrictions.clear();

		return true;
	}

	AddGlobalRestrictions(vecWeaponValues) {
		const vecWeaponNames = RequireWeaponNames(vecWeaponValues);

		return AddWeaponRestrictions(this.ValueGlobalRestrictions, vecWeaponNames);
	}

	RemoveGlobalRestrictions(vecWeaponValues) {
		return RemoveWeaponRestrictions(this.ValueGlobalRestrictions, vecWeaponValues);
	}

	AddPlayerRestrictions(PlayerValue, vecWeaponValues) {
		const unPlayerUserID = RequirePlayerUserID(PlayerValue);
		const vecWeaponNames = RequireWeaponNames(vecWeaponValues);
		const setPlayerRestriction = FindOrCreateRestrictionSet(this.ValuePlayerRestrictions, unPlayerUserID, true);
		const vecAddedWeaponNames = AddWeaponRestrictions(setPlayerRestriction, vecWeaponNames);
		for (const strWeaponName of vecAddedWeaponNames) {
			this.OnPlayerRestrictionAdded(PlayerValue, strWeaponName);
		}

		return vecAddedWeaponNames;
	}

	RemovePlayerRestrictions(PlayerValue, vecWeaponValues) {
		const unPlayerUserID = RequirePlayerUserID(PlayerValue);
		const setPlayerRestriction = FindOrCreateRestrictionSet(this.ValuePlayerRestrictions, unPlayerUserID, false);
		const bRestrictionRemoved = RemoveWeaponRestrictions(setPlayerRestriction, vecWeaponValues);

		if ((setPlayerRestriction !== null) && (setPlayerRestriction.size === 0)) {
			this.ValuePlayerRestrictions.delete(unPlayerUserID);
		}

		return bRestrictionRemoved;
	}

	AddTeamRestrictions(TeamValue, vecWeaponValues) {
		const unTeamNumber = RequireTeamNumber(TeamValue);
		const vecWeaponNames = RequireWeaponNames(vecWeaponValues);
		const setTeamRestriction = FindOrCreateRestrictionSet(this.ValueTeamRestrictions, unTeamNumber, true);
		const vecAddedWeaponNames = AddWeaponRestrictions(setTeamRestriction, vecWeaponNames);
		for (const strWeaponName of vecAddedWeaponNames) {
			this.OnTeamRestrictionAdded(unTeamNumber, strWeaponName);
		}

		return vecAddedWeaponNames;
	}

	RemoveTeamRestrictions(TeamValue, vecWeaponValues) {
		const unTeamNumber = RequireTeamNumber(TeamValue);
		const setTeamRestriction = FindOrCreateRestrictionSet(this.ValueTeamRestrictions, unTeamNumber, false);
		const bRestrictionRemoved = RemoveWeaponRestrictions(setTeamRestriction, vecWeaponValues);

		if ((setTeamRestriction !== null) && (setTeamRestriction.size === 0)) {
			this.ValueTeamRestrictions.delete(unTeamNumber);
		}

		return bRestrictionRemoved;
	}

	IsGloballyRestricted(WeaponValue) {
		return this.ValueGlobalRestrictions.has(RequireWeaponName(WeaponValue));
	}

	IsPlayerRestricted(Player, WeaponValue) {
		const strWeaponName = RequireWeaponName(WeaponValue);
		const unPlayerUserID = RequirePlayerUserID(Player);
		const setPlayerRestriction = FindOrCreateRestrictionSet(this.ValuePlayerRestrictions, unPlayerUserID, false);
		const unTeamNumber = GetPlayerTeamNumber(Player);
		let setTeamRestriction = null;

		if (unTeamNumber !== null) {
			setTeamRestriction = FindOrCreateRestrictionSet(this.ValueTeamRestrictions, unTeamNumber, false);
		}

		if (this.ValueGlobalRestrictions.has(strWeaponName)) {
			return true;
		}

		if ((setPlayerRestriction !== null) && setPlayerRestriction.has(strWeaponName)) {
			return true;
		}

		if ((setTeamRestriction !== null) && setTeamRestriction.has(strWeaponName)) {
			return true;
		}

		return false;
	}

	IsTeamRestricted(TeamValue, WeaponValue) {
		const strWeaponName = RequireWeaponName(WeaponValue);
		const unTeamNumber = RequireTeamNumber(TeamValue);
		const setTeamRestriction = FindOrCreateRestrictionSet(this.ValueTeamRestrictions, unTeamNumber, false);

		if (this.ValueGlobalRestrictions.has(strWeaponName)) {
			return true;
		}

		if ((setTeamRestriction !== null) && setTeamRestriction.has(strWeaponName)) {
			return true;
		}

		return false;
	}

	OnPlayerBumpingWeapon(Player, WeaponValue) {
		return !this.IsPlayerRestricted(Player, WeaponValue);
	}

	OnPlayerPurchasingWeapon(Player, WeaponValue) {
		return !this.IsPlayerRestricted(Player, WeaponValue);
	}

	OnPlayerRestrictionAdded(PlayerValue, WeaponValue) {
		if (!PlayerValue || (typeof PlayerValue !== "object")) {
			return;
		}

		const unPlayerIndex = PlayerValue.Index;
		if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex <= 0)) {
			return;
		}

		const CurrentWeapon = GetCurrentWeapon(PlayerValue);
		if (!CurrentWeapon) {
			return;
		}

		const strCurrentWeaponName = RequireWeaponName(CurrentWeapon);
		const strRestrictedWeaponName = RequireWeaponName(WeaponValue);

		if (strCurrentWeaponName === strRestrictedWeaponName) {
			Remove(CurrentWeapon);
		}
	}

	// Public override hook: retain both callback positions in the default no-op.
	OnTeamRestrictionAdded(unTeamNumber, strWeaponName) {
	}

	Unregister() {
		if (!this.ValueManager) {
			return false;
		}

		return this.ValueManager.RemoveHandler(this);
	}

	get Manager() {
		return this.ValueManager;
	}

	get GlobalRestrictions() {
		return this.ValueGlobalRestrictions;
	}

	get PlayerRestrictions() {
		return this.ValuePlayerRestrictions;
	}

	get TeamRestrictions() {
		return this.ValueTeamRestrictions;
	}
}

const g_WeaponRestrictionManager = new WeaponRestrictionManager();
const g_WeaponRestrictionHandler = new WeaponRestrictionHandler();

function RestrictGlobal(WeaponValue) {
	return g_WeaponRestrictionHandler.AddGlobalRestrictions([WeaponValue]).length > 0;
}

function UnrestrictGlobal(WeaponValue) {
	return g_WeaponRestrictionHandler.RemoveGlobalRestrictions([WeaponValue]);
}

function RestrictPlayer(PlayerValue, WeaponValue) {
	return g_WeaponRestrictionHandler.AddPlayerRestrictions(PlayerValue, [WeaponValue]).length > 0;
}

function UnrestrictPlayer(PlayerValue, WeaponValue) {
	return g_WeaponRestrictionHandler.RemovePlayerRestrictions(PlayerValue, [WeaponValue]);
}

function RestrictTeam(TeamValue, WeaponValue) {
	return g_WeaponRestrictionHandler.AddTeamRestrictions(TeamValue, [WeaponValue]).length > 0;
}

function UnrestrictTeam(TeamValue, WeaponValue) {
	return g_WeaponRestrictionHandler.RemoveTeamRestrictions(TeamValue, [WeaponValue]);
}

function CanUse(Player, WeaponValue) {
	return !g_WeaponRestrictionManager.IsPlayerRestricted(Player, WeaponValue);
}

function CanUseCurrent(Player) {
	const CurrentWeapon = GetCurrentWeapon(Player);
	if (!CurrentWeapon) {
		return true;
	}

	return CanUse(Player, CurrentWeapon);
}

const g_WeaponRestrictionsAPI = {
	WEAPON_RESTRICTION_HANDLER: g_WeaponRestrictionHandler,
	WEAPON_RESTRICTION_MANAGER: g_WeaponRestrictionManager,
	WeaponRestrictionHandler,
	WeaponRestrictionManager,
	CanUse,
	CanUseCurrent,
	RestrictGlobal,
	RestrictPlayer,
	RestrictTeam,
	UnrestrictGlobal,
	UnrestrictPlayer,
	UnrestrictTeam,
};

module.exports = g_WeaponRestrictionsAPI;
