"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_nInt8Minimum = -128;
const g_nInt8Maximum = 127;
const g_unUInt8Maximum = 0xFF;
const g_nInt16Minimum = -32_768;
const g_nInt16Maximum = 32_767;
const g_unUInt16Maximum = 0xFFFF;
const g_nInt32Minimum = -2_147_483_648;
const g_nInt32Maximum = 2_147_483_647;
const g_unUInt32Maximum = 0xFFFFFFFF;
const g_nInt64Minimum = -(1n << 63n);
const g_nInt64Maximum = (1n << 63n) - 1n;
const g_unUInt64Maximum = 0xFFFFFFFFFFFFFFFFn;
const g_unGameRulesAddress = 0x300000n;
const g_unColorViewBaseAddress = 0x300100n;
const g_unIntervalViewBaseAddress = 0x300200n;
const g_unQuaternionViewBaseAddress = 0x300300n;
const g_unVectorViewBaseAddress = 0x300400n;
const g_unEdictBaseAddress = 0x410000n;
const g_unMinimumDocumentationCodeBlockCount = 15;

const g_strRepositoryRoot = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRoot, "docs", "api", "engines-gamerules.md");
const g_strPackagePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "engines", "gamerules.js");
const g_strRuntimePath = g_Path.join(g_strRepositoryRoot, "packages", "sourcejs", "internal", "runtime.js");

const g_vecPropertyDefinitions = [
	["m_bInWaitingForPlayers", "int", true],
	["m_flRestartRoundTime", "float", 12.5],
	["m_iRoundState", "int", 3],
	["m_iWinningTeam", "int", 2],
	["m_chRoundCode", "int", "A"],
	["m_dRoundMetric", "float", 10.25],
	["m_iSigned8", "int", -8],
	["m_iUnsigned8", "int", 8],
	["m_iSigned16", "int", -160],
	["m_iUnsigned16", "int", 160],
	["m_iSigned32", "int", -32_000],
	["m_iUnsigned32", "int", 32_000],
	["m_iSigned64", "int", -64_000n],
	["m_iUnsigned64", "int", 64_000n],
	["m_szAddressText", "string", "ready"],
	["m_szInlineText", "string", "campaign"],
	["m_pRoundOwner", "int", 0x310000n],
	["m_vecRoundOrigin", "vector", { X: 1, Y: 2, Z: 3 }],
	["m_clrRound", "int", { Red: 10, Green: 20, Blue: 30, Alpha: 255 }],
	["m_ivRound", "datatable", { Start: 4, Range: 8 }],
	["m_qRound", "datatable", { X: 0, Y: 0, Z: 0, W: 1 }],
	["m_pRoundEdict", "int", { Index: 7, Address: g_unEdictBaseAddress }],
];

const g_vecProperties = g_vecPropertyDefinitions.map(([strName, strType, Value], unIndex) => ({
	BitCount: (strType === "int") ? 32 : 0,
	ElementCount: 1,
	ElementStride: 0,
	Flags: 0,
	Name: strName,
	Offset: 0x04 + unIndex * 0x10,
	Path: strName,
	Type: strType,
	TypeID: unIndex,
	Value,
}));

function RequireProperty(strPropertyName) {
	g_Assert.equal(typeof strPropertyName, "string");
	g_Assert.notEqual(strPropertyName.length, 0);

	const Property = g_vecProperties.find((Property) => (Property.Name === strPropertyName) || (Property.Path === strPropertyName));
	if (!Property) {
		throw new Error(`Unable to find game rules property: ${strPropertyName}`);
	}

	return Property;
}

function RequireFiniteNumber(dblValue) {
	g_Assert.equal(typeof dblValue, "number");
	g_Assert.ok(Number.isFinite(dblValue));

	return dblValue;
}

function RequireInteger(nValue, nMinimum, nMaximum) {
	if (typeof nValue === "bigint") {
		const nMinimumValue = BigInt(nMinimum);
		const nMaximumValue = BigInt(nMaximum);
		g_Assert.ok((nValue >= nMinimumValue) && (nValue <= nMaximumValue));

		return nValue;
	}

	g_Assert.ok(Number.isSafeInteger(nValue));
	g_Assert.ok((nValue >= nMinimum) && (nValue <= nMaximum));

	return nValue;
}

function MakeLiveView(Property, vecComponentNames, unAddress, ValidateComponent) {
	const View = { Address: unAddress };
	for (const strComponentName of vecComponentNames) {
		Object.defineProperty(View, strComponentName, {
			configurable: false,
			enumerable: true,
			get() {
				return Property.Value[strComponentName];
			},
			set(ComponentValue) {
				Property.Value[strComponentName] = ValidateComponent(ComponentValue);
			},
		});
	}

	return View;
}

function SetPropertyComponents(strPropertyName, Value, vecComponentNames, ValidateComponent) {
	g_Assert.ok((Value !== null) && (typeof Value === "object") && !Array.isArray(Value));

	const Property = RequireProperty(strPropertyName);
	const NextValue = {};
	for (const strComponentName of vecComponentNames) {
		NextValue[strComponentName] = ValidateComponent(Value[strComponentName]);
	}

	Property.Value = NextValue;

	return true;
}

const g_GameRules = {
	Find() {
		return g_GameRules;
	},
	FindPropertyOffset(strPropertyName) {
		return RequireProperty(strPropertyName).Offset;
	},
	GetAddress() {
		return g_unGameRulesAddress;
	},
	GetProxyName() {
		return "CTeamplayRoundBasedRulesProxy";
	},
	GetPropertyBoolean(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyCharacter(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyColor(strPropertyName) {
		const Property = RequireProperty(strPropertyName);

		return MakeLiveView(Property, ["Red", "Green", "Blue", "Alpha"], g_unColorViewBaseAddress + BigInt(Property.Offset), (unValue) => RequireInteger(unValue, 0, g_unUInt8Maximum));
	},
	GetPropertyDouble(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyEdict(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyFloat(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyInt8(strPropertyName) {
		return Number(RequireProperty(strPropertyName).Value);
	},
	GetPropertyInt16(strPropertyName) {
		return Number(RequireProperty(strPropertyName).Value);
	},
	GetPropertyInt32(strPropertyName) {
		return Number(RequireProperty(strPropertyName).Value);
	},
	GetPropertyInt64(strPropertyName) {
		return BigInt(RequireProperty(strPropertyName).Value);
	},
	GetPropertyInterval(strPropertyName) {
		const Property = RequireProperty(strPropertyName);

		return MakeLiveView(Property, ["Start", "Range"], g_unIntervalViewBaseAddress + BigInt(Property.Offset), RequireFiniteNumber);
	},
	GetPropertyAddress(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyQuaternion(strPropertyName) {
		const Property = RequireProperty(strPropertyName);

		return MakeLiveView(Property, ["X", "Y", "Z", "W"], g_unQuaternionViewBaseAddress + BigInt(Property.Offset), RequireFiniteNumber);
	},
	GetPropertyStringBuffer(strPropertyName, unMaximumLength) {
		g_Assert.ok(Number.isInteger(unMaximumLength) && (unMaximumLength > 0) && (unMaximumLength <= g_nInt32Maximum));

		const strValue = RequireProperty(strPropertyName).Value;
		g_Assert.ok(Buffer.byteLength(strValue, "utf8") < unMaximumLength);

		return strValue;
	},
	GetPropertyStringAddress(strPropertyName) {
		return RequireProperty(strPropertyName).Value;
	},
	GetPropertyUInt8(strPropertyName) {
		return Number(RequireProperty(strPropertyName).Value);
	},
	GetPropertyUInt16(strPropertyName) {
		return Number(RequireProperty(strPropertyName).Value);
	},
	GetPropertyUInt32(strPropertyName) {
		return Number(RequireProperty(strPropertyName).Value);
	},
	GetPropertyUInt64(strPropertyName) {
		return BigInt(RequireProperty(strPropertyName).Value);
	},
	GetPropertyVector(strPropertyName) {
		const Property = RequireProperty(strPropertyName);

		return MakeLiveView(Property, ["X", "Y", "Z"], g_unVectorViewBaseAddress + BigInt(Property.Offset), RequireFiniteNumber);
	},
	GetSendTableName() {
		return "DT_TeamplayRoundBasedRules";
	},
	IsAvailable() {
		return true;
	},
	ListProperties() {
		return g_vecProperties.map((Property) => {
			const PublicProperty = { ...Property };
			delete PublicProperty.Value;

			return PublicProperty;
		});
	},
	SetPropertyBoolean(strPropertyName, bValue) {
		g_Assert.equal(typeof bValue, "boolean");

		RequireProperty(strPropertyName).Value = bValue;

		return true;
	},
	SetPropertyCharacter(strPropertyName, CharacterValue) {
		g_Assert.ok(((typeof CharacterValue === "string") && (Buffer.byteLength(CharacterValue, "utf8") === 1)) || (Number.isInteger(CharacterValue) && (CharacterValue >= g_nInt8Minimum) && (CharacterValue <= g_nInt8Maximum)));

		RequireProperty(strPropertyName).Value = (typeof CharacterValue === "string") ? CharacterValue : String.fromCharCode(CharacterValue & g_unUInt8Maximum);

		return true;
	},
	SetPropertyColor(strPropertyName, ColorValue) {
		return SetPropertyComponents(strPropertyName, ColorValue, ["Red", "Green", "Blue", "Alpha"], (unComponent) => RequireInteger(unComponent, 0, g_unUInt8Maximum));
	},
	SetPropertyDouble(strPropertyName, dblValue) {
		RequireProperty(strPropertyName).Value = RequireFiniteNumber(dblValue);

		return true;
	},
	SetPropertyEdict(strPropertyName, EntityValue) {
		g_Assert.ok((EntityValue === null) || Number.isInteger(EntityValue) || ((typeof EntityValue === "object") && Number.isInteger(EntityValue.Index)));

		RequireProperty(strPropertyName).Value = (EntityValue === null) ? null : (Number.isInteger(EntityValue) ? { Index: EntityValue, Address: g_unEdictBaseAddress + BigInt(EntityValue) } : EntityValue);

		return true;
	},
	SetPropertyFloat(strPropertyName, flValue) {
		RequireProperty(strPropertyName).Value = RequireFiniteNumber(flValue);

		return true;
	},
	SetPropertyInt8(strPropertyName, nInt8Value) {
		RequireProperty(strPropertyName).Value = RequireInteger(nInt8Value, g_nInt8Minimum, g_nInt8Maximum);

		return true;
	},
	SetPropertyInt16(strPropertyName, nInt16Value) {
		RequireProperty(strPropertyName).Value = RequireInteger(nInt16Value, g_nInt16Minimum, g_nInt16Maximum);

		return true;
	},
	SetPropertyInt32(strPropertyName, nInt32Value) {
		RequireProperty(strPropertyName).Value = RequireInteger(nInt32Value, g_nInt32Minimum, g_nInt32Maximum);

		return true;
	},
	SetPropertyInt64(strPropertyName, nInt64Value) {
		g_Assert.equal(typeof nInt64Value, "bigint");
		g_Assert.ok((nInt64Value >= g_nInt64Minimum) && (nInt64Value <= g_nInt64Maximum));

		RequireProperty(strPropertyName).Value = nInt64Value;

		return true;
	},
	SetPropertyInterval(strPropertyName, IntervalValue) {
		return SetPropertyComponents(strPropertyName, IntervalValue, ["Start", "Range"], RequireFiniteNumber);
	},
	SetPropertyAddress(strPropertyName, unAddress) {
		g_Assert.ok((typeof unAddress === "bigint") && (unAddress >= 0n));

		RequireProperty(strPropertyName).Value = unAddress;

		return true;
	},
	SetPropertyQuaternion(strPropertyName, QuaternionValue) {
		return SetPropertyComponents(strPropertyName, QuaternionValue, ["X", "Y", "Z", "W"], RequireFiniteNumber);
	},
	SetPropertyStringBuffer(strPropertyName, strValue, unBufferCapacity) {
		g_Assert.equal(typeof strValue, "string");
		g_Assert.equal(strValue.includes("\0"), false);
		g_Assert.ok(Number.isInteger(unBufferCapacity) && (unBufferCapacity > 0) && (unBufferCapacity <= g_nInt32Maximum));
		g_Assert.ok(Buffer.byteLength(strValue, "utf8") < unBufferCapacity);

		RequireProperty(strPropertyName).Value = strValue;

		return true;
	},
	SetPropertyStringAddress(strPropertyName, strValue) {
		g_Assert.equal(typeof strValue, "string");
		g_Assert.equal(strValue.includes("\0"), false);

		RequireProperty(strPropertyName).Value = strValue;

		return true;
	},
	SetPropertyUInt8(strPropertyName, unUInt8Value) {
		RequireProperty(strPropertyName).Value = RequireInteger(unUInt8Value, 0, g_unUInt8Maximum);

		return true;
	},
	SetPropertyUInt16(strPropertyName, unUInt16Value) {
		RequireProperty(strPropertyName).Value = RequireInteger(unUInt16Value, 0, g_unUInt16Maximum);

		return true;
	},
	SetPropertyUInt32(strPropertyName, unUInt32Value) {
		RequireProperty(strPropertyName).Value = RequireInteger(unUInt32Value, 0, g_unUInt32Maximum);

		return true;
	},
	SetPropertyUInt64(strPropertyName, unUInt64Value) {
		g_Assert.equal(typeof unUInt64Value, "bigint");
		g_Assert.ok((unUInt64Value >= 0n) && (unUInt64Value <= g_unUInt64Maximum));

		RequireProperty(strPropertyName).Value = unUInt64Value;

		return true;
	},
	SetPropertyVector(strPropertyName, VectorValue) {
		return SetPropertyComponents(strPropertyName, VectorValue, ["X", "Y", "Z"], RequireFiniteNumber);
	},
};

const g_InitialQuaternion = g_GameRules.GetPropertyQuaternion("m_qRound");
g_Assert.deepEqual([g_InitialQuaternion.X, g_InitialQuaternion.Y, g_InitialQuaternion.Z, g_InitialQuaternion.W], [0, 0, 0, 1], "initial quaternion uses canonical XYZW components");
g_Assert.equal(g_InitialQuaternion.Address, g_unQuaternionViewBaseAddress + BigInt(RequireProperty("m_qRound").Offset), "initial quaternion has an exact BigInt view address");

function VerifyWorldGameRulesExample(GameRules) {
	const strExamplePath = g_Path.join(g_strRepositoryRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("engines\/gamerules live state",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world example must demonstrate the actual gamerules exports");

	const RunExample = new Function("GameRules", "LogResult", `const { GetProxyName, GetSendTableName, IsAvailable, ListProperties } = GameRules;\n${vecMatch[0]}`);
	for (const bAvailable of [false, true]) {
		const ControlledGameRules = Object.assign(Object.create(GameRules), { IsAvailable: () => bAvailable });
		let Result = null;
		RunExample(ControlledGameRules, (strLabel, Callback) => {
			g_Assert.equal(strLabel, "engines/gamerules live state");
			Result = Callback();
		});
		g_Assert.equal(Result.Available, bAvailable);

		if (bAvailable) {
			g_Assert.equal(Result.PropertyCount, GameRules.ListProperties().length);
			g_Assert.equal(Result.ProxyName, GameRules.GetProxyName());
			g_Assert.equal(Result.SendTableName, GameRules.GetSendTableName());

		} else {
			g_Assert.deepEqual(Result, { Available: false });
		}
	}
}

const g_vecRequiredFunctions = [
	"Find",
	"FindPropertyOffset",
	"GetAddress",
	"GetProxyName",
	"GetPropertyBoolean",
	"GetPropertyCharacter",
	"GetPropertyColor",
	"GetPropertyDouble",
	"GetPropertyEdict",
	"GetPropertyFloat",
	"GetPropertyInt8",
	"GetPropertyInt16",
	"GetPropertyInt32",
	"GetPropertyInt64",
	"GetPropertyInterval",
	"GetPropertyAddress",
	"GetPropertyQuaternion",
	"GetPropertyStringBuffer",
	"GetPropertyStringAddress",
	"GetPropertyUInt8",
	"GetPropertyUInt16",
	"GetPropertyUInt32",
	"GetPropertyUInt64",
	"GetPropertyVector",
	"GetSendTableName",
	"IsAvailable",
	"ListProperties",
	"SetPropertyBoolean",
	"SetPropertyCharacter",
	"SetPropertyColor",
	"SetPropertyDouble",
	"SetPropertyEdict",
	"SetPropertyFloat",
	"SetPropertyInt8",
	"SetPropertyInt16",
	"SetPropertyInt32",
	"SetPropertyInt64",
	"SetPropertyInterval",
	"SetPropertyAddress",
	"SetPropertyQuaternion",
	"SetPropertyStringBuffer",
	"SetPropertyStringAddress",
	"SetPropertyUInt8",
	"SetPropertyUInt16",
	"SetPropertyUInt32",
	"SetPropertyUInt64",
	"SetPropertyVector",
];

g_Assert.equal(g_vecRequiredFunctions.length, 47);
g_Assert.deepEqual(Object.keys(g_GameRules).sort(), [...g_vecRequiredFunctions].sort());

globalThis.sourcejs = {
	"engines/gamerules": g_GameRules,
};

delete require.cache[require.resolve(g_strRuntimePath)];
delete require.cache[require.resolve(g_strPackagePath)];

const g_ExportedGameRules = require(g_strPackagePath);
g_Assert.equal(g_ExportedGameRules, g_GameRules);

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
const g_MutedConsole = {
	log() {
	},
};

g_Assert.ok(g_vecCodeBlocks.length >= g_unMinimumDocumentationCodeBlockCount);

for (const strFunctionName of g_vecRequiredFunctions) {
	g_Assert.ok(g_strDocumentation.includes(strFunctionName), `Documentation is missing ${strFunctionName}.`);
}

for (const strCodeBlock of g_vecCodeBlocks) {
	const Execute = new Function("require", "console", `"use strict";\n${strCodeBlock}`);
	const DocumentationRequire = (strModuleName) => {
		if (strModuleName === "engines/gamerules") {
			return g_ExportedGameRules;
		}

		if (strModuleName === "globals") {
			return { GetGlobalVariables: () => ({ SDKBranch: "l4d2" }) };
		}

		throw new Error(`Unexpected documentation dependency: ${strModuleName}`);
	};

	Execute(DocumentationRequire, g_MutedConsole);
}

g_Assert.equal(g_ExportedGameRules.Find(), g_ExportedGameRules);
g_Assert.equal(g_ExportedGameRules.GetAddress(), g_unGameRulesAddress);
g_Assert.equal(g_ExportedGameRules.GetProxyName(), "CTeamplayRoundBasedRulesProxy");
g_Assert.equal(g_ExportedGameRules.GetSendTableName(), "DT_TeamplayRoundBasedRules");
g_Assert.equal(g_ExportedGameRules.FindPropertyOffset("m_iRoundState"), RequireProperty("m_iRoundState").Offset);
g_Assert.equal(g_ExportedGameRules.ListProperties()[0].TypeID, 0);

const g_vecIntegerCases = [
	["Int8", "m_iSigned8", -12],
	["UInt8", "m_iUnsigned8", 12],
	["Int16", "m_iSigned16", -1_200],
	["UInt16", "m_iUnsigned16", 1_200],
	["Int32", "m_iSigned32", -120_000],
	["UInt32", "m_iUnsigned32", 120_000],
	["Int64", "m_iSigned64", -120_000n],
	["UInt64", "m_iUnsigned64", 120_000n],
];

for (const [strTypeName, strPropertyName, nIntegerValue] of g_vecIntegerCases) {
	const Getter = g_ExportedGameRules[`GetProperty${strTypeName}`];
	const Setter = g_ExportedGameRules[`SetProperty${strTypeName}`];
	const nPreviousIntegerValue = Getter(strPropertyName);

	g_Assert.equal(Setter(strPropertyName, nIntegerValue), true);
	g_Assert.equal(Getter(strPropertyName), nIntegerValue);
	g_Assert.equal(Setter(strPropertyName, nPreviousIntegerValue), true);
}

g_Assert.equal(g_ExportedGameRules.SetPropertyBoolean("m_bInWaitingForPlayers", false), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyBoolean("m_bInWaitingForPlayers"), false);
g_Assert.equal(g_ExportedGameRules.SetPropertyBoolean("m_bInWaitingForPlayers", true), true);
g_Assert.throws(() => g_ExportedGameRules.SetPropertyBoolean("m_bInWaitingForPlayers", 1));

g_Assert.equal(g_ExportedGameRules.SetPropertyCharacter("m_chRoundCode", "Z"), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyCharacter("m_chRoundCode"), "Z");
g_Assert.throws(() => g_ExportedGameRules.SetPropertyCharacter("m_chRoundCode", "ZZ"));

g_Assert.equal(g_ExportedGameRules.SetPropertyFloat("m_flRestartRoundTime", 25.5), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyFloat("m_flRestartRoundTime"), 25.5);
g_Assert.equal(g_ExportedGameRules.SetPropertyDouble("m_dRoundMetric", 20.75), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyDouble("m_dRoundMetric"), 20.75);

g_Assert.equal(g_ExportedGameRules.SetPropertyStringAddress("m_szAddressText", "running"), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyStringAddress("m_szAddressText"), "running");
g_Assert.equal(g_ExportedGameRules.SetPropertyStringBuffer("m_szInlineText", "chapter", 32), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyStringBuffer("m_szInlineText", 32), "chapter");

for (const strInvalidText of ["\0", "new\0suffix"]) {
	g_Assert.throws(() => g_ExportedGameRules.SetPropertyStringAddress("m_szAddressText", strInvalidText), g_Assert.AssertionError);
	g_Assert.throws(() => g_ExportedGameRules.SetPropertyStringBuffer("m_szInlineText", strInvalidText, 32), g_Assert.AssertionError);
	g_Assert.equal(g_ExportedGameRules.GetPropertyStringAddress("m_szAddressText"), "running");
	g_Assert.equal(g_ExportedGameRules.GetPropertyStringBuffer("m_szInlineText", 32), "chapter");
}

const g_unReplacementOwnerAddress = 0x320000n;
g_Assert.equal(g_ExportedGameRules.SetPropertyAddress("m_pRoundOwner", g_unReplacementOwnerAddress), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyAddress("m_pRoundOwner"), g_unReplacementOwnerAddress);
g_Assert.throws(() => g_ExportedGameRules.SetPropertyAddress("m_pRoundOwner", "0x320000"));
g_Assert.throws(() => g_ExportedGameRules.SetPropertyAddress("m_pRoundOwner", null));
g_Assert.throws(() => g_ExportedGameRules.SetPropertyAddress("m_pRoundOwner", 0x320000));

g_Assert.equal(g_ExportedGameRules.SetPropertyEdict("m_pRoundEdict", 9), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyEdict("m_pRoundEdict").Index, 9);
g_Assert.equal(g_ExportedGameRules.SetPropertyEdict("m_pRoundEdict", null), true);
g_Assert.equal(g_ExportedGameRules.GetPropertyEdict("m_pRoundEdict"), null);

const g_VectorValue = g_ExportedGameRules.GetPropertyVector("m_vecRoundOrigin");
g_Assert.ok((typeof g_VectorValue.Address === "bigint") && (g_VectorValue.Address > 0n));
g_VectorValue.X = 9;
g_Assert.equal(g_ExportedGameRules.GetPropertyVector("m_vecRoundOrigin").X, 9);
g_Assert.equal(g_ExportedGameRules.SetPropertyVector("m_vecRoundOrigin", { X: 1, Y: 2, Z: 3 }), true);

const g_ColorValue = g_ExportedGameRules.GetPropertyColor("m_clrRound");
g_ColorValue.Red = 80;
g_Assert.equal(g_ExportedGameRules.GetPropertyColor("m_clrRound").Red, 80);
g_Assert.equal(g_ExportedGameRules.SetPropertyColor("m_clrRound", { Red: 10, Green: 20, Blue: 30, Alpha: 255 }), true);

const g_IntervalValue = g_ExportedGameRules.GetPropertyInterval("m_ivRound");
g_IntervalValue.Range = 16;
g_Assert.equal(g_ExportedGameRules.GetPropertyInterval("m_ivRound").Range, 16);
g_Assert.equal(g_ExportedGameRules.SetPropertyInterval("m_ivRound", { Start: 4, Range: 8 }), true);

const g_QuaternionValue = g_ExportedGameRules.GetPropertyQuaternion("m_qRound");
g_QuaternionValue.W = 0.5;
g_Assert.equal(g_ExportedGameRules.GetPropertyQuaternion("m_qRound").W, 0.5);
g_Assert.equal(g_ExportedGameRules.SetPropertyQuaternion("m_qRound", { X: 0, Y: 0, Z: 0, W: 1 }), true);

VerifyWorldGameRulesExample(g_ExportedGameRules);

delete globalThis.sourcejs;

console.log("[smoke_engines_gamerules] ok");
